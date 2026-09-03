/**
 * 形状編集キャンバスに 1 クリックで挿入できる定型形状。
 *
 * 座標は mm。キャンバスと同じく y 軸は下向きが正で、各プリセットは
 * 「上端が負・下端が 0」を基準に定義する。挿入時に bbox 左上を基準へ
 * 平行移動するため、ここでの絶対位置そのものには意味がない。
 */
export interface ShapePresetDef {
  id: string
  label: string
  points: Array<{ x: number; y: number }>
  /**
   * 点をつなぐ線分（points のインデックス対）。省略時は points を順番に結ぶ。
   * T 字のように 1 点から 3 本以上枝分かれする形状で指定する。
   */
  segments?: Array<[number, number]>
  /** 終点と始点をつないで閉じた形状にする（segments 指定時は無視） */
  closed?: boolean
}

export const SHAPE_PRESETS: ShapePresetDef[] = [
  {
    id: 'step_l_diagonal',
    label: '段付き斜めL字',
    points: [
      { x: 0, y: -336 },
      { x: 0, y: 0 },
      { x: 131, y: 0 },
      { x: 219, y: -136 },
      { x: 353, y: -136 },
    ],
  },
  {
    id: 'step_l_diagonal_short',
    label: '段付き斜めL字（短）',
    points: [
      { x: 0, y: -322 },
      { x: 0, y: 0 },
      { x: 98, y: -116 },
      { x: 277, y: -117 },
    ],
  },
  {
    id: 'vertical_diagonal',
    label: '縦＋斜め',
    points: [
      { x: 0, y: -325 },
      { x: 0, y: 0 },
      { x: 155, y: -145 },
    ],
  },
  {
    id: 'straight',
    label: '直線',
    points: [
      { x: 0, y: -300 },
      { x: 0, y: 0 },
    ],
  },
  {
    id: 'corner_l',
    label: 'L字',
    points: [
      { x: 0, y: -300 },
      { x: 0, y: 0 },
      { x: 240, y: 0 },
    ],
  },
  {
    id: 't_up',
    label: 'T字（中央立ち上がり）',
    points: [
      { x: 0, y: 0 },
      { x: 140, y: 0 },
      { x: 280, y: 0 },
      { x: 140, y: -260 },
    ],
    segments: [
      [0, 1],
      [1, 2],
      [1, 3],
    ],
  },
  {
    id: 'trapezoid',
    label: '台形（段差）',
    points: [
      { x: 0, y: -95 },
      { x: 70, y: -95 },
      { x: 115, y: 0 },
      { x: 195, y: 0 },
      { x: 240, y: -95 },
      { x: 310, y: -95 },
    ],
  },
  {
    id: 'u_shape',
    label: 'コの字（U字）',
    points: [
      { x: 0, y: -320 },
      { x: 0, y: 0 },
      { x: 250, y: 0 },
      { x: 250, y: -320 },
    ],
  },
  {
    id: 'rect_closed',
    label: '口形（閉合）',
    points: [
      { x: 0, y: -300 },
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: -300 },
    ],
    closed: true,
  },
]

export function shapePresetBounds(preset: ShapePresetDef): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const xs = preset.points.map((p) => p.x)
  const ys = preset.points.map((p) => p.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

/** 実際に線を張る点の組み合わせ。segments 省略時は points を順番に結ぶ */
export function shapePresetSegments(preset: ShapePresetDef): Array<[number, number]> {
  if (preset.segments) return preset.segments
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < preset.points.length - 1; i += 1) pairs.push([i, i + 1])
  if (preset.closed && preset.points.length > 2) pairs.push([preset.points.length - 1, 0])
  return pairs
}

/** パレットのサムネイル用に、指定サイズの箱へ収まる座標へ変換する */
export function shapePresetThumbPoints(
  preset: ShapePresetDef,
  boxW: number,
  boxH: number,
  pad = 4,
): Array<{ x: number; y: number }> {
  const b = shapePresetBounds(preset)
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const scale = Math.min((boxW - pad * 2) / w, (boxH - pad * 2) / h)
  const offsetX = (boxW - w * scale) / 2
  const offsetY = (boxH - h * scale) / 2
  return preset.points.map((p) => ({
    x: offsetX + (p.x - b.minX) * scale,
    y: offsetY + (p.y - b.minY) * scale,
  }))
}

/** パレットのサムネイル用 SVG path。枝分かれ形状も 1 本の d で描ける */
export function shapePresetThumbPath(
  preset: ShapePresetDef,
  boxW: number,
  boxH: number,
  pad = 4,
): string {
  const pts = shapePresetThumbPoints(preset, boxW, boxH, pad)
  return shapePresetSegments(preset)
    .map(([a, b]) => `M${pts[a].x} ${pts[a].y} L${pts[b].x} ${pts[b].y}`)
    .join(' ')
}
