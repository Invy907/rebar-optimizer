import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Project, DrawingSegment, OptimizationRun } from '@/lib/types/database'
import { OptimizeClient } from '@/components/optimize-client'

export default async function OptimizePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single<Project>()

  if (!project) notFound()

  const { data: segments } = await supabase
    .from('drawing_segments')
    .select('*')
    .in(
      'drawing_id',
      (
        await supabase
          .from('drawings')
          .select('id')
          .eq('project_id', projectId)
      ).data?.map((d) => d.id) ?? [],
    )
    .returns<DrawingSegment[]>()

  const { data: pastRuns } = await supabase
    .from('optimization_runs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .returns<OptimizationRun[]>()

  return (
    <div>
      <div className="mb-6">
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          &larr; プロジェクトに戻る
        </Link>
      </div>

      <h1 className="text-xl font-bold mb-1">{project.name}</h1>
      <p className="text-sm text-muted mb-6">切断最適化の計算</p>

      <OptimizeClient
        projectId={projectId}
        segments={segments ?? []}
        pastRuns={pastRuns ?? []}
      />
    </div>
  )
}
