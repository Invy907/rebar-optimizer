/**
 * 線分（鉄筋）の表示色。各色ごとに円番号は独立して採番されます。
 */
export const SEGMENT_COLOR_DEFINITIONS = [
  { id: 'red', labelJa: '赤', stroke: '#ef4444', strokeSelected: '#b91c1c', tint: '#fef2f2' },
  { id: 'blue', labelJa: '青', stroke: '#2563eb', strokeSelected: '#1d4ed8', tint: '#eff6ff' },
  { id: 'emerald', labelJa: '緑', stroke: '#059669', strokeSelected: '#047857', tint: '#ecfdf5' },
  { id: 'amber', labelJa: '橙', stroke: '#d97706', strokeSelected: '#b45309', tint: '#fffbeb' },
  { id: 'violet', labelJa: '紫', stroke: '#7c3aed', strokeSelected: '#6d28d9', tint: '#f5f3ff' },
  { id: 'pink', labelJa: '桃', stroke: '#db2777', strokeSelected: '#be185d', tint: '#fdf2f8' },
  { id: 'cyan', labelJa: '水', stroke: '#0891b2', strokeSelected: '#0e7490', tint: '#ecfeff' },
  { id: 'lime', labelJa: '黄緑', stroke: '#65a30d', strokeSelected: '#4d7c0f', tint: '#f7fee7' },
  { id: 'slate', labelJa: '灰', stroke: '#475569', strokeSelected: '#334155', tint: '#f1f5f9' },
  { id: 'fuchsia', labelJa: 'マゼンタ', stroke: '#c026d3', strokeSelected: '#a21caf', tint: '#fdf4ff' },
  { id: 'rose', labelJa: '紅', stroke: '#e11d48', strokeSelected: '#be123c', tint: '#fff1f2' },
  { id: 'sky', labelJa: '空', stroke: '#0284c7', strokeSelected: '#0369a1', tint: '#f0f9ff' },
  { id: 'teal', labelJa: '青緑', stroke: '#0d9488', strokeSelected: '#0f766e', tint: '#f0fdfa' },
  { id: 'yellow', labelJa: '黄', stroke: '#ca8a04', strokeSelected: '#a16207', tint: '#fefce8' },
  { id: 'indigo', labelJa: '藍', stroke: '#4f46e5', strokeSelected: '#4338ca', tint: '#eef2ff' },
  { id: 'stone', labelJa: '石', stroke: '#57534e', strokeSelected: '#44403c', tint: '#fafaf9' },
  { id: 'brown', labelJa: '茶', stroke: '#92400e', strokeSelected: '#78350f', tint: '#fffbeb' },
  { id: 'black', labelJa: '黒', stroke: '#111827', strokeSelected: '#030712', tint: '#f9fafb' },
  { id: 'navy', labelJa: '紺', stroke: '#1e3a8a', strokeSelected: '#1e40af', tint: '#eff6ff' },
  { id: 'coral', labelJa: '珊瑚', stroke: '#f97316', strokeSelected: '#ea580c', tint: '#fff7ed' },
] as const

export type SegmentColor = (typeof SEGMENT_COLOR_DEFINITIONS)[number]['id']

export const SEGMENT_COLOR_ORDER: SegmentColor[] = SEGMENT_COLOR_DEFINITIONS.map(
  (d) => d.id,
)

const SEGMENT_COLOR_SET = new Set<string>(SEGMENT_COLOR_ORDER)

export function isSegmentColor(value: unknown): value is SegmentColor {
  return typeof value === 'string' && SEGMENT_COLOR_SET.has(value)
}

/** 不正な値は赤にフォールバック */
export function normalizeSegmentColor(value: unknown): SegmentColor {
  return isSegmentColor(value) ? value : 'red'
}

export function getSegmentColorLabelJa(color: SegmentColor): string {
  const d = SEGMENT_COLOR_DEFINITIONS.find((x) => x.id === color)
  return d?.labelJa ?? color
}

export function getSegmentStrokeHex(
  color: SegmentColor,
  selected: boolean,
): string {
  const d = SEGMENT_COLOR_DEFINITIONS.find((x) => x.id === color)
  if (!d) return selected ? '#b91c1c' : '#ef4444'
  return selected ? d.strokeSelected : d.stroke
}

export function getSegmentCardTint(color: SegmentColor): string {
  const d = SEGMENT_COLOR_DEFINITIONS.find((x) => x.id === color)
  return d?.tint ?? '#f8fafc'
}

/** 表示順（円サマリ・入力サマリなど） */
export function compareSegmentColorOrder(a: SegmentColor, b: SegmentColor): number {
  return SEGMENT_COLOR_ORDER.indexOf(a) - SEGMENT_COLOR_ORDER.indexOf(b)
}
