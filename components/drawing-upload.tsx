'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg']
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

export function DrawingUpload({ projectId }: { projectId: string }) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const supabase = createClient()

  async function uploadFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      alert('PDF, PNG, JPG ファイルのみアップロードできます。')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      alert('ファイルサイズは 20MB 以下にしてください。')
      return
    }

    setUploading(true)

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    const filePath = `${projectId}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('drawings')
      .upload(filePath, file)

    if (uploadError) {
      alert('アップロードに失敗しました: ' + uploadError.message)
      setUploading(false)
      return
    }

    const fileType = ext === 'pdf' ? 'pdf' : ext === 'png' ? 'png' : 'jpg'

    const { error: dbError } = await supabase.from('drawings').insert({
      project_id: projectId,
      file_name: file.name,
      file_path: filePath,
      file_type: fileType,
    })

    if (dbError) {
      alert('図面情報の保存に失敗しました: ' + dbError.message)
    }

    setUploading(false)
    router.refresh()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div
      className={`mb-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        dragOver ? 'border-primary bg-primary/5' : 'border-border'
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={handleFileChange}
        className="hidden"
      />

      {uploading ? (
        <p className="text-sm text-muted">アップロード中...</p>
      ) : (
        <>
          <p className="text-sm text-muted mb-2">
            図面ファイルをドラッグ＆ドロップ、またはクリックしてアップロード
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-primary/10 hover:border-primary/50 hover:text-primary"
          >
            ファイルを選択
          </button>
          <p className="mt-2 text-xs text-muted">PDF, PNG, JPG（最大 20MB）</p>
        </>
      )}
    </div>
  )
}
