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

// 1) 단순 D13 케이스: 2350mm x2 + 1200mm x1, stock 6000, 손실 0
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

// 2) 절단 손실이 있을 때에도 사용 길이가 stockLength를 넘지 않는지
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

  // 모든 봉에서 사용 길이가 stockLength 이하인지 확인
  for (const stock of result.stocks) {
    assert.ok(
      stock.usedLengthMm <= stockLength,
      `usedLength ${stock.usedLengthMm} exceeds stockLength ${stockLength}`,
    )
  }

  // 전체 사용 길이 + 전체 폐기 길이 == 전체 자재 길이
  const totalMaterial = result.totalStockCount * stockLength
  const totalUsed = Object.values(result.byBarType).reduce(
    (sum, t) => sum + t.totalUsed,
    0,
  )
  const totalWaste = result.totalWasteMm
  assert.equal(totalUsed + totalWaste, totalMaterial)
}
)

