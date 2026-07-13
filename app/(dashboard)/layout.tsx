import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardNav } from '@/components/dashboard-nav'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen">
      <DashboardNav userEmail={user.email ?? ''} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </div>
  )
}
