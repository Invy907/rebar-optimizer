'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function EditProjectName({
  projectId,
  initialName,
}: {
  projectId: string
  initialName: string
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  async function handleSave() {
    if (!name.trim() || saving) return
    setSaving(true)
    const { error } = await supabase
      .from('projects')
      .update({ name: name.trim() })
      .eq('id', projectId)

    setSaving(false)
    if (error) return
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold truncate max-w-[26rem]">
          {name}
        </h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-muted hover:text-foreground"
        >
          編集
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 max-w-[28rem]">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
        autoFocus
      />
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs text-muted hover:text-foreground"
        disabled={saving}
      >
        キャンセル
      </button>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !name.trim()}
        className="rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  )
}

