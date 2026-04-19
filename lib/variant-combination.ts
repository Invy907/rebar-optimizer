/**
 * 直線ランを variant 長さの組合せで充填するソルバー。
 *
 * 本質的には「コイン両替問題」の変形だが、複数の最適化基準を持つ:
 *   1. 残余(remainder)最小 — 端数を出さない
 *   2. ピース数最小 — 長い variant を優先
 *   3. 標準 variant 優先 — priority が低い variant を優先
 *   4. 反復性 — 同じ variant を繰り返し使うほうが良い
 */

import type {
  StraightVariantOption,
  CombinationResult,
} from '@/lib/types/foundation-plan'

interface SolverOptions {
  /** 1 ラン内の最大ピース数。探索空間を制限する (default: 8) */
  maxPieces?: number
  /** これ以下の残余は許容 (mm, default: 0) */
  toleranceMm?: number
  /** 返す候補数の上限 (default: 5) */
  maxResults?: number
}

const DEFAULT_MAX_PIECES = 8
const DEFAULT_TOLERANCE = 0
const DEFAULT_MAX_RESULTS = 5

/**
 * targetMm を variants の長さ組合せで埋める最良候補を返す。
 * variants は lengthMm 降順にソート済みであること。
 */
export function findBestCombinations(
  targetMm: number,
  variants: StraightVariantOption[],
  opts?: SolverOptions,
): CombinationResult[] {
  const maxPieces = opts?.maxPieces ?? DEFAULT_MAX_PIECES
  const tolerance = opts?.toleranceMm ?? DEFAULT_TOLERANCE
  const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS

  if (targetMm <= 0 || variants.length === 0) return []

  const sorted = [...variants].sort((a, b) => b.lengthMm - a.lengthMm)
  const minLen = sorted[sorted.length - 1]!.lengthMm

  const candidates: CombinationResult[] = []
  let bestScore = -Infinity

  type Combo = { unitId: string; lengthMm: number; count: number }[]

  function dfs(
    remaining: number,
    startIdx: number,
    current: Combo,
    pieces: number,
  ) {
    if (remaining <= tolerance) {
      const result = buildResult(current, targetMm, remaining)
      insertCandidate(candidates, result, maxResults)
      if (result.score > bestScore) bestScore = result.score
      return
    }

    if (pieces >= maxPieces) {
      const result = buildResult(current, targetMm, remaining)
      insertCandidate(candidates, result, maxResults)
      return
    }

    if (remaining < minLen) {
      const result = buildResult(current, targetMm, remaining)
      insertCandidate(candidates, result, maxResults)
      return
    }

    for (let i = startIdx; i < sorted.length; i++) {
      const v = sorted[i]!
      if (v.lengthMm > remaining) continue

      const maxCount = Math.min(
        Math.floor(remaining / v.lengthMm),
        maxPieces - pieces,
      )

      for (let c = maxCount; c >= 1; c--) {
        const next: Combo = [...current]
        const existing = next.find((x) => x.unitId === v.unitId)
        if (existing) {
          existing.count += c
        } else {
          next.push({ unitId: v.unitId, lengthMm: v.lengthMm, count: c })
        }

        dfs(remaining - v.lengthMm * c, i + 1, next, pieces + c)
      }
    }
  }

  dfs(targetMm, 0, [], 0)

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, maxResults)
}

function buildResult(
  combo: { unitId: string; lengthMm: number; count: number }[],
  targetMm: number,
  remaining: number,
): CombinationResult {
  const totalMm = combo.reduce((s, c) => s + c.lengthMm * c.count, 0)
  const pieceCount = combo.reduce((s, c) => s + c.count, 0)
  const remainderMm = Math.max(0, targetMm - totalMm)

  return {
    variants: combo.map((c) => ({ ...c })),
    totalMm,
    remainderMm,
    pieceCount,
    score: scoreCombination(targetMm, totalMm, remainderMm, pieceCount, combo),
  }
}

/**
 * 組合せの品質を 0–100 で評価する。
 *
 *   - 端数ペナルティ: remainder / target が大きいほど減点
 *   - ピース数ペナルティ: 多いほど減点
 *   - 反復ボーナス: 同じ variant を繰り返し使うほどボーナス
 *   - 長尺ボーナス: 平均ピース長が大きいほどボーナス
 */
function scoreCombination(
  targetMm: number,
  totalMm: number,
  remainderMm: number,
  pieceCount: number,
  combo: { unitId: string; lengthMm: number; count: number }[],
): number {
  if (pieceCount === 0) return 0

  const remainderPenalty = targetMm > 0 ? (remainderMm / targetMm) * 60 : 0
  const piecePenalty = Math.max(0, (pieceCount - 1) * 5)
  const distinctVariants = combo.length
  const repetitionBonus = pieceCount > 1 && distinctVariants === 1 ? 10 : 0
  const avgLen = totalMm / pieceCount
  const longestVariant = Math.max(...combo.map((c) => c.lengthMm))
  const lengthBonus = Math.min(10, (avgLen / (longestVariant || 1)) * 10)

  return Math.max(0, 100 - remainderPenalty - piecePenalty + repetitionBonus + lengthBonus)
}

function insertCandidate(
  list: CombinationResult[],
  candidate: CombinationResult,
  maxSize: number,
) {
  const isDuplicate = list.some(
    (existing) =>
      existing.remainderMm === candidate.remainderMm &&
      existing.pieceCount === candidate.pieceCount &&
      existing.variants.length === candidate.variants.length &&
      existing.variants.every(
        (v, i) =>
          candidate.variants[i] &&
          v.unitId === candidate.variants[i].unitId &&
          v.count === candidate.variants[i].count,
      ),
  )
  if (isDuplicate) return

  list.push(candidate)

  if (list.length > maxSize * 2) {
    list.sort((a, b) => b.score - a.score)
    list.length = maxSize
  }
}

/**
 * 組合せ結果を人間向け文字列に変換。
 * 例: "①4,095 × 2" や "①3,640 × 1 + ②2,730 × 1"
 */
export function formatCombination(
  result: CombinationResult,
  nameMap?: Map<string, { mark: number | null; name: string }>,
): string {
  if (result.variants.length === 0) return '—'
  return result.variants
    .map((v) => {
      const info = nameMap?.get(v.unitId)
      const prefix = info?.mark != null ? `${circled(info.mark)}` : ''
      const label = `${prefix}${v.lengthMm.toLocaleString('ja-JP')}`
      return `${label} × ${v.count}`
    })
    .join(' + ')
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
function circled(n: number): string {
  const chars = [...CIRCLED]
  return n >= 1 && n <= chars.length ? chars[n - 1]! : `(${n})`
}
