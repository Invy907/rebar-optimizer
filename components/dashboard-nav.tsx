'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export function DashboardNav({ userEmail }: { userEmail: string }) {
  const supabase = createClient()
  const router = useRouter()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="border-b border-border bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/projects" className="text-base font-bold tracking-tight">
          鉄筋切断最適化
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted">{userEmail}</span>
          <button
            onClick={handleLogout}
            className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-gray-100 transition-colors"
          >
            ログアウト
          </button>
        </div>
      </div>
    </header>
  )
}
