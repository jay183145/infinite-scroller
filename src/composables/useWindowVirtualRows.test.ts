import { describe, expect, it } from 'vitest'
import { getVirtualRange } from './useWindowVirtualRows'

describe('getVirtualRange', () => {
  const base = { count: 10_000, rowPitch: 50, overscanPx: 100 }

  it('renders only rows inside the viewport plus overscan', () => {
    expect(getVirtualRange({ ...base, viewportStart: 1_000, viewportEnd: 1_800 })).toEqual({ start: 18, end: 38 })
  })

  it('starts from the first row while the list top is still below the viewport top', () => {
    expect(getVirtualRange({ ...base, viewportStart: -300, viewportEnd: 500 })).toEqual({ start: 0, end: 12 })
  })

  it('renders nothing when the list is entirely outside the viewport', () => {
    expect(getVirtualRange({ ...base, viewportStart: -2_000, viewportEnd: -1_000 })).toEqual({ start: 0, end: 0 })
    expect(getVirtualRange({ ...base, count: 10, viewportStart: 5_000, viewportEnd: 5_800 })).toEqual({ start: 10, end: 10 })
  })

  it('clamps the range to the loaded rows', () => {
    expect(getVirtualRange({ ...base, count: 30, viewportStart: 1_000, viewportEnd: 1_800 })).toEqual({ start: 18, end: 30 })
  })

  it('returns an empty range for empty lists or unmeasured rows', () => {
    expect(getVirtualRange({ ...base, count: 0, viewportStart: 0, viewportEnd: 800 })).toEqual({ start: 0, end: 0 })
    expect(getVirtualRange({ ...base, rowPitch: 0, viewportStart: 0, viewportEnd: 800 })).toEqual({ start: 0, end: 0 })
  })
})
