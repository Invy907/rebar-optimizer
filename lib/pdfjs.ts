let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

function assetBase(version: string) {
  return `//unpkg.com/pdfjs-dist@${version}`
}

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${assetBase(pdfjs.version)}/build/pdf.worker.min.mjs`
      return pdfjs
    })
  }
  return pdfjsPromise
}

/**
 * cMap と標準フォントの配信元を指定しないと、CJK フォントを含む図面で
 * "translateFont failed" の警告が出て文字が描画されない場合がある。
 */
export async function loadPdfDocument(data: ArrayBuffer) {
  const pdfjs = await getPdfjs()
  const base = assetBase(pdfjs.version)

  return pdfjs.getDocument({
    data,
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
  }).promise
}
