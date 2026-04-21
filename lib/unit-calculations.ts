import type { DrawingSegment, Unit, UnitRebarSpacingItem } from '@/lib/types/database'
import { getSegmentBars, getSegmentEffectiveLengthMm, resolveLinkedUnit } from '@/lib/segment-meta'

export type UnitCountRoundingMode = 'round' | 'floor' | 'ceil'

export type UnitCalculationRow = {
  key: string
  unitId: string | null
  unitName: string
  unitCode: string | null
  pitchMm: number | null
  lengthMm: number
  baseCount: number
  barCount: number
  computedCount: number
  intervalLengthMm: number
  intervalTimesCount: number
  formulaText: string
}

function parseMm(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : null
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = raw.match(/@?\s*(\d+)/)
  if (!match) return null
  const mm = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(mm) ? mm : null
}

export function getUnitPitchMm(unit: Unit | null | undefined): number | null {
  if (!unit) return null
  const explicit = parseMm(unit.pitch_mm)
  if (explicit != null && explicit > 0) return explicit
  const detailPitch = parseMm(unit.detail_spec?.pitch)
  if (detailPitch != null && detailPitch > 0) return detailPitch
  return null
}

function spacingEndpoints(
  spacing: UnitRebarSpacingItem,
  unit: Unit,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const rebarById = Object.fromEntries((unit.rebar_layout?.rebars ?? []).map((rb) => [rb.id, rb]))
  const from = spacing.from ? rebarById[spacing.from] : null
  const to = spacing.to ? rebarById[spacing.to] : null
  const x1 = from?.x ?? spacing.x1
  const y1 = from?.y ?? spacing.y1
  const x2 = to?.x ?? spacing.x2
  const y2 = to?.y ?? spacing.y2
  if ([x1, y1, x2, y2].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return { x1: x1 as number, y1: y1 as number, x2: x2 as number, y2: y2 as number }
  }
  return null
}

function isDiagonalSpacing(spacing: UnitRebarSpacingItem, unit: Unit): boolean {
  const endpoints = spacingEndpoints(spacing, unit)
  if (!endpoints) return false
  const dx = Math.abs(endpoints.x2 - endpoints.x1)
  const dy = Math.abs(endpoints.y2 - endpoints.y1)
  return dx > 1 && dy > 1
}

export function getUnitIntervalLengthMm(unit: Unit | null | undefined): number {
  if (!unit?.rebar_layout?.spacings?.length) return 0
  return unit.rebar_layout.spacings.reduce((sum, spacing) => {
    const mm = parseMm(spacing.label)
    if (mm == null || mm <= 0) return sum
    const adjusted = isDiagonalSpacing(spacing, unit) ? mm : Math.max(0, mm - 30)
    return sum + adjusted
  }, 0)
}

function applyRounding(raw: number, mode: UnitCountRoundingMode): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0
  if (mode === 'floor') return Math.floor(raw)
  if (mode === 'ceil') return Math.ceil(raw)
  return Math.round(raw)
}

export function buildUnitCalculationRows(
  segments: DrawingSegment[],
  units: Unit[],
  roundingMode: UnitCountRoundingMode = 'round',
): UnitCalculationRow[] {
  return segments
    .filter((segment) => segment.bar_type !== 'SPACING')
    .map((segment) => {
      const unit = resolveLinkedUnit(segment, units)
      const lengthMm = getSegmentEffectiveLengthMm(segment, units)
      const pitchMm = getUnitPitchMm(unit)
      const bars = getSegmentBars(segment, units)
      const barCount = bars.reduce((sum, item) => sum + item.quantity, 0)
      const baseCount = pitchMm && pitchMm > 0 ? applyRounding(lengthMm / pitchMm, roundingMode) : 0
      const computedCount = baseCount * barCount
      const intervalLengthMm = getUnitIntervalLengthMm(unit)

      return {
        key: `${segment.id}:${unit?.id ?? 'unlinked'}`,
        unitId: unit?.id ?? null,
        unitName: unit?.name ?? segment.unit_name ?? segment.label ?? '未割当',
        unitCode: unit?.code ?? segment.unit_code ?? null,
        pitchMm,
        lengthMm,
        baseCount,
        barCount,
        computedCount,
        intervalLengthMm,
        intervalTimesCount: intervalLengthMm * computedCount,
        formulaText:
          pitchMm && pitchMm > 0
            ? `${lengthMm} ÷ ${pitchMm} = ${(lengthMm / pitchMm).toFixed(2)} → ${baseCount} × ${barCount}`
            : `${lengthMm} / ピッチ未設定`,
      }
    })
    .filter((row) => row.pitchMm != null && row.barCount > 0)
}
