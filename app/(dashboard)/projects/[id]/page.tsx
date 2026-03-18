import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Project, Drawing } from '@/lib/types/database'
import { DrawingUpload } from '@/components/drawing-upload'
import { DrawingList } from '@/components/drawing-list'
import { DeleteProjectButton } from '@/components/delete-project-button'
import { EditProjectName } from '@/components/edit-project-name'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single<Project>()

  if (!project) notFound()

  const { data: drawings } = await supabase
    .from('drawings')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .returns<Drawing[]>()

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/projects"
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          &larr; プロジェクト一覧に戻る
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <EditProjectName projectId={project.id} initialName={project.name} />
          {project.description && (
            <p className="mt-1 text-sm text-muted break-words">
              {project.description}
            </p>
          )}
        </div>
        <DeleteProjectButton projectId={project.id} />
      </div>

      <div className="space-y-6">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">図面</h2>
          </div>
          <DrawingUpload projectId={project.id} />
          <DrawingList drawings={drawings ?? []} projectId={project.id} />
        </section>
      </div>
    </div>
  )
}
