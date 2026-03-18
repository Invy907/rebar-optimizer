'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { DrawingSegment } from '@/lib/types/database'
import { getSegmentLabelMap } from '@/lib/segment-labels'
import { SegmentPanel } from '@/components/segment-panel'

interface Point {
  x: number
  y: number
}

const BAR_TYPES = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25', 'D29', 'D32']

type LastAction =
  | { type: 'create'; segment: DrawingSegment }
  | { type: 'delete'; segment: DrawingSegment }
  | { type: 'update'; before: DrawingSegment; after: DrawingSegment }
  | null

export function DrawingViewer({
  drawingId,
  projectId,
  imageUrl,
  fileType,
  initialSegments,
  initialSelectedSegmentId,
}: {
  drawingId: string
  projectId: string
  imageUrl: string
  fileType: string
  initialSegments: DrawingSegment[]
  initialSelectedSegmentId?: string
}) {
  const [segments, setSegments] = useState<DrawingSegment[]>(initialSegments)
  const [drawing, setDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<Point | null>(null)
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    initialSelectedSegmentId ?? null,
  )
  const [lastAction, setLastAction] = useState<LastAction>(null)
  const [newSegmentDraft, setNewSegmentDraft] = useState<{
    kind: 'rebar' | 'spacing'
    p1: Point
    p2: Point
    lengthMm: string
    barType: string
    quantity: string
    label: string
  } | null>(null)
  const [tool, setTool] = useState<'select' | 'draw' | 'spacing'>('select')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 })

  const supabase = createClient()
  const router = useRouter()

  const segmentsSortedForLabels = [...segments].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  )
  const labelById = getSegmentLabelMap(segments)

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !imgLoaded) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)

    segments.forEach((seg) => {
      const isSelected = seg.id === selectedSegmentId
      const isSpacing = seg.bar_type === 'SPACING' && seg.quantity === 0
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      ctx.strokeStyle = isSpacing ? (isSelected ? '#0f766e' : '#22c55e') : isSelected ? '#2563eb' : '#ef4444'
      ctx.lineWidth = isSelected ? 3 / scale : 2 / scale
      if (isSpacing) {
        ctx.setLineDash([4 / scale, 4 / scale])
      }
      ctx.stroke()
      if (isSpacing) {
        ctx.setLineDash([])
      }

      const midX = (seg.x1 + seg.x2) / 2
      const midY = (seg.y1 + seg.y2) / 2
      ctx.fillStyle = isSpacing ? (isSelected ? '#0f766e' : '#16a34a') : isSelected ? '#2563eb' : '#ef4444'
      ctx.font = `${12 / scale}px sans-serif`
      const label = isSpacing ? (seg.label ?? 'SP') : labelById[seg.id] ?? '-'
      const text = isSpacing
        ? `${label} ${seg.length_mm}mm`
        : `${label} ${seg.length_mm}mm ${seg.bar_type}`
      ctx.fillText(text, midX, midY - 6 / scale)
    })

    if (drawing && startPoint && currentPoint) {
      ctx.beginPath()
      ctx.moveTo(startPoint.x, startPoint.y)
      ctx.lineTo(currentPoint.x, currentPoint.y)
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 2 / scale
      ctx.setLineDash([6 / scale, 4 / scale])
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.restore()
  }, [segments, selectedSegmentId, drawing, startPoint, currentPoint, imgLoaded, scale, offset])

  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  useEffect(() => {
    if (fileType === 'pdf') {
      let cancelled = false
      async function loadPdf() {
        try {
          const pdfjs = await import('pdfjs-dist')
          pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
          const res = await fetch(imageUrl)
          const data = await res.arrayBuffer()
          if (cancelled) return
          const doc = await pdfjs.getDocument({ data }).promise
          const page = await doc.getPage(1)
          const viewport = page.getViewport({ scale: 2 })
          const off = document.createElement('canvas')
          off.width = viewport.width
          off.height = viewport.height
          const ctx = off.getContext('2d')
          if (!ctx) return
          const renderTask = page.render({ canvas: off, canvasContext: ctx, viewport })
          await renderTask.promise
          if (cancelled) return
          const dataUrl = off.toDataURL('image/png')
          const img = new Image()
          img.onload = () => {
            if (cancelled) return
            imgRef.current = img
            const canvas = canvasRef.current
            const container = containerRef.current
            if (canvas && container) {
              canvas.width = container.clientWidth
              canvas.height = container.clientHeight
              const fitScale = Math.min(
                container.clientWidth / img.width,
                container.clientHeight / img.height,
                1,
              )
              setScale(fitScale)
            }
            setImgLoaded(true)
          }
          img.src = dataUrl
        } catch (err) {
          if (!cancelled) console.error('PDF load error:', err)
        }
      }
      loadPdf()
      return () => { cancelled = true }
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) {
        canvas.width = container.clientWidth
        canvas.height = container.clientHeight
        const fitScale = Math.min(
          container.clientWidth / img.width,
          container.clientHeight / img.height,
          1,
        )
        setScale(fitScale)
      }
      setImgLoaded(true)
    }
    img.src = imageUrl
  }, [imageUrl, fileType])

  useEffect(() => {
    function handleResize() {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) {
        canvas.width = container.clientWidth
        canvas.height = container.clientHeight
        drawCanvas()
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [drawCanvas])

  function screenToCanvas(e: React.MouseEvent): Point {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - offset.x) / scale,
      y: (e.clientY - rect.top - offset.y) / scale,
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setPanning(true)
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
      return
    }

    if ((tool === 'draw' || tool === 'spacing') && e.button === 0) {
      const pt = screenToCanvas(e)
      setDrawing(true)
      setStartPoint(pt)
      setCurrentPoint(pt)
    }

    if (tool === 'select' && e.button === 0) {
      const pt = screenToCanvas(e)
      const clickRadius = 10 / scale
      const found = segments.find((seg) => {
        return distToSegment(pt, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }) < clickRadius
      })
      setSelectedSegmentId(found?.id ?? null)
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (panning) {
      setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
      return
    }
    if (drawing) {
      let pt = screenToCanvas(e)
      if (startPoint && e.shiftKey) {
        const dx = Math.abs(pt.x - startPoint.x)
        const dy = Math.abs(pt.y - startPoint.y)
        if (dx > dy) {
          // 水平方向にスナップ
          pt = { x: pt.x, y: startPoint.y }
        } else {
          // 垂直方向にスナップ
          pt = { x: startPoint.x, y: pt.y }
        }
      }
      setCurrentPoint(pt)
    }
  }

  function handleMouseUp() {
    if (panning) {
      setPanning(false)
      return
    }

    if (drawing && startPoint && currentPoint && !newSegmentDraft) {
      const dx = currentPoint.x - startPoint.x
      const dy = currentPoint.y - startPoint.y
      const pixelLen = Math.sqrt(dx * dx + dy * dy)

      if (pixelLen > 5) {
        openNewSegmentForm(tool === 'spacing' ? 'spacing' : 'rebar', startPoint, currentPoint)
      }
    }
    setDrawing(false)
    setStartPoint(null)
    setCurrentPoint(null)
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    setScale((prev) => {
      const newScale = Math.max(0.1, Math.min(10, prev * factor))
      setOffset((o) => ({
        x: mx - (mx - o.x) * (newScale / prev),
        y: my - (my - o.y) * (newScale / prev),
      }))
      return newScale
    })
  }

  function openNewSegmentForm(kind: 'rebar' | 'spacing', p1: Point, p2: Point) {
    const last = segmentsSortedForLabels[segmentsSortedForLabels.length - 1]
    const nextLabel =
      segmentsSortedForLabels.length === 0
        ? 'S01'
        : labelById[last.id]?.match(/^S(\d{2})$/)
          ? `S${String(Number(RegExp.$1) + 1).padStart(2, '0')}`
          : `S${String(segmentsSortedForLabels.length + 1).padStart(2, '0')}`

    // デフォルトの鉄筋種別は、直前の線分が通常の鉄筋ならそれを引き継ぎ、
    // そうでなければ D10 にする。間隔線の場合は常に 'SPACING' を内部的に使う。
    const defaultBarTypeForRebar =
      last && BAR_TYPES.includes(last.bar_type as (typeof BAR_TYPES)[number])
        ? last.bar_type
        : 'D10'

    setNewSegmentDraft({
      kind,
      p1,
      p2,
      lengthMm: '',
      barType: kind === 'spacing' ? 'SPACING' : defaultBarTypeForRebar,
      quantity: kind === 'spacing' ? '0' : '1',
      label: kind === 'spacing' ? '間隔' : nextLabel,
    })
  }

  async function confirmNewSegment() {
    if (!newSegmentDraft) return
    const { p1, p2 } = newSegmentDraft
    const lengthMm = parseInt(newSegmentDraft.lengthMm, 10)
    const isSpacing = newSegmentDraft.kind === 'spacing'
    const quantity = isSpacing
      ? 0
      : Math.max(1, parseInt(newSegmentDraft.quantity, 10) || 1)
    if (isNaN(lengthMm) || lengthMm <= 0) {
      alert('有効な長さ (mm) を入力してください。')
      return
    }

    const { data, error } = await supabase
      .from('drawing_segments')
      .insert({
        drawing_id: drawingId,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        length_mm: lengthMm,
        quantity,
        bar_type: isSpacing ? 'SPACING' : newSegmentDraft.barType,
        label: newSegmentDraft.label.trim() || null,
      })
      .select()
      .single<DrawingSegment>()

    if (!error && data) {
      setSegments((prev) => [...prev, data])
      setSelectedSegmentId(data.id)
      setLastAction({ type: 'create', segment: data })
      setNewSegmentDraft(null)
    }
  }

  async function updateSegment(id: string, updates: Partial<DrawingSegment>) {
    const { error } = await supabase
      .from('drawing_segments')
      .update(updates)
      .eq('id', id)

    if (!error) {
      setSegments((prev) => {
        const before = prev.find((s) => s.id === id)
        const next = prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
        if (before) {
          const after = next.find((s) => s.id === id)!
          setLastAction({ type: 'update', before, after })
        }
        return next
      })
    }
  }

  async function deleteSegment(id: string) {
    const { error } = await supabase
      .from('drawing_segments')
      .delete()
      .eq('id', id)

    if (!error) {
      setSegments((prev) => {
        const deleted = prev.find((s) => s.id === id)
        if (deleted) setLastAction({ type: 'delete', segment: deleted })
        return prev.filter((s) => s.id !== id)
      })
      if (selectedSegmentId === id) setSelectedSegmentId(null)
    }
  }

  async function handleUndo() {
    if (!lastAction) return
    if (lastAction.type === 'create') {
      const { segment } = lastAction
      const { error } = await supabase
        .from('drawing_segments')
        .delete()
        .eq('id', segment.id)
      if (!error) {
        setSegments((prev) => prev.filter((s) => s.id !== segment.id))
        setSelectedSegmentId(null)
        setLastAction(null)
      }
    } else if (lastAction.type === 'delete') {
      const { segment } = lastAction
      const { data, error } = await supabase
        .from('drawing_segments')
        .insert(segment)
        .select()
        .single<DrawingSegment>()
      if (!error && data) {
        setSegments((prev) => [...prev, data])
        setSelectedSegmentId(data.id)
        setLastAction(null)
      }
    } else if (lastAction.type === 'update') {
      const { before } = lastAction
      const { error } = await supabase
        .from('drawing_segments')
        .update({
          length_mm: before.length_mm,
          quantity: before.quantity,
          bar_type: before.bar_type,
          label: before.label,
        })
        .eq('id', before.id)
      if (!error) {
        setSegments((prev) =>
          prev.map((s) => (s.id === before.id ? before : s)),
        )
        setSelectedSegmentId(before.id)
        setLastAction(null)
      }
    }
  }

  const selectedSegment = segments.find((s) => s.id === selectedSegmentId)

  return (
    <div className="flex flex-1 gap-4 min-h-0">
      {/* Canvas area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => setTool('select')}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              tool === 'select'
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-foreground hover:bg-gray-200'
            }`}
          >
            選択
          </button>
          <button
            onClick={() => setTool('draw')}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              tool === 'draw'
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-foreground hover:bg-gray-200'
            }`}
          >
            線を描く
          </button>
          <button
            onClick={() => setTool('spacing')}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              tool === 'spacing'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-100 text-foreground hover:bg-gray-200'
            }`}
          >
            間隔線
          </button>
          <span className="text-xs text-muted ml-2">
            Alt+ドラッグ: 移動 / ホイール: ズーム / Shift+ドラッグ: 水平・垂直にスナップ
          </span>
        </div>
        <div
          ref={containerRef}
          className="relative flex-1 rounded-lg border border-border bg-gray-50 overflow-hidden"
          style={{ cursor: tool === 'draw' ? 'crosshair' : panning ? 'grabbing' : 'default' }}
        >
          {!imgLoaded && fileType === 'pdf' ? (
            <div className="flex items-center justify-center w-full h-full text-muted text-sm">
              PDFを読み込み中...
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            className="block w-full h-full"
            style={{ display: imgLoaded ? 'block' : 'none' }}
          />
        </div>
      </div>

      {/* Side panel */}
      <SegmentPanel
        segments={segments}
        selectedSegmentId={selectedSegmentId}
        onSelect={setSelectedSegmentId}
        onUpdate={updateSegment}
        onDelete={deleteSegment}
        barTypes={BAR_TYPES}
        projectId={projectId}
        canUndo={!!lastAction}
        onUndo={handleUndo}
      />

      {newSegmentDraft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg space-y-4">
            <h2 className="text-base font-semibold">新しい線分の入力</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">長さ (mm)</label>
                <input
                  type="number"
                  value={newSegmentDraft.lengthMm}
                  onChange={(e) =>
                    setNewSegmentDraft((prev) =>
                      prev ? { ...prev, lengthMm: e.target.value } : prev,
                    )
                  }
                  className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
                  autoFocus
                />
              </div>
              {newSegmentDraft.kind === 'rebar' && (
                <div>
                  <label className="block text-xs text-muted mb-1">数量</label>
                  <input
                    type="number"
                    min={1}
                    value={newSegmentDraft.quantity}
                    onChange={(e) =>
                      setNewSegmentDraft((prev) =>
                        prev ? { ...prev, quantity: e.target.value } : prev,
                      )
                    }
                    className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {newSegmentDraft.kind === 'rebar' && (
                <div>
                  <label className="block text-xs text-muted mb-1">鉄筋種別</label>
                  <select
                    value={newSegmentDraft.barType}
                    onChange={(e) =>
                      setNewSegmentDraft((prev) =>
                        prev ? { ...prev, barType: e.target.value } : prev,
                      )
                    }
                    className="w-full rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
                  >
                    {BAR_TYPES.map((bt) => (
                      <option key={bt} value={bt}>
                        {bt}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs text-muted mb-1">ラベル</label>
                <input
                  type="text"
                  value={newSegmentDraft.label}
                  onChange={(e) =>
                    setNewSegmentDraft((prev) =>
                      prev ? { ...prev, label: e.target.value } : prev,
                    )
                  }
                  className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewSegmentDraft(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmNewSegment}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2)
}
