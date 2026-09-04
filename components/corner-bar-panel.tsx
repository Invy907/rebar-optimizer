// components/corner-bar-panel.tsx

'use client'

import { useMemo, useState } from 'react'
import type { DrawingCornerBar } from '@/lib/types/database'
import {
  applyStandardSegmentLengths,
  clampCornerBarSizePx,
  CORNER_BAR_CATEGORIES,
  CORNER_BAR_DIAMETERS,
  cornerBarCategoryLabel,
  cornerBarDiameterOptionLabel,
  cornerBarRotationLabel,
  cornerBarSegmentSumMm,
  cornerBarThumbPath,
  DEFAULT_CORNER_BAR_SIZE_PX,
  getCornerBarShape,
  getCornerBarShapeOptionsForCategory,
  isCategoryShapeFixed,
  isCornerBarFullyDimensioned,
  makeCornerBarDraft,
  makeCornerBarSegments,
  MEASUREMENT_TYPES,
  nextCornerBarRotation,
  normalizeCornerBarRotation,
  normalizeCornerBarSegments,
  resolveCategoryShape,
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
  type SegmentColor,
} from '@/lib/segment-colors'

const THUMB_W = 56
const THUMB_H = 42

/** − ＋ 1 回あたりの拡大縮小率 */
const SIZE_STEP = 1.25

export function CornerBarPanel({
  cornerBars,
  selectedCornerBarId,
  placementDraft,
  placementColor,
  onPlacementColorChange,
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
  placementColor: SegmentColor
  onPlacementColorChange: (color: SegmentColor) => void
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

  /** 筋種類 × 鉄筋径 × 色の集計 */
  const countByCategoryDiameter = useMemo(() => {
    const map = new Map<
      string,
      { category: string; diameter: string; color: SegmentColor; qty: number }
    >()
    for (const cb of cornerBars) {
      const diameter = cb.diameter ?? '径未設定'
      const color = normalizeSegmentColor(cb.color ?? 'red')
      const key = `${cb.category}/${diameter}/${color}`
      const prev = map.get(key)
      if (prev) prev.qty += 1
      else map.set(key, { category: cb.category, diameter, color, qty: 1 })
    }
    return [...map.values()].sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        a.diameter.localeCompare(b.diameter) ||
        a.color.localeCompare(b.color),
    )
  }, [cornerBars])

  function patchDraft(patch: Partial<CornerBarPlacementDraft>) {
    if (!placementDraft) return
    onChangePlacementDraft({ ...placementDraft, ...patch })
  }

  function handlePlacementCategoryChange(category: CornerBarCategory) {
    const shapeType = resolveCategoryShape(category, placementDraft?.shapeType)
    if (category === 'SOE') {
      onChangePlacementDraft(
        makeCornerBarDraft('STRAIGHT', {
          ...(placementDraft ?? {}),
          category,
          rotation: 0,
        }),
      )
      return
    }
    if (category === 'CORNER') {
      if (placementDraft) {
        onChangePlacementDraft(
          makeCornerBarDraft('L', {
            ...placementDraft,
            category,
          }),
        )
      } else {
        onChangePlacementDraft(null)
      }
      return
    }
    if (placementDraft) patchDraft({ category })
  }

  function handleSelectedCategoryChange(category: CornerBarCategory) {
    if (!selected) return
    const shapeType = resolveCategoryShape(category, selected.shape_type)
    const shape = getCornerBarShape(shapeType)
    if (!shape) return
    const preserveSegments =
      shapeType === selected.shape_type ? selectedSegments ?? undefined : undefined
    const updates: Partial<DrawingCornerBar> = {
      category,
      shape_type: shapeType,
      segments: applyStandardSegmentLengths(
        shape,
        category,
        selected.diameter ?? 'D13',
        preserveSegments,
      ),
    }
    onUpdate(selected.id, updates)
  }

  function handleSelectedDiameterChange(diameter: string) {
    if (!selected || !selectedShape || !selectedSegments) return
    const category = selected.category as CornerBarCategory
    onUpdate(selected.id, {
      diameter: diameter || null,
      segments: applyStandardSegmentLengths(
        selectedShape,
        category,
        diameter || 'D13',
        selectedSegments,
      ),
    })
  }

  const placementCategory = (placementDraft?.category ?? 'CORNER') as CornerBarCategory
  const placementShapeOptions = getCornerBarShapeOptionsForCategory(placementCategory)

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

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-muted">
                筋種類
                <select
                  value={selected.category}
                  onChange={(e) =>
                    handleSelectedCategoryChange(e.target.value as CornerBarCategory)
                  }
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
                  onChange={(e) => handleSelectedDiameterChange(e.target.value)}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                >
                  <option value="">未設定</option>
                  {CORNER_BAR_DIAMETERS.map((d) => (
                    <option key={d} value={d}>
                      {cornerBarDiameterOptionLabel(selected.category as CornerBarCategory, d)}
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
            </div>

            <label className="text-[10px] text-muted">
              色
              <ColorSelect
                value={normalizeSegmentColor(selected.color)}
                onChange={(color) => onUpdate(selected.id, { color })}
              />
            </label>
          </div>
        )}

        {/* 配置設定: 筋種類・鉄筋径・向きを決めてから形状を選ぶ（ユニットのユニット選択と同様、編集中も表示） */}
        <div className="border-b border-border p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-muted">
                筋種類
                <select
                  value={placementCategory}
                  onChange={(e) =>
                    handlePlacementCategoryChange(e.target.value as CornerBarCategory)
                  }
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
                      {cornerBarDiameterOptionLabel(placementCategory, d)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="text-[10px] text-muted">
              色
              <ColorSelect value={placementColor} onChange={onPlacementColorChange} />
            </label>

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

            {/* 添え筋＝ストレート、コーナー筋＝L形 4 向き。それ以外は全形状 */}
            <div>
              <span className="text-[10px] text-muted">形状</span>
              <div
                className={`mt-1 grid gap-1.5 ${
                  placementCategory === 'CORNER' ? 'grid-cols-4' : 'grid-cols-3'
                }`}
              >
                {placementShapeOptions.map((option) => {
                  const isActive =
                    placementDraft?.shapeType === option.shapeType &&
                    normalizeCornerBarRotation(placementDraft.rotation) === option.rotation
                  return (
                    <button
                      key={option.key}
                      type="button"
                      title={option.label}
                      aria-label={option.label}
                      aria-pressed={isActive}
                      onClick={() =>
                        onChangePlacementDraft(
                          isActive
                            ? null
                            : makeCornerBarDraft(option.shapeType, {
                                ...(placementDraft ?? { category: placementCategory }),
                                rotation: option.rotation,
                              }),
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
                          d={cornerBarThumbPath(option.shape, THUMB_W, THUMB_H, 7, option.rotation)}
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

        </div>

        {/* Summary */}
        {cornerBars.length === 0 ? (
          <p className="px-3 pb-3 text-[11px] leading-relaxed text-muted">
            まだ配置されていません。
          </p>
        ) : (
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
                  key={`${row.category}/${row.diameter}/${row.color}`}
                  className="flex items-center justify-between gap-2 text-[10px] text-muted"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: getSegmentStrokeHex(row.color, false) }}
                    />
                    <span className="truncate">
                      {cornerBarCategoryLabel(row.category)} {row.diameter}
                    </span>
                  </span>
                  <span className="shrink-0 text-foreground">{row.qty} 本</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ColorSelect({
  value,
  onChange,
}: {
  value: SegmentColor
  onChange: (color: SegmentColor) => void
}) {
  const [open, setOpen] = useState(false)
  const current =
    SEGMENT_COLOR_DEFINITIONS.find((d) => d.id === value) ?? SEGMENT_COLOR_DEFINITIONS[0]!

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-0.5 flex w-full items-center gap-2 rounded border border-border bg-white px-2 py-1.5 text-xs outline-none hover:bg-gray-50 focus:border-primary"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
          style={{ backgroundColor: current.stroke }}
          aria-hidden
        />
        <span className="flex-1 text-left text-foreground">{current.labelJa}</span>
        <span className="text-muted" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            aria-label="閉じる"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded border border-border bg-white py-1 shadow-md"
            role="listbox"
          >
            {SEGMENT_COLOR_DEFINITIONS.map((d) => {
              const active = d.id === value
              return (
                <button
                  key={d.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(d.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-gray-50 ${
                    active ? 'bg-primary/5 font-medium' : ''
                  }`}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: d.stroke }}
                    aria-hidden
                  />
                  <span className="text-foreground">{d.labelJa}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}
