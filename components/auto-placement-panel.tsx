'use client'

import { useMemo, useState } from 'react'
import type { DrawingSegment, Unit } from '@/lib/types/database'
import type { PlacementResult, SegmentAssignment } from '@/lib/types/foundation-plan'
import { buildFoundationGraph, inferFamilyAssignments } from '@/lib/foundation-graph'
import { autoPlace, placementToSegmentAssignments } from '@/lib/placement-engine'
import { formatCombination } from '@/lib/variant-combination'
import { getSegmentStrokeHex } from '@/lib/segment-colors'

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
function circled(n: number): string {
  const chars = [...CIRCLED]
  return n >= 1 && n <= chars.length ? chars[n - 1]! : `(${n})`
}

export function AutoPlacementPanel({
  segments,
  units,
  onApply,
  onClose,
}: {
  segments: DrawingSegment[]
  units: Unit[]
  onApply: (assignments: SegmentAssignment[]) => void
  onClose: () => void
}) {
  const [result, setResult] = useState<PlacementResult | null>(null)
  const [assignments, setAssignments] = useState<SegmentAssignment[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeUnits = useMemo(
    () => units.filter((u) => u.is_active !== false),
    [units],
  )

  const unitById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  )

  function runAutoPlace() {
    setRunning(true)
    setError(null)
    setResult(null)

    queueMicrotask(() => {
      try {
        let graph = buildFoundationGraph(segments, units)
        graph = inferFamilyAssignments(graph, units)
        const placementResult = autoPlace(graph, units)
        const segAssign = placementToSegmentAssignments(placementResult, graph, units)
        setResult(placementResult)
        setAssignments(segAssign)
      } catch (e) {
        setError(e instanceof Error ? e.message : '自動配置の実行中にエラーが発生しました')
      } finally {
        setRunning(false)
      }
    })
  }

  const nameMap = useMemo(() => {
    const m = new Map<string, { mark: number | null; name: string }>()
    for (const u of units) {
      m.set(u.id, { mark: u.mark_number, name: u.name })
    }
    return m
  }, [units])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="border-b border-border px-6 pt-5 pb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">自動配置</h3>
            <p className="text-xs text-muted mt-0.5">
              ユニットライブラリを基に、線分へ最適な variant を自動割当します
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted underline"
          >
            閉じる
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border border-border p-3">
              <div className="text-muted text-[11px]">鉄筋線分</div>
              <div className="font-semibold text-lg font-mono">
                {segments.filter((s) => !(s.bar_type === 'SPACING' && s.quantity === 0)).length}
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-muted text-[11px]">利用可能ユニット</div>
              <div className="font-semibold text-lg font-mono">{activeUnits.length}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-muted text-[11px]">直線 variant</div>
              <div className="font-semibold text-lg font-mono">
                {activeUnits.filter((u) => u.shape_type === 'straight' && u.length_mm).length}
              </div>
            </div>
          </div>

          {!result && !running && (
            <div className="text-center py-6">
              <button
                type="button"
                onClick={runAutoPlace}
                disabled={activeUnits.length === 0}
                className="rounded-lg bg-primary px-8 py-3 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
              >
                自動配置を実行
              </button>
              {activeUnits.length === 0 && (
                <p className="text-xs text-red-600 mt-2">
                  有効なユニットが登録されていません。先にユニット管理でユニットを作成してください。
                </p>
              )}
            </div>
          )}

          {running && (
            <div className="flex flex-col items-center gap-3 py-8 text-muted">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm font-medium">グラフ解析・配置計算中...</p>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {result && (
            <>
              {/* Summary */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">配置サマリ（variant別 数量）</h4>
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left">
                        <th className="px-3 py-2 font-medium">ユニット</th>
                        <th className="px-3 py-2 font-medium text-center">番号</th>
                        <th className="px-3 py-2 font-medium text-center">数量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {result.summary.map((row) => {
                        const hex = getSegmentStrokeHex(row.color, false)
                        return (
                          <tr key={row.unitId}>
                            <td className="px-3 py-2 font-mono" style={{ color: hex }}>
                              {row.unitName}
                            </td>
                            <td className="px-3 py-2 text-center font-mono font-semibold" style={{ color: hex }}>
                              {row.markNumber != null ? circled(row.markNumber) : '—'}
                            </td>
                            <td className="px-3 py-2 text-center font-mono font-semibold">
                              {row.count}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Run combinations */}
              {result.runCombinations.size > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">直線ラン充填結果</h4>
                  <ul className="space-y-1.5 text-sm">
                    {Array.from(result.runCombinations.entries()).map(([runId, combo]) => (
                      <li key={runId} className="rounded border border-border px-3 py-2 font-mono">
                        <span className="text-muted text-xs">
                          {combo.totalMm.toLocaleString('ja-JP')}mm
                          {combo.remainderMm > 0 && (
                            <span className="text-amber-600 ml-1">
                              (端数 {combo.remainderMm}mm)
                            </span>
                          )}
                        </span>
                        <span className="mx-2 text-muted">→</span>
                        <span className="font-semibold">
                          {formatCombination(combo, nameMap)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Remainders */}
              {result.remainders.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-amber-700">端数・未配置</h4>
                  <ul className="space-y-1 text-sm text-amber-800">
                    {result.remainders.map((r) => (
                      <li key={r.runId} className="font-mono">
                        ラン {r.runId.slice(0, 8)}… — 残 {r.remainingMm}mm
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-red-700">検証警告</h4>
                  <ul className="space-y-1 text-xs text-red-700">
                    {result.warnings.map((w, i) => (
                      <li key={i}>⚠ {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Segment assignments */}
              {assignments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">線分割当（{assignments.length}件）</h4>
                  <div className="max-h-40 overflow-y-auto rounded border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/30 text-left">
                          <th className="px-2 py-1.5 font-medium">線分</th>
                          <th className="px-2 py-1.5 font-medium">割当ユニット</th>
                          <th className="px-2 py-1.5 font-medium text-center">番号</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {assignments.map((a) => {
                          const hex = getSegmentStrokeHex(a.color, false)
                          return (
                            <tr key={a.segmentId}>
                              <td className="px-2 py-1 font-mono text-muted">{a.segmentId.slice(0, 8)}…</td>
                              <td className="px-2 py-1 font-mono" style={{ color: hex }}>
                                {a.unitName ?? a.unitId.slice(0, 8)}
                              </td>
                              <td className="px-2 py-1 text-center font-mono font-semibold" style={{ color: hex }}>
                                {a.markNumber != null ? circled(a.markNumber) : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 flex justify-end gap-2">
          {result && assignments.length > 0 && (
            <button
              type="button"
              onClick={() => {
                runAutoPlace()
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
            >
              再計算
            </button>
          )}
          {result && assignments.length > 0 && (
            <button
              type="button"
              onClick={() => onApply(assignments)}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
            >
              {assignments.length}件の割当を適用
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
