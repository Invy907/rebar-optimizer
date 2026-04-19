/**
 * 図面上の DrawingSegment 群を「ノード＋ラン」グラフに変換する。
 *
 * 1. 線分の端点を近接クラスタリングしてノードを生成
 * 2. ノード間を結ぶランを生成
 * 3. 同一直線上の連続ランをマージ
 * 4. ノードのタイプを接続数＋角度から分類
 */

import type { DrawingSegment, Unit } from '@/lib/types/database'
import type { FoundationGraph, FoundationNode, FoundationRun } from '@/lib/types/foundation-plan'
import { getSegmentColor, getSegmentEffectiveLengthMm } from '@/lib/segment-meta'
import type { SegmentColor } from '@/lib/segment-colors'

interface BuildGraphOptions {
  /** 端点をまとめる距離閾値 (px)。default: 15 */
  snapRadius?: number
  /** 同一直線とみなす角度閾値 (deg)。default: 10 */
  collinearThresholdDeg?: number
}

const DEFAULT_SNAP = 15
const DEFAULT_COLLINEAR = 10

let _idSeq = 0
function nextId(prefix: string): string {
  return `${prefix}-${++_idSeq}-${Date.now().toString(36)}`
}

/**
 * DrawingSegment[] → FoundationGraph
 *
 * spacing 線分は除外し、鉄筋線分のみ対象。
 */
export function buildFoundationGraph(
  segments: DrawingSegment[],
  units: Unit[],
  opts?: BuildGraphOptions,
): FoundationGraph {
  _idSeq = 0
  const snap = opts?.snapRadius ?? DEFAULT_SNAP
  const collinearDeg = opts?.collinearThresholdDeg ?? DEFAULT_COLLINEAR

  const rebarSegments = segments.filter(
    (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
  )

  if (rebarSegments.length === 0) return { nodes: [], runs: [] }

  // ── Step 1: 端点クラスタリング ──
  type RawEndpoint = { x: number; y: number; segId: string; end: 'from' | 'to' }
  const endpoints: RawEndpoint[] = []
  for (const seg of rebarSegments) {
    endpoints.push({ x: seg.x1, y: seg.y1, segId: seg.id, end: 'from' })
    endpoints.push({ x: seg.x2, y: seg.y2, segId: seg.id, end: 'to' })
  }

  const clusters: RawEndpoint[][] = []
  const assigned = new Set<number>()

  for (let i = 0; i < endpoints.length; i++) {
    if (assigned.has(i)) continue
    const cluster = [endpoints[i]!]
    assigned.add(i)
    for (let j = i + 1; j < endpoints.length; j++) {
      if (assigned.has(j)) continue
      if (dist(endpoints[i]!, endpoints[j]!) <= snap) {
        cluster.push(endpoints[j]!)
        assigned.add(j)
      }
    }
    clusters.push(cluster)
  }

  // ── Step 2: ノード生成 ──
  const nodeMap = new Map<string, FoundationNode>()
  const endpointToNodeId = new Map<string, string>()

  for (const cluster of clusters) {
    const cx = cluster.reduce((s, e) => s + e.x, 0) / cluster.length
    const cy = cluster.reduce((s, e) => s + e.y, 0) / cluster.length
    const nodeId = nextId('nd')
    nodeMap.set(nodeId, {
      id: nodeId,
      x: cx,
      y: cy,
      type: 'end',
      angleDeg: null,
      connectedRunIds: [],
    })
    for (const ep of cluster) {
      endpointToNodeId.set(`${ep.segId}:${ep.end}`, nodeId)
    }
  }

  // ── Step 3: ラン生成（各線分 → 1ラン） ──
  const rawRuns: FoundationRun[] = []
  for (const seg of rebarSegments) {
    const fromNode = endpointToNodeId.get(`${seg.id}:from`)
    const toNode = endpointToNodeId.get(`${seg.id}:to`)
    if (!fromNode || !toNode || fromNode === toNode) continue

    const color = getSegmentColor(seg, units) as SegmentColor
    const lengthMm = getSegmentEffectiveLengthMm(seg, units)

    rawRuns.push({
      id: nextId('rn'),
      fromNodeId: fromNode,
      toNodeId: toNode,
      lengthMm,
      assignedFamilyId: null,
      assignedColor: color,
      sourceSegmentIds: [seg.id],
    })
  }

  // ── Step 4: 同一ノード対のラン重複解消 ──
  const runsByPair = new Map<string, FoundationRun[]>()
  for (const run of rawRuns) {
    const key = [run.fromNodeId, run.toNodeId].sort().join('::')
    const arr = runsByPair.get(key) ?? []
    arr.push(run)
    runsByPair.set(key, arr)
  }

  const runs: FoundationRun[] = []
  for (const group of runsByPair.values()) {
    if (group.length === 1) {
      runs.push(group[0]!)
    } else {
      const merged: FoundationRun = {
        ...group[0]!,
        sourceSegmentIds: group.flatMap((r) => r.sourceSegmentIds),
      }
      runs.push(merged)
    }
  }

  // ── Step 5: ノードにランを紐付け + タイプ分類 ──
  for (const run of runs) {
    const fn = nodeMap.get(run.fromNodeId)
    const tn = nodeMap.get(run.toNodeId)
    if (fn && !fn.connectedRunIds.includes(run.id)) fn.connectedRunIds.push(run.id)
    if (tn && !tn.connectedRunIds.includes(run.id)) tn.connectedRunIds.push(run.id)
  }

  const runById = new Map(runs.map((r) => [r.id, r]))

  for (const node of nodeMap.values()) {
    classifyNode(node, runById, nodeMap, collinearDeg)
  }

  // ── Step 6: 同一直線上の連続ランをマージ ──
  mergeCollinearRuns(nodeMap, runs, runById, collinearDeg)

  return {
    nodes: Array.from(nodeMap.values()),
    runs,
  }
}

// ─── helpers ──────────────────────────────────────────────

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function angleBetweenRuns(
  node: FoundationNode,
  r1: FoundationRun,
  r2: FoundationRun,
  nodeMap: Map<string, FoundationNode>,
): number {
  function otherEnd(run: FoundationRun): FoundationNode | undefined {
    const otherId = run.fromNodeId === node.id ? run.toNodeId : run.fromNodeId
    return nodeMap.get(otherId)
  }

  const a = otherEnd(r1)
  const b = otherEnd(r2)
  if (!a || !b) return 180

  const dx1 = a.x - node.x
  const dy1 = a.y - node.y
  const dx2 = b.x - node.x
  const dy2 = b.y - node.y

  const dot = dx1 * dx2 + dy1 * dy2
  const cross = dx1 * dy2 - dy1 * dx2
  const angle = Math.atan2(Math.abs(cross), dot)
  return (angle * 180) / Math.PI
}

function classifyNode(
  node: FoundationNode,
  runById: Map<string, FoundationRun>,
  nodeMap: Map<string, FoundationNode>,
  collinearDeg: number,
): void {
  const degree = node.connectedRunIds.length

  if (degree <= 1) {
    node.type = 'end'
    return
  }

  if (degree === 2) {
    const r1 = runById.get(node.connectedRunIds[0]!)
    const r2 = runById.get(node.connectedRunIds[1]!)
    if (r1 && r2) {
      const angle = angleBetweenRuns(node, r1, r2, nodeMap)
      node.angleDeg = angle
      node.type = angle > 180 - collinearDeg ? 'end' : 'corner'
    }
    return
  }

  if (degree === 3) {
    node.type = 'T'
    return
  }

  node.type = 'cross'
}

/**
 * degree=2 かつ同一直線上のノードを除去し、ランを結合する。
 * 長い直線ランを正しく認識するために必要。
 */
function mergeCollinearRuns(
  nodeMap: Map<string, FoundationNode>,
  runs: FoundationRun[],
  runById: Map<string, FoundationRun>,
  collinearDeg: number,
): void {
  const toRemoveNodeIds = new Set<string>()

  for (const node of nodeMap.values()) {
    if (node.connectedRunIds.length !== 2) continue
    const r1 = runById.get(node.connectedRunIds[0]!)
    const r2 = runById.get(node.connectedRunIds[1]!)
    if (!r1 || !r2) continue

    const angle = angleBetweenRuns(node, r1, r2, nodeMap)
    if (angle < 180 - collinearDeg) continue

    // 同一色でなければマージしない
    if (r1.assignedColor !== r2.assignedColor) continue

    const newFrom = r1.fromNodeId === node.id ? r1.toNodeId : r1.fromNodeId
    const newTo = r2.fromNodeId === node.id ? r2.toNodeId : r2.fromNodeId

    r1.fromNodeId = newFrom
    r1.toNodeId = newTo
    r1.lengthMm = r1.lengthMm + r2.lengthMm
    r1.sourceSegmentIds = [...r1.sourceSegmentIds, ...r2.sourceSegmentIds]

    const idx = runs.indexOf(r2)
    if (idx >= 0) runs.splice(idx, 1)
    runById.delete(r2.id)

    const toNode = nodeMap.get(newTo)
    if (toNode) {
      toNode.connectedRunIds = toNode.connectedRunIds
        .filter((rid) => rid !== r2.id)
        .concat(r1.id)
        .filter((v, i, a) => a.indexOf(v) === i)
    }

    toRemoveNodeIds.add(node.id)
  }

  for (const nid of toRemoveNodeIds) {
    nodeMap.delete(nid)
  }
}

/**
 * グラフを元に、各ランに隣接パミリー色の割当を推定する。
 * 線分から取得した色をそのまま使うシンプルな実装。
 */
export function inferFamilyAssignments(
  graph: FoundationGraph,
  units: Unit[],
): FoundationGraph {
  const familyByColor = new Map<SegmentColor, string>()
  for (const u of units) {
    if (u.template_id && !familyByColor.has(u.color)) {
      familyByColor.set(u.color, u.template_id)
    }
  }

  for (const run of graph.runs) {
    if (run.assignedColor && !run.assignedFamilyId) {
      run.assignedFamilyId = familyByColor.get(run.assignedColor) ?? null
    }
  }

  return graph
}
