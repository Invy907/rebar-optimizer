import { normalizeSegmentColor, type SegmentColor } from '@/lib/segment-colors'
import type { ResolvedVariant, Unit } from '@/lib/types/database'
import type { UnitBar } from '@/lib/unit-types'

export type TemplateSummary = {
  id: string
  name: string
  shapeType: string
  variants: Unit[]
}

export type ResolveResult = {
  matched: ResolvedVariant | null
  rawLengthMm: number
  snappedLengthMm: number
  candidates: ResolvedVariant[]
  createSuggestion: {
    templateId: string
    color: SegmentColor
    lengthMm: number
  } | null
}

function unitTemplateId(u: Unit): string {
  return u.template_id ?? `shape:${u.shape_type}`
}

function unitTemplateName(u: Unit): string {
  return (u.template_id ?? '').trim() || `${u.shape_type}:${u.location_type ?? 'any'}`
}

function unitLengthMm(u: Unit): number | null {
  if (typeof u.length_mm === 'number' && Number.isFinite(u.length_mm) && u.length_mm > 0) {
    return Math.round(u.length_mm)
  }
  return null
}

export function snapLengthMm(mm: number, snapLengths: number[]): number {
  const normalized = Math.max(1, Math.round(mm))
  if (!Array.isArray(snapLengths) || snapLengths.length === 0) return normalized
  let best = normalized
  let bestDistance = Number.POSITIVE_INFINITY
  for (const s of snapLengths) {
    const d = Math.abs(s - mm)
    if (d < bestDistance) {
      bestDistance = d
      best = s
    }
  }
  return best
}

function unitBars(u: Unit): UnitBar[] {
  return Array.isArray(u.bars) ? u.bars.map((b) => ({ ...b })) : []
}

function toResolved(u: Unit, source: ResolvedVariant['source']): ResolvedVariant {
  return {
    variantId: u.id,
    templateId: unitTemplateId(u),
    templateName: unitTemplateName(u),
    color: normalizeSegmentColor(u.color),
    lengthMm: unitLengthMm(u),
    code: u.code ?? null,
    markNumber: u.mark_number ?? null,
    unitName: u.name ?? '',
    bars: unitBars(u),
    source,
  }
}

export function buildTemplateSummaries(units: Unit[]): TemplateSummary[] {
  const map = new Map<string, TemplateSummary>()
  for (const u of units) {
    if (u.is_active === false) continue
    const id = unitTemplateId(u)
    const existing = map.get(id)
    if (existing) {
      existing.variants.push(u)
      continue
    }
    map.set(id, {
      id,
      name: unitTemplateName(u),
      shapeType: u.shape_type,
      variants: [u],
    })
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function resolveVariantByTemplateColorLength(
  units: Unit[],
  templateId: string,
  color: SegmentColor,
  rawLengthMm: number,
): ResolveResult {
  const rawRounded = Math.max(1, Math.round(rawLengthMm))
  const normalizedColor = normalizeSegmentColor(color)
  const activeUnits = units.filter((u) => u.is_active !== false)
  const inTemplate = activeUnits.filter((u) => unitTemplateId(u) === templateId)
  const sameColor = inTemplate.filter((u) => normalizeSegmentColor(u.color) === normalizedColor)
  const snapCandidates = [...new Set(sameColor.map((u) => unitLengthMm(u)).filter((x): x is number => x != null))]
  const snapped = snapLengthMm(rawRounded, snapCandidates)

  const exact = sameColor.find((u) => unitLengthMm(u) === rawRounded)
  if (exact) {
    return {
      matched: toResolved(exact, 'exact'),
      rawLengthMm: rawRounded,
      snappedLengthMm: snapped,
      candidates: sameColor.map((u) => toResolved(u, 'candidate')),
      createSuggestion: null,
    }
  }

  const snappedMatch = sameColor.find((u) => unitLengthMm(u) === snapped)
  if (snappedMatch) {
    return {
      matched: toResolved(snappedMatch, 'snapped'),
      rawLengthMm: rawRounded,
      snappedLengthMm: snapped,
      candidates: sameColor.map((u) => toResolved(u, 'candidate')),
      createSuggestion: null,
    }
  }

  const candidates = sameColor
    .slice()
    .sort((a, b) => (a.mark_number ?? 9999) - (b.mark_number ?? 9999))
    .map((u) => toResolved(u, 'candidate'))

  return {
    matched: null,
    rawLengthMm: rawRounded,
    snappedLengthMm: snapped,
    candidates,
    createSuggestion: {
      templateId,
      color: normalizedColor,
      lengthMm: snapped,
    },
  }
}

