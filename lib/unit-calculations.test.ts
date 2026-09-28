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

type Row = {
  nominalMm: number
  qty: number
  pitchMm: number
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
      assert.strictEqual(getPitchBaseCount(row.nominalMm, row.pitchMm), row.tateCount)
    })
  }

  test(`${group.name}: タテ筋合計 ${group.tateTotal}`, () => {
    const total = group.rows.reduce(
      (sum, row) => sum + row.qty * getPitchBaseCount(row.nominalMm, row.pitchMm),
      0,
    )
    assert.strictEqual(total, group.tateTotal)
  })
}

test('3640 ÷ 200 = 18.20 → 18本', () => {
  assert.strictEqual(getPitchBaseCount(3640, 200), 18)
})

test('2275 ÷ 200 = 11.375 → 12本', () => {
  assert.strictEqual(getPitchBaseCount(2275, 200), 12)
})

test('3640 ÷ 300 = 12.13 → 12本', () => {
  assert.strictEqual(getPitchBaseCount(3640, 300), 12)
})

test('2730 ÷ 300 = 9.10 → 9本', () => {
  assert.strictEqual(getPitchBaseCount(2730, 300), 9)
})

test('ピッチ未設定・長さ 0 以下は 0', () => {
  assert.strictEqual(getPitchBaseCount(4065, 0), 0)
  assert.strictEqual(getPitchBaseCount(4065, Number.NaN), 0)
  assert.strictEqual(getPitchBaseCount(0, 250), 0)
  assert.strictEqual(getPitchBaseCount(-30, 250), 0)
})

console.log('\nAll unit-calculations tests passed')
