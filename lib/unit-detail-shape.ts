import type { ExtendedShapeType } from '@/lib/unit-types'

export type DetailShapeTemplate =
  | 'straight'
  | 'corner_L'
  | 'corner_T'
  | 'cross'
  | 'corner_out'
  | 'corner_in'
  | 'opening'
  | 'joint'
  | 'mesh'

export interface UnitDetailSpec {
  pitch: number
  leftHeight: number
  rightHeight: number
  topHorizontalLength: number
  bottomLeftLength: number
  bottomRightLength: number
  centerBentLength: number
  centerVerticalOffset: number
}

export interface UnitDetailGeometry {
  templateType: DetailShapeTemplate
  points: Array<{ key: string; x: number; y: number }>
  segments: Array<{ from: string; to: string }>
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

export interface ShapeHandle {
  key: string
  x: number
  y: number
  dimKey: keyof UnitDetailSpec
  axis: 'x' | 'y'
}

export interface ShapeSketch {
  geometry: UnitDetailGeometry
  handles: ShapeHandle[]
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function shapeTypeToDetailTemplate(shapeType: ExtendedShapeType): DetailShapeTemplate {
  switch (shapeType) {
    case 'straight':
    case 'corner_L':
    case 'corner_T':
    case 'cross':
    case 'corner_out':
    case 'corner_in':
    case 'opening':
    case 'joint':
    case 'mesh':
      return shapeType
    default:
      return 'straight'
  }
}

export function getDefaultDetailSpec(template: DetailShapeTemplate): UnitDetailSpec {
  const base: UnitDetailSpec = {
    pitch: 200,
    leftHeight: 350,
    rightHeight: 350,
    topHorizontalLength: 900,
    bottomLeftLength: 300,
    bottomRightLength: 300,
    centerBentLength: 450,
    centerVerticalOffset: 250,
  }
  if (template === 'straight') {
    base.leftHeight = 0
    base.rightHeight = 0
  }
  if (template === 'corner_out' || template === 'corner_in') {
    base.topHorizontalLength = 650
    base.leftHeight = 450
  }
  if (template === 'corner_T') {
    base.topHorizontalLength = 900
    base.centerBentLength = 320
    base.centerVerticalOffset = 280
  }
  if (template === 'cross') {
    base.topHorizontalLength = 800
    base.centerBentLength = 300
    base.centerVerticalOffset = 220
  }
  return base
}

export function normalizeDetailSpec(input: Partial<UnitDetailSpec> | null | undefined): UnitDetailSpec {
  const d = input ?? {}
  return {
    pitch: clamp(Math.round(d.pitch ?? 200), 1, 10000),
    leftHeight: clamp(Math.round(d.leftHeight ?? 350), 0, 10000),
    rightHeight: clamp(Math.round(d.rightHeight ?? 350), 0, 10000),
    topHorizontalLength: clamp(Math.round(d.topHorizontalLength ?? 900), 1, 10000),
    bottomLeftLength: clamp(Math.round(d.bottomLeftLength ?? 300), 0, 10000),
    bottomRightLength: clamp(Math.round(d.bottomRightLength ?? 300), 0, 10000),
    centerBentLength: clamp(Math.round(d.centerBentLength ?? 450), 0, 10000),
    centerVerticalOffset: clamp(Math.round(d.centerVerticalOffset ?? 250), 0, 10000),
  }
}

export function normalizeDetailSpecForTemplate(
  template: DetailShapeTemplate,
  input: Partial<UnitDetailSpec> | null | undefined,
): UnitDetailSpec {
  const n = normalizeDetailSpec(input)
  if (template === 'straight') {
    return {
      ...n,
      leftHeight: 0,
      rightHeight: 0,
      bottomLeftLength: 0,
      bottomRightLength: 0,
      centerBentLength: 0,
      centerVerticalOffset: 0,
    }
  }
  if (template === 'corner_L' || template === 'corner_out' || template === 'corner_in') {
    return {
      ...n,
      rightHeight: 0,
      centerBentLength: 0,
      centerVerticalOffset: 0,
    }
  }
  if (template === 'corner_T') {
    return {
      ...n,
      leftHeight: 0,
      rightHeight: 0,
      bottomLeftLength: 0,
      bottomRightLength: 0,
    }
  }
  if (template === 'cross') {
    return {
      ...n,
      leftHeight: 0,
      rightHeight: 0,
      bottomLeftLength: 0,
      bottomRightLength: 0,
    }
  }
  if (template === 'opening') {
    return {
      ...n,
      rightHeight: 0,
      bottomLeftLength: 0,
      bottomRightLength: 0,
      centerBentLength: 0,
      centerVerticalOffset: 0,
    }
  }
  if (template === 'joint') {
    return {
      ...n,
      leftHeight: 0,
      rightHeight: 0,
      bottomLeftLength: 0,
      bottomRightLength: 0,
      centerVerticalOffset: 0,
    }
  }
  // mesh
  return {
    ...n,
    rightHeight: 0,
    bottomLeftLength: 0,
    bottomRightLength: 0,
    centerVerticalOffset: 0,
  }
}

function boundsFromPoints(points: Array<{ key: string; x: number; y: number }>) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

export function buildShapeSketch(template: DetailShapeTemplate, rawSpec: UnitDetailSpec): ShapeSketch {
  const spec = normalizeDetailSpec(rawSpec)
  if (template === 'straight') {
    const points = [
      { key: 's0', x: 0, y: 0 },
      { key: 's1', x: spec.topHorizontalLength, y: 0 },
    ]
    return {
      geometry: {
        templateType: template,
        points,
        segments: [{ from: 's0', to: 's1' }],
        bounds: boundsFromPoints(points),
      },
      handles: [{ key: 'h-length', x: spec.topHorizontalLength, y: 0, dimKey: 'topHorizontalLength', axis: 'x' }],
    }
  }

  if (template === 'corner_L' || template === 'corner_out' || template === 'corner_in') {
    const points = [
      { key: 'c0', x: 0, y: 0 },
      { key: 'c1', x: 0, y: -spec.leftHeight },
      { key: 'c2', x: spec.topHorizontalLength, y: -spec.leftHeight },
    ]
    return {
      geometry: {
        templateType: template,
        points,
        segments: [
          { from: 'c0', to: 'c1' },
          { from: 'c1', to: 'c2' },
        ],
        bounds: boundsFromPoints(points),
      },
      handles: [
        { key: 'h-lh', x: 0, y: -spec.leftHeight, dimKey: 'leftHeight', axis: 'y' },
        { key: 'h-top', x: spec.topHorizontalLength, y: -spec.leftHeight, dimKey: 'topHorizontalLength', axis: 'x' },
      ],
    }
  }

  if (template === 'corner_T') {
    const halfTop = spec.topHorizontalLength / 2
    const points = [
      { key: 'tL', x: -halfTop, y: 0 },
      { key: 'tR', x: halfTop, y: 0 },
      { key: 'tC', x: 0, y: 0 },
      { key: 'tD', x: 0, y: spec.centerVerticalOffset + spec.centerBentLength },
    ]
    return {
      geometry: {
        templateType: template,
        points,
        segments: [
          { from: 'tL', to: 'tR' },
          { from: 'tC', to: 'tD' },
        ],
        bounds: boundsFromPoints(points),
      },
      handles: [
        { key: 'h-top', x: halfTop, y: 0, dimKey: 'topHorizontalLength', axis: 'x' },
        { key: 'h-stem', x: 0, y: spec.centerVerticalOffset + spec.centerBentLength, dimKey: 'centerBentLength', axis: 'y' },
      ],
    }
  }

  if (template === 'opening') {
    const w = Math.max(300, spec.topHorizontalLength)
    const h = Math.max(220, spec.leftHeight || 220)
    const points = [
      { key: 'o0', x: -w / 2, y: -h / 2 },
      { key: 'o1', x: w / 2, y: -h / 2 },
      { key: 'o2', x: w / 2, y: h / 2 },
      { key: 'o3', x: -w / 2, y: h / 2 },
    ]
    return {
      geometry: {
        templateType: template,
        points,
        segments: [
          { from: 'o0', to: 'o1' },
          { from: 'o1', to: 'o2' },
          { from: 'o2', to: 'o3' },
          { from: 'o3', to: 'o0' },
        ],
        bounds: boundsFromPoints(points),
      },
      handles: [
        { key: 'h-w', x: w / 2, y: -h / 2, dimKey: 'topHorizontalLength', axis: 'x' },
        { key: 'h-h', x: -w / 2, y: -h / 2, dimKey: 'leftHeight', axis: 'y' },
      ],
    }
  }

  if (template === 'joint') {
    const stem = Math.max(220, spec.centerBentLength)
    const top = Math.max(260, spec.topHorizontalLength)
    const points = [
      { key: 'j0', x: -top / 2, y: 0 },
      { key: 'j1', x: top / 2, y: 0 },
      { key: 'j2', x: 0, y: 0 },
      { key: 'j3', x: 0, y: stem },
    ]
    return {
      geometry: {
        templateType: template,
        points,
        segments: [
          { from: 'j0', to: 'j1' },
          { from: 'j2', to: 'j3' },
        ],
        bounds: boundsFromPoints(points),
      },
      handles: [
        { key: 'h-top', x: top / 2, y: 0, dimKey: 'topHorizontalLength', axis: 'x' },
        { key: 'h-stem', x: 0, y: stem, dimKey: 'centerBentLength', axis: 'y' },
      ],
    }
  }

  if (template === 'mesh') {
    const w = Math.max(280, spec.topHorizontalLength)
    const h = Math.max(180, spec.leftHeight || 180)
    const cols = 3
    const rows = 2
    const points: Array<{ key: string; x: number; y: number }> = []
    const segments: Array<{ from: string; to: string }> = []
    for (let c = 0; c <= cols; c++) {
      const x = -w / 2 + (w / cols) * c
      points.push({ key: `mv${c}a`, x, y: -h / 2 })
      points.push({ key: `mv${c}b`, x, y: h / 2 })
      segments.push({ from: `mv${c}a`, to: `mv${c}b` })
    }
    for (let r = 0; r <= rows; r++) {
      const y = -h / 2 + (h / rows) * r
      points.push({ key: `mh${r}a`, x: -w / 2, y })
      points.push({ key: `mh${r}b`, x: w / 2, y })
      segments.push({ from: `mh${r}a`, to: `mh${r}b` })
    }
    return {
      geometry: {
        templateType: template,
        points,
        segments,
        bounds: boundsFromPoints(points),
      },
      handles: [
        { key: 'h-w', x: w / 2, y: -h / 2, dimKey: 'topHorizontalLength', axis: 'x' },
        { key: 'h-h', x: -w / 2, y: -h / 2, dimKey: 'leftHeight', axis: 'y' },
        { key: 'h-p', x: w / 2, y: h / 2, dimKey: 'pitch', axis: 'x' },
      ],
    }
  }

  const halfTop = spec.topHorizontalLength / 2
  const points = [
    { key: 'xL', x: -halfTop, y: 0 },
    { key: 'xR', x: halfTop, y: 0 },
    { key: 'xT', x: 0, y: -(spec.centerVerticalOffset + spec.centerBentLength) },
    { key: 'xB', x: 0, y: spec.centerVerticalOffset + spec.centerBentLength },
  ]
  return {
    geometry: {
      templateType: template === 'cross' ? 'cross' : 'cross',
      points,
      segments: [
        { from: 'xL', to: 'xR' },
        { from: 'xT', to: 'xB' },
      ],
      bounds: boundsFromPoints(points),
    },
    handles: [
      { key: 'h-top', x: halfTop, y: 0, dimKey: 'topHorizontalLength', axis: 'x' },
      { key: 'h-v', x: 0, y: spec.centerVerticalOffset + spec.centerBentLength, dimKey: 'centerBentLength', axis: 'y' },
    ],
  }
}
