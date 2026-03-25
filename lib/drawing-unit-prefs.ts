/**
 * 図面ツールバー用: プロジェクト単位で「最近使ったユニット」「お気に入り」を localStorage に保存
 */

const RECENT_SUFFIX = ':recentUnitIds:v1'
const FAV_SUFFIX = ':favoriteUnitIds:v1'

function recentKey(projectId: string) {
  return `project:${projectId}${RECENT_SUFFIX}`
}

function favKey(projectId: string) {
  return `project:${projectId}${FAV_SUFFIX}`
}

function parseIdArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
  } catch {
    return []
  }
}

export function readRecentUnitIds(projectId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    return parseIdArray(window.localStorage.getItem(recentKey(projectId)))
  } catch {
    return []
  }
}

export function pushRecentUnitId(projectId: string, unitId: string) {
  if (typeof window === 'undefined' || !unitId) return
  try {
    const prev = parseIdArray(window.localStorage.getItem(recentKey(projectId)))
    const next = [unitId, ...prev.filter((id) => id !== unitId)].slice(0, 5)
    window.localStorage.setItem(recentKey(projectId), JSON.stringify(next))
  } catch {
    // ignore
  }
}

export function readFavoriteUnitIds(projectId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    return parseIdArray(window.localStorage.getItem(favKey(projectId)))
  } catch {
    return []
  }
}

export function toggleFavoriteUnitId(projectId: string, unitId: string): string[] {
  if (typeof window === 'undefined' || !unitId) return []
  try {
    const prev = parseIdArray(window.localStorage.getItem(favKey(projectId)))
    const has = prev.includes(unitId)
    const next = has ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    window.localStorage.setItem(favKey(projectId), JSON.stringify(next))
    return next
  } catch {
    return []
  }
}
