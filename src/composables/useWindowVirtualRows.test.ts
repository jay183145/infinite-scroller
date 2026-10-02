// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { installFakeWindowLayout } from '../test/fakeWindowLayout'
import { getVirtualRange, useWindowVirtualRows } from './useWindowVirtualRows'

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

describe('useWindowVirtualRows', () => {
  const LIST_TOP = 200
  const VIEWPORT_HEIGHT = 800
  const OVERSCAN_PX = 100
  const ESTIMATED_PITCH = 50

  let layout: ReturnType<typeof installFakeWindowLayout>
  let api: ReturnType<typeof useWindowVirtualRows>

  function setup(rowPitch = ESTIMATED_PITCH) {
    layout = installFakeWindowLayout({ listTop: LIST_TOP, rowPitch, viewportHeight: VIEWPORT_HEIGHT, listSelector: '[data-list]' })
  }

  const Harness = defineComponent({
    props: { count: { type: Number, required: true } },
    setup(props) {
      const container = ref<HTMLElement | null>(null)
      api = useWindowVirtualRows({
        container,
        count: () => props.count,
        rowSelector: '[data-row-position]',
        estimatedRowPitch: ESTIMATED_PITCH,
        overscanPx: OVERSCAN_PX,
      })

      return () => {
        const { visibleStart, visibleEnd, paddingTop, paddingBottom } = api
        const rows = Array.from({ length: visibleEnd.value - visibleStart.value }, (_, index) =>
          h('div', { key: visibleStart.value + index, 'data-row-position': visibleStart.value + index + 1 }),
        )
        return h('div', { ref: container, 'data-list': '' }, [
          h('div', { style: { height: `${paddingTop.value}px` } }),
          ...rows,
          h('div', { style: { height: `${paddingBottom.value}px` } }),
        ])
      }
    },
  })

  function renderedPositions(wrapper: ReturnType<typeof mount>): number[] {
    return wrapper.findAll('[data-row-position]').map((row) => Number(row.attributes('data-row-position')))
  }

  function range(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, index) => from + index)
  }

  beforeEach(() => setup())

  // 斷言失敗時也要卸載，避免殘留的 scroll 監聽影響後續測試。
  enableAutoUnmount(afterEach)

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders only the rows around the viewport and pads the rest', async () => {
    const wrapper = mount(Harness, { props: { count: 1_000 } })
    await nextTick()

    // 列表頂端在視窗內 200px：可視區對應列表 -200～600px，加上 overscan 為 0～700px → 前 14 列。
    expect(renderedPositions(wrapper)).toEqual(range(1, 14))
    expect(api.paddingTop.value).toBe(0)
    expect(api.paddingBottom.value).toBe((1_000 - 14) * ESTIMATED_PITCH)
  })

  it('updates the range once per animation frame while scrolling', async () => {
    const wrapper = mount(Harness, { props: { count: 1_000 } })
    await nextTick()

    layout.scrollWindowTo(4_000)
    layout.scrollWindowTo(5_000)
    expect(layout.pendingFrames()).toBe(1)
    expect(renderedPositions(wrapper)).toEqual(range(1, 14))

    layout.flushFrames()
    await nextTick()

    // 列表已捲出 4,800px：可視區 4,800～5,600px，加 overscan 為 4,700～5,700px → 第 95～114 列。
    expect(renderedPositions(wrapper)).toEqual(range(95, 114))
    expect(api.paddingTop.value).toBe(94 * ESTIMATED_PITCH)
    expect(api.paddingBottom.value).toBe((1_000 - 114) * ESTIMATED_PITCH)
  })

  it('recomputes the range before rendering when the row count changes', async () => {
    const wrapper = mount(Harness, { props: { count: 0 } })
    await nextTick()
    expect(renderedPositions(wrapper)).toEqual([])

    await wrapper.setProps({ count: 1_000 })

    expect(layout.pendingFrames()).toBe(0)
    expect(renderedPositions(wrapper)).toEqual(range(1, 14))
  })

  it('never renders rows beyond a shrunken list', async () => {
    const wrapper = mount(Harness, { props: { count: 1_000 } })
    layout.scrollWindowTo(5_000)
    layout.flushFrames()
    await nextTick()

    await wrapper.setProps({ count: 100 })

    expect(renderedPositions(wrapper)).toEqual(range(95, 100))
    expect(api.paddingBottom.value).toBe(0)
  })

  it('measures the real row pitch from rendered rows and re-ranges with it', async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setup(80)

    const wrapper = mount(Harness, { props: { count: 1_000 } })
    await nextTick()
    await nextTick()

    // 實測列距 80px：0～700px 只需要 9 列。
    expect(renderedPositions(wrapper)).toEqual(range(1, 9))
    expect(api.paddingBottom.value).toBe((1_000 - 9) * 80)
  })

  it('scrolls a row that is not rendered yet to the viewport center and renders it', async () => {
    const wrapper = mount(Harness, { props: { count: 1_000 } })
    await nextTick()

    api.scrollToIndex(299)
    await nextTick()

    // 第 300 列頂端位於文件 200 + 299 × 50 = 15,150px，置中需扣掉 (800 - 50) / 2。
    expect(layout.scrollTo).toHaveBeenLastCalledWith({ top: 15_150 - 375 })
    expect(renderedPositions(wrapper)).toContain(300)
  })

  it('stops listening to scroll after unmount', async () => {
    const wrapper = mount(Harness, { props: { count: 1_000 } })
    await nextTick()
    wrapper.unmount()

    layout.scrollWindowTo(5_000)
    expect(layout.pendingFrames()).toBe(0)
  })
})
