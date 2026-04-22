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
  SEGMENT_COLOR_ORDER,
} from '@/lib/segment-colors'
import {
  SHAPE_TYPE_DEFS,
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
  deleteLengthPresetGroupFromDb,
  fetchLengthPresetGroupsFromDb,
  insertLengthPresetGroupToDb,
  updateLengthPresetGroupInDb,
  type LengthPresetGroup,
} from '@/lib/length-presets'
import {
  formatVariantMarkBadge,
  listUnitVariantsInGroup,
  unitVariantGroupKey,
  unitVariantLengthMm,
} from '@/lib/unit-variant-group'

const BAR_TYPES = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25', 'D29', 'D32']

type LengthPresetFormRow = {
  id: string
  no: string
  lengthMm: string
}

function newLengthPresetRowId(): string {
  return `lpr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function makeLengthPresetRow(no: string, lengthMm = ''): LengthPresetFormRow {
  return { id: newLengthPresetRowId(), no, lengthMm }
}

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
  pitch_mm: string
  l_shape_count: string
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
  pitch_mm: '',
  l_shape_count: '',
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
    pitch_mm:
      unit.pitch_mm != null
        ? `@${unit.pitch_mm}`
        : '',
    l_shape_count:
      unit.l_shape_count != null && Number.isFinite(unit.l_shape_count)
        ? String(Math.max(0, Math.floor(unit.l_shape_count)))
        : '',
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
  // Shape-only preset: intentionally store only shape-related data.
  return {
    location_type: draft.location_type,
    shape_type: draft.shape_type,
    color: DEFAULT_DRAFT.color,
    mark_number: DEFAULT_DRAFT.mark_number,
    bars: [],
    spacing_mm: '',
    pitch_mm: draft.pitch_mm,
    l_shape_count: draft.l_shape_count,
    description: draft.description,
    detail_spec: spec,
    detail_geometry: draft.detail_geometry ? JSON.parse(JSON.stringify(draft.detail_geometry)) : null,
    detail_start_mode: draft.detail_start_mode,
    rebar_layout: { rebars: [], spacings: [], annotations: [] },
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
  const [detailEditMode, setDetailEditMode] = useState<'shape' | 'rebar' | 'annotation' | 'pitch'>(
    'shape',
  )
  const [saveValidationMessage, setSaveValidationMessage] = useState<string | null>(null)
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetSavedToast, setPresetSavedToast] = useState(false)
  const [userPresets, setUserPresets] = useState<UserUnitPreset[]>([])
  const [draggingPresetId, setDraggingPresetId] = useState<string | null>(null)
  const [lengthPresetGroups, setLengthPresetGroups] = useState<LengthPresetGroup[]>([])
  const [lengthPresetListModalOpen, setLengthPresetListModalOpen] = useState(false)
  const [lengthPresetModalOpen, setLengthPresetModalOpen] = useState(false)
  const [lengthPresetModalMode, setLengthPresetModalMode] = useState<'create' | 'edit'>('create')
  const [lengthPresetEditId, setLengthPresetEditId] = useState<string | null>(null)
  const [lengthPresetFormName, setLengthPresetFormName] = useState('')
  const [lengthPresetFormDescription, setLengthPresetFormDescription] = useState('')
  const [lengthPresetFormRows, setLengthPresetFormRows] = useState<LengthPresetFormRow[]>([
    makeLengthPresetRow('1'),
  ])
  const [lengthPresetSaving, setLengthPresetSaving] = useState(false)
  const [duplicateSourceId, setDuplicateSourceId] = useState<string>('')
  const [filter, setFilter] = useState<FilterState>({
    showInactive: false,
    searchText: '',
  })

  useEffect(() => {
    if (!modalOpen) return
    let cancelled = false
    void (async () => {
      const list = await fetchUserPresetsFromDb(supabaseRef.current!)
      if (!cancelled) setUserPresets(applyUserPresetOrder(list))
    })()
    return () => {
      cancelled = true
    }
  }, [modalOpen])

  useEffect(() => {
    if (!modalOpen && !lengthPresetListModalOpen && !lengthPresetModalOpen) return
    let cancelled = false
    void (async () => {
      const list = await fetchLengthPresetGroupsFromDb(supabaseRef.current!)
      if (!cancelled) setLengthPresetGroups(list)
    })()
    return () => {
      cancelled = true
    }
  }, [modalOpen, lengthPresetListModalOpen, lengthPresetModalOpen])

  useEffect(() => {
    if (!presetSavedToast) return
    const id = window.setTimeout(() => setPresetSavedToast(false), 2800)
    return () => window.clearTimeout(id)
  }, [presetSavedToast])

  const userPresetOrderStorageKey = 'rebar-optimizer:user-unit-presets:order:v1'

  function readUserPresetOrder(): string[] {
    try {
      const raw = window.localStorage.getItem(userPresetOrderStorageKey)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  function writeUserPresetOrder(ids: string[]) {
    try {
      window.localStorage.setItem(userPresetOrderStorageKey, JSON.stringify(ids))
    } catch {
      // ignore
    }
  }

  function applyUserPresetOrder(list: UserUnitPreset[]): UserUnitPreset[] {
    const order = readUserPresetOrder()
    if (order.length === 0) return list
    const rank = new Map(order.map((id, idx) => [id, idx]))
    return [...list].sort((a, b) => {
      const ar = rank.get(a.id)
      const br = rank.get(b.id)
      if (ar != null && br != null) return ar - br
      if (ar != null) return -1
      if (br != null) return 1
      return 0
    })
  }

  function reorderUserPreset(activeId: string, overId: string) {
    if (activeId === overId) return
    setUserPresets((prev) => {
      const from = prev.findIndex((p) => p.id === activeId)
      const to = prev.findIndex((p) => p.id === overId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      if (!moved) return prev
      next.splice(to, 0, moved)
      writeUserPresetOrder(next.map((p) => p.id))
      return next
    })
  }

  // ─── フィルタ適用 ──────────────────────────────────────
  const filteredUnits = useMemo(() => {
    return units.filter((u) => {
      if (!filter.showInactive && !u.is_active) return false
      if (filter.searchText.trim()) {
        const q = filter.searchText.toLowerCase()
        if (!u.name.toLowerCase().includes(q)) return false
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

  /** 編集中のバリアント群（同一キーなら色の共有可） */
  const editingVariantGroupKey = useMemo(
    () => (editingUnit ? unitVariantGroupKey(editingUnit) : null),
    [editingUnit],
  )

  /** 他のユニット群が既に使っている色か（同一 variant 群は除外） */
  function isSegmentColorTakenByOtherUnit(color: SegmentColor, selfGroupKey: string | null): boolean {
    const c = normalizeSegmentColor(color)
    for (const u of units) {
      if (u.is_active === false) continue
      if (normalizeSegmentColor(u.color) !== c) continue
      if (selfGroupKey != null && unitVariantGroupKey(u) === selfGroupKey) continue
      return true
    }
    return false
  }

  function firstFreeSegmentColor(selfGroupKey: string | null): SegmentColor {
    for (const id of SEGMENT_COLOR_ORDER) {
      if (!isSegmentColorTakenByOtherUnit(id, selfGroupKey)) return id
    }
    return SEGMENT_COLOR_ORDER[0] ?? 'red'
  }

  // ─── モーダル開閉 ──────────────────────────────────────
  function openCreate() {
    setEditingUnit(null)
    setDraft({ ...DEFAULT_DRAFT, color: firstFreeSegmentColor(null) })
    setDuplicateSourceId('')
    setOpenShapeEditorOnModal(false)
    setModalTab('basic')
    setModalOpen(true)
  }

  function startFromEmptyCanvas() {
    setEditingUnit(null)
    setDraft({ ...DEFAULT_DRAFT, color: firstFreeSegmentColor(null) })
    setDuplicateSourceId('')
    setDetailEditMode('shape')
    setModalTab('detail')
  }

  function applyUserPreset(preset: UserUnitPreset) {
    const p = preset.payload
    const t = shapeTypeToDetailTemplate(p.shape_type)
    const spec = normalizeDetailSpecForTemplate(t, p.detail_spec)
    setDraft((prev) => ({
      ...prev,
      shape_type: p.shape_type,
      description: p.description ?? prev.description,
      l_shape_count: p.l_shape_count ?? '',
      detail_spec: spec,
      detail_geometry: p.detail_geometry
        ? JSON.parse(JSON.stringify(p.detail_geometry))
        : createEmptyFreeGeometry(),
      detail_start_mode: p.detail_start_mode ?? 'free',
    }))
    setDetailEditMode('shape')
    setModalTab('detail')
  }

  async function handleSaveAsPreset() {
    const autoName = `shape-${new Date().toISOString()}`
    setSavingPreset(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setSavingPreset(false)
      alert('ログインが必要です。')
      return
    }
    const preset = await insertUserPresetToDb(supabase, {
      name: autoName,
      payload: draftToPresetPayload(draft),
    })
    if (!preset) {
      setSavingPreset(false)
      alert('プリセットの保存に失敗しました。')
      return
    }
    setUserPresets((prev) => {
      const next = [preset, ...prev]
      writeUserPresetOrder(next.map((p) => p.id))
      return next
    })
    setSavingPreset(false)
    setPresetSavedToast(true)
  }

  async function deleteUserPreset(id: string) {
    if (!window.confirm('このプリセットを削除しますか？')) return
    const ok = await deleteUserPresetFromDb(supabase, id)
    if (!ok) {
      alert('削除に失敗しました。')
      return
    }
    setUserPresets((prev) => {
      const next = prev.filter((p) => p.id !== id)
      writeUserPresetOrder(next.map((p) => p.id))
      return next
    })
  }

  function openLengthPresetCreateModal() {
    setLengthPresetModalMode('create')
    setLengthPresetEditId(null)
    setLengthPresetFormName('')
    setLengthPresetFormDescription('')
    setLengthPresetFormRows([makeLengthPresetRow('1')])
    setLengthPresetModalOpen(true)
  }

  function openLengthPresetEditModal(group: LengthPresetGroup) {
    setLengthPresetModalMode('edit')
    setLengthPresetEditId(group.id)
    setLengthPresetFormName(group.name)
    setLengthPresetFormDescription(group.description ?? '')
    const lens = group.lengths ?? []
    if (lens.length === 0) {
      setLengthPresetFormRows([makeLengthPresetRow('1')])
    } else {
      setLengthPresetFormRows(
        lens.map((len, i) => makeLengthPresetRow(String(i + 1), String(len))),
      )
    }
    setLengthPresetModalOpen(true)
  }

  function closeLengthPresetModal() {
    setLengthPresetModalOpen(false)
    setLengthPresetSaving(false)
    setLengthPresetEditId(null)
  }

  function addLengthPresetFormRow() {
    setLengthPresetFormRows((prev) => {
      const nextNo = String(prev.length + 1)
      return [...prev, makeLengthPresetRow(nextNo)]
    })
  }

  function removeLengthPresetFormRow(id: string) {
    setLengthPresetFormRows((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((r) => r.id !== id)
    })
  }

  function updateLengthPresetFormRow(id: string, patch: Partial<Pick<LengthPresetFormRow, 'no' | 'lengthMm'>>) {
    setLengthPresetFormRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    )
  }

  async function submitLengthPresetModal() {
    const name = lengthPresetFormName.trim()
    if (!name) {
      alert('プリセット名を入力してください。')
      return
    }
    const lengths = lengthPresetFormRows
      .map((r) => Number.parseInt(String(r.lengthMm ?? '').trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (lengths.length === 0) {
      alert('長さ（mm）を1件以上入力してください。')
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      alert('ログインが必要です。')
      return
    }

    setLengthPresetSaving(true)
    const description = lengthPresetFormDescription.trim() || null

    if (lengthPresetModalMode === 'create') {
      const res = await insertLengthPresetGroupToDb(supabase, {
        name,
        description,
        lengths,
      })
      setLengthPresetSaving(false)
      if (!res.ok) {
        alert(`長さプリセットの保存に失敗しました。\n\n${res.message}`)
        return
      }
      setLengthPresetGroups((prev) => [res.group, ...prev])
    } else if (lengthPresetEditId) {
      const res = await updateLengthPresetGroupInDb(supabase, {
        id: lengthPresetEditId,
        name,
        description,
        lengths,
      })
      setLengthPresetSaving(false)
      if (!res.ok) {
        alert(`更新に失敗しました。\n\n${res.message}`)
        return
      }
      setLengthPresetGroups((prev) => prev.map((g) => (g.id === lengthPresetEditId ? res.group : g)))
    } else {
      setLengthPresetSaving(false)
      return
    }

    closeLengthPresetModal()
  }

  async function deleteLengthPresetGroup(groupId: string) {
    if (!window.confirm('この長さプリセットグループを削除しますか？')) return
    const ok = await deleteLengthPresetGroupFromDb(supabase, groupId)
    if (!ok) {
      alert('削除に失敗しました。')
      return
    }
    setLengthPresetGroups((prev) => prev.filter((g) => g.id !== groupId))
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
      color: firstFreeSegmentColor(null),
    })
    setDetailEditMode('shape')
    setModalTab('detail')
  }

  function openEdit(unit: Unit) {
    setEditingUnit(unit)
    const d = draftFromUnit(unit)
    setDraft(d)
    setOpenShapeEditorOnModal(false)
    setModalTab('basic')
    setModalOpen(true)
  }

  function openEditShape(unit: Unit) {
    setEditingUnit(unit)
    const d = draftFromUnit(unit)
    setDraft(d)
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

  function updateShapeType(nextShape: ExtendedShapeType) {
    setDraft((p) => {
      const nextTemplate = shapeTypeToDetailTemplate(nextShape)
      // テンプレート切り替え時に、前テンプレートで強制的に 0 にされた寸法が残ると
      // corner が潰れて straight と同じ表示になってしまうため、まずテンプレートのデフォルトで再シードする
      const prev = p.detail_spec ?? getDefaultDetailSpec(nextTemplate)
      const defaults = getDefaultDetailSpec(nextTemplate)
      const base: UnitDetailSpec = {
        ...defaults,
        // 共通で使える寸法は維持（ただし、前テンプレートで 0 にされた値は基本的に restore しない）
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

  // ─── 丸番 / コード自動算出（色ベース） ─────────────────────────
  const autoVariant = useMemo(() => {
    const color = normalizeSegmentColor(draft.color)
    if (
      editingUnit &&
      normalizeSegmentColor(editingUnit.color) === color &&
      editingUnit.mark_number != null
    ) {
      return {
        mark: editingUnit.mark_number,
        code: generateUnitCode(color, editingUnit.mark_number),
      }
    }
    const sameColorMarks = units
      .filter((u) => u.id !== editingUnit?.id && normalizeSegmentColor(u.color) === color)
      .map((u) => u.mark_number ?? 0)
    const mark = Math.max(0, ...sameColorMarks) + 1
    return {
      mark,
      code: generateUnitCode(color, mark),
    }
  }, [draft.color, units, editingUnit?.id, editingUnit?.mark_number])

  function effectiveMark(autoMark: number, manualValue: string | undefined): number {
    const n = parseInt(String(manualValue ?? ''), 10)
    return Number.isFinite(n) && n > 0 ? n : autoMark
  }

  // ─── 保存 ──────────────────────────────────────────────
  async function handleSave() {
    try {
      if (!draft.name.trim()) {
        setModalTab('basic')
        setSaveValidationMessage('ユニット名を入力してください。')
        return
      }
      const selfKey = editingUnit ? unitVariantGroupKey(editingUnit) : null
      if (isSegmentColorTakenByOtherUnit(normalizeSegmentColor(draft.color), selfKey)) {
        alert('この色は既に別のユニットで使用されています。別の色を選んでください。')
        return
      }
      const resolvedPitchMm = parseSpacingMm(draft.pitch_mm)
      const resolvedLShapeCountRaw = Number.parseInt(draft.l_shape_count, 10)
      const resolvedLShapeCount =
        Number.isFinite(resolvedLShapeCountRaw) && resolvedLShapeCountRaw >= 0
          ? Math.floor(resolvedLShapeCountRaw)
          : null
      if (resolvedPitchMm == null || resolvedPitchMm <= 0) {
        setModalTab('detail')
        setDetailEditMode('pitch')
        setSaveValidationMessage('ピッチを入力してください。')
        return
      }

      setSaving(true)
      const detailTemplate = shapeTypeToDetailTemplate(draft.shape_type)
      const detailSpec = {
        ...normalizeDetailSpecForTemplate(
          detailTemplate,
          draft.detail_spec ?? getDefaultDetailSpec(detailTemplate),
        ),
        pitch: resolvedPitchMm,
      }
      const detailGeometry =
        draft.detail_start_mode === 'free' && draft.detail_geometry
          ? draft.detail_geometry
          : buildShapeSketch(detailTemplate, detailSpec).geometry
      const resolvedShapeType: ExtendedShapeType =
        draft.detail_start_mode === 'free'
          ? inferShapeTypeFromGeometry(detailGeometry)
          : draft.shape_type

      const color = normalizeSegmentColor(draft.color)
      const mark = effectiveMark(autoVariant.mark, draft.mark_number)

      const payload = {
        name: draft.name.trim(),
        location_type: draft.location_type,
        shape_type: resolvedShapeType,
        color,
        bars: aggregateBarsFromRebarLayout(normalizeRebarLayout(draft.rebar_layout)).filter((b) => b.qtyPerUnit > 0),
        spacing_mm: null,
        pitch_mm: resolvedPitchMm,
        l_shape_count: resolvedLShapeCount,
        description: draft.description.trim() || null,
        is_active: true,
        template_id: null,
        detail_spec: detailSpec,
        detail_geometry: detailGeometry,
        rebar_layout: normalizeRebarLayout(draft.rebar_layout),
        code: generateUnitCode(color, mark),
        mark_number: mark,
        length_mm: null,
      }

      const isLocalOrMockEdit =
        !!editingUnit &&
        (editingUnit.id.startsWith('mock-') || editingUnit.id.startsWith('local-'))

      if (isLocalOrMockEdit) {
        setUnits((prev) =>
          prev.map((u) =>
            u.id === editingUnit!.id
              ? ({
                  ...u,
                  ...payload,
                  updated_at: new Date().toISOString(),
                } as Unit)
              : u,
          ),
        )
      } else if (editingUnit) {
        let { data, error } = await supabase
          .from('units')
          .update(payload)
          .eq('id', editingUnit.id)
          .select()
          .single()
        if (error && /(detail_(spec|geometry)|rebar_layout|pitch_mm|l_shape_count)/i.test(error.message)) {
          alert(
            '保存に失敗しました: ユニット詳細用カラムが不足しています。\n\n' +
              'Supabase マイグレーションを適用してください:\n' +
              '- 20260318_add_unit_detail_shape.sql\n' +
              '- 20260318_add_unit_rebar_layout.sql\n' +
              '- 20260421_add_unit_pitch_mm.sql\n' +
              '- 20260422_add_unit_l_shape_count.sql',
          )
          return
        }
        if (error) {
          alert('保存に失敗しました: ' + error.message)
          return
        }
        if (data) setUnits((prev) => prev.map((u) => (u.id === editingUnit.id ? (data as Unit) : u)))
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          alert('ログインが必要です。')
          return
        }
        let { data, error } = await supabase
          .from('units')
          .insert({ ...payload, user_id: user.id })
          .select()
          .single()
        if (error && /(detail_(spec|geometry)|rebar_layout|pitch_mm|l_shape_count)/i.test(error.message)) {
          alert(
            '保存に失敗しました: ユニット詳細用カラムが不足しています。\n\n' +
              'Supabase マイグレーションを適用してください:\n' +
              '- 20260318_add_unit_detail_shape.sql\n' +
              '- 20260318_add_unit_rebar_layout.sql\n' +
              '- 20260421_add_unit_pitch_mm.sql\n' +
              '- 20260422_add_unit_l_shape_count.sql',
          )
          return
        }
        if (error) {
          alert('保存に失敗しました: ' + error.message)
          return
        }
        if (data) setUnits((prev) => [...prev, data as Unit])
      }

      closeModal()
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('handleSave unexpected', error)
      alert('保存に失敗しました: ' + message)
    } finally {
      setSaving(false)
    }
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
  const detailPitchMm = useMemo(() => {
    const fromDraft = parseSpacingMm(draft.pitch_mm)
    if (fromDraft != null) return fromDraft
    return null
  }, [draft.pitch_mm])

  // ─── レンダリング ────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">ユニット管理</h1>
          <p className="text-sm text-muted mt-0.5">
            断面（形状・色・鉄筋構成の組み合わせ）を登録・管理します。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLengthPresetListModalOpen(true)}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-slate-50 transition-colors"
          >
            長さプリセット
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
          >
            + 新規作成
          </button>
        </div>
      </div>

      {/* フィルタバー */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-white px-4 py-3">
        <input
          type="text"
          placeholder="名前で検索"
          value={filter.searchText}
          onChange={(e) => setFilter((p) => ({ ...p, searchText: e.target.value }))}
          className="w-44 rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
        />
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
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted whitespace-nowrap">
                  色
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted hidden lg:table-cell">鉄筋構成</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted hidden lg:table-cell">総寸法</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted hidden lg:table-cell">ピッチ</th>
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
      {saveValidationMessage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-sm rounded-xl border border-amber-200 bg-white shadow-xl">
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-4">
              <h3 className="text-sm font-semibold text-amber-950">入力が必要です</h3>
              <p className="mt-1 text-xs text-amber-800">
                保存する前に必須項目を確認してください。
              </p>
            </div>
            <div className="px-5 py-4">
              <p className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2 text-sm font-medium text-amber-950">
                {saveValidationMessage}
              </p>
            </div>
            <div className="flex justify-end border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => setSaveValidationMessage(null)}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div
            className={`w-full rounded-xl bg-white shadow-xl flex flex-col max-h-[92vh] ${
              showDetailTab ? 'max-w-[1500px]' : 'max-w-xl'
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
                  onClick={() => {
                    if (!editingUnit) setDetailEditMode('shape')
                    setModalTab('detail')
                  }}
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

              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted">表示色</label>
                <p className="mb-1 text-[9px] leading-snug text-muted/80">
                  他のユニットで使用中の色は選べません。
                </p>
                <div className="grid grid-cols-5 gap-1 sm:grid-cols-6">
                  {SEGMENT_COLOR_DEFINITIONS.map((d) => {
                    const active = draft.color === d.id
                    const taken = isSegmentColorTakenByOtherUnit(d.id, editingVariantGroupKey)
                    return (
                      <button
                        key={d.id}
                        type="button"
                        disabled={taken}
                        title={taken ? 'この色は既に別ユニットで使用中です' : undefined}
                        onClick={() => {
                          if (taken) return
                          setDraft((p) => ({ ...p, color: d.id }))
                        }}
                        className={`relative rounded-md border px-0.5 py-1.5 text-center text-[10px] font-medium leading-tight ${
                          active ? 'font-semibold shadow-sm' : ''
                        } ${taken ? 'cursor-not-allowed opacity-40' : ''}`}
                        style={{
                          borderColor: getSegmentStrokeHex(d.id, false),
                          backgroundColor: active ? d.tint : '#fff',
                          color: getSegmentStrokeHex(d.id, true),
                        }}
                      >
                        {active ? (
                          <span
                            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-slate-800 text-[9px] font-bold leading-none text-white shadow-sm"
                            aria-hidden
                          >
                            ✓
                          </span>
                        ) : null}
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

              <div className="rounded-lg border border-border bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-foreground">形状プリセット</div>
                  </div>
                </div>
                {userPresets.length === 0 ? (
                  <p className="text-[11px] text-muted">保存されたプリセットがありません。（作成して追加するとここに表示されます）</p>
                ) : (
                  <div className="grid gap-2">
                    {userPresets.map((preset) => (
                      <div
                        key={preset.id}
                        draggable
                        onDragStart={(e) => {
                          setDraggingPresetId(preset.id)
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', preset.id)
                        }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          const activeId = e.dataTransfer.getData('text/plain') || draggingPresetId
                          if (activeId) reorderUserPreset(activeId, preset.id)
                          setDraggingPresetId(null)
                        }}
                        onDragEnd={() => setDraggingPresetId(null)}
                        className={`group flex cursor-grab items-center justify-between gap-3 rounded-lg border bg-white p-2.5 shadow-sm transition active:cursor-grabbing ${
                          draggingPresetId === preset.id
                            ? 'border-primary bg-primary/5 opacity-60'
                            : 'border-border hover:border-slate-300 hover:shadow-md'
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span
                            className="flex h-8 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[13px] font-bold leading-none text-slate-400 group-hover:text-slate-600"
                            title="ドラッグして並び替え"
                          >
                            ⋮⋮
                          </span>
                          <PresetShapeThumbnail payload={preset.payload} />
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => applyUserPreset(preset)}
                            className="rounded-md border border-border bg-white px-2.5 py-1.5 text-[11px] font-medium hover:bg-slate-100"
                          >
                            読み込み
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteUserPreset(preset.id)}
                            className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-50"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

                </>
              )}

              {showDetailTab && (
                <div ref={detailShapeSectionRef} className="space-y-1 pb-1">
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-medium leading-snug text-foreground/90">
                      まず下のキャンバスで形状を作成し、その後に鉄筋、寸法・間隔を追加します。
                    </p>
                  </div>

                  <DetailShapeEditor
                    shapeType={draft.shape_type}
                    expanded
                    mode={detailEditMode}
                    onModeChange={setDetailEditMode}
                    pitchValue={draft.pitch_mm}
                    onPitchChange={(nextPitch) => setDraft((p) => ({ ...p, pitch_mm: nextPitch }))}
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
                        <div className="mb-4 border-b border-border pb-3">
                          <label className="inline-flex flex-col gap-1.5 text-xs font-semibold text-foreground">
                            <span>L字本数</span>
                            <input
                              type="number"
                              min={0}
                              value={draft.l_shape_count ?? ''}
                              onChange={(e) => {
                                const raw = e.target.value
                                if (raw === '') {
                                  setDraft((p) => ({ ...p, l_shape_count: '' }))
                                  return
                                }
                                const next = Math.max(0, Math.floor(Number.parseInt(raw, 10) || 0))
                                setDraft((p) => ({ ...p, l_shape_count: String(next) }))
                              }}
                              placeholder="例: 1"
                              className="h-9 w-20 rounded-md border border-slate-200 bg-slate-50/60 px-2.5 text-[13px] font-medium text-slate-800 outline-none transition-colors placeholder:text-[12px] placeholder:font-normal placeholder:text-slate-300 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10"
                            />
                          </label>
                        </div>
                        <div className="text-xs font-semibold text-foreground">鉄筋構成（自動集計）</div>
                        <p className="mt-1 text-[10px] leading-snug text-muted">
                          キャンバス上に配置した鉄筋から自動で集計しています。
                        </p>
                        <div className="mt-2 font-mono text-sm text-muted">
                          {detailBarsForSummary.length > 0 ? barsSummary(detailBarsForSummary) : '—'}
                        </div>
                        <div className="mt-4 border-t border-border pt-3">
                          <div className="text-xs font-semibold text-foreground">寸法・間隔（要約）</div>
                          <p className="mt-1 text-[10px] leading-snug text-muted">
                            キャンバス内にある間隔値を表示します。
                          </p>
                          {detailSpacingLabels.length > 0 && (
                            <div className="mt-2 text-sm text-muted">{detailSpacingLabels.join(', ')}</div>
                          )}
                          {detailAnnotationTexts.length > 0 && (
                            <div className="mt-2 text-[11px] text-muted">
                              寸法: {detailAnnotationTexts.join(', ')}
                            </div>
                          )}
                        </div>
                        <div className="mt-4 border-t border-border pt-3">
                          <div className="text-xs font-semibold text-foreground">ピッチ</div>
                          <div className="mt-1 text-sm text-muted">
                            {detailPitchMm != null ? `@${detailPitchMm}` : '-'}
                          </div>
                        </div>
                      </div>
                    }
                  />

                  {detailEditMode === 'shape' && (
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-dashed border-border pt-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveAsPreset()}
                        disabled={savingPreset}
                        className="text-[11px] text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900"
                      >
                        {savingPreset ? '保存中...' : '形状プリセットとして保存'}
                      </button>
                    </div>
                  )}
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

      {lengthPresetModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLengthPresetModal()
          }}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="length-preset-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-5 py-4">
              <h2 id="length-preset-modal-title" className="text-sm font-semibold text-foreground">
                {lengthPresetModalMode === 'create' ? '長さプリセットを追加' : '長さプリセットを編集'}
              </h2>
              <p className="mt-1 text-xs text-muted">プリセット名を入力し、番号と長さ（mm）を行ごとに追加してください。</p>
            </div>
            <div className="max-h-[min(70vh,32rem)] space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">プリセット名</label>
                <input
                  type="text"
                  value={lengthPresetFormName}
                  onChange={(e) => setLengthPresetFormName(e.target.value)}
                  placeholder="例: 新間"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">説明（任意）</label>
                <textarea
                  value={lengthPresetFormDescription}
                  onChange={(e) => setLengthPresetFormDescription(e.target.value)}
                  rows={2}
                  placeholder="任意"
                  className="w-full resize-none rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted">長さ一覧</span>
                  <button
                    type="button"
                    onClick={addLengthPresetFormRow}
                    className="rounded-md border border-border bg-slate-50 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-slate-100"
                  >
                    + 行を追加
                  </button>
                </div>
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border bg-slate-50 text-[11px] text-muted">
                      <tr>
                        <th className="w-24 px-2 py-2 font-medium">番号</th>
                        <th className="px-2 py-2 font-medium">長さ（mm）</th>
                        <th className="w-14 px-2 py-2 font-medium text-right"> </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-white">
                      {lengthPresetFormRows.map((row) => (
                        <tr key={row.id}>
                          <td className="p-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={row.no}
                              onChange={(e) => updateLengthPresetFormRow(row.id, { no: e.target.value })}
                              className="w-full rounded border border-border px-2 py-1 text-xs font-mono outline-none focus:border-primary"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={row.lengthMm}
                              onChange={(e) => updateLengthPresetFormRow(row.id, { lengthMm: e.target.value })}
                              placeholder="3640"
                              className="w-full rounded border border-border px-2 py-1 text-xs font-mono outline-none focus:border-primary"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeLengthPresetFormRow(row.id)}
                              disabled={lengthPresetFormRows.length <= 1}
                              className="rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              削除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={closeLengthPresetModal}
                disabled={lengthPresetSaving}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void submitLengthPresetModal()}
                disabled={lengthPresetSaving}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {lengthPresetSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lengthPresetListModalOpen && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLengthPresetListModalOpen(false)
          }}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="length-preset-list-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
              <div>
                <h2 id="length-preset-list-modal-title" className="text-lg font-semibold text-foreground">
                  長さプリセット
                </h2>
                <p className="mt-1 text-xs text-muted">登録済みの長さグループを管理します。</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openLengthPresetCreateModal}
                  className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-hover"
                >
                  追加
                </button>
                <button
                  type="button"
                  onClick={() => setLengthPresetListModalOpen(false)}
                  className="rounded-lg border border-border px-3.5 py-2 text-sm text-muted hover:bg-gray-50"
                >
                  閉じる
                </button>
              </div>
            </div>
            <div className="max-h-[min(72vh,42rem)] space-y-3 overflow-y-auto px-6 py-5">
              {lengthPresetGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-slate-700">保存された長さプリセットがありません。</p>
                  <p className="mt-1 text-xs text-muted">「追加」ボタンから最初のプリセットを作成してください。</p>
                </div>
              ) : (
                lengthPresetGroups.map((group) => (
                  <div
                    key={group.id}
                    className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xl font-semibold tracking-tight text-foreground">
                          {group.name}
                        </div>
                        <div className="mt-0.5 truncate text-sm text-muted">
                          {group.description || '説明なし'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openLengthPresetEditModal(group)}
                          className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
                        >
                          更新
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteLengthPresetGroup(group.id)}
                          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(group.lengths ?? []).map((len) => (
                        <span
                          key={`${group.id}-${len}`}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold tabular-nums text-slate-700"
                        >
                          {len}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {presetSavedToast && (
        <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4 pointer-events-none">
          <div
            role="status"
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-lg shadow-slate-900/10"
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
              aria-hidden
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M16.704 4.153a.75.75 0 01.143 1.052l-7.5 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 6.96-9.744a.75.75 0 011.05-.143z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900">プリセットを保存しました</p>
            <button
              type="button"
              onClick={() => setPresetSavedToast(false)}
              className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="閉じる"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {previewUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-xl">
            <div className="px-6 pt-5 pb-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">{previewUnit.name}</h3>
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
  stroke: string
  text: string
  radiusScale: number
  symbol: 'open-circle' | 'filled-dot' | 'cross-circle' | 'bullseye' | 'plain-circle'
} {
  const d = (diameter ?? '').toUpperCase()
  if (d === 'D10') return { stroke: '#111827', text: '#111827', radiusScale: 1, symbol: 'filled-dot' }
  if (d === 'D13') return { stroke: '#111827', text: '#111827', radiusScale: 1, symbol: 'open-circle' }
  if (d === 'D16') return { stroke: '#111827', text: '#111827', radiusScale: 1.08, symbol: 'cross-circle' }
  if (d === 'D19') return { stroke: '#111827', text: '#111827', radiusScale: 1.16, symbol: 'bullseye' }
  return { stroke: '#475569', text: '#334155', radiusScale: 1, symbol: 'plain-circle' }
}

/** D10/D13/D16/D19 は記号だけで区別。それ以外はキャンバス上にテキストラベルも付ける */
function rebarDiameterUsesCanvasSymbolOnly(diameter: string | null | undefined): boolean {
  const d = (diameter ?? '').toUpperCase().trim()
  return d === 'D10' || d === 'D13' || d === 'D16' || d === 'D19'
}

function RebarSymbol({
  x,
  y,
  token,
  radius,
  strokeWidth,
  strokeOverride,
}: {
  x: number
  y: number
  token: ReturnType<typeof rebarDiameterVisualToken>
  radius: number
  strokeWidth: number
  strokeOverride?: string
}) {
  const stroke = strokeOverride ?? token.stroke
  if (token.symbol === 'filled-dot') {
    return <circle cx={x} cy={y} r={radius} fill={stroke} stroke="none" />
  }

  if (token.symbol === 'cross-circle') {
    const inner = Math.max(2, radius * 0.62)
    return (
      <>
        <circle cx={x} cy={y} r={radius} fill="#ffffff" stroke={stroke} strokeWidth={strokeWidth} />
        <line x1={x - inner} y1={y - inner} x2={x + inner} y2={y + inner} stroke={stroke} strokeWidth={Math.max(1.1, strokeWidth * 0.85)} />
        <line x1={x - inner} y1={y + inner} x2={x + inner} y2={y - inner} stroke={stroke} strokeWidth={Math.max(1.1, strokeWidth * 0.85)} />
      </>
    )
  }

  if (token.symbol === 'bullseye') {
    return (
      <>
        <circle cx={x} cy={y} r={radius} fill="#ffffff" stroke={stroke} strokeWidth={strokeWidth} />
        <circle cx={x} cy={y} r={Math.max(2.2, radius * 0.34)} fill="none" stroke={stroke} strokeWidth={Math.max(1, strokeWidth * 0.8)} />
      </>
    )
  }

  return <circle cx={x} cy={y} r={radius} fill="#ffffff" stroke={stroke} strokeWidth={strokeWidth} />
}

function getUnitShapeLineStyle(unit: Pick<Unit, 'bars'>): {
  strokeWidth: number
  innerStrokeWidth: number
  offset: number
  isDouble: boolean
} {
  const hasD13OrAbove = (unit.bars ?? []).some((bar) => {
    const match = String(bar.diameter ?? '').toUpperCase().match(/^D(\d+)$/)
    const mm = Number.parseInt(match?.[1] ?? '', 10)
    return Number.isFinite(mm) && mm >= 13
  })
  return hasD13OrAbove
    ? { strokeWidth: 2.8, innerStrokeWidth: 1.2, offset: 4.0, isDouble: true }
    : { strokeWidth: 1.9, innerStrokeWidth: 0, offset: 0, isDouble: false }
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
  pitchValue,
  onPitchChange,
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
  pitchValue: string
  onPitchChange: (next: string) => void
  expanded?: boolean
  mode: 'shape' | 'rebar' | 'annotation' | 'pitch'
  onModeChange: (next: 'shape' | 'rebar' | 'annotation' | 'pitch') => void
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
  const [annotationInput, setAnnotationInput] = useState<{
    x: number
    y: number
    value: string
    error: string | null
  } | null>(null)
  /** 形状編集キャンバス初期ズーム（UI表示は clampedZoom×100%、既定 100%） */
  const [zoomScale, setZoomScale] = useState(1)
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
  const [dragSpacingId, setDragSpacingId] = useState<string | null>(null)
  const [dragSpacingLabelId, setDragSpacingLabelId] = useState<string | null>(null)
  const [dragAnnotationId, setDragAnnotationId] = useState<string | null>(null)
  const [dragRebarId, setDragRebarId] = useState<string | null>(null)
  const rebarDragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const [doubleLineEnabled, setDoubleLineEnabled] = useState(false)
  const [dragSegmentKey, setDragSegmentKey] = useState<string | null>(null)
  const [freezeViewBounds, setFreezeViewBounds] = useState(false)
  const frozenViewBoundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null)
  const segmentDragRef = useRef<{
    start: { x: number; y: number }
    baseGeometry: UnitDetailGeometry
    segIdx: number
    fromKey: string
    toKey: string
  } | null>(null)
  const pointDragRef = useRef<{
    key: string
    start: { x: number; y: number }
    basePoint: { x: number; y: number }
  } | null>(null)
  const spacingDragRef = useRef<{ id: string; lastX: number; lastY: number } | null>(null)
  const suppressCanvasGestureRef = useRef(false)
  /** ホイールボタン（中クリック）ドラッグで viewBox をパン */
  const canvasMiddlePanRef = useRef(false)
  const canvasMiddlePanLastRef = useRef({ x: 0, y: 0 })
  const [canvasMiddlePanning, setCanvasMiddlePanning] = useState(false)

  function clearCanvasSelections() {
    setSelection(null)
    setDraggingKey(null)
    setDragPointKey(null)
    setDrawAnchorKey(null)
    setDrawGesture(null)
    setSpacingDrawGesture(null)
    setDragSpacingId(null)
    setDragSpacingLabelId(null)
    setDragAnnotationId(null)
    setDragRebarId(null)
    rebarDragRef.current = null
    spacingDragRef.current = null
    setDragSegmentKey(null)
    segmentDragRef.current = null
    pointDragRef.current = null
    setFreezeViewBounds(false)
    frozenViewBoundsRef.current = null
  }

  function resetNonShapeDrags() {
    // Ensure stale drag states (rebar/spacing/annotation) never steal pointermove while editing shape.
    setDragSpacingId(null)
    setDragSpacingLabelId(null)
    setDragAnnotationId(null)
    setDragRebarId(null)
    rebarDragRef.current = null
    spacingDragRef.current = null
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
      setDragSpacingId(null)
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
  const hasPitchValue = Number.isFinite(spec.pitch) && spec.pitch > 0

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
  // （寸法編集の可否は別途 template に依存）
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

  function mergeBounds(
    a: { minX: number; minY: number; maxX: number; maxY: number },
    b: { minX: number; minY: number; maxX: number; maxY: number },
  ) {
    return {
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY),
    }
  }

  const freeCanvasDefaultBounds = useMemo(() => createEmptyFreeGeometry().bounds, [])

  const freeCanvasFloorBounds = useMemo(() => {
    if (startMode !== 'free') return sketch.geometry.bounds
    // free draw에서는 "현재 geometry.bounds"를 바닥값으로 쓰지 않는다.
    // geometry.bounds는 첫 선 직후 아주 타이트하게 바뀔 수 있어서
    // viewBox가 갑자기 중앙 재정렬된 것처럼 보일 수 있다.
    if (displayGeometry.points.length === 0) return freeCanvasDefaultBounds
    const contentBounds = calcBounds(displayGeometry.points)
    return mergeBounds(freeCanvasDefaultBounds, contentBounds)
  }, [startMode, displayGeometry.points, sketch.geometry.bounds, freeCanvasDefaultBounds])
  const viewBounds = useMemo(() => {
    if (startMode !== 'free') return sketch.geometry.bounds
    return freeCanvasFloorBounds
  }, [startMode, sketch.geometry.bounds, freeCanvasFloorBounds])
  const effectiveViewBounds =
    freezeViewBounds && frozenViewBoundsRef.current ? frozenViewBoundsRef.current : viewBounds
  const { minX, minY, maxX, maxY } = effectiveViewBounds
  const baseVbW = Math.max(160, maxX - minX + vbPad * 2)
  const baseVbH = Math.max(120, maxY - minY + vbPad * 2)
  const baseVbX = minX - vbPad
  const baseVbY = minY - vbPad
  const clampedZoom = Math.max(0.5, Math.min(zoomScale, 4))
  const viewW = baseVbW / clampedZoom
  const viewH = baseVbH / clampedZoom
  // Keep rebar markers readable across very large/small coordinate ranges.
  const viewRef = Math.min(viewW, viewH)
  const rebarBodyR0 = Math.max(7, Math.min(16, viewRef * 0.018))
  const rebarBodyR = rebarBodyR0 * 1.5
  const rebarSelectR = rebarBodyR + 4
  const rebarHitR = rebarBodyR + 4
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
    setAnnotationInput({ x, y, value: String(spacingMmDraft || ''), error: null })
  }

  function submitAnnotationInput() {
    if (!annotationInput) return
    const raw = annotationInput.value.trim()
    if (raw === '') {
      setAnnotationInput((prev) => (prev ? { ...prev, error: '寸法値を入力してください。' } : prev))
      return
    }
    const mm = Number.parseInt(raw, 10)
    if (!Number.isFinite(mm) || mm <= 0) {
      setAnnotationInput((prev) => (prev ? { ...prev, error: '正の数値（mm）を入力してください。' } : prev))
      return
    }
    setSpacingMmDraft(mm)
    const id = nextId('an')
    const text = `${mm}`
    onRebarLayoutChange(
      normalizeRebarLayout({
        ...rebarLayout,
        annotations: [...rebarLayout.annotations, { id, x: annotationInput.x, y: annotationInput.y, text }],
      }),
    )
    selectAnnotation(id)
    setAnnotationInput(null)
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

  function moveSpacingLine(spacingId: string, p: { x: number; y: number }) {
    const drag = spacingDragRef.current
    if (!drag || drag.id !== spacingId) return
    const dx = p.x - drag.lastX
    const dy = p.y - drag.lastY
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return

    const nextSpacings = rebarLayout.spacings.map((sp) =>
      sp.id === spacingId
        ? {
            ...sp,
            x1: (sp.x1 ?? 0) + dx,
            y1: (sp.y1 ?? 0) + dy,
            x2: (sp.x2 ?? 0) + dx,
            y2: (sp.y2 ?? 0) + dy,
            label_x: typeof sp.label_x === 'number' ? sp.label_x + dx : sp.label_x,
            label_y: typeof sp.label_y === 'number' ? sp.label_y + dy : sp.label_y,
          }
        : sp,
    )

    spacingDragRef.current = { ...drag, lastX: p.x, lastY: p.y }
    onRebarLayoutChange(normalizeRebarLayout({ ...rebarLayout, spacings: nextSpacings }))
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

  function moveRebar(rebarId: string, p: { x: number; y: number }) {
    const drag = rebarDragRef.current
    if (!drag || drag.id !== rebarId) return
    const nextRebars = rebarLayout.rebars.map((rb) =>
      rb.id === rebarId ? { ...rb, x: p.x + drag.offsetX, y: p.y + drag.offsetY } : rb,
    )
    onRebarLayoutChange(normalizeRebarLayout({ ...rebarLayout, rebars: nextRebars }))
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

    // 空のキャンバス（またはアンカーなし状態）でドラッグすると独立した線分（点2つ）を生成
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
          ? [{ from: key0, to: key1, doubleLine: doubleLineEnabled }]
          : [...displayGeometry.segments, { from: key0, to: key1, doubleLine: doubleLineEnabled }]

      const createdSegmentKey = `${key0}-${key1}-${nextSegments.length - 1}`

      onGeometryChange({
        ...displayGeometry,
        points: nextPoints,
        segments: nextSegments,
        bounds: calcBounds(nextPoints),
      })

      // 要点: 新しい点の自動選択は禁止し、新しい線のみ選択
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
    const nextSegments = [...displayGeometry.segments, { from: anchor.key, to: key, doubleLine: doubleLineEnabled }]
    const createdSegmentKey = `${anchor.key}-${key}-${nextSegments.length - 1}`

    onGeometryChange({
      ...displayGeometry,
      templateType: displayGeometry.templateType,
      points: nextPoints,
      segments: nextSegments,
      bounds: calcBounds(nextPoints),
    })

    // 要点: ここでも新しい点の自動選択は禁止し、新しい線のみ選択
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

  const freePointHitR = 2
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
              title="寸法・間隔"
              className={`px-2.5 py-1 text-[10px] font-medium transition-[color,box-shadow,background] ${
                mode === 'annotation'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'bg-transparent text-muted/75 hover:bg-white/50 hover:text-foreground'
              }`}
            >
              寸法・間隔
            </button>
            <button
              type="button"
              onClick={() => onModeChange('pitch')}
              title="ピッチ"
              className={`border-l border-slate-300/30 px-2.5 py-1 text-[10px] font-medium transition-[color,box-shadow,background] ${
                mode === 'pitch'
                  ? 'bg-white text-foreground shadow-sm'
                  : 'bg-transparent text-muted/75 hover:bg-white/50 hover:text-foreground'
              }`}
            >
              ピッチ
            </button>
          </div>
        </div>
        {mode === 'annotation' && (
          <>
            <p className="rounded border border-dashed border-border/45 bg-slate-50/70 px-2 py-1 text-[10px] font-medium leading-snug text-foreground/80">
              ドラッグ: 間隔線を作成 / クリック: 寸法を追加 / 数値ラベル: ドラッグで移動
            </p>
          </>
        )}
        {mode === 'pitch' && (
          <p className="rounded border border-dashed border-border/45 bg-slate-50/70 px-2 py-1 text-[10px] font-medium leading-snug text-foreground/80">
            ピッチは「@200」のように指定します。ピッチが違うと別単面扱いになり、結果・色分けも別になります。
          </p>
        )}
        {mode === 'shape' && startMode === 'free' && (
            <div className="space-y-1.5 rounded border border-border/60 bg-slate-50/50 px-2 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted/90">
                  <span className="font-medium text-foreground/80">基本操作</span>
                  <span>線作成: ドラッグして描画</span>
                  <span>線選択: 線をクリック</span>
                  <span className="text-muted/70">保存: 右下の保存ボタン</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDoubleLineEnabled((v) => !v)}
                  className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
                    doubleLineEnabled
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-white text-muted hover:bg-slate-100'
                  }`}
                  title="ONの状態で作成した線は二重線として保存されます"
                >
                  二重線 {doubleLineEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          )}
        <div className="relative">
        <svg
        viewBox={`${vbX} ${vbY} ${viewW} ${viewH}`}
        className={`w-full rounded-md border border-border bg-slate-50 ${
          expanded ? 'min-h-[min(52vh,36rem)] h-[min(52vh,36rem)]' : 'h-52'
        } ${canvasMiddlePanning ? 'cursor-grabbing' : ''}`}
        onPointerDownCapture={(e) => {
          if (e.button === 1) {
            e.preventDefault()
            e.stopPropagation()
            suppressCanvasGestureRef.current = false
            canvasMiddlePanRef.current = true
            canvasMiddlePanLastRef.current = { x: e.clientX, y: e.clientY }
            setCanvasMiddlePanning(true)
            try {
              ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
            return
          }
          const target = e.target as Element | null
          suppressCanvasGestureRef.current = !!target?.closest('[data-canvas-hit="item"]')
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
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
              // 새 선을 그리는 동안에도 viewBox를 고정해서
              // 첫 드래그에서 화면이 재정렬되어 보이는 문제를 줄인다.
              frozenViewBoundsRef.current = viewBounds
              setFreezeViewBounds(true)
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
          if (canvasMiddlePanRef.current) {
            const svg = e.currentTarget as SVGSVGElement
            const rect = svg.getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0) {
              const lx = canvasMiddlePanLastRef.current.x
              const ly = canvasMiddlePanLastRef.current.y
              const dcx = (-(e.clientX - lx) / rect.width) * viewW
              const dcy = (-(e.clientY - ly) / rect.height) * viewH
              canvasMiddlePanLastRef.current = { x: e.clientX, y: e.clientY }
              setZoomCenter((prev) => {
                const cx = prev?.x ?? baseVbX + baseVbW / 2
                const cy = prev?.y ?? baseVbY + baseVbH / 2
                return { x: cx + dcx, y: cy + dcy }
              })
            }
            return
          }

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

          if (mode === 'annotation' && dragSpacingId) {
            moveSpacingLine(dragSpacingId, p)
            return
          }

          if (mode === 'annotation' && dragAnnotationId) {
            moveAnnotation(dragAnnotationId, p)
            return
          }

          if ((mode === 'rebar' || mode === 'annotation') && dragRebarId) {
            moveRebar(dragRebarId, p)
            return
          }

          if (mode === 'shape' && startMode === 'free' && dragSegmentKey && segmentDragRef.current) {
            const drag = segmentDragRef.current
            const dx = p.x - drag.start.x
            const dy = p.y - drag.start.y
            const nextPoints = drag.baseGeometry.points.map((pt) => {
              if (pt.key !== drag.fromKey && pt.key !== drag.toKey) return pt
              return { ...pt, x: pt.x + dx, y: pt.y + dy }
            })
            onGeometryChange({
              ...drag.baseGeometry,
              points: nextPoints,
              bounds: calcBounds(nextPoints),
            })
            return
          }

          if (mode === 'shape' && startMode === 'free' && dragPointKey && pointDragRef.current?.key === dragPointKey) {
            const drag = pointDragRef.current
            const dx = p.x - drag.start.x
            const dy = p.y - drag.start.y
            const nextPoints = displayGeometry.points.map((pt) =>
              pt.key === dragPointKey ? { ...pt, x: drag.basePoint.x + dx, y: drag.basePoint.y + dy } : pt,
            )
            onGeometryChange({
              ...displayGeometry,
              points: nextPoints,
              bounds: calcBounds(nextPoints),
            })
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
        onPointerUp={(e) => {
          if (canvasMiddlePanRef.current && e.button === 1) {
            canvasMiddlePanRef.current = false
            setCanvasMiddlePanning(false)
            try {
              ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
            suppressCanvasGestureRef.current = false
            return
          }

          if (suppressCanvasGestureRef.current) {
            suppressCanvasGestureRef.current = false
            setDraggingKey(null)
            setDragPointKey(null)
            setDrawGesture(null)
            setSpacingDrawGesture(null)
            setDragSpacingId(null)
            setDragSpacingLabelId(null)
            setDragAnnotationId(null)
            setDragRebarId(null)
            rebarDragRef.current = null
            spacingDragRef.current = null
            setDragSegmentKey(null)
            segmentDragRef.current = null
            pointDragRef.current = null
            setFreezeViewBounds(false)
            frozenViewBoundsRef.current = null
            return
          }

          setDraggingKey(null)
          setDragPointKey(null)
          setDragSpacingId(null)
          setDragSpacingLabelId(null)
          setDragAnnotationId(null)
          setDragRebarId(null)
          rebarDragRef.current = null
          spacingDragRef.current = null
          setDragSegmentKey(null)
          segmentDragRef.current = null
          pointDragRef.current = null
          setFreezeViewBounds(false)
          frozenViewBoundsRef.current = null

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
        onPointerCancel={(e) => {
          if (canvasMiddlePanRef.current) {
            canvasMiddlePanRef.current = false
            setCanvasMiddlePanning(false)
            try {
              ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
          }
          setFreezeViewBounds(false)
          frozenViewBoundsRef.current = null
        }}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault()
        }}
        onPointerLeave={() => {
          if (canvasMiddlePanRef.current) return
          suppressCanvasGestureRef.current = false
          setDraggingKey(null)
          setDragPointKey(null)
          setDragSpacingId(null)
          setDragSpacingLabelId(null)
          setDragAnnotationId(null)
          setDragRebarId(null)
          rebarDragRef.current = null
          spacingDragRef.current = null
          setDragSegmentKey(null)
          segmentDragRef.current = null
          pointDragRef.current = null
          setFreezeViewBounds(false)
          frozenViewBoundsRef.current = null
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
          const stroke = isSegSelected ? '#7c3aed' : '#0f172a'
          const baseStrokeW = isSegSelected ? 3.0 : 1.6
          const dx = p2.x - p1.x
          const dy = p2.y - p1.y
          const len = Math.hypot(dx, dy) || 1
          const nx = -dy / len
          const ny = dx / len
          const offset = Math.max(2.2, baseStrokeW * 0.95)
          const doubleStrokeW = Math.max(1.2, baseStrokeW * 0.62)
          return (
            <g key={`seg-${idx}`}>
              {seg.doubleLine === true ? (
                <>
                  <line
                    x1={p1.x + nx * offset}
                    y1={p1.y + ny * offset}
                    x2={p2.x + nx * offset}
                    y2={p2.y + ny * offset}
                    stroke={stroke}
                    strokeWidth={doubleStrokeW}
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                  <line
                    x1={p1.x - nx * offset}
                    y1={p1.y - ny * offset}
                    x2={p2.x - nx * offset}
                    y2={p2.y - ny * offset}
                    stroke={stroke}
                    strokeWidth={doubleStrokeW}
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                </>
              ) : (
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={stroke}
                  strokeWidth={baseStrokeW}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              )}
              <line
                data-canvas-hit="item"
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="rgba(0,0,0,0.001)"
                strokeWidth={segmentHitWidth}
                strokeLinecap="butt"
                style={{
                  pointerEvents: segPe,
                  cursor:
                    segPe === 'auto'
                      ? dragSegmentKey && isSegSelected
                        ? 'grabbing'
                        : 'grab'
                      : 'default',
                }}
                onPointerDownCapture={() => {
                  markObjectPointer()
                }}
                onPointerDown={(e) => {
                  if (mode !== 'shape' || startMode !== 'free') return
                  beginObjectPointer(e)
                  const pickedKey = `${seg.from}-${seg.to}-${idx}`
                  selectSegment(pickedKey)
                  pushHistorySnapshot()
                  // Moving free-draw points updates bounds; freeze viewBox during drag for a stable feel (like rebar/spacings).
                  frozenViewBoundsRef.current = viewBounds
                  setFreezeViewBounds(true)

                  // Detach the segment if its endpoints are shared, so dragging moves only this segment.
                  const baseSeg = displayGeometry.segments[idx]
                  if (!baseSeg) return
                  const countKey = (key: string) =>
                    displayGeometry.segments.reduce(
                      (sum, s, sIdx) => (sIdx !== idx && (s.from === key || s.to === key) ? sum + 1 : sum),
                      0,
                    )
                  const makePointKey = () => `p${Math.random().toString(36).slice(2, 8)}`
                  const clonePointIfShared = (
                    geometry: UnitDetailGeometry,
                    pointKey: string,
                  ): { geometry: UnitDetailGeometry; nextKey: string } => {
                    if (countKey(pointKey) <= 0) return { geometry, nextKey: pointKey }
                    const src = geometry.points.find((pt) => pt.key === pointKey)
                    if (!src) return { geometry, nextKey: pointKey }
                    const nextKey = makePointKey()
                    return {
                      geometry: {
                        ...geometry,
                        points: [...geometry.points, { ...src, key: nextKey }],
                      },
                      nextKey,
                    }
                  }

                  let nextGeometry = displayGeometry
                  let fromKey = baseSeg.from
                  let toKey = baseSeg.to
                  // Clone endpoints when they are shared with other segments.
                  ;({ geometry: nextGeometry, nextKey: fromKey } = clonePointIfShared(nextGeometry, fromKey))
                  ;({ geometry: nextGeometry, nextKey: toKey } = clonePointIfShared(nextGeometry, toKey))
                  if (fromKey !== baseSeg.from || toKey !== baseSeg.to) {
                    const nextSegments = nextGeometry.segments.map((s, sIdx) =>
                      sIdx === idx ? { ...s, from: fromKey, to: toKey } : s,
                    )
                    nextGeometry = {
                      ...nextGeometry,
                      segments: nextSegments,
                      bounds: calcBounds(nextGeometry.points),
                    }
                    onGeometryChange(nextGeometry)
                    const newKey = `${fromKey}-${toKey}-${idx}`
                    selectSegment(newKey)
                    setDragSegmentKey(newKey)
                  } else {
                    setDragSegmentKey(pickedKey)
                  }
                  const svg =
                    (e.currentTarget as SVGLineElement).ownerSVGElement ??
                    ((e.currentTarget as SVGLineElement).closest('svg') as SVGSVGElement | null)
                  if (!svg) return
                  const sp = screenToSvgFrom(e.clientX, e.clientY, svg)
                  segmentDragRef.current = {
                    start: sp,
                    baseGeometry: nextGeometry,
                    segIdx: idx,
                    fromKey,
                    toKey,
                  }
                  try {
                    ;(e.currentTarget as SVGLineElement).setPointerCapture(e.pointerId)
                  } catch {
                    /* ignore */
                  }
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
                  style={{
                    cursor:
                      pointPe === 'auto'
                        ? dragPointKey === p.key
                          ? 'grabbing'
                          : 'grab'
                        : 'default',
                  }}
                  onPointerDownCapture={() => {
                    markObjectPointer()
                  }}
                  onPointerDown={(e) => {
                    if (mode !== 'shape' || startMode !== 'free') return
                    beginObjectPointer(e)
                    selectPoint(p.key)
                    pushHistorySnapshot()
                    // Moving free-draw points updates bounds; freeze viewBox during drag for a stable feel (like rebar/spacings).
                    frozenViewBoundsRef.current = viewBounds
                    setFreezeViewBounds(true)
                    const svg =
                      (e.currentTarget as SVGCircleElement).ownerSVGElement ??
                      ((e.currentTarget as SVGCircleElement).closest('svg') as SVGSVGElement | null)
                    if (!svg) return
                    const sp = screenToSvgFrom(e.clientX, e.clientY, svg)
                    setDragPointKey(p.key)
                    pointDragRef.current = { key: p.key, start: sp, basePoint: { x: p.x, y: p.y } }
                    try {
                      ;(e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId)
                    } catch {
                      /* ignore */
                    }
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
            strokeWidth={2.25}
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
          const isSpacingDragging = dragSpacingId === sp.id
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
              style={{
                pointerEvents: pe,
                cursor: mode === 'annotation' ? (isSpacingDragging ? 'grabbing' : 'grab') : 'default',
              }}
              onPointerDownCapture={() => {
                markObjectPointer()
              }}
              onPointerDown={(e) => {
                if (mode !== 'annotation') return
                beginObjectPointer(e)
                selectSpacing(sp.id)
                const svg =
                  (e.currentTarget as SVGLineElement).ownerSVGElement ??
                  ((e.currentTarget as SVGLineElement).closest('svg') as SVGSVGElement | null)
                if (!svg) return
                const p = screenToSvgFrom(e.clientX, e.clientY, svg)
                setDragSpacingId(sp.id)
                spacingDragRef.current = { id: sp.id, lastX: p.x, lastY: p.y }
                try {
                  ;(e.currentTarget as SVGLineElement).setPointerCapture(e.pointerId)
                } catch {
                  /* ignore */
                }
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
                  const spacingLabelFont = 35
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
                          // 数字（ラベル）のみクリック/ドラッグ: ライン（線）は選択しない
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
          const bodyRadius = rebarBodyR * token.radiusScale
          const hitRadius = Math.max(rebarHitR, bodyRadius + 10)
          return (
            <g key={rb.id} pointerEvents="none" opacity={mode === 'shape' ? 0.55 : 1}>
              <circle
                cx={rb.x}
                cy={rb.y}
                r={bodyRadius}
                fill="transparent"
                stroke="transparent"
                strokeWidth={0}
              />
              <RebarSymbol
                x={rb.x}
                y={rb.y}
                token={token}
                radius={bodyRadius}
                strokeWidth={isSelected ? 2.4 : 1.9}
                strokeOverride={isSelected ? '#7c3aed' : undefined}
              />
              {!rebarDiameterUsesCanvasSymbolOnly(rb.diameter) && (
                <text
                  x={rb.x}
                  y={rb.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={Math.max(7, Math.min(12, bodyRadius * 0.95))}
                  fill={isSelected ? '#6d28d9' : token.text}
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {String(rb.diameter ?? '').trim().toUpperCase() ||
                    String(rb.label ?? '').trim() ||
                    '?'}
                </text>
              )}
              <circle
                data-canvas-hit="item"
                cx={rb.x}
                cy={rb.y}
                r={hitRadius}
                fill="transparent"
                pointerEvents={rebarPe}
                style={{
                  cursor:
                    rebarPe === 'auto'
                      ? dragRebarId === rb.id
                        ? 'grabbing'
                        : 'grab'
                      : 'default',
                }}
                onPointerDownCapture={() => {
                  markObjectPointer()
                }}
                onPointerDown={(e) => {
                  if (mode !== 'rebar' && mode !== 'annotation') return
                  beginObjectPointer(e)
                  onRebarClick(rb.id)
                  const svg =
                    (e.currentTarget as SVGCircleElement).ownerSVGElement ??
                    ((e.currentTarget as SVGCircleElement).closest('svg') as SVGSVGElement | null)
                  if (!svg) return
                  const p = screenToSvgFrom(e.clientX, e.clientY, svg)
                  setDragRebarId(rb.id)
                  rebarDragRef.current = { id: rb.id, offsetX: rb.x - p.x, offsetY: rb.y - p.y }
                  try {
                    ;(e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId)
                  } catch {
                    /* ignore */
                  }
                }}
              />
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
          <div className="space-y-3 text-[11px]">
            {mode === 'pitch' && (
              <div className="space-y-2 border-b border-border pb-3">
                <div className="font-medium text-foreground">ピッチ</div>
                <label className="block text-muted">
                  値（mm, 例: @200）
                  <input
                    value={pitchValue}
                    onChange={(e) => {
                      const compact = e.target.value.replace(/\s+/g, '')
                      if (compact === '') {
                        onPitchChange('')
                        return
                      }
                      const normalized = compact.startsWith('@') ? compact : `@${compact}`
                      onPitchChange(normalized)
                      const mm = parseSpacingMm(normalized)
                      if (mm != null) setDim('pitch', mm)
                    }}
                    placeholder="@200"
                    className={`mt-1 w-32 rounded border border-border px-2 py-1 text-xs outline-none focus:border-primary ${
                      hasPitchValue ? 'font-semibold' : 'font-normal'
                    }`}
                  />
                </label>
              </div>
            )}
            {mode === 'rebar' && (
              <div className="space-y-2 border-b border-border pb-3">
                <div className="font-medium text-foreground">径の見た目（参考）</div>
                <p className="text-[10px] leading-snug text-muted">
                  D10・D13・D16・D19 は記号のみ。それ以外の径（D22 など）は円の内側に径ラベルを表示します。
                </p>
                <div className="flex flex-wrap gap-3">
                  {(['D10', 'D13', 'D16', 'D19'] as const).map((d) => {
                    const token = rebarDiameterVisualToken(d)
                    const r = 10 * token.radiusScale
                    return (
                      <div key={d} className="flex flex-col items-center gap-1">
                        <svg
                          width={40}
                          height={40}
                          viewBox="-20 -20 40 40"
                          className="rounded border border-slate-200 bg-white"
                          aria-hidden
                        >
                          <RebarSymbol x={0} y={0} token={token} radius={r} strokeWidth={1.9} />
                        </svg>
                        <span className="font-mono text-[10px] font-semibold text-slate-700">{d}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
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
                <div className="font-medium text-foreground">フリー寸法</div>
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
                  この寸法を削除
                </button>
              </div>
            )}

            {mode === 'rebar' && selectedRebar && (
              <div className="space-y-2 border-b border-border pb-3">
                <div className="font-medium text-foreground">鉄筋（配置点）</div>
                <label className="block text-muted">
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
                <label className="flex items-center justify-between gap-2 text-muted">
                  <span>二重線</span>
                  <input
                    type="checkbox"
                    checked={selectedSegmentInfo.seg.doubleLine === true}
                    onChange={(e) => {
                      const checked = e.target.checked
                      pushHistorySnapshot()
                      const nextSegments = displayGeometry.segments.map((s, idx) =>
                        idx === selectedSegmentInfo.idx ? { ...s, doubleLine: checked } : s,
                      )
                      onGeometryChange({
                        ...displayGeometry,
                        segments: nextSegments,
                        bounds: calcBounds(displayGeometry.points),
                      })
                    }}
                    className="rounded"
                  />
                </label>
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
              (mode === 'shape' && startMode === 'template') ||
              mode === 'pitch'
            ) && (
              <p className="text-[11px] leading-relaxed text-muted">
                キャンバス上の点・線・鉄筋・間隔・注記を選択してください。
              </p>
            )}
          </div>
        </div>

        {aggregationSlot}
      </aside>

      {annotationInput && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-white shadow-xl">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-sm font-semibold text-foreground">寸法値</h3>
              <p className="mt-1 text-xs text-muted">
                図形に表示する寸法値を mm で入力してください。
              </p>
            </div>
            <div className="px-5 py-4">
              <label className="block text-xs font-medium text-muted">
                寸法値（mm）
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={annotationInput.value}
                  onChange={(e) =>
                    setAnnotationInput((prev) =>
                      prev ? { ...prev, value: e.target.value, error: null } : prev,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitAnnotationInput()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setAnnotationInput(null)
                    }
                  }}
                  autoFocus
                  className={`mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono outline-none ${
                    annotationInput.error
                      ? 'border-red-300 bg-red-50 focus:border-red-500'
                      : 'border-border bg-white focus:border-primary'
                  }`}
                  placeholder="例: 300"
                />
              </label>
              {annotationInput.error ? (
                <p className="mt-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {annotationInput.error}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => setAnnotationInput(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={submitAnnotationInput}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}
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
  const pad = large ? 56 : 24
  const w = Math.max(110, maxX - minX + pad * 2)
  const h = Math.max(66, maxY - minY + pad * 2)
  const byKey = Object.fromEntries(previewGeometry.points.map((p) => [p.key, p]))
  const stroke = getSegmentStrokeHex(normalizeSegmentColor(unit.color), false)
  const lineStyle = getUnitShapeLineStyle(unit)
  const previewRebarLayout = normalizeRebarLayout(unit.rebar_layout)
  const pitchMm = Number.isFinite(unit.pitch_mm as number)
    ? Math.round(unit.pitch_mm as number)
    : null
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
  const rebarR = large ? 12 : 5.4
  const rebarStrokeW = large ? 2 : 1
  const spacingFont = large ? 26 : 13
  const spacingTickHalf = large ? 7 : 4.2
  const previewBarDiameters = Array.from(
    new Set((unit.bars ?? []).map((b) => String(b.diameter ?? '').trim().toUpperCase()).filter(Boolean)),
  )

  return (
    <div className={large ? 'relative h-80 w-full' : 'contents'}>
      {large && pitchMm != null && (
        <div className="pointer-events-none absolute left-4 top-3 z-10 text-[14px] font-bold leading-none text-slate-800">
          @{pitchMm}
        </div>
      )}
      {large && previewBarDiameters.length > 0 && (
        <div className="pointer-events-none absolute right-4 top-3 z-10 flex flex-col items-end gap-1.5">
          {previewBarDiameters.map((diameter) => {
            const token = rebarDiameterVisualToken(diameter)
            const radius = 8 * token.radiusScale
            return (
              <div key={diameter} className="flex items-center gap-1.5 rounded border border-slate-200 bg-white/85 px-1.5 py-1 shadow-sm">
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <RebarSymbol x={12} y={12} token={token} radius={radius} strokeWidth={1.8} />
                </svg>
                <span className="min-w-7 text-left text-[10px] font-semibold leading-none text-slate-700">
                  {diameter}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <svg
        viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        className={large ? 'h-full w-full rounded border border-border bg-white' : 'h-12 w-28 rounded border border-border bg-white'}
        aria-label="shape thumbnail"
      >
      {!large && pitchMm != null && (
        <text
          x={minX - pad + w - (large ? 1 : 2)}
          y={minY - pad + (large ? 18 : 44)}
          textAnchor="end"
          dominantBaseline="hanging"
          fontSize={large ? 42 : 24}
          fill="#1e293b"
          fontWeight={900}
        >
          @{pitchMm}
        </text>
      )}
      {previewGeometry.segments.map((seg, i) => {
        const p1 = byKey[seg.from]
        const p2 = byKey[seg.to]
        if (!p1 || !p2) return null
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len
        const ny = dx / len
        return (
          <g key={`${seg.from}-${seg.to}-${i}`}>
            {seg.doubleLine === true ? (
              (() => {
                const baseW = large ? lineStyle.strokeWidth : Math.max(1.5, lineStyle.strokeWidth - 0.5)
                const w = large ? Math.max(1.2, baseW * 0.58) : Math.max(1.6, baseW * 0.72)
                const off = large ? Math.max(2.0, baseW * 0.9) : Math.max(3.2, baseW * 1.9)
                return (
                  <>
                    {!large && (
                      <line
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke="#ffffff"
                        strokeWidth={Math.max(1.2, off * 0.72)}
                        strokeLinecap="round"
                      />
                    )}
                    <line
                      x1={p1.x + nx * off}
                      y1={p1.y + ny * off}
                      x2={p2.x + nx * off}
                      y2={p2.y + ny * off}
                      stroke={stroke}
                      strokeWidth={w}
                      strokeLinecap="round"
                    />
                    <line
                      x1={p1.x - nx * off}
                      y1={p1.y - ny * off}
                      x2={p2.x - nx * off}
                      y2={p2.y - ny * off}
                      stroke={stroke}
                      strokeWidth={w}
                      strokeLinecap="round"
                    />
                  </>
                )
              })()
            ) : (
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={stroke}
                strokeWidth={large ? lineStyle.strokeWidth : Math.max(1.5, lineStyle.strokeWidth - 0.5)}
                strokeLinecap="round"
              />
            )}
          </g>
        )
      })}
      {previewSpacings.map((sp) => {
        const dx = sp.x2 - sp.x1
        const dy = sp.y2 - sp.y1
        const segLen = Math.hypot(dx, dy) || 1
        const nx = -dy / segLen
        const ny = dx / segLen
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
            <line
              x1={sp.x1 - nx * spacingTickHalf}
              y1={sp.y1 - ny * spacingTickHalf}
              x2={sp.x1 + nx * spacingTickHalf}
              y2={sp.y1 + ny * spacingTickHalf}
              stroke="#64748b"
              strokeWidth={large ? 1.9 : 1.2}
              strokeLinecap="butt"
            />
            <line
              x1={sp.x2 - nx * spacingTickHalf}
              y1={sp.y2 - ny * spacingTickHalf}
              x2={sp.x2 + nx * spacingTickHalf}
              y2={sp.y2 + ny * spacingTickHalf}
              stroke="#64748b"
              strokeWidth={large ? 1.9 : 1.2}
              strokeLinecap="butt"
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
        const token = rebarDiameterVisualToken(rb.diameter)
        const radius = rebarR * token.radiusScale
        const showDiamLabel = large && !rebarDiameterUsesCanvasSymbolOnly(rb.diameter)
        const diamLabel =
          String(rb.diameter ?? '').trim().toUpperCase() || String(rb.label ?? '').trim() || '?'
        return (
          <g key={`rb-${rb.id}`}>
            <RebarSymbol
              x={rb.x}
              y={rb.y}
              token={token}
              radius={radius}
              strokeWidth={Math.max(0.9, rebarStrokeW)}
            />
            {showDiamLabel ? (
              <text
                x={rb.x}
                y={rb.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.max(5, Math.min(8, radius * 0.85))}
                fill={token.text}
                fontWeight={700}
                pointerEvents="none"
              >
                {diamLabel}
              </text>
            ) : null}
          </g>
        )
      })}
      {/* 間隔線(spacings)とは別に保存される寸法＝距離ラベル等（形状編集の annotations と同じ） */}
      {(large ? previewRebarLayout.annotations : []).map((an) => {
        if (!Number.isFinite(an.x) || !Number.isFinite(an.y)) return null
        const t = String(an.text ?? '').trim()
        if (!t) return null
        return (
          <text
            key={`an-${an.id}`}
            x={an.x}
            y={an.y}
            fontSize={18}
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
    </div>
  )
}

function PresetShapeThumbnail({ payload }: { payload: UserUnitPresetPayload }) {
  const template = shapeTypeToDetailTemplate(payload.shape_type)
  const spec = normalizeDetailSpecForTemplate(
    template,
    payload.detail_spec ?? getDefaultDetailSpec(template),
  )
  const sketch = buildShapeSketch(template, spec)
  const storedGeo = payload.detail_geometry
  const useStoredGeo =
    !!storedGeo &&
    Array.isArray(storedGeo.points) &&
    Array.isArray(storedGeo.segments) &&
    storedGeo.points.length > 1 &&
    storedGeo.segments.length > 0
  const previewGeometry = useStoredGeo ? storedGeo : sketch.geometry
  const bounds = previewGeometry.bounds
  const xs = previewGeometry.points.map((p) => p.x)
  const ys = previewGeometry.points.map((p) => p.y)
  const minX = Number.isFinite(bounds?.minX) ? bounds!.minX : Math.min(...xs, 0)
  const minY = Number.isFinite(bounds?.minY) ? bounds!.minY : Math.min(...ys, 0)
  const maxX = Number.isFinite(bounds?.maxX) ? bounds!.maxX : Math.max(...xs, 100)
  const maxY = Number.isFinite(bounds?.maxY) ? bounds!.maxY : Math.max(...ys, 60)
  const pad = 28
  const w = Math.max(140, maxX - minX + pad * 2)
  const h = Math.max(76, maxY - minY + pad * 2)
  const byKey = Object.fromEntries(previewGeometry.points.map((p) => [p.key, p]))
  const span = Math.hypot(maxX - minX, maxY - minY) || 80
  // viewBox 全体が縮小されるため、形状座標系でやや太めに描くとサムネで視認しやすい
  const strokeMain = Math.max(5, span * 0.035)
  const strokeHalo = strokeMain * 1.55
  const presetHasDoubleLine = previewGeometry.segments.some((s) => s.doubleLine === true)
  const presetStroke = getSegmentStrokeHex(normalizeSegmentColor(payload.color), false)

  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-16 w-32 shrink-0 rounded-md border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-inner"
      aria-label="preset shape thumbnail"
    >
      {previewGeometry.segments.map((seg, i) => {
        const p1 = byKey[seg.from]
        const p2 = byKey[seg.to]
        if (!p1 || !p2) return null
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len
        const ny = dx / len
        return (
          <g key={`${seg.from}-${seg.to}-${i}`}>
            {(seg.doubleLine === true || presetHasDoubleLine) ? (
              (() => {
                const w = Math.max(2.2, strokeMain * 0.46)
                const off = Math.max(1.8, strokeMain * 0.9)
                return (
                  <>
                    <line
                      x1={p1.x + nx * off}
                      y1={p1.y + ny * off}
                      x2={p2.x + nx * off}
                      y2={p2.y + ny * off}
                      stroke={presetStroke}
                      strokeWidth={w}
                      strokeLinecap="round"
                    />
                    <line
                      x1={p1.x - nx * off}
                      y1={p1.y - ny * off}
                      x2={p2.x - nx * off}
                      y2={p2.y - ny * off}
                      stroke={presetStroke}
                      strokeWidth={w}
                      strokeLinecap="round"
                    />
                  </>
                )
              })()
            ) : (
              <>
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#e2e8f0"
                  strokeWidth={strokeHalo}
                  strokeLinecap="round"
                />
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={presetStroke}
                  strokeWidth={strokeMain}
                  strokeLinecap="round"
                />
              </>
            )}
          </g>
        )
      })}
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
  const totalDimensionMm = (unit.rebar_layout?.annotations ?? [])
    .map((an) => parseSpacingMm(an.text))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
    .reduce((sum, v) => sum + v, 0)

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
      {/* 総寸法 */}
      <td className={`px-4 py-3 hidden lg:table-cell ${dimInactiveCell}`}>
        <span className="text-xs text-muted">
          {totalDimensionMm > 0 ? `${totalDimensionMm}mm` : '-'}
        </span>
      </td>
      {/* ピッチ */}
      <td className={`px-4 py-3 hidden lg:table-cell ${dimInactiveCell}`}>
        <span className="text-xs text-muted">
          {unit.pitch_mm != null ? `@${unit.pitch_mm}` : '-'}
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
