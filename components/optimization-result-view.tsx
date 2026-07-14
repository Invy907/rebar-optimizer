// components/optimization-result-view.tsx

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OptimizationOutput } from '@/lib/optimizer'
import type { UnitCalculationRow, UnitCountRoundingMode } from '@/lib/unit-calculations'
import type { Unit } from '@/lib/types/database'
import { UnitShapeThumbnail } from '@/components/unit-client'

interface UnitResultSummary {
  key: string
  unitId: string | null
  unitName: string
  shapeLengthMm: number
  totalCount: number
}

export function OptimizationResultView({
  result,
  stockLengthMm,
  projectId,
  segmentLabelById,
  segmentDrawingIdById,
  focusSegmentId,
  unitCalculationRows,
  roundingMode,
  units = [],
}: {
  result: OptimizationOutput
  stockLengthMm: number
  projectId: string
  segmentLabelById: Record<string, string>
  segmentDrawingIdById: Record<string, string>
  focusSegmentId?: string | null
  unitCalculationRows: UnitCalculationRow[]
  roundingMode: UnitCountRoundingMode
  units?: Unit[]
}) {
  void stockLengthMm
  void projectId
  void result
  void segmentLabelById
  void segmentDrawingIdById
  void focusSegmentId
  void roundingMode

  const [shapeLengthOverrides, setShapeLengthOverrides] = useState<
    Record<string, number>
  >({})
  const [editingShapeKey, setEditingShapeKey] = useState<string | null>(null)
  const [shapeLengthDraft, setShapeLengthDraft] = useState('')

  const unitById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  )

  const unitSummaries = useMemo<UnitResultSummary[]>(() => {
    const map = new Map<string, UnitResultSummary>()
    for (const row of unitCalculationRows) {
      const key = row.unitId ?? `name:${row.unitName}`
      const existing = map.get(key)
      if (existing) {
        existing.totalCount += row.unitSummaryCount
      } else {
        map.set(key, {
          key,
          unitId: row.unitId,
          unitName: row.unitName,
          shapeLengthMm: row.unitShapeLengthMm,
          totalCount: row.unitSummaryCount,
        })
      }
    }
    return Array.from(map.values()).filter((s) => s.totalCount > 0)
  }, [unitCalculationRows])

  useEffect(() => {
    const validKeys = new Set(unitSummaries.map((s) => s.key))
    setShapeLengthOverrides((prev) => {
      const next: Record<string, number> = {}
      for (const [k, v] of Object.entries(prev)) {
        if (validKeys.has(k)) next[k] = v
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [unitSummaries])

  const noSummaryReason = useMemo<string | null>(() => {
    if (unitSummaries.length > 0) return null
    if (unitCalculationRows.length === 0) {
      return 'ユニット別集計の対象となる線分がありません（線分にユニットが割り当てられていない、または同色の永続化済みユニットがありません）。'
    }
    const hasZeroCount = unitCalculationRows.some((r) => r.computedCount === 0)
    if (hasZeroCount) {
      return 'ピッチ・本数から算出した本数が 0 のため集計に含まれません（長さ < ピッチ、または本数が 0）。'
    }
    return 'ユニット別集計の対象が見つかりませんでした。'
  }, [unitSummaries, unitCalculationRows])

  const handlePrint = useCallback(() => {
    const originalTitle = document.title
    document.title = ''
    const restoreTitle = () => {
      document.title = originalTitle
      window.removeEventListener('afterprint', restoreTitle)
    }
    window.addEventListener('afterprint', restoreTitle)
    window.print()
  }, [])

  return (
    <div className="space-y-4">
      <div className="print-hook-summary rounded-lg border border-border bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">フック付</h3>
        {unitSummaries.length > 0 ? (
          <div className="flex flex-col gap-3 print:gap-1">
            {unitSummaries.map((s) => (
              <div
                key={s.key}
                className="hook-card rounded-md border border-border bg-muted/30 px-3 py-2 text-sm leading-snug"
              >
                <div className="font-medium text-foreground">{s.unitName}</div>
                <div className="mt-1 flex items-center gap-2">
                  {(() => {
                    const u = s.unitId ? unitById.get(s.unitId) ?? null : null
                    return u ? (
                      <UnitShapeThumbnail
                        unit={u}
                        shapeOnly
                        thumbClassName="h-9 w-14 shrink-0 print:h-6 print:w-10"
                      />
                    ) : null
                  })()}
                  <div className="flex items-center gap-1.5 font-mono text-base font-semibold tabular-nums">
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`${s.unitName} の長さ (mm)`}
                    value={
                      editingShapeKey === s.key
                        ? shapeLengthDraft
                        : (
                            shapeLengthOverrides[s.key] ?? s.shapeLengthMm
                          ).toLocaleString('ja-JP')
                    }
                    onFocus={() => {
                      setEditingShapeKey(s.key)
                      setShapeLengthDraft(
                        String(shapeLengthOverrides[s.key] ?? s.shapeLengthMm),
                      )
                    }}
                    onChange={(e) => {
                      setShapeLengthDraft(e.target.value.replace(/[^\d]/g, ''))
                    }}
                    onBlur={() => {
                      const n = Number.parseInt(shapeLengthDraft, 10)
                      if (Number.isFinite(n) && n > 0) {
                        setShapeLengthOverrides((prev) => ({
                          ...prev,
                          [s.key]: n,
                        }))
                      }
                      setEditingShapeKey(null)
                    }}
                    className="w-[5.5rem] rounded border border-border bg-white px-1.5 py-0.5 text-base font-semibold outline-none focus:border-primary print:border-transparent print:bg-transparent print:p-0"
                  />
                  <span className="text-muted">×</span>
                  <span>{s.totalCount.toLocaleString('ja-JP')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">{noSummaryReason}</p>
        )}
      </div>

      <div className="flex justify-end gap-2 print:hidden">
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
