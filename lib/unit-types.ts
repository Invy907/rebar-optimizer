// lib/unit-types.ts

/**
 * ユニット管理の型定義・テンプレート・モックデータ
 *
 * ここが単一の「ユニットとは何か」の定義源です。
 * 図面 line から参照するときは unitId / unitCode / displayColor / markNumber を使います。
 */
import type { SegmentColor } from '@/lib/segment-colors'
import type { UnitShapeType } from '@/lib/types/database'

// ─── 位置分類 ───────────────────────────────────────────
export const LOCATION_TYPES = ['外周部', '内部', '立上り', 'ベース', 'その他'] as const
export type LocationType = (typeof LOCATION_TYPES)[number]

// ─── 形状タイプ（拡張版） ─────────────────────────────────
export const SHAPE_TYPE_DEFS = [
  { id: 'straight', label: 'ストレート（直線）', icon: '━' },
  { id: 'corner_L', label: 'L字コーナー', icon: '┘' },
  { id: 'corner_T', label: 'T字', icon: '┬' },
  { id: 'cross', label: '十字', icon: '┼' },
  { id: 'corner_out', label: '出隅コーナー', icon: '╗' },
  { id: 'corner_in', label: '入隅コーナー', icon: '╚' },
  { id: 'opening', label: '開口補強', icon: '⬡' },
  { id: 'joint', label: 'ジョイント', icon: '⊣' },
  { id: 'mesh', label: 'バーメッシュ', icon: '⋮' },
] as const

export type ExtendedShapeType = (typeof SHAPE_TYPE_DEFS)[number]['id']

export function getShapeLabel(id: string): string {
  return SHAPE_TYPE_DEFS.find((d) => d.id === id)?.label ?? id
}
export function getShapeIcon(id: string): string {
  return SHAPE_TYPE_DEFS.find((d) => d.id === id)?.icon ?? '━'
}

// ─── 鉄筋構成の1行 ─────────────────────────────────────
export interface UnitBar {
  diameter: string          // 'D10', 'D13', ...
  qtyPerUnit: number
  spacing?: number | null   // mm（任意）
  notes?: string | null
}

// ─── ユニット本体 ───────────────────────────────────────
export interface UnitDefinition {
  id: string
  code: string              // 例: 'red-1', 'outer-straight-1'
  name: string
  locationType: LocationType
  shapeType: ExtendedShapeType
  displayColor: SegmentColor
  markNumber: number        // 1, 2, 3...  図面の円番号
  bars: UnitBar[]
  spacingMm?: number | null
  notes?: string | null
  isActive: boolean
  templateId?: string | null
  // DB 用
  user_id?: string
  created_at?: string
  updated_at?: string
}

// ─── テンプレート定義 ───────────────────────────────────
export interface UnitTemplate {
  id: string
  name: string
  locationType: LocationType
  shapeType: ExtendedShapeType
  defaultColor: SegmentColor
  defaultBars: UnitBar[]
  defaultSpacingMm?: number
  description: string
}

export const UNIT_TEMPLATES: UnitTemplate[] = [
  {
    id: 'outer_standard',
    name: '外周部標準ユニット筋',
    locationType: '外周部',
    shapeType: 'straight',
    defaultColor: 'red',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 4 }, { diameter: 'D10', qtyPerUnit: 1 }],
    defaultSpacingMm: 200,
    description: '外周部に配置する標準直線ユニット',
  },
  {
    id: 'inner_standard',
    name: '内部標準ユニット筋',
    locationType: '内部',
    shapeType: 'straight',
    defaultColor: 'blue',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 2 }, { diameter: 'D10', qtyPerUnit: 1 }],
    defaultSpacingMm: 200,
    description: '内部に配置する標準直線ユニット',
  },
  {
    id: 'tachiari_standard',
    name: '立上り部分ユニット筋',
    locationType: '立上り',
    shapeType: 'straight',
    defaultColor: 'emerald',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 3 }, { diameter: 'D10', qtyPerUnit: 2 }],
    defaultSpacingMm: 200,
    description: '立上り部（布基礎壁体）用ユニット',
  },
  {
    id: 'base_standard',
    name: 'ベース部分ユニット筋',
    locationType: 'ベース',
    shapeType: 'straight',
    defaultColor: 'amber',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 3 }, { diameter: 'D10', qtyPerUnit: 2 }],
    defaultSpacingMm: 150,
    description: 'ベース筋（べた基礎・布基礎ベース）用ユニット',
  },
  {
    id: 'outer_straight',
    name: '外周部ストレート',
    locationType: '外周部',
    shapeType: 'straight',
    defaultColor: 'red',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 4 }, { diameter: 'D10', qtyPerUnit: 1 }],
    description: '外周部の直線配筋ユニット',
  },
  {
    id: 'inner_straight',
    name: '内部ストレート',
    locationType: '内部',
    shapeType: 'straight',
    defaultColor: 'blue',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 2 }, { diameter: 'D10', qtyPerUnit: 1 }],
    description: '内部の直線配筋ユニット',
  },
  {
    id: 'outer_corner_out',
    name: '外周部出隅コーナー',
    locationType: '外周部',
    shapeType: 'corner_out',
    defaultColor: 'red',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 3 }, { diameter: 'D10', qtyPerUnit: 1 }],
    description: '外周部の出隅（凸）コーナー用ユニット',
  },
  {
    id: 'outer_corner_in',
    name: '外周部入隅コーナー',
    locationType: '外周部',
    shapeType: 'corner_in',
    defaultColor: 'red',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 3 }, { diameter: 'D10', qtyPerUnit: 1 }],
    description: '外周部の入隅（凹）コーナー用ユニット',
  },
  {
    id: 'inner_T',
    name: '内部T字',
    locationType: '内部',
    shapeType: 'corner_T',
    defaultColor: 'blue',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 2 }, { diameter: 'D10', qtyPerUnit: 1 }],
    description: '内部のT字接合部用ユニット',
  },
  {
    id: 'inner_cross',
    name: '内部十字',
    locationType: '内部',
    shapeType: 'cross',
    defaultColor: 'blue',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 2 }, { diameter: 'D10', qtyPerUnit: 2 }],
    description: '内部の十字接合部用ユニット',
  },
  {
    id: 'opening_reinforce',
    name: '開口補強',
    locationType: 'その他',
    shapeType: 'opening',
    defaultColor: 'violet',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 2 }],
    description: '開口部周辺の補強ユニット',
  },
  {
    id: 'joint',
    name: 'ジョイント',
    locationType: 'その他',
    shapeType: 'joint',
    defaultColor: 'cyan',
    defaultBars: [{ diameter: 'D13', qtyPerUnit: 1 }],
    description: '接合用直線ジョイント',
  },
  {
    id: 'bar_mesh',
    name: 'バーメッシュ',
    locationType: 'ベース',
    shapeType: 'mesh',
    defaultColor: 'lime',
    defaultBars: [{ diameter: 'D10', qtyPerUnit: 4 }],
    defaultSpacingMm: 150,
    description: 'スラブ・ベース配筋用バーメッシュ',
  },
]

// 既定ユニットの投入は SQL シードのみ（アプリに埋め込まない）
// → supabase/seed-default-units.sql を参照

// ─── UnitDefinition → 旧Unit型 へのアダプタ (DB保存用) ────
export function unitDefToLegacyBars(bars: UnitBar[]): { barType: string; quantity: number }[] {
  return bars.map((b) => ({ barType: b.diameter, quantity: b.qtyPerUnit }))
}

// ─── コード自動生成 ────────────────────────────────────
export function generateUnitCode(
  color: SegmentColor,
  markNumber: number,
): string {
  return `${color}-${markNumber}`
}
