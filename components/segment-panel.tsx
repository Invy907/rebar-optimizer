'use client'

import type { DrawingSegment } from '@/lib/types/database'
import { getSegmentLabelMapWithMeta } from '@/lib/segment-labels'
import Link from 'next/link'
import {
  decodeSegmentMeta,
  encodeSegmentMeta,
  getSegmentBars,
  getSegmentBarsSummary,
  getSegmentColor,
  legacyFieldsFromBars,
  type SegmentBarItem,
  type SegmentColor,
} from '@/lib/segment-meta'

const CIRCLED_NUMS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
function circledNumber(n: number): string {
  const chars = [...CIRCLED_NUMS]
  return n >= 1 && n <= chars.length ? chars[n - 1] : `(${n})`
}

export function SegmentPanel({
  segments,
  selectedSegmentId,
  onSelect,
  onUpdate,
  onDelete,
  onSplit,
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
  onSplit?: (id: string) => void
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
  const selectedColor: SegmentColor = selected ? getSegmentColor(selected) : 'red'
  const selectedBars: SegmentBarItem[] = selected ? getSegmentBars(selected) : []
  const decoded = selected ? decodeSegmentMeta(selected.memo) : null
  const selectedNote = selected
    ? (decoded?.meta?.note ?? decoded?.legacyNote ?? '')
    : ''

  // Canvasで使用する「円番号」は、長い長さ順（降順）で 1 から採番します。
  // そのため、新しく追加された線の長さが既存より長ければ、その線の番号が自動で小さくなります。
  const uniqueRebarLengths = Array.from(
    new Set(rebarSegments.map((s) => s.length_mm)),
  ).sort((a, b) => b - a)
  const circleNoByLength = new Map<number, number>(
    uniqueRebarLengths.map((len, idx) => [len, idx + 1]),
  )
  const circleCountByNo: Record<
    number,
    {
      red: number
      blue: number
    }
  > = {}
  for (const seg of rebarSegments) {
    const no = circleNoByLength.get(seg.length_mm) ?? 1
    if (!circleCountByNo[no]) circleCountByNo[no] = { red: 0, blue: 0 }
    const c = getSegmentColor(seg)
    circleCountByNo[no][c]++
  }

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
              <button
                type="button"
                onClick={() => onSelect(null)}
                className="text-[11px] text-muted hover:text-foreground transition-colors"
              >
                閉じる
              </button>
              {onSplit && (
                <button
                  type="button"
                  onClick={() => onSplit(selected.id)}
                  className="text-xs text-primary hover:underline"
                >
                  分割
                </button>
              )}
              {selectedIsSpacing && (
                <button
                  type="button"
                  onClick={() =>
                    (() => {
                      const bars: SegmentBarItem[] = [
                        { barType: barTypes[0] ?? 'D10', quantity: 1 },
                      ]
                      const legacy = legacyFieldsFromBars(bars)
                      const memo = encodeSegmentMeta({
                        v: 1,
                        color: 'red',
                        bars,
                        note: decodeSegmentMeta(selected.memo).legacyNote ?? null,
                      })
                      onUpdate(selected.id, {
                        memo,
                        bar_type: legacy.bar_type,
                        quantity: legacy.quantity,
                      })
                    })()
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
                <label className="block text-xs text-muted mb-0.5">線の色</label>
                <select
                  value={selectedColor}
                  onChange={(e) => {
                    const nextColor = (e.target.value as SegmentColor) || 'red'
                    const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                    const bars = getSegmentBars(selected)
                    const note = meta?.note ?? legacyNote ?? null
                    const memo = encodeSegmentMeta({
                      v: 1,
                      color: nextColor,
                      bars,
                      note,
                    })
                    onUpdate(selected.id, { memo })
                  }}
                  className="w-full rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary bg-white"
                >
                  <option value="red">赤</option>
                  <option value="blue">青</option>
                </select>
              </div>
            )}
          </div>
          {!selectedIsSpacing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs text-muted">鉄筋（種類と本数）</label>
                <button
                  type="button"
                  onClick={() => {
                    const bars = getSegmentBars(selected)
                    const next = [
                      ...bars,
                      {
                        barType: getNextDefaultBarType(
                          bars.map((b) => b.barType),
                          barTypes,
                        ),
                        quantity: 1,
                      },
                    ]
                    const legacy = legacyFieldsFromBars(next)
                    const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                    const memo = encodeSegmentMeta({
                      v: 1,
                      color: meta?.color ?? selectedColor,
                      bars: next,
                      note: meta?.note ?? legacyNote ?? null,
                    })
                    onUpdate(selected.id, {
                      memo,
                      bar_type: legacy.bar_type,
                      quantity: legacy.quantity,
                    })
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  + 追加
                </button>
              </div>
              <div className="space-y-2">
                {(selectedBars.length ? selectedBars : [{ barType: barTypes[0] ?? 'D10', quantity: 1 }]).map(
                  (row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={row.barType}
                        onChange={(e) => {
                          const bars = [...selectedBars]
                          if (bars.length === 0) bars.push(row)
                          bars[idx] = { ...bars[idx], barType: e.target.value }
                          const legacy = legacyFieldsFromBars(bars)
                          const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                          const memo = encodeSegmentMeta({
                            v: 1,
                            color: meta?.color ?? selectedColor,
                            bars,
                            note: meta?.note ?? legacyNote ?? null,
                          })
                          onUpdate(selected.id, {
                            memo,
                            bar_type: legacy.bar_type,
                            quantity: legacy.quantity,
                          })
                        }}
                        className="flex-1 rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary bg-white"
                      >
                        {barTypes.map((bt) => (
                          <option key={bt} value={bt}>
                            {bt}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        value={row.quantity}
                        onChange={(e) => {
                          const bars = [...selectedBars]
                          if (bars.length === 0) bars.push(row)
                          bars[idx] = {
                            ...bars[idx],
                            quantity: Math.max(0, parseInt(e.target.value) || 0),
                          }
                          const legacy = legacyFieldsFromBars(bars)
                          const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                          const memo = encodeSegmentMeta({
                            v: 1,
                            color: meta?.color ?? selectedColor,
                            bars,
                            note: meta?.note ?? legacyNote ?? null,
                          })
                          onUpdate(selected.id, {
                            memo,
                            bar_type: legacy.bar_type,
                            quantity: legacy.quantity,
                          })
                        }}
                        className="w-20 rounded border border-border px-2 py-1 text-sm font-mono outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const bars = selectedBars.filter((_, i) => i !== idx)
                          const nextBars = bars.length ? bars : [{ barType: barTypes[0] ?? 'D10', quantity: 1 }]
                          const legacy = legacyFieldsFromBars(nextBars)
                          const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                          const memo = encodeSegmentMeta({
                            v: 1,
                            color: meta?.color ?? selectedColor,
                            bars: nextBars,
                            note: meta?.note ?? legacyNote ?? null,
                          })
                          onUpdate(selected.id, {
                            memo,
                            bar_type: legacy.bar_type,
                            quantity: legacy.quantity,
                          })
                        }}
                        className="text-xs text-danger hover:underline"
                        disabled={(selectedBars.length || 1) <= 1}
                      >
                        削除
                      </button>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs text-muted mb-0.5">ラベル</label>
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
          <div>
            <label className="block text-xs text-muted mb-0.5">メモ</label>
            <textarea
              value={selectedNote}
              onChange={(e) => {
                const { meta } = decodeSegmentMeta(selected.memo)
                const bars = getSegmentBars(selected)
                const memo = encodeSegmentMeta({
                  v: 1,
                  color: meta?.color ?? selectedColor,
                  bars,
                  note: e.target.value || null,
                })
                onUpdate(selected.id, { memo })
              }}
              placeholder="任意"
              rows={2}
              className="w-full resize-y rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
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
          <div>
            <div className="px-4 py-3 border-b border-border space-y-0.5 text-xs font-mono">
              {uniqueRebarLengths.map((len) => {
                const no = circleNoByLength.get(len) ?? 1
                const c = circleCountByNo[no] ?? { red: 0, blue: 0 }
                if (c.red === 0) return null
                return (
                  <div key={`r-${len}`} style={{ color: '#ef4444' }}>
                    {circledNumber(no)}{len.toLocaleString()} × {c.red}
                  </div>
                )
              })}
              {uniqueRebarLengths.map((len) => {
                const no = circleNoByLength.get(len) ?? 1
                const c = circleCountByNo[no] ?? { red: 0, blue: 0 }
                if (c.blue === 0) return null
                return (
                  <div key={`b-${len}`} style={{ color: '#3b82f6' }}>
                    {circledNumber(no)}{len.toLocaleString()} × {c.blue}
                  </div>
                )
              })}
            </div>
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
                        segmentLabelById[seg.id]?.isAuto
                          ? 'text-muted'
                          : 'text-foreground'
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
                    <span className="text-muted ml-1.5 truncate">
                      {getSegmentBarsSummary(seg)}
                    </span>
                  </div>
                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono">
                    {getSegmentColor(seg) === 'blue' ? '青' : '赤'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
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
              {rebarSegments.reduce((sum, s) => sum + getSegmentBars(s).reduce((ss, b) => ss + b.quantity, 0), 0)}本
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function getNextDefaultBarType(
  existingBarTypes: string[],
  fallbackList: string[],
): string {
  const existing = new Set(existingBarTypes.map((b) => (b ?? '').toUpperCase()))
  const ordered = fallbackList.map((b) => (b ?? '').toUpperCase()).filter(Boolean)
  for (const bt of ordered) {
    if (!existing.has(bt)) return bt
  }
  return ordered[ordered.length - 1] ?? 'D10'
}
