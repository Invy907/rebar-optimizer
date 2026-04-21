/**
 * セグメント一覧を created_at 基準で並べ替えた後、ラベルマップを生成。
 * ラベルが空の場合は S01, S02, ... を自動採番。
 */

export interface SegmentForLabel {
  id: string
  label: string | null
  created_at: string
}

function sortSegmentsByCreatedAt<T extends SegmentForLabel>(segments: T[]): T[] {
  return [...segments].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  )
}

/**
 * segment id → 表示ラベル（文字列のみ必要な場合）
 */
export function getSegmentLabelMap(
  segments: SegmentForLabel[],
): Record<string, string> {
  const sorted = sortSegmentsByCreatedAt(segments)
  const map: Record<string, string> = {}
  let autoNo = 1
  for (const seg of sorted) {
    const existing = seg.label?.trim()
    if (existing) {
      map[seg.id] = existing
    } else {
      map[seg.id] = `S${String(autoNo).padStart(2, '0')}`
      autoNo++
    }
  }
  return map
}

/**
 * segment id → { label, isAuto }（自動付与の有無が必要な場合、例: スタイル分岐）
 */
export function getSegmentLabelMapWithMeta(
  segments: SegmentForLabel[],
): Record<string, { label: string; isAuto: boolean }> {
  const sorted = sortSegmentsByCreatedAt(segments)
  const map: Record<string, { label: string; isAuto: boolean }> = {}
  let autoNo = 1
  for (const seg of sorted) {
    const existing = seg.label?.trim()
    if (existing) {
      map[seg.id] = { label: existing, isAuto: false }
    } else {
      map[seg.id] = {
        label: `S${String(autoNo).padStart(2, '0')}`,
        isAuto: true,
      }
      autoNo++
    }
  }
  return map
}
