import assert from 'node:assert'
import { getPitchBaseCount } from './unit-calculations'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}`)
    throw e
  }
}

/** 顧客が手書きで修正した製作図リスト（鉄筋長さ補正値 -30mm）の実データ */
const ADJUSTMENT_MM = -30

type Row = {
  /** 呼称（図面上の長さ, mm） */
  nominalMm: number
  /** 数量 */
  qty: number
  /** ユニットのピッチ(mm) */
  pitchMm: number
  /** 手書きで修正された正しいタテ筋本数 */
  tateCount: number
}

const GROUPS: Array<{ name: string; tateTotal: number; rows: Row[] }> = [
  {
    name: '外周',
    tateTotal: 185,
    rows: [
      { nominalMm: 4095, qty: 5, pitchMm: 250, tateCount: 17 },
      { nominalMm: 3640, qty: 5, pitchMm: 250, tateCount: 15 },
      { nominalMm: 2730, qty: 1, pitchMm: 250, tateCount: 11 },
      { nominalMm: 1820, qty: 1, pitchMm: 250, tateCount: 8 },
      { nominalMm: 910, qty: 1, pitchMm: 250, tateCount: 4 },
      { nominalMm: 455, qty: 1, pitchMm: 250, tateCount: 2 },
    ],
  },
  {
    name: '内周',
    tateTotal: 321,
    rows: [
      { nominalMm: 4095, qty: 2, pitchMm: 250, tateCount: 17 },
      { nominalMm: 3640, qty: 5, pitchMm: 250, tateCount: 15 },
      { nominalMm: 3185, qty: 1, pitchMm: 250, tateCount: 13 },
      { nominalMm: 2730, qty: 10, pitchMm: 250, tateCount: 11 },
      { nominalMm: 2275, qty: 1, pitchMm: 250, tateCount: 9 },
      { nominalMm: 1820, qty: 7, pitchMm: 250, tateCount: 8 },
      { nominalMm: 1365, qty: 1, pitchMm: 250, tateCount: 6 },
      { nominalMm: 910, qty: 4, pitchMm: 250, tateCount: 4 },
      { nominalMm: 455, qty: 1, pitchMm: 250, tateCount: 2 },
    ],
  },
  {
    name: '布基礎',
    tateTotal: 8,
    rows: [
      { nominalMm: 1365, qty: 1, pitchMm: 300, tateCount: 5 },
      { nominalMm: 910, qty: 1, pitchMm: 300, tateCount: 3 },
    ],
  },
]

for (const group of GROUPS) {
  for (const row of group.rows) {
    test(`${group.name}: 呼称 ${row.nominalMm} @${row.pitchMm} -> ${row.tateCount}本`, () => {
      assert.strictEqual(
        getPitchBaseCount(row.nominalMm + ADJUSTMENT_MM, row.pitchMm),
        row.tateCount,
      )
    })
  }

  test(`${group.name}: タテ筋合計 ${group.tateTotal}`, () => {
    const total = group.rows.reduce(
      (sum, row) =>
        sum + row.qty * getPitchBaseCount(row.nominalMm + ADJUSTMENT_MM, row.pitchMm),
      0,
    )
    assert.strictEqual(total, group.tateTotal)
  })
}

test('実寸がピッチの整数倍なら両端を数えて +1（2,700 @300 -> 10本）', () => {
  assert.strictEqual(getPitchBaseCount(2700, 300), 10)
})

test('100mm 丸めをしない（呼称 2,275 の実寸 2,245 @250 -> 9本）', () => {
  assert.strictEqual(getPitchBaseCount(2245, 250), 9)
})

test('ピッチ未設定・長さ 0 以下は 0', () => {
  assert.strictEqual(getPitchBaseCount(4065, 0), 0)
  assert.strictEqual(getPitchBaseCount(4065, Number.NaN), 0)
  assert.strictEqual(getPitchBaseCount(0, 250), 0)
  assert.strictEqual(getPitchBaseCount(-30, 250), 0)
})

console.log('\nAll unit-calculations tests passed')
