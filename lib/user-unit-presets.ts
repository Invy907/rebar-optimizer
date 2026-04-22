import type { SupabaseClient } from '@supabase/supabase-js'
import type { UnitRebarLayout } from '@/lib/types/database'
import type { SegmentColor } from '@/lib/segment-colors'
import type { ExtendedShapeType, LocationType, UnitBar } from '@/lib/unit-types'
import type { UnitDetailGeometry, UnitDetailSpec } from '@/lib/unit-detail-shape'

const STORAGE_KEY = 'rebar-optimizer:user-unit-presets:v1'

/** ユーザーが再利用用に保存したユニット設計（DB の Unit 行とは別概念） */
export type UserUnitPresetPayload = {
  location_type: LocationType
  shape_type: ExtendedShapeType
  color: SegmentColor
  mark_number: string
  bars: UnitBar[]
  spacing_mm: string
  pitch_mm: string
  l_shape_count?: string
  description: string
  detail_spec: UnitDetailSpec
  detail_geometry: UnitDetailGeometry | null
  detail_start_mode: 'template' | 'free'
  rebar_layout: UnitRebarLayout
}

export type UserUnitPreset = {
  id: string
  name: string
  savedAt: string
  payload: UserUnitPresetPayload
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

/** 旧 localStorage からの移行用（内部） */
export function loadUserPresets(): UserUnitPreset[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is UserUnitPreset =>
        x != null &&
        typeof x === 'object' &&
        'id' in x &&
        'name' in x &&
        'payload' in x,
    )
  } catch {
    return []
  }
}

function saveUserPresets(presets: UserUnitPreset[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // ignore quota / private mode
  }
}

function rowToPreset(row: {
  id: string
  name: string
  payload: unknown
  created_at: string
}): UserUnitPreset {
  return {
    id: row.id,
    name: row.name,
    savedAt: row.created_at,
    payload: row.payload as UserUnitPresetPayload,
  }
}

function describeSupabaseError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const e = error as { message?: string; details?: string; hint?: string; code?: string }
  return JSON.stringify(
    {
      code: e.code ?? null,
      message: e.message ?? null,
      details: e.details ?? null,
      hint: e.hint ?? null,
    },
    null,
    2,
  )
}

function isMissingPresetTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { message?: string; code?: string }
  return e.code === '42P01' || /user_unit_presets/i.test(e.message ?? '')
}

/**
 * ログインユーザーのプリセット一覧（新しい順）。
 * DB が空で localStorage に旧データがある場合は一度だけ移行してから返す。
 */
export async function fetchUserPresetsFromDb(supabase: SupabaseClient): Promise<UserUnitPreset[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  let { data: rows, error } = await supabase
    .from('user_unit_presets')
    .select('id, name, payload, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchUserPresetsFromDb', describeSupabaseError(error))
    // Migration not applied yet: keep old presets visible.
    if (isMissingPresetTable(error)) return loadUserPresets()
    return []
  }

  if (!rows || rows.length === 0) {
    const local = loadUserPresets()
    if (local.length > 0) {
      let allOk = true
      for (const p of local) {
        const { error: insErr } = await supabase.from('user_unit_presets').insert({
          user_id: user.id,
          name: p.name,
          payload: p.payload,
        })
        if (insErr) {
          allOk = false
          console.error('migrate user unit preset', describeSupabaseError(insErr))
        }
      }
      if (allOk) saveUserPresets([])
      const refetch = await supabase
        .from('user_unit_presets')
        .select('id, name, payload, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (refetch.error) {
        console.error('fetchUserPresetsFromDb refetch', describeSupabaseError(refetch.error))
        return []
      }
      rows = refetch.data
    }
  }

  if (!rows) return []
  return rows.map((r) =>
    rowToPreset({
      id: r.id,
      name: r.name,
      payload: r.payload,
      created_at: r.created_at,
    }),
  )
}

export async function insertUserPresetToDb(
  supabase: SupabaseClient,
  input: { name: string; payload: UserUnitPresetPayload },
): Promise<UserUnitPreset | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('user_unit_presets')
    .insert({ user_id: user.id, name: input.name, payload: input.payload })
    .select('id, name, payload, created_at')
    .single()
  if (error || !data) {
    console.error('insertUserPresetToDb', describeSupabaseError(error))
    return null
  }
  return rowToPreset({
    id: data.id,
    name: data.name,
    payload: data.payload,
    created_at: data.created_at,
  })
}

export async function deleteUserPresetFromDb(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from('user_unit_presets').delete().eq('id', id)
  if (error) {
    console.error('deleteUserPresetFromDb', describeSupabaseError(error))
    return false
  }
  return true
}

export async function updateUserPresetInDb(
  supabase: SupabaseClient,
  input: { id: string; name: string; payload: UserUnitPresetPayload },
): Promise<UserUnitPreset | null> {
  const { data, error } = await supabase
    .from('user_unit_presets')
    .update({ name: input.name, payload: input.payload })
    .eq('id', input.id)
    .select('id, name, payload, created_at')
    .single()
  if (error || !data) {
    console.error('updateUserPresetInDb', describeSupabaseError(error))
    return null
  }
  return rowToPreset({
    id: data.id,
    name: data.name,
    payload: data.payload,
    created_at: data.created_at,
  })
}

/** プリセット適用時に rebar の id 衝突を避ける */
export function remapRebarLayoutIds(layout: UnitRebarLayout): UnitRebarLayout {
  const rebars = Array.isArray(layout.rebars) ? layout.rebars : []
  const idMap = new Map<string, string>()
  for (const r of rebars) {
    idMap.set(r.id, randomId('rb'))
  }
  return {
    rebars: rebars.map((r) => ({ ...r, id: idMap.get(r.id) ?? randomId('rb') })),
    spacings: (Array.isArray(layout.spacings) ? layout.spacings : []).map((s) => ({
      ...s,
      id: randomId('sp'),
      from: s.from ? (idMap.get(s.from) ?? s.from) : undefined,
      to: s.to ? (idMap.get(s.to) ?? s.to) : undefined,
    })),
    annotations: (Array.isArray(layout.annotations) ? layout.annotations : []).map((a) => ({
      ...a,
      id: randomId('an'),
    })),
  }
}
