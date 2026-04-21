import type { SupabaseClient } from '@supabase/supabase-js'
import type { LengthPresetGroupRow } from '@/lib/types/database'

export type LengthPresetGroup = {
  id: string
  name: string
  description: string | null
  lengths: number[]
  savedAt: string
}

export type LengthPresetSaveResult =
  | { ok: true; group: LengthPresetGroup }
  | { ok: false; message: string }

const LENGTH_PRESET_MISSING_TABLE_MSG =
  '長さプリセット用テーブル（length_preset_groups）がありません。Supabase にマイグレーション（20260421_length_preset_groups.sql）を適用してください。'

function rowToGroup(row: LengthPresetGroupRow): LengthPresetGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    lengths: Array.isArray(row.lengths) ? row.lengths : [],
    savedAt: row.updated_at ?? row.created_at,
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

function isMissingLengthPresetGroupsTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { message?: string; code?: string }
  return e.code === '42P01' || e.code === 'PGRST205' || /length_preset_groups/i.test(e.message ?? '')
}

export function normalizeLengthList(values: Array<number | string | null | undefined>): number[] {
  const normalized = values
    .map((value) => Number.parseInt(String(value ?? ''), 10))
    .filter((value) => Number.isFinite(value) && value > 0)

  return [...new Set(normalized)].sort((a, b) => b - a)
}

export async function fetchLengthPresetGroupsFromDb(supabase: SupabaseClient): Promise<LengthPresetGroup[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('length_preset_groups')
    .select('id, user_id, name, description, lengths, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    if (isMissingLengthPresetGroupsTable(error)) return []
    console.error('fetchLengthPresetGroupsFromDb', describeSupabaseError(error))
    return []
  }

  return (data ?? []).map((row) => rowToGroup(row as LengthPresetGroupRow))
}

export async function insertLengthPresetGroupToDb(
  supabase: SupabaseClient,
  input: { name: string; description?: string | null; lengths: Array<number | string | null | undefined> },
): Promise<LengthPresetSaveResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'ログインが必要です。' }

  const { data, error } = await supabase
    .from('length_preset_groups')
    .insert({
      user_id: user.id,
      name: input.name,
      description: input.description ?? null,
      lengths: normalizeLengthList(input.lengths),
    })
    .select('id, user_id, name, description, lengths, created_at, updated_at')
    .single()

  if (error || !data) {
    if (isMissingLengthPresetGroupsTable(error)) {
      return { ok: false, message: LENGTH_PRESET_MISSING_TABLE_MSG }
    }
    console.error('insertLengthPresetGroupToDb', describeSupabaseError(error))
    const e = error as { message?: string; hint?: string | null }
    const hint = e.hint ? `\n\n${e.hint}` : ''
    return { ok: false, message: `${e.message ?? '保存に失敗しました。'}${hint}` }
  }
  return { ok: true, group: rowToGroup(data as LengthPresetGroupRow) }
}

export async function updateLengthPresetGroupInDb(
  supabase: SupabaseClient,
  input: { id: string; name: string; description?: string | null; lengths: Array<number | string | null | undefined> },
): Promise<LengthPresetSaveResult> {
  const { data, error } = await supabase
    .from('length_preset_groups')
    .update({
      name: input.name,
      description: input.description ?? null,
      lengths: normalizeLengthList(input.lengths),
    })
    .eq('id', input.id)
    .select('id, user_id, name, description, lengths, created_at, updated_at')
    .single()

  if (error || !data) {
    if (isMissingLengthPresetGroupsTable(error)) {
      return { ok: false, message: LENGTH_PRESET_MISSING_TABLE_MSG }
    }
    console.error('updateLengthPresetGroupInDb', describeSupabaseError(error))
    const e = error as { message?: string; hint?: string | null }
    const hint = e.hint ? `\n\n${e.hint}` : ''
    return { ok: false, message: `${e.message ?? '更新に失敗しました。'}${hint}` }
  }
  return { ok: true, group: rowToGroup(data as LengthPresetGroupRow) }
}

export async function deleteLengthPresetGroupFromDb(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from('length_preset_groups').delete().eq('id', id)
  if (error) {
    if (isMissingLengthPresetGroupsTable(error)) return false
    console.error('deleteLengthPresetGroupFromDb', describeSupabaseError(error))
    return false
  }
  return true
}

