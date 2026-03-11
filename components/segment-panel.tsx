'use client'

import { useState } from 'react'
import type { DrawingSegment } from '@/lib/types/database'
import Link from 'next/link'

export function SegmentPanel({
  segments,
  selectedSegmentId,
  onSelect,
  onUpdate,
  onDelete,
  barTypes,
  projectId,
}: {
  segments: DrawingSegment[]
  selectedSegmentId: string | null
  onSelect: (id: string | null) => void
  onUpdate: (id: string, updates: Partial<DrawingSegment>) => void
  onDelete: (id: string) => void
  barTypes: string[]
  projectId: string
}) {
  const selected = segments.find((s) => s.id === selectedSegmentId)

  return (
    <div className="w-80 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          線分一覧 ({segments.length})
        </h3>
        {segments.length > 0 && (
          <Link
            href={`/projects/${projectId}/optimize`}
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
            <span className="text-xs font-medium text-primary">線分の編集</span>
            <button
              onClick={() => onDelete(selected.id)}
              className="text-xs text-danger hover:underline"
            >
              削除
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted mb-0.5">長さ (mm)</label>
              <input
                type="number"
                value={selected.length_mm}
                onChange={(e) =>
                  onUpdate(selected.id, { length_mm: parseInt(e.target.value) || 0 })
                }
                className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-0.5">数量</label>
              <input
                type="number"
                min={1}
                value={selected.quantity}
                onChange={(e) =>
                  onUpdate(selected.id, { quantity: parseInt(e.target.value) || 1 })
                }
                className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
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

      {/* Segment list */}
      <div className="flex-1 overflow-y-auto">
        {segments.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted">
            「線を描く」ツールで<br />
            図面上に線分を追加してください。
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {segments.map((seg) => (
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
                  <span className="font-medium">{seg.length_mm}mm</span>
                  <span className="text-muted ml-1.5">x{seg.quantity}</span>
                  {seg.label && (
                    <span className="text-muted ml-1.5 text-xs">({seg.label})</span>
                  )}
                </div>
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono">
                  {seg.bar_type}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Summary */}
      {segments.length > 0 && (
        <div className="border-t border-border px-4 py-3 text-xs text-muted space-y-1">
          <div className="flex justify-between">
            <span>線分の本数</span>
            <span className="font-medium text-foreground">{segments.length}本</span>
          </div>
          <div className="flex justify-between">
            <span>部材本数の合計（数量の合計）</span>
            <span className="font-medium text-foreground">
              {segments.reduce((sum, s) => sum + s.quantity, 0)}本
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
