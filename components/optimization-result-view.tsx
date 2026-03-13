'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { OptimizationOutput } from '@/lib/optimizer'

export function OptimizationResultView({
  result,
  stockLengthMm,
  projectId,
  segmentLabelById,
  segmentDrawingIdById,
  focusSegmentId,
}: {
  result: OptimizationOutput
  stockLengthMm: number
  projectId: string
  segmentLabelById: Record<string, string>
  segmentDrawingIdById: Record<string, string>
  focusSegmentId?: string | null
}) {
  const router = useRouter()

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
      {/* サマリカード + アクション */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 flex-1">
          <SummaryCard
            label="必要本数合計"
            value={`${result.totalStockCount}本`}
          />
          <SummaryCard
            label="元材長さ"
            value={`${stockLengthMm.toLocaleString()}mm`}
          />
          <SummaryCard
            label="廃棄長さ合計"
            value={`${result.totalWasteMm.toLocaleString()}mm`}
          />
          <SummaryCard
            label="全体廃棄率"
            value={`${(result.wasteRatio * 100).toFixed(1)}%`}
            highlight={result.wasteRatio > 0.1}
          />
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

      {/* 鉄筋種別ごとのサマリ */}
      <div className="rounded-lg border border-border bg-white p-4">
        <h3 className="text-sm font-semibold mb-2">鉄筋種別ごとのサマリ</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="pb-2 font-medium">鉄筋種別</th>
              <th className="pb-2 font-medium">必要本数</th>
              <th className="pb-2 font-medium">使用長さ</th>
              <th className="pb-2 font-medium">廃棄長さ</th>
              <th className="pb-2 font-medium">廃棄率</th>
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

      {/* 本ごとの詳細配置 */}
      <div className="rounded-lg border border-border bg-white p-4">
        <h3 className="text-sm font-semibold mb-3">本ごとの切断配置</h3>
        <div className="space-y-3">
          {result.stocks.map((stock, idx) => {
            const usedRatio = stock.usedLengthMm / stockLengthMm
            return (
              <div key={idx} className="rounded border border-border p-3">
                <div className="flex items-center justify-between text-xs text-muted mb-2">
                  <span className="font-medium text-foreground">
                    {stock.barType} #{stock.stockIndex}
                  </span>
                  <span>
                    使用 {stock.usedLengthMm.toLocaleString()}mm /
                    残り {stock.wasteMm.toLocaleString()}mm
                  </span>
                </div>
                {/* 視覚的バー */}
                <div className="h-8 rounded bg-gray-100 flex overflow-hidden">
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
                        className={`${colors[pIdx % colors.length]} flex items-center justify-center text-white text-xs font-mono border-r border-white/30 ${
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
                      className="bg-gray-200 flex items-center justify-center text-xs text-muted font-mono"
                      style={{
                        width: `${((stock.wasteMm / stockLengthMm) * 100)}%`,
                      }}
                    >
                      {stock.wasteMm > stockLengthMm * 0.05
                        ? `${stock.wasteMm}`
                        : ''}
                    </div>
                  )}
                </div>
                {/* ピース一覧 */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {stock.pieces.map((piece, pIdx) => {
                    const label = segmentLabelById[piece.segmentId] ?? '-'
                    const isFocused = focusSegmentId === piece.segmentId
                    const drawingId = segmentDrawingIdById[piece.segmentId]
                    return (
                      <span
                        key={pIdx}
                        className={`rounded px-1.5 py-0.5 text-xs font-mono cursor-pointer ${
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
            )
          })}
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
      <p
        className={`mt-1 text-lg font-bold font-mono ${
          highlight ? 'text-danger' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}
