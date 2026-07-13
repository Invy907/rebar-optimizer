export const DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM = -30

export function pieceAdjustmentStorageKey(projectId: string) {
  return `optimize-piece-adjustment:${projectId}`
}

export function parsePieceLengthAdjustment(
  value: string | undefined | null,
): number {
  if (value == null || value === '') return DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM
}
