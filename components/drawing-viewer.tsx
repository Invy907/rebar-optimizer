// components/drawing-viewer.tsx

'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { DrawingSegment } from '@/lib/types/database'
import type { Unit } from '@/lib/types/database'
import { getSegmentLabelMap } from '@/lib/segment-labels'
import { SegmentPanel } from '@/components/segment-panel'
import {
  decodeSegmentMeta,
  encodeSegmentMeta,
  getSegmentBars,
  getSegmentColor,
  getSegmentMarkNumberForCanvas,
  legacyFieldsFromBars,
  type SegmentBarItem,
  type SegmentColor,
} from '@/lib/segment-meta'
import {
  pushRecentUnitId,
  readFavoriteUnitIds,
  readRecentUnitIds,
  toggleFavoriteUnitId,
} from '@/lib/drawing-unit-prefs'
import {
  getSegmentStrokeHex,
  isSegmentColor,
  normalizeSegmentColor,
  SEGMENT_COLOR_DEFINITIONS,
} from '@/lib/segment-colors'
import {
  buildShapeSketch,
  getDefaultDetailSpec,
  normalizeDetailSpecForTemplate,
  shapeTypeToDetailTemplate,
} from '@/lib/unit-detail-shape'
import {
  buildTemplateSummaries,
  resolveVariantByTemplateColorLength,
  snapLengthMm,
  type TemplateSummary,
} from '@/lib/unit-variant-resolver'

interface Point {
  x: number
  y: number
}

function getPolylineAnchorFromSegments(list: DrawingSegment[]): Point | null {
  if (list.length === 0) return null
  const nonSpacing = list.filter((s) => !(s.bar_type === 'SPACING' && s.quantity === 0))
  const targetList = nonSpacing.length > 0 ? nonSpacing : list

  const latest = [...targetList].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  )[targetList.length - 1]
  if (!latest) return null
  return { x: latest.x2, y: latest.y2 }
}

const BAR_TYPES = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25', 'D29', 'D32']

function isPersistedUnitId(id: string): boolean {
  return !id.startsWith('mock-') && !id.startsWith('local-')
}

function getUnitCodeBase(u: Pick<Unit, 'code' | 'name' | 'id'>): string {
  const raw = (u.code ?? u.name ?? u.id).trim()
  const m = raw.match(/^([a-zA-Z]+)-\d+$/)
  return (m?.[1] ?? raw).toLowerCase()
}

/** 図面上のピクセル距離を mm として扱う（1px≒1mm 想定。必要なら後で係数を追加） */
function canvasDistanceToLengthMm(p1: Point, p2: Point): number {
  return Math.max(1, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y)))
}

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
  units: serverUnits = [],
}: {
  drawingId: string
  projectId: string
  imageUrl: string
  fileType: string
  initialSegments: DrawingSegment[]
  initialSelectedSegmentId?: string
  units?: Unit[]
}) {
  const enableTemplateVariantFlow = process.env.NEXT_PUBLIC_TEMPLATE_VARIANT_FLOW !== '0'
  const rotationStorageKey = `drawing:${drawingId}:rotationSteps`

  const [segments, setSegments] = useState<DrawingSegment[]>(initialSegments)
  const [drawing, setDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<Point | null>(null)
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null)

  // 連続描画時の始点（直前線分の終点から自動で繋ぐ）
  const [polylineLastPoint, setPolylineLastPoint] = useState<Point | null>(null)

  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>(() =>
    initialSelectedSegmentId ? [initialSelectedSegmentId] : [],
  )
  const [unitPrefsTick, setUnitPrefsTick] = useState(0)

  const focusedSegmentId =
    selectedSegmentIds.length > 0
      ? selectedSegmentIds[selectedSegmentIds.length - 1]!
      : null

  const recentUnitIds = useMemo(() => {
    void unitPrefsTick
    return readRecentUnitIds(projectId)
  }, [projectId, unitPrefsTick])

  const favoriteUnitIds = useMemo(() => {
    void unitPrefsTick
    return readFavoriteUnitIds(projectId)
  }, [projectId, unitPrefsTick])
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
      const color: SegmentColor | null = isSegmentColor(colorRaw)
        ? colorRaw
        : null

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

  // 連続描画(끝점 이어붙이기) 모드의 시작점/끝점 연결 상태를 관리합니다.
  // select로 나가면 체인을 끊습니다.
  useEffect(() => {
    if (tool === 'select') setPolylineLastPoint(null)
  }, [tool])

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

  /** サーバーで空でも、ブラウザのセッションで再取得（RLS/SSR差異のフォロー） */
  const [clientUnits, setClientUnits] = useState<Unit[] | null>(null)

  useEffect(() => {
    if (serverUnits.length > 0) {
      setClientUnits(null)
      return
    }
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('units')
        .select('*')
        .order('created_at', { ascending: true })
        .returns<Unit[]>()
      if (cancelled) return
      if (error) {
        console.warn('[DrawingViewer] units の読み込みに失敗:', error.message)
        setClientUnits([])
        return
      }
      setClientUnits(data ?? [])
    })()
    return () => {
      cancelled = true
    }
    // supabase は createClient() の参照が変わるため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 上記
  }, [serverUnits.length])

  const effectiveUnits = serverUnits.length > 0 ? serverUnits : (clientUnits ?? [])
  const focusedSegment = useMemo(
    () => (focusedSegmentId ? segments.find((s) => s.id === focusedSegmentId) ?? null : null),
    [focusedSegmentId, segments],
  )
  const focusedSegmentUnit = useMemo(() => {
    if (!focusedSegment?.unit_id) return null
    return effectiveUnits.find((u) => u.id === focusedSegment.unit_id) ?? null
  }, [focusedSegment, effectiveUnits])

  /** DB保存済み（UUID）かつ無効でないユニットのみモーダル・割当に使う */
  const persistedActiveUnits = useMemo(
    () => effectiveUnits.filter((u) => u.is_active !== false && isPersistedUnitId(u.id)),
    [effectiveUnits],
  )

  const unitById = useMemo(() => {
    return new Map(effectiveUnits.map((u) => [u.id, u]))
  }, [effectiveUnits])

  const segmentsSortedForLabels = [...segments].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  )
  const labelById = getSegmentLabelMap(segments)

  function computeNextSegmentLabel(): string {
    const last = segmentsSortedForLabels[segmentsSortedForLabels.length - 1]
    if (segmentsSortedForLabels.length === 0) return 'S01'
    const lb = labelById[last.id]
    const m = lb?.match(/^S(\d{2})$/)
    if (m) return `S${String(Number(m[1]) + 1).padStart(2, '0')}`
    return `S${String(segmentsSortedForLabels.length + 1).padStart(2, '0')}`
  }

  const activeUnitStorageKey = `project:${projectId}:activeDrawingUnitId`
  const activeTemplateStorageKey = `project:${projectId}:activeTemplateId`
  const activeColorStorageKey = `project:${projectId}:activeTemplateColor`
  const [activeDrawingUnitId, setActiveDrawingUnitId] = useState<string | null>(null)
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [activeTemplateColor, setActiveTemplateColor] = useState<SegmentColor>('red')

  const templateSummaries = useMemo<TemplateSummary[]>(
    () => buildTemplateSummaries(persistedActiveUnits),
    [persistedActiveUnits],
  )

  const activeUnit = useMemo(
    () =>
      activeDrawingUnitId
        ? persistedActiveUnits.find((u) => u.id === activeDrawingUnitId) ?? null
        : null,
    [activeDrawingUnitId, persistedActiveUnits],
  )

  // アクティブユニット選択肢: 色ベース（例: red）ごとに 1 件だけ代表を持つ
  // （描画時には後続 prompt で存在する番号（1/2/3等）を選択）
  const activeUnitChoices = useMemo(() => {
    const baseToRep = new Map<string, Unit>()
    const sorted = [...persistedActiveUnits].sort(
      (a, b) => (a.mark_number ?? Number.MAX_SAFE_INTEGER) - (b.mark_number ?? Number.MAX_SAFE_INTEGER),
    )
    for (const u of sorted) {
      const base = getUnitCodeBase(u)
      if (!baseToRep.has(base)) baseToRep.set(base, u)
    }
    return [...baseToRep.values()]
  }, [persistedActiveUnits])

  const activeTemplate = useMemo(
    () => templateSummaries.find((t) => t.id === activeTemplateId) ?? null,
    [templateSummaries, activeTemplateId],
  )

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(activeUnitStorageKey)
      if (raw && isPersistedUnitId(raw)) setActiveDrawingUnitId(raw)
    } catch {
      // ignore
    }
  }, [activeUnitStorageKey, projectId])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(activeTemplateStorageKey)
      if (!raw) return
      setActiveTemplateId(raw)
    } catch {
      // ignore
    }
  }, [activeTemplateStorageKey, projectId])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(activeColorStorageKey)
      if (!raw) return
      setActiveTemplateColor(normalizeSegmentColor(raw))
    } catch {
      // ignore
    }
  }, [activeColorStorageKey, projectId])

  useEffect(() => {
    try {
      if (activeDrawingUnitId) {
        window.localStorage.setItem(activeUnitStorageKey, activeDrawingUnitId)
      } else {
        window.localStorage.removeItem(activeUnitStorageKey)
      }
    } catch {
      // ignore
    }
  }, [activeDrawingUnitId, activeUnitStorageKey])

  useEffect(() => {
    try {
      if (activeTemplateId) {
        window.localStorage.setItem(activeTemplateStorageKey, activeTemplateId)
      } else {
        window.localStorage.removeItem(activeTemplateStorageKey)
      }
      window.localStorage.setItem(activeColorStorageKey, activeTemplateColor)
    } catch {
      // ignore
    }
  }, [activeTemplateId, activeTemplateStorageKey, activeTemplateColor, activeColorStorageKey])

  useEffect(() => {
    if (!activeDrawingUnitId) return
    if (!persistedActiveUnits.some((u) => u.id === activeDrawingUnitId)) {
      setActiveDrawingUnitId(null)
    }
  }, [activeDrawingUnitId, persistedActiveUnits])

  /** 保存済みユニットが1件だけなら、アクティブ未設定時に自動選択（連続描画の摩擦を減らす） */
  useEffect(() => {
    if (activeDrawingUnitId) return
    if (persistedActiveUnits.length !== 1) return
    setActiveDrawingUnitId(persistedActiveUnits[0].id)
  }, [activeDrawingUnitId, persistedActiveUnits])

  useEffect(() => {
    if (templateSummaries.length === 0) {
      setActiveTemplateId(null)
      return
    }
    if (activeTemplateId && templateSummaries.some((t) => t.id === activeTemplateId)) return
    setActiveTemplateId(templateSummaries[0].id)
  }, [activeTemplateId, templateSummaries])

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

    segments.forEach((seg) => {
      const isSelected = selectedSegmentIds.includes(seg.id)
      const isSpacing = seg.bar_type === 'SPACING' && seg.quantity === 0
      const isLastSplit =
        !!lastSplitMarker && lastSplitMarker.segmentIds.includes(seg.id)
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      const segColor = getSegmentColor(seg, effectiveUnits)
      const baseStroke = isSpacing
        ? isSelected
          ? '#0f766e'
          : '#22c55e'
        : getSegmentStrokeHex(segColor, isSelected)
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
        : getSegmentStrokeHex(segColor, isSelected)
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
        const circleNum = getSegmentMarkNumberForCanvas(seg, effectiveUnits)
        const stroke = getSegmentStrokeHex(segColor, false)
        const r = 9 / scale
        const yCenter = midY - 2 / scale

        // Circle marker
        ctx.beginPath()
        ctx.arc(midX, yCenter, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.fill()
        ctx.lineWidth = 2 / scale
        ctx.strokeStyle = isSelected ? getSegmentStrokeHex(segColor, true) : stroke
        ctx.stroke()

        // Number inside circle (画面基準で正立表示)
        ctx.save()
        ctx.translate(midX, yCenter)
        ctx.rotate(counterAngleRad)
        ctx.font = `bold ${11 / scale}px sans-serif`
        ctx.fillStyle = isSelected ? getSegmentStrokeHex(segColor, true) : stroke
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(circleNum != null ? String(circleNum) : '-', 0, 0)
        ctx.restore()

        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'

        // 円内の下段は長さ（mmは省略）。色はグループで区別する
        // 円内の下段（長さ）も画面基準で正立表示
        const linkedUnit = seg.unit_id ? unitById.get(seg.unit_id) ?? null : null
        const unitLen = linkedUnit?.length_mm
        const displayLen =
          typeof unitLen === 'number' && Number.isFinite(unitLen) ? unitLen : seg.length_mm
        ctx.save()
        ctx.translate(midX, yCenter + 12 / scale)
        ctx.rotate(counterAngleRad)
        ctx.font = `${9 / scale}px sans-serif`
        ctx.fillStyle = stroke
        ctx.fillText(`${displayLen}`, 0, 0)
        ctx.restore()
      }
    })

    // 直角で接続する線分の交点に、短い境界ティック（|）を描画
    drawRightAngleBoundaryTicks(ctx, segments, scale, effectiveUnits)

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
    selectedSegmentIds,
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
    effectiveUnits,
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
    if (!selectedSegmentIds.includes(splitArmedSegmentId)) {
      setSplitArmedSegmentId(null)
      setSplitHoverPoint(null)
    }
  }, [selectedSegmentIds, splitArmedSegmentId])

  useEffect(() => {
    if (!lastSplitMarker) return
    if (!focusedSegmentId) return
    if (!lastSplitMarker.segmentIds.includes(focusedSegmentId)) {
      setLastSplitMarker(null)
    }
  }, [focusedSegmentId, lastSplitMarker])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toUpperCase()
      const isTyping =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t?.isContentEditable

      if (e.key === 'Escape') {
        if (newSegmentDraft) {
          setNewSegmentDraft(null)
          return
        }
        setSplitArmedSegmentId(null)
        setSplitHoverPoint(null)
        if (drawing) {
          setDrawing(false)
          setStartPoint(null)
          setCurrentPoint(null)
          return
        }
        if (tool === 'draw' || tool === 'spacing') {
          setPolylineLastPoint(null)
          setTool('select')
          return
        }
        return
      }

      if (isTyping) return

      const setActiveByUnitId = (unitId: string) => {
        setActiveDrawingUnitId(unitId)
        const picked = persistedActiveUnits.find((u) => u.id === unitId) ?? null
        if (picked) {
          setActiveTemplateId(picked.template_id ?? `shape:${picked.shape_type}`)
          setActiveTemplateColor(normalizeSegmentColor(picked.color))
        }
        pushRecentUnitId(projectId, unitId)
        setUnitPrefsTick((x) => x + 1)
      }

      const setUnitByCode = (code: string) => {
        const u = effectiveUnits.find(
          (x) =>
            x.is_active !== false && isPersistedUnitId(x.id) && x.code === code,
        )
        if (!u) return
        setActiveByUnitId(u.id)
      }

      const setUnitByColor = (color: 'red' | 'blue') => {
        setActiveTemplateColor(color)
        const list = effectiveUnits
          .filter(
            (u) =>
              u.is_active !== false &&
              isPersistedUnitId(u.id) &&
              normalizeSegmentColor(u.color) === color,
          )
          .sort((a, b) => (a.mark_number ?? 0) - (b.mark_number ?? 0))
        const u = list[0]
        if (!u) return
        setActiveByUnitId(u.id)
      }

      if (e.key === '1') {
        e.preventDefault()
        setUnitByCode('red-1')
        return
      }
      if (e.key === '2') {
        e.preventDefault()
        setUnitByCode('red-2')
        return
      }
      if (e.key === '4') {
        e.preventDefault()
        setUnitByCode('blue-4')
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        setUnitByColor('red')
        return
      }
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        setUnitByColor('blue')
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const rebarSorted = [...segments]
          .filter((s) => !(s.bar_type === 'SPACING' && s.quantity === 0))
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        const last = rebarSorted[0]
        if (!last) return
        if (last.unit_id && isPersistedUnitId(last.unit_id)) {
          setActiveDrawingUnitId(last.unit_id)
          const lastUnit = effectiveUnits.find((u) => u.id === last.unit_id) ?? null
          if (lastUnit) {
            setActiveTemplateId(lastUnit.template_id ?? `shape:${lastUnit.shape_type}`)
            setActiveTemplateColor(normalizeSegmentColor(lastUnit.color))
          }
          pushRecentUnitId(projectId, last.unit_id)
          setUnitPrefsTick((x) => x + 1)
        }
        const color = getSegmentColor(last, effectiveUnits)
        const bars = getSegmentBars(last, effectiveUnits)
        if (bars.length > 0) {
          writeLastUsedRebarDraft({ color, bars })
        }
        return
      }

      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        setTool('draw')
        return
      }
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        setTool('spacing')
        return
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        setTool('select')
        return
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        const rebarSorted = [...segments]
          .filter((s) => !(s.bar_type === 'SPACING' && s.quantity === 0))
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        const last = rebarSorted[0]
        if (!last) return
        if (last.unit_id && isPersistedUnitId(last.unit_id)) {
          setActiveDrawingUnitId(last.unit_id)
          const lastUnit = effectiveUnits.find((u) => u.id === last.unit_id) ?? null
          if (lastUnit) {
            setActiveTemplateId(lastUnit.template_id ?? `shape:${lastUnit.shape_type}`)
            setActiveTemplateColor(normalizeSegmentColor(lastUnit.color))
          }
          pushRecentUnitId(projectId, last.unit_id)
          setUnitPrefsTick((x) => x + 1)
        }
        const color = getSegmentColor(last, effectiveUnits)
        const bars = getSegmentBars(last, effectiveUnits)
        if (bars.length > 0) {
          writeLastUsedRebarDraft({ color, bars })
        }
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [segments, effectiveUnits, projectId, tool, drawing, newSegmentDraft])

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
    if (e.button === 1) {
      setPanning(true)
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
      return
    }

    if ((tool === 'draw' || tool === 'spacing') && e.button === 0) {
      const pt = screenToCanvas(e)
      const start = polylineLastPoint ?? pt
      setDrawing(true)
      setStartPoint(start)
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
      if (e.ctrlKey || e.metaKey) {
        if (found) {
          setSelectedSegmentIds((prev) => {
            if (prev.includes(found.id)) return prev.filter((id) => id !== found.id)
            return [...prev, found.id]
          })
        }
      } else {
        setSelectedSegmentIds(found ? [found.id] : [])
      }
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

  async function handleMouseUp(e: React.MouseEvent) {
    if (panning) {
      setPanning(false)
      return
    }

    if (drawing && startPoint && currentPoint && !newSegmentDraft) {
      const p1 = startPoint
      const p2 = currentPoint
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const pixelLen = Math.sqrt(dx * dx + dy * dy)

      if (pixelLen > 5) {
        const geomLen = canvasDistanceToLengthMm(p1, p2)
        const drawSnapCandidates = persistedActiveUnits
          .filter(
            (u) =>
              (u.template_id ?? `shape:${u.shape_type}`) === (activeTemplateId ?? '') &&
              normalizeSegmentColor(u.color) === normalizeSegmentColor(activeTemplateColor),
          )
          .map((u) => u.length_mm)
          .filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
        const snappedLen = snapLengthMm(geomLen, drawSnapCandidates)
        const kind = tool === 'spacing' ? 'spacing' : 'rebar'
        const useModal = e.altKey

        if (useModal) {
          openNewSegmentForm(kind, p1, p2, { precomputedLengthMm: snappedLen })
        } else if (kind === 'spacing') {
          await quickInsertSpacing(p1, p2, snappedLen)
        } else {
          await quickInsertRebar(p1, p2, snappedLen)
        }
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

  function openNewSegmentForm(
    kind: 'rebar' | 'spacing',
    p1: Point,
    p2: Point,
    opts?: { precomputedLengthMm?: number },
  ) {
    const last = segmentsSortedForLabels[segmentsSortedForLabels.length - 1]
    const nextLabel = computeNextSegmentLabel()
    const unitDefaults = kind === 'rebar' ? activeUnit : null

    // モーダルは例外入力。ただしアクティブユニットがあれば色・鉄筋・ラベルはそこを最優先。
    const stored = kind === 'rebar' ? readLastUsedRebarDraft() : null

    const lastBars = last ? getSegmentBars(last, effectiveUnits) : []
    const barsFromUnit =
      unitDefaults?.bars?.length &&
      unitDefaults.bars.every((b) => BAR_TYPES.includes(b.diameter as (typeof BAR_TYPES)[number]))
        ? unitDefaults.bars.map((b) => ({
            barType: b.diameter,
            quantity: b.qtyPerUnit,
          }))
        : null

    const defaultBars =
      barsFromUnit ??
      (stored?.bars?.length
        ? stored.bars
        : lastBars.length
          ? lastBars
          : [{ barType: 'D10', quantity: 1 }])

    const supportedBars = defaultBars.filter((b) => BAR_TYPES.includes(b.barType as (typeof BAR_TYPES)[number]))
    const finalBars = supportedBars.length ? supportedBars : [{ barType: 'D10', quantity: 1 }]

    const defaultColor: SegmentColor =
      kind === 'rebar'
        ? normalizeSegmentColor(
            activeTemplateColor ??
              unitDefaults?.color ??
              stored?.color ??
              (last ? getSegmentColor(last, effectiveUnits) : 'red'),
          )
        : 'red'

    const lengthMmInit =
      opts?.precomputedLengthMm != null ? String(opts.precomputedLengthMm) : ''

    const labelForRebar =
      unitDefaults != null
        ? (unitDefaults.code ?? unitDefaults.name ?? nextLabel)
        : nextLabel

    setNewSegmentDraft({
      kind,
      p1,
      p2,
      lengthMm: lengthMmInit,
      color: defaultColor,
      bars:
        kind === 'spacing'
          ? []
          : finalBars.map((b) => ({
              barType: b.barType,
              quantity: String(b.quantity),
            })),
      label: kind === 'spacing' ? '間隔' : labelForRebar,
    })
  }

  async function quickInsertRebar(p1: Point, p2: Point, lengthMm: number) {
    const nextLabel = computeNextSegmentLabel()
    const templateId = activeTemplateId ?? templateSummaries[0]?.id ?? null
    const preferredColor = normalizeSegmentColor(activeTemplateColor)

    let bars: SegmentBarItem[] = []
    let color: SegmentColor = preferredColor
    let unitId: string | null = null
    let unitCode: string | null = null
    let unitName: string | null = null
    let markNumber: number | null = null
    let label: string = nextLabel
    let appliedByPrompt = false

    if (activeUnit) {
      const base = getUnitCodeBase(activeUnit)
      const numbered = persistedActiveUnits
        .filter((u) => getUnitCodeBase(u) === base && typeof u.mark_number === 'number')
        .sort((a, b) => (a.mark_number ?? 0) - (b.mark_number ?? 0))

      if (numbered.length > 0) {
        const availableMarks = numbered.map((u) => u.mark_number as number)
        const defaultMark =
          activeUnit.mark_number && availableMarks.includes(activeUnit.mark_number)
            ? activeUnit.mark_number
            : availableMarks[0]
        const pickedRaw = window.prompt(
          `${base} の番号を入力してください (${availableMarks.join(', ')})`,
          String(defaultMark),
        )
        if (pickedRaw == null) return
        const picked = Number.parseInt(pickedRaw.trim(), 10)
        const chosenUnit = numbered.find((u) => u.mark_number === picked) ?? null
        if (!Number.isFinite(picked) || !chosenUnit) {
          alert('存在しないユニットです。')
          return
        }
        bars = chosenUnit.bars
          .filter((b) => BAR_TYPES.includes(b.diameter as (typeof BAR_TYPES)[number]))
          .map((b) => ({ barType: b.diameter, quantity: b.qtyPerUnit }))
        color = normalizeSegmentColor(chosenUnit.color)
        unitId = chosenUnit.id
        unitCode = chosenUnit.code ?? null
        unitName = chosenUnit.name ?? null
        markNumber = chosenUnit.mark_number ?? picked
        label = String(markNumber)
        setActiveDrawingUnitId(chosenUnit.id)
        setActiveTemplateId(chosenUnit.template_id ?? `shape:${chosenUnit.shape_type}`)
        setActiveTemplateColor(normalizeSegmentColor(chosenUnit.color))
        appliedByPrompt = true
      }
    }

    if (!appliedByPrompt && enableTemplateVariantFlow && templateId) {
      const resolved = resolveVariantByTemplateColorLength(
        persistedActiveUnits,
        templateId,
        preferredColor,
        lengthMm,
      )
      let chosen = resolved.matched
      if (!chosen && resolved.candidates.length > 0) {
        const list = resolved.candidates
          .map((c, i) => `${i + 1}. ${c.code ?? c.unitName} (${c.lengthMm ?? '-'}mm)`)
          .join('\n')
        const pickRaw = window.prompt(
          `一致する Variant がありません。\n候補を選択してください（番号入力）\n\n${list}`,
          '1',
        )
        const idx = Number.parseInt((pickRaw ?? '').trim(), 10)
        if (Number.isFinite(idx) && idx >= 1 && idx <= resolved.candidates.length) {
          chosen = resolved.candidates[idx - 1]!
        }
      }
      if (!chosen && resolved.createSuggestion) {
        const goCreate = window.confirm(
          `Variant が見つかりません。\nTemplate: ${resolved.createSuggestion.templateId}\nColor: ${resolved.createSuggestion.color}\nLength: ${resolved.createSuggestion.lengthMm}mm\n\n/units で新規 Variant を作成しますか？`,
        )
        if (goCreate) {
          router.push(
            `/units?templateId=${encodeURIComponent(resolved.createSuggestion.templateId)}&color=${encodeURIComponent(resolved.createSuggestion.color)}&length_mm=${resolved.createSuggestion.lengthMm}`,
          )
        }
        return
      }
      if (chosen) {
        const matchedUnit = persistedActiveUnits.find((u) => u.id === chosen.variantId) ?? null
        color = chosen.color
        bars = chosen.bars.map((b) => ({ barType: b.diameter, quantity: b.qtyPerUnit }))
        unitId = chosen.variantId
        unitCode = chosen.code
        unitName = chosen.unitName
        markNumber = chosen.markNumber
        label = chosen.code ?? chosen.unitName ?? nextLabel
        setActiveDrawingUnitId(chosen.variantId)
        setActiveTemplateId(chosen.templateId)
        setActiveTemplateColor(chosen.color)
        if (matchedUnit) {
          pushRecentUnitId(projectId, matchedUnit.id)
          setUnitPrefsTick((x) => x + 1)
        }
      }
    }

    if (bars.length === 0) {
      const stored = readLastUsedRebarDraft()
      const last = segmentsSortedForLabels[segmentsSortedForLabels.length - 1]
      const lastBars = last ? getSegmentBars(last, effectiveUnits) : []
      const defaultBars =
        stored?.bars?.length
          ? stored.bars
          : lastBars.length
            ? lastBars
            : [{ barType: 'D10', quantity: 1 }]
      const supportedBars = defaultBars.filter((b) =>
        BAR_TYPES.includes(b.barType as (typeof BAR_TYPES)[number]),
      )
      bars = supportedBars.length ? supportedBars : [{ barType: 'D10', quantity: 1 }]
      color = normalizeSegmentColor(stored?.color ?? preferredColor)
      if (!appliedByPrompt) {
        unitId = null
        unitCode = null
        unitName = null
        markNumber = null
        label = nextLabel
      }
    }

    const legacy = legacyFieldsFromBars(bars)
    const memo = encodeSegmentMeta({ v: 1, color, bars, note: null })

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
        label: label.trim() || null,
        memo,
        unit_id: unitId,
        unit_code: unitCode,
        unit_name: unitName,
        mark_number: markNumber,
      })
      .select()
      .single<DrawingSegment>()

    if (error) {
      alert('保存に失敗しました: ' + error.message)
      return
    }
    if (data) {
      setSegments((prev) => [...prev, data])
      setSelectedSegmentIds([data.id])
      setPolylineLastPoint(p2)
      setLastAction({ type: 'create', segment: data })
      writeLastUsedRebarDraft({ color, bars })
      if (unitId) {
        pushRecentUnitId(projectId, unitId)
        setUnitPrefsTick((x) => x + 1)
      }
    }
  }

  async function quickInsertSpacing(p1: Point, p2: Point, lengthMm: number) {
    const { data, error } = await supabase
      .from('drawing_segments')
      .insert({
        drawing_id: drawingId,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        length_mm: lengthMm,
        quantity: 0,
        bar_type: 'SPACING',
        label: '間隔',
        memo: null,
        unit_id: null,
        unit_code: null,
        unit_name: null,
        mark_number: null,
      })
      .select()
      .single<DrawingSegment>()

    if (error) {
      alert('保存に失敗しました: ' + error.message)
      return
    }
    if (data) {
      setSegments((prev) => [...prev, data])
      setSelectedSegmentIds([data.id])
      setPolylineLastPoint(p2)
      setLastAction({ type: 'create', segment: data })
    }
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
          color: normalizeSegmentColor(newSegmentDraft.color),
          bars,
          note: null,
        })

    const unitRow = !isSpacing && activeUnit ? activeUnit : null

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
        unit_id: unitRow?.id ?? null,
        unit_code: unitRow?.code ?? null,
        unit_name: unitRow?.name ?? null,
        mark_number: unitRow?.mark_number ?? null,
      })
      .select()
      .single<DrawingSegment>()

    if (!error && data) {
      setSegments((prev) => [...prev, data])
      setSelectedSegmentIds([data.id])
      setPolylineLastPoint(p2)
      setLastAction({ type: 'create', segment: data })
      if (!isSpacing) {
        writeLastUsedRebarDraft({
          color: normalizeSegmentColor(newSegmentDraft.color),
          bars,
        })
        if (unitRow?.id) {
          pushRecentUnitId(projectId, unitRow.id)
          setUnitPrefsTick((x) => x + 1)
        }
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

  async function bulkApplyTemplateColorToSelection(templateId: string, color: SegmentColor) {
    if (!enableTemplateVariantFlow) return
    const ids = selectedSegmentIds.filter((sid) => {
      const s = segments.find((x) => x.id === sid)
      return s && !(s.bar_type === 'SPACING' && s.quantity === 0)
    })
    if (ids.length === 0) return

    for (const id of ids) {
      const seg = segments.find((s) => s.id === id)
      if (!seg) continue
      const resolved = resolveVariantByTemplateColorLength(
        persistedActiveUnits,
        templateId,
        color,
        seg.length_mm,
      )
      const chosen = resolved.matched ?? resolved.candidates[0] ?? null
      if (!chosen) continue
      const bars: SegmentBarItem[] = chosen.bars.map((b) => ({
        barType: b.diameter,
        quantity: b.qtyPerUnit,
      }))
      const legacy = legacyFieldsFromBars(bars)
      const { meta, legacyNote } = decodeSegmentMeta(seg.memo)
      const memo = encodeSegmentMeta({
        v: 1,
        color: chosen.color,
        bars,
        note: meta?.note ?? legacyNote ?? null,
      })
      await updateSegment(id, {
        memo,
        bar_type: legacy.bar_type,
        quantity: legacy.quantity,
        label: chosen.code ?? chosen.unitName,
        unit_id: chosen.variantId,
        unit_code: chosen.code ?? null,
        unit_name: chosen.unitName ?? null,
        mark_number: chosen.markNumber ?? 1,
      })
    }
    const firstApplied = persistedActiveUnits.find(
      (u) =>
        (u.template_id ?? `shape:${u.shape_type}`) === templateId &&
        normalizeSegmentColor(u.color) === normalizeSegmentColor(color),
    )
    if (firstApplied) {
      setActiveDrawingUnitId(firstApplied.id)
      setActiveTemplateId(templateId)
      setActiveTemplateColor(normalizeSegmentColor(color))
      pushRecentUnitId(projectId, firstApplied.id)
      setUnitPrefsTick((x) => x + 1)
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
        const next = prev.filter((s) => s.id !== id)
        setPolylineLastPoint(getPolylineAnchorFromSegments(next))
        return next
      })
      if (selectedSegmentIds.includes(id)) {
        setSelectedSegmentIds((prev) => prev.filter((x) => x !== id))
      }
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

    const unitFields = {
      unit_id: segment.unit_id ?? null,
      unit_code: segment.unit_code ?? null,
      unit_name: segment.unit_name ?? null,
      mark_number: segment.mark_number ?? null,
    }
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
        ...unitFields,
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
        ...unitFields,
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
    setSelectedSegmentIds([createdA.id])
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
        setSegments((prev) => {
          const next = prev.filter((s) => s.id !== segment.id)
          setPolylineLastPoint(getPolylineAnchorFromSegments(next))
          return next
        })
        setSelectedSegmentIds([])
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
        setSegments((prev) => {
          const next = [...prev, data]
          setPolylineLastPoint(getPolylineAnchorFromSegments(next))
          return next
        })
        setSelectedSegmentIds([data.id])
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
          memo: before.memo,
          unit_id: before.unit_id ?? null,
          unit_code: before.unit_code ?? null,
          unit_name: before.unit_name ?? null,
          mark_number: before.mark_number ?? null,
        })
        .eq('id', before.id)
      if (!error) {
        setSegments((prev) => {
          const next = prev.map((s) => (s.id === before.id ? before : s))
          setPolylineLastPoint(getPolylineAnchorFromSegments(next))
          return next
        })
        setSelectedSegmentIds([before.id])
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
        setSegments((prev) => {
          const next = [
            ...prev.filter((s) => !createdIds.includes(s.id)),
            restored,
          ]
          setPolylineLastPoint(getPolylineAnchorFromSegments(next))
          return next
        })
        setSelectedSegmentIds([restored.id])
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
      const segColor = getSegmentColor(seg, effectiveUnits)
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      ctx.strokeStyle = getSegmentStrokeHex(segColor, false)
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

  return (
    <div className="flex flex-1 gap-2 min-h-0">
      {/* Canvas area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-2 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
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
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-white/80 px-2 py-1">
            <span className="text-[11px] font-medium text-muted whitespace-nowrap">
              アクティブユニット
            </span>
            <select
              value={activeDrawingUnitId ?? ''}
              onChange={(ev) => {
                const v = ev.target.value ? ev.target.value : null
                setActiveDrawingUnitId(v)
                if (v) {
                  const picked = persistedActiveUnits.find((u) => u.id === v) ?? null
                  if (picked) {
                    setActiveTemplateId(picked.template_id ?? `shape:${picked.shape_type}`)
                    setActiveTemplateColor(normalizeSegmentColor(picked.color))
                  }
                  pushRecentUnitId(projectId, v)
                  setUnitPrefsTick((x) => x + 1)
                }
              }}
              className="max-w-[200px] rounded border border-border px-2 py-1 text-xs outline-none focus:border-primary"
              title="先に選ぶと、線を描くだけで色・円番号・鉄筋・unit_id が自動適用されます（推奨）。詳細入力は Alt+描画。"
            >
              <option value="">ユニットを選択してください</option>
              {activeUnitChoices.map((u) => {
                const base = getUnitCodeBase(u)
                const marks = Array.from(
                  new Set(
                    persistedActiveUnits
                      .filter((x) => getUnitCodeBase(x) === base)
                      .map((x) => x.mark_number)
                      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
                  ),
                ).sort((a, b) => a - b)

                const label = marks.length ? `${base}(${marks.join(',')})` : base

                return (
                  <option key={u.id} value={u.id}>
                    {label.slice(0, 48)}
                  </option>
                )
              })}
            </select>
            {activeUnit ? (
              <>
                <span
                  className="hidden sm:inline text-[11px] text-muted truncate max-w-[180px]"
                  title={activeUnit.name}
                >
                  {activeUnit.name}
                </span>
                {(activeUnit.detail_spec || activeUnit.detail_geometry) && (
                  <span className="hidden sm:inline rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
                    詳細形状
                  </span>
                )}
              </>
            ) : null}
            <button
              type="button"
              disabled={!activeDrawingUnitId}
              title="お気に入りに追加/解除"
              className="rounded border border-border px-1.5 py-0.5 text-xs disabled:opacity-40"
              onClick={() => {
                if (!activeDrawingUnitId) return
                toggleFavoriteUnitId(projectId, activeDrawingUnitId)
                setUnitPrefsTick((x) => x + 1)
              }}
            >
              {activeDrawingUnitId && favoriteUnitIds.includes(activeDrawingUnitId) ? '★' : '☆'}
            </button>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-[10px]">
            {favoriteUnitIds.length > 0 ? (
              <>
                <span className="text-muted shrink-0">お気に入り</span>
                {favoriteUnitIds.map((fid) => {
                  const u = persistedActiveUnits.find((x) => x.id === fid)
                  if (!u) return null
                  return (
                    <button
                      key={fid}
                      type="button"
                      title={u.name}
                      className={`rounded border px-1.5 py-0.5 font-medium ${
                        activeDrawingUnitId === fid
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-white hover:bg-gray-50'
                      }`}
                      style={{
                        borderColor: getSegmentStrokeHex(normalizeSegmentColor(u.color), false),
                        color: getSegmentStrokeHex(normalizeSegmentColor(u.color), true),
                      }}
                      onClick={() => {
                        setActiveDrawingUnitId(fid)
                        pushRecentUnitId(projectId, fid)
                        setUnitPrefsTick((x) => x + 1)
                      }}
                    >
                      {u.code ?? u.name}
                    </button>
                  )
                })}
              </>
            ) : null}
            {/* 最近: UI상 제거（표시 단순화） */}
          </div>
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
              : '推奨: テンプレート+色を先に選択→線を描く（長さから Variant を自動解決）／Esc:描画中はストロークのみ取消→もう一度Escで選択モード／D:描画 G:間隔 S:選択 Enter/C:直前線をアクティブに／Alt+描画:詳細モーダル'}
          </span>
          </div>
          {persistedActiveUnits.length === 0 ? (
            <p className="text-[11px] leading-snug text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 max-w-3xl">
              {effectiveUnits.length === 0
                ? '図面で選べる保存済みユニットがありません。ユニット管理で「新規作成」→「保存」するか、supabase/seed-default-units.sql を実行して初期データを投入してください。'
                : 'ユニットは読み込めましたが、すべて無効（無効化）か、図面で使えないIDのため一覧に表示されていません。'}
            </p>
          ) : null}
        </div>
        <div
          ref={containerRef}
          className="relative flex-1 rounded-lg border border-border bg-gray-50 overflow-hidden"
          style={{
            cursor:
              tool === 'draw' || tool === 'spacing'
                ? 'crosshair'
                : panning
                  ? 'grabbing'
                  : 'default',
          }}
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
        selectedSegmentIds={selectedSegmentIds}
        onReplaceSelection={(ids) => setSelectedSegmentIds(ids)}
        onToggleSegmentSelection={(id) =>
          setSelectedSegmentIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
        onBulkApplyTemplateColor={bulkApplyTemplateColorToSelection}
        onUpdate={updateSegment}
        onDelete={deleteSegment}
        onSplit={(id) => {
          setTool('select')
          setSelectedSegmentIds([id])
          setSplitArmedSegmentId(id)
          setSplitHoverPoint(null)
          setLastSplitMarker(null)
        }}
        barTypes={BAR_TYPES}
        projectId={projectId}
        canUndo={!!lastAction}
        onUndo={handleUndo}
        units={effectiveUnits}
        templateOptions={templateSummaries.map((t) => ({ id: t.id, name: t.name }))}
        activeTemplateId={activeTemplateId ?? ''}
        activeTemplateColor={activeTemplateColor}
      />

      {newSegmentDraft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white shadow-lg flex flex-col max-h-[90vh]">
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <h2 className="text-base font-semibold">新しい線分の入力</h2>
              {newSegmentDraft.kind === 'rebar' && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-muted mb-2">
                    登録ユニットから反映（任意）
                  </div>
                  {persistedActiveUnits.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {persistedActiveUnits.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setNewSegmentDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    color: normalizeSegmentColor(u.color),
                                    bars: u.bars.map((b) => ({
                                      barType: b.diameter,
                                      quantity: String(b.qtyPerUnit),
                                    })),
                                    label: u.code ?? u.name ?? prev.label,
                                  }
                                : prev,
                            )
                          }}
                          className="rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-colors hover:shadow-sm bg-white"
                          style={{
                            borderColor: getSegmentStrokeHex(
                              normalizeSegmentColor(u.color),
                              false,
                            ),
                            color: getSegmentStrokeHex(
                              normalizeSegmentColor(u.color),
                              true,
                            ),
                          }}
                        >
                          {u.code ?? u.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted leading-relaxed">
                      ここにチップが出るのは、
                      <strong className="text-foreground">ユニット管理</strong>
                      で<strong>保存済み</strong>の有効なユニットだけです。
                      画面にだけあるモック／未保存のユニットは表示されません。
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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
                    value={normalizeSegmentColor(newSegmentDraft.color)}
                    onChange={(e) =>
                      setNewSegmentDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              color: normalizeSegmentColor(e.target.value),
                            }
                          : prev,
                      )
                    }
                    className="w-full rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
                  >
                    {SEGMENT_COLOR_DEFINITIONS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.labelJa}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">ユニット</label>
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
            </div>{/* end overflow scroll area */}
            <div className="px-6 pb-6 pt-4 border-t border-border flex justify-end gap-2">
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

function UnitDetailMiniPreview({ unit }: { unit: Unit }) {
  const template = shapeTypeToDetailTemplate(unit.shape_type)
  const spec = normalizeDetailSpecForTemplate(
    template,
    unit.detail_spec ?? getDefaultDetailSpec(template),
  )
  const sketch = buildShapeSketch(template, spec)
  const byKey = Object.fromEntries(sketch.geometry.points.map((p) => [p.key, p]))
  const { minX, minY, maxX, maxY } = sketch.geometry.bounds
  const pad = 18
  const w = Math.max(120, maxX - minX + pad * 2)
  const h = Math.max(70, maxY - minY + pad * 2)
  const color = getSegmentStrokeHex(normalizeSegmentColor(unit.color), false)

  return (
    <svg viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`} className="h-20 w-full rounded border border-border bg-slate-50">
      {sketch.geometry.segments.map((s, idx) => {
        const p1 = byKey[s.from]
        const p2 = byKey[s.to]
        if (!p1 || !p2) return null
        return (
          <line
            key={`${s.from}-${s.to}-${idx}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
          />
        )
      })}
      <text x={minX - pad + 8} y={maxY + pad - 6} fontSize={10} fill="#334155">
        pitch: {spec.pitch} / mark: {unit.mark_number ?? '-'}
      </text>
    </svg>
  )
}

type TickArm = {
  ux: number
  uy: number
  len: number
  color: SegmentColor
}

function drawRightAngleBoundaryTicks(
  ctx: CanvasRenderingContext2D,
  segments: DrawingSegment[],
  scale: number,
  units: Unit[] | null | undefined,
) {
  const rebarSegments = segments.filter(
    (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
  )

  const byPoint = new Map<string, { point: Point; arms: TickArm[] }>()
  const pointKey = (p: Point) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`

  for (const seg of rebarSegments) {
    const c = getSegmentColor(seg, units)
    const p1 = { x: seg.x1, y: seg.y1 }
    const p2 = { x: seg.x2, y: seg.y2 }
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const d = Math.hypot(dx, dy)
    if (d < 1e-6) continue

    const a1: TickArm = { ux: dx / d, uy: dy / d, len: d, color: c }
    const a2: TickArm = { ux: -dx / d, uy: -dy / d, len: d, color: c }

    const k1 = pointKey(p1)
    const e1 = byPoint.get(k1) ?? { point: p1, arms: [] }
    e1.arms.push(a1)
    byPoint.set(k1, e1)

    const k2 = pointKey(p2)
    const e2 = byPoint.get(k2) ?? { point: p2, arms: [] }
    e2.arms.push(a2)
    byPoint.set(k2, e2)
  }

  const halfTick = 5 / scale

  ctx.save()
  ctx.lineWidth = 2 / scale

  for (const { point, arms } of byPoint.values()) {
    // 端点でちょうど2本の線が繋がる接点だけに境界ティックを出す（直線連結を含む）
    if (arms.length !== 2) continue

    // 長い方の腕を基準に、その法線方向へ短い境界ティックを描く
    const [a0, a1] = arms
    const base = a0.len >= a1.len ? a0 : a1
    const nx = -base.uy
    const ny = base.ux
    const stroke = getSegmentStrokeHex(base.color, false)

    ctx.strokeStyle = stroke
    ctx.beginPath()
    ctx.moveTo(point.x - nx * halfTick, point.y - ny * halfTick)
    ctx.lineTo(point.x + nx * halfTick, point.y + ny * halfTick)
    ctx.stroke()
  }

  ctx.restore()
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
