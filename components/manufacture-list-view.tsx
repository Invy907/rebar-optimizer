// components/manufacture-list-view.tsx
//
// 製作図（切断リスト）レイアウト。手書きフィードバックの様式に合わせた表。
// 列: 製作図 / 長さ 呼称(実寸) / 数量  ※せん断補強筋・高さ・幅・単重・重量計は対象外。
//
// 既存の計算ロジックは変更せず、結果の「見せ方」だけを写真の様式に寄せる表示コンポーネント。
// 数量は既存「種類別サマリ」と同じく線分（部材）本数を集計する。

'use client'

import { useMemo } from 'react'
import type { DrawingSegment, Unit } from '@/lib/types/database'
import { CustomerDatePicker } from '@/components/customer-date-picker'
import { CustomerDateTimePicker } from '@/components/customer-datetime-picker'
import { UnitShapeThumbnail } from '@/components/unit-client'
import {
  getSegmentColor,
  getSegmentEffectiveLengthMm,
  resolveLinkedUnit,
} from '@/lib/segment-meta'
import { getPitchBaseCount, getUnitPitchMm } from '@/lib/unit-calculations'

/** 1 データ行の高さ(px)。全行を均一にし、約 42 行/ページを目安に収める */
const ROW_HEIGHT = 21
/** 1 製作図あたりの最小行数。データ行が少ない場合は空行で埋めて形状の高さを確保
 *  （7 製作図 × 6 行 = 42 行 / ページ。行の多い製作図があるページは製作図が 7 未満になる） */
const MIN_ROWS_PER_BLOCK = 6
/** 列幅(px)。データ列だけ詰める（製作図は広いまま） */
const COL_SHAPE = 384
const COL_LEN = 118
const COL_QTY = 46
const COL_TATE = 54
import {
  compareSegmentColorOrder,
  getSegmentColorLabelJa,
  getSegmentStrokeHex,
  normalizeSegmentColor,
  type SegmentColor,
} from '@/lib/segment-colors'

type ManufactureRow = {
  key: string
  /** 呼称（図面上の実効長さ, mm） */
  nominalMm: number
  /** 実寸（呼称 + 補正値, mm） */
  actualMm: number
  /** 数量（この長さの部材本数） */
  qty: number
  /** タテ筋本数 = round(round(呼称/100)*100 / ピッチ)。ピッチ未設定は null */
  tateCount: number | null
}

type ManufactureGroup = {
  key: string
  unit: Unit | null
  unitName: string
  color: SegmentColor
  colorHex: string
  /** ユニットのピッチ(mm)。タテ筋本数の計算に使う */
  pitchMm: number | null
  rows: ManufactureRow[]
}

function isPersistedUnitId(id: string): boolean {
  return !id.startsWith('mock-') && !id.startsWith('local-')
}

/** 曜日（日〜土） */
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

/** "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm" を分解する */
function parseYmdHm(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec((value ?? '').trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return null
  return {
    year,
    month,
    day,
    hour: m[4] != null ? Number(m[4]) : null,
    minute: m[5] != null ? Number(m[5]) : null,
    weekday: WEEKDAY_JA[date.getDay()] ?? '',
  }
}

/** 積み込み日 → 令和表記「R8.8.5.(水)」（令和1年 = 2019年） */
function formatReiwaDate(value: string): string {
  const p = parseYmdHm(value)
  if (!p) return ''
  const reiwa = p.year - 2018
  if (reiwa < 1) return ''
  return `R${reiwa}.${p.month}.${p.day}.(${p.weekday})`
}

/** 到着日 → 「6(木)8:00」（同月内の日・曜日・時刻） */
function formatArrivalDayTime(value: string): string {
  const p = parseYmdHm(value)
  if (!p) return ''
  const time =
    p.hour != null ? `${p.hour}:${String(p.minute ?? 0).padStart(2, '0')}` : ''
  return `${p.day}(${p.weekday})${time}`
}

/**
 * 計算用のユニット解決（入力サマリと同じ挙動）。
 * 1. 線分に unit_id が付いていればそれ
 * 2. 未リンクなら同色・アクティブな永続化済みユニット
 */
function resolveUnitForSegment(
  seg: DrawingSegment,
  units: Unit[],
  color: SegmentColor,
): Unit | null {
  const linked = resolveLinkedUnit(seg, units)
  if (linked) return linked
  return (
    units.find(
      (u) =>
        u.is_active !== false &&
        isPersistedUnitId(u.id) &&
        normalizeSegmentColor(u.color) === color,
    ) ?? null
  )
}

export function buildManufactureGroups(
  segments: DrawingSegment[],
  units: Unit[],
  adjustmentMm: number,
): ManufactureGroup[] {
  const rebarSegments = segments.filter((s) => s.bar_type !== 'SPACING')

  type Acc = {
    group: ManufactureGroup
    byLength: Map<number, ManufactureRow>
  }
  const groups = new Map<string, Acc>()

  for (const seg of rebarSegments) {
    const color = getSegmentColor(seg, units)
    const unit = resolveUnitForSegment(seg, units, color)
    const nominalMm = getSegmentEffectiveLengthMm(seg, units)
    const groupKey = unit?.id
      ? `unit:${unit.id}`
      : `color:${color}:${seg.unit_name ?? seg.label ?? ''}`

    let acc = groups.get(groupKey)
    if (!acc) {
      acc = {
        group: {
          key: groupKey,
          unit,
          unitName:
            unit?.name?.trim() ||
            seg.unit_name?.trim() ||
            seg.label?.trim() ||
            getSegmentColorLabelJa(color),
          color,
          colorHex: getSegmentStrokeHex(color, false),
          pitchMm: getUnitPitchMm(unit),
          rows: [],
        },
        byLength: new Map(),
      }
      groups.set(groupKey, acc)
    }

    const existing = acc.byLength.get(nominalMm)
    if (existing) {
      existing.qty += 1
    } else {
      const pitch = acc.group.pitchMm
      acc.byLength.set(nominalMm, {
        key: `${groupKey}:${nominalMm}`,
        nominalMm,
        actualMm: nominalMm + (adjustmentMm || 0),
        qty: 1,
        // 4095 → 4100(100mm丸め) → 4100 ÷ 200(ピッチ) = 20.5 → 21(四捨五入)
        tateCount:
          pitch != null && pitch > 0 ? getPitchBaseCount(nominalMm, pitch) : null,
      })
    }
  }

  return Array.from(groups.values())
    .map((acc) => {
      acc.group.rows = Array.from(acc.byLength.values()).sort(
        (a, b) => b.nominalMm - a.nominalMm,
      )
      return acc.group
    })
    .sort((a, b) => compareSegmentColorOrder(a.color, b.color))
}

export function ManufactureListView({
  segments,
  units,
  adjustmentMm,
  customerCompany,
  onCustomerCompanyChange,
  customerName,
  onCustomerNameChange,
  customerAddress,
  onCustomerAddressChange,
  customerDate,
  onCustomerDateChange,
  customerArrival,
  onCustomerArrivalChange,
}: {
  segments: DrawingSegment[]
  units: Unit[]
  adjustmentMm: number
  customerCompany: string
  onCustomerCompanyChange: (value: string) => void
  customerName: string
  onCustomerNameChange: (value: string) => void
  customerAddress: string
  onCustomerAddressChange: (value: string) => void
  customerDate: string
  onCustomerDateChange: (value: string) => void
  customerArrival: string
  onCustomerArrivalChange: (value: string) => void
}) {
  const groups = useMemo(
    () => buildManufactureGroups(segments, units, adjustmentMm),
    [segments, units, adjustmentMm],
  )

  const plainTextInputClass =
    'min-w-0 border-0 bg-transparent px-0 py-0 text-sm outline-none placeholder:text-muted/50 focus:underline focus:decoration-primary/40 print:border-transparent print:bg-transparent'

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted">
        製作図リストの対象となる線分がありません。
      </p>
    )
  }

  const headCell =
    'border border-slate-400 px-1 py-1 text-center text-sm font-semibold bg-slate-50'
  const dataCell =
    'border border-slate-400 px-1 font-mono text-[15px] leading-none tabular-nums'

  return (
    <div className="manufacture-list-root space-y-3 print:space-y-0.5">
      <div className="manufacture-list-header flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-base font-semibold">製作図リスト</h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <label className="inline-flex max-w-full items-center gap-1">
              <AutoWidthInput
                value={customerCompany}
                onChange={onCustomerCompanyChange}
                placeholder="会社名"
                ariaLabel="会社名"
                minCh={8}
                maxCh={48}
                className={`${plainTextInputClass} font-semibold text-foreground`}
              />
              <span className="shrink-0 font-semibold text-foreground">様</span>
            </label>
            <label className="inline-flex max-w-full items-center gap-1">
              <AutoWidthInput
                value={customerName}
                onChange={onCustomerNameChange}
                placeholder="顧客名"
                ariaLabel="顧客名"
                minCh={6}
                maxCh={40}
                className={`${plainTextInputClass} font-semibold text-foreground`}
              />
              <span className="shrink-0 font-semibold text-foreground">様邸</span>
            </label>
            <label className="inline-flex max-w-full items-center gap-1">
              <AutoWidthInput
                value={customerAddress}
                onChange={onCustomerAddressChange}
                placeholder="現場住所"
                ariaLabel="現場住所"
                minCh={6}
                maxCh={48}
                className={`${plainTextInputClass} text-foreground`}
              />
            </label>
          </div>
        </div>
        {/* 画面では日付ピッカーで編集し、印刷時は手書き伝票と同じ書式で出す */}
        <div className="flex shrink-0 flex-col items-end gap-1 text-sm print:hidden">
          <CustomerDatePicker
            plain
            labelPrefix="積み込み日:"
            value={customerDate}
            onChange={onCustomerDateChange}
          />
          <CustomerDateTimePicker
            plain
            labelPrefix="到着日:"
            value={customerArrival}
            onChange={onCustomerArrivalChange}
          />
        </div>
        <div className="hidden shrink-0 flex-col items-end leading-tight print:flex">
          {formatReiwaDate(customerDate) ? (
            <div className="text-base font-bold">{formatReiwaDate(customerDate)}</div>
          ) : null}
          {formatArrivalDayTime(customerArrival) ? (
            <>
              <div className="mt-0.5 text-[10px] leading-none">つみこみ</div>
              <div className="text-base font-bold">
                {formatArrivalDayTime(customerArrival)}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: COL_SHAPE }} />
            <col style={{ width: COL_LEN }} />
            <col style={{ width: COL_QTY }} />
            <col style={{ width: COL_TATE }} />
          </colgroup>
          <thead>
            <tr>
              <th className={headCell}>製作図</th>
              <th className={headCell}>長さ 呼称(実寸)</th>
              <th className={headCell}>数量</th>
              <th className={headCell}>タテ筋</th>
            </tr>
          </thead>
          {groups.map((g) => {
            const rowSlots = Math.max(g.rows.length, MIN_ROWS_PER_BLOCK)
            const shapeCellHeight = rowSlots * ROW_HEIGHT
            return (
              <tbody key={g.key} className="break-inside-avoid">
                {Array.from({ length: rowSlots }, (_, idx) => {
                  const r = g.rows[idx] ?? null
                  return (
                    <tr key={`${g.key}:${idx}`}>
                      {idx === 0 && (
                        <td
                          className="border border-slate-400 p-0 text-center align-middle"
                          rowSpan={rowSlots}
                        >
                          <div
                            className="flex flex-col items-center justify-center gap-0.5 px-1"
                            style={{ height: shapeCellHeight }}
                          >
                            {g.unit ? (
                              <div className="min-h-0 w-full flex-1">
                                <UnitShapeThumbnail
                                  unit={g.unit}
                                  large
                                  containerClassName="relative h-full w-full"
                                />
                              </div>
                            ) : (
                              <span className="text-xs text-muted">
                                （形状なし）
                              </span>
                            )}
                            <span className="shrink-0 text-[11px] font-semibold leading-none text-slate-700">
                              {g.unitName}
                            </span>
                          </div>
                        </td>
                      )}
                      <td
                        className={`${dataCell} text-right`}
                        style={{ height: ROW_HEIGHT }}
                      >
                        {r ? (
                          <>
                            <span
                              className="font-semibold"
                              style={{ color: g.colorHex }}
                            >
                              {r.nominalMm.toLocaleString('ja-JP')}
                            </span>
                            <span className="text-muted">
                              ({r.actualMm.toLocaleString('ja-JP')})
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td
                        className={`${dataCell} text-center`}
                        style={{ height: ROW_HEIGHT }}
                      >
                        {r ? r.qty : null}
                      </td>
                      <td
                        className={`${dataCell} text-center`}
                        style={{ height: ROW_HEIGHT }}
                      >
                        {r ? r.tateCount ?? '-' : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            )
          })}
        </table>
      </div>
    </div>
  )
}

function AutoWidthInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  minCh,
  maxCh,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  minCh: number
  maxCh: number
  className: string
}) {
  const mirrorText = value || placeholder
  // 幅は「文字数 × ch」では日本語・韓国語などの全角文字に足りず、
  // 隣の「様」「様邸」と重なってしまう。実際に描画した文字幅（下の mirror）で
  // グリッド幅が決まるようにし、ch は最小・最大の目安だけに使う。
  return (
    <span
      className="auto-width-field inline-grid max-w-full"
      style={{ minWidth: `${minCh}ch`, maxWidth: `${maxCh}ch` }}
    >
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 whitespace-pre px-0 py-0 pr-[2px] text-sm"
      >
        {mirrorText}
      </span>
      <input
        type="text"
        size={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`col-start-1 row-start-1 w-full min-w-0 overflow-x-auto ${className}`}
      />
    </span>
  )
}
