'use client'

import { useCallback } from 'react'
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
  void stockLengthMm
  void projectId
  void segmentDrawingIdById
  void focusSegmentId
  void unitCalculationRows
  void roundingMode

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
            <div>
              <span className="text-muted">会社名:</span> {customerInfo.company || '-'}
            </div>
            <div>
              <span className="text-muted">住所:</span> {customerInfo.address || '-'}
            </div>
            <div>
              <span className="text-muted">顧客名:</span> {customerInfo.name || '-'}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
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
  )
}
