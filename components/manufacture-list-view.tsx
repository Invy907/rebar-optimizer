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
}

type ManufactureGroup = {
  key: string
  unit: Unit | null
  unitName: string
  color: SegmentColor
  colorHex: string
  rows: ManufactureRow[]
}

function isPersistedUnitId(id: string): boolean {
  return !id.startsWith('mock-') && !id.startsWith('local-')
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
      acc.byLength.set(nominalMm, {
        key: `${groupKey}:${nominalMm}`,
        nominalMm,
        actualMm: nominalMm + (adjustmentMm || 0),
        qty: 1,
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

  const cell = 'border border-slate-400 px-2 py-1.5 align-middle'
  const headCell =
    'border border-slate-400 px-2 py-1.5 text-center text-xs font-semibold bg-slate-50'

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-base font-semibold">製作図リスト</h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <label className="inline-flex min-w-0 max-w-full items-center gap-1">
              <AutoWidthInput
                value={customerCompany}
                onChange={onCustomerCompanyChange}
                placeholder="会社名"
                ariaLabel="会社名"
                minCh={8}
                maxCh={28}
                className={`${plainTextInputClass} font-semibold text-foreground`}
              />
              <span className="shrink-0 font-semibold text-foreground">様</span>
            </label>
            <label className="inline-flex min-w-0 max-w-full items-center gap-1">
              <AutoWidthInput
                value={customerName}
                onChange={onCustomerNameChange}
                placeholder="顧客名"
                ariaLabel="顧客名"
                minCh={6}
                maxCh={24}
                className={`${plainTextInputClass} font-semibold text-foreground`}
              />
              <span className="shrink-0 font-semibold text-foreground">様邸</span>
            </label>
            <label className="inline-flex min-w-0 max-w-full items-center gap-1">
              <AutoWidthInput
                value={customerAddress}
                onChange={onCustomerAddressChange}
                placeholder="現場住所"
                ariaLabel="現場住所"
                minCh={6}
                maxCh={32}
                className={`${plainTextInputClass} text-foreground`}
              />
            </label>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
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
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${headCell} w-96`}>製作図</th>
              <th className={`${headCell} w-48`}>長さ 呼称(実寸)</th>
              <th className={`${headCell} w-20`}>数量</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) =>
              g.rows.map((r, idx) => (
                <tr key={r.key} className="break-inside-avoid">
                  {idx === 0 && (
                    <td
                      className={`${cell} p-2 text-center`}
                      rowSpan={g.rows.length}
                    >
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        {g.unit ? (
                          <div className="w-full" style={{ height: 230 }}>
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
                        <span className="shrink-0 text-[11px] font-semibold leading-tight text-slate-700">
                          {g.unitName}
                        </span>
                      </div>
                    </td>
                  )}
                  <td className={`${cell} text-right font-mono tabular-nums`}>
                    <span className="font-semibold" style={{ color: g.colorHex }}>
                      {r.nominalMm.toLocaleString('ja-JP')}
                    </span>
                    <span className="text-muted">
                      ({r.actualMm.toLocaleString('ja-JP')})
                    </span>
                  </td>
                  <td className={`${cell} text-center font-mono tabular-nums`}>
                    {r.qty}
                  </td>
                </tr>
              )),
            )}
          </tbody>
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
  const widthCh = Math.min(Math.max(mirrorText.length, minCh), maxCh)
  const sizingText =
    mirrorText.length > maxCh ? mirrorText.slice(0, maxCh) : mirrorText

  return (
    <span
      className="inline-grid min-w-0 shrink overflow-hidden"
      style={{ width: `${widthCh}ch`, maxWidth: `${maxCh}ch` }}
    >
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 whitespace-nowrap px-0 py-0 text-sm"
      >
        {sizingText}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`col-start-1 row-start-1 w-full min-w-0 overflow-x-auto ${className}`}
      />
    </span>
  )
}
