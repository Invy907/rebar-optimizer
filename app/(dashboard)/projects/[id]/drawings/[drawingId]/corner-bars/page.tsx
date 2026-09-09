import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Drawing, DrawingCornerBar, Project } from '@/lib/types/database'
import { CornerBarSummaryView } from '@/components/corner-bar-summary-view'

export default async function CornerBarSummaryPage({
  params,
}: {
  params: Promise<{ id: string; drawingId: string }>
}) {
  const { id: projectId, drawingId } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single<Project>()

  const { data: drawing } = await supabase
    .from('drawings')
    .select('*')
    .eq('id', drawingId)
    .single<Drawing>()

  if (!drawing) notFound()

  const { data: cornerBars } = await supabase
    .from('drawing_corner_bars')
    .select('*')
    .eq('drawing_id', drawingId)
    .order('created_at', { ascending: true })
    .returns<DrawingCornerBar[]>()

  const backHref = `/projects/${projectId}/drawings/${drawingId}`

  return (
    <div>
      <div className="mb-6 print:hidden">
        <Link
          href={backHref}
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          &larr; 図面に戻る
        </Link>
      </div>

      <h1 className="mb-1 text-xl font-bold">付加筋 集計結果</h1>
      <p className="mb-6 text-sm text-muted print:hidden">
        {project?.name ? `${project.name} / ` : ''}
        {drawing.file_name}
      </p>

      <CornerBarSummaryView placements={cornerBars ?? []} backHref={backHref} />
    </div>
  )
}
