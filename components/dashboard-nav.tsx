'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

export function DashboardNav({ userEmail }: { userEmail: string }) {
  const supabase = createClient()
  const router = useRouter()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="border-b border-border bg-white print:hidden">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link
          href="/projects"
          className="flex items-center gap-3 min-w-0"
          aria-label="トップへ"
        >
          <Image
            src="/logo.png"
            alt="サプロン建材工業株式会社"
            width={180}
            height={36}
            priority
            className="h-8 w-auto"
          />
          <span className="text-sm font-semibold tracking-tight text-foreground truncate">
            鉄筋資材算定システム
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted">{userEmail}</span>
          <Link
            href="/units"
            className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-gray-100 transition-colors"
          >
            ユニット管理
          </Link>
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
