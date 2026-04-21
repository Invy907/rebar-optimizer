/**
 * First Fit Decreasing (FFD) / Best Fit Decreasing (BFD) 鉄筋切断最適化
 *
 * 鉄筋種類ごとに分離して処理し、同じ種類のみを1本の6m棒に配置する。
 * 切断損失（カットごとの mm）オプションをサポート。
 */

export type AlgorithmType = 'first-fit' | 'best-fit'

export interface PieceInput {
  segmentId: string
  lengthMm: number
  barType: string
}

export interface OptimizationOptions {
  /** 'first-fit': 最初に入る棒に配置。'best-fit': 残長が最小になる棒に配置 */
  algorithm?: AlgorithmType
  /** カットごとの切断損失 (mm)。ピース間の刃厚/切断による損失 */
  cuttingLossMm?: number
}

export interface StockResult {
  barType: string
  stockIndex: number
  pieces: { segmentId: string; lengthMm: number; sequenceNo: number }[]
  usedLengthMm: number
  wasteMm: number
}

export interface OptimizationOutput {
  stocks: StockResult[]
  totalStockCount: number
  totalWasteMm: number
  wasteRatio: number
  byBarType: Record<
    string,
    {
      stockCount: number
      totalUsed: number
      totalWaste: number
      wasteRatio: number
    }
  >
}

/** 1本での使用長さ（ピース合計 + 切断損失）を計算 */
function usedWithCutLoss(
  pieces: { lengthMm: number }[],
  cuttingLossMm: number,
): number {
  if (pieces.length === 0) return 0
  const sum = pieces.reduce((s, p) => s + p.lengthMm, 0)
  const cuts = Math.max(0, pieces.length - 1)
  return sum + cuts * cuttingLossMm
}

export function optimize(
  pieces: PieceInput[],
  stockLengthMm: number = 6000,
  options: OptimizationOptions = {},
): OptimizationOutput {
  const algorithm = options.algorithm ?? 'best-fit'
  const cuttingLossMm = options.cuttingLossMm ?? 0

  const byType: Record<string, PieceInput[]> = {}
  for (const p of pieces) {
    if (!byType[p.barType]) byType[p.barType] = []
    byType[p.barType].push(p)
  }

  const allStocks: StockResult[] = []
  const byBarType: OptimizationOutput['byBarType'] = {}

  for (const [barType, typePieces] of Object.entries(byType)) {
    const sorted = [...typePieces].sort((a, b) => b.lengthMm - a.lengthMm)
    const stocks: { pieces: StockResult['pieces'] }[] = []

    for (const piece of sorted) {
      if (piece.lengthMm > stockLengthMm) continue

      let placed = false

      const candidates = stocks
        .map((stock) => {
          const used = usedWithCutLoss(stock.pieces, cuttingLossMm)
          const needCutBeforeNext = stock.pieces.length > 0 ? cuttingLossMm : 0
          const remaining = stockLengthMm - used - needCutBeforeNext
          return { stock, remaining }
        })
        .filter((c) => {
          const needForPiece = piece.lengthMm + (c.stock.pieces.length > 0 ? cuttingLossMm : 0)
          return c.remaining >= needForPiece
        })

      if (algorithm === 'best-fit' && candidates.length > 0) {
        const best = candidates.reduce((a, b) => {
          const needA = piece.lengthMm + (a.stock.pieces.length > 0 ? cuttingLossMm : 0)
          const needB = piece.lengthMm + (b.stock.pieces.length > 0 ? cuttingLossMm : 0)
          return a.remaining - needA <= b.remaining - needB ? a : b
        })
        best.stock.pieces.push({
          segmentId: piece.segmentId,
          lengthMm: piece.lengthMm,
          sequenceNo: best.stock.pieces.length + 1,
        })
        placed = true
      } else {
        for (const { stock } of candidates) {
          stock.pieces.push({
            segmentId: piece.segmentId,
            lengthMm: piece.lengthMm,
            sequenceNo: stock.pieces.length + 1,
          })
          placed = true
          break
        }
      }

      if (!placed) {
        stocks.push({
          pieces: [
            {
              segmentId: piece.segmentId,
              lengthMm: piece.lengthMm,
              sequenceNo: 1,
            },
          ],
        })
      }
    }

    let typeUsed = 0
    let typeWaste = 0

    stocks.forEach((stock, idx) => {
      const used = usedWithCutLoss(stock.pieces, cuttingLossMm)
      const waste = stockLengthMm - used
      typeUsed += used
      typeWaste += waste

      allStocks.push({
        barType,
        stockIndex: idx + 1,
        pieces: stock.pieces,
        usedLengthMm: used,
        wasteMm: waste,
      })
    })

    const totalLength = stocks.length * stockLengthMm
    byBarType[barType] = {
      stockCount: stocks.length,
      totalUsed: typeUsed,
      totalWaste: typeWaste,
      wasteRatio: totalLength > 0 ? typeWaste / totalLength : 0,
    }
  }

  const totalStockCount = allStocks.length
  const totalMaterial = totalStockCount * stockLengthMm
  const totalWasteMm = allStocks.reduce((s, st) => s + st.wasteMm, 0)
  const wasteRatio = totalMaterial > 0 ? totalWasteMm / totalMaterial : 0

  return {
    stocks: allStocks,
    totalStockCount,
    totalWasteMm,
    wasteRatio,
    byBarType,
  }
}
