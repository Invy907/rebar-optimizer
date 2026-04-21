'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { DrawingSegment, OptimizationRun, Unit } from '@/lib/types/database'
import { getSegmentLabelMap } from '@/lib/segment-labels'
import { optimize, type PieceInput, type OptimizationOutput, type AlgorithmType } from '@/lib/optimizer'
import { OptimizationResultView } from '@/components/optimization-result-view'
import {
  getSegmentBars,
  getSegmentBarsSummary,
  getSegmentColor,
  getSegmentEffectiveLengthMm,
  getSegmentResolvedMarkNumber,
  type SegmentColor,
} from '@/lib/segment-meta'
import {
  compareSegmentColorOrder,
  getSegmentStrokeHex,
} from '@/lib/segment-colors'
import {
  buildUnitCalculationRows,
  type UnitCountRoundingMode,
} from '@/lib/unit-calculations'

export function OptimizeClient({
  projectId,
  segments,
  pastRuns,
  initialFocusSegmentId,
  units = [],
}: {
  projectId: string
  segments: DrawingSegment[]
  pastRuns: OptimizationRun[]
  initialFocusSegmentId?: string | null
  units?: Unit[]
}) {
  const segmentLabelById = getSegmentLabelMap(segments)
  const segmentDrawingIdById = Object.fromEntries(
    segments.map((s) => [s.id, s.drawing_id]),
  )

  const [stockLength, setStockLength] = useState(6000)
  const [algorithm, setAlgorithm] = useState<AlgorithmType>('best-fit')
  const [cuttingLossMm, setCuttingLossMm] = useState(0)
  const [pieceLengthAdjustmentMm, setPieceLengthAdjustmentMm] = useState(-30)
  const [result, setResult] = useState<OptimizationOutput | null>(null)
  const [barSummaryTable, setBarSummaryTable] = useState<BarSummaryRow[] | null>(null)
  // 取引先ルール確認前: 例（18.2->18, 13.65->14）と同じ挙動になるよう round 固定
  const [unitCountRoundingMode] = useState<UnitCountRoundingMode>('round')
  const [customerCompany, setCustomerCompany] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(
    initialFocusSegmentId ?? null,
  )
  const [calculating, setCalculating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const circleInputSummaryGroups = useMemo(
    () => buildCircleInputSummaryGroups(segments, units),
    [segments, units],
  )
  const unitCalculationRows = useMemo(
    () => buildUnitCalculationRows(segments, units, unitCountRoundingMode),
    [segments, unitCountRoundingMode, units],
  )

  function handleCalculate() {
    const rebarSegments = segments.filter((s) => s.bar_type !== 'SPACING')
    const pieces: PieceInput[] = []
    for (const seg of rebarSegments) {
      const baseLen = getSegmentEffectiveLengthMm(seg, units)
      const adjusted = baseLen + (pieceLengthAdjustmentMm || 0)
      if (!Number.isFinite(adjusted) || adjusted <= 0) {
        alert(
          `部材長さ補正の結果、0mm以下になりました。\n長さ: ${baseLen}mm / 補正: ${pieceLengthAdjustmentMm}mm`,
        )
        return
      }
      const bars = getSegmentBars(seg, units)
      for (const b of bars) {
        for (let i = 0; i < b.quantity; i++) {
          pieces.push({
            segmentId: seg.id,
            lengthMm: Math.round(adjusted),
            barType: b.barType,
          })
        }
      }
    }

    if (pieces.length === 0) {
      alert('計算対象の線分データがありません。先に図面上に線分を追加してください。')
      return
    }

    setCalculating(true)
    queueMicrotask(() => {
      const output = optimize(pieces, stockLength, {
        algorithm,
        cuttingLossMm: cuttingLossMm || 0,
      })
      setResult(output)
      setBarSummaryTable(buildBarSummaryTable(pieces))
      setSaved(false)
      setCalculating(false)
    })
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)

    const { data: run, error: runError } = await supabase
      .from('optimization_runs')
      .insert({
        project_id: projectId,
        stock_length_mm: stockLength,
        status: 'completed',
        total_stock_count: result.totalStockCount,
        total_waste_mm: result.totalWasteMm,
        waste_ratio: result.wasteRatio,
      })
      .select()
      .single()

    if (runError || !run) {
      alert('保存に失敗しました: ' + runError?.message)
      setSaving(false)
      return
    }

    // 一括で optimization_results を挿入
    const resultsPayload = result.stocks.map((stock) => ({
      run_id: run.id,
      bar_type: stock.barType,
      stock_index: stock.stockIndex,
      used_length_mm: stock.usedLengthMm,
      waste_mm: stock.wasteMm,
    }))

    const { data: insertedResults, error: resultsError } = await supabase
      .from('optimization_results')
      .insert(resultsPayload)
      .select()

    if (resultsError || !insertedResults) {
      alert('結果行の保存に失敗しました: ' + resultsError?.message)
      setSaving(false)
      return
    }

    // 挿入された結果IDに紐づくピースを一括で挿入
    const piecesPayload = result.stocks.flatMap((stock, index) => {
      const resultRow = insertedResults[index]
      if (!resultRow) return []
      return stock.pieces.map((p) => ({
        result_id: resultRow.id,
        source_segment_id: p.segmentId,
        piece_length_mm: p.lengthMm,
        sequence_no: p.sequenceNo,
      }))
    })

    if (piecesPayload.length > 0) {
      const { error: piecesError } = await supabase
        .from('optimization_result_pieces')
        .insert(piecesPayload)

      if (piecesError) {
        alert('ピース情報の保存に失敗しました: ' + piecesError.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* 入力サマリ */}
      <section className="rounded-lg border border-border bg-white p-5">
        <h2 className="text-base font-semibold mb-3">入力データ</h2>
        {segments.filter((s) => s.bar_type !== 'SPACING').length === 0 ? (
          <p className="text-sm text-muted">線分データがありません。</p>
        ) : (
          <div className="space-y-4">
            <CircleInputSummary groups={circleInputSummaryGroups} />
            <p className="text-sm text-muted">
              合計{' '}
              {segments
                .filter((seg) => seg.bar_type !== 'SPACING')
                .reduce(
                  (s, seg) =>
                    s + getSegmentBars(seg, units).reduce((ss, b) => ss + b.quantity, 0),
                  0,
                )}{' '}
              本の部材
            </p>
          </div>
        )}
      </section>

      {/* 計算設定 */}
      <section className="rounded-lg border border-border bg-white p-5">
        <h2 className="text-base font-semibold mb-3">計算設定</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm text-muted mb-1">
              元材長さ (mm)
            </label>
            <input
              type="number"
              value={stockLength}
              onChange={(e) => setStockLength(parseInt(e.target.value) || 6000)}
              className="w-40 rounded-lg border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">
              配置アルゴリズム
            </label>
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as AlgorithmType)}
              className="w-40 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary bg-white"
            >
              <option value="best-fit">Best Fit（残りが最小になる場所・推奨）</option>
              <option value="first-fit">First Fit（比較用・最初に空く場所）</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">
              1カットあたりの切断損失 (mm)
            </label>
            <input
              type="number"
              min={0}
              value={cuttingLossMm}
              onChange={(e) => setCuttingLossMm(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-40 rounded-lg border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">
              部材長さ補正 (mm)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={pieceLengthAdjustmentMm}
                onChange={(e) =>
                  setPieceLengthAdjustmentMm(parseInt(e.target.value) || 0)
                }
                className="w-40 rounded-lg border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary"
              />
              <span className="text-[11px] text-muted whitespace-nowrap">
                マイナスで短く、プラスで長くします（例: -30）
              </span>
            </div>
          </div>
          {/* ピッチ計算の端数処理は一旦 round 固定 */}
          <button
            onClick={handleCalculate}
            disabled={segments.length === 0 || calculating}
            className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 transition-colors flex items-center gap-2 min-w-[140px] justify-center"
          >
            {calculating ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
                計算中...
              </>
            ) : (
              '計算を実行'
            )}
          </button>
        </div>
      </section>

      {/* 計算中表示 */}
      {calculating && (
        <section className="rounded-lg border border-border bg-white p-8 text-center">
          <div className="flex flex-col items-center gap-3 text-muted">
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm font-medium">切断最適化を計算しています...</p>
            <p className="text-xs">しばらくお待ちください</p>
          </div>
        </section>
      )}

      {/* 結果 */}
      {result && !calculating && (
        <section className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-5">
            <h2 className="text-base font-semibold mb-3">顧客情報</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm text-muted">
                会社名
                <input
                  value={customerCompany}
                  onChange={(e) => setCustomerCompany(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="text-sm text-muted">
                住所
                <input
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="text-sm text-muted">
                顧客名
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">計算結果</h2>
            <button
              onClick={handleSave}
              disabled={saving || saved}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {saved ? '保存済み' : saving ? '保存中...' : '結果を保存'}
            </button>
          </div>
          {barSummaryTable && barSummaryTable.length > 0 && (
            <BarSummarySection
              rows={barSummaryTable}
              adjustmentMm={pieceLengthAdjustmentMm}
            />
          )}

          <OptimizationResultView
            result={result}
            stockLengthMm={stockLength}
            projectId={projectId}
            segmentLabelById={segmentLabelById}
            segmentDrawingIdById={segmentDrawingIdById}
            focusSegmentId={focusSegmentId ?? undefined}
            unitCalculationRows={unitCalculationRows}
            roundingMode={unitCountRoundingMode}
            customerInfo={{
              company: customerCompany,
              address: customerAddress,
              name: customerName,
            }}
          />
        </section>
      )}

      {/* 過去の結果 */}
      {pastRuns.length > 0 && (
        <section className="rounded-lg border border-border bg-white p-5">
          <h2 className="text-base font-semibold mb-3">過去の計算履歴</h2>
          <ul className="divide-y divide-border">
            {pastRuns.map((run) => (
              <li key={run.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-mono">{run.stock_length_mm}mm</span>
                  <span className="text-muted ml-2">
                    {new Date(run.created_at).toLocaleString('ja-JP')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span>{run.total_stock_count}本</span>
                  <span className="text-muted">
                    廃棄率 {((run.waste_ratio ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

interface BarSummaryRow {
  lengthMm: number
  byBarType: Record<string, number>
  total: number
}

function buildBarSummaryTable(pieces: PieceInput[]): BarSummaryRow[] {
  const map = new Map<number, Map<string, number>>()
  for (const p of pieces) {
    let byType = map.get(p.lengthMm)
    if (!byType) {
      byType = new Map()
      map.set(p.lengthMm, byType)
    }
    byType.set(p.barType, (byType.get(p.barType) ?? 0) + 1)
  }
  const allBarTypes = new Set<string>()
  for (const byType of map.values()) {
    for (const bt of byType.keys()) allBarTypes.add(bt)
  }
  const rows: BarSummaryRow[] = []
  for (const [lengthMm, byType] of map.entries()) {
    const obj: Record<string, number> = {}
    let total = 0
    for (const bt of allBarTypes) {
      const qty = byType.get(bt) ?? 0
      obj[bt] = qty
      total += qty
    }
    rows.push({ lengthMm, byBarType: obj, total })
  }
  rows.sort((a, b) => b.lengthMm - a.lengthMm)
  return rows
}

interface CircleSummaryLine {
  lengthMm: number
  color: SegmentColor
  /** ユニット由来のマーク。任意入力のみの線分は null（円番号は表示しない） */
  markNo: number | null
  count: number
}

interface CircleInputSummaryGroup {
  color: SegmentColor
  /** 例: D10×1, D13×4（同一色・同一構成の線分をまとめる） */
  barsSummary: string
  lines: CircleSummaryLine[]
}

const CIRCLED_NUMS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

function circledNumberForSummary(n: number): string {
  const chars = [...CIRCLED_NUMS]
  return n >= 1 && n <= chars.length ? chars[n - 1]! : `(${n})`
}

function buildCircleInputSummaryGroups(
  segments: DrawingSegment[],
  units?: Unit[] | null,
): CircleInputSummaryGroup[] {
  const rebarSegments = segments.filter((s) => s.bar_type !== 'SPACING')
  type AccRow = CircleSummaryLine & { barsSummary: string }
  const countsByKey = new Map<string, AccRow>()

  for (const seg of rebarSegments) {
    const color = getSegmentColor(seg, units)
    const lengthMm = getSegmentEffectiveLengthMm(seg, units)
    const markNo = getSegmentResolvedMarkNumber(seg, units)
    const barsSummary = getSegmentBarsSummary(seg, units)
    const key = `${lengthMm}|${color}|${markNo ?? 'none'}|${barsSummary}`
    const cur =
      countsByKey.get(key) ??
      ({
        lengthMm,
        color,
        markNo,
        barsSummary,
        count: 0,
      } satisfies AccRow)
    cur.count++
    countsByKey.set(key, cur)
  }

  const flat = Array.from(countsByKey.values())
  flat.sort((a, b) => {
    const byColor = compareSegmentColorOrder(a.color, b.color)
    if (byColor !== 0) return byColor
    const byBars = a.barsSummary.localeCompare(b.barsSummary, 'ja')
    if (byBars !== 0) return byBars
    if (b.lengthMm !== a.lengthMm) return b.lengthMm - a.lengthMm
    const aM = a.markNo ?? Number.MAX_SAFE_INTEGER
    const bM = b.markNo ?? Number.MAX_SAFE_INTEGER
    return aM - bM
  })

  const groupKeyOrder: string[] = []
  const groupMap = new Map<string, CircleInputSummaryGroup>()
  for (const r of flat) {
    const gk = `${r.color}::${r.barsSummary}`
    if (!groupMap.has(gk)) {
      groupKeyOrder.push(gk)
      groupMap.set(gk, {
        color: r.color,
        barsSummary: r.barsSummary,
        lines: [],
      })
    }
    const g = groupMap.get(gk)!
    g.lines.push({
      lengthMm: r.lengthMm,
      color: r.color,
      markNo: r.markNo,
      count: r.count,
    })
  }

  return groupKeyOrder.map((k) => groupMap.get(k)!)
}

function CircleInputSummary({
  groups,
}: {
  groups: CircleInputSummaryGroup[]
}) {
  if (groups.length === 0) return null
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 px-3 py-3">
      <p className="text-xs font-medium text-muted">種類別サマリ（色・配筋・長さごとの本数）</p>
      <div className="space-y-3">
        {groups.map((g) => {
          const hex = getSegmentStrokeHex(g.color, false)
          const barsLabel =
            g.barsSummary && g.barsSummary !== '-' ? g.barsSummary : '（鉄筋未設定）'
          return (
            <div key={`${g.color}::${g.barsSummary}`} className="space-y-1">
              <p
                className="font-mono text-sm font-semibold leading-snug"
                style={{ color: hex }}
              >
                {barsLabel}
              </p>
              <ul className="space-y-1 pl-0">
                {g.lines.map((r) => {
                  const markPrefix =
                    r.markNo != null ? circledNumberForSummary(r.markNo) : ''
                  return (
                    <li
                      key={`${r.lengthMm}|${r.color}|${r.markNo ?? 'none'}`}
                      className="font-mono text-[16px] font-semibold leading-snug tabular-nums"
                      style={{ color: hex }}
                    >
                      {markPrefix}
                      {r.lengthMm.toLocaleString('ja-JP')} × {r.count}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BarSummarySection({
  rows,
  adjustmentMm,
}: {
  rows: BarSummaryRow[]
  adjustmentMm: number
}) {
  const allBarTypes = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r.byBarType))),
  ).sort()
  const totals: Record<string, number> = {}
  let grandTotal = 0
  for (const bt of allBarTypes) totals[bt] = 0
  for (const row of rows) {
    for (const bt of allBarTypes) {
      totals[bt] += row.byBarType[bt] ?? 0
    }
    grandTotal += row.total
  }

  return (
    <div className="rounded-lg border-2 border-primary bg-white p-5">
      <h3 className="text-base font-semibold mb-1">鉄筋種類別の必要本数</h3>
      {adjustmentMm !== 0 && (
        <p className="text-xs text-muted mb-3">
          部材長さ補正: {adjustmentMm > 0 ? '+' : ''}
          {adjustmentMm}mm 適用済み
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-border text-left">
              <th className="pb-2 pr-4 font-semibold">長さ (mm)</th>
              {allBarTypes.map((bt) => (
                <th key={bt} className="pb-2 px-3 font-semibold text-center">
                  {bt}
                </th>
              ))}
              <th className="pb-2 pl-3 font-semibold text-center">合計</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.lengthMm}>
                <td className="py-2 pr-4 font-mono font-medium">
                  {row.lengthMm.toLocaleString()}
                </td>
                {allBarTypes.map((bt) => (
                  <td
                    key={bt}
                    className="py-2 px-3 text-center font-mono"
                  >
                    {row.byBarType[bt] || '-'}
                  </td>
                ))}
                <td className="py-2 pl-3 text-center font-mono font-medium">
                  {row.total}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="pt-2 pr-4">合計</td>
              {allBarTypes.map((bt) => (
                <td key={bt} className="pt-2 px-3 text-center font-mono">
                  {totals[bt]}
                </td>
              ))}
              <td className="pt-2 pl-3 text-center font-mono">{grandTotal}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
