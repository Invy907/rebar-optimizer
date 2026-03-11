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

export interface OptimizationResultPiece {
  id: string
  result_id: string
  source_segment_id: string | null
  piece_length_mm: number
  sequence_no: number
  created_at: string
}
