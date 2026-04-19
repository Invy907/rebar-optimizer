/**
 * 自動配置エンジン。
 *
 * ワークフロー (アルゴリズムの手順に対応):
 *   Step 3: ノードを分類（corner / T / cross / end）
 *   Step 4-5: 特殊ノードに L/コ/T ユニットを先行配置 → 消費長さを控除
 *   Step 6-8: 直線ランを variant 組合せで充填
 *   Step 9-10: 集計 + 検証
 */

import type { Unit } from '@/lib/types/database'
import type {
  FoundationGraph,
  FoundationNode,
  FoundationRun,
  PlacementItem,
  PlacementResult,
  CombinationResult,
  StraightVariantOption,
  SegmentAssignment,
} from '@/lib/types/foundation-plan'
import type { SegmentColor } from '@/lib/segment-colors'
import { findBestCombinations } from '@/lib/variant-combination'

// ─── 形状タイプごとの消費ルール ──────────────────────────

type ShapeCategory = 'straight' | 'corner' | 'T_junction' | 'cross' | 'other'

const SHAPE_CATEGORIES: Record<string, ShapeCategory> = {
  straight: 'straight',
  corner_L: 'corner',
  corner_out: 'corner',
  corner_in: 'corner',
  corner_T: 'T_junction',
  cross: 'cross',
  opening: 'other',
  joint: 'other',
  mesh: 'other',
}

function shapeCategory(unit: Unit): ShapeCategory {
  return SHAPE_CATEGORIES[unit.shape_type] ?? 'other'
}

/** 特殊ユニットがランから消費する長さを推定 (mm) */
function estimateConsumedLength(unit: Unit): { legA: number; legB: number } {
  const spec = unit.detail_spec
  if (!spec) {
    const half = Math.round((unit.length_mm ?? 0) / 2)
    return { legA: half, legB: half }
  }

  const cat = shapeCategory(unit)

  if (cat === 'corner') {
    const a = spec.leftHeight ?? spec.topHorizontalLength ?? 150
    const b = spec.topHorizontalLength ?? spec.leftHeight ?? 150
    return { legA: a, legB: b }
  }

  if (cat === 'T_junction') {
    const through = spec.topHorizontalLength ?? 200
    const branch = spec.leftHeight ?? 150
    return { legA: through, legB: branch }
  }

  const half = Math.round((unit.length_mm ?? 0) / 2)
  return { legA: half, legB: half }
}

// ─── メインエンジン ──────────────────────────────────────

export interface PlacementEngineOptions {
  /** 組合せソルバーの最大ピース数 */
  maxPiecesPerRun?: number
  /** 許容端数 (mm) */
  toleranceMm?: number
}

/**
 * 自動配置を実行する。
 *
 * @param graph - buildFoundationGraph で構築したグラフ
 * @param units - 利用可能なユニットライブラリ
 * @param opts  - 配置オプション
 */
export function autoPlace(
  graph: FoundationGraph,
  units: Unit[],
  opts?: PlacementEngineOptions,
): PlacementResult {
  const activeUnits = units.filter((u) => u.is_active !== false)
  const placements: PlacementItem[] = []
  const warnings: string[] = []
  const remainders: { runId: string; remainingMm: number }[] = []
  const runCombinations = new Map<string, CombinationResult>()

  /** ラン別の残長 (特殊ユニット配置で減る) */
  const runRemainingMm = new Map<string, number>()
  for (const run of graph.runs) {
    runRemainingMm.set(run.id, run.lengthMm)
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const runById = new Map(graph.runs.map((r) => [r.id, r]))

  // ── Step 4-5: 特殊ノードに特殊ユニットを配置 ──────────

  const specialNodes = graph.nodes.filter(
    (n) => n.type === 'corner' || n.type === 'T' || n.type === 'cross',
  )

  for (const node of specialNodes) {
    const connectedRuns = node.connectedRunIds
      .map((rid) => runById.get(rid))
      .filter((r): r is FoundationRun => !!r)

    if (connectedRuns.length === 0) continue

    const dominantColor = getDominantColor(connectedRuns)
    const familyId = connectedRuns[0]?.assignedFamilyId ?? null

    const targetCategory: ShapeCategory =
      node.type === 'corner' ? 'corner' :
      node.type === 'T' ? 'T_junction' :
      'cross'

    const candidates = activeUnits.filter((u) => {
      if (shapeCategory(u) !== targetCategory) return false
      if (familyId && u.template_id !== familyId) return false
      if (!familyId && u.color !== dominantColor) return false
      return true
    })

    if (candidates.length === 0) {
      warnings.push(
        `ノード(${Math.round(node.x)},${Math.round(node.y)})に適合する${node.type}型ユニットが見つかりません`,
      )
      continue
    }

    const chosen = candidates[0]!
    const consumed = estimateConsumedLength(chosen)

    const placement: PlacementItem = {
      id: nextPlacementId(),
      runId: null,
      nodeId: node.id,
      unitId: chosen.id,
      position: { x: node.x, y: node.y },
      rotation: 0,
      mirrored: false,
    }
    placements.push(placement)

    // 接続ランから消費長さを引く
    for (let i = 0; i < connectedRuns.length; i++) {
      const run = connectedRuns[i]!
      const leg = i === 0 ? consumed.legA : consumed.legB
      const cur = runRemainingMm.get(run.id) ?? run.lengthMm
      runRemainingMm.set(run.id, Math.max(0, cur - leg))
    }
  }

  // ── Step 6-8: 直線ランを variant 組合せで充填 ──────────

  for (const run of graph.runs) {
    const remaining = runRemainingMm.get(run.id) ?? run.lengthMm
    if (remaining <= 0) continue

    const familyId = run.assignedFamilyId
    const color = run.assignedColor

    const straightVariants = buildStraightVariantList(activeUnits, familyId, color)

    if (straightVariants.length === 0) {
      warnings.push(
        `ラン(${run.id}, ${remaining}mm)に使える直線 variant がありません`,
      )
      remainders.push({ runId: run.id, remainingMm: remaining })
      continue
    }

    const combos = findBestCombinations(remaining, straightVariants, {
      maxPieces: opts?.maxPiecesPerRun ?? 8,
      toleranceMm: opts?.toleranceMm ?? 0,
      maxResults: 3,
    })

    if (combos.length === 0) {
      warnings.push(
        `ラン(${run.id}, ${remaining}mm)を充填できる組合せが見つかりません`,
      )
      remainders.push({ runId: run.id, remainingMm: remaining })
      continue
    }

    const best = combos[0]!
    runCombinations.set(run.id, best)

    if (best.remainderMm > 0) {
      remainders.push({ runId: run.id, remainingMm: best.remainderMm })
      if (best.remainderMm > 50) {
        warnings.push(
          `ラン(${run.id})に ${best.remainderMm}mm の端数が残ります`,
        )
      }
    }

    // ラン上に variant を配置
    const fromNode = nodeById.get(run.fromNodeId)
    const toNode = nodeById.get(run.toNodeId)
    if (!fromNode || !toNode) continue

    const dx = toNode.x - fromNode.x
    const dy = toNode.y - fromNode.y
    const totalPx = Math.hypot(dx, dy) || 1
    const ux = dx / totalPx
    const uy = dy / totalPx
    const rotation = (Math.atan2(dy, dx) * 180) / Math.PI

    let offsetMm = 0
    for (const v of best.variants) {
      for (let i = 0; i < v.count; i++) {
        const startFraction = offsetMm / (remaining || 1)
        const endFraction = (offsetMm + v.lengthMm) / (remaining || 1)
        const midFraction = (startFraction + endFraction) / 2

        const px = fromNode.x + ux * totalPx * midFraction
        const py = fromNode.y + uy * totalPx * midFraction

        placements.push({
          id: nextPlacementId(),
          runId: run.id,
          nodeId: null,
          unitId: v.unitId,
          position: { x: px, y: py },
          rotation,
          mirrored: false,
        })

        offsetMm += v.lengthMm
      }
    }
  }

  // ── Step 9-10: 集計 + 検証 ────────────────────────────

  const summary = buildSummary(placements, activeUnits)
  const validationWarnings = validate(graph, placements, runCombinations)
  warnings.push(...validationWarnings)

  return {
    placements,
    summary,
    remainders,
    warnings,
    runCombinations,
  }
}

// ─── SegmentAssignment 変換 ──────────────────────────────

/**
 * PlacementResult を既存 DrawingSegment への割当マップに変換する。
 * ラン上の配置結果を、元の sourceSegmentIds に紐づける。
 */
export function placementToSegmentAssignments(
  result: PlacementResult,
  graph: FoundationGraph,
  units: Unit[],
): SegmentAssignment[] {
  const assignments: SegmentAssignment[] = []
  const unitById = new Map(units.map((u) => [u.id, u]))
  const runById = new Map(graph.runs.map((r) => [r.id, r]))

  for (const p of result.placements) {
    if (!p.runId) continue
    const run = runById.get(p.runId)
    if (!run) continue
    const unit = unitById.get(p.unitId)
    if (!unit) continue

    for (const segId of run.sourceSegmentIds) {
      if (assignments.some((a) => a.segmentId === segId)) continue
      assignments.push({
        segmentId: segId,
        unitId: unit.id,
        unitCode: unit.code,
        unitName: unit.name,
        markNumber: unit.mark_number,
        color: unit.color,
      })
    }
  }

  return assignments
}

// ─── internal helpers ────────────────────────────────────

let _placementSeq = 0
function nextPlacementId(): string {
  return `pl-${++_placementSeq}-${Date.now().toString(36)}`
}

function getDominantColor(runs: FoundationRun[]): SegmentColor {
  const counts = new Map<SegmentColor, number>()
  for (const r of runs) {
    if (r.assignedColor) {
      counts.set(r.assignedColor, (counts.get(r.assignedColor) ?? 0) + 1)
    }
  }
  let best: SegmentColor = 'red'
  let bestCount = 0
  for (const [color, count] of counts) {
    if (count > bestCount) {
      best = color
      bestCount = count
    }
  }
  return best
}

function buildStraightVariantList(
  units: Unit[],
  familyId: string | null,
  color: SegmentColor | null,
): StraightVariantOption[] {
  return units
    .filter((u) => {
      if (shapeCategory(u) !== 'straight') return false
      if (familyId && u.template_id !== familyId) return false
      if (!familyId && color && u.color !== color) return false
      if (!u.length_mm || u.length_mm <= 0) return false
      return true
    })
    .map((u) => ({
      unitId: u.id,
      lengthMm: u.length_mm!,
      markNumber: u.mark_number,
      priority: u.mark_number ?? 99,
    }))
    .sort((a, b) => b.lengthMm - a.lengthMm)
}

function buildSummary(
  placements: PlacementItem[],
  units: Unit[],
): PlacementResult['summary'] {
  const unitById = new Map(units.map((u) => [u.id, u]))
  const counts = new Map<string, number>()
  for (const p of placements) {
    counts.set(p.unitId, (counts.get(p.unitId) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([unitId, count]) => {
      const u = unitById.get(unitId)
      return {
        unitId,
        unitName: u?.name ?? unitId,
        markNumber: u?.mark_number ?? null,
        count,
        color: (u?.color ?? 'red') as SegmentColor,
      }
    })
    .sort((a, b) => {
      if (a.color !== b.color) return a.color.localeCompare(b.color)
      const am = a.markNumber ?? 999
      const bm = b.markNumber ?? 999
      return am - bm
    })
}

function validate(
  graph: FoundationGraph,
  placements: PlacementItem[],
  runCombinations: Map<string, CombinationResult>,
): string[] {
  const warnings: string[] = []

  // 充填率チェック
  let totalTarget = 0
  let totalFilled = 0
  for (const run of graph.runs) {
    totalTarget += run.lengthMm
    const combo = runCombinations.get(run.id)
    if (combo) totalFilled += combo.totalMm
  }
  if (totalTarget > 0) {
    const ratio = totalFilled / totalTarget
    if (ratio < 0.9) {
      warnings.push(
        `全体充填率が ${(ratio * 100).toFixed(1)}% です（90%未満）`,
      )
    }
  }

  // 配置のないランをチェック
  const runIdsWithPlacements = new Set(
    placements.filter((p) => p.runId).map((p) => p.runId!),
  )
  for (const run of graph.runs) {
    if (!runIdsWithPlacements.has(run.id) && run.lengthMm > 100) {
      warnings.push(
        `ラン(${run.id}, ${run.lengthMm}mm)にユニットが配置されていません`,
      )
    }
  }

  return warnings
}
