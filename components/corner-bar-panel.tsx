// components/corner-bar-panel.tsx

'use client'

import { useMemo } from 'react'
import type { DrawingCornerBar } from '@/lib/types/database'
import {
  clampCornerBarSizePx,
  CORNER_BAR_CATEGORIES,
  CORNER_BAR_DIAMETERS,
  CORNER_BAR_SHAPES,
  cornerBarCategoryLabel,
  cornerBarRotationLabel,
  cornerBarSegmentSumMm,
  cornerBarShapeLabel,
  cornerBarThumbPath,
  DEFAULT_CORNER_BAR_SIZE_PX,
  formatCornerBarDims,
  getCornerBarShape,
  isCornerBarFullyDimensioned,
  makeCornerBarDraft,
  MEASUREMENT_TYPES,
  nextCornerBarRotation,
  normalizeCornerBarSegments,
  type CornerBarCategory,
  type CornerBarPlacementDraft,
  type CornerBarSegment,
  type CornerBarShapeType,
  type MeasurementType,
} from '@/lib/corner-bar-presets'
import {
  getSegmentStrokeHex,
  normalizeSegmentColor,
  SEGMENT_COLOR_DEFINITIONS,
} from '@/lib/segment-colors'

const THUMB_W = 56
const THUMB_H = 42

/** − ＋ 1 回あたりの拡大縮小率 */
const SIZE_STEP = 1.25

export function CornerBarPanel({
  cornerBars,
  selectedCornerBarId,
  placementDraft,
  onChangePlacementDraft,
  onSelectCornerBar,
  onUpdate,
  onDelete,
  onDuplicate,
  canUndo,
  onUndo,
}: {
  cornerBars: DrawingCornerBar[]
  selectedCornerBarId: string | null
  placementDraft: CornerBarPlacementDraft | null
  onChangePlacementDraft: (draft: CornerBarPlacementDraft | null) => void
  onSelectCornerBar: (id: string | null) => void
  onUpdate: (id: string, updates: Partial<DrawingCornerBar>) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  canUndo?: boolean
  onUndo?: () => void
}) {
  const selected = useMemo(
    () => cornerBars.find((cb) => cb.id === selectedCornerBarId) ?? null,
    [cornerBars, selectedCornerBarId],
  )
  const selectedShape = selected ? getCornerBarShape(selected.shape_type) : null
  const selectedSegments = useMemo(
    () =>
      selected && selectedShape
        ? normalizeCornerBarSegments(selectedShape, selected.segments)
        : null,
    [selected, selectedShape],
  )
  const currentSizePx = clampCornerBarSizePx(selected?.size_px ?? DEFAULT_CORNER_BAR_SIZE_PX)

  /** 筋種類ごとの本数。図面に 1 つ配置したものが 1 本なので配置数を数える */
  const countByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const cb of cornerBars) {
      map.set(cb.category, (map.get(cb.category) ?? 0) + 1)
    }
    return map
  }, [cornerBars])

  /** 筋種類 × 鉄筋径の集計。資料の集計単位に合わせる */
  const countByCategoryDiameter = useMemo(() => {
    const map = new Map<string, { category: string; diameter: string; qty: number }>()
    for (const cb of cornerBars) {
      const diameter = cb.diameter ?? '径未設定'
      const key = `${cb.category}/${diameter}`
      const prev = map.get(key)
      if (prev) prev.qty += 1
      else map.set(key, { category: cb.category, diameter, qty: 1 })
    }
    return [...map.values()].sort(
      (a, b) => a.category.localeCompare(b.category) || a.diameter.localeCompare(b.diameter),
    )
  }, [cornerBars])

  function patchDraft(patch: Partial<CornerBarPlacementDraft>) {
    if (!placementDraft) return
    onChangePlacementDraft({ ...placementDraft, ...patch })
  }

  /** 辺の寸法・基準を 1 つだけ差し替える。順序は必ず保つ */
  function patchSegment(index: number, patch: Partial<CornerBarSegment>) {
    if (!selected || !selectedSegments) return
    const next = selectedSegments.map((s, i) => (i === index ? { ...s, ...patch } : s))
    onUpdate(selected.id, { segments: next })
  }

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">付加筋一覧 ({cornerBars.length})</h3>
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Selected corner bar editor */}
        {selected && selectedShape && selectedSegments && (
          <div className="border-b border-border p-4 space-y-3 bg-blue-50/50">
            <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onSelectCornerBar(null)}
                  className="text-[11px] text-muted hover:text-foreground transition-colors"
                >
                  閉じる
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicate(selected.id)}
                  className="text-xs text-primary hover:underline"
                >
                  複製
                </button>
                <button
                  onClick={() => onDelete(selected.id)}
                  className="text-xs text-danger hover:underline"
                >
                  削除
                </button>
            </div>

            <div className="text-[10px] text-muted">
              {selectedShape.label} / {formatCornerBarDims(selectedSegments) || '寸法未入力'}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-muted">
                筋種類
                <select
                  value={selected.category}
                  onChange={(e) => onUpdate(selected.id, { category: e.target.value })}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                >
                  {CORNER_BAR_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-muted">
                鉄筋径
                <select
                  value={selected.diameter ?? ''}
                  onChange={(e) => onUpdate(selected.id, { diameter: e.target.value || null })}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                >
                  <option value="">未設定</option>
                  {CORNER_BAR_DIAMETERS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* この部材の向き。押すたびに図面上でも 90 度回る */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted">向き</span>
              <button
                type="button"
                onClick={() =>
                  onUpdate(selected.id, { rotation: nextCornerBarRotation(selected.rotation) })
                }
                className="rounded border border-border bg-white px-2 py-1 text-xs hover:bg-gray-50"
                title="90度ずつ回します"
              >
                ↻ {cornerBarRotationLabel(selected.rotation)}
              </button>
              <button
                type="button"
                onClick={() => onUpdate(selected.id, { rotation: 0 })}
                className="rounded border border-border bg-white px-1.5 py-1 text-[10px] text-muted hover:bg-gray-50"
                title="向きを 0° に戻す"
              >
                0°
              </button>
            </div>

            {/* 各辺の寸法と基準。辺の順番は資料の表記順と一致させる */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-foreground">各辺の寸法</span>
                <span className="text-[10px] text-muted">
                  合計 {cornerBarSegmentSumMm(selectedSegments).toLocaleString('ja-JP')} mm
                </span>
              </div>
              {selectedSegments.map((seg, idx) => (
                <div key={seg.id} className="flex items-center gap-1.5">
                  <span className="w-7 shrink-0 text-[10px] text-muted">辺{idx + 1}</span>
                  <input
                    type="number"
                    min={1}
                    placeholder="mm"
                    value={seg.lengthMm ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        patchSegment(idx, { lengthMm: null })
                        return
                      }
                      const n = Number.parseInt(raw, 10)
                      if (!Number.isFinite(n) || n <= 0) return
                      patchSegment(idx, { lengthMm: n })
                    }}
                    className="min-w-0 flex-1 rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                  />
                  <select
                    value={seg.measurementType ?? ''}
                    onChange={(e) =>
                      patchSegment(idx, {
                        measurementType: (e.target.value || null) as MeasurementType | null,
                      })
                    }
                    className="w-[68px] shrink-0 rounded border border-border bg-white px-1 py-1 text-xs outline-none focus:border-primary"
                  >
                    <option value="">基準</option>
                    {MEASUREMENT_TYPES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {!isCornerBarFullyDimensioned(selectedSegments) && (
                <p className="text-[10px] text-amber-700">寸法が未入力の辺があります。</p>
              )}
            </div>

            {/* 図面上の大きさ。配置時のドラッグで決めた値を後から微調整する */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted">大きさ</span>
              <button
                type="button"
                onClick={() =>
                  onUpdate(selected.id, {
                    size_px: clampCornerBarSizePx(currentSizePx / SIZE_STEP),
                  })
                }
                className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-gray-50"
                title="小さくする"
              >
                −
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdate(selected.id, {
                    size_px: clampCornerBarSizePx(currentSizePx * SIZE_STEP),
                  })
                }
                className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-gray-50"
                title="大きくする"
              >
                ＋
              </button>
              <button
                type="button"
                onClick={() => onUpdate(selected.id, { size_px: DEFAULT_CORNER_BAR_SIZE_PX })}
                className="rounded border border-border bg-white px-1.5 py-0.5 text-[10px] text-muted hover:bg-gray-50"
                title="既定の大きさに戻す"
              >
                既定
              </button>
              <span className="ml-auto text-[10px] text-muted">
                {Math.round(currentSizePx)} px
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-muted">
                色
                <select
                  value={selected.color}
                  onChange={(e) =>
                    onUpdate(selected.id, { color: normalizeSegmentColor(e.target.value) })
                  }
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                >
                  {SEGMENT_COLOR_DEFINITIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.labelJa}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-muted">
                ラベル（任意）
                <input
                  type="text"
                  value={selected.label ?? ''}
                  onChange={(e) => onUpdate(selected.id, { label: e.target.value || null })}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                />
              </label>
            </div>
          </div>
        )}

        {/* 配置設定: 筋種類・鉄筋径・向きを決めてから形状を選ぶ */}
        {!selected && (
          <div className="border-b border-border p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-muted">
                筋種類
                <select
                  value={placementDraft?.category ?? 'CORNER'}
                  onChange={(e) => {
                    const category = e.target.value as CornerBarCategory
                    if (placementDraft) patchDraft({ category })
                  }}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                >
                  {CORNER_BAR_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-muted">
                鉄筋径
                <select
                  value={placementDraft?.diameter ?? 'D13'}
                  onChange={(e) => patchDraft({ diameter: e.target.value })}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                >
                  {CORNER_BAR_DIAMETERS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* 配置する向き。これは「これから置くもの」にだけ効く */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted">向き</span>
              <button
                type="button"
                onClick={() =>
                  patchDraft({ rotation: nextCornerBarRotation(placementDraft?.rotation ?? 0) })
                }
                disabled={!placementDraft}
                className="rounded border border-border bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
                title="90度ずつ回します"
              >
                ↻ {cornerBarRotationLabel(placementDraft?.rotation ?? 0)}
              </button>
              <span className="text-[10px] text-muted">これから配置するもの</span>
            </div>

            {/* 形状は筋種類と 1:1 にしない。同じ L 形を別の筋種類でも使える */}
            <div>
              <span className="text-[10px] text-muted">形状</span>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {CORNER_BAR_SHAPES.map((shape) => {
                  const isActive = placementDraft?.shapeType === shape.id
                  return (
                    <button
                      key={shape.id}
                      type="button"
                      title={shape.label}
                      aria-label={shape.label}
                      aria-pressed={isActive}
                      onClick={() =>
                        onChangePlacementDraft(
                          isActive
                            ? null
                            : makeCornerBarDraft(
                                shape.id as CornerBarShapeType,
                                placementDraft ?? undefined,
                              ),
                        )
                      }
                      className={`flex items-center justify-center rounded border p-0.5 transition-colors ${
                        isActive
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-white hover:border-primary hover:bg-primary/5'
                      }`}
                    >
                      <svg
                        width={THUMB_W}
                        height={THUMB_H}
                        viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
                        aria-hidden="true"
                      >
                        <path
                          d={cornerBarThumbPath(shape, THUMB_W, THUMB_H, 7)}
                          fill="none"
                          stroke={isActive ? '#2563eb' : '#0f172a'}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )
                })}
              </div>
            </div>

            {placementDraft ? (
              <div className="flex items-center justify-between gap-2 rounded bg-primary/5 px-2 py-1">
                <p className="text-[10px] leading-snug text-primary">
                  図面をドラッグすると{cornerBarCategoryLabel(placementDraft.category)}（
                  {cornerBarShapeLabel(placementDraft.shapeType)} / {placementDraft.diameter}）を
                  ドラッグした大きさで配置します。クリックだけでは配置されません。
                </p>
                <button
                  type="button"
                  onClick={() => onChangePlacementDraft(null)}
                  className="shrink-0 text-[11px] text-muted underline hover:text-foreground"
                >
                  やめる
                </button>
              </div>
            ) : (
              <p className="text-[10px] leading-snug text-muted">
                形状を選んだら空き場所をドラッグして配置します。既存の部材はクリックで選択できます。
              </p>
            )}
          </div>
        )}

        {/* Corner bar list — 編集中は隠して、スクロール量を増やさない */}
        {!selected && (
          <div className="p-3">
            {cornerBars.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-muted">
                まだ配置されていません。筋種類と鉄筋径を選び、形状をクリックしてから図面上をドラッグしてください。
              </p>
            ) : (
              <div className="space-y-0.5">
                {cornerBars.map((cb) => {
                  const shape = getCornerBarShape(cb.shape_type)
                  const segs = shape ? normalizeCornerBarSegments(shape, cb.segments) : []
                  return (
                    <div
                      key={cb.id}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-gray-50"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectCornerBar(cb.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: getSegmentStrokeHex(cb.color, false) }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {cb.label || cornerBarCategoryLabel(cb.category)}
                          <span className="ml-1 text-muted">
                            {formatCornerBarDims(segs) || cornerBarShapeLabel(cb.shape_type)}
                          </span>
                        </span>
                        <span className="shrink-0 text-muted">{cb.diameter ?? '—'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(cb.id)
                        }}
                        className="ml-1 shrink-0 text-[11px] text-danger hover:underline"
                      >
                        削除
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Summary */}
        {cornerBars.length > 0 && (
          <div className="border-t border-border px-4 py-3 space-y-2">
            <div className="flex flex-wrap gap-1">
              {CORNER_BAR_CATEGORIES.map((c) => {
                const n = countByCategory.get(c.id) ?? 0
                return (
                  <span
                    key={c.id}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      n > 0 ? 'bg-primary/10 text-foreground' : 'bg-gray-100 text-muted'
                    }`}
                  >
                    {c.label} <span className="font-semibold">{n}</span>
                  </span>
                )
              })}
            </div>
            <div className="space-y-0.5 border-t border-border pt-1.5">
              {countByCategoryDiameter.map((row) => (
                <div
                  key={`${row.category}/${row.diameter}`}
                  className="flex items-center justify-between text-[10px] text-muted"
                >
                  <span>
                    {cornerBarCategoryLabel(row.category)} {row.diameter}
                  </span>
                  <span className="text-foreground">{row.qty} 本</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
