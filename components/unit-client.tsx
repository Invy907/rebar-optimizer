// components/unit-client.tsx

'use client'

import { useState, useMemo, useEffect, useRef, type ReactNode, type PointerEvent as SvgPointerEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Unit, UnitRebarLayout } from '@/lib/types/database'
import type { SegmentColor } from '@/lib/segment-colors'
import type { ExtendedShapeType, LocationType, UnitBar } from '@/lib/unit-types'
import {
  getSegmentCardTint,
  getSegmentColorLabelJa,
  getSegmentStrokeHex,
  normalizeSegmentColor,
  SEGMENT_COLOR_DEFINITIONS,
} from '@/lib/segment-colors'
import {
  LOCATION_TYPES,
  SHAPE_TYPE_DEFS,
  UNIT_TEMPLATES,
  generateUnitCode,
  getShapeLabel,
  getShapeIcon,
} from '@/lib/unit-types'
import {
  buildShapeSketch,
  getDefaultDetailSpec,
  normalizeDetailSpecForTemplate,
  shapeTypeToDetailTemplate,
  type DetailShapeTemplate,
  type ShapeHandle,
  type UnitDetailGeometry,
  type UnitDetailSpec,
} from '@/lib/unit-detail-shape'
import {
  deleteUserPresetFromDb,
  fetchUserPresetsFromDb,
  insertUserPresetToDb,
  remapRebarLayoutIds,
  type UserUnitPreset,
  type UserUnitPresetPayload,
} from '@/lib/user-unit-presets'
import {
  formatVariantMarkBadge,
  listUnitVariantsInGroup,
  unitVariantGroupKey,
  unitVariantLengthMm,
} from '@/lib/unit-variant-group'

const BAR_TYPES = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25', 'D29', 'D32']

/** 新規作成のデフォルト: 空キャンバス＋自由作成 */
function createEmptyFreeGeometry(): UnitDetailGeometry {
  return {
    templateType: 'straight',
    points: [],
    segments: [],
    bounds: { minX: 0, minY: -400, maxX: 960, maxY: 0 },
  }
}

/** 間隔・注記テキストから数値(mm)を解釈（形状編集キャンバスとプレビューで共通） */
function parseSpacingMm(label: string | null | undefined): number | null {
  const s = String(label ?? '').trim()
  if (!s) return null
  const m = s.match(/@?(\d+)/)
  if (!m) return null
  const v = parseInt(m[1], 10)
  return Number.isFinite(v) ? v : null
}

// ─── ドラフト型 ─────────────────────────────────────────
type DraftUnit = {
  name: string
  code: string
  location_type: LocationType
  shape_type: ExtendedShapeType
  color: SegmentColor
  mark_number: string
  length_mm: string
  bars: UnitBar[]
  spacing_mm: string
  description: string
  is_active: boolean
  template_id: string | null
  detail_spec: UnitDetailSpec | null
  detail_geometry: UnitDetailGeometry | null
  detail_start_mode: 'template' | 'free'
  rebar_layout: UnitRebarLayout
}

const DEFAULT_DRAFT: DraftUnit = {
  name: '',
  code: '',
  location_type: '外周部',
  shape_type: 'straight',
  color: 'red',
  mark_number: '1',
  length_mm: '',
  bars: [],
  spacing_mm: '',
  description: '',
  is_active: true,
  template_id: null,
  detail_spec: getDefaultDetailSpec('straight'),
  detail_geometry: createEmptyFreeGeometry(),
  detail_start_mode: 'free',
  rebar_layout: { rebars: [], spacings: [], annotations: [] },
}

function normalizeRebarLayout(input: UnitRebarLayout | null | undefined): UnitRebarLayout {
  const base = input ?? { rebars: [], spacings: [], annotations: [] }
  return {
    rebars: Array.isArray(base.rebars) ? base.rebars : [],
    spacings: Array.isArray(base.spacings) ? base.spacings : [],
    annotations: Array.isArray(base.annotations) ? base.annotations : [],
  }
}

function draftFromUnit(unit: Unit): DraftUnit {
  const normalizedLayout = normalizeRebarLayout(unit.rebar_layout)
  const barsFromLayout = aggregateBarsFromRebarLayout(normalizedLayout)
  const tmpl = shapeTypeToDetailTemplate(unit.shape_type as ExtendedShapeType)
  const spec = normalizeDetailSpecForTemplate(tmpl, unit.detail_spec)
  const builtGeometry = buildShapeSketch(tmpl, spec).geometry
  const storedGeo = unit.detail_geometry
  /** 点がある自由作図、または点0・線0の空キャンバス保存を自由作図として復元する */
  const segCount = Array.isArray(storedGeo?.segments) ? storedGeo!.segments.length : 0
  const hasFreeDraw =
    storedGeo != null &&
    Array.isArray(storedGeo.points) &&
    (storedGeo.points.length > 0 || (storedGeo.points.length === 0 && segCount === 0))
  return {
    name: unit.name,
    code: unit.code ?? '',
    location_type: (unit.location_type as LocationType) ?? '外周部',
    shape_type: unit.shape_type as ExtendedShapeType,
    color: normalizeSegmentColor(unit.color),
    mark_number: unit.mark_number != null ? String(unit.mark_number) : '1',
    length_mm:
      unit.length_mm != null
        ? String(unit.length_mm)
        : unit.spacing_mm != null
          ? String(unit.spacing_mm)
          : '',
    bars:
      normalizedLayout.rebars.length > 0
        ? barsFromLayout
        : unit.bars.length > 0
          ? unit.bars.map((b) => ({ diameter: b.diameter, qtyPerUnit: b.qtyPerUnit, spacing: b.spacing }))
          : [],
    spacing_mm: unit.spacing_mm != null ? String(unit.spacing_mm) : '',
    description: unit.description ?? '',
    is_active: unit.is_active,
    template_id: unit.template_id ?? null,
    detail_spec: spec,
    detail_geometry: hasFreeDraw ? storedGeo! : builtGeometry,
    detail_start_mode: hasFreeDraw ? 'free' : 'template',
    rebar_layout: normalizedLayout,
  }
}

// ─── フィルタ型 ─────────────────────────────────────────
type FilterState = {
  locationType: string
  showInactive: boolean
  searchText: string
}

type UnitVariantGroup = {
  key: string
  representative: Unit
  variants: Unit[]
}

// ─── ユーティリティ ──────────────────────────────────────
function getNextDiameter(existing: string[]): string {
  return BAR_TYPES.find((b) => !existing.includes(b)) ?? 'D10'
}

function barsSummary(bars: UnitBar[]): string {
  if (!bars || bars.length === 0) return '-'
  return bars.map((b) => `${b.diameter}×${b.qtyPerUnit}`).join(', ')
}

function getEditableDimFields(template: DetailShapeTemplate): Array<{ key: keyof UnitDetailSpec; label: string }> {
  if (template === 'straight') {
    return [
      { key: 'topHorizontalLength', label: '上部水平長さ' },
      { key: 'pitch', label: 'ピッチ' },
    ]
  }
  if (template === 'corner_L' || template === 'corner_out' || template === 'corner_in') {
    return [
      { key: 'leftHeight', label: '左高さ' },
      { key: 'topHorizontalLength', label: '上部水平長さ' },
      { key: 'bottomLeftLength', label: '下部左長さ' },
      { key: 'bottomRightLength', label: '下部右長さ' },
      { key: 'pitch', label: 'ピッチ' },
    ]
  }
  if (template === 'corner_T') {
    return [
      { key: 'leftHeight', label: '左高さ' },
      { key: 'rightHeight', label: '右高さ' },
      { key: 'topHorizontalLength', label: '上部水平長さ' },
      { key: 'centerBentLength', label: '中間折曲長さ' },
      { key: 'centerVerticalOffset', label: '中間縦オフセット' },
      { key: 'pitch', label: 'ピッチ' },
    ]
  }
  if (template === 'cross') {
    return [
      { key: 'leftHeight', label: '左高さ' },
      { key: 'rightHeight', label: '右高さ' },
      { key: 'topHorizontalLength', label: '上部水平長さ' },
      { key: 'centerBentLength', label: '中間折曲長さ' },
      { key: 'centerVerticalOffset', label: '中間縦オフセット' },
      { key: 'pitch', label: 'ピッチ' },
    ]
  }
  if (template === 'opening') {
    return [
      { key: 'topHorizontalLength', label: '開口幅' },
      { key: 'leftHeight', label: '開口高さ' },
      { key: 'pitch', label: 'ピッチ' },
    ]
  }
  if (template === 'joint') {
    return [
      { key: 'topHorizontalLength', label: '上部水平長さ' },
      { key: 'centerBentLength', label: 'ジョイント縦長さ' },
      { key: 'pitch', label: 'ピッチ' },
    ]
  }
  return [
    { key: 'topHorizontalLength', label: 'メッシュ幅' },
    { key: 'leftHeight', label: 'メッシュ高さ' },
    { key: 'pitch', label: 'ピッチ' },
  ]
}

function inferShapeTypeFromGeometry(geometry: UnitDetailGeometry | null): ExtendedShapeType {
  if (!geometry || geometry.points.length <= 1 || geometry.segments.length === 0) return 'straight'

  const degree = new Map<string, number>()
  for (const s of geometry.segments) {
    degree.set(s.from, (degree.get(s.from) ?? 0) + 1)
    degree.set(s.to, (degree.get(s.to) ?? 0) + 1)
  }
  const degrees = [...degree.values()]
  const deg4 = degrees.some((d) => d >= 4)
  if (deg4) return 'cross'
  const deg3 = degrees.some((d) => d >= 3)
  if (deg3) return 'corner_T'

  const endpointCount = degrees.filter((d) => d === 1).length
  const closedLike = endpointCount === 0 && degrees.every((d) => d === 2)
  if (closedLike) return 'corner_in'

  const byKey = Object.fromEntries(geometry.points.map((p) => [p.key, p]))
  const adjacency = new Map<string, string[]>()
  for (const s of geometry.segments) {
    adjacency.set(s.from, [...(adjacency.get(s.from) ?? []), s.to])
    adjacency.set(s.to, [...(adjacency.get(s.to) ?? []), s.from])
  }
  let turnCount = 0
  for (const p of geometry.points) {
    const nei = adjacency.get(p.key) ?? []
    if (nei.length !== 2) continue
    const a = byKey[nei[0]]
    const b = byKey[nei[1]]
    if (!a || !b) continue
    const v1x = a.x - p.x
    const v1y = a.y - p.y
    const v2x = b.x - p.x
    const v2y = b.y - p.y
    const dot = v1x * v2x + v1y * v2y
    const m1 = Math.hypot(v1x, v1y)
    const m2 = Math.hypot(v2x, v2y)
    if (m1 < 1e-4 || m2 < 1e-4) continue
    const cos = dot / (m1 * m2)
    if (Math.abs(cos) < 0.95) turnCount += 1
  }
  if (turnCount <= 0) return 'straight'
  if (turnCount === 1) return 'corner_L'
  if (turnCount >= 2) return 'corner_out'
  return 'straight'
}

function aggregateBarsFromRebarLayout(layout: UnitRebarLayout): UnitBar[] {
  const byDiameter = new Map<string, number>()
  for (const rb of layout.rebars) {
    const d = rb.diameter || 'D13'
    byDiameter.set(d, (byDiameter.get(d) ?? 0) + 1)
  }
  const fromLayout = [...byDiameter.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([diameter, qtyPerUnit]) => ({ diameter, qtyPerUnit }))
  /** キャンバスに鉄筋が無いときは空配列（従来の D13×1 フォールバックは保存に紛れ込むため廃止） */
  return fromLayout
}

function draftToPresetPayload(draft: DraftUnit): UserUnitPresetPayload {
  const t = shapeTypeToDetailTemplate(draft.shape_type)
  const spec = normalizeDetailSpecForTemplate(t, draft.detail_spec ?? getDefaultDetailSpec(t))
  const layout = normalizeRebarLayout(draft.rebar_layout)
  return {
    location_type: draft.location_type,
    shape_type: draft.shape_type,
    color: draft.color,
    mark_number: draft.mark_number,
    bars: aggregateBarsFromRebarLayout(layout).map((b) => ({ ...b })),
    spacing_mm: draft.spacing_mm,
    description: draft.description,
    detail_spec: spec,
    detail_geometry: draft.detail_geometry ? JSON.parse(JSON.stringify(draft.detail_geometry)) : null,
    detail_start_mode: draft.detail_start_mode,
    rebar_layout: layout,
  }
}

// ─── メインコンポーネント ─────────────────────────────────
export function UnitClient({ initialUnits }: { initialUnits: Unit[] }) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current === null) {
    supabaseRef.current = createClient()
  }
  const supabase = supabaseRef.current
  const router = useRouter()

  const [units, setUnits] = useState<Unit[]>(() => initialUnits)

  useEffect(() => {
    setUnits(initialUnits)
  }, [initialUnits])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [draft, setDraft] = useState<DraftUnit>(DEFAULT_DRAFT)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [openShapeEditorOnModal, setOpenShapeEditorOnModal] = useState(false)
  const [modalTab, setModalTab] = useState<'basic' | 'detail'>('basic')
  const [previewUnit, setPreviewUnit] = useState<Unit | null>(null)
  const detailShapeSectionRef = useRef<HTMLDivElement | null>(null)
  const [detailEditMode, setDetailEditMode] = useState<'shape' | 'rebar' | 'annotation'>('shape')
  const [userPresets, setUserPresets] = useState<UserUnitPreset[]>([])
  const [variantLengths, setVariantLengths] = useState<string[]>([''])
  const [variantMarkOverrides, setVariantMarkOverrides] = useState<string[]>([''])
  const [variantRowIds, setVariantRowIds] = useState<string[]>([])
  const [duplicateSourceId, setDuplicateSourceId] = useState<string>('')
  const [systemTplPick, setSystemTplPick] = useState<string>('')
  const [filter, setFilter] = useState<FilterState>({
    locationType: 'all',
    showInactive: false,
    searchText: '',
  })

  useEffect(() => {
    if (!modalOpen) return
    let cancelled = false
    void (async () => {
      const list = await fetchUserPresetsFromDb(supabaseRef.current!)
      if (!cancelled) setUserPresets(list)
    })()
    return () => {
      cancelled = true
    }
  }, [modalOpen])

  // ─── フィルタ適用 ──────────────────────────────────────
  const filteredUnits = useMemo(() => {
    return units.filter((u) => {
      if (!filter.showInactive && !u.is_active) return false
      if (filter.locationType !== 'all' && u.location_type !== filter.locationType) return false
      if (filter.searchText.trim()) {
        const q = filter.searchText.toLowerCase()
        if (
          !u.name.toLowerCase().includes(q) &&
          !(u.code ?? '').toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }, [units, filter])

  const groupedUnits = useMemo<UnitVariantGroup[]>(() => {
    const map = new Map<string, UnitVariantGroup>()
    for (const u of filteredUnits) {
      const key = unitVariantGroupKey(u)
      const ex = map.get(key)
      if (!ex) {
        map.set(key, { key, representative: u, variants: [u] })
      } else {
        ex.variants.push(u)
      }
    }
    return [...map.values()].map((g) => ({
      ...g,
      variants: g.variants.slice().sort((a, b) => (a.mark_number ?? 9999) - (b.mark_number ?? 9999)),
    }))
  }, [filteredUnits])

  // ─── モーダル開閉 ──────────────────────────────────────
  function openCreate() {
    setEditingUnit(null)
    setDraft({ ...DEFAULT_DRAFT })
    setVariantLengths([''])
    setVariantMarkOverrides([''])
    setVariantRowIds([])
    setDuplicateSourceId('')
    setSystemTplPick('')
    setOpenShapeEditorOnModal(false)
    setModalTab('basic')
    setModalOpen(true)
  }

  function startFromEmptyCanvas() {
    setEditingUnit(null)
    setDraft({ ...DEFAULT_DRAFT })
    setVariantLengths([''])
    setVariantMarkOverrides([''])
    setVariantRowIds([])
    setDuplicateSourceId('')
    setDetailEditMode('shape')
    setModalTab('detail')
  }

  function applyUserPreset(preset: UserUnitPreset) {
    const p = preset.payload
    const t = shapeTypeToDetailTemplate(p.shape_type)
    const spec = normalizeDetailSpecForTemplate(t, p.detail_spec)
    const layout = remapRebarLayoutIds(normalizeRebarLayout(p.rebar_layout))
    setEditingUnit(null)
    setDraft({
      name: preset.name,
      code: '',
      location_type: p.location_type,
      shape_type: p.shape_type,
      color: normalizeSegmentColor(p.color),
      mark_number: p.mark_number,
      length_mm: '',
      bars: aggregateBarsFromRebarLayout(layout),
      spacing_mm: p.spacing_mm,
      description: p.description,
      is_active: true,
      template_id: null,
      detail_spec: spec,
      detail_geometry: p.detail_geometry
        ? JSON.parse(JSON.stringify(p.detail_geometry))
        : createEmptyFreeGeometry(),
      detail_start_mode: p.detail_start_mode ?? 'free',
      rebar_layout: layout,
    })
    setVariantLengths([''])
    setVariantMarkOverrides([''])
    setVariantRowIds([])
    setDetailEditMode('shape')
    setModalTab('detail')
  }

  async function handleSaveAsPreset() {
    const suggested = draft.name.trim() || 'マイプリセット'
    const name = window.prompt('プリセット名を入力してください', suggested)?.trim()
    if (!name) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      alert('ログインが必要です。')
      return
    }
    const preset = await insertUserPresetToDb(supabase, {
      name,
      payload: draftToPresetPayload(draft),
    })
    if (!preset) {
      alert('プリセットの保存に失敗しました。')
      return
    }
    setUserPresets((prev) => [preset, ...prev])
    alert('プリセットを保存しました（アカウントに保存）')
  }

  async function deleteUserPreset(id: string) {
    if (!window.confirm('このプリセットを削除しますか？')) return
    const ok = await deleteUserPresetFromDb(supabase, id)
    if (!ok) {
      alert('削除に失敗しました。')
      return
    }
    setUserPresets((prev) => prev.filter((p) => p.id !== id))
  }

  function applyDuplicateFromUnit() {
    if (!duplicateSourceId) {
      alert('複製元のユニットを選択してください。')
      return
    }
    const u = units.find((x) => x.id === duplicateSourceId)
    if (!u) return
    const d = draftFromUnit(u)
    setEditingUnit(null)
    setDraft({
      ...d,
      name: `${u.name}（複製）`,
      code: '',
      template_id: null,
    })
    setVariantLengths([d.length_mm || ''])
    setVariantMarkOverrides([''])
    setVariantRowIds([])
    setDetailEditMode('shape')
    setModalTab('detail')
  }

  function openEdit(unit: Unit) {
    const key = unitVariantGroupKey(unit)
    const siblings = units
      .filter((x) => unitVariantGroupKey(x) === key)
      .sort((a, b) => (a.mark_number ?? 9999) - (b.mark_number ?? 9999))
    const base = siblings[0] ?? unit
    setEditingUnit(base)
    const d = draftFromUnit(base)
    setDraft(d)
    setVariantLengths(
      siblings.map((x) =>
        x.length_mm != null ? String(x.length_mm) : x.spacing_mm != null ? String(x.spacing_mm) : '',
      ),
    )
    setVariantMarkOverrides(siblings.map((x) => (x.mark_number != null ? String(x.mark_number) : '')))
    setVariantRowIds(siblings.map((x) => x.id))
    setOpenShapeEditorOnModal(false)
    setModalTab('basic')
    setModalOpen(true)
  }

  function openEditShape(unit: Unit) {
    const key = unitVariantGroupKey(unit)
    const siblings = units
      .filter((x) => unitVariantGroupKey(x) === key)
      .sort((a, b) => (a.mark_number ?? 9999) - (b.mark_number ?? 9999))
    const base = siblings[0] ?? unit
    setEditingUnit(base)
    const d = draftFromUnit(base)
    setDraft(d)
    setVariantLengths(
      siblings.map((x) =>
        x.length_mm != null ? String(x.length_mm) : x.spacing_mm != null ? String(x.spacing_mm) : '',
      ),
    )
    setVariantMarkOverrides(siblings.map((x) => (x.mark_number != null ? String(x.mark_number) : '')))
    setVariantRowIds(siblings.map((x) => x.id))
    setOpenShapeEditorOnModal(true)
    setDetailEditMode('shape')
    setModalTab('detail')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingUnit(null)
    setOpenShapeEditorOnModal(false)
    setModalTab('basic')
    setVariantLengths([''])
    setVariantMarkOverrides([''])
    setVariantRowIds([])
  }

  useEffect(() => {
    if (!modalOpen || !openShapeEditorOnModal) return
    setModalTab('detail')
    setDetailEditMode('shape')
    detailShapeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setOpenShapeEditorOnModal(false)
  }, [modalOpen, openShapeEditorOnModal])

  useEffect(() => {
    if (!modalOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeModal()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [modalOpen])

  // ─── テンプレ選択 ──────────────────────────────────────
  function applyTemplate(templateId: string) {
    const tpl = UNIT_TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) return
    const markNum = 1
    const templateType = shapeTypeToDetailTemplate(tpl.shapeType)
    const baseSpec = getDefaultDetailSpec(templateType)
    setDraft({
      name: tpl.name,
      code: generateUnitCode(tpl.defaultColor, markNum),
      location_type: tpl.locationType,
      shape_type: tpl.shapeType,
      color: tpl.defaultColor,
      mark_number: String(markNum),
      length_mm: '',
      bars: tpl.defaultBars.map((b) => ({ ...b })),
      spacing_mm: tpl.defaultSpacingMm ? String(tpl.defaultSpacingMm) : '',
      description: tpl.description,
      is_active: true,
      template_id: tpl.id,
      detail_spec: baseSpec,
      detail_geometry: buildShapeSketch(templateType, baseSpec).geometry,
      detail_start_mode: 'template',
      rebar_layout: { rebars: [], spacings: [], annotations: [] },
    })
  }

  function updateShapeType(nextShape: ExtendedShapeType) {
    setDraft((p) => {
      const nextTemplate = shapeTypeToDetailTemplate(nextShape)
      // テンプレート切り替え時に、前テンプレートで強制的に 0 にされた寸法が残ると
      // corner が潰れて straight と同じ表示になってしまうため、まずテンプレートのデフォルトで再シードする
      const prev = p.detail_spec ?? getDefaultDetailSpec(nextTemplate)
      const defaults = getDefaultDetailSpec(nextTemplate)
      const base: UnitDetailSpec = {
        ...defaults,
        // 共通で使える寸法は維持（単, 前テンプレートで 0 にされた値는基本 restore しない）
        pitch: prev.pitch ?? defaults.pitch,
        topHorizontalLength: prev.topHorizontalLength ?? defaults.topHorizontalLength,
        leftHeight: prev.leftHeight > 0 ? prev.leftHeight : defaults.leftHeight,
        rightHeight: prev.rightHeight > 0 ? prev.rightHeight : defaults.rightHeight,
        bottomLeftLength: prev.bottomLeftLength > 0 ? prev.bottomLeftLength : defaults.bottomLeftLength,
        bottomRightLength: prev.bottomRightLength > 0 ? prev.bottomRightLength : defaults.bottomRightLength,
        centerBentLength: prev.centerBentLength > 0 ? prev.centerBentLength : defaults.centerBentLength,
        centerVerticalOffset:
          prev.centerVerticalOffset > 0 ? prev.centerVerticalOffset : defaults.centerVerticalOffset,
      }
      const nextSpec = normalizeDetailSpecForTemplate(nextTemplate, base)
      return {
        ...p,
        shape_type: nextShape,
        detail_spec: nextSpec,
        detail_geometry: buildShapeSketch(nextTemplate, nextSpec).geometry,
        detail_start_mode: 'template',
        template_id: null,
      }
    })
  }

  function setDraftRebarLayout(nextLayout: UnitRebarLayout) {
    const normalized = normalizeRebarLayout(nextLayout)
    setDraft((p) => ({
      ...p,
      rebar_layout: normalized,
      bars: aggregateBarsFromRebarLayout(normalized),
    }))
  }

  // ─── Variant 番号 / コード自動算出（色 + 長さ） ─────────────────
  const autoVariant = useMemo(() => {
    const color = normalizeSegmentColor(draft.color)
    const len = parseInt(draft.length_mm, 10)
    const validLen = Number.isFinite(len) && len > 0 ? len : null
    if (
      editingUnit &&
      normalizeSegmentColor(editingUnit.color) === color &&
      (editingUnit.length_mm ?? null) === validLen &&
      editingUnit.mark_number != null
    ) {
      return {
        mark: editingUnit.mark_number,
        code: generateUnitCode(color, editingUnit.mark_number),
      }
    }
    const sameColor = units.filter(
      (u) => u.id !== editingUnit?.id && normalizeSegmentColor(u.color) === color,
    )
    const lengths = [...new Set(sameColor.map((u) => u.length_mm).filter((x): x is number => !!x && x > 0))]
      .sort((a, b) => a - b)
    let mark = 1
    if (validLen != null) {
      const idx = lengths.findIndex((x) => x === validLen)
      if (idx >= 0) {
        const sameLen = sameColor.find((u) => u.length_mm === validLen)
        mark = sameLen?.mark_number ?? idx + 1
      } else {
        const merged = [...lengths, validLen].sort((a, b) => a - b)
        mark = merged.findIndex((x) => x === validLen) + 1
      }
    } else {
      mark = Math.max(1, sameColor.length + 1)
    }
    return {
      mark,
      code: generateUnitCode(color, mark),
    }
  }, [draft.color, draft.length_mm, units, editingUnit?.id])

  function computeVariantForLength(lengthValue: string): { mark: number; code: string } {
    const color = normalizeSegmentColor(draft.color)
    const len = parseInt(lengthValue, 10)
    const validLen = Number.isFinite(len) && len > 0 ? len : null
    const sameColor = units.filter(
      (u) => u.id !== editingUnit?.id && normalizeSegmentColor(u.color) === color,
    )
    const lengths = [...new Set(sameColor.map((u) => u.length_mm).filter((x): x is number => !!x && x > 0))]
      .sort((a, b) => a - b)
    let mark = 1
    if (validLen != null) {
      const idx = lengths.findIndex((x) => x === validLen)
      if (idx >= 0) {
        const sameLen = sameColor.find((u) => u.length_mm === validLen)
        mark = sameLen?.mark_number ?? idx + 1
      } else {
        const merged = [...lengths, validLen].sort((a, b) => a - b)
        mark = merged.findIndex((x) => x === validLen) + 1
      }
    } else {
      mark = Math.max(1, sameColor.length + 1)
    }
    return { mark, code: generateUnitCode(color, mark) }
  }

  function effectiveMark(autoMark: number, manualValue: string | undefined): number {
    const n = parseInt(String(manualValue ?? ''), 10)
    return Number.isFinite(n) && n > 0 ? n : autoMark
  }

  // ─── 保存 ──────────────────────────────────────────────
  async function handleSave() {
    if (!draft.name.trim()) {
      alert('ユニット名を入力してください。')
      return
    }
    const sourceLengths = variantLengths.length > 0 ? variantLengths : [draft.length_mm]
    const rowsForSave = sourceLengths
      .map((rawLen, i) => {
        const mm = parseInt(String(rawLen), 10)
        if (!(Number.isFinite(mm) && mm > 0)) return null
        return {
          mm,
          markRaw: variantMarkOverrides[i] ?? '',
          rowId: variantRowIds[i] ?? '',
        }
      })
      .filter((x): x is { mm: number; markRaw: string; rowId: string } => x != null)
    if (rowsForSave.length === 0) {
      alert('長さ(mm)を1つ以上入力してください。')
      return
    }
    setSaving(true)
    const detailTemplate = shapeTypeToDetailTemplate(draft.shape_type)
    const detailSpec = normalizeDetailSpecForTemplate(
      detailTemplate,
      draft.detail_spec ?? getDefaultDetailSpec(detailTemplate),
    )
    /** 自由作図で空キャンバス（点0）のときもそのまま保存し、再編集で空のまま開けるようにする */
    const detailGeometry =
      draft.detail_start_mode === 'free' && draft.detail_geometry
        ? draft.detail_geometry
        : buildShapeSketch(detailTemplate, detailSpec).geometry
    const resolvedShapeType: ExtendedShapeType =
      draft.detail_start_mode === 'free'
        ? inferShapeTypeFromGeometry(detailGeometry)
        : draft.shape_type

    const isLocalOrMockEdit =
      !!editingUnit &&
      (editingUnit.id.startsWith('mock-') || editingUnit.id.startsWith('local-'))

    const basePayload = {
      name: draft.name.trim(),
      location_type: draft.location_type,
      shape_type: resolvedShapeType,
      color: normalizeSegmentColor(draft.color),
      bars: aggregateBarsFromRebarLayout(normalizeRebarLayout(draft.rebar_layout)).filter((b) => b.qtyPerUnit > 0),
      spacing_mm: draft.spacing_mm ? parseInt(draft.spacing_mm) || null : null,
      description: draft.description.trim() || null,
      is_active: draft.is_active,
      template_id: draft.template_id || null,
      detail_spec: detailSpec,
      detail_geometry: detailGeometry,
      rebar_layout: normalizeRebarLayout(draft.rebar_layout),
    }

    if (isLocalOrMockEdit) {
      const editMark = effectiveMark(autoVariant.mark, variantMarkOverrides[0])
      // mock / local ID の編集のみクライアント状態で完結
      setUnits((prev) =>
        prev.map((u) =>
          u.id === editingUnit!.id
            ? ({
                ...u,
                ...basePayload,
                code: generateUnitCode(normalizeSegmentColor(draft.color), editMark),
                mark_number: editMark,
                length_mm: rowsForSave[0]!.mm,
                updated_at: new Date().toISOString(),
              } as Unit)
            : u,
        ),
      )
    } else if (editingUnit) {
      const updatedRows: Unit[] = []
      for (let i = 0; i < rowsForSave.length; i += 1) {
        const mm = rowsForSave[i]!.mm
        const existingId = rowsForSave[i]!.rowId || null
        const v = computeVariantForLength(String(mm))
        const mark = effectiveMark(v.mark, rowsForSave[i]!.markRaw)
        const payload = {
          ...basePayload,
          code: generateUnitCode(normalizeSegmentColor(draft.color), mark),
          mark_number: mark,
          length_mm: mm,
        }
        if (existingId) {
          let { data, error } = await supabase
            .from('units')
            .update(payload)
            .eq('id', existingId)
            .select()
            .single()
          if (error && /(detail_(spec|geometry)|rebar_layout)/i.test(error.message)) {
            const { detail_spec: _ds, detail_geometry: _dg, rebar_layout: _rl, ...fallbackPayload } = payload
            const retry = await supabase
              .from('units')
              .update(fallbackPayload)
              .eq('id', existingId)
              .select()
              .single()
            data = retry.data
            error = retry.error
          }
          if (error) {
            alert('保存に失敗しました: ' + error.message)
            setSaving(false)
            return
          }
          if (data) updatedRows.push(data as Unit)
        } else {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          if (!user) {
            alert('ログインが必要です。')
            setSaving(false)
            return
          }
          let { data, error } = await supabase
            .from('units')
            .insert({ ...payload, user_id: user.id })
            .select()
            .single()
          if (error && /(detail_(spec|geometry)|rebar_layout)/i.test(error.message)) {
            const { detail_spec: _ds, detail_geometry: _dg, rebar_layout: _rl, ...fallbackPayload } = payload
            const retry = await supabase
              .from('units')
              .insert({ ...fallbackPayload, user_id: user.id })
              .select()
              .single()
            data = retry.data
            error = retry.error
          }
          if (error) {
            alert('保存に失敗しました: ' + error.message)
            setSaving(false)
            return
          }
          if (data) updatedRows.push(data as Unit)
        }
      }
      const usedIds = new Set(rowsForSave.map((r) => r.rowId).filter((id) => !!id))
      const staleIds = variantRowIds.filter((id) => !!id && !usedIds.has(id))
      for (const staleId of staleIds) {
        await supabase.from('units').delete().eq('id', staleId)
      }
      setUnits((prev) => {
        const removed = prev.filter((u) => !variantRowIds.includes(u.id))
        return [...removed, ...updatedRows]
      })
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        alert('ログインが必要です。')
        setSaving(false)
        return
      }
      const createdRows: Unit[] = []
      for (let i = 0; i < rowsForSave.length; i += 1) {
        const mm = rowsForSave[i]!.mm
        const v = computeVariantForLength(String(mm))
        const mark = effectiveMark(v.mark, rowsForSave[i]!.markRaw)
        const payload = {
          ...basePayload,
          code: generateUnitCode(normalizeSegmentColor(draft.color), mark),
          mark_number: mark,
          length_mm: mm,
        }
        let { data, error } = await supabase
          .from('units')
          .insert({ ...payload, user_id: user.id })
          .select()
          .single()
        if (error && /(detail_(spec|geometry)|rebar_layout)/i.test(error.message)) {
          const { detail_spec: _ds, detail_geometry: _dg, rebar_layout: _rl, ...fallbackPayload } = payload
          const retry = await supabase
            .from('units')
            .insert({ ...fallbackPayload, user_id: user.id })
            .select()
            .single()
          data = retry.data
          error = retry.error
        }
        if (error) {
          alert('保存に失敗しました: ' + error.message)
          setSaving(false)
          return
        }
        if (data) createdRows.push(data as Unit)
      }
      setUnits((prev) => [...prev, ...createdRows])
    }

    setSaving(false)
    closeModal()
    router.refresh()
  }

  // ─── 削除 / 無効化 ────────────────────────────────────
  async function handleDeactivate(id: string) {
    const isMock = id.startsWith('mock-') || id.startsWith('local-')
    if (isMock) {
      setUnits((prev) =>
        prev.map((u) => (u.id === id ? { ...u, is_active: false } : u)),
      )
      setDeleteConfirmId(null)
      return
    }
    const { error } = await supabase.from('units').update({ is_active: false }).eq('id', id)
    if (error) {
      alert('無効化に失敗しました: ' + error.message)
      return
    }
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, is_active: false } : u)))
    setDeleteConfirmId(null)
  }

  async function handleReactivate(id: string) {
    const isMock = id.startsWith('mock-') || id.startsWith('local-')
    if (isMock) {
      setUnits((prev) =>
        prev.map((u) => (u.id === id ? { ...u, is_active: true } : u)),
      )
      return
    }
    const { error } = await supabase.from('units').update({ is_active: true }).eq('id', id)
    if (error) {
      alert('有効化に失敗しました: ' + error.message)
      return
    }
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, is_active: true } : u)))
    router.refresh()
  }

  async function handleDelete(id: string) {
    const isMock = id.startsWith('mock-') || id.startsWith('local-')
    if (isMock) {
      setUnits((prev) => prev.filter((u) => u.id !== id))
      setDeleteConfirmId(null)
      return
    }
    const { error } = await supabase.from('units').delete().eq('id', id)
    if (error) {
      alert('削除に失敗しました: ' + error.message)
      return
    }
    setUnits((prev) => prev.filter((u) => u.id !== id))
    setDeleteConfirmId(null)
  }

  const showBasicTab = modalTab === 'basic'
  const showDetailTab = modalTab === 'detail'

  const detailBarsForSummary = useMemo(
    () => aggregateBarsFromRebarLayout(draft.rebar_layout),
    [draft.rebar_layout],
  )
  const detailSpacingLabels = useMemo(() => {
    const labels = draft.rebar_layout.spacings.map((s) => s.label)
    return [...new Set(labels.filter(Boolean))]
  }, [draft.rebar_layout.spacings])
  const detailAnnotationTexts = useMemo(
    () => draft.rebar_layout.annotations.map((a) => a.text),
    [draft.rebar_layout.annotations],
  )

  // ─── レンダリング ────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">ユニット管理</h1>
          <p className="text-sm text-muted mt-0.5">
            配筋ユニット（形状・色・鉄筋構成の組み合わせ）を登録・管理します。
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
        >
          + 新規作成
        </button>
      </div>

      {/* フィルタバー */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-white px-4 py-3">
        <input
          type="text"
          placeholder="名前・コードで検索"
          value={filter.searchText}
          onChange={(e) => setFilter((p) => ({ ...p, searchText: e.target.value }))}
          className="w-44 rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
        />
        <select
          value={filter.locationType}
          onChange={(e) => setFilter((p) => ({ ...p, locationType: e.target.value }))}
          className="rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary bg-white"
        >
          <option value="all">すべての位置</option>
          {LOCATION_TYPES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filter.showInactive}
            onChange={(e) => setFilter((p) => ({ ...p, showInactive: e.target.checked }))}
            className="rounded"
          />
          無効も表示
        </label>
        <span className="ml-auto text-xs text-muted">{groupedUnits.length} 件</span>
      </div>

      {/* ユニット一覧テーブル */}
      {groupedUnits.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-border p-16 text-center text-sm text-muted">
          <p className="mb-1 text-base">ユニットがありません</p>
          <p>「+ 新規作成」からユニットを登録してください。</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted w-6"></th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted">名前</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted hidden md:table-cell">形状プレビュー</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted hidden sm:table-cell">コード</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted hidden md:table-cell">位置</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted whitespace-nowrap">
                  色
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted hidden lg:table-cell">鉄筋構成</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted hidden lg:table-cell">間隔</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groupedUnits.map((group) => (
                <UnitRow
                  key={group.key}
                  unit={group.representative}
                  onEdit={() => openEdit(group.representative)}
                  onPreview={() => setPreviewUnit(group.representative)}
                  onDeactivate={() => setDeleteConfirmId(group.representative.id)}
                  onReactivate={() => void handleReactivate(group.representative.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 無効化確認ダイアログ */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl bg-white p-6 shadow-lg space-y-4 w-80">
            <h2 className="text-base font-semibold">ユニットを無効化しますか？</h2>
            <p className="text-sm text-muted">
              無効化すると一覧から非表示になります（データは残ります）。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleDeactivate(deleteConfirmId)}
                className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
              >
                無効化
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteConfirmId)}
                className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 作成/編集 モーダル */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div
            className={`w-full rounded-xl bg-white shadow-xl flex flex-col max-h-[92vh] ${
              showDetailTab ? 'max-w-6xl' : 'max-w-lg'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4 border-b border-border flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {editingUnit ? 'ユニット編集' : 'ユニット新規作成'}
              </h2>
            </div>
            <div className="px-6 pt-3 border-b border-border">
              <div className="inline-flex rounded-md border border-border bg-gray-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setModalTab('basic')}
                  className={`rounded px-3 py-1 text-xs ${
                    showBasicTab ? 'bg-white font-semibold text-foreground shadow-sm' : 'text-muted'
                  }`}
                >
                  基本情報
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('detail')}
                  className={`rounded px-3 py-1 text-xs ${
                    showDetailTab ? 'bg-white font-semibold text-foreground shadow-sm' : 'text-muted'
                  }`}
                >
                  詳細編集
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
              {showBasicTab && (
                <>
              {/* 基本情報（軽量） */}
              <div>
                <label className="mb-0.5 block text-[11px] font-medium text-muted">
                  ユニット名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                  placeholder="例: 外周ストレート"
                  className="w-full rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-medium text-muted">
                    長さ(mm) / 番号 / コード
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const nextMark =
                        (variantLengths.length > 0
                          ? Math.max(
                              ...variantLengths.map((rowLen, i) =>
                                effectiveMark(
                                  computeVariantForLength(rowLen).mark,
                                  variantMarkOverrides[i],
                                ),
                              ),
                            )
                          : 0) + 1
                      setVariantLengths((prev) => [...prev, ''])
                      setVariantMarkOverrides((prev) => [...prev, String(nextMark)])
                      setVariantRowIds((prev) => [...prev, ''])
                    }}
                    className="rounded border border-border px-2 py-0.5 text-[11px] text-primary hover:bg-muted/20"
                  >
                    + 長さを追加
                  </button>
                </div>
                <div className="space-y-1.5">
                  {variantLengths.map((len, idx) => {
                    const v = computeVariantForLength(len)
                    const mark = effectiveMark(v.mark, variantMarkOverrides[idx])
                    const code = generateUnitCode(normalizeSegmentColor(draft.color), mark)
                    return (
                      <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto] gap-2">
                        <input
                          type="number"
                          min={1}
                          value={len}
                          onChange={(e) => {
                            const next = e.target.value
                            setVariantLengths((prev) => {
                              const copied = [...prev]
                              copied[idx] = next
                              return copied
                            })
                            if (idx === 0) setDraft((p) => ({ ...p, length_mm: next }))
                          }}
                          className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
                          placeholder="例: 4095"
                        />
                        <input
                          type="number"
                          min={1}
                          value={variantMarkOverrides[idx] ?? ''}
                          onChange={(e) =>
                            setVariantMarkOverrides((prev) => {
                              const copied = [...prev]
                              copied[idx] = e.target.value
                              return copied
                            })
                          }
                          placeholder={String(v.mark)}
                          className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-sm font-mono min-w-[56px] text-center outline-none focus:border-primary"
                        />
                        <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-sm font-mono min-w-[92px]">
                          {code}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setVariantLengths((prev) => {
                              if (prev.length <= 1) return prev
                              const copied = prev.filter((_, i) => i !== idx)
                              setDraft((p) => ({ ...p, length_mm: copied[0] ?? '' }))
                              return copied
                            })
                            setVariantMarkOverrides((prev) =>
                              prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx),
                            )
                            setVariantRowIds((prev) =>
                              prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx),
                            )
                          }}
                          className="rounded border border-border px-2 py-1.5 text-xs text-muted hover:text-danger"
                          disabled={variantLengths.length <= 1}
                          title="この長さ行を削除"
                        >
                          削除
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted">位置分類</label>
                <div className="flex flex-wrap gap-1">
                  {LOCATION_TYPES.map((lt) => (
                    <button
                      key={lt}
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, location_type: lt }))}
                      className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        draft.location_type === lt
                          ? 'border-primary bg-primary text-white'
                          : 'border-border text-muted hover:border-primary/40'
                      }`}
                    >
                      {lt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted">表示色</label>
                <div className="grid grid-cols-5 gap-1 sm:grid-cols-6">
                  {SEGMENT_COLOR_DEFINITIONS.map((d) => {
                    const active = draft.color === d.id
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, color: d.id }))}
                        className={`rounded-md border px-0.5 py-1.5 text-center text-[10px] font-medium leading-tight ${
                          active ? 'ring-2 ring-primary ring-offset-1' : ''
                        }`}
                        style={{
                          borderColor: getSegmentStrokeHex(d.id, false),
                          backgroundColor: active ? d.tint : '#fff',
                          color: getSegmentStrokeHex(d.id, true),
                        }}
                      >
                        {d.labelJa}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="mb-0.5 block text-[11px] font-medium text-muted">説明</label>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                  placeholder="任意"
                  rows={2}
                  className="w-full resize-none rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-2 select-none text-sm">
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(e) => setDraft((p) => ({ ...p, is_active: e.target.checked }))}
                  className="rounded"
                />
                <span>図面で使用する</span>
              </label>
                </>
              )}

              {showDetailTab && (
                <div ref={detailShapeSectionRef} className="space-y-1 pb-1">
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-medium leading-snug text-foreground/90">
                      まず下のキャンバスで形状を作成し、その後に鉄筋、間隔・注記を追加します。
                    </p>
                    <p className="text-[10px] leading-snug text-muted/75">
                      作図モードの切替やプリセット読込、複製は下の補助オプションから行えます。
                    </p>
                  </div>

                  <details className="group rounded-md text-[10px] text-muted/60 open:bg-muted/5 open:text-muted/80">
                    <summary className="cursor-pointer select-none py-1 text-[9px] text-muted/55 underline decoration-transparent decoration-1 underline-offset-2 transition-colors hover:text-muted/80 hover:decoration-border/40 [&::-webkit-details-marker]:hidden">
                      <span className="ml-0.5">補助オプション（一般／上級者向け）</span>
                    </summary>
                    <div className="space-y-2 border-t border-border/25 pt-1.5 pb-0.5">
                      {/* 一般 */}
                      <div className="space-y-1.5 rounded-lg border border-border/35 bg-white/90 px-2 py-1.5 shadow-sm">
                        <div className="flex items-baseline justify-between gap-2 border-b border-border/25 pb-1">
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-foreground/70">
                            一般
                          </span>
                          <span className="text-[8px] text-muted/50">まずここ（空にする・読込・複製）</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <button
                            type="button"
                            onClick={startFromEmptyCanvas}
                            className="rounded border border-border/50 bg-background px-1.5 py-0.5 hover:bg-muted/30"
                          >
                            空のキャンバスから開始
                          </button>
                          <details className="inline-block align-top">
                            <summary className="cursor-pointer list-none rounded px-1.5 py-0.5 text-muted/80 underline decoration-border/40 underline-offset-2 hover:bg-muted/15 [&::-webkit-details-marker]:hidden">
                              保存済みプリセットを読込
                            </summary>
                            <div className="mt-1 max-h-32 min-w-[200px] space-y-1 overflow-y-auto rounded border border-border/50 bg-white p-1.5 text-[11px] shadow-sm">
                              {userPresets.length === 0 ? (
                                <p className="text-muted">保存がありません。</p>
                              ) : (
                                <ul className="space-y-1">
                                  {userPresets.map((pr) => (
                                    <li
                                      key={pr.id}
                                      className="flex flex-wrap items-center justify-between gap-1 border-b border-border/40 pb-1 last:border-0"
                                    >
                                      <span className="font-medium text-foreground">{pr.name}</span>
                                      <span className="flex gap-1">
                                        <button
                                          type="button"
                                          onClick={() => applyUserPreset(pr)}
                                          className="rounded border border-primary/30 px-1 py-px text-[10px] text-primary"
                                        >
                                          読込
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => deleteUserPreset(pr.id)}
                                          className="rounded border border-red-200 px-1 py-px text-[10px] text-red-700"
                                        >
                                          削除
                                        </button>
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </details>
                          {!editingUnit && (
                            <span className="inline-flex flex-wrap items-center gap-1">
                              <select
                                value={duplicateSourceId}
                                onChange={(e) => setDuplicateSourceId(e.target.value)}
                                className="max-w-[120px] rounded border border-border/50 bg-background px-1 py-px text-[10px]"
                              >
                                <option value="">既存ユニットを複製</option>
                                {units.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={applyDuplicateFromUnit}
                                className="rounded border border-border/50 px-1.5 py-0.5 hover:bg-muted/30"
                              >
                                反映
                              </button>
                            </span>
                          )}
                        </div>

                        <div className="border-t border-border/20 pt-1.5">
                          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted/85">
                            <span className="shrink-0 text-[9px] font-medium text-foreground/65">
                              作図モード
                            </span>
                            <div className="inline-flex rounded-md border border-border/50 bg-background/80 p-px">
                              <button
                                type="button"
                                onClick={() => setDraft((p) => ({ ...p, detail_start_mode: 'free' }))}
                                className={`rounded px-1.5 py-px ${
                                  draft.detail_start_mode === 'free'
                                    ? 'bg-slate-800 text-white'
                                    : 'text-muted hover:bg-muted/40'
                                }`}
                              >
                                自由のみ
                              </button>
                              <button
                                type="button"
                                onClick={() => setDraft((p) => ({ ...p, detail_start_mode: 'template' }))}
                                className={`rounded px-1.5 py-px ${
                                  draft.detail_start_mode === 'template'
                                    ? 'bg-slate-800 text-white'
                                    : 'text-muted hover:bg-muted/40'
                                }`}
                              >
                                標準形状（寸法）
                              </button>
                            </div>
                            <span className="text-[9px] text-muted/50">標準形状＝青ハンドルで寸法調整</span>
                            <span className="ml-auto text-[9px] text-muted/40">
                              外形 {getShapeLabel(draft.shape_type)}
                            </span>
                          </div>

                          {draft.detail_start_mode === 'template' && (
                            <div className="space-y-0.5 pt-0.5">
                              <span className="text-[8px] text-muted/45">標準形状の種類</span>
                              <div className="grid grid-cols-6 gap-0.5 sm:grid-cols-8">
                              {SHAPE_TYPE_DEFS.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => updateShapeType(s.id)}
                                  className={`rounded border px-0.5 py-px text-[9px] ${
                                    draft.shape_type === s.id
                                      ? 'border-primary/60 bg-primary/5 text-primary'
                                      : 'border-border/60 text-muted/80'
                                  }`}
                                >
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          )}
                        </div>
                      </div>

                      {/* 上級者向け */}
                      <div className="space-y-1 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/25 px-2 py-1.5">
                        <div className="flex items-baseline justify-between gap-2 border-b border-border/20 pb-1">
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted/50">
                            上級者向け
                          </span>
                          <span className="text-[8px] text-muted/40">ライブラリ・細かい切替</span>
                        </div>
                        <details className="rounded-md border border-border/30 bg-background/60">
                          <summary className="cursor-pointer select-none px-2 py-1 text-[9px] text-muted/55 [&::-webkit-details-marker]:hidden">
                            標準形状ライブラリから読込
                          </summary>
                          <div className="space-y-1.5 border-t border-border/20 px-2 py-1.5">
                            <p className="text-[9px] leading-relaxed text-muted/60">
                              アプリ同梱の定形セットです。通常は上の「自由のみ」でキャンバス作図してください。
                            </p>
                            <div className="flex flex-wrap items-center gap-1">
                              <select
                                value={systemTplPick}
                                onChange={(e) => setSystemTplPick(e.target.value)}
                                className="min-w-0 flex-1 rounded border border-border/50 px-1 py-px text-[10px] bg-background"
                              >
                                <option value="">ライブラリから選ぶ</option>
                                {UNIT_TEMPLATES.map((tpl) => (
                                  <option key={tpl.id} value={tpl.id}>
                                    {tpl.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!systemTplPick) return
                                  applyTemplate(systemTplPick)
                                  setDetailEditMode('shape')
                                }}
                                className="shrink-0 rounded border border-border/50 px-1.5 py-px text-[10px]"
                              >
                                読込
                              </button>
                            </div>
                            <details className="mt-0.5 border-t border-border/15 pt-1 opacity-80">
                              <summary className="cursor-pointer list-none py-0.5 pl-0.5 text-[8px] leading-tight text-muted/35 hover:text-muted/50 [&::-webkit-details-marker]:hidden">
                                種類のみ切替（ライブラリ未使用・寸法ハンドル用）
                              </summary>
                              <div className="pb-0.5 pt-0.5">
                                <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4">
                                  {SHAPE_TYPE_DEFS.map((s) => (
                                    <button
                                      key={`aux-${s.id}`}
                                      type="button"
                                      onClick={() => updateShapeType(s.id)}
                                      className="rounded border border-border/25 px-0.5 py-px text-[8px] text-muted/55 hover:border-border/40 hover:bg-muted/15"
                                    >
                                      {s.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </details>
                          </div>
                        </details>
                      </div>
                    </div>
                  </details>

                  <DetailShapeEditor
                    shapeType={draft.shape_type}
                    expanded
                    mode={detailEditMode}
                    onModeChange={setDetailEditMode}
                    startMode={draft.detail_start_mode}
                    spec={normalizeDetailSpecForTemplate(
                      shapeTypeToDetailTemplate(draft.shape_type),
                      draft.detail_spec ??
                        getDefaultDetailSpec(shapeTypeToDetailTemplate(draft.shape_type)),
                    )}
                    geometry={draft.detail_geometry}
                    onGeometryChange={(nextGeo) =>
                      setDraft((p) => ({
                        ...p,
                        detail_geometry: nextGeo,
                        shape_type: inferShapeTypeFromGeometry(nextGeo),
                      }))
                    }
                    onChange={(nextSpec) =>
                      setDraft((p) => {
                        const t = shapeTypeToDetailTemplate(p.shape_type)
                        return {
                          ...p,
                          detail_spec: normalizeDetailSpecForTemplate(t, nextSpec),
                        }
                      })
                    }
                    rebarLayout={draft.rebar_layout}
                    onRebarLayoutChange={setDraftRebarLayout}
                    aggregationSlot={
                      <div className="rounded-lg border border-border bg-white p-3 shadow-sm">
                        <div className="text-xs font-semibold text-foreground">鉄筋構成（自動集計）</div>
                        <p className="mt-1 text-[10px] leading-snug text-muted">
                          キャンバス上に配置した鉄筋から自動で集計しています。
                        </p>
                        <div className="mt-2 font-mono text-sm text-muted">
                          {detailBarsForSummary.length > 0 ? barsSummary(detailBarsForSummary) : '—'}
                        </div>
                        <div className="mt-4 border-t border-border pt-3">
                          <div className="text-xs font-semibold text-foreground">注記・間隔（要約）</div>
                          <p className="mt-1 text-[10px] leading-snug text-muted">
                            キャンバス上の間隔値と注記から要約しています。
                          </p>
                          <div className="mt-2 text-sm text-muted">
                            {detailSpacingLabels.length > 0 ? detailSpacingLabels.join(', ') : '—'}
                          </div>
                          {detailAnnotationTexts.length > 0 && (
                            <div className="mt-2 text-[11px] text-muted">
                              注記: {detailAnnotationTexts.slice(0, 5).join(', ')}
                              {detailAnnotationTexts.length > 5 ? '…' : null}
                            </div>
                          )}
                        </div>
                      </div>
                    }
                  />

                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-dashed border-border pt-2">
                    <button
                      type="button"
                      onClick={handleSaveAsPreset}
                      className="text-[11px] text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900"
                    >
                      プリセットとして保存
                    </button>
                    <span className="text-[10px] text-muted">（アカウントに保存）</span>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 pb-6 pt-4 border-t border-border flex flex-wrap items-center justify-end gap-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-xl">
            <div className="px-6 pt-5 pb-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">{previewUnit.name}</h3>
                <p className="text-xs text-muted">{previewUnit.code ?? '-'}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewUnit(null)}
                className="text-xs text-muted underline"
              >
                閉じる
              </button>
            </div>
            <div className="p-4">
              <div className="rounded border border-border bg-slate-50 p-2">
                <UnitShapeThumbnail unit={previewUnit} large />
                <UnitVariantLengthList allUnits={units} unit={previewUnit} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPreviewUnit(null)
                    openEditShape(previewUnit)
                  }}
                  className="rounded-md border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                >
                  形状編集へ
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewUnit(null)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 詳細編集キャンバスと形状プレビュー（サムネ・モーダル）で鉄筋径の見た目を揃える */
function rebarDiameterVisualToken(diameter: string | null | undefined): {
  fill: string
  stroke: string
  text: string
} {
  const d = (diameter ?? '').toUpperCase()
  if (d === 'D13') return { fill: '#dbeafe', stroke: '#2563eb', text: '#1d4ed8' }
  if (d === 'D16') return { fill: '#ffedd5', stroke: '#ea580c', text: '#c2410c' }
  if (d === 'D10') return { fill: '#e5e7eb', stroke: '#111827', text: '#111827' }
  return { fill: '#e5e7eb', stroke: '#6b7280', text: '#4b5563' }
}

type CanvasSelection =
  | { kind: 'point'; id: string }
  | { kind: 'segment'; id: string }
  | { kind: 'rebar'; id: string }
  | { kind: 'spacing'; id: string }
  | { kind: 'annotation'; id: string }

function DetailShapeEditor({
  shapeType,
  spec,
  onChange,
  expanded = false,
  mode,
  onModeChange,
  startMode,
  geometry,
  onGeometryChange,
  rebarLayout,
  onRebarLayoutChange,
  aggregationSlot,
}: {
  shapeType: ExtendedShapeType
  spec: UnitDetailSpec
  onChange: (next: UnitDetailSpec) => void
  expanded?: boolean
  mode: 'shape' | 'rebar' | 'annotation'
  onModeChange: (next: 'shape' | 'rebar' | 'annotation') => void
  startMode: 'template' | 'free'
  geometry: UnitDetailGeometry | null
  onGeometryChange: (next: UnitDetailGeometry) => void
  rebarLayout: UnitRebarLayout
  onRebarLayoutChange: (next: UnitRebarLayout) => void
  aggregationSlot?: ReactNode
}) {
  const canvasPaneRef = useRef<HTMLDivElement | null>(null)
  const template = shapeTypeToDetailTemplate(shapeType)
  const sketch = useMemo(() => buildShapeSketch(template, spec), [template, spec])
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dragPointKey, setDragPointKey] = useState<string | null>(null)
  const [drawAnchorKey, setDrawAnchorKey] = useState<string | null>(null)
  const [newPathMode, setNewPathMode] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [history, setHistory] = useState<UnitDetailGeometry[]>([])
  const [selection, setSelection] = useState<CanvasSelection | null>(null)
  const [spacingMmDraft, setSpacingMmDraft] = useState<number>(() => spec.pitch)
  /** 形状編集キャンバス初期ズーム（UI表示は clampedZoom×100%） */
  const [zoomScale, setZoomScale] = useState(0.5)
  const [zoomCenter, setZoomCenter] = useState<{ x: number; y: number } | null>(null)
  const [drawGesture, setDrawGesture] = useState<{
    start: { x: number; y: number }
    current: { x: number; y: number }
    anchorKey: string | null
    shiftLock: boolean
  } | null>(null)
  const [spacingDrawGesture, setSpacingDrawGesture] = useState<{
    start: { x: number; y: number }
    current: { x: number; y: number }
    shiftLock: boolean
  } | null>(null)
  const [dragSpacingLabelId, setDragSpacingLabelId] = useState<string | null>(null)
  const [dragAnnotationId, setDragAnnotationId] = useState<string | null>(null)
  const suppressCanvasGestureRef = useRef(false)

  function clearCanvasSelections() {
    setSelection(null)
    setDragPointKey(null)
    setDrawAnchorKey(null)
  }

  function selectPoint(pointKey: string) {
    setSelection({ kind: 'point', id: pointKey })
  }

  function selectSegment(segmentKey: string) {
    setSelection({ kind: 'segment', id: segmentKey })
  }

  function selectRebar(rebarId: string) {
    setSelection({ kind: 'rebar', id: rebarId })
  }

  function selectSpacing(spacingId: string) {
    setSelection({ kind: 'spacing', id: spacingId })
  }

  function selectAnnotation(annotationId: string) {
    setSelection({ kind: 'annotation', id: annotationId })
  }

  useEffect(() => {
    clearCanvasSelections()
  }, [mode])

  useEffect(() => {
    if (mode === 'annotation') setSpacingMmDraft(spec.pitch)
  }, [mode, spec.pitch])
  useEffect(() => {
    if (mode !== 'shape') {
      setDrawGesture(null)
    }
    if (mode !== 'annotation') {
      setSpacingDrawGesture(null)
      setDragSpacingLabelId(null)
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'annotation') return
    const sid = selection?.kind === 'spacing' ? selection.id : null
    if (!sid) return
    const sp = rebarLayout.spacings.find((s) => s.id === sid)
    if (!sp) return
    const v = parseSpacingMm(sp.label)
    setSpacingMmDraft(v ?? spec.pitch)
  }, [mode, selection, rebarLayout.spacings, spec.pitch])

  const vbPad = 40

  const pointByKey = useMemo(
    () => Object.fromEntries(sketch.geometry.points.map((p) => [p.key, p])),
    [sketch.geometry.points],
  )

  function setDim(dimKey: keyof UnitDetailSpec, value: number) {
    const next = normalizeDetailSpecForTemplate(template, { ...spec, [dimKey]: value })
    onChange(next)
  }

  function handlePointerMove(
    e: React.PointerEvent<SVGSVGElement>,
    handle: ShapeHandle,
  ) {
    if (draggingKey !== handle.key) return
    const { x, y } = screenToSvgFrom(e.clientX, e.clientY, e.currentTarget)

    if (handle.axis === 'x') {
      const next = Math.max(1, Math.round(Math.abs(x) * (shapeType === 'corner_T' || shapeType === 'cross' ? 2 : 1)))
      setDim(handle.dimKey, next)
    } else {
      const next = Math.max(0, Math.round(Math.abs(y)))
      setDim(handle.dimKey, next)
    }
  }

  const dimFields = getEditableDimFields(template)
  // 鉄筋配置は位置（点）として独立しているため、テンプレート制約なしで追加可能にする
  // （寸法編集の可否は別도로 template に依存）
  const isMvpTemplate = template === 'straight' || template === 'corner_L' || template === 'corner_T'
  const displayGeometry = startMode === 'free' && geometry ? geometry : sketch.geometry

  const byRebarId = useMemo(
    () => Object.fromEntries(rebarLayout.rebars.map((r) => [r.id, r])),
    [rebarLayout.rebars],
  )

  const freeByKey = useMemo(
    () => Object.fromEntries(displayGeometry.points.map((p) => [p.key, p])),
    [displayGeometry.points],
  )
  const freeAdjacency = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of displayGeometry.segments) {
      m.set(s.from, [...(m.get(s.from) ?? []), s.to])
      m.set(s.to, [...(m.get(s.to) ?? []), s.from])
    }
    return m
  }, [displayGeometry.segments])

  function nextId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
  }
  const weakSnapThreshold = 14

  function constrainOrtho(
    origin: { x: number; y: number },
    target: { x: number; y: number },
  ): { x: number; y: number } {
    const dx = Math.abs(target.x - origin.x)
    const dy = Math.abs(target.y - origin.y)
    if (dx >= dy) return { x: target.x, y: origin.y }
    return { x: origin.x, y: target.y }
  }

  function calcBounds(points: Array<{ x: number; y: number }>) {
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    }
  }

  const viewBounds = useMemo(() => {
    if (startMode !== 'free') return sketch.geometry.bounds
    if (displayGeometry.points.length > 0) return calcBounds(displayGeometry.points)
    return displayGeometry.bounds ?? sketch.geometry.bounds
  }, [startMode, displayGeometry.points, displayGeometry.bounds, sketch.geometry.bounds])
  const { minX, minY, maxX, maxY } = viewBounds
  const baseVbW = Math.max(160, maxX - minX + vbPad * 2)
  const baseVbH = Math.max(120, maxY - minY + vbPad * 2)
  const baseVbX = minX - vbPad
  const baseVbY = minY - vbPad
  const clampedZoom = Math.max(0.5, Math.min(zoomScale, 4))
  const viewW = baseVbW / clampedZoom
  const viewH = baseVbH / clampedZoom
  // Keep rebar markers readable across very large/small coordinate ranges.
  const viewRef = Math.min(viewW, viewH)
  const rebarBodyR = Math.max(7, Math.min(16, viewRef * 0.018))
  const rebarSelectR = rebarBodyR + 4
  const rebarHitR = rebarBodyR + 4
  const rebarLabelFont = Math.max(10, Math.min(16, rebarBodyR * 1.15))
  const rebarLabelPadX = Math.max(8, Math.round(rebarBodyR + 1))
  const rebarLabelYOffset = Math.max(8, Math.round(rebarBodyR + 1))
  const rebarLabelBoxH = Math.max(12, Math.round(rebarLabelFont + 4))
  const centerX = zoomCenter?.x ?? baseVbX + baseVbW / 2
  const centerY = zoomCenter?.y ?? baseVbY + baseVbH / 2
  const vbX = centerX - viewW / 2
  const vbY = centerY - viewH / 2

  function pushHistorySnapshot() {
    setHistory((prev) => [...prev.slice(-29), displayGeometry])
  }

  function screenToSvgFrom(
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
  ): { x: number; y: number } {
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const svgPt = pt.matrixTransform(ctm.inverse())
    return { x: svgPt.x, y: svgPt.y }
  }

  function resetZoom() {
    setZoomScale(1)
    setZoomCenter(null)
  }
  function zoomIn() {
    setZoomScale((prev) => Math.min(4, prev * 1.2))
  }
  function zoomOut() {
    setZoomScale((prev) => Math.max(0.5, prev * 0.85))
  }

  function addRebarAt(x: number, y: number) {
    const id = nextId('rb')
    const next = normalizeRebarLayout({
      ...rebarLayout,
      rebars: [
        ...rebarLayout.rebars,
        { id, x, y, diameter: 'D13', role: 'main', label: null },
      ],
    })
    onRebarLayoutChange(next)
    selectRebar(id)
  }

  function addAnnotationAt(x: number, y: number) {
    const id = nextId('an')
    const text = `${spacingMmDraft}`
    onRebarLayoutChange(
      normalizeRebarLayout({
        ...rebarLayout,
        annotations: [...rebarLayout.annotations, { id, x, y, text }],
      }),
    )
    selectAnnotation(id)
  }

  function addFreeSpacingByDrag(start: { x: number; y: number }, end: { x: number; y: number }) {
    if (Math.hypot(end.x - start.x, end.y - start.y) < 4) return false

    const id = nextId('sp')
    const spacing = {
      id,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      // 初期ラベル位置を線分の中点にseedしておく（後で数値を入れたときにドラッグ対象になるため）
      label_x: (start.x + end.x) / 2,
      label_y: (start.y + end.y) / 2,
      // 初期作成時は数値ラベルを自動生成しない（必要な場合のみ後で入力）
      label: '',
    }

    onRebarLayoutChange(
      normalizeRebarLayout({
        ...rebarLayout,
        spacings: [...rebarLayout.spacings, spacing],
      }),
    )

    selectSpacing(id)
    return true
  }

  function moveSpacingLabel(spacingId: string, p: { x: number; y: number }) {
    const nextSpacings = rebarLayout.spacings.map((sp) =>
      sp.id === spacingId
        ? {
            ...sp,
            label_x: p.x,
            label_y: p.y,
          }
        : sp,
    )

    onRebarLayoutChange(
      normalizeRebarLayout({
        ...rebarLayout,
        spacings: nextSpacings,
      }),
    )
  }

  function moveAnnotation(annotationId: string, p: { x: number; y: number }) {
    const nextAnnotations = rebarLayout.annotations.map((an) =>
      an.id === annotationId
        ? {
            ...an,
            x: p.x,
            y: p.y,
          }
        : an,
    )

    onRebarLayoutChange(
      normalizeRebarLayout({
        ...rebarLayout,
        annotations: nextAnnotations,
      }),
    )
  }

  function onRebarClick(rebarId: string) {
    selectRebar(rebarId)
  }

  function addPolylineByDrag(
    start: { x: number; y: number },
    end: { x: number; y: number },
    anchorKey: string | null,
    shiftLock: boolean,
  ) {
    const dragMin = 4
    if (Math.hypot(end.x - start.x, end.y - start.y) < dragMin) return

    const firstEnd = shiftLock ? constrainOrtho(start, end) : end

    // 빈 캔버스(또는 앵커 없는 상태)에서 드래그하면 독립 선분(점 2개) 생성
    if (displayGeometry.points.length === 0 || !anchorKey) {
      const key0 = `p${Math.random().toString(36).slice(2, 8)}`
      const key1 = `p${Math.random().toString(36).slice(2, 8)}`

      const nextPoints =
        displayGeometry.points.length === 0
          ? [
              { key: key0, x: start.x, y: start.y },
              { key: key1, x: firstEnd.x, y: firstEnd.y },
            ]
          : [
              ...displayGeometry.points,
              { key: key0, x: start.x, y: start.y },
              { key: key1, x: firstEnd.x, y: firstEnd.y },
            ]

      const nextSegments =
        displayGeometry.points.length === 0
          ? [{ from: key0, to: key1 }]
          : [...displayGeometry.segments, { from: key0, to: key1 }]

      const createdSegmentKey = `${key0}-${key1}-${nextSegments.length - 1}`

      onGeometryChange({
        ...displayGeometry,
        points: nextPoints,
        segments: nextSegments,
        bounds: calcBounds(nextPoints),
      })

      // 핵심: 새 점 자동선택 금지, 새 선만 선택
      setDrawAnchorKey(null)
      setNewPathMode(true)
      selectSegment(createdSegmentKey)
      return
    }

    const points = [...displayGeometry.points]
    const anchor =
      (anchorKey && freeByKey[anchorKey]) ||
      (!newPathMode && drawAnchorKey && freeByKey[drawAnchorKey] ? freeByKey[drawAnchorKey] : null)

    if (!anchor) return

    const dragEnd = shiftLock ? constrainOrtho({ x: anchor.x, y: anchor.y }, end) : end
    let nx = dragEnd.x
    let ny = dragEnd.y

    if (snapEnabled) {
      const dx = Math.abs(nx - anchor.x)
      const dy = Math.abs(ny - anchor.y)
      if (dy <= weakSnapThreshold && dx > dy) ny = anchor.y
      else if (dx <= weakSnapThreshold && dy >= dx) nx = anchor.x
    }

    pushHistorySnapshot()

    const key = `p${Math.random().toString(36).slice(2, 8)}`
    const nextPoints = [...points, { key, x: nx, y: ny }]
    const nextSegments = [...displayGeometry.segments, { from: anchor.key, to: key }]
    const createdSegmentKey = `${anchor.key}-${key}-${nextSegments.length - 1}`

    onGeometryChange({
      ...displayGeometry,
      templateType: displayGeometry.templateType,
      points: nextPoints,
      segments: nextSegments,
      bounds: calcBounds(nextPoints),
    })

    // 핵심: 여기서도 새 점 자동선택 금지, 새 선만 선택
    setDrawAnchorKey(null)
    setNewPathMode(true)
    selectSegment(createdSegmentKey)
  }

  const selectedPointKey = selection?.kind === 'point' ? selection.id : null
  const selectedSegmentKey = selection?.kind === 'segment' ? selection.id : null
  const selectedRebarId = selection?.kind === 'rebar' ? selection.id : null
  const selectedSpacingId = selection?.kind === 'spacing' ? selection.id : null
  const selectedAnnotationId = selection?.kind === 'annotation' ? selection.id : null

  const selectedFreePoint = selectedPointKey ? freeByKey[selectedPointKey] ?? null : null

  const selectedSpacing = selectedSpacingId
    ? rebarLayout.spacings.find((s) => s.id === selectedSpacingId) ?? null
    : null

  const selectedAnnotation = selectedAnnotationId
    ? rebarLayout.annotations.find((a) => a.id === selectedAnnotationId) ?? null
    : null

  const selectedRebar = selectedRebarId ? byRebarId[selectedRebarId] ?? null : null

  const selectedSegmentInfo = useMemo(() => {
    if (!selectedSegmentKey) return null
    const idx = displayGeometry.segments.findIndex(
      (s, i) => `${s.from}-${s.to}-${i}` === selectedSegmentKey,
    )
    if (idx < 0) return null
    const seg = displayGeometry.segments[idx]
    const p1 = startMode === 'free' ? freeByKey[seg.from] : pointByKey[seg.from]
    const p2 = startMode === 'free' ? freeByKey[seg.to] : pointByKey[seg.to]
    if (!p1 || !p2) return null
    const lengthMm = Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y))
    return { seg, idx, p1, p2, lengthMm }
  }, [selectedSegmentKey, displayGeometry.segments, startMode, freeByKey, pointByKey])

  function getDefaultSpacingLabelPos(
    sp: UnitRebarLayout['spacings'][number],
  ): { x: number; y: number } | null {
    const a =
      sp.from && byRebarId[sp.from]
        ? { x: byRebarId[sp.from]!.x, y: byRebarId[sp.from]!.y }
        : typeof sp.x1 === 'number' && typeof sp.y1 === 'number'
          ? { x: sp.x1, y: sp.y1 }
          : null

    const b =
      sp.to && byRebarId[sp.to]
        ? { x: byRebarId[sp.to]!.x, y: byRebarId[sp.to]!.y }
        : typeof sp.x2 === 'number' && typeof sp.y2 === 'number'
          ? { x: sp.x2, y: sp.y2 }
          : null

    if (!a || !b) return null
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  function beginObjectPointer(e: SvgPointerEvent<SVGElement>) {
    suppressCanvasGestureRef.current = true
    e.preventDefault()
    e.stopPropagation()
  }

  function markObjectPointer() {
    suppressCanvasGestureRef.current = true
  }

  const freePointHitR = 10
  const segmentHitWidth = 6
  const spacingHitWidth = 6

  return (
    <div
      className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-3"
      onPointerDownCapture={(e) => {
        const target = e.target as HTMLElement | null
        if (!target) return
        if (!canvasPaneRef.current?.contains(target)) return
        if (target.closest('svg')) return
        if (target.closest('button,input,select,textarea,label,[role="toolbar"]')) return
        clearCanvasSelections()
      }}
    >
      <div ref={canvasPaneRef} className="flex min-h-0 w-full min-w-0 flex-col gap-2 lg:w-[70%]">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-2">
          <span className="text-[10px] font-medium text-muted/70">道具</span>
          <div
            role="toolbar"
            aria-label="キャンバス上の道具切替"
            className="inline-flex overflow-hidden rounded-lg border border-slate-300/35 bg-gradient-to-b from-slate-200/55 to-slate-200/40 p-px shadow-inner"
          >
            <button
              type="button"
              onClick={() => onModeChange('shape')}
              title="形状編集"
              className={`border-r border-slate-300/30 px-2.5 py-1 text-[10px] font-medium transition-[color,box-shadow,background] last:border-r-0 ${
                mode === 'shape'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'bg-transparent text-muted/75 hover:bg-white/50 hover:text-foreground'
              }`}
            >
              形状編集
            </button>
            <button
              type="button"
              onClick={() => onModeChange('rebar')}
              title="鉄筋配置"
              className={`border-r border-slate-300/30 px-2.5 py-1 text-[10px] font-medium transition-[color,box-shadow,background] last:border-r-0 ${
                mode === 'rebar'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'bg-transparent text-muted/75 hover:bg-white/50 hover:text-foreground'
              }`}
            >
              鉄筋配置
            </button>
            <button
              type="button"
              onClick={() => onModeChange('annotation')}
              title="注記・間隔"
              className={`px-2.5 py-1 text-[10px] font-medium transition-[color,box-shadow,background] ${
                mode === 'annotation'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'bg-transparent text-muted/75 hover:bg-white/50 hover:text-foreground'
              }`}
            >
              注記・間隔
            </button>
          </div>
        </div>
        {mode === 'annotation' && (
          <>
            <p className="rounded border border-dashed border-border/45 bg-slate-50/70 px-2 py-1 text-[10px] font-medium leading-snug text-foreground/80">
              ドラッグ: 間隔線を作成 / クリック: 注記を追加 / 数値ラベル: ドラッグで移動
            </p>
          </>
        )}
        {mode === 'shape' && startMode === 'free' && (
            <div className="space-y-1.5 rounded border border-border/60 bg-slate-50/50 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted/90">
                <span className="font-medium text-foreground/80">基本操作</span>
                <span>線作成: ドラッグして描画</span>
                <span>線選択: 線をクリック</span>
                <span className="text-muted/70">保存: 右下の保存ボタン</span>
              </div>
              <details>
                <summary className="cursor-pointer select-none text-[10px] text-muted underline underline-offset-2">
                  詳細操作（上級）
                </summary>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (history.length === 0) return
                      const last = history[history.length - 1]
                      setHistory((prev) => prev.slice(0, -1))
                      onGeometryChange(last)
                    }}
                    className="rounded border border-border px-2 py-1 text-[11px] hover:bg-gray-50"
                  >
                    最後の操作を戻す
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawAnchorKey(null)
                      setNewPathMode(true)
                    }}
                    className={`rounded border px-2 py-1 text-[11px] ${newPathMode ? 'border-primary text-primary bg-primary/5' : 'border-border hover:bg-gray-50'}`}
                  >
                    独立した線を開始
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selection?.kind !== 'point') return
                      setDrawAnchorKey(selection.id)
                      setNewPathMode(false)
                    }}
                    className="rounded border border-border px-2 py-1 text-[11px] hover:bg-gray-50"
                  >
                    選択端点から開始
                  </button>
                  <button
                    type="button"
                    onClick={() => setSnapEnabled((v) => !v)}
                    className={`rounded border px-2 py-1 text-[11px] ${snapEnabled ? 'border-primary text-primary bg-primary/5' : 'border-border hover:bg-gray-50'}`}
                  >
                    補助スナップ {snapEnabled ? 'オン' : 'オフ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selection?.kind !== 'point') return
                      const pointKey = selection.id
                      pushHistorySnapshot()
                      const nextPoints = displayGeometry.points.filter((p) => p.key !== pointKey)
                      if (nextPoints.length === 0) return
                      const nextSegments = displayGeometry.segments.filter(
                        (s) => s.from !== pointKey && s.to !== pointKey,
                      )
                      onGeometryChange({
                        ...displayGeometry,
                        points: nextPoints,
                        segments: nextSegments,
                        bounds: calcBounds(nextPoints),
                      })
                      setSelection(null)
                    }}
                    className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                  >
                    選択端点を削除
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selection?.kind !== 'segment') return
                      const segmentKey = selection.id
                      pushHistorySnapshot()
                      const nextSegments = displayGeometry.segments.filter(
                        (s, idx) => `${s.from}-${s.to}-${idx}` !== segmentKey,
                      )
                      onGeometryChange({
                        ...displayGeometry,
                        segments: nextSegments,
                        bounds: calcBounds(displayGeometry.points),
                      })
                      setSelection(null)
                    }}
                    className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                  >
                    選択線を削除
                  </button>
                </div>
              </details>
            </div>
          )}
        <div className="relative">
        <svg
        viewBox={`${vbX} ${vbY} ${viewW} ${viewH}`}
        className={`w-full rounded-md border border-border bg-slate-50 ${
          expanded ? 'min-h-[min(52vh,36rem)] h-[min(52vh,36rem)]' : 'h-52'
        }`}
        onPointerDownCapture={(e) => {
          const target = e.target as Element | null
          suppressCanvasGestureRef.current = !!target?.closest('[data-canvas-hit="item"]')
        }}
        onPointerDown={(e) => {
          if (suppressCanvasGestureRef.current) return

          const target = e.target as Element | null
          if (target && target !== e.currentTarget && !target.closest('[data-canvas-hit="bg"]')) {
            return
          }

          const p = screenToSvgFrom(e.clientX, e.clientY, e.currentTarget)
          if (mode === 'shape') {
            if (startMode === 'free') {
              const anchorKey =
                !newPathMode && drawAnchorKey && freeByKey[drawAnchorKey] ? drawAnchorKey : null
              setDrawGesture({ start: p, current: p, anchorKey, shiftLock: e.shiftKey })
            }
            return
          }
          if (mode === 'rebar') {
            addRebarAt(p.x, p.y)
            return
          }
          setSpacingDrawGesture({ start: p, current: p, shiftLock: e.shiftKey })
        }}
        onPointerMove={(e) => {
          const p = screenToSvgFrom(e.clientX, e.clientY, e.currentTarget)

          if (draggingKey) {
            const h = sketch.handles.find((x) => x.key === draggingKey)
            if (!h) return
            handlePointerMove(e, h)
            return
          }

          if (mode === 'annotation' && dragSpacingLabelId) {
            moveSpacingLabel(dragSpacingLabelId, p)
            return
          }

          if (mode === 'annotation' && dragAnnotationId) {
            moveAnnotation(dragAnnotationId, p)
            return
          }

          if (mode === 'shape' && startMode === 'free') {
            if (drawGesture) {
              setDrawGesture((prev) => (prev ? { ...prev, current: p, shiftLock: e.shiftKey } : prev))
              return
            }
          }

          if (mode === 'annotation' && spacingDrawGesture) {
            setSpacingDrawGesture((prev) =>
              prev ? { ...prev, current: p, shiftLock: e.shiftKey } : prev,
            )
          }
        }}
        onPointerUp={() => {
          if (suppressCanvasGestureRef.current) {
            suppressCanvasGestureRef.current = false
            setDraggingKey(null)
            setDrawGesture(null)
            setSpacingDrawGesture(null)
            setDragSpacingLabelId(null)
            setDragAnnotationId(null)
            return
          }

          setDraggingKey(null)
          setDragSpacingLabelId(null)
          setDragAnnotationId(null)

          if (mode === 'shape' && startMode === 'free' && drawGesture) {
            addPolylineByDrag(
              drawGesture.start,
              drawGesture.current,
              drawGesture.anchorKey,
              drawGesture.shiftLock,
            )
            setDrawGesture(null)
          }

          if (mode === 'annotation' && spacingDrawGesture) {
            const end = spacingDrawGesture.shiftLock
              ? constrainOrtho(spacingDrawGesture.start, spacingDrawGesture.current)
              : spacingDrawGesture.current

            const created = addFreeSpacingByDrag(spacingDrawGesture.start, end)
            if (!created) addAnnotationAt(spacingDrawGesture.start.x, spacingDrawGesture.start.y)

            setSpacingDrawGesture(null)
          }

          suppressCanvasGestureRef.current = false
        }}
        onPointerLeave={() => {
          suppressCanvasGestureRef.current = false
          setDraggingKey(null)
          setDragSpacingLabelId(null)
          setDragAnnotationId(null)
          if (mode === 'annotation') setSpacingDrawGesture(null)
        }}
      >
        <rect
          data-canvas-hit="bg"
          x={vbX}
          y={vbY}
          width={viewW}
          height={viewH}
          fill="transparent"
        />
        {displayGeometry.segments.map((seg, idx) => {
          const p1 = startMode === 'free' ? freeByKey[seg.from] : pointByKey[seg.from]
          const p2 = startMode === 'free' ? freeByKey[seg.to] : pointByKey[seg.to]
          if (!p1 || !p2) return null
          const segPe = mode === 'shape' && startMode === 'free' ? 'auto' : 'none'
          const isSegSelected = selection?.kind === 'segment' && selection.id === `${seg.from}-${seg.to}-${idx}`
          return (
            <g key={`seg-${idx}`}>
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={isSegSelected ? '#7c3aed' : '#0f172a'}
                strokeWidth={isSegSelected ? 7 : 6}
                strokeLinecap="round"
                pointerEvents="none"
              />
              <line
                data-canvas-hit="item"
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="rgba(0,0,0,0.001)"
                strokeWidth={segmentHitWidth}
                strokeLinecap="butt"
                style={{ pointerEvents: segPe, cursor: segPe === 'auto' ? 'pointer' : 'default' }}
                onPointerDownCapture={() => {
                  markObjectPointer()
                }}
                onPointerDown={(e) => {
                  if (mode !== 'shape' || startMode !== 'free') return
                  beginObjectPointer(e)
                  selectSegment(`${seg.from}-${seg.to}-${idx}`)
                }}
              />
            </g>
          )
        })}
        {mode === 'shape' &&
          startMode === 'free' &&
          displayGeometry.points.map((p) => {
            const pointPe = mode === 'shape' && startMode === 'free' ? 'auto' : 'none'
            const isPointSelected = selection?.kind === 'point' && selection.id === p.key

            return (
              <g key={p.key}>
                {isPointSelected && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={4.5}
                    fill="#7c3aed"
                    stroke="#7c3aed"
                    strokeWidth={2}
                    pointerEvents="none"
                  />
                )}

                <circle
                  data-canvas-hit="item"
                  cx={p.x}
                  cy={p.y}
                  r={freePointHitR}
                  fill="transparent"
                  pointerEvents={pointPe}
                  style={{ cursor: pointPe === 'auto' ? 'pointer' : 'default' }}
                  onPointerDownCapture={() => {
                    markObjectPointer()
                  }}
                  onPointerDown={(e) => {
                    if (mode !== 'shape' || startMode !== 'free') return
                    beginObjectPointer(e)
                    selectPoint(p.key)
                  }}
                />
              </g>
            )
          })}
        {mode === 'shape' && startMode === 'free' && drawGesture && (
          <line
            x1={drawGesture.anchorKey && freeByKey[drawGesture.anchorKey] ? freeByKey[drawGesture.anchorKey].x : drawGesture.start.x}
            y1={drawGesture.anchorKey && freeByKey[drawGesture.anchorKey] ? freeByKey[drawGesture.anchorKey].y : drawGesture.start.y}
            x2={
              drawGesture.shiftLock
                ? constrainOrtho(
                    drawGesture.anchorKey && freeByKey[drawGesture.anchorKey]
                      ? freeByKey[drawGesture.anchorKey]
                      : drawGesture.start,
                    drawGesture.current,
                  ).x
                : drawGesture.current.x
            }
            y2={
              drawGesture.shiftLock
                ? constrainOrtho(
                    drawGesture.anchorKey && freeByKey[drawGesture.anchorKey]
                      ? freeByKey[drawGesture.anchorKey]
                      : drawGesture.start,
                    drawGesture.current,
                  ).y
                : drawGesture.current.y
            }
            stroke="#2563eb"
            strokeOpacity={0.7}
            strokeWidth={3}
            strokeDasharray="5 4"
            pointerEvents="none"
          />
        )}
        {mode === 'annotation' && spacingDrawGesture && (
          <line
            x1={spacingDrawGesture.start.x}
            y1={spacingDrawGesture.start.y}
            x2={
              spacingDrawGesture.shiftLock
                ? constrainOrtho(spacingDrawGesture.start, spacingDrawGesture.current).x
                : spacingDrawGesture.current.x
            }
            y2={
              spacingDrawGesture.shiftLock
                ? constrainOrtho(spacingDrawGesture.start, spacingDrawGesture.current).y
                : spacingDrawGesture.current.y
            }
            stroke="#7c3aed"
            strokeOpacity={0.8}
            strokeWidth={2.5}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
        {mode === 'shape' && startMode === 'template' && sketch.handles.map((h) => (
          <g key={h.key}>
            <circle
              cx={h.x}
              cy={h.y}
              r={8}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={2}
              onPointerDown={(e) => {
                e.preventDefault()
                ;(e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId)
                setDraggingKey(h.key)
              }}
            />
          </g>
        ))}
        {/* spacing hit-target layer (below visible elements) */}
        {rebarLayout.spacings.map((sp) => {
          const a =
            sp.from && byRebarId[sp.from]
              ? { x: byRebarId[sp.from]!.x, y: byRebarId[sp.from]!.y }
              : (typeof sp.x1 === 'number' && typeof sp.y1 === 'number'
                ? { x: sp.x1, y: sp.y1 }
                : null)
          const b =
            sp.to && byRebarId[sp.to]
              ? { x: byRebarId[sp.to]!.x, y: byRebarId[sp.to]!.y }
              : (typeof sp.x2 === 'number' && typeof sp.y2 === 'number'
                ? { x: sp.x2, y: sp.y2 }
                : null)
          if (!a || !b) return null
          const pe = mode === 'annotation' ? 'auto' : 'none'
          return (
            <line
              key={`${sp.id}-hit`}
              data-canvas-hit="item"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="rgba(0,0,0,0.001)"
              strokeWidth={spacingHitWidth}
              strokeLinecap="round"
              style={{ pointerEvents: pe, cursor: mode === 'annotation' ? 'pointer' : 'default' }}
              onPointerDownCapture={() => {
                markObjectPointer()
              }}
              onPointerDown={(e) => {
                if (mode !== 'annotation') return
                beginObjectPointer(e)
                selectSpacing(sp.id)
              }}
            />
          )
        })}
        {/* spacing visual layer (above hit targets) — no <g> event handler to avoid bounding-box click issues */}
        {rebarLayout.spacings.map((sp) => {
          const a =
            sp.from && byRebarId[sp.from]
              ? { x: byRebarId[sp.from]!.x, y: byRebarId[sp.from]!.y }
              : (typeof sp.x1 === 'number' && typeof sp.y1 === 'number'
                ? { x: sp.x1, y: sp.y1 }
                : null)
          const b =
            sp.to && byRebarId[sp.to]
              ? { x: byRebarId[sp.to]!.x, y: byRebarId[sp.to]!.y }
              : (typeof sp.x2 === 'number' && typeof sp.y2 === 'number'
                ? { x: sp.x2, y: sp.y2 }
                : null)
          if (!a || !b) return null
          const dx = b.x - a.x
          const dy = b.y - a.y
          const segLen = Math.hypot(dx, dy) || 1
          const nx = -dy / segLen
          const ny = dx / segLen
          const tickHalf = 6
          const txt = String(parseSpacingMm(sp.label) ?? sp.label)
          const isSpacingSelected = selection?.kind === 'spacing' && selection.id === sp.id
          const isSpacingLabelDragging = dragSpacingLabelId === sp.id
          const mainStroke = isSpacingSelected ? '#7c3aed' : '#334155'
          const tickStroke = '#64748b'
          const labelFill = isSpacingSelected || isSpacingLabelDragging ? '#7c3aed' : '#334155'
          return (
            <g key={sp.id} opacity={mode === 'annotation' ? 1 : 0.85}>
              <g pointerEvents="none">
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={mainStroke}
                  strokeWidth={isSpacingSelected ? 2.2 : 1.6}
                  strokeLinecap="butt"
                />
                <line
                  x1={a.x - nx * tickHalf}
                  y1={a.y - ny * tickHalf}
                  x2={a.x + nx * tickHalf}
                  y2={a.y + ny * tickHalf}
                  stroke={tickStroke}
                  strokeWidth={isSpacingSelected ? 2.1 : 1.6}
                  strokeLinecap="butt"
                />
                <line
                  x1={b.x - nx * tickHalf}
                  y1={b.y - ny * tickHalf}
                  x2={b.x + nx * tickHalf}
                  y2={b.y + ny * tickHalf}
                  stroke={tickStroke}
                  strokeWidth={isSpacingSelected ? 2.1 : 1.6}
                  strokeLinecap="butt"
                />
              </g>
              {txt &&
                typeof sp.label_x === 'number' &&
                typeof sp.label_y === 'number' &&
                (() => {
                  const spacingLabelFont = 23
                  const hitW = Math.max(46, txt.length * (spacingLabelFont * 0.62) + 18)
                  const hitH = 44

                  return (
                    <>
                      <rect
                        data-canvas-hit="item"
                        x={sp.label_x - hitW / 2}
                        y={sp.label_y - hitH / 2}
                        width={hitW}
                        height={hitH}
                        fill="transparent"
                        pointerEvents={mode === 'annotation' ? 'auto' : 'none'}
                        style={{ cursor: mode === 'annotation' ? 'grab' : 'default' }}
                        onPointerDownCapture={() => {
                          markObjectPointer()
                        }}
                        onPointerDown={(e) => {
                          if (mode !== 'annotation') return
                          beginObjectPointer(e)
                          // 숫자(라벨)만 클릭/드래그: 라인(선) 선택은 하지 않음
                          setSelection(null)
                          setDragSpacingLabelId(sp.id)
                        }}
                      />

                      <text
                        x={sp.label_x}
                        y={sp.label_y}
                        fontSize={spacingLabelFont}
                        fill={labelFill}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        pointerEvents="none"
                      >
                        {txt}
                      </text>
                    </>
                  )
                })()}
            </g>
          )
        })}
        {rebarLayout.rebars.map((rb) => {
          const rebarPe = mode === 'rebar' || mode === 'annotation' ? 'auto' : 'none'
          const token = rebarDiameterVisualToken(rb.diameter)
          const isSelected = selection?.kind === 'rebar' && selection.id === rb.id
          const labelText = rb.label || rb.diameter
          const labelW = Math.max(22, Math.round(labelText.length * (rebarLabelFont * 0.68) + 10))
          const labelX = rb.x + rebarLabelPadX
          const labelY = rb.y - (rebarLabelYOffset + rebarLabelBoxH)
          return (
            <g key={rb.id} pointerEvents="none" opacity={mode === 'shape' ? 0.55 : 1}>
              {isSelected && (
                <circle
                  cx={rb.x}
                  cy={rb.y}
                  r={rebarSelectR}
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  opacity={0.75}
                />
              )}
              <circle
                cx={rb.x}
                cy={rb.y}
                r={rebarBodyR}
                fill={token.fill}
                stroke={isSelected ? '#7c3aed' : token.stroke}
                strokeWidth={isSelected ? 3 : 2}
              />
              <circle
                data-canvas-hit="item"
                cx={rb.x}
                cy={rb.y}
                r={rebarHitR}
                fill="transparent"
                pointerEvents={rebarPe}
                style={{ cursor: rebarPe === 'auto' ? 'pointer' : 'default' }}
                onPointerDownCapture={() => {
                  markObjectPointer()
                }}
                onPointerDown={(e) => {
                  if (mode !== 'rebar' && mode !== 'annotation') return
                  beginObjectPointer(e)
                  onRebarClick(rb.id)
                }}
              />
              {isSelected && (
                <rect
                  x={labelX}
                  y={labelY}
                  rx={4}
                  ry={4}
                  width={labelW}
                  height={rebarLabelBoxH}
                  fill="#f5f3ff"
                  stroke="#c4b5fd"
                  strokeWidth={1}
                />
              )}
              <text
                x={labelX + 4}
                y={labelY + rebarLabelBoxH / 2}
                fontSize={rebarLabelFont}
                fill={isSelected ? '#6d28d9' : token.text}
                fontWeight={700}
                dominantBaseline="middle"
              >
                {labelText}
              </text>
            </g>
          )
        })}
        {rebarLayout.annotations.map((an) => {
          const pe = mode === 'annotation' ? 'auto' : 'none'
          const isNumeric = parseSpacingMm(an.text) != null
          const annotationFont = 23
          const hitW = Math.max(46, String(an.text).length * (annotationFont * 0.62) + 18)
          const hitH = 44

          return (
            <g key={an.id}>
              {isNumeric ? (
                <rect
                  data-canvas-hit="item"
                  x={an.x - hitW / 2}
                  y={an.y - hitH / 2}
                  width={hitW}
                  height={hitH}
                  fill="transparent"
                  pointerEvents={mode === 'annotation' ? 'auto' : 'none'}
                  style={{ cursor: mode === 'annotation' ? 'grab' : 'default' }}
                  onPointerDownCapture={() => {
                    markObjectPointer()
                  }}
                  onPointerDown={(e) => {
                    if (mode !== 'annotation') return
                    beginObjectPointer(e)
                    selectAnnotation(an.id)
                    setDragAnnotationId(an.id)
                  }}
                />
              ) : null}

              <text
                data-canvas-hit="item"
                x={an.x}
                y={an.y}
                fontSize={annotationFont}
                fill={selection?.kind === 'annotation' && selection.id === an.id ? '#7c3aed' : '#0f172a'}
                fontWeight={700}
                opacity={mode === 'annotation' ? 1 : 0.5}
                pointerEvents={isNumeric ? 'none' : pe}
                style={{ cursor: mode === 'annotation' ? 'pointer' : 'default' }}
                onPointerDownCapture={() => {
                  markObjectPointer()
                }}
                onPointerDown={(e) => {
                  if (mode !== 'annotation') return
                  beginObjectPointer(e)
                  selectAnnotation(an.id)
                }}
              >
                {an.text}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-border/70 bg-white/95 px-1.5 py-1 text-[10px] text-muted shadow-sm backdrop-blur-sm">
        <button
          type="button"
          onClick={zoomOut}
          className="rounded border border-border/60 px-1.5 py-0.5 hover:bg-slate-50"
          aria-label="zoom out"
        >
          -
        </button>
        <span className="min-w-[46px] text-center">{Math.round(clampedZoom * 100)}%</span>
        <button
          type="button"
          onClick={zoomIn}
          className="rounded border border-border/60 px-1.5 py-0.5 hover:bg-slate-50"
          aria-label="zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={resetZoom}
          title="ズームをリセット"
          aria-label="ズームをリセット"
          className="rounded border border-border/60 px-1.5 py-0.5 hover:bg-slate-50"
        >
          100%
        </button>
      </div>
      </div>
      </div>

      <aside className="flex w-full min-w-0 flex-col gap-2 lg:w-[30%] lg:max-h-[min(42rem,78vh)] lg:overflow-y-auto">
        <div className="rounded-lg border border-border bg-white p-3 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">選択中の要素</span>
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-muted">
                  {mode === 'shape' ? '形状' : mode === 'rebar' ? '鉄筋' : '注記・間隔'}
                </span>
                <button
                  type="button"
                  onClick={clearCanvasSelections}
                  className="rounded border border-border px-2 py-0.5 text-[10px] text-muted hover:bg-slate-50 hover:text-foreground"
                >
                  選択解除
                </button>
              </div>
            </div>
            <p className="text-[10px] leading-snug text-muted">
              選択した線・鉄筋・間隔・注記の設定をここで変更できます。点の詳細編集は「詳細操作」から行います。
            </p>
          </div>
          <div className="mt-3 space-y-3 text-[11px]">
            {mode === 'annotation' && selectedSpacing && (
              <div className="space-y-2 border-b border-border pb-3">
                <div className="font-medium text-foreground">間隔（鉄筋間）</div>
                <button
                  type="button"
                  onClick={() => {
                    const nextSpacings = rebarLayout.spacings.filter((sp) => sp.id !== selectedSpacing.id)
                    onRebarLayoutChange(normalizeRebarLayout({ ...rebarLayout, spacings: nextSpacings }))
                    setSelection(null)
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                >
                  この間隔を削除
                </button>
              </div>
            )}

            {mode === 'annotation' && selectedAnnotation && !selectedSpacing && (
              <div className="space-y-2 border-b border-border pb-3">
                <div className="font-medium text-foreground">フリー注記</div>
                {parseSpacingMm(selectedAnnotation.text) != null ? (
                  <label className="block text-muted">
                    数値（mm）
                    <input
                      type="number"
                      min={0}
                      value={parseSpacingMm(selectedAnnotation.text) ?? spacingMmDraft}
                      onChange={(e) => {
                        const nextMm = parseInt(e.target.value, 10) || 0
                        setSpacingMmDraft(nextMm)
                        const nextAnnotations = rebarLayout.annotations.map((an) =>
                          an.id === selectedAnnotation.id ? { ...an, text: `${nextMm}` } : an,
                        )
                        onRebarLayoutChange(normalizeRebarLayout({ ...rebarLayout, annotations: nextAnnotations }))
                      }}
                      className="mt-1 w-24 rounded border border-border px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                  </label>
                ) : (
                  <label className="block text-muted">
                    テキスト
                    <input
                      value={selectedAnnotation.text}
                      onChange={(e) => {
                        const v = e.target.value
                        const nextAnnotations = rebarLayout.annotations.map((an) =>
                          an.id === selectedAnnotation.id ? { ...an, text: v } : an,
                        )
                        onRebarLayoutChange(normalizeRebarLayout({ ...rebarLayout, annotations: nextAnnotations }))
                      }}
                      className="mt-1 w-full rounded border border-border px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                  </label>
                )}
                <div className="text-muted">
                  位置: {Math.round(selectedAnnotation.x)}, {Math.round(selectedAnnotation.y)}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextAnnotations = rebarLayout.annotations.filter((an) => an.id !== selectedAnnotation.id)
                    onRebarLayoutChange(normalizeRebarLayout({ ...rebarLayout, annotations: nextAnnotations }))
                    setSelection(null)
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                >
                  この注記を削除
                </button>
              </div>
            )}

            {mode === 'rebar' && selectedRebar && (
              <div className="space-y-2 border-b border-border pb-3">
                <div className="font-medium text-foreground">鉄筋（配置点）</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="text-muted">
                    径
                    <select
                      value={selectedRebar.diameter}
                      onChange={(e) => {
                        const next = rebarLayout.rebars.map((r) =>
                          r.id === selectedRebar.id ? { ...r, diameter: e.target.value } : r,
                        )
                        onRebarLayoutChange(normalizeRebarLayout({ ...rebarLayout, rebars: next }))
                      }}
                      className="mt-1 w-full rounded border border-border px-2 py-1 text-xs bg-white outline-none focus:border-primary"
                    >
                      {BAR_TYPES.map((bt) => (
                        <option key={bt} value={bt}>
                          {bt}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-muted">
                    役割
                    <input
                      value={selectedRebar.role ?? ''}
                      onChange={(e) => {
                        const next = rebarLayout.rebars.map((r) =>
                          r.id === selectedRebar.id ? { ...r, role: e.target.value || null } : r,
                        )
                        onRebarLayoutChange(normalizeRebarLayout({ ...rebarLayout, rebars: next }))
                      }}
                      className="mt-1 w-full rounded border border-border px-2 py-1 text-xs outline-none focus:border-primary"
                      placeholder="main / sub"
                    />
                  </label>
                </div>
                <label className="block text-muted">
                  表示ラベル（任意）
                  <input
                    value={selectedRebar.label ?? ''}
                    onChange={(e) => {
                      const v = e.target.value || null
                      const next = rebarLayout.rebars.map((r) =>
                        r.id === selectedRebar.id ? { ...r, label: v } : r,
                      )
                      onRebarLayoutChange(normalizeRebarLayout({ ...rebarLayout, rebars: next }))
                    }}
                    className="mt-1 w-full rounded border border-border px-2 py-1 text-xs outline-none focus:border-primary"
                    placeholder="空欄なら径を表示"
                  />
                </label>
                <div className="text-muted">
                  座標: {Math.round(selectedRebar.x)}, {Math.round(selectedRebar.y)}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextRebars = rebarLayout.rebars.filter((r) => r.id !== selectedRebar.id)
                    const nextSpacings = rebarLayout.spacings.filter(
                      (s) => s.from !== selectedRebar.id && s.to !== selectedRebar.id,
                    )
                    onRebarLayoutChange(
                      normalizeRebarLayout({ ...rebarLayout, rebars: nextRebars, spacings: nextSpacings }),
                    )
                    setSelection(null)
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                >
                  この鉄筋を削除
                </button>
              </div>
            )}

            {mode === 'shape' && startMode === 'free' && selectedFreePoint && (
              <div className="space-y-2 border-b border-border pb-3">
                <div className="font-medium text-foreground">端点（詳細）</div>
                <div className="text-muted">
                  座標: {Math.round(selectedFreePoint.x)}, {Math.round(selectedFreePoint.y)}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawAnchorKey(selectedFreePoint.key)
                      setNewPathMode(false)
                    }}
                    className="rounded border border-border px-2 py-1 text-[11px] hover:bg-gray-50"
                  >
                    この点から開始
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      pushHistorySnapshot()
                      const nextPoints = displayGeometry.points.filter((p) => p.key !== selectedFreePoint.key)
                      if (nextPoints.length === 0) return
                      const nextSegments = displayGeometry.segments.filter(
                        (s) => s.from !== selectedFreePoint.key && s.to !== selectedFreePoint.key,
                      )
                      onGeometryChange({
                        ...displayGeometry,
                        points: nextPoints,
                        segments: nextSegments,
                        bounds: calcBounds(nextPoints),
                      })
                      setSelection(null)
                      setDrawAnchorKey(null)
                    }}
                    className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                  >
                    この端点を削除
                  </button>
                </div>
              </div>
            )}

            {mode === 'shape' && startMode === 'free' && selectedSegmentInfo && !selectedFreePoint && (
              <div className="space-y-2 border-b border-border pb-3">
                <div className="font-medium text-foreground">形状の線分</div>
                <div className="text-muted space-y-1">
                  <div>
                    端点: {selectedSegmentInfo.seg.from} → {selectedSegmentInfo.seg.to}
                  </div>
                  <div>長さ（座標系）: 約 {selectedSegmentInfo.lengthMm}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (selection?.kind !== 'segment') return
                    const segmentKey = selection.id
                    pushHistorySnapshot()
                    const nextSegments = displayGeometry.segments.filter(
                      (s, idx) => `${s.from}-${s.to}-${idx}` !== segmentKey,
                    )
                    onGeometryChange({
                      ...displayGeometry,
                      segments: nextSegments,
                      bounds: calcBounds(displayGeometry.points),
                    })
                    setSelection(null)
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                >
                  線分を削除
                </button>
              </div>
            )}

            {mode === 'shape' && startMode === 'template' && (
              <div className="space-y-2">
                <div className="font-medium text-foreground">標準形状の寸法</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {dimFields.map((f) => (
                    <label key={f.key} className="text-muted">
                      {f.label}
                      <input
                        type="number"
                        min={0}
                        value={spec[f.key]}
                        onChange={(e) => setDim(f.key, parseInt(e.target.value, 10) || 0)}
                        className="mt-1 w-full rounded border border-border px-2 py-1 text-xs outline-none focus:border-primary bg-white"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!(
              (mode === 'annotation' && (selectedSpacing || selectedAnnotation)) ||
              (mode === 'rebar' && selectedRebar) ||
              (mode === 'shape' && startMode === 'free' && (selectedFreePoint || selectedSegmentInfo)) ||
              (mode === 'shape' && startMode === 'template')
            ) && (
              <p className="text-[11px] leading-relaxed text-muted">
                キャンバス上の点・線・鉄筋・間隔・注記を選択してください。
              </p>
            )}
          </div>
        </div>

        {aggregationSlot}
      </aside>
    </div>
  )
}

/** プレビューモーダル用: 同一形状グループの各バリアントの長さ(mm)を番号付きで列挙 */
export function UnitVariantLengthList({ allUnits, unit }: { allUnits: Unit[]; unit: Unit }) {
  const variants = useMemo(() => listUnitVariantsInGroup(allUnits, unit), [allUnits, unit])
  if (variants.length === 0) return null

  return (
    <div className="mt-2 border-t border-slate-200 pt-2">
      <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted">長さ(mm) / 番号</div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-foreground">
        {variants.map((v, idx) => {
          const mark = v.mark_number ?? idx + 1
          const len = unitVariantLengthMm(v)
          const badge = formatVariantMarkBadge(mark)
          return (
            <li key={v.id} className="tabular-nums">
              <span className="font-semibold text-slate-600">{badge}</span>
              <span className="mx-1 text-muted">·</span>
              <span className="font-semibold">{len != null ? `${len.toLocaleString('ja-JP')}mm` : '—'}</span>
              {v.code ? <span className="ml-1.5 font-mono text-[10px] text-muted">({v.code})</span> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function UnitShapeThumbnail({ unit, large = false }: { unit: Unit; large?: boolean }) {
  const template = shapeTypeToDetailTemplate(unit.shape_type)
  const spec = normalizeDetailSpecForTemplate(
    template,
    unit.detail_spec ?? getDefaultDetailSpec(template),
  )
  const sketch = buildShapeSketch(template, spec)
  const storedGeo = unit.detail_geometry
  const useStoredGeo =
    !!storedGeo &&
    Array.isArray(storedGeo.points) &&
    Array.isArray(storedGeo.segments) &&
    storedGeo.points.length > 1 &&
    storedGeo.segments.length > 0
  const previewGeometry = useStoredGeo ? storedGeo : sketch.geometry
  const dimFields = getEditableDimFields(template)
  const geoBounds = previewGeometry.bounds
  const xs = previewGeometry.points.map((p) => p.x)
  const ys = previewGeometry.points.map((p) => p.y)
  const minX = Number.isFinite(geoBounds?.minX) ? geoBounds!.minX : Math.min(...xs, 0)
  const minY = Number.isFinite(geoBounds?.minY) ? geoBounds!.minY : Math.min(...ys, 0)
  const maxX = Number.isFinite(geoBounds?.maxX) ? geoBounds!.maxX : Math.max(...xs, 100)
  const maxY = Number.isFinite(geoBounds?.maxY) ? geoBounds!.maxY : Math.max(...ys, 60)
  const pad = 24
  const w = Math.max(110, maxX - minX + pad * 2)
  const h = Math.max(66, maxY - minY + pad * 2)
  const byKey = Object.fromEntries(previewGeometry.points.map((p) => [p.key, p]))
  const stroke = getSegmentStrokeHex(normalizeSegmentColor(unit.color), false)
  const previewRebarLayout = normalizeRebarLayout(unit.rebar_layout)
  const previewRebars = previewRebarLayout.rebars.filter(
    (rb) => Number.isFinite(rb.x) && Number.isFinite(rb.y),
  )
  const byRebarId = Object.fromEntries(previewRebars.map((rb) => [rb.id, rb]))
  const previewSpacings = previewRebarLayout.spacings
    .map((sp) => {
      const a =
        sp.from && byRebarId[sp.from]
          ? { x: byRebarId[sp.from]!.x, y: byRebarId[sp.from]!.y }
          : typeof sp.x1 === 'number' && typeof sp.y1 === 'number'
            ? { x: sp.x1, y: sp.y1 }
            : null
      const b =
        sp.to && byRebarId[sp.to]
          ? { x: byRebarId[sp.to]!.x, y: byRebarId[sp.to]!.y }
          : typeof sp.x2 === 'number' && typeof sp.y2 === 'number'
            ? { x: sp.x2, y: sp.y2 }
            : null

      if (!a || !b) return null

      const dx = b.x - a.x
      const dy = b.y - a.y
      const segLen = Math.hypot(dx, dy) || 1
      const nx = -dy / segLen
      const ny = dx / segLen
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const labelOff = large ? 12 : 8

      // 形状編集と同じ表示ルール（生座標距離は誤解を招くためフォールバックしない）
      const spacingText = String(parseSpacingMm(sp.label) ?? (sp.label ?? '')).trim()

      const hasSavedLabelPos =
        typeof sp.label_x === 'number' &&
        Number.isFinite(sp.label_x) &&
        typeof sp.label_y === 'number' &&
        Number.isFinite(sp.label_y)
      const tx = hasSavedLabelPos ? sp.label_x! : midX + nx * labelOff
      const ty = hasSavedLabelPos ? sp.label_y! : midY + ny * labelOff

      return {
        id: sp.id,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        labelText: spacingText,
        tx,
        ty,
      }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  const rebarR = large ? 8 : 3.2
  const rebarStrokeW = large ? 2 : 1
  const rebarFont = large ? 12 : 6.5
  const spacingFont = large ? 11 : 7

  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className={large ? 'h-72 w-full rounded border border-border bg-white' : 'h-12 w-28 rounded border border-border bg-white'}
      aria-label="shape thumbnail"
    >
      {previewGeometry.segments.map((seg, i) => {
        const p1 = byKey[seg.from]
        const p2 = byKey[seg.to]
        if (!p1 || !p2) return null
        return (
          <line
            key={`${seg.from}-${seg.to}-${i}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={stroke}
            strokeWidth={large ? 7 : 8}
            strokeLinecap="round"
          />
        )
      })}
      {previewSpacings.map((sp) => {
        return (
          <g key={`sp-${sp.id}`}>
            <line
              x1={sp.x1}
              y1={sp.y1}
              x2={sp.x2}
              y2={sp.y2}
              stroke="#64748b"
              strokeWidth={large ? 2 : 1.2}
              strokeDasharray={large ? '5 3' : '3 2'}
            />
            {sp.labelText ? (
              <text
                x={sp.tx}
                y={sp.ty}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={spacingFont}
                fill="#334155"
                fontWeight={700}
              >
                {sp.labelText}
              </text>
            ) : null}
          </g>
        )
      })}
      {previewRebars.map((rb) => {
        const txt = rb.label || rb.diameter
        const token = rebarDiameterVisualToken(rb.diameter)
        return (
          <g key={`rb-${rb.id}`}>
            <circle
              cx={rb.x}
              cy={rb.y}
              r={rebarR}
              fill={token.fill}
              stroke={token.stroke}
              strokeWidth={rebarStrokeW}
            />
            {large ? (
              <text
                x={rb.x + rebarR + 2}
                y={rb.y - rebarR - 1}
                fontSize={rebarFont}
                fill={token.text}
                fontWeight={700}
              >
                {txt}
              </text>
            ) : null}
          </g>
        )
      })}
      {/* 間隔線(spacings)とは別に保存される注記＝距離ラベル等（形状編集の annotations と同じ） */}
      {(large ? previewRebarLayout.annotations : []).map((an) => {
        if (!Number.isFinite(an.x) || !Number.isFinite(an.y)) return null
        const t = String(an.text ?? '').trim()
        if (!t) return null
        return (
          <text
            key={`an-${an.id}`}
            x={an.x}
            y={an.y}
            fontSize={11}
            fill="#0f172a"
            fontWeight={700}
          >
            {t}
          </text>
        )
      })}
      {large &&
        !useStoredGeo &&
        sketch.handles.map((h) => (
          <g key={`pt-${h.key}`}>
            <circle cx={h.x} cy={h.y} r={5} fill="#ffffff" stroke="#334155" strokeWidth={1.5} />
          </g>
        ))}
      {large && !useStoredGeo && (
        <g>
          <rect
            x={minX - pad + 8}
            y={minY - pad + 8}
            width={Math.min(360, w * 0.55)}
            height={Math.max(42, dimFields.length * 18 + 12)}
            rx={6}
            fill="rgba(255,255,255,0.92)"
            stroke="#cbd5e1"
          />
          {dimFields.map((f, i) => (
            <text
              key={`dim-${f.key}`}
              x={minX - pad + 18}
              y={minY - pad + 28 + i * 18}
              fontSize={13}
              fill="#0f172a"
              fontWeight={600}
            >
              {f.label}: {spec[f.key]}
            </text>
          ))}
        </g>
      )}
    </svg>
  )
}

// ─── テーブル行コンポーネント ─────────────────────────────
function UnitRow({
  unit,
  onEdit,
  onPreview,
  onDeactivate,
  onReactivate,
}: {
  unit: Unit
  onEdit: () => void
  onPreview: () => void
  onDeactivate: () => void
  onReactivate: () => void
}) {
  const uc = normalizeSegmentColor(unit.color)
  const stroke = getSegmentStrokeHex(uc, false)
  const tint = getSegmentCardTint(uc)
  const colorLabel = getSegmentColorLabelJa(uc)
  /** 無効行は本文だけ薄くし、操作列のボタンは opacity を下げない */
  const dimInactiveCell = !unit.is_active ? 'opacity-50' : ''

  return (
    <tr className="transition-colors hover:bg-gray-50">
      {/* 色バー */}
      <td className={`px-4 py-3 ${dimInactiveCell}`}>
        <span
          className="block w-1.5 h-8 rounded-full"
          style={{ background: stroke }}
        />
      </td>
      {/* 名前 */}
      <td className={`px-4 py-3 ${dimInactiveCell}`}>
        <div className="flex items-center gap-2">
          <div>
            <p className="font-medium text-sm">{unit.name}</p>
            {unit.location_type && (
              <p className="text-[11px] text-muted">{unit.location_type}</p>
            )}
          </div>
          {!unit.is_active && (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-muted">無効</span>
          )}
        </div>
      </td>
      {/* 形状サムネイル */}
      <td className={`px-4 py-3 hidden md:table-cell ${dimInactiveCell}`}>
        <button type="button" onClick={onPreview} className="block">
          <UnitShapeThumbnail unit={unit} />
        </button>
      </td>
      {/* コード */}
      <td className={`px-4 py-3 hidden sm:table-cell ${dimInactiveCell}`}>
        <span className="font-mono text-xs text-muted">{unit.code ?? '-'}</span>
      </td>
      {/* 位置 */}
      <td className={`px-4 py-3 hidden md:table-cell ${dimInactiveCell}`}>
        <span className="text-xs">{unit.location_type ?? '-'}</span>
      </td>
      {/* 色/番号 */}
      <td className={`px-4 py-3 whitespace-nowrap ${dimInactiveCell}`}>
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: tint, color: stroke }}
        >
          {colorLabel}
        </span>
      </td>
      {/* 鉄筋構成 */}
      <td className={`px-4 py-3 hidden lg:table-cell ${dimInactiveCell}`}>
        <span className="text-xs font-mono text-muted">
          {barsSummary(unit.bars)}
        </span>
      </td>
      {/* 間隔 */}
      <td className={`px-4 py-3 hidden lg:table-cell ${dimInactiveCell}`}>
        <span className="text-xs text-muted">
          {unit.spacing_mm != null ? `${unit.spacing_mm}mm` : '-'}
        </span>
      </td>
      {/* 操作 */}
      <td className="px-4 py-3 text-right">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 transition-colors"
          >
            編集
          </button>
          {unit.is_active ? (
            <button
              type="button"
              onClick={onDeactivate}
              className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              無効化
            </button>
          ) : (
            <button
              type="button"
              onClick={onReactivate}
              className="rounded-md border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors"
            >
              有効化
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
