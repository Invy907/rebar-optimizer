export interface OcrToken {
  text: string
  confidence: number | null
  bbox: { x: number; y: number; w: number; h: number }
}

type VisionVertex = { x?: number; y?: number }
type VisionWord = {
  confidence?: number
  symbols?: Array<{ text?: string }>
  boundingBox?: { vertices?: VisionVertex[] }
}
type VisionParagraph = { words?: VisionWord[] }
type VisionBlock = { paragraphs?: VisionParagraph[] }
type VisionPage = { blocks?: VisionBlock[] }
type VisionAnnotation = { pages?: VisionPage[] }
type VisionResponse = {
  responses?: Array<{
    error?: { message?: string }
    fullTextAnnotation?: VisionAnnotation
  }>
}

function bboxFromVertices(vertices: VisionVertex[] | undefined): OcrToken['bbox'] | null {
  if (!vertices || vertices.length === 0) return null
  const xs = vertices.map((v) => Number(v.x ?? 0))
  const ys = vertices.map((v) => Number(v.y ?? 0))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY),
  }
}

export async function analyzeImageWithGoogleVision(imageBytes: Uint8Array): Promise<OcrToken[]> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY
  if (!apiKey) {
    throw new Error('Missing GOOGLE_VISION_API_KEY')
  }

  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`
  const payload = {
    requests: [
      {
        image: { content: Buffer.from(imageBytes).toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      },
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Vision API error (${res.status}): ${text}`)
  }

  const json = (await res.json()) as VisionResponse
  const top = json.responses?.[0]
  if (!top) return []
  if (top.error?.message) throw new Error(top.error.message)

  const tokens: OcrToken[] = []
  for (const page of top.fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          const text = (word.symbols ?? []).map((s) => s.text ?? '').join('').trim()
          if (!text) continue
          const bbox = bboxFromVertices(word.boundingBox?.vertices)
          if (!bbox) continue
          tokens.push({
            text,
            confidence: typeof word.confidence === 'number' ? word.confidence : null,
            bbox,
          })
        }
      }
    }
  }

  return tokens
}
