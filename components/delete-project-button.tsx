'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function DeleteProjectButton({
  projectId,
  label = '削除',
}: {
  projectId: string
  label?: string
}) {
  const supabase = createClient()
  const router = useRouter()

  async function handleDelete() {
    if (
      !confirm(
        'このプロジェクトを本当に削除しますか？\n関連する図面とデータはすべて削除されます。',
      )
    ) {
      return
    }

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)

    if (!error) {
      router.push('/projects')
      router.refresh()
    }
  }

  return (
    <button
      onClick={handleDelete}
      className="rounded-lg px-3 py-1.5 text-sm text-danger hover:bg-red-50 transition-colors"
    >
      {label}
    </button>
  )
}
