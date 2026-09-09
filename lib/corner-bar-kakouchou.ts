import type { CornerBarSegment } from '@/lib/corner-bar-presets'

/**
 * 曲げ 1 ヶ所あたりの減り(mm)。
 *
 * 客先の手書き参考資料の実測値から逆算した参考値で、確定した規則ではない。
 *   700 + 700         = 1400 → 1380
 *   600 + 455 + 115 + 600 = 1770 → 1710
 *   450 + 455 + 115 + 450 = 1470 → 1410
 *
 * 規則が確定したら、この定数と cornerBarKakouchouMm だけを差し替える。
 * ユニット側の computeShapeLengthMm（L字 1 回のみ -20）とは別物なので混ぜない。
 */
export const BEND_DEDUCTION_MM = 20

/**
 * 付加筋の加工長(mm)。辺の合計から曲げ箇所ぶんを引いた参考値。
 *
 * 寸法が 1 つでも未入力の場合は計算できないので null を返す（画面では「—」）。
 */
export function cornerBarKakouchouMm(segments: CornerBarSegment[]): number | null {
  if (segments.length === 0) return null

  let sum = 0
  for (const seg of segments) {
    if (seg.lengthMm == null || !Number.isFinite(seg.lengthMm) || seg.lengthMm <= 0) return null
    sum += seg.lengthMm
  }

  const bendCount = Math.max(0, segments.length - 1)
  const kakouchou = sum - BEND_DEDUCTION_MM * bendCount
  return kakouchou > 0 ? kakouchou : null
}
