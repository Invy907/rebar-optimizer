import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { CreateProjectButton } from '@/components/create-project-button'
import type { Project } from '@/lib/types/database'

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<Project[]>()

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">プロジェクト</h1>
        <CreateProjectButton />
      </div>

      {(!projects || projects.length === 0) ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-muted text-sm">まだプロジェクトがありません。</p>
          <p className="text-muted text-sm mt-1">新しいプロジェクトを作成して開始してください。</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group rounded-lg border border-border bg-white p-5 hover:border-primary/30 hover:shadow-sm transition-all"
            >
              <h2 className="font-semibold group-hover:text-primary transition-colors">
                {project.name}
              </h2>
              {project.description && (
                <p className="mt-1 text-sm text-muted line-clamp-2">
                  {project.description}
                </p>
              )}
              <p className="mt-3 text-xs text-muted">
                {new Date(project.created_at).toLocaleDateString('ja-JP')}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
