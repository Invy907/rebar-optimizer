'use client'

import type { Drawing } from '@/lib/types/database'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export function DrawingList({
  drawings,
  projectId,
}: {
  drawings: Drawing[]
  projectId: string
}) {
  const supabase = createClient()
  const router = useRouter()

  async function handleDelete(drawing: Drawing) {
    if (!confirm(`「${drawing.file_name}」の図面を削除しますか？`)) return

    await supabase.storage.from('drawings').remove([drawing.file_path])
    await supabase.from('drawings').delete().eq('id', drawing.id)
    router.refresh()
  }

  if (drawings.length === 0) {
    return (
      <p className="text-sm text-muted">アップロードされた図面はありません。</p>
    )
  }

  return (
    <div className="space-y-2">
      {drawings.map((drawing) => (
        <div
          key={drawing.id}
          className="flex items-center justify-between rounded-lg border border-border bg-white px-4 py-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-mono uppercase text-muted">
              {drawing.file_type}
            </span>
            <Link
              href={`/projects/${projectId}/drawings/${drawing.id}`}
              className="truncate text-sm font-medium hover:text-primary transition-colors"
            >
              {drawing.file_name}
            </Link>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <span className="text-xs text-muted">
              {new Date(drawing.created_at).toLocaleDateString('ja-JP')}
            </span>
            <button
              onClick={() => handleDelete(drawing)}
              className="rounded px-2 py-1 text-xs text-danger hover:bg-red-50 transition-colors"
            >
              削除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
