/**
 * 図面詳細画面の「コーナー筋」タブで扱う鉄筋オブジェクトのモデル。
 *
 * ユニット編集の派生ではなく、図面レベルの独立したオブジェクトとして扱う。
 * 将来 曲筋・玄関落とし筋 などが増えても構造を変えずに済むよう、
 * 次の 2 軸を分離している。
 *
 *   category  … 筋種類（コーナー筋 / 添え筋 / 特殊コーナー筋 …）
 *   shapeType … 形状トポロジー（L / U / Z / STEP …）
 *
 * 同じ L 形がコーナー筋にも添え筋にも使えるため、形状と筋種類は 1:1 にしない。
 *
 * 寸法は「鉄筋 1 本 ＝ 長さ 1 個」では持たない。
 * 形状を構成する辺（segment）ごとに寸法値(mm)と寸法基準（芯々／内々／外々）を持ち、
 * 辺の順序は資料の表記（例: 600 × 455 × 115 × 600）と一致させる。
 */

/** 寸法基準。辺ごとに個別に持つ（鉄筋全体の属性ではない） */
export type MeasurementType = 'SHIN_SHIN' | 'UCHI_UCHI' | 'SOTO_SOTO'

export const MEASUREMENT_TYPES: Array<{ id: MeasurementType; label: string }> = [
  { id: 'SHIN_SHIN', label: '芯々' },
  { id: 'UCHI_UCHI', label: '内々' },
  { id: 'SOTO_SOTO', label: '外々' },
]

export function measurementTypeLabel(value: MeasurementType | null | undefined): string {
  if (!value) return '未設定'
  return MEASUREMENT_TYPES.find((m) => m.id === value)?.label ?? '未設定'
}

/** 筋種類。UI ラベルは日本語、保存値は英字キー */
export type CornerBarCategory = 'CORNER' | 'SOE' | 'SPECIAL_CORNER'

export const CORNER_BAR_CATEGORIES: Array<{
  id: CornerBarCategory
  label: string
}> = [
  { id: 'CORNER', label: 'コーナー筋' },
  { id: 'SOE', label: '添え筋' },
  { id: 'SPECIAL_CORNER', label: '特殊コーナー筋' },
]

const LEGACY_CORNER_BAR_CATEGORY_LABELS: Record<string, string> = {
  BIG_CORNER: '特殊コーナー筋',
  PARTIAL_REINFORCE: '部分補強筋',
  BENT: '曲筋',
  GENKAN_DROP: '玄関落とし筋',
}

export function cornerBarCategoryLabel(category: string): string {
  return (
    CORNER_BAR_CATEGORIES.find((c) => c.id === category)?.label ??
    LEGACY_CORNER_BAR_CATEGORY_LABELS[category] ??
    category
  )
}

export const CORNER_BAR_DIAMETERS = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25'] as const

/** 形状トポロジー */
export type CornerBarShapeType = 'STRAIGHT' | 'L' | 'U' | 'Z' | 'STEP' | 'T'

/**
 * 形状定義。辺の向きだけを持ち、寸法は持たない。
 *
 * directions は辺の順番どおりの単位ベクトル。
 * キャンバスと同じく y 軸は下向きが正なので、上へ伸ばす辺は y = -1。
 */
export interface CornerBarShapeDef {
  id: CornerBarShapeType
  label: string
  /** 辺ごとの向き（順序＝辺1, 辺2, …） */
  directions: Array<{ x: number; y: number }>
  /** 寸法未入力のときに使う既定値(mm)。辺の数と同じ長さ */
  defaultLengths: number[]
}

export const CORNER_BAR_SHAPES: CornerBarShapeDef[] = [
  {
    id: 'STRAIGHT',
    label: 'ストレート',
    directions: [{ x: 1, y: 0 }],
    defaultLengths: [1200],
  },
  {
    id: 'L',
    label: 'L形',
    directions: [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
    ],
    defaultLengths: [600, 600],
  },
  {
    id: 'Z',
    label: 'Z形',
    directions: [
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
    ],
    defaultLengths: [450, 300, 450],
  },
  {
    id: 'U',
    label: 'コの字',
    directions: [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    defaultLengths: [400, 500, 400],
  },
  {
    id: 'STEP',
    label: '階段形',
    directions: [
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
    ],
    defaultLengths: [600, 455, 115, 600],
  },
  {
    id: 'T',
    label: 'T形',
    directions: [
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
    ],
    defaultLengths: [300, 300, 400],
  },
]

export function getCornerBarShape(shapeType: string): CornerBarShapeDef | null {
  return CORNER_BAR_SHAPES.find((s) => s.id === shapeType) ?? null
}

export function cornerBarShapeLabel(shapeType: string): string {
  return getCornerBarShape(shapeType)?.label ?? shapeType
}

/** 筋種類ごとに形状が固定される場合のマッピング（添え筋＝ストレート、コーナー筋＝L形） */
const CATEGORY_FIXED_SHAPE: Partial<Record<CornerBarCategory, CornerBarShapeType>> = {
  CORNER: 'L',
  SOE: 'STRAIGHT',
}

export function getFixedShapeForCategory(
  category: CornerBarCategory,
): CornerBarShapeType | null {
  return CATEGORY_FIXED_SHAPE[category] ?? null
}

export function isCategoryShapeFixed(category: CornerBarCategory): boolean {
  return getFixedShapeForCategory(category) != null
}

export function getCornerBarShapesForCategory(
  category: CornerBarCategory,
): CornerBarShapeDef[] {
  const fixed = getFixedShapeForCategory(category)
  if (fixed) {
    const shape = getCornerBarShape(fixed)
    return shape ? [shape] : []
  }
  return CORNER_BAR_SHAPES
}

/** パレット用。コーナー筋は L 形を 90° ずつ 4 通り、添え筋はストレート 1 つ */
export interface CornerBarShapeOption {
  key: string
  shapeType: CornerBarShapeType
  rotation: number
  label: string
  shape: CornerBarShapeDef
}

export function getCornerBarShapeOptionsForCategory(
  category: CornerBarCategory,
): CornerBarShapeOption[] {
  if (category === 'CORNER') {
    const shape = getCornerBarShape('L')
    if (!shape) return []
    return [0, 1, 2, 3].map((rotation) => ({
      key: `L-${rotation}`,
      shapeType: 'L',
      rotation,
      label: `L形 ${cornerBarRotationLabel(rotation)}`,
      shape,
    }))
  }
  if (category === 'SOE') {
    const shape = getCornerBarShape('STRAIGHT')
    if (!shape) return []
    return [0, 1].map((rotation) => ({
      key: `STRAIGHT-${rotation}`,
      shapeType: 'STRAIGHT',
      rotation,
      label: rotation === 0 ? '横' : '縦',
      shape,
    }))
  }
  return CORNER_BAR_SHAPES.map((shape) => ({
    key: shape.id,
    shapeType: shape.id,
    rotation: 0,
    label: shape.label,
    shape,
  }))
}

export function resolveCategoryShape(
  category: CornerBarCategory,
  shapeType?: CornerBarShapeType | string | null,
): CornerBarShapeType {
  const fixed = getFixedShapeForCategory(category)
  if (fixed) return fixed
  if (shapeType && getCornerBarShape(shapeType)) return shapeType as CornerBarShapeType
  return 'STRAIGHT'
}

/** コーナー筋 L 形の標準寸法（径ごと、辺1 × 辺2） */
const CORNER_STANDARD_LENGTHS_MM: Record<string, readonly [number, number]> = {
  D13: [600, 600],
  D10: [450, 450],
  D16: [750, 750],
  D19: [900, 900],
}

/** 添え筋ストレートの標準寸法（径ごと） */
const SOE_STANDARD_LENGTHS_MM: Record<string, number> = {
  D13: 1200,
  D10: 900,
  D16: 1500,
  D19: 1800,
}

export function hasStandardSegmentLengths(category: CornerBarCategory): boolean {
  return category === 'CORNER' || category === 'SOE'
}

/** 筋種類・径に対応する標準寸法（mm）。未定義の径は null */
export function getStandardSegmentLengthsMm(
  category: CornerBarCategory,
  diameter: string,
  shapeType: CornerBarShapeType,
): number[] | null {
  if (category === 'SOE' && shapeType === 'STRAIGHT') {
    const len = SOE_STANDARD_LENGTHS_MM[diameter]
    return len != null ? [len] : null
  }
  if (category === 'CORNER' && shapeType === 'L') {
    const legs = CORNER_STANDARD_LENGTHS_MM[diameter]
    return legs ? [...legs] : null
  }
  return null
}

function formatStandardDimsLabel(category: CornerBarCategory, diameter: string): string | null {
  if (category === 'SOE') {
    const len = SOE_STANDARD_LENGTHS_MM[diameter]
    return len != null ? String(len) : null
  }
  if (category === 'CORNER') {
    const legs = CORNER_STANDARD_LENGTHS_MM[diameter]
    return legs ? `${legs[0]} × ${legs[1]}` : null
  }
  return null
}

/** 鉄筋径プルダウン表示。コーナー筋・添え筋は標準寸法を括弧付きで示す */
export function cornerBarDiameterOptionLabel(
  category: CornerBarCategory,
  diameter: string,
): string {
  if (!hasStandardSegmentLengths(category)) return diameter
  const dims = formatStandardDimsLabel(category, diameter)
  return dims ? `${diameter}(${dims})` : diameter
}

/**
 * 保存する辺データ。
 *
 * lengthMm は未入力を許す（形状を先に置いて、寸法は後から入れる運用のため）。
 * labelOffset は寸法ラベルが重なったときにドラッグで避けるためのずれ。
 */
export interface CornerBarSegment {
  id: string
  lengthMm: number | null
  measurementType: MeasurementType | null
  labelOffsetX?: number
  labelOffsetY?: number
}

/** 形状を選んだ直後の、寸法未入力の辺列を作る */
export function makeCornerBarSegments(shape: CornerBarShapeDef): CornerBarSegment[] {
  return shape.directions.map((_, i) => ({
    id: `s${i + 1}`,
    lengthMm: null,
    measurementType: null,
  }))
}

/**
 * 筋種類・径の標準寸法を辺に入れる。標準が無い径は既存値を維持する。
 * measurementType など標準以外の属性は既存値を保つ。
 */
export function applyStandardSegmentLengths(
  shape: CornerBarShapeDef,
  category: CornerBarCategory,
  diameter: string,
  existing?: CornerBarSegment[],
): CornerBarSegment[] {
  const standard = getStandardSegmentLengthsMm(
    category,
    diameter,
    shape.id as CornerBarShapeType,
  )
  return shape.directions.map((_, i) => {
    const prev = existing?.[i]
    return {
      id: prev?.id ?? `s${i + 1}`,
      lengthMm: standard?.[i] ?? prev?.lengthMm ?? null,
      measurementType: prev?.measurementType ?? null,
      ...(Number.isFinite(Number(prev?.labelOffsetX))
        ? { labelOffsetX: Number(prev?.labelOffsetX) }
        : {}),
      ...(Number.isFinite(Number(prev?.labelOffsetY))
        ? { labelOffsetY: Number(prev?.labelOffsetY) }
        : {}),
    }
  })
}

/**
 * 保存済みの辺データを形状に合わせて整える。
 * 形状の辺数と合わない古いデータでも、順序を保ったまま過不足を補正する。
 */
export function normalizeCornerBarSegments(
  shape: CornerBarShapeDef,
  stored: unknown,
): CornerBarSegment[] {
  const list = Array.isArray(stored) ? stored : []
  return shape.directions.map((_, i) => {
    const raw = list[i] as Partial<CornerBarSegment> | undefined
    const lengthRaw = Number(raw?.lengthMm)
    const measurement = raw?.measurementType
    return {
      id: typeof raw?.id === 'string' && raw.id ? raw.id : `s${i + 1}`,
      lengthMm: Number.isFinite(lengthRaw) && lengthRaw > 0 ? lengthRaw : null,
      measurementType:
        measurement === 'SHIN_SHIN' ||
        measurement === 'UCHI_UCHI' ||
        measurement === 'SOTO_SOTO'
          ? measurement
          : null,
      ...(Number.isFinite(Number(raw?.labelOffsetX))
        ? { labelOffsetX: Number(raw?.labelOffsetX) }
        : {}),
      ...(Number.isFinite(Number(raw?.labelOffsetY))
        ? { labelOffsetY: Number(raw?.labelOffsetY) }
        : {}),
    }
  })
}

/** 寸法が全部入っているか（一覧で未入力を目立たせるため） */
export function isCornerBarFullyDimensioned(segments: CornerBarSegment[]): boolean {
  return segments.length > 0 && segments.every((s) => s.lengthMm != null && s.lengthMm > 0)
}

/** 辺の合計(mm)。未入力の辺は 0 として足す */
export function cornerBarSegmentSumMm(segments: CornerBarSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.lengthMm ?? 0), 0)
}

/** 資料と同じ「600 × 455 × 115 × 600」表記 */
export function formatCornerBarDims(segments: CornerBarSegment[]): string {
  if (segments.length === 0) return ''
  return segments.map((s) => (s.lengthMm == null ? '—' : String(s.lengthMm))).join(' × ')
}

// --- 図形化 -------------------------------------------------------------

/**
 * 図面上の大きさ（bbox の長辺, px）。
 *
 * 実寸(mm)をそのまま図面座標に使うと、600mm が 600px になって図面に対して
 * 大きすぎる。寸法は資料どおりの数値として持ちたいだけなので、描画の大きさは
 * 配置時のドラッグ（size_px）だけで決め、mm はラベル・集計用のデータとして保持する。
 */
export const DEFAULT_CORNER_BAR_SIZE_PX = 110
export const MIN_CORNER_BAR_SIZE_PX = 24
export const MAX_CORNER_BAR_SIZE_PX = 3000

export function clampCornerBarSizePx(sizePx: number): number {
  if (!Number.isFinite(sizePx)) return DEFAULT_CORNER_BAR_SIZE_PX
  return Math.min(MAX_CORNER_BAR_SIZE_PX, Math.max(MIN_CORNER_BAR_SIZE_PX, sizePx))
}

/** ドラッグした矩形から大きさを決める。長辺をそのまま形状の長辺にする */
export function cornerBarSizePxFromDrag(dx: number, dy: number): number {
  return clampCornerBarSizePx(Math.max(Math.abs(dx), Math.abs(dy)))
}

/**
 * ドラッグ矩形から付加筋の向き（0/1/2/3）を推定する。
 * 添え筋（ストレート）は長辺方向に伸ばす。縦長ドラッグなら 90° 回転。
 */
export function cornerBarRotationFromDrag(
  dx: number,
  dy: number,
  category: CornerBarCategory,
  shapeType: CornerBarShapeType,
  fallbackRotation = 0,
): number {
  if (category === 'SOE' && shapeType === 'STRAIGHT') {
    return Math.abs(dy) > Math.abs(dx) ? 1 : 0
  }
  return normalizeCornerBarRotation(fallbackRotation)
}

/** クリックだけでは配置しない。ドラッグ量が下限以上のときだけ true */
export function isCornerBarDragPlacement(dx: number, dy: number): boolean {
  return Math.max(Math.abs(dx), Math.abs(dy)) >= MIN_CORNER_BAR_SIZE_PX
}

/** 短い辺が潰れて掴めなくならないよう、最長辺に対して下限を置く比率 */
const MIN_SEGMENT_RATIO = 0.12

/**
 * 図面上の辺の比率。形状の既定値のみ使い、入力した mm には連動しない。
 * 短い辺が潰れて掴めなくならないよう、最長辺に対して下限を置く。
 */
function relativeSegmentLengths(shape: CornerBarShapeDef): number[] {
  const raw = shape.directions.map((_, i) => shape.defaultLengths[i] ?? 300)
  const floor = Math.max(...raw) * MIN_SEGMENT_RATIO
  return raw.map((v) => Math.max(v, floor))
}

export interface CornerBarGeometry {
  /** 辺の順に連なる頂点。points[i] → points[i+1] が辺 i */
  points: Array<{ x: number; y: number }>
}

/**
 * 原点 (0,0) 起点で、辺を順番につないだ折れ線を作る。
 * 形は形状の既定比率で決まり、全体の大きさは sizePx（bbox の長辺）に合わせる。
 * segments の lengthMm は描画には使わない。
 */
export function buildCornerBarGeometry(
  shape: CornerBarShapeDef,
  _segments: CornerBarSegment[],
  sizePx: number = DEFAULT_CORNER_BAR_SIZE_PX,
): CornerBarGeometry {
  const lengths = relativeSegmentLengths(shape)
  const points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }]
  shape.directions.forEach((dir, i) => {
    const len = lengths[i] ?? 0
    const prev = points[points.length - 1]!
    points.push({ x: prev.x + dir.x * len, y: prev.y + dir.y * len })
  })

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const natural = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  )
  if (natural <= 0) return { points }
  const k = clampCornerBarSizePx(sizePx) / natural
  return { points: points.map((p) => ({ x: p.x * k, y: p.y * k })) }
}

export function normalizeCornerBarRotation(steps: number): number {
  return ((Math.round(steps) % 4) + 4) % 4
}

/** ボタン 1 回で 90 度ずつ進める */
export function nextCornerBarRotation(steps: number): number {
  return normalizeCornerBarRotation(steps + 1)
}

export function cornerBarRotationLabel(steps: number): string {
  return `${normalizeCornerBarRotation(steps) * 90}°`
}

/** 90 度単位の回転（0/1/2/3 = 0/90/180/270 度、時計回り） */
export function rotateCornerBarPoint(
  p: { x: number; y: number },
  rotationSteps: number,
): { x: number; y: number } {
  const steps = ((Math.round(rotationSteps) % 4) + 4) % 4
  switch (steps) {
    case 1:
      return { x: -p.y, y: p.x }
    case 2:
      return { x: -p.x, y: -p.y }
    case 3:
      return { x: p.y, y: -p.x }
    default:
      return { x: p.x, y: p.y }
  }
}

/**
 * 図面上に描くための絶対座標。
 * 形状の bbox 中心を配置点 (originX, originY) に合わせる。
 */
export function cornerBarCanvasGeometry(
  shape: CornerBarShapeDef,
  segments: CornerBarSegment[],
  originX: number,
  originY: number,
  rotationSteps = 0,
  sizePx: number = DEFAULT_CORNER_BAR_SIZE_PX,
): CornerBarGeometry {
  const base = buildCornerBarGeometry(shape, segments, sizePx)
  const rotated = base.points.map((p) => rotateCornerBarPoint(p, rotationSteps))
  const xs = rotated.map((p) => p.x)
  const ys = rotated.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return {
    points: rotated.map((p) => ({ x: originX + (p.x - cx), y: originY + (p.y - cy) })),
  }
}

/** 辺 i の両端。辺の順序と 1 対 1 で対応する */
export function cornerBarSegmentLines(
  geometry: CornerBarGeometry,
): Array<{ index: number; p1: { x: number; y: number }; p2: { x: number; y: number } }> {
  const out: Array<{ index: number; p1: { x: number; y: number }; p2: { x: number; y: number } }> =
    []
  for (let i = 0; i < geometry.points.length - 1; i += 1) {
    out.push({ index: i, p1: geometry.points[i]!, p2: geometry.points[i + 1]! })
  }
  return out
}

export function cornerBarGeometryBounds(geometry: CornerBarGeometry): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const xs = geometry.points.map((p) => p.x)
  const ys = geometry.points.map((p) => p.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

/** パレットのサムネイル用 SVG path */
export function cornerBarThumbPath(
  shape: CornerBarShapeDef,
  boxW: number,
  boxH: number,
  pad = 6,
  rotationSteps = 0,
): string {
  const geometry = buildCornerBarGeometry(shape, makeCornerBarSegments(shape))
  const rotated = {
    points: geometry.points.map((p) => rotateCornerBarPoint(p, rotationSteps)),
  }
  const b = cornerBarGeometryBounds(rotated)
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const scale = Math.min((boxW - pad * 2) / w, (boxH - pad * 2) / h)
  const offsetX = (boxW - w * scale) / 2
  const offsetY = (boxH - h * scale) / 2
  return rotated.points
    .map((p, i) => {
      const x = offsetX + (p.x - b.minX) * scale
      const y = offsetY + (p.y - b.minY) * scale
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

// --- 印刷要約（パネル下部・印刷プレビューで共有） -------------------------

export type CornerBarPrintSummaryCategoryCount = {
  category: CornerBarCategory
  label: string
  count: number
}

export type CornerBarPrintSummaryDetailRow = {
  category: string
  diameter: string
  color: string
  qty: number
}

export type CornerBarPrintSummary = {
  categoryCounts: CornerBarPrintSummaryCategoryCount[]
  detailRows: CornerBarPrintSummaryDetailRow[]
}

type CornerBarForPrintSummary = {
  category: string
  diameter: string | null
  color: string
}

/** 付加筋パネル下部・印刷要約ボックス用の集計 */
export function buildCornerBarPrintSummary(
  cornerBars: CornerBarForPrintSummary[],
  normalizeColor: (color: string) => string = (c) => c,
): CornerBarPrintSummary {
  const countByCategory = new Map<string, number>()
  for (const cb of cornerBars) {
    countByCategory.set(cb.category, (countByCategory.get(cb.category) ?? 0) + 1)
  }

  const categoryCounts = CORNER_BAR_CATEGORIES.map((c) => ({
    category: c.id,
    label: c.label,
    count: countByCategory.get(c.id) ?? 0,
  })).filter((c) => c.count > 0)

  const detailMap = new Map<
    string,
    { category: string; diameter: string; color: string; qty: number }
  >()
  for (const cb of cornerBars) {
    const diameter = cb.diameter ?? '径未設定'
    const color = normalizeColor(cb.color ?? 'red')
    const key = `${cb.category}/${diameter}/${color}`
    const prev = detailMap.get(key)
    if (prev) prev.qty += 1
    else detailMap.set(key, { category: cb.category, diameter, color, qty: 1 })
  }

  const detailRows = [...detailMap.values()].sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.diameter.localeCompare(b.diameter) ||
      a.color.localeCompare(b.color),
  )

  return { categoryCounts, detailRows }
}

// --- 配置前の設定 -------------------------------------------------------

/**
 * パレットで選んでから図面をドラッグするまでの、配置待ちの設定。
 * 筋種類・形状・鉄筋径・向きをここで決め、辺の寸法は配置後に入れる。
 *
 * 数量は持たない。図面に 1 つ描いたものが 1 本なので、集計は配置数で数える。
 */
export interface CornerBarPlacementDraft {
  category: CornerBarCategory
  shapeType: CornerBarShapeType
  diameter: string
  /** 0/1/2/3 = 0/90/180/270 度 */
  rotation: number
}

export function makeCornerBarDraft(
  shapeType: CornerBarShapeType,
  base?: Partial<CornerBarPlacementDraft>,
): CornerBarPlacementDraft {
  return {
    category: base?.category ?? 'CORNER',
    shapeType,
    diameter: base?.diameter ?? 'D13',
    rotation: base?.rotation ?? 0,
  }
}
