/**
 * 基礎配筋の自動配置アルゴリズム用データ型。
 *
 * ワークフロー:
 *   1. 図面の線分を「ノード＋ラン」グラフに変換
 *   2. ノード(コーナー/T接合/交差)に特殊ユニットを先行配置
 *   3. 残った直線ランを variant 組合せで充填
 *   4. 配置結果を集計・検証
 */

import type { SegmentColor } from '@/lib/segment-colors'

// ─── Foundation Graph ────────────────────────────────────

/** グラフ上の結節点。線分の端点が近接する箇所を1つにまとめたもの */
export interface FoundationNode {
  id: string
  x: number
  y: number
  /** 接続するランの数と角度から自動分類 */
  type: 'end' | 'corner' | 'T' | 'cross'
  /** コーナーの場合、二辺のなす角(deg)。90±tolerance で直角とみなす */
  angleDeg: number | null
  connectedRunIds: string[]
}

/** ノード間を結ぶ直線区間 */
export interface FoundationRun {
  id: string
  fromNodeId: string
  toNodeId: string
  /** 図面上のピクセル距離をスケーリングした値 (mm) */
  lengthMm: number
  /** この区間に割り当てるユニットパミリーID(= Unit.template_id) */
  assignedFamilyId: string | null
  /** 割当パミリーの色（表示用） */
  assignedColor: SegmentColor | null
  /** 元になった DrawingSegment.id の配列 */
  sourceSegmentIds: string[]
}

export interface FoundationGraph {
  nodes: FoundationNode[]
  runs: FoundationRun[]
}

// ─── Variant Combination Solver ──────────────────────────

/** 組合せソルバーの入力: パミリー内の直線variant候補 */
export interface StraightVariantOption {
  unitId: string
  lengthMm: number
  markNumber: number | null
  /** 低いほど優先（同長なら既定 variant を優先する等） */
  priority: number
}

/** 組合せソルバーの出力: 1 run 分の充填結果 */
export interface CombinationResult {
  variants: { unitId: string; lengthMm: number; count: number }[]
  totalMm: number
  remainderMm: number
  pieceCount: number
  /** 品質スコア (高いほど良い) */
  score: number
}

// ─── Placement ───────────────────────────────────────────

/** 個別の配置アイテム */
export interface PlacementItem {
  id: string
  /** ラン上の配置なら runId を持つ */
  runId: string | null
  /** ノード上の配置なら nodeId を持つ */
  nodeId: string | null
  /** 配置するユニット(variant) の Unit.id */
  unitId: string
  /** 配置の中心位置(図面座標) */
  position: { x: number; y: number }
  /** 回転角 (deg) */
  rotation: number
  mirrored: boolean
}

/** 自動配置エンジンの最終出力 */
export interface PlacementResult {
  placements: PlacementItem[]
  /** variant ごとの使用数 */
  summary: { unitId: string; unitName: string; markNumber: number | null; count: number; color: SegmentColor }[]
  /** 充填しきれなかったランの残り */
  remainders: { runId: string; remainingMm: number }[]
  /** 形状/長さ/接続の検証で見つかった警告 */
  warnings: string[]
  /** ラン→組合せ結果のマップ */
  runCombinations: Map<string, CombinationResult>
}

// ─── Segment Assignment (既存システムへの橋渡し) ─────────

/** 自動配置の結果を既存の DrawingSegment に反映するための変換結果 */
export interface SegmentAssignment {
  segmentId: string
  unitId: string
  unitCode: string | null
  unitName: string | null
  markNumber: number | null
  color: SegmentColor
}
