import { createClient } from '@/lib/supabase/server'
import type { Unit } from '@/lib/types/database'
import { UnitClient } from '@/components/unit-client'

export default async function UnitsPage() {
  const supabase = await createClient()
  const { data: units } = await supabase
    .from('units')
    .select('*')
    .order('created_at', { ascending: true })
    .returns<Unit[]>()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <UnitClient initialUnits={units ?? []} />
    </div>
  )
}
