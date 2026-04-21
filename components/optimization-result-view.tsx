'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { OptimizationOutput } from '@/lib/optimizer'
import type { UnitCalculationRow, UnitCountRoundingMode } from '@/lib/unit-calculations'

export function OptimizationResultView({
  result,
  stockLengthMm,
  projectId,
  segmentLabelById,
  segmentDrawingIdById,
  focusSegmentId,
  unitCalculationRows,
  roundingMode,
  customerInfo,
}: {
  result: OptimizationOutput
  stockLengthMm: number
  projectId: string
  segmentLabelById: Record<string, string>
  segmentDrawingIdById: Record<string, string>
  focusSegmentId?: string | null
  unitCalculationRows: UnitCalculationRow[]
  roundingMode: UnitCountRoundingMode
  customerInfo: {
    company: string
    address: string
    name: string
  }
}) {
  const router = useRouter()
  const totalUnitCount = unitCalculationRows.reduce((sum, row) => sum + row.computedCount, 0)
  const totalIntervalTimesCount = unitCalculationRows.reduce(
    (sum, row) => sum + row.intervalTimesCount,
    0,
  )

  const handleExportCsv = useCallback(() => {
    const escapeCsvField = (value: string): string => {
      const needsQuote = /[",\n\r]/.test(value)
      const escaped = value.replace(/"/g, '""')
      return needsQuote ? `"${escaped}"` : escaped
    }

    const lines: string[] = []
    lines.push(
      [
        'bar_type',
        'stock_index',
        'piece_seq',
        'segment_label',
        'segment_id',
        'length_mm',
        'stock_used_mm',
        'stock_waste_mm',
      ].join(','),
    )
    for (const stock of result.stocks) {
      stock.pieces.forEach((piece) => {
        const label = segmentLabelById[piece.segmentId] ?? ''
        const row = [
          stock.barType,
          String(stock.stockIndex),
          String(piece.sequenceNo),
          label,
          piece.segmentId,
          String(piece.lengthMm),
          String(stock.usedLengthMm),
          String(stock.wasteMm),
        ].map(escapeCsvField)
        lines.push(row.join(','))
      })
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rebar_optimization.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [result, segmentLabelById])

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  return (
    <div className="space-y-4">
      {(customerInfo.company || customerInfo.address || customerInfo.name) && (
        <div className="rounded-lg border border-border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">顧客情報</h3>
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <div><span className="text-muted">会社名:</span> {customerInfo.company || '-'}</div>
            <div><span className="text-muted">住所:</span> {customerInfo.address || '-'}</div>
            <div><span className="text-muted">顧客名:</span> {customerInfo.name || '-'}</div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <SummaryCard label="使用母材数" value={`${result.totalStockCount}本`} />
          <SummaryCard label="母材長さ" value={`${stockLengthMm.toLocaleString()}mm`} />
          <SummaryCard label="端材合計" value={`${result.totalWasteMm.toLocaleString()}mm`} />
          <SummaryCard
            label="端材率"
            value={`${(result.wasteRatio * 100).toFixed(1)}%`}
            highlight={result.wasteRatio > 0.1}
          />
          <SummaryCard label="単面計算総数" value={`${totalUnitCount}`} />
          <SummaryCard label="間隔長 × 総数" value={totalIntervalTimesCount.toLocaleString()} />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
          >
            CSV出力
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
          >
            印刷
          </button>
        </div>
      </div>

      {unitCalculationRows.length > 0 && (
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">単面別計算</h3>
              <p className="text-xs text-muted">
                ピッチ端数処理: {roundingMode === 'round' ? '四捨五入（仮）' : roundingMode === 'floor' ? '切り捨て' : '切り上げ'}
              </p>
            </div>
            <div className="text-right text-sm font-mono">
              <div>総合計 {totalUnitCount}</div>
              <div>{totalIntervalTimesCount.toLocaleString()}</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="pb-2 font-medium">単面</th>
                  <th className="pb-2 font-medium">長さ</th>
                  <th className="pb-2 font-medium">ピッチ</th>
                  <th className="pb-2 font-medium">鉄筋数</th>
                  <th className="pb-2 font-medium">計算数</th>
                  <th className="pb-2 font-medium">間隔長</th>
                  <th className="pb-2 font-medium">間隔長 × 数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {unitCalculationRows.map((row) => (
                  <tr key={row.key}>
                    <td className="py-2">
                      <div className="font-medium">{row.unitName}</div>
                      <div className="text-xs text-muted">{row.unitCode ?? row.formulaText}</div>
                    </td>
                    <td className="py-2 font-mono">{row.lengthMm.toLocaleString()}mm</td>
                    <td className="py-2 font-mono">{row.pitchMm != null ? `@${row.pitchMm}` : '-'}</td>
                    <td className="py-2 font-mono">{row.barCount}</td>
                    <td className="py-2 font-mono">{row.computedCount}</td>
                    <td className="py-2 font-mono">{row.intervalLengthMm.toLocaleString()}</td>
                    <td className="py-2 font-mono">
                      {row.intervalLengthMm.toLocaleString()} × {row.computedCount} = {row.intervalTimesCount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">鉄筋種別ごとのサマリー</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="pb-2 font-medium">鉄筋種別</th>
              <th className="pb-2 font-medium">使用母材数</th>
              <th className="pb-2 font-medium">使用長さ</th>
              <th className="pb-2 font-medium">端材長さ</th>
              <th className="pb-2 font-medium">端材率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.entries(result.byBarType).map(([barType, data]) => (
              <tr key={barType}>
                <td className="py-2 font-mono font-medium">{barType}</td>
                <td className="py-2">{data.stockCount}本</td>
                <td className="py-2 font-mono">{data.totalUsed.toLocaleString()}mm</td>
                <td className="py-2 font-mono">{data.totalWaste.toLocaleString()}mm</td>
                <td className="py-2">{(data.wasteRatio * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">母材ごとの配置結果</h3>
        <div className="space-y-3">
          {result.stocks.map((stock, idx) => (
            <div key={idx} className="rounded border border-border p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span className="font-medium text-foreground">
                  {stock.barType} #{stock.stockIndex}
                </span>
                <span>
                  使用 {stock.usedLengthMm.toLocaleString()}mm / 余り {stock.wasteMm.toLocaleString()}mm
                </span>
              </div>
              <div className="flex h-8 overflow-hidden rounded bg-gray-100">
                {stock.pieces.map((piece, pIdx) => {
                  const width = (piece.lengthMm / stockLengthMm) * 100
                  const label = segmentLabelById[piece.segmentId] ?? '-'
                  const isFocused = focusSegmentId === piece.segmentId
                  const colors = [
                    'bg-blue-500',
                    'bg-emerald-500',
                    'bg-amber-500',
                    'bg-rose-500',
                    'bg-violet-500',
                    'bg-cyan-500',
                  ]
                  return (
                    <div
                      key={pIdx}
                      className={`${colors[pIdx % colors.length]} flex items-center justify-center border-r border-white/30 text-xs font-mono text-white ${
                        isFocused ? 'ring-2 ring-offset-1 ring-yellow-300' : ''
                      }`}
                      style={{ width: `${width}%` }}
                      title={`${label}: ${piece.lengthMm}mm`}
                    >
                      {width > 8 ? `${piece.lengthMm}` : ''}
                    </div>
                  )
                })}
                {stock.wasteMm > 0 && (
                  <div
                    className="flex items-center justify-center bg-gray-200 text-xs font-mono text-muted"
                    style={{
                      width: `${((stock.wasteMm / stockLengthMm) * 100)}%`,
                    }}
                  >
                    {stock.wasteMm > stockLengthMm * 0.05 ? `${stock.wasteMm}` : ''}
                  </div>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {stock.pieces.map((piece, pIdx) => {
                  const label = segmentLabelById[piece.segmentId] ?? '-'
                  const isFocused = focusSegmentId === piece.segmentId
                  const drawingId = segmentDrawingIdById[piece.segmentId]
                  return (
                    <span
                      key={pIdx}
                      className={`cursor-pointer rounded px-1.5 py-0.5 text-xs font-mono ${
                        isFocused ? 'bg-primary text-white' : 'bg-gray-100'
                      }`}
                      title={label}
                      onClick={() => {
                        if (!drawingId) return
                        router.push(
                          `/projects/${projectId}/drawings/${drawingId}?segmentId=${piece.segmentId}`,
                        )
                      }}
                    >
                      {label} {piece.lengthMm}mm
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${highlight ? 'text-danger' : ''}`}>
        {value}
      </p>
    </div>
  )
}
