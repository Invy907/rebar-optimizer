/** public/pdfjs は scripts/copy-pdfjs-assets.mjs が dev / build 前に生成する。 */
const ASSET_BASE = '/pdfjs'

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

/** pdfjs-dist 5.x は Promise.withResolvers を使う（Safari 17.3 以前などは未対応）。 */
function polyfillPromiseWithResolvers() {
  if (typeof Promise.withResolvers === 'function') return

  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

async function getPdfjs() {
  if (!pdfjsPromise) {
    polyfillPromiseWithResolvers()
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${ASSET_BASE}/pdf.worker.min.mjs`
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

  return pdfjs.getDocument({
    data,
    cMapUrl: `${ASSET_BASE}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}/standard_fonts/`,
  }).promise
}
