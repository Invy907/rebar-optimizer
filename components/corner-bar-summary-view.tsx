'use client'

import { useMemo } from 'react'
import {
  aggregateAdditionalRebars,
  type AdditionalRebarGroup,
  type AdditionalRebarPlacementLike,
  type AdditionalRebarSpecRow,
} from '@/lib/corner-bar-summary'
import { measurementTypeLabel } from '@/lib/corner-bar-presets'

/** コーナー筋・添え筋は資料どおり径別の本数を主役にし、それ以外は仕様の明細を主役にする */
function isDetailPrimary(category: string): boolean {
  return category !== 'CORNER' && category !== 'SOE'
}

function formatMm(value: number | null): string {
  return value == null ? '—' : `${value.toLocaleString('ja-JP')}mm`
}

/** グループ内の全ての鉄筋が同じ寸法基準なら、資料の「※芯々」と同じ見出し注記を出す */
function groupUniformMeasurementLabel(rows: AdditionalRebarSpecRow[]): string | null {
  if (rows.length === 0) return null
  const first = rows[0]!.uniformMeasurementType
  if (first == null) return null
  return rows.every((r) => r.uniformMeasurementType === first)
    ? measurementTypeLabel(first)
    : null
}

function measurementCellText(row: AdditionalRebarSpecRow): string {
  if (row.uniformMeasurementType) return measurementTypeLabel(row.uniformMeasurementType)
  return row.segments.some((s) => s.measurementType != null) ? '混在' : '—'
}

const headCell =
  'border border-slate-400 bg-slate-50 px-3 py-1.5 text-center text-sm font-semibold whitespace-nowrap'
const dataCell = 'border border-slate-400 px-3 py-1.5 tabular-nums'

/** 資料の「コーナー D13 76」に相当する、径別の本数 */
function DiameterTotals({ group }: { group: AdditionalRebarGroup }) {
  return (
    <table className="border-collapse">
      <tbody>
        {group.diameterTotals.map((d) => (
          <tr key={d.diameter}>
            <th
              scope="row"
              className="border border-slate-400 bg-slate-50 px-4 py-2 text-left text-xl font-semibold"
            >
              {d.diameter}
            </th>
            <td className="border border-slate-400 px-4 py-2 text-right text-xl font-bold tabular-nums">
              {d.quantity.toLocaleString('ja-JP')}
              <span className="ml-1 text-base font-normal">本</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 各辺寸法・寸法基準・加工長つきの明細。寸法基準はセルとツールチップの両方で確認できる */
function SpecTable({
  rows,
  showShape,
  showKakouchou,
}: {
  rows: AdditionalRebarSpecRow[]
  showShape: boolean
  showKakouchou: boolean
}) {
  return (
    <table className="border-collapse text-base">
      <thead>
        <tr>
          {showShape && <th className={headCell}>形状</th>}
          <th className={headCell}>鉄筋径</th>
          <th className={headCell}>各辺寸法 (mm)</th>
          <th className={headCell}>寸法基準</th>
          {showKakouchou && <th className={headCell}>加工長（参考）</th>}
          <th className={headCell}>本数</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {showShape && (
              <td className={`${dataCell} whitespace-nowrap`}>{row.shapeLabel}</td>
            )}
            <td className={`${dataCell} font-semibold whitespace-nowrap`}>{row.diameter}</td>
            <td className={dataCell} title={row.dimsDetailText || undefined}>
              {row.dimsText || '—'}
            </td>
            <td className={`${dataCell} whitespace-nowrap`} title={row.dimsDetailText || undefined}>
              {measurementCellText(row)}
            </td>
            {showKakouchou && (
              <td className={`${dataCell} text-right whitespace-nowrap`}>
                {formatMm(row.kakouchouMm)}
              </td>
            )}
            <td className={`${dataCell} text-right font-bold whitespace-nowrap`}>
              {row.quantity.toLocaleString('ja-JP')} 本
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function GroupSection({ group }: { group: AdditionalRebarGroup }) {
  const uniformLabel = groupUniformMeasurementLabel(group.specRows)
  const detailPrimary = isDetailPrimary(group.category)

  return (
    <section className="corner-summary-section rounded-lg border border-border bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-border pb-2">
        <h2 className="text-xl font-bold">{group.label}</h2>
        {uniformLabel && (
          <span className="text-base text-muted">※{uniformLabel}</span>
        )}
        <span className="ml-auto text-base text-muted">
          計 <span className="font-semibold text-foreground">{group.totalQuantity.toLocaleString('ja-JP')}</span> 本
        </span>
      </div>

      {detailPrimary ? (
        <div className="space-y-4">
          <SpecTable rows={group.specRows} showShape showKakouchou />
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-muted">鉄筋径別 合計</h3>
            <DiameterTotals group={group} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <DiameterTotals group={group} />
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-muted">内訳（寸法別）</h3>
            <SpecTable rows={group.specRows} showShape={false} showKakouchou />
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * 付加筋 集計結果の本体。
 *
 * 切断最適化の結果ページの末尾に差し込んで使うので、戻るリンクや印刷ボタンは
 * 持たない（ページ側のものをそのまま使う）。
 */
export function CornerBarSummarySections({
  placements,
}: {
  placements: AdditionalRebarPlacementLike[]
}) {
  const summary = useMemo(() => aggregateAdditionalRebars(placements), [placements])

  if (summary.groups.length === 0) {
    return (
      <p className="text-sm text-muted">付加筋がまだ配置されていません。</p>
    )
  }

  return (
    <div className="corner-summary-print-root space-y-5">
      {summary.groups.map((group) => (
        <GroupSection key={group.category} group={group} />
      ))}

      <p className="text-xs leading-relaxed text-muted">
        加工長は各辺の合計から曲げ 1 ヶ所あたり 20mm を引いた参考値です。寸法が未入力の辺があるものは「—」と表示します。
        各辺寸法にカーソルを合わせると、辺ごとの寸法基準（芯々 / 内々 / 外々）を確認できます。
      </p>
    </div>
  )
}
