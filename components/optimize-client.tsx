// components/optimize-client.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawingSegment, Unit } from '@/lib/types/database'
import { getSegmentLabelMap } from '@/lib/segment-labels'
import { optimize, type PieceInput, type OptimizationOutput } from '@/lib/optimizer'
import { CustomerDatePicker } from '@/components/customer-date-picker'
import { CustomerDateTimePicker } from '@/components/customer-datetime-picker'
import { OptimizationResultView } from '@/components/optimization-result-view'
import { ManufactureListView } from '@/components/manufacture-list-view'
import {
  DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM,
  pieceAdjustmentStorageKey,
} from '@/lib/optimize-settings'
import {
  getSegmentBars,
  getSegmentEffectiveLengthMm,
} from '@/lib/segment-meta'
import {
  buildUnitCalculationRows,
  type UnitCountRoundingMode,
} from '@/lib/unit-calculations'

const DEFAULT_STOCK_LENGTH_MM = 6000

export function OptimizeClient({
  projectId,
  segments,
  initialFocusSegmentId,
  initialPieceLengthAdjustmentMm = DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM,
  autoRun = false,
  units = [],
}: {
  projectId: string
  segments: DrawingSegment[]
  initialFocusSegmentId?: string | null
  initialPieceLengthAdjustmentMm?: number
  autoRun?: boolean
  units?: Unit[]
}) {
  const segmentLabelById = getSegmentLabelMap(segments)
  const segmentDrawingIdById = Object.fromEntries(
    segments.map((s) => [s.id, s.drawing_id]),
  )

  const [pieceLengthAdjustmentMm] = useState(initialPieceLengthAdjustmentMm)
  const [result, setResult] = useState<OptimizationOutput | null>(null)
  const [barSummaryTable, setBarSummaryTable] = useState<BarSummaryRow[] | null>(null)
  // 取引先ルール確認前: 例（18.2->18, 13.65->14）と同じ挙動になるよう round 固定
  const [unitCountRoundingMode] = useState<UnitCountRoundingMode>('round')
  const [customerCompany, setCustomerCompany] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerName, setCustomerName] = useState('')
  /** 積み込み日（日付のみ, ISO YYYY-MM-DD） */
  const [customerDate, setCustomerDate] = useState('')
  /** 到着日（日付＋時刻, datetime-local の YYYY-MM-DDTHH:mm） */
  const [customerArrival, setCustomerArrival] = useState('')
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(
    initialFocusSegmentId ?? null,
  )
  const [calculating, setCalculating] = useState(false)
  const autoRunStartedRef = useRef(false)

  const adjustmentStorageKey = useMemo(
    () => pieceAdjustmentStorageKey(projectId),
    [projectId],
  )

  const unitCalculationRows = useMemo(
    () => buildUnitCalculationRows(segments, units, unitCountRoundingMode),
    [segments, unitCountRoundingMode, units],
  )

  const customerInfoStorageKey = useMemo(
    () => `optimize-customer-info:${projectId}`,
    [projectId],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(customerInfoStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        company?: string
        address?: string
        name?: string
        date?: string
        arrival?: string
      }
      setCustomerCompany(parsed.company ?? '')
      setCustomerAddress(parsed.address ?? '')
      setCustomerName(parsed.name ?? '')
      setCustomerDate(parsed.date ?? '')
      setCustomerArrival(parsed.arrival ?? '')
    } catch {
      // Ignore malformed local data and continue with empty fields.
    }
  }, [customerInfoStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        customerInfoStorageKey,
        JSON.stringify({
          company: customerCompany,
          address: customerAddress,
          name: customerName,
          date: customerDate,
          arrival: customerArrival,
        }),
      )
    } catch {
      // Ignore storage write errors so the form stays usable.
    }
  }, [
    customerAddress,
    customerArrival,
    customerCompany,
    customerDate,
    customerInfoStorageKey,
    customerName,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        adjustmentStorageKey,
        String(pieceLengthAdjustmentMm),
      )
    } catch {
      // Ignore storage write errors.
    }
  }, [adjustmentStorageKey, pieceLengthAdjustmentMm])

  useEffect(() => {
    if (!autoRun || autoRunStartedRef.current) return
    autoRunStartedRef.current = true
    setCalculating(true)
    handleCalculate()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount when autoRun
  }, [autoRun])

  function handleCalculate() {
    const rebarSegments = segments.filter((s) => s.bar_type !== 'SPACING')
    const pieces: PieceInput[] = []
    for (const seg of rebarSegments) {
      const baseLen = getSegmentEffectiveLengthMm(seg, units)
      const adjusted = baseLen + (pieceLengthAdjustmentMm || 0)
      if (!Number.isFinite(adjusted) || adjusted <= 0) {
        setCalculating(false)
        alert(
          `鉄筋長さ補正値の結果、0mm以下になりました。\n長さ: ${baseLen}mm / 補正: ${pieceLengthAdjustmentMm}mm`,
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
      setCalculating(false)
      alert('計算対象の線分データがありません。先に図面上に線分を追加してください。')
      return
    }

    setCalculating(true)
    queueMicrotask(() => {
      const output = optimize(pieces, DEFAULT_STOCK_LENGTH_MM, {
        algorithm: 'best-fit',
      })
      setResult(output)
      setBarSummaryTable(buildBarSummaryTable(pieces))
      setCalculating(false)
    })
  }

  return (
    <div className="optimize-print-root space-y-6">
      <section className="optimize-print-customer rounded-lg border border-border bg-white p-5">
        <h2 className="text-base font-semibold mb-3">顧客情報</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">
            <span className="block text-xs font-medium tracking-wide text-muted/80">顧客名</span>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground outline-none placeholder:text-muted/60 focus:border-primary print:border-transparent print:bg-transparent print:px-0"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium tracking-wide text-muted/80">会社名</span>
            <input
              value={customerCompany}
              onChange={(e) => setCustomerCompany(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground outline-none placeholder:text-muted/60 focus:border-primary print:border-transparent print:bg-transparent print:px-0"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium tracking-wide text-muted/80">現場住所</span>
            <input
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground outline-none placeholder:text-muted/60 focus:border-primary print:border-transparent print:bg-transparent print:px-0"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium tracking-wide text-muted/80">積み込み日</span>
            <CustomerDatePicker
              value={customerDate}
              onChange={setCustomerDate}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium tracking-wide text-muted/80">到着日（時刻あり）</span>
            <CustomerDateTimePicker
              value={customerArrival}
              onChange={setCustomerArrival}
            />
          </label>
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

      {/* 製作図リスト（新レイアウト・試験導入。計算実行後に表示。既存の計算結果はそのまま残す） */}
      {result && !calculating && (
        <section className="optimize-print-manufacture rounded-lg border border-border bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">製作図リスト</h2>
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 print:hidden">
              試験導入
            </span>
          </div>
          <ManufactureListView
            segments={segments}
            units={units}
            adjustmentMm={pieceLengthAdjustmentMm}
            customerCompany={customerCompany}
            customerName={customerName}
            customerAddress={customerAddress}
            customerDate={customerDate}
            customerArrival={customerArrival}
          />
        </section>
      )}

      {/* 結果 */}
      {result && !calculating && (
        <section className="optimize-print-results space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">計算結果</h2>
          </div>
          {barSummaryTable && barSummaryTable.length > 0 && (
            <BarSummarySection
              rows={barSummaryTable}
              adjustmentMm={pieceLengthAdjustmentMm}
            />
          )}

          <OptimizationResultView
            result={result}
            stockLengthMm={DEFAULT_STOCK_LENGTH_MM}
            projectId={projectId}
            segmentLabelById={segmentLabelById}
            segmentDrawingIdById={segmentDrawingIdById}
            focusSegmentId={focusSegmentId ?? undefined}
            unitCalculationRows={unitCalculationRows}
            roundingMode={unitCountRoundingMode}
          />
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

function compareBarTypeDesc(a: string, b: string): number {
  const parse = (value: string) => {
    const match = value.match(/^D(\d+)$/i)
    return match ? Number.parseInt(match[1] ?? '', 10) : null
  }
  const an = parse(a)
  const bn = parse(b)
  if (an != null && bn != null && an !== bn) return bn - an
  if (an != null && bn == null) return -1
  if (an == null && bn != null) return 1
  return a.localeCompare(b)
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

function BarSummarySection({
  rows,
  adjustmentMm,
}: {
  rows: BarSummaryRow[]
  adjustmentMm: number
}) {
  const allBarTypes = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r.byBarType))),
  ).sort(compareBarTypeDesc)
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
          鉄筋長さ補正値: {adjustmentMm > 0 ? '+' : ''}
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
