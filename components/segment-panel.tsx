// components/segment-panel.tsx

'use client'

import { useMemo, useState } from 'react'
import type { DrawingSegment, Unit } from '@/lib/types/database'
import Link from 'next/link'
import {
  decodeSegmentMeta,
  encodeSegmentMeta,
  getSegmentResolvedMarkNumber,
  getSegmentBars,
  getSegmentBarsSummary,
  getSegmentColor,
  legacyFieldsFromBars,
  type SegmentBarItem,
  type SegmentColor,
} from '@/lib/segment-meta'
import {
  getSegmentColorLabelJa,
  getSegmentStrokeHex,
  normalizeSegmentColor,
  SEGMENT_COLOR_DEFINITIONS,
} from '@/lib/segment-colors'

const CIRCLED_NUMS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

/** 手動で色・鉄筋を変えたときはユニット参照を外す（メモの値はそのまま更新） */
const CLEAR_UNIT_LINK = {
  unit_id: null as string | null,
  unit_code: null as string | null,
  unit_name: null as string | null,
  mark_number: null as number | null,
}

function circledNumber(n: number | null): string {
  if (n == null) return '—'
  const chars = [...CIRCLED_NUMS]
  return n >= 1 && n <= chars.length ? chars[n - 1] : `(${n})`
}

/** DBの units.id（UUID）のみ unit_id に保存可能（mock/local は FK 制約回避のため割当不可） */
function isPersistedUnitId(id: string): boolean {
  return !id.startsWith('mock-') && !id.startsWith('local-')
}

export function SegmentPanel({
  segments,
  selectedSegmentIds,
  onReplaceSelection,
  onToggleSegmentSelection,
  onBulkApplyTemplateColor,
  onUpdate,
  onDelete,
  onSplit,
  barTypes,
  projectId,
  canUndo,
  onUndo,
  units = [],
  templateOptions = [],
  activeTemplateId = '',
  activeTemplateColor = 'red',
}: {
  segments: DrawingSegment[]
  selectedSegmentIds: string[]
  onReplaceSelection: (ids: string[]) => void
  onToggleSegmentSelection: (id: string) => void
  onBulkApplyTemplateColor: (templateId: string, color: SegmentColor) => void | Promise<void>
  onUpdate: (id: string, updates: Partial<DrawingSegment>) => void
  onDelete: (id: string) => void
  onSplit?: (id: string) => void
  barTypes: string[]
  projectId: string
  canUndo?: boolean
  onUndo?: () => void
  units?: Unit[]
  templateOptions?: Array<{ id: string; name: string }>
  activeTemplateId?: string
  activeTemplateColor?: SegmentColor
}) {
  const persistedUnits = units.filter(
    (u) => u.is_active !== false && isPersistedUnitId(u.id),
  )
  const [bulkTemplateId, setBulkTemplateId] = useState('')
  const [bulkColor, setBulkColor] = useState<SegmentColor>(activeTemplateColor)
  const resolvedBulkTemplateId =
    bulkTemplateId && templateOptions.some((t) => t.id === bulkTemplateId)
      ? bulkTemplateId
      : activeTemplateId || templateOptions[0]?.id || ''
  const rebarSegments = segments.filter(
    (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
  )
  const spacingSegments = segments.filter(
    (s) => s.bar_type === 'SPACING' && s.quantity === 0,
  )
  const singleSelectedId =
    selectedSegmentIds.length === 1 ? selectedSegmentIds[0]! : null
  const selected = singleSelectedId
    ? segments.find((s) => s.id === singleSelectedId) ?? null
    : null
  const selectedIsSpacing = selected?.bar_type === 'SPACING'
  const selectedColor: SegmentColor = selected
    ? getSegmentColor(selected, units)
    : 'red'
  const selectedBars: SegmentBarItem[] = selected
    ? getSegmentBars(selected, units)
    : []
  const decoded = selected ? decodeSegmentMeta(selected.memo) : null
  const selectedNote = selected
    ? (decoded?.meta?.note ?? decoded?.legacyNote ?? '')
    : ''
  const selectedAssignedUnit =
    selected?.unit_id != null
      ? units.find((u) => u.id === selected.unit_id) ?? null
      : null

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])

  // 円番号(ユニット由来)で集計し、表示長さは「割当ユニットの長さ」を優先する
  type CircleRow = { len: number; no: number | null; count: number; color: SegmentColor }
  const circleRows = (() => {
    const m = new Map<string, CircleRow>()
    for (const seg of rebarSegments) {
      const no = getSegmentResolvedMarkNumber(seg, units)
      const color = getSegmentColor(seg, units)
      const linkedUnit = seg.unit_id ? unitById.get(seg.unit_id) ?? null : null
      const unitLen = linkedUnit?.length_mm
      const len = typeof unitLen === 'number' && Number.isFinite(unitLen) ? unitLen : seg.length_mm
      const key = `${color}::${no ?? 'none'}`
      const existing = m.get(key)
      if (!existing) {
        m.set(key, { len, no, count: 1, color })
      } else {
        existing.count += 1
      }
    }
    return [...m.values()].sort((a, b) => {
      const aNo = a.no ?? Number.MAX_SAFE_INTEGER
      const bNo = b.no ?? Number.MAX_SAFE_INTEGER
      if (aNo !== bNo) return aNo - bNo
      return b.len - a.len
    })
  })()

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
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
              singleSelectedId
                ? `/projects/${projectId}/optimize?segmentId=${singleSelectedId}`
                : `/projects/${projectId}/optimize`
            }
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover transition-colors"
          >
            切断計算
          </Link>
        )}
      </div>

      {/* 複数選択: 一括ユニット */}
      {selectedSegmentIds.length > 1 && (
        <div className="border-b border-border p-4 space-y-2 bg-amber-50/60">
          <div className="text-xs font-medium text-amber-900">
            {selectedSegmentIds.filter((sid) => {
              const s = segments.find((x) => x.id === sid)
              return s && !(s.bar_type === 'SPACING' && s.quantity === 0)
            }).length}
            本の鉄筋線を選択中
          </div>
          {persistedUnits.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] text-muted mb-0.5">
                  テンプレート一括適用
                </label>
                <select
                  value={resolvedBulkTemplateId}
                  onChange={(e) => setBulkTemplateId(e.target.value)}
                  className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-primary bg-white"
                >
                  {templateOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-[92px]">
                <label className="block text-[10px] text-muted mb-0.5">色</label>
                <select
                  value={bulkColor}
                  onChange={(e) => setBulkColor(normalizeSegmentColor(e.target.value))}
                  className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-primary bg-white"
                >
                  {SEGMENT_COLOR_DEFINITIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.labelJa}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
                onClick={() => {
                  if (!resolvedBulkTemplateId) return
                  void onBulkApplyTemplateColor(resolvedBulkTemplateId, bulkColor)
                }}
              >
                適用
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-muted">
              保存済みユニットがないため一括適用できません。
            </p>
          )}
          <button
            type="button"
            className="text-[11px] text-muted hover:text-foreground underline"
            onClick={() => onReplaceSelection([])}
          >
            選択を解除
          </button>
        </div>
      )}

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
                onClick={() => onReplaceSelection([])}
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
                        ...CLEAR_UNIT_LINK,
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
                  value={normalizeSegmentColor(selectedColor)}
                  onChange={(e) => {
                    const nextColor = normalizeSegmentColor(e.target.value)
                    const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                    const bars = getSegmentBars(selected, units)
                    const note = meta?.note ?? legacyNote ?? null
                    const memo = encodeSegmentMeta({
                      v: 1,
                      color: nextColor,
                      bars,
                      note,
                    })
                    onUpdate(selected.id, { memo, ...CLEAR_UNIT_LINK })
                  }}
                  className="w-full rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary bg-white"
                >
                  {SEGMENT_COLOR_DEFINITIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.labelJa}
                    </option>
                  ))}
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
                    const bars = getSegmentBars(selected, units)
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
                      ...CLEAR_UNIT_LINK,
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
                            ...CLEAR_UNIT_LINK,
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
                            ...CLEAR_UNIT_LINK,
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
                            ...CLEAR_UNIT_LINK,
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
          {/* ユニット連結（登録済みユニットから選択） */}
          {units.filter((u) => u.is_active !== false && isPersistedUnitId(u.id)).length > 0 &&
            !selectedIsSpacing && (
            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <label className="block text-xs text-muted">ユニット割当</label>
                {(selectedAssignedUnit?.detail_spec || selectedAssignedUnit?.detail_geometry) && (
                  <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
                    詳細形状あり
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {units
                  .filter((u) => u.is_active !== false && isPersistedUnitId(u.id))
                  .map((u) => {
                    const uc = normalizeSegmentColor(u.color)
                    const stroke = getSegmentStrokeHex(uc, false)
                    const tint = getSegmentStrokeHex(uc, true)
                    const isAssigned = selected.unit_id === u.id
                    return (
                      <button
                        key={u.id}
                        type="button"
                        title={u.name}
                        onClick={() => {
                          const bars: SegmentBarItem[] = u.bars.map((b) => ({
                            barType: b.diameter,
                            quantity: b.qtyPerUnit,
                          }))
                          const legacy = legacyFieldsFromBars(bars)
                          const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                          const memo = encodeSegmentMeta({
                            v: 1,
                            color: uc,
                            bars,
                            note: meta?.note ?? legacyNote ?? null,
                          })
                          const markNum = u.mark_number ?? 1
                          onUpdate(selected.id, {
                            memo,
                            bar_type: legacy.bar_type,
                            quantity: legacy.quantity,
                            label: u.code ?? u.name,
                            unit_id: u.id,
                            unit_code: u.code ?? null,
                            unit_name: u.name ?? null,
                            mark_number: markNum,
                          })
                        }}
                        className={`rounded-md border text-[10px] px-2 py-0.5 transition-colors font-medium ${
                          isAssigned
                            ? 'ring-1 ring-offset-0.5'
                            : 'hover:brightness-95'
                        }`}
                        style={{
                          borderColor: stroke,
                          background: isAssigned ? stroke : '#fff',
                          color: isAssigned ? '#fff' : tint,
                        }}
                      >
                        {u.code ?? u.name}
                      </button>
                    )
                  })}
              </div>
              {selected.unit_id && (
                <button
                  type="button"
                  className="mt-1.5 text-[11px] text-muted hover:text-foreground underline"
                  onClick={() => onUpdate(selected.id, { ...CLEAR_UNIT_LINK })}
                >
                  割当を解除（参照のみ外す）
                </button>
              )}
            </div>
          )}
          <div>
            <label className="block text-xs text-muted mb-0.5">メモ</label>
            <textarea
              value={selectedNote}
              onChange={(e) => {
                const { meta } = decodeSegmentMeta(selected.memo)
                const bars = getSegmentBars(selected, units)
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
            <div className="px-4 py-3 border-b border-border space-y-1 text-[13px] font-semibold font-mono">
              {circleRows
                .filter((r) => r.count > 0)
                .map((r) => (
                  <div
                    key={`${r.color}-${r.no ?? 'none'}`}
                    style={{ color: getSegmentStrokeHex(r.color, false) }}
                  >
                    {circledNumber(r.no)}
                    {r.len.toLocaleString()} × {r.count}
                  </div>
                ))}
            </div>
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
                  selectedSegmentIds.includes(seg.id)
                    ? 'text-emerald-700 bg-emerald-50 rounded px-2 py-1'
                    : 'text-muted'
                }`}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    onToggleSegmentSelection(seg.id)
                  } else {
                    onReplaceSelection([seg.id])
                  }
                }}
              >
                <span className="truncate">
                  {seg.label ?? '間隔'} {seg.length_mm}mm
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(seg.id)
                  }}
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
              {rebarSegments.reduce(
                (sum, s) =>
                  sum + getSegmentBars(s, units).reduce((ss, b) => ss + b.quantity, 0),
                0,
              )}本
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
