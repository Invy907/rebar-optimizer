'use client'

import { useMemo, type ReactNode } from 'react'
import {
  aggregateAdditionalRebars,
  type AdditionalRebarGroup,
  type AdditionalRebarPlacementLike,
  type AdditionalRebarSpecRow,
} from '@/lib/corner-bar-summary'
import {
  CORNER_BAR_DIAMETERS,
  cornerBarSegmentLabelAnchors,
  cornerBarThumbPoints,
  getCornerBarShape,
  getStandardSegmentLengthsMm,
  type CornerBarCategory,
  type CornerBarShapeType,
} from '@/lib/corner-bar-presets'

/**
 * 手書きの拾い出し資料と同じ考え方で仕分ける。
 *
 * ・標準寸法どおりのコーナー筋・添え筋 → 径ごとの本数だけの行
 * ・特殊コーナー筋と、標準寸法から外れたもの → 寸法と加工長つきの行
 *
 * 全ての行を 1 つの <table> に入れる。カテゴリーごとに別の <table> にすると、
 * 見出し文字列の幅が違うせいで列がガタガタになる（表の列幅は table ごとに
 * 別々に決まるため）。1 つの表にまとめれば列は必ず揃う。
 *
 * 径が違えば別の鉄筋なので、本数の合計（コーナー筋の D13 と D10 を足す、等）は出さない。
 */

const DIAMETER_ORDER = new Map<string, number>(CORNER_BAR_DIAMETERS.map((d, i) => [d, i]))

function diameterRank(diameter: string): number {
  return DIAMETER_ORDER.get(diameter.trim().toUpperCase()) ?? DIAMETER_ORDER.size
}

/** 資料は太い径から先に書くので、この画面だけ D13 → D10 の並びにする */
function compareDiameterDesc(a: string, b: string): number {
  return diameterRank(b) - diameterRank(a) || b.localeCompare(a)
}

/** 径ごとの標準寸法を持つ筋種類か */
function hasStandardSizes(category: string): boolean {
  return category === 'CORNER' || category === 'SOE'
}


/**
 * その径の標準寸法と全ての辺が一致するか。
 * 寸法基準（芯々 / 内々 / 外々）は寸法そのものではないので見ない。
 */
function matchesStandardDims(row: AdditionalRebarSpecRow): boolean {
  const standard = getStandardSegmentLengthsMm(
    row.category as CornerBarCategory,
    row.diameter,
    row.shapeType as CornerBarShapeType,
  )
  if (!standard || standard.length !== row.segments.length) return false
  return row.segments.every((s, i) => s.lengthMm != null && s.lengthMm === standard[i])
}

/**
 * 表の 1 行。資料の書き方に合わせて 3 つのかたまりだけを持つ。
 *
 *   筋種類          鉄筋径・寸法                    加工長・本数
   *   コーナー筋      D13（600 × 600）                76本
 *   大コーナー      D10（700 × 700）                1380mm × 1
 *   曲筋 ※芯々     D13（600 × 455 × 115 × 600）    1710mm × 2
 *
 * 径と寸法、加工長と本数をそれぞれ 1 セルにまとめるのは、資料が
 * 「D10（700 × 700）」「1380㎜ × 1」という単位で書かれているため。
 * 列に分けると読む順番が資料と変わってしまう。
 *
 * group が変わる最初の行に isGroupStart を立てて、行間にすき間を入れる
 * （見出し行を別に持たず、1 行目の label にまとめて出すため）。
 */
interface SheetRow {
  key: string
  label: string
  isGroupStart: boolean
  /** 「D13」または「D13（600芯々 × 455内々…）」。径は本数行と同じ通常の太さ */
  spec: ReactNode
  /** 「76本」または「1380mm × 1」 */
  result: ReactNode
  /**
   * inline  … 鉄筋径・寸法と「○本」を同じ行に並べる（コーナー筋・添え筋）
   * stacked … 寸法を 1 行で出しきり、加工長×本数はその下の行に置く（特殊コーナー筋など）
   *
   * 寸法に辺ごとの基準を書くと横に長くなるので、本数と同じ行に収めると
   * 寸法のほうが折り返してしまう。寸法を優先して 1 行に保つための切り替え。
   */
  layout: 'inline' | 'stacked'
  /**
   * 形状図のセル。資料と同じく 1 形状につき 1 つだけ描くので、
   * ブロックの先頭行だけ図を持ち（rowSpan でまとめる）、続く行はセルを出さない。
   * 寸法を書かない行（コーナー筋・添え筋）は空のセルを 1 つ置く。
   */
  figure: { node: ReactNode; rowSpan: number } | 'empty' | 'skip'
}

/** 「600芯々 × 455内々 × …」。寸法基準は辺ごとに数字へ直結 */
function DimsText({ row }: { row: AdditionalRebarSpecRow }) {
  return <>{row.dimsDetailText || row.dimsText || '—'}</>
}

function SpecWithDiameter({ row }: { row: AdditionalRebarSpecRow }) {
  return (
    <>
      {row.diameter}
      <span className="text-muted">（</span>
      <DimsText row={row} />
      <span className="text-muted">）</span>
    </>
  )
}

function KakouchouResult({ row }: { row: AdditionalRebarSpecRow }) {
  return (
    <>
      {row.kakouchouMm == null ? '—' : `${row.kakouchouMm.toLocaleString('ja-JP')}mm`}
      <span className="px-1.5 text-muted">×</span>
      <span className="font-semibold">{row.quantity}</span>
    </>
  )
}

function buildSheetRows(groups: AdditionalRebarGroup[]): SheetRow[] {
  const rows: SheetRow[] = []

  for (const group of groups) {
    const standardKeys = new Set(
      hasStandardSizes(group.category)
        ? group.specRows.filter(matchesStandardDims).map((r) => r.key)
        : [],
    )

    // 標準寸法どおりのものも D13（600芯々 × …）のように寸法を出す（図は付けない）
    const standardRows = group.specRows
      .filter((r) => standardKeys.has(r.key))
      .sort(
        (a, b) =>
          compareDiameterDesc(a.diameter, b.diameter) ||
          a.dimsText.localeCompare(b.dimsText),
      )
    standardRows.forEach((row, i) => {
      rows.push({
        key: row.key,
        label: group.label,
        isGroupStart: i === 0,
        spec: <SpecWithDiameter row={row} />,
        result: <QuantityText quantity={row.quantity} />,
        layout: 'inline',
        figure: 'empty',
      })
    })

    // 残りは寸法を書き出す。標準寸法を持たない径（D22 / D25）もこちらに入る
    const dimsRows = group.specRows
      .filter((r) => !standardKeys.has(r.key))
      .sort(
        (a, b) =>
          compareDiameterDesc(a.diameter, b.diameter) ||
          (b.kakouchouMm ?? -1) - (a.kakouchouMm ?? -1) ||
          a.dimsText.localeCompare(b.dimsText),
      )
    if (dimsRows.length === 0) continue

    // 資料の「大コーナー」「曲筋」に当たるので、標準寸法を持つ筋種類は「特寸」、
    // それ以外は形状ごとに見出しを分ける
    const blocks: Array<{ heading: string; rows: AdditionalRebarSpecRow[] }> = []
    if (hasStandardSizes(group.category)) {
      blocks.push({ heading: `${group.label} 特寸`, rows: dimsRows })
    } else {
      const byShape = new Map<string, AdditionalRebarSpecRow[]>()
      for (const row of dimsRows) {
        const list = byShape.get(row.shapeType)
        if (list) list.push(row)
        else byShape.set(row.shapeType, [row])
      }
      for (const list of byShape.values()) {
        // 形状名は図で示すので、見出しには筋種類だけ出す
        blocks.push({ heading: group.label, rows: list })
      }
    }

    const showShapeFigure = group.category === 'SPECIAL_CORNER'

    for (const block of blocks) {
      // 寸法基準は辺ごとに括弧で書くので、見出しに「※芯々」はもう付けない
      block.rows.forEach((row, i) => {
        rows.push({
          key: row.key,
          label: block.heading,
          isGroupStart: i === 0,
          spec: <SpecWithDiameter row={row} />,
          result: <KakouchouResult row={row} />,
          layout: 'stacked',
          figure:
            showShapeFigure && i === 0
              ? {
                  node: <ShapeFigure shapeType={row.shapeType} rows={block.rows} />,
                  rowSpan: block.rows.length,
                }
              : showShapeFigure
                ? 'skip'
                : 'empty',
        })
      })
    }
  }

  return rows
}

/**
 * 資料の手書きスケッチに当たる形状図。
 *
 * 1 つの形状に寸法違いの鉄筋が何本も入ることがあるので、辺のラベルは 2 通りに分ける。
 * ・全ての鉄筋で寸法が同じ  → その寸法をそのまま書く（資料と同じ見た目）
 * ・寸法が鉄筋ごとに違う    → 辺の番号だけ書く
 * 寸法を全部並べると 1 辺のラベルが「340（30/232/23）」のように長くなり、
 * 隣の辺のラベルと重なって読めなくなるため。寸法は左の列に並んでいるので、
 * 番号と列の並び順（左から辺 1, 2, 3…）で対応が取れる。
 */
const FIGURE_W = 200
/** 縦長の階段形（STEP・V_STEP2）でも辺の中点が詰まらない高さ。
 *  低くすると隣り合う辺のラベルどうしが重なる（H=156 では 7.6px しか離れない） */
const FIGURE_H = 200
/** ラベルは path の外側に置くので、その分の余白を確保する。
 *  広げると形状が縮んで辺の中点どうしが近づくため、必要最小限にとどめる */
const FIGURE_PAD = 27
/** 辺の中点からラベルまでの距離 */
const FIGURE_LABEL_GAP = 13
/** 辺番号を入れる丸の半径 */
const FIGURE_BADGE_R = 8
/** 寸法ラベルの 1 文字あたりの幅と行の高さ（fontSize 12 の概算） */
const FIGURE_LABEL_CHAR_W = 7
const FIGURE_LABEL_LINE_H = 14

/** 全ての鉄筋で各辺の寸法が一致しているか。違えば寸法は書けない */
function hasUniformSegments(
  rows: AdditionalRebarSpecRow[],
  segmentCount: number,
): boolean {
  if (rows.length <= 1) return true
  for (let i = 0; i < segmentCount; i += 1) {
    const first = rows[0]?.segments[i]?.lengthMm ?? null
    for (const row of rows) {
      if ((row.segments[i]?.lengthMm ?? null) !== first) return false
    }
  }
  return true
}

function segmentLabelFor(rows: AdditionalRebarSpecRow[], index: number): string {
  const length = rows[0]?.segments[index]?.lengthMm
  return length == null ? '—' : String(length)
}

/**
 * 寸法ラベルを中点の外側に置いても、隣の辺のラベルと重ならないか。
 *
 * 階段形は辺が短く中点が近いので、4 桁の寸法を 5 辺に書くと必ず重なる。
 * 実際の文字幅で当たり判定して、収まらない形状では辺番号に切り替える。
 */
function labelsFitWithoutOverlap(
  anchors: Array<{ index: number; x: number; y: number }>,
  texts: string[],
): boolean {
  const halfWidth = texts.map((t) => (t.length * FIGURE_LABEL_CHAR_W) / 2 + 2)
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const a = anchors[i]!
      const b = anchors[j]!
      if (
        Math.abs(a.x - b.x) < halfWidth[i]! + halfWidth[j]! &&
        Math.abs(a.y - b.y) < FIGURE_LABEL_LINE_H
      ) {
        return false
      }
    }
  }
  return true
}

function ShapeFigure({
  shapeType,
  rows,
}: {
  shapeType: string
  rows: AdditionalRebarSpecRow[]
}) {
  const shape = getCornerBarShape(shapeType)
  if (!shape) return null

  const points = cornerBarThumbPoints(shape, FIGURE_W, FIGURE_H, FIGURE_PAD)
  if (points.length < 2) return null

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  const anchors = cornerBarSegmentLabelAnchors(points, FIGURE_LABEL_GAP)
  const dimTexts = anchors.map((anchor) => segmentLabelFor(rows, anchor.index))
  // 寸法を書けるのは「全ての鉄筋が同寸法」かつ「ラベルが重ならない」ときだけ
  const uniform =
    hasUniformSegments(rows, shape.directions.length) &&
    labelsFitWithoutOverlap(anchors, dimTexts)

  return (
    <div className="flex flex-col items-center">
      <svg
        width={FIGURE_W}
        height={FIGURE_H}
        viewBox={`0 0 ${FIGURE_W} ${FIGURE_H}`}
        // 余白を詰めているので、端の寸法ラベルが切れないように外へはみ出させる
        overflow="visible"
        role="img"
        aria-label={
          uniform
            ? `${shape.label}の形状`
            : `${shape.label}の形状。数字は辺の番号で、寸法は左の列と同じ並び`
        }
      >
        <path
          d={path}
          fill="none"
          stroke="#0f172a"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 曲げの位置が分かるように節点に小さな印を打つ */}
        {points.slice(1, -1).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#0f172a" />
        ))}
        {anchors.map((anchor, i) =>
          uniform ? (
            <text
              key={anchor.index}
              x={anchor.x}
              y={anchor.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={12}
              fill="#0f172a"
            >
              {dimTexts[i]}
            </text>
          ) : (
            <g key={anchor.index}>
              <circle cx={anchor.x} cy={anchor.y} r={FIGURE_BADGE_R} fill="#0f172a" />
              <text
                x={anchor.x}
                y={anchor.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10}
                fontWeight={600}
                fill="#ffffff"
              >
                {anchor.index + 1}
              </text>
            </g>
          ),
        )}
      </svg>
      {uniform ? null : (
        <span className="mt-1 text-xs font-normal text-muted">※数字は辺の番号</span>
      )}
    </div>
  )
}

/** 寸法を書かない行の「76本」 */
function QuantityText({ quantity }: { quantity: number }) {
  return (
    <>
      <span className="font-semibold">{quantity.toLocaleString('ja-JP')}</span>
      <span className="ml-1 text-sm font-normal text-muted">本</span>
    </>
  )
}

const dataCell = 'py-2 pr-6 align-baseline whitespace-nowrap'
/**
 * table-layout: auto の古典的なトリック。幅を「1%」にすると、その列は
 * 中身がぴったり収まる最小幅まで縮む（nowrap と組み合わせたときだけ効く）。
 * こう縮めた列以外（＝各辺寸法の列）に余った横幅が全部流れるので、
 * 見出し（筋種類）のすぐ右に鉄筋径・本数が詰まって並ぶ。
 */
const shrinkCell = { width: '1%' }

/**
 * 全筋種類・全行を 1 つの表に入れる。列幅は表全体で共有されるので、
 * 「コーナー筋」「添え筋」のように見出しの長さが違っても鉄筋径・本数は必ず縦に揃う。
 *
 * 筋種類名は 〃 に省略せず、行ごとに毎回そのまま出す。グループの最初の行だけ
 * 上の余白を広くして、見た目の区切りをつける。
 */
function SheetTable({ rows }: { rows: SheetRow[] }) {
  const hasAnyFigure = rows.some((r) => typeof r.figure === 'object')

  return (
    <table className="w-full border-collapse text-lg">
      <tbody className="divide-y divide-border">
        {rows.map((row) => {
          const pad = row.isGroupStart ? 'pt-4' : 'pt-2'
          return (
            <tr key={row.key}>
              <td style={shrinkCell} className={`${dataCell} ${pad}`}>
                {row.label}
              </td>
              {row.layout === 'stacked' ? (
                // 寸法を 1 行で出しきるため、本数の列まで使って縦に積む
                <td colSpan={2} className={`${dataCell} font-mono ${pad}`}>
                  <div className="corner-summary-dims">{row.spec}</div>
                  <div>{row.result}</div>
                </td>
              ) : (
                <>
                  <td className={`${dataCell} font-mono ${pad}`}>{row.spec}</td>
                  <td
                    style={shrinkCell}
                    className={`${dataCell} text-right font-mono ${pad}`}
                  >
                    {row.result}
                  </td>
                </>
              )}
              {hasAnyFigure && typeof row.figure === 'object' && (
                <td
                  style={shrinkCell}
                  rowSpan={row.figure.rowSpan}
                  className="py-2 pl-6 align-middle"
                >
                  {row.figure.node}
                </td>
              )}
              {hasAnyFigure && row.figure === 'empty' && (
                <td style={shrinkCell} className={`${dataCell} ${pad}`} />
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * 付加筋 集計結果の本体。
 *
 * 切断最適化の結果ページの末尾に差し込んで使うので、戻るリンクや印刷ボタンは
 * 持たない（ページ側のものをそのまま使う）。
 */
export function CornerBarSummarySections({
  placements,
}: {
  placements: AdditionalRebarPlacementLike[]
}) {
  const summary = useMemo(() => aggregateAdditionalRebars(placements), [placements])
  const rows = useMemo(() => buildSheetRows(summary.groups), [summary])

  if (rows.length === 0) {
    return <p className="text-sm text-muted">付加筋がまだ配置されていません。</p>
  }

  return (
    <div className="corner-summary-print-root">
      <div className="corner-summary-section overflow-x-auto rounded-lg border-2 border-primary bg-white p-5">
        <SheetTable rows={rows} />
      </div>
    </div>
  )
}
