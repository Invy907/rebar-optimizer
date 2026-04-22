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
  void segmentLabelById
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
    lines.push(['item', 'value'].join(','))
    lines.push(['total_stock_count', String(result.totalStockCount)].map(escapeCsvField).join(','))
    lines.push(['total_waste_mm', String(result.totalWasteMm)].map(escapeCsvField).join(','))
    lines.push(['waste_ratio', String(result.wasteRatio)].map(escapeCsvField).join(','))
    lines.push('')
    lines.push(['bar_type', 'stock_count', 'total_used_mm', 'total_waste_mm', 'waste_ratio'].join(','))
    Object.entries(result.byBarType).forEach(([barType, row]) => {
      lines.push(
        [
          barType,
          String(row.stockCount),
          String(row.totalUsed),
          String(row.totalWaste),
          String(row.wasteRatio),
        ]
          .map(escapeCsvField)
          .join(','),
      )
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rebar_optimization.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [result])

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
