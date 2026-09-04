/**
 * 図面詳細画面の「コーナー筋」タブで扱う鉄筋オブジェクトのモデル。
 *
 * ユニット編集の派生ではなく、図面レベルの独立したオブジェクトとして扱う。
 * 将来 大コーナー・曲筋・玄関落とし筋 などが増えても構造を変えずに済むよう、
 * 次の 2 軸を分離している。
 *
 *   category  … 筋種類（コーナー筋 / 添え筋 / 特殊コーナー筋 …）
 *   shapeType … 形状トポロジー（L / U / Z / STEP …）
 *
 * 同じ L 形がコーナー筋にも添え筋にも使えるため、形状と筋種類は 1:1 にしない。
 *
 * 寸法は「鉄筋 1 本 ＝ 長さ 1 個」では持たない。
 * 形状を構成する辺（segment）ごとに寸法値(mm)と寸法基準（芯々／内々）を持ち、
 * 辺の順序は資料の表記（例: 600 × 455 × 115 × 600）と一致させる。
 */

/** 寸法基準。辺ごとに個別に持つ（鉄筋全体の属性ではない） */
export type MeasurementType = 'SHIN_SHIN' | 'UCHI_UCHI'

export const MEASUREMENT_TYPES: Array<{ id: MeasurementType; label: string }> = [
  { id: 'SHIN_SHIN', label: '芯々' },
  { id: 'UCHI_UCHI', label: '内々' },
]

export function measurementTypeLabel(value: MeasurementType | null | undefined): string {
  if (!value) return '未設定'
  return MEASUREMENT_TYPES.find((m) => m.id === value)?.label ?? '未設定'
}

/** 筋種類。UI ラベルは日本語、保存値は英字キー */
export type CornerBarCategory = 'CORNER' | 'SOE' | 'BIG_CORNER' | 'SPECIAL_CORNER'

export const CORNER_BAR_CATEGORIES: Array<{
  id: CornerBarCategory
  label: string
}> = [
  { id: 'CORNER', label: 'コーナー筋' },
  { id: 'SOE', label: '添え筋' },
  { id: 'BIG_CORNER', label: '大コーナー' },
  { id: 'SPECIAL_CORNER', label: '特殊コーナー筋' },
]

const LEGACY_CORNER_BAR_CATEGORY_LABELS: Record<string, string> = {
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
        measurement === 'SHIN_SHIN' || measurement === 'UCHI_UCHI' ? measurement : null,
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
): string {
  const geometry = buildCornerBarGeometry(shape, makeCornerBarSegments(shape))
  const b = cornerBarGeometryBounds(geometry)
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const scale = Math.min((boxW - pad * 2) / w, (boxH - pad * 2) / h)
  const offsetX = (boxW - w * scale) / 2
  const offsetY = (boxH - h * scale) / 2
  return geometry.points
    .map((p, i) => {
      const x = offsetX + (p.x - b.minX) * scale
      const y = offsetY + (p.y - b.minY) * scale
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
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
