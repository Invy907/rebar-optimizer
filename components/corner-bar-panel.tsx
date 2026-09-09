// components/corner-bar-panel.tsx

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { DrawingCornerBar } from '@/lib/types/database'
import { startGlobalLoading } from '@/lib/global-loading'
import {
  buildCornerBarPrintSummary,
  clampCornerBarSizePx,
  CORNER_BAR_CATEGORIES,
  CORNER_BAR_DIAMETERS,
  cornerBarCategoryLabel,
  cornerBarDiameterOptionLabel,
  cornerBarLegacyFieldsFromBars,
  cornerBarRotationLabel,
  cornerBarSegmentSumMm,
  cornerBarThumbPath,
  changeCornerBarBarDiameter,
  DEFAULT_CORNER_BAR_DIAMETER,
  DEFAULT_CORNER_BAR_SIZE_PX,
  getCornerBarShape,
  getCornerBarShapeOptionsForCategory,
  getNextCornerBarDiameter,
  isCornerBarBarsFullyDimensioned,
  makeCornerBarBar,
  makeCornerBarDraft,
  MEASUREMENT_TYPES,
  nextCornerBarBarId,
  nextCornerBarRotation,
  normalizeCornerBarBars,
  normalizeCornerBarRotation,
  resolveCategoryShape,
  type CornerBarBarItem,
  type CornerBarCategory,
  type CornerBarPlacementDraft,
  type CornerBarSegment,
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
  summaryHref,
  selectedCornerBarId,
  placementModeActive,
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
  /** 結果ページへのリンク先。末尾に付加筋 集計結果が付く */
  summaryHref: string
  selectedCornerBarId: string | null
  /** 配置ツールが有効なときだけ配置設定を表示 */
  placementModeActive: boolean
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
  const selectedBars = useMemo(
    () => (selected && selectedShape ? normalizeCornerBarBars(selectedShape, selected) : null),
    [selected, selectedShape],
  )
  const currentSizePx = clampCornerBarSizePx(selected?.size_px ?? DEFAULT_CORNER_BAR_SIZE_PX)

  const printSummary = useMemo(
    () => buildCornerBarPrintSummary(cornerBars, normalizeSegmentColor),
    [cornerBars],
  )

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
    // 形状も新しい筋種類に合わせる。形状が変わる場合、辺の寸法は入れ直す
    if (placementDraft) {
      onChangePlacementDraft(makeCornerBarDraft(shapeType, { ...placementDraft, category }))
    }
  }

  /** 鉄筋リストを保存する。旧列 diameter / segments には bars[0] をミラーする */
  function commitSelectedBars(bars: CornerBarBarItem[]) {
    if (!selected) return
    onUpdate(selected.id, { bars, ...cornerBarLegacyFieldsFromBars(bars) })
  }

  function handleSelectedCategoryChange(category: CornerBarCategory) {
    if (!selected || !selectedBars) return
    const shapeType = resolveCategoryShape(category, selected.shape_type)
    const shape = getCornerBarShape(shapeType)
    if (!shape) return
    // 形状が変わると辺の意味も変わるので、そのときだけ寸法を作り直す
    const shapeChanged = shapeType !== selected.shape_type
    const bars = selectedBars.map((bar) =>
      makeCornerBarBar(shape, category, bar.barType, {
        id: bar.id,
        quantity: bar.quantity,
        segments: shapeChanged ? undefined : bar.segments,
      }),
    )
    const updates: Partial<DrawingCornerBar> = {
      category,
      shape_type: shapeType,
      bars,
      ...cornerBarLegacyFieldsFromBars(bars),
    }
    onUpdate(selected.id, updates)
  }

  /** 径を変えたら、その径の標準寸法を辺に入れ直す（標準が無い径は空にする） */
  function handleSelectedBarTypeChange(index: number, barType: string) {
    if (!selected || !selectedShape || !selectedBars) return
    const bar = selectedBars[index]
    if (!bar) return
    const next = changeCornerBarBarDiameter(
      selectedShape,
      selected.category as CornerBarCategory,
      bar,
      barType,
    )
    commitSelectedBars(selectedBars.map((b, i) => (i === index ? next : b)))
  }

  function handleSelectedQuantityChange(index: number, quantity: number) {
    if (!selectedBars) return
    commitSelectedBars(selectedBars.map((b, i) => (i === index ? { ...b, quantity } : b)))
  }

  /** 鉄筋 1 件の辺の寸法・基準を 1 つだけ差し替える。順序は必ず保つ */
  function handleSelectedSegmentChange(
    barIndex: number,
    segIndex: number,
    patch: Partial<CornerBarSegment>,
  ) {
    if (!selectedBars) return
    commitSelectedBars(
      selectedBars.map((bar, i) =>
        i === barIndex
          ? {
              ...bar,
              segments: bar.segments.map((s, j) => (j === segIndex ? { ...s, ...patch } : s)),
            }
          : bar,
      ),
    )
  }

  function handleAddSelectedBar() {
    if (!selected || !selectedShape || !selectedBars) return
    const barType = getNextCornerBarDiameter(selectedBars.map((b) => b.barType))
    commitSelectedBars([
      ...selectedBars,
      makeCornerBarBar(selectedShape, selected.category as CornerBarCategory, barType, {
        id: nextCornerBarBarId(selectedBars),
      }),
    ])
  }

  function handleRemoveSelectedBar(index: number) {
    if (!selectedBars || selectedBars.length <= 1) return
    commitSelectedBars(selectedBars.filter((_, i) => i !== index))
  }

  const placementCategory = (placementDraft?.category ?? 'CORNER') as CornerBarCategory
  const placementShapeOptions = getCornerBarShapeOptionsForCategory(placementCategory)
  const placementShape = placementDraft ? getCornerBarShape(placementDraft.shapeType) : null
  /** 形状未選択のうちは編集できないので、見た目だけ既定の 1 件を出す */
  const placementBars: CornerBarBarItem[] = placementDraft?.bars?.length
    ? placementDraft.bars
    : [{ id: 'b1', barType: DEFAULT_CORNER_BAR_DIAMETER, quantity: 1, segments: [] }]

  function commitPlacementBars(bars: CornerBarBarItem[]) {
    if (!placementDraft) return
    onChangePlacementDraft({ ...placementDraft, bars })
  }

  function handlePlacementBarTypeChange(index: number, barType: string) {
    if (!placementDraft || !placementShape) return
    const bar = placementDraft.bars[index]
    if (!bar) return
    const next = changeCornerBarBarDiameter(
      placementShape,
      placementDraft.category,
      bar,
      barType,
    )
    commitPlacementBars(placementDraft.bars.map((b, i) => (i === index ? next : b)))
  }

  function handlePlacementQuantityChange(index: number, quantity: number) {
    if (!placementDraft) return
    commitPlacementBars(
      placementDraft.bars.map((b, i) => (i === index ? { ...b, quantity } : b)),
    )
  }

  /** 配置前でも辺の寸法・基準を直せる。配置したらそのまま保存される */
  function handlePlacementSegmentChange(
    barIndex: number,
    segIndex: number,
    patch: Partial<CornerBarSegment>,
  ) {
    if (!placementDraft) return
    commitPlacementBars(
      placementDraft.bars.map((bar, i) =>
        i === barIndex
          ? {
              ...bar,
              segments: bar.segments.map((s, j) => (j === segIndex ? { ...s, ...patch } : s)),
            }
          : bar,
      ),
    )
  }

  function handleAddPlacementBar() {
    if (!placementDraft || !placementShape) return
    const barType = getNextCornerBarDiameter(placementDraft.bars.map((b) => b.barType))
    commitPlacementBars([
      ...placementDraft.bars,
      makeCornerBarBar(placementShape, placementDraft.category, barType, {
        id: nextCornerBarBarId(placementDraft.bars),
      }),
    ])
  }

  function handleRemovePlacementBar(index: number) {
    if (!placementDraft || placementDraft.bars.length <= 1) return
    commitPlacementBars(placementDraft.bars.filter((_, i) => i !== index))
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
        {selected && selectedShape && selectedBars && (
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

            <label className="block text-[10px] text-muted">
              筋種類
              <select
                value={selected.category}
                onChange={(e) => handleSelectedCategoryChange(e.target.value as CornerBarCategory)}
                className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
              >
                {CORNER_BAR_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

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

            {/* 径ごとの本数と辺の寸法。同じ位置でも径によって実寸が違うため個別に持つ */}
            <CornerBarBarsField
              category={selected.category as CornerBarCategory}
              bars={selectedBars}
              showSegments
              onChangeBarType={handleSelectedBarTypeChange}
              onChangeQuantity={handleSelectedQuantityChange}
              onChangeSegment={handleSelectedSegmentChange}
              onAdd={handleAddSelectedBar}
              onRemove={handleRemoveSelectedBar}
            />
            {!isCornerBarBarsFullyDimensioned(selectedBars) && (
              <p className="text-[10px] text-amber-700">寸法が未入力の辺があります。</p>
            )}

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

        {/* 配置設定: 配置ツール中のみ（選択モードでは一覧・要約だけ） */}
        {!selected && placementModeActive && (
        <div className="border-b border-border p-3 space-y-2">
            <label className="block text-[10px] text-muted">
              筋種類
              <select
                value={placementCategory}
                onChange={(e) => handlePlacementCategoryChange(e.target.value as CornerBarCategory)}
                className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
              >
                {CORNER_BAR_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            {/* 添え筋＝ストレート、コーナー筋＝L形 4 向き。それ以外は全形状 */}
            <div>
              <span className="text-[10px] text-muted">形状</span>
              <div
                className={`mt-1 grid gap-1.5 ${
                  placementCategory === 'CORNER'
                    ? 'grid-cols-4'
                    : placementCategory === 'SOE' || placementCategory === 'SPECIAL_CORNER'
                      ? 'grid-cols-2'
                      : 'grid-cols-3'
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

            {/* 径と本数に加えて辺の寸法もここで決める。配置後も右パネルで直せる */}
            <CornerBarBarsField
              category={placementCategory}
              bars={placementBars}
              showSegments
              disabled={!placementDraft}
              onChangeBarType={handlePlacementBarTypeChange}
              onChangeQuantity={handlePlacementQuantityChange}
              onChangeSegment={handlePlacementSegmentChange}
              onAdd={handleAddPlacementBar}
              onRemove={handleRemovePlacementBar}
            />
            {!placementDraft ? (
              <p className="text-[10px] text-muted">
                先に形状を選ぶと鉄筋を設定できます。
              </p>
            ) : (
              !isCornerBarBarsFullyDimensioned(placementDraft.bars) && (
                <p className="text-[10px] text-amber-700">寸法が未入力の辺があります。</p>
              )
            )}

            <label className="text-[10px] text-muted">
              色
              <ColorSelect value={placementColor} onChange={onPlacementColorChange} />
            </label>
        </div>
        )}

        {/* Summary */}
        {cornerBars.length === 0 ? (
          <p className="px-3 pb-3 text-[11px] leading-relaxed text-muted">
            まだ配置されていません。
          </p>
        ) : (
          <div className="border-t border-border px-4 py-3 space-y-2">
            <Link
              href={summaryHref}
              onClick={() => startGlobalLoading()}
              className="block rounded-md bg-primary px-2 py-1.5 text-center text-[11px] font-medium text-white hover:bg-primary-hover"
            >
              結果ページを見る
            </Link>
            <div className="flex flex-wrap gap-1">
              {printSummary.categoryCounts.map((c) => (
                <span
                  key={c.category}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    c.count > 0 ? 'bg-primary/10 text-foreground' : 'bg-gray-100 text-muted'
                  }`}
                >
                  {c.label} <span className="font-semibold">{c.count}</span>
                </span>
              ))}
            </div>
            <div className="space-y-0.5 border-t border-border pt-1.5">
              {printSummary.detailRows.map((row) => (
                <div
                  key={`${row.category}/${row.diameter}/${row.color}`}
                  className="flex items-center justify-between gap-2 text-[10px] text-muted"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{
                        backgroundColor: getSegmentStrokeHex(
                          normalizeSegmentColor(row.color),
                          false,
                        ),
                      }}
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

/**
 * 1 配置に入る鉄筋の一覧。径と本数は常に、辺の寸法は showSegments のときだけ編集する。
 * 配置設定では形状未選択のあいだ disabled になる。
 */
function CornerBarBarsField({
  category,
  bars,
  showSegments,
  disabled = false,
  onChangeBarType,
  onChangeQuantity,
  onChangeSegment,
  onAdd,
  onRemove,
}: {
  category: CornerBarCategory
  bars: CornerBarBarItem[]
  showSegments: boolean
  disabled?: boolean
  onChangeBarType: (index: number, barType: string) => void
  onChangeQuantity: (index: number, quantity: number) => void
  onChangeSegment?: (
    barIndex: number,
    segIndex: number,
    patch: Partial<CornerBarSegment>,
  ) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-foreground">鉄筋（径と本数）</span>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="text-[11px] text-primary hover:underline disabled:opacity-40"
        >
          ＋ 追加
        </button>
      </div>

      {bars.map((bar, barIdx) => (
        <div key={bar.id} className="space-y-1.5 rounded border border-border bg-white p-1.5">
          <div className="flex items-center gap-1.5">
            <select
              value={bar.barType}
              disabled={disabled}
              onChange={(e) => onChangeBarType(barIdx, e.target.value)}
              className="min-w-0 flex-1 rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary disabled:opacity-50"
            >
              {CORNER_BAR_DIAMETERS.map((d) => (
                <option key={d} value={d}>
                  {cornerBarDiameterOptionLabel(category, d)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={bar.quantity}
              disabled={disabled}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10)
                onChangeQuantity(barIdx, Number.isFinite(n) && n >= 0 ? n : 0)
              }}
              className="w-12 shrink-0 rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary disabled:opacity-50"
            />
            <span className="shrink-0 text-[10px] text-muted">本</span>
            <button
              type="button"
              onClick={() => onRemove(barIdx)}
              disabled={disabled || bars.length <= 1}
              className="shrink-0 text-[11px] text-danger hover:underline disabled:opacity-30"
              title={bars.length <= 1 ? '最後の1件は削除できません' : '削除'}
            >
              削除
            </button>
          </div>

          {showSegments && onChangeSegment && bar.segments.length > 0 ? (
            <div className="space-y-1 border-t border-border pt-1.5">
              {bar.segments.map((seg, segIdx) => (
                <div key={seg.id} className="flex items-center gap-1.5">
                  <span className="w-7 shrink-0 text-[10px] text-muted">辺{segIdx + 1}</span>
                  <input
                    type="number"
                    min={1}
                    placeholder="mm"
                    value={seg.lengthMm ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        onChangeSegment(barIdx, segIdx, { lengthMm: null })
                        return
                      }
                      const n = Number.parseInt(raw, 10)
                      if (!Number.isFinite(n) || n <= 0) return
                      onChangeSegment(barIdx, segIdx, { lengthMm: n })
                    }}
                    className="min-w-0 flex-1 rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                  />
                  <select
                    value={seg.measurementType ?? ''}
                    onChange={(e) =>
                      onChangeSegment(barIdx, segIdx, {
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
              <div className="text-right text-[10px] text-muted">
                合計 {cornerBarSegmentSumMm(bar.segments).toLocaleString('ja-JP')} mm
              </div>
            </div>
          ) : null}
        </div>
      ))}
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
