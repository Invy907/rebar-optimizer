// pdfjs-dist のワーカー・cMap・標準フォントを public/pdfjs へ配置する。
// CDN に依存せず、社内ネットワークやオフライン環境でも図面を表示できるようにする。

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'))
const outDir = path.join(process.cwd(), 'public', 'pdfjs')

// pdfjs-dist 5.x はワーカー内でも Promise.withResolvers を使う。
// ワーカーはページとは別スコープのため、本体へ polyfill を前置きする。
const WORKER_POLYFILL =
  'if(typeof Promise.withResolvers!=="function"){' +
  'Promise.withResolvers=function(){' +
  'let resolve,reject;' +
  'const promise=new Promise((res,rej)=>{resolve=res;reject=rej});' +
  'return{promise,resolve,reject}}}\n'

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

await cp(path.join(pdfjsRoot, 'cmaps'), path.join(outDir, 'cmaps'), {
  recursive: true,
})
await cp(
  path.join(pdfjsRoot, 'standard_fonts'),
  path.join(outDir, 'standard_fonts'),
  { recursive: true },
)

const worker = await readFile(
  path.join(pdfjsRoot, 'build', 'pdf.worker.min.mjs'),
  'utf8',
)
await writeFile(
  path.join(outDir, 'pdf.worker.min.mjs'),
  WORKER_POLYFILL + worker,
)

console.log(`pdfjs assets -> ${path.relative(process.cwd(), outDir)}`)
