'use client'

import { useState } from 'react'
import type { DrawingSegment } from '@/lib/types/database'
import { getSegmentLabelMapWithMeta } from '@/lib/segment-labels'
import Link from 'next/link'

export function SegmentPanel({
  segments,
  selectedSegmentId,
  onSelect,
  onUpdate,
  onDelete,
  barTypes,
  projectId,
  canUndo,
  onUndo,
}: {
  segments: DrawingSegment[]
  selectedSegmentId: string | null
  onSelect: (id: string | null) => void
  onUpdate: (id: string, updates: Partial<DrawingSegment>) => void
  onDelete: (id: string) => void
  barTypes: string[]
  projectId: string
  canUndo?: boolean
  onUndo?: () => void
}) {
  const rebarSegments = segments.filter(
    (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
  )
  const spacingSegments = segments.filter(
    (s) => s.bar_type === 'SPACING' && s.quantity === 0,
  )
  const selected = segments.find((s) => s.id === selectedSegmentId) ?? null
  const selectedIsSpacing = selected?.bar_type === 'SPACING'
  const segmentLabelById = getSegmentLabelMapWithMeta(rebarSegments)

  return (
    <div className="w-80 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">
            線分一覧 ({rebarSegments.length})
          </h3>
          {onUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="text-[11px] text-muted hover:text-foreground disabled:opacity-40"
            >
              元に戻す
            </button>
          )}
        </div>
        {rebarSegments.length > 0 && (
          <Link
            href={
              selectedSegmentId
                ? `/projects/${projectId}/optimize?segmentId=${selectedSegmentId}`
                : `/projects/${projectId}/optimize`
            }
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover transition-colors"
          >
            切断計算
          </Link>
        )}
      </div>

      {/* Selected segment editor */}
      {selected && (
        <div className="border-b border-border p-4 space-y-3 bg-blue-50/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-primary">
              {selectedIsSpacing ? '間隔線の編集' : '線分の編集'}
            </span>
            <div className="flex items-center gap-2">
              {selectedIsSpacing && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdate(selected.id, {
                      bar_type: barTypes[0] ?? 'D10',
                      quantity: 1,
                    })
                  }
                  className="text-[11px] text-emerald-700 hover:underline"
                >
                  鉄筋線に変換
                </button>
              )}
              <button
                onClick={() => onDelete(selected.id)}
                className="text-xs text-danger hover:underline"
              >
                削除
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted mb-0.5">長さ (mm)</label>
              <input
                type="number"
                value={selected.length_mm}
                onChange={(e) =>
                  onUpdate(selected.id, {
                    length_mm: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
              />
            </div>
            {!selectedIsSpacing && (
              <div>
                <label className="block text-xs text-muted mb-0.5">数量</label>
                <input
                  type="number"
                  min={1}
                  value={selected.quantity}
                  onChange={(e) =>
                    onUpdate(selected.id, {
                      quantity: parseInt(e.target.value) || 1,
                    })
                  }
                  className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
                />
              </div>
            )}
          </div>
          {!selectedIsSpacing && (
            <div>
              <label className="block text-xs text-muted mb-0.5">鉄筋種別</label>
              <select
                value={selected.bar_type}
                onChange={(e) => onUpdate(selected.id, { bar_type: e.target.value })}
                className="w-full rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
              >
                {barTypes.map((bt) => (
                  <option key={bt} value={bt}>
                    {bt}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-muted mb-0.5">ラベル / メモ</label>
            <input
              type="text"
              value={selected.label ?? ''}
              onChange={(e) =>
                onUpdate(selected.id, { label: e.target.value || null })
              }
              placeholder="任意"
              className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {/* Segment list (rebar only) */}
      <div className="flex-1 overflow-y-auto">
        {rebarSegments.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted">
            「線を描く」ツールで<br />
            図面上に線分を追加してください。
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rebarSegments.map((seg) => (
              <li
                key={seg.id}
                onClick={() => onSelect(seg.id)}
                className={`flex items-center justify-between px-4 py-2.5 cursor-pointer text-sm transition-colors ${
                  seg.id === selectedSegmentId
                    ? 'bg-primary/5 text-primary'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="min-w-0">
                  <span
                    className={`font-mono text-xs mr-2 ${
                      segmentLabelById[seg.id]?.isAuto ? 'text-muted' : 'text-foreground'
                    }`}
                    title={
                      segmentLabelById[seg.id]?.isAuto
                        ? '自動ラベル（未入力）'
                        : 'ラベル'
                    }
                  >
                    {segmentLabelById[seg.id]?.label ?? '-'}
                  </span>
                  <span className="font-medium">{seg.length_mm}mm</span>
                  <span className="text-muted ml-1.5">x{seg.quantity}</span>
                </div>
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono">
                  {seg.bar_type}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Spacing marks list */}
      {spacingSegments.length > 0 && (
        <div className="border-t border-border px-4 py-3 text-xs">
          <div className="mb-2 font-semibold text-muted">間隔線</div>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {spacingSegments.map((seg) => (
              <li
                key={seg.id}
                className={`flex items-center justify-between text-[11px] cursor-pointer ${
                  seg.id === selectedSegmentId
                    ? 'text-emerald-700 bg-emerald-50 rounded px-2 py-1'
                    : 'text-muted'
                }`}
                onClick={() => onSelect(seg.id)}
              >
                <span className="truncate">
                  {seg.label ?? '間隔'} {seg.length_mm}mm
                </span>
                <button
                  onClick={() => onDelete(seg.id)}
                  className="ml-2 text-[11px] text-danger hover:underline"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )
      }

      {/* Summary */}
      {rebarSegments.length > 0 && (
        <div className="border-t border-border px-4 py-3 text-xs text-muted space-y-1">
          <div className="flex justify-between">
            <span>線分の本数</span>
            <span className="font-medium text-foreground">
              {rebarSegments.length}本
            </span>
          </div>
          <div className="flex justify-between">
            <span>部材本数の合計（数量の合計）</span>
            <span className="font-medium text-foreground">
              {rebarSegments.reduce((sum, s) => sum + s.quantity, 0)}本
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
