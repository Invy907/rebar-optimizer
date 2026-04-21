import assert from 'node:assert'
import { optimize, type PieceInput } from './optimizer'

function makePieces(items: { id: string; length: number; barType: string; qty?: number }[]): PieceInput[] {
  const result: PieceInput[] = []
  for (const item of items) {
    const qty = item.qty ?? 1
    for (let i = 0; i < qty; i++) {
      result.push({
        segmentId: `${item.id}-${i}`,
        lengthMm: item.length,
        barType: item.barType,
      })
    }
  }
  return result
}

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}`)
    throw e
  }
}

// 1) 単純なD13ケース: 2350mm x2 + 1200mm x1, stock 6000, 損失 0
test('D13 2350x2 + 1200x1 fits in one 6m bar', () => {
  const pieces = makePieces([
    { id: 'a', length: 2350, barType: 'D13', qty: 2 },
    { id: 'b', length: 1200, barType: 'D13', qty: 1 },
  ])

  const result = optimize(pieces, 6000, {
    algorithm: 'best-fit',
    cuttingLossMm: 0,
  })

  assert.equal(result.totalStockCount, 1)
  const stock = result.stocks[0]
  assert.equal(stock.barType, 'D13')
  assert.equal(stock.usedLengthMm, 2350 + 2350 + 1200)
  assert.equal(stock.wasteMm, 6000 - (2350 + 2350 + 1200))
})

// 2) 切断損失がある場合でも使用長さが stockLength を超えないか
test('cutting loss keeps usedLengthMm <= stockLength', () => {
  const pieces = makePieces([
    { id: 'a', length: 2800, barType: 'D13' },
    { id: 'b', length: 2200, barType: 'D13' },
    { id: 'c', length: 1700, barType: 'D13' },
    { id: 'd', length: 1200, barType: 'D13' },
    { id: 'e', length: 900, barType: 'D13', qty: 2 },
  ])

  const stockLength = 6000
  const cuttingLossMm = 10

  const result = optimize(pieces, stockLength, {
    algorithm: 'best-fit',
    cuttingLossMm,
  })

  // すべての棒で使用長さが stockLength 以下か確認
  for (const stock of result.stocks) {
    assert.ok(
      stock.usedLengthMm <= stockLength,
      `usedLength ${stock.usedLengthMm} exceeds stockLength ${stockLength}`,
    )
  }

  // 全使用長さ + 全廃棄長さ == 全材料長さ
  const totalMaterial = result.totalStockCount * stockLength
  const totalUsed = Object.values(result.byBarType).reduce(
    (sum, t) => sum + t.totalUsed,
    0,
  )
  const totalWaste = result.totalWasteMm
  assert.equal(totalUsed + totalWaste, totalMaterial)
}
)

