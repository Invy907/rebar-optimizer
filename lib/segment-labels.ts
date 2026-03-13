/**
 * 세그먼트 목록에서 created_at 기준 정렬 후 라벨 맵 생성.
 * 라벨이 비어 있으면 S01, S02, ... 자동 부여.
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
 * segment id → 표시 라벨 (문자열만 필요할 때)
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
 * segment id → { label, isAuto } (자동 부여 여부가 필요할 때, 예: 스타일 분기)
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
