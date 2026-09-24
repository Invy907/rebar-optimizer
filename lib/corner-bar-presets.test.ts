import assert from 'node:assert'
import {
  applyCornerBarOrientation,
  DEFAULT_CORNER_BAR_PLACEMENT_SIZE_PX,
  DEFAULT_SOE_PLACEMENT_SIZE_PX,
  DEFAULT_SPECIAL_CORNER_PLACEMENT_SIZE_PX,
  defaultPlacementDraftForCategory,
  getDefaultCornerBarSizePxForPlacement,
  getStandardSegmentLengthsMm,
  makeCornerBarDraft,
} from './corner-bar-presets'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}`)
    throw e
  }
}

test('click placement uses default size_px by category', () => {
  assert.equal(getDefaultCornerBarSizePxForPlacement('CORNER'), DEFAULT_CORNER_BAR_PLACEMENT_SIZE_PX)
  assert.equal(getDefaultCornerBarSizePxForPlacement('CORNER'), 33)
  assert.equal(getDefaultCornerBarSizePxForPlacement('SOE'), DEFAULT_SOE_PLACEMENT_SIZE_PX)
  assert.equal(getDefaultCornerBarSizePxForPlacement('SOE'), 50)
  assert.equal(
    getDefaultCornerBarSizePxForPlacement('SPECIAL_CORNER'),
    DEFAULT_SPECIAL_CORNER_PLACEMENT_SIZE_PX,
  )
  assert.equal(getDefaultCornerBarSizePxForPlacement('SPECIAL_CORNER'), 66)
})

test('CORNER L D13 standard mm is 600 × 600', () => {
  assert.deepEqual(getStandardSegmentLengthsMm('CORNER', 'D13', 'L'), [600, 600])
})

test('SOE STRAIGHT D13 standard mm is 1200 (2 × corner leg)', () => {
  assert.deepEqual(getStandardSegmentLengthsMm('SOE', 'D13', 'STRAIGHT'), [1200])
})

test('flip mirrors x before rotation', () => {
  assert.deepEqual(applyCornerBarOrientation({ x: 10, y: 0 }, 0, true), { x: -10, y: 0 })
  assert.deepEqual(applyCornerBarOrientation({ x: 10, y: 0 }, 1, true), { x: 0, y: -10 })
})

test('defaultPlacementDraftForCategory SPECIAL_CORNER uses first palette shape', () => {
  const draft = defaultPlacementDraftForCategory('SPECIAL_CORNER')
  assert.equal(draft.category, 'SPECIAL_CORNER')
  assert.equal(draft.shapeType, 'V_OFFSET')
})

test('makeCornerBarDraft L CORNER D13 fills 600 × 600 on segments', () => {
  const draft = makeCornerBarDraft('L', { category: 'CORNER' })
  assert.equal(draft.bars.length, 1)
  assert.equal(draft.bars[0]!.barType, 'D13')
  assert.deepEqual(
    draft.bars[0]!.segments.map((s) => s.lengthMm),
    [600, 600],
  )
})
