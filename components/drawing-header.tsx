'use client'

import { useState } from 'react'
import Link from 'next/link'
import { EditProjectName } from '@/components/edit-project-name'
import { DeleteProjectButton } from '@/components/delete-project-button'

export function DrawingHeader({
  projectId,
  projectName,
  drawingFileName,
}: {
  projectId: string
  projectName: string
  drawingFileName: string
}) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href="/projects"
          className="text-sm text-muted hover:text-foreground transition-colors shrink-0"
        >
          &larr; プロジェクト一覧に戻る
        </Link>
        <span className="text-sm text-muted shrink-0">/</span>
        <div className="min-w-0">
          <EditProjectName
            projectId={projectId}
            initialName={projectName}
            onEditingChange={setEditing}
          />
        </div>
        <span className="text-sm text-muted shrink-0">/</span>
        <span className="text-sm font-medium truncate">{drawingFileName}</span>
      </div>

      {editing && (
        <DeleteProjectButton
          projectId={projectId}
          label="プロジェクト削除"
        />
      )}
    </div>
  )
}

