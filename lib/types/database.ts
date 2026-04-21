import type { SegmentColor } from '@/lib/segment-colors'
import type { ExtendedShapeType, LocationType, UnitBar } from '@/lib/unit-types'
import type { UnitDetailGeometry, UnitDetailSpec } from '@/lib/unit-detail-shape'

export interface Project {
  id: string
  user_id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface Drawing {
  id: string
  project_id: string
  file_name: string
  file_path: string
  file_type: 'pdf' | 'png' | 'jpg' | 'jpeg'
  page_count: number
  created_at: string
}

export interface DrawingSegment {
  id: string
  drawing_id: string
  page_no: number
  x1: number
  y1: number
  x2: number
  y2: number
  label: string | null
  length_mm: number
  quantity: number
  bar_type: string
  memo: string | null
  /** 割当ユニット（マスタ参照）。設定時は表示はユニット定義を優先 */
  unit_id?: string | null
  /** キャッシュ（ユニット欠落時のフォールバック用） */
  unit_code?: string | null
  unit_name?: string | null
  /** キャッシュ: マーク番号（円内表示）。ユニット解決時はユニット側を優先 */
  mark_number?: number | null
  created_at: string
}

export interface OptimizationRun {
  id: string
  project_id: string
  stock_length_mm: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  total_stock_count: number | null
  total_waste_mm: number | null
  waste_ratio: number | null
  created_at: string
}

export interface OptimizationResult {
  id: string
  run_id: string
  bar_type: string
  stock_index: number
  used_length_mm: number
  waste_mm: number
  created_at: string
}

export type UnitShapeType =
  | 'straight'
  | 'corner_L'
  | 'corner_T'
  | 'cross'
  | 'corner_out'
  | 'corner_in'
  | 'opening'
  | 'joint'
  | 'mesh'

export interface UnitBarItem {
  barType: string
  quantity: number
}

export interface UnitRebarLayoutItem {
  id: string
  x: number
  y: number
  diameter: string
  role?: string | null
  label?: string | null
}

export interface UnitRebarSpacingItem {
  id: string
  from?: string
  to?: string
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  label: string
  label_x?: number
  label_y?: number
}

export interface UnitRebarAnnotationItem {
  id: string
  x: number
  y: number
  text: string
}

export interface UnitRebarLayout {
  rebars: UnitRebarLayoutItem[]
  spacings: UnitRebarSpacingItem[]
  annotations: UnitRebarAnnotationItem[]
}

/** DB の units テーブル行。拡張フィールドは nullable で後方互換を維持 */
export interface Unit {
  id: string
  user_id: string
  name: string
  code: string | null
  location_type: LocationType | null
  shape_type: ExtendedShapeType
  color: SegmentColor
  mark_number: number | null
  bars: UnitBar[]
  spacing_mm: number | null
  pitch_mm?: number | null
  description: string | null
  is_active: boolean
  template_id: string | null
  /** 詳細形状パラメータ（MVPでは optional） */
  detail_spec?: UnitDetailSpec | null
  /** 詳細形状ジオメトリ（MVPでは optional） */
  detail_geometry?: UnitDetailGeometry | null
  /** 鉄筋配置レイヤー（MVPでは optional） */
  rebar_layout?: UnitRebarLayout | null
  /** Variant length used for auto matching on drawing page */
  length_mm?: number | null
  /** Optional notes for template-level data */
  notes?: string | null
  created_at: string
  updated_at: string
}

export interface LengthPresetGroupRow {
  id: string
  user_id: string
  name: string
  description: string | null
  lengths: number[]
  created_at: string
  updated_at: string
}

/** Shape template master (new normalized model) */
export interface UnitShapeTemplate {
  id: string
  user_id: string
  name: string
  location_type: LocationType | null
  shape_type: ExtendedShapeType
  detail_spec?: UnitDetailSpec | null
  detail_geometry?: UnitDetailGeometry | null
  rebar_layout_default?: UnitRebarLayout | null
  bars_default?: UnitBar[] | null
  spacing_mm_default?: number | null
  notes?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Variant master (new normalized model) */
export interface UnitVariant {
  id: string
  user_id: string
  template_id: string
  color: SegmentColor
  length_mm: number | null
  mark_number: number | null
  code: string | null
  name: string
  is_active: boolean
  bars_override?: UnitBar[] | null
  spacing_mm_override?: number | null
  rebar_layout_override?: UnitRebarLayout | null
  created_at: string
  updated_at: string
}

export interface ResolvedVariant {
  variantId: string
  templateId: string
  templateName: string
  color: SegmentColor
  lengthMm: number | null
  code: string | null
  markNumber: number | null
  unitName: string
  bars: UnitBar[]
  source: 'exact' | 'snapped' | 'candidate'
}

export interface OptimizationResultPiece {
  id: string
  result_id: string
  source_segment_id: string | null
  piece_length_mm: number
  sequence_no: number
  created_at: string
}
