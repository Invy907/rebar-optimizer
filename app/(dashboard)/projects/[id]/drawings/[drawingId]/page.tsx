import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Drawing, DrawingSegment } from '@/lib/types/database'
import { DrawingViewer } from '@/components/drawing-viewer'

export default async function DrawingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; drawingId: string }>
  searchParams: Promise<{ segmentId?: string }>
}) {
  const { id: projectId, drawingId } = await params
  const { segmentId } = await searchParams
  const supabase = await createClient()

  const { data: drawing } = await supabase
    .from('drawings')
    .select('*')
    .eq('id', drawingId)
    .single<Drawing>()

  if (!drawing) notFound()

  const { data: signedUrlData } = await supabase.storage
    .from('drawings')
    .createSignedUrl(drawing.file_path, 3600)

  const { data: segments } = await supabase
    .from('drawing_segments')
    .select('*')
    .eq('drawing_id', drawingId)
    .order('created_at', { ascending: true })
    .returns<DrawingSegment[]>()

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-4rem)]">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          &larr; プロジェクトに戻る
        </Link>
        <span className="text-sm text-muted">/</span>
        <span className="text-sm font-medium">{drawing.file_name}</span>
      </div>

      <DrawingViewer
        drawingId={drawingId}
        projectId={projectId}
        imageUrl={signedUrlData?.signedUrl ?? ''}
        fileType={drawing.file_type}
        initialSegments={segments ?? []}
        initialSelectedSegmentId={segmentId}
      />
    </div>
  )
}
