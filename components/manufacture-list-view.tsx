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

/** datetime-local (YYYY-MM-DDTHH:mm) を表示用 "YYYY/MM/DD HH:mm" に整形 */
function formatArrivalDateTime(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return value
  return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}`
}

export function ManufactureListView({
  segments,
  units,
  adjustmentMm,
  customerCompany,
  customerName,
  customerAddress,
  customerDate,
  customerArrival,
}: {
  segments: DrawingSegment[]
  units: Unit[]
  adjustmentMm: number
  customerCompany?: string
  customerName?: string
  customerAddress?: string
  customerDate?: string
  customerArrival?: string
}) {
  const groups = useMemo(
    () => buildManufactureGroups(segments, units, adjustmentMm),
    [segments, units, adjustmentMm],
  )

  const hasCustomer =
    !!customerCompany?.trim() ||
    !!customerName?.trim() ||
    !!customerAddress?.trim() ||
    !!customerDate?.trim() ||
    !!customerArrival?.trim()

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
      {/* 顧客情報ヘッダ（結果出力情報 / フィードバック #9） */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-1 text-sm">
          {customerName?.trim() && (
            <span className="font-semibold text-foreground">
              {customerName.trim()} 様
            </span>
          )}
          {customerCompany?.trim() && (
            <span className="text-foreground">{customerCompany.trim()}</span>
          )}
          {customerAddress?.trim() && (
            <span className="text-muted">{customerAddress.trim()}</span>
          )}
          {customerDate?.trim() && (
            <span className="text-muted">積み込み日: {customerDate.trim()}</span>
          )}
          {customerArrival?.trim() && (
            <span className="text-muted">
              到着日: {formatArrivalDateTime(customerArrival.trim())}
            </span>
          )}
          {!hasCustomer && (
            <span className="text-xs text-muted">
              （顧客情報は「顧客情報」欄で入力すると上部に表示されます）
            </span>
          )}
        </div>
        <span className="text-xs text-muted">単位: mm</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${headCell} w-80`}>製作図</th>
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
                      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-1.5">
                        {g.unit ? (
                          <div className="w-full flex-1" style={{ minHeight: 220 }}>
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

      <p className="text-[11px] leading-relaxed text-muted print:hidden">
        ※ 呼称 = 図面上の長さ、実寸 = 呼称 + 鉄筋長さ補正値。数量は同一長さの部材本数。
      </p>
    </div>
  )
}
