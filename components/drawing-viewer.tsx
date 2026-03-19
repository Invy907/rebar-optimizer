'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { DrawingSegment } from '@/lib/types/database'
import { getSegmentLabelMap } from '@/lib/segment-labels'
import { SegmentPanel } from '@/components/segment-panel'
import {
  encodeSegmentMeta,
  getSegmentBars,
  getSegmentColor,
  legacyFieldsFromBars,
  type SegmentBarItem,
  type SegmentColor,
} from '@/lib/segment-meta'

interface Point {
  x: number
  y: number
}

const BAR_TYPES = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25', 'D29', 'D32']

type LastAction =
  | { type: 'create'; segment: DrawingSegment }
  | { type: 'delete'; segment: DrawingSegment }
  | { type: 'update'; before: DrawingSegment; after: DrawingSegment }
  | {
      type: 'split'
      before: DrawingSegment
      created: [DrawingSegment, DrawingSegment]
    }
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
  const rotationStorageKey = `drawing:${drawingId}:rotationSteps`

  const [segments, setSegments] = useState<DrawingSegment[]>(initialSegments)
  const [drawing, setDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<Point | null>(null)
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    initialSelectedSegmentId ?? null,
  )
  const [lastAction, setLastAction] = useState<LastAction>(null)
  const [splitArmedSegmentId, setSplitArmedSegmentId] = useState<string | null>(
    null,
  )
  const [splitHoverPoint, setSplitHoverPoint] = useState<Point | null>(null)
  const [lastSplitMarker, setLastSplitMarker] = useState<{
    point: Point
    segmentIds: [string, string]
  } | null>(null)
  const [rotationSteps, setRotationSteps] = useState<number>(0) // 0/1/2/3 => 0/90/180/270deg clockwise
  const thumbUploadTimerRef = useRef<number | null>(null)
  const didInitThumbRef = useRef(false)

  function normalizeRotationSteps(steps: number): number {
    return ((steps % 4) + 4) % 4
  }

  function readSavedRotationSteps(): number | null {
    try {
      const raw = window.localStorage.getItem(rotationStorageKey)
      if (raw == null) return null
      const n = Number.parseInt(raw, 10)
      if (!Number.isFinite(n)) return null
      return normalizeRotationSteps(n)
    } catch {
      return null
    }
  }

  function saveRotationSteps(steps: number) {
    try {
      window.localStorage.setItem(rotationStorageKey, String(normalizeRotationSteps(steps)))
    } catch {
      // ignore
    }
  }
  const [newSegmentDraft, setNewSegmentDraft] = useState<{
    kind: 'rebar' | 'spacing'
    p1: Point
    p2: Point
    lengthMm: string
    color: SegmentColor
    bars: { barType: string; quantity: string }[]
    label: string
  } | null>(null)

  const lastUsedRebarDraftKey = `project:${projectId}:lastUsedRebarDraft:v1`

  type StoredRebarDraft = {
    color: SegmentColor
    bars: SegmentBarItem[]
  }

  function readLastUsedRebarDraft(): StoredRebarDraft | null {
    try {
      const raw = window.localStorage.getItem(lastUsedRebarDraftKey)
      if (!raw) return null
      const obj = JSON.parse(raw) as unknown
      if (!obj || typeof obj !== 'object') return null
      const rec = obj as Record<string, unknown>
      const colorRaw = rec.color
      const color: SegmentColor | null =
        colorRaw === 'red' || colorRaw === 'blue' ? colorRaw : null

      const barsRaw = rec.bars
      const bars: SegmentBarItem[] = Array.isArray(barsRaw)
        ? barsRaw
            .map((x) => {
              if (!x || typeof x !== 'object') return null
              const xx = x as Record<string, unknown>
              const barType = String(xx.barType ?? '').trim()
              const quantity = Math.floor(Number(xx.quantity) || 0)
              if (!barType || quantity <= 0) return null
              return { barType, quantity }
            })
            .filter((x): x is SegmentBarItem => !!x)
        : []

      if (!color || bars.length === 0) return null
      return { color, bars }
    } catch {
      return null
    }
  }

  function writeLastUsedRebarDraft(draft: StoredRebarDraft) {
    try {
      window.localStorage.setItem(
        lastUsedRebarDraftKey,
        JSON.stringify({
          color: draft.color,
          bars: draft.bars.map((b) => ({ barType: b.barType, quantity: b.quantity })),
        }),
      )
    } catch {
      // ignore
    }
  }
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
    applyRotationTransform(ctx, img.width, img.height, rotationSteps)
    ctx.drawImage(img, 0, 0)

    const rebarOnly = segmentsSortedForLabels.filter(
      (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
    )
    const uniqueRebarLengths = Array.from(
      new Set(rebarOnly.map((s) => s.length_mm)),
    ).sort((a, b) => b - a)
    const lengthIndexByValue = new Map<number, number>(
      uniqueRebarLengths.map((len, idx) => [len, idx + 1]),
    )

    segments.forEach((seg) => {
      const isSelected = seg.id === selectedSegmentId
      const isSpacing = seg.bar_type === 'SPACING' && seg.quantity === 0
      const isLastSplit =
        !!lastSplitMarker && lastSplitMarker.segmentIds.includes(seg.id)
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      const segColor = getSegmentColor(seg)
      const baseStroke = isSpacing
        ? isSelected
          ? '#0f766e'
          : '#22c55e'
        : segColor === 'blue'
          ? isSelected
            ? '#1d4ed8'
            : '#2563eb'
          : isSelected
            ? '#b91c1c'
            : '#ef4444'
      ctx.strokeStyle = isLastSplit && !isSelected ? baseStroke : baseStroke
      ctx.lineWidth =
        isSelected ? 3 / scale : isLastSplit ? 3 / scale : 2 / scale
      if (isSpacing) {
        ctx.setLineDash([4 / scale, 4 / scale])
      }
      ctx.stroke()
      if (isSpacing) {
        ctx.setLineDash([])
      }

      const midX = (seg.x1 + seg.x2) / 2
      const midY = (seg.y1 + seg.y2) / 2
      const baseFill = isSpacing
        ? isSelected
          ? '#0f766e'
          : '#16a34a'
        : segColor === 'blue'
          ? isSelected
            ? '#1d4ed8'
            : '#2563eb'
          : isSelected
            ? '#b91c1c'
            : '#ef4444'
      ctx.fillStyle = baseFill

      const s = ((rotationSteps % 4) + 4) % 4
      const counterAngleRad = (-s * Math.PI) / 2 // テキストのみ回転を打ち消して画面基準で正立

      if (isSpacing) {
        ctx.save()
        ctx.translate(midX, midY - 6 / scale)
        ctx.rotate(counterAngleRad)
        ctx.font = `${10 / scale}px sans-serif`
        ctx.fillText(`${seg.length_mm}`, 0, 0)
        ctx.restore()
      } else {
        const circleNum = lengthIndexByValue.get(seg.length_mm) ?? 1
        const stroke = segColor === 'blue' ? '#2563eb' : '#ef4444'
        const r = 9 / scale
        const yCenter = midY - 2 / scale

        // Circle marker
        ctx.beginPath()
        ctx.arc(midX, yCenter, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.fill()
        ctx.lineWidth = 2 / scale
        ctx.strokeStyle = isSelected ? '#2563eb' : stroke
        ctx.stroke()

        // Number inside circle (画面基準で正立表示)
        ctx.save()
        ctx.translate(midX, yCenter)
        ctx.rotate(counterAngleRad)
        ctx.font = `bold ${11 / scale}px sans-serif`
        ctx.fillStyle = isSelected ? '#2563eb' : stroke
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(circleNum), 0, 0)
        ctx.restore()

        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'

        // 円内の下段は長さ（mmは省略）。色はグループで区別する
        // 円内の下段（長さ）も画面基準で正立表示
        ctx.save()
        ctx.translate(midX, yCenter + 12 / scale)
        ctx.rotate(counterAngleRad)
        ctx.font = `${9 / scale}px sans-serif`
        ctx.fillStyle = stroke
        ctx.fillText(`${seg.length_mm}`, 0, 0)
        ctx.restore()
      }
    })

    if (splitArmedSegmentId && splitHoverPoint) {
      ctx.beginPath()
      ctx.arc(splitHoverPoint.x, splitHoverPoint.y, 6 / scale, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(37, 99, 235, 0.25)'
      ctx.fill()
      ctx.lineWidth = 2 / scale
      ctx.strokeStyle = '#2563eb'
      ctx.stroke()
    }

    if (lastSplitMarker) {
      const p = lastSplitMarker.point
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7 / scale, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)'
      ctx.fill()
      ctx.lineWidth = 3 / scale
      ctx.strokeStyle = '#ef4444'
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.5 / scale, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }

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
  }, [
    segments,
    selectedSegmentId,
    drawing,
    startPoint,
    currentPoint,
    imgLoaded,
    scale,
    offset,
    splitArmedSegmentId,
    splitHoverPoint,
    lastSplitMarker,
    rotationSteps,
  ])

  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  useEffect(() => {
    if (!imgLoaded) return
    saveRotationSteps(rotationSteps)
  }, [rotationSteps, imgLoaded])

  useEffect(() => {
    if (!imgLoaded) return
    if (!didInitThumbRef.current) {
      // Skip initial mount thumbnail generation; wait for a real edit.
      didInitThumbRef.current = true
      return
    }
    if (thumbUploadTimerRef.current) {
      window.clearTimeout(thumbUploadTimerRef.current)
    }
    thumbUploadTimerRef.current = window.setTimeout(() => {
      void uploadCompositeThumbnail()
    }, 1200)
    return () => {
      if (thumbUploadTimerRef.current) window.clearTimeout(thumbUploadTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, imgLoaded, rotationSteps])

  useEffect(() => {
    if (!splitArmedSegmentId) return
    if (selectedSegmentId !== splitArmedSegmentId) {
      setSplitArmedSegmentId(null)
      setSplitHoverPoint(null)
    }
  }, [selectedSegmentId, splitArmedSegmentId])

  useEffect(() => {
    if (!lastSplitMarker) return
    if (!selectedSegmentId) return
    if (!lastSplitMarker.segmentIds.includes(selectedSegmentId)) {
      setLastSplitMarker(null)
    }
  }, [selectedSegmentId, lastSplitMarker])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSplitArmedSegmentId(null)
        setSplitHoverPoint(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
              const defaultSteps = img.width < img.height ? 1 : 0
              const savedSteps = readSavedRotationSteps()
              const stepsToUse = savedSteps ?? defaultSteps
              setRotationSteps(stepsToUse)
              setOffset({ x: 0, y: 0 })
              const { w: rotW, h: rotH } = getRotatedDims(
                img.width,
                img.height,
                stepsToUse,
              )
              const fitScale = Math.min(
                container.clientWidth / rotW,
                container.clientHeight / rotH,
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
        const defaultSteps = img.width < img.height ? 1 : 0
        const savedSteps = readSavedRotationSteps()
        const stepsToUse = savedSteps ?? defaultSteps
        setRotationSteps(stepsToUse)
        setOffset({ x: 0, y: 0 })
        const { w: rotW, h: rotH } = getRotatedDims(img.width, img.height, stepsToUse)
        const fitScale = Math.min(
          container.clientWidth / rotW,
          container.clientHeight / rotH,
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
    const xr = (e.clientX - rect.left - offset.x) / scale
    const yr = (e.clientY - rect.top - offset.y) / scale
    const img = imgRef.current
    if (!img) return { x: xr, y: yr }

    const w = img.width
    const h = img.height
    const steps = ((rotationSteps % 4) + 4) % 4

    // The rendering applies rotation after the offset/scale transform.
    // Here we undo it so mouse input stays aligned with segment coordinates.
    if (steps === 0) return { x: xr, y: yr }
    if (steps === 1) return { x: yr, y: h - xr } // 90deg clockwise
    if (steps === 2) return { x: w - xr, y: h - yr } // 180deg
    return { x: w - yr, y: xr } // 270deg clockwise
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
      if (splitArmedSegmentId) {
        const target = segments.find((s) => s.id === splitArmedSegmentId)
        if (!target) {
          setSplitArmedSegmentId(null)
          setSplitHoverPoint(null)
          return
        }
        const distance = distToSegment(
          pt,
          { x: target.x1, y: target.y1 },
          { x: target.x2, y: target.y2 },
        )
        if (distance < clickRadius) {
          void splitSegmentAtPoint(target, pt)
          return
        }
      }
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
    if (tool === 'select' && splitArmedSegmentId) {
      const pt = screenToCanvas(e)
      const target = segments.find((s) => s.id === splitArmedSegmentId)
      if (!target) {
        setSplitHoverPoint(null)
      } else {
        const clickRadius = 10 / scale
        const distance = distToSegment(
          pt,
          { x: target.x1, y: target.y1 },
          { x: target.x2, y: target.y2 },
        )
        if (distance < clickRadius) {
          const { projectedPoint } = projectPointToSegment(
            pt,
            { x: target.x1, y: target.y1 },
            { x: target.x2, y: target.y2 },
          )
          setSplitHoverPoint(projectedPoint)
        } else {
          setSplitHoverPoint(null)
        }
      }
    } else if (splitHoverPoint) {
      setSplitHoverPoint(null)
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

    // モーダルのデフォルトは「同一プロジェクト内で直前に使った値」を優先。
    // ない場合は直前の線分から引き継ぐ。最後まで無ければ D10。
    const stored = kind === 'rebar' ? readLastUsedRebarDraft() : null

    const lastBars = last ? getSegmentBars(last) : []
    const defaultBars =
      stored?.bars?.length
        ? stored.bars
        : lastBars.length
          ? lastBars
          : [{ barType: 'D10', quantity: 1 }]

    const supportedBars = defaultBars.filter((b) => BAR_TYPES.includes(b.barType as (typeof BAR_TYPES)[number]))
    const finalBars = supportedBars.length ? supportedBars : [{ barType: 'D10', quantity: 1 }]

    const defaultColor: SegmentColor =
      kind === 'rebar' ? stored?.color ?? (last ? getSegmentColor(last) : 'red') : 'red'

    setNewSegmentDraft({
      kind,
      p1,
      p2,
      lengthMm: '',
      color: defaultColor,
      bars:
        kind === 'spacing'
          ? []
          : finalBars.map((b) => ({
              barType: b.barType,
              quantity: String(b.quantity),
            })),
      label: kind === 'spacing' ? '間隔' : nextLabel,
    })
  }

  async function confirmNewSegment() {
    if (!newSegmentDraft) return
    const { p1, p2 } = newSegmentDraft
    const lengthMm = parseInt(newSegmentDraft.lengthMm, 10)
    const isSpacing = newSegmentDraft.kind === 'spacing'
    const bars: SegmentBarItem[] = isSpacing
      ? []
      : newSegmentDraft.bars
          .map((b) => ({
            barType: b.barType,
            quantity: Math.max(0, parseInt(b.quantity, 10) || 0),
          }))
          .filter((b) => b.barType && b.quantity > 0)
    if (isNaN(lengthMm) || lengthMm <= 0) {
      alert('有効な長さ (mm) を入力してください。')
      return
    }
    if (!isSpacing && bars.length === 0) {
      alert('鉄筋種別と数量を入力してください。')
      return
    }
    const legacy = isSpacing
      ? { bar_type: 'SPACING', quantity: 0 }
      : legacyFieldsFromBars(bars)
    const memo = isSpacing
      ? null
      : encodeSegmentMeta({
          v: 1,
          color: newSegmentDraft.color,
          bars,
          note: null,
        })

    const { data, error } = await supabase
      .from('drawing_segments')
      .insert({
        drawing_id: drawingId,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        length_mm: lengthMm,
        quantity: legacy.quantity,
        bar_type: legacy.bar_type,
        label: newSegmentDraft.label.trim() || null,
        memo,
      })
      .select()
      .single<DrawingSegment>()

    if (!error && data) {
      setSegments((prev) => [...prev, data])
      setSelectedSegmentId(data.id)
      setLastAction({ type: 'create', segment: data })
      if (!isSpacing) {
        writeLastUsedRebarDraft({
          color: newSegmentDraft.color,
          bars,
        })
      }
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

  async function splitSegmentAtPoint(segment: DrawingSegment, clickPoint: Point) {
    const a = { x: segment.x1, y: segment.y1 }
    const b = { x: segment.x2, y: segment.y2 }
    const { t, projectedPoint } = projectPointToSegment(clickPoint, a, b)

    const minDistanceFromEndpoint = 10 / scale
    const distanceToA = Math.hypot(projectedPoint.x - a.x, projectedPoint.y - a.y)
    const distanceToB = Math.hypot(projectedPoint.x - b.x, projectedPoint.y - b.y)
    if (distanceToA < minDistanceFromEndpoint || distanceToB < minDistanceFromEndpoint) {
      alert('端点に近すぎるため分割できません。もう少し中央をクリックしてください。')
      return
    }

    const trimmedLabel = segment.label?.trim() ?? ''
    const labelA = trimmedLabel ? `${trimmedLabel}-1` : null
    const labelB = trimmedLabel ? `${trimmedLabel}-2` : null

    const lengthA = Math.max(1, Math.round(segment.length_mm * t))
    const lengthB = Math.max(1, segment.length_mm - lengthA)

    const insertRows = [
      {
        drawing_id: drawingId,
        x1: segment.x1,
        y1: segment.y1,
        x2: projectedPoint.x,
        y2: projectedPoint.y,
        length_mm: lengthA,
        quantity: segment.quantity,
        bar_type: segment.bar_type,
        label: labelA,
        memo: segment.memo,
      },
      {
        drawing_id: drawingId,
        x1: projectedPoint.x,
        y1: projectedPoint.y,
        x2: segment.x2,
        y2: segment.y2,
        length_mm: lengthB,
        quantity: segment.quantity,
        bar_type: segment.bar_type,
        label: labelB,
        memo: segment.memo,
      },
    ] as const

    const { data: createdSegments, error: insertError } = await supabase
      .from('drawing_segments')
      .insert(insertRows)
      .select()
      .returns<DrawingSegment[]>()

    if (insertError || !createdSegments || createdSegments.length !== 2) {
      alert('分割に失敗しました。')
      return
    }

    const { error: deleteError } = await supabase
      .from('drawing_segments')
      .delete()
      .eq('id', segment.id)

    if (deleteError) {
      await supabase
        .from('drawing_segments')
        .delete()
        .in(
          'id',
          createdSegments.map((s) => s.id),
        )
      alert('分割に失敗しました。')
      return
    }

    const [createdA, createdB] = createdSegments
    setSegments((prev) => [
      ...prev.filter((s) => s.id !== segment.id),
      createdA,
      createdB,
    ])
    setSelectedSegmentId(createdA.id)
    setSplitArmedSegmentId(null)
    setSplitHoverPoint(null)
    setLastSplitMarker({
      point: projectedPoint,
      segmentIds: [createdA.id, createdB.id],
    })
    setLastAction({
      type: 'split',
      before: segment,
      created: [createdA, createdB],
    })
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
    } else if (lastAction.type === 'split') {
      const { before, created } = lastAction
      const createdIds = created.map((s) => s.id)
      const { error: deleteNewError } = await supabase
        .from('drawing_segments')
        .delete()
        .in('id', createdIds)
      if (deleteNewError) return
      const { data: restored, error: restoreError } = await supabase
        .from('drawing_segments')
        .insert(before)
        .select()
        .single<DrawingSegment>()
      if (!restoreError && restored) {
        setSegments((prev) => [
          ...prev.filter((s) => !createdIds.includes(s.id)),
          restored,
        ])
        setSelectedSegmentId(restored.id)
        setLastAction(null)
      }
    }
  }

  function refitForRotation(nextSteps: number) {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container) return
    const { w: rotW, h: rotH } = getRotatedDims(img.width, img.height, nextSteps)
    const fitScale = Math.min(container.clientWidth / rotW, container.clientHeight / rotH, 1)
    setRotationSteps(nextSteps)
    setScale(fitScale)
    setOffset({ x: 0, y: 0 })
  }

  function rotateRight90() {
    const nextSteps = ((rotationSteps + 1) % 4 + 4) % 4
    refitForRotation(nextSteps)
  }

  function rotateLeft90() {
    const nextSteps = ((rotationSteps + 3) % 4 + 4) % 4
    refitForRotation(nextSteps)
    void uploadCompositeThumbnail(nextSteps)
  }

  async function uploadCompositeThumbnail(stepsOverride?: number) {
    const img = imgRef.current
    if (!img || !imgLoaded) return

    const segmentsToDraw = segments.filter(
      (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
    )

    const steps = typeof stepsOverride === 'number' ? stepsOverride : rotationSteps
    const normalizedSteps = normalizeRotationSteps(steps)

    const { w: rotW, h: rotH } = getRotatedDims(
      img.width,
      img.height,
      normalizedSteps,
    )
    const maxDim = 320
    const scaleDown = Math.min(1, maxDim / Math.max(rotW, rotH))

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rotW * scaleDown))
    canvas.height = Math.max(1, Math.round(rotH * scaleDown))

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.save()
    ctx.scale(scaleDown, scaleDown)
    applyRotationTransform(ctx, img.width, img.height, normalizedSteps)
    ctx.drawImage(img, 0, 0)
    ctx.lineCap = 'round'

    segmentsToDraw.forEach((seg) => {
      const segColor = getSegmentColor(seg)
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      ctx.strokeStyle = segColor === 'blue' ? '#2563eb' : '#ef4444'
      ctx.lineWidth = 2
      ctx.stroke()
    })

    ctx.restore()

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    if (!blob) return

    const thumbPath = `${projectId}/${drawingId}.thumb.png`
    const { error } = await supabase.storage
      .from('drawings')
      .upload(thumbPath, blob, { upsert: true, contentType: 'image/png' })
    if (error) {
      // Thumbnail generation is a best-effort feature.
      console.warn('Thumbnail upload error:', error)
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
          <button
            type="button"
            onClick={rotateLeft90}
            disabled={!imgLoaded}
            className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
              !imgLoaded ? 'bg-gray-100 text-muted cursor-not-allowed' : 'bg-gray-100 text-foreground hover:bg-gray-200'
            }`}
            title="左に90度回転"
          >
            ↺ 90°
          </button>
          <span className="text-xs text-muted ml-2">
            {splitArmedSegmentId
              ? '分割: 図面上の線をクリックして分割点を選択（Escでキャンセル）'
              : 'Alt+ドラッグ: 移動 / ホイール: ズーム / Shift+ドラッグ: 水平・垂直にスナップ'}
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
        onSplit={(id) => {
          setTool('select')
          setSelectedSegmentId(id)
          setSplitArmedSegmentId(id)
          setSplitHoverPoint(null)
          setLastSplitMarker(null)
        }}
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
                  <label className="block text-xs text-muted mb-1">線の色</label>
                  <select
                    value={newSegmentDraft.color}
                    onChange={(e) =>
                      setNewSegmentDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              color: (e.target.value as SegmentColor) || 'red',
                            }
                          : prev,
                      )
                    }
                    className="w-full rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
                  >
                    <option value="red">赤</option>
                    <option value="blue">青</option>
                  </select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
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
            {newSegmentDraft.kind === 'rebar' && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted">鉄筋（種類と本数）</div>
                <div className="space-y-2">
                  {newSegmentDraft.bars.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={row.barType}
                        onChange={(e) =>
                          setNewSegmentDraft((prev) => {
                            if (!prev) return prev
                            const next = [...prev.bars]
                            next[idx] = { ...next[idx], barType: e.target.value }
                            return { ...prev, bars: next }
                          })
                        }
                        className="flex-1 rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary bg-white"
                      >
                        {BAR_TYPES.map((bt) => (
                          <option key={bt} value={bt}>
                            {bt}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        value={row.quantity}
                        onChange={(e) =>
                          setNewSegmentDraft((prev) => {
                            if (!prev) return prev
                            const next = [...prev.bars]
                            next[idx] = { ...next[idx], quantity: e.target.value }
                            return { ...prev, bars: next }
                          })
                        }
                        className="w-20 rounded border border-border px-2 py-1 text-sm font-mono outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setNewSegmentDraft((prev) => {
                            if (!prev) return prev
                            const next = prev.bars.filter((_, i) => i !== idx)
                            return { ...prev, bars: next.length ? next : prev.bars }
                          })
                        }
                        className="text-xs text-danger hover:underline"
                        disabled={newSegmentDraft.bars.length <= 1}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setNewSegmentDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            bars: [
                              ...prev.bars,
                              {
                                barType: getNextDefaultBarType(
                                  prev.bars.map((b) => b.barType),
                                  BAR_TYPES,
                                ),
                                quantity: '1',
                              },
                            ],
                          }
                        : prev,
                    )
                  }
                  className="text-xs text-primary hover:underline"
                >
                  + 追加
                </button>
              </div>
            )}
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

function getRotatedDims(w: number, h: number, steps: number): { w: number; h: number } {
  const s = ((steps % 4) + 4) % 4
  if (s % 2 === 1) {
    return { w: h, h: w }
  }
  return { w, h }
}

function applyRotationTransform(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  steps: number,
) {
  const s = ((steps % 4) + 4) % 4
  // Mapping (original -> rotated) for clockwise steps:
  // s=0:  (x, y) -> (x, y)
  // s=1:  (x, y) -> (h - y, x)
  // s=2:  (x, y) -> (w - x, h - y)
  // s=3:  (x, y) -> (y, w - x)
  if (s === 0) return
  if (s === 1) {
    // x' = -y + h, y' = x
    ctx.transform(0, 1, -1, 0, h, 0)
    return
  }
  if (s === 2) {
    // x' = -x + w, y' = -y + h
    ctx.transform(-1, 0, 0, -1, w, h)
    return
  }
  // s === 3
  // x' = y, y' = -x + w
  ctx.transform(0, -1, 1, 0, 0, w)
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

function projectPointToSegment(
  p: Point,
  a: Point,
  b: Point,
): { t: number; projectedPoint: Point } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { t: 0, projectedPoint: { ...a } }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return {
    t,
    projectedPoint: { x: a.x + t * dx, y: a.y + t * dy },
  }
}

// getSegmentColor moved to lib/segment-meta

function getNextDefaultBarType(
  existingBarTypes: string[],
  fallbackList: string[],
): string {
  const existing = new Set(existingBarTypes.map((b) => (b ?? '').toUpperCase()))
  const ordered = fallbackList.map((b) => (b ?? '').toUpperCase()).filter(Boolean)
  for (const bt of ordered) {
    if (!existing.has(bt)) return bt
  }
  return ordered[ordered.length - 1] ?? 'D10'
}
