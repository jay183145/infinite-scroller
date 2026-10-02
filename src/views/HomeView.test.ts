// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { installFakeWindowLayout } from '../test/fakeWindowLayout'
import HomeView from './HomeView.vue'

const LIST_TOP = 400
const ROW_PITCH = 56
const VIEWPORT_HEIGHT = 800

let layout: ReturnType<typeof installFakeWindowLayout>
let intersectionCallbacks: IntersectionObserverCallback[]

let observedTargets: Map<Element, IntersectionObserverCallback>

class FakeIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {
    intersectionCallbacks.push(callback)
  }
  observe(target: Element): void {
    observedTargets.set(target, this.callback)
  }
  disconnect(): void {}
}

function setIntersecting(target: Element, isIntersecting: boolean): void {
  observedTargets.get(target)!([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)
}

function renderedPositions(wrapper: VueWrapper): number[] {
  return wrapper.findAll('tbody tr[data-row-position]').map((row) => Number(row.attributes('data-row-position')))
}

function row(wrapper: VueWrapper, position: number) {
  return wrapper.get(`tbody tr[data-row-position="${position}"]`)
}

function spacerHeights(wrapper: VueWrapper): number[] {
  return wrapper.findAll('tbody tr.virtual-spacer td').map((cell) => Number.parseFloat((cell.element as HTMLElement).style.height))
}

function loadedCount(wrapper: VueWrapper): string {
  return wrapper.findAll('.summary-grid p.tabular-nums')[2]?.text() ?? ''
}

async function mountHomeView(): Promise<VueWrapper> {
  const wrapper = mount(HomeView, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  intersectionCallbacks = []
  observedTargets = new Map()
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  layout = installFakeWindowLayout({ listTop: LIST_TOP, rowPitch: ROW_PITCH, viewportHeight: VIEWPORT_HEIGHT, listSelector: 'tbody' })
})

// 斷言失敗時也要卸載，避免殘留的 scroll 監聽影響後續測試。
enableAutoUnmount(afterEach)

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('HomeView virtual list', () => {
  it('renders only the rows near the viewport out of the first loaded batch', async () => {
    const wrapper = await mountHomeView()

    // 列表頂端在 400px：可視區對應列表 -400～400px，上下各多 600px → 0～1,000px，共 18 列。
    expect(loadedCount(wrapper)).toBe('500')
    expect(renderedPositions(wrapper)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1))
    expect(spacerHeights(wrapper)).toEqual([(500 - 18) * ROW_PITCH])
    expect(wrapper.get('table').attributes('aria-rowcount')).toBe('10000001')
    expect(row(wrapper, 1).attributes('aria-rowindex')).toBe('2')
  })

  it('swaps rendered rows while scrolling and keeps row actions bound to their real position', async () => {
    const wrapper = await mountHomeView()

    layout.scrollWindowTo(20_000)
    layout.flushFrames()
    await nextTick()

    // 列表已捲出 19,600px：19,000～21,000px → 第 340～375 列。
    expect(renderedPositions(wrapper)).toEqual(Array.from({ length: 36 }, (_, index) => index + 340))
    expect(spacerHeights(wrapper)).toEqual([339 * ROW_PITCH, (500 - 375) * ROW_PITCH])
    expect(row(wrapper, 340).text()).toContain('DATA-00000340')

    await row(wrapper, 340).findAll('button').find((button) => button.text() === 'PIN TO')!.trigger('click')
    expect(wrapper.get('dialog').text()).toContain('目前位於第 340 筆')
  })

  it('appends the next batch when the sentinel intersects without rendering it all', async () => {
    const wrapper = await mountHomeView()

    for (const callback of intersectionCallbacks) {
      callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    }
    await flushPromises()

    expect(loadedCount(wrapper)).toBe('1,000')
    expect(renderedPositions(wrapper)).toHaveLength(18)
    expect(spacerHeights(wrapper)).toEqual([(1_000 - 18) * ROW_PITCH])
  })

  it('scrolls a moved row into view even when it was not rendered before the move', async () => {
    const wrapper = await mountHomeView()
    const movedName = row(wrapper, 1).get('td[data-label="姓名"]').text()

    await row(wrapper, 1).findAll('button').find((button) => button.text() === 'PIN TO')!.trigger('click')
    await wrapper.get('dialog input[type="number"]').setValue(300)
    await wrapper.get('dialog form').trigger('submit')
    await flushPromises()

    // 第 300 列頂端位於文件 400 + 299 × 56px，置中需扣掉 (800 - 56) / 2。
    expect(layout.scrollTo).toHaveBeenLastCalledWith({ top: LIST_TOP + 299 * ROW_PITCH - (VIEWPORT_HEIGHT - ROW_PITCH) / 2 })
    const movedRow = row(wrapper, 300)
    expect(movedRow.text()).toContain(movedName)
    expect(movedRow.text()).toContain('PIN TO #300')
    expect(layout.scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' })
    expect(layout.scrollIntoView.mock.contexts.at(-1)).toBe(movedRow.element)
    expect(wrapper.get('main p[role="status"]').text()).toBe(`${movedName} 已移至第 300 筆。`)
  })
})

describe('HomeView back to top', () => {
  it('appears once the page header leaves the viewport and returns focus to the page title', async () => {
    const wrapper = await mountHomeView()
    const button = wrapper.get('button[aria-label="回到最上方"]')
    expect(button.isVisible()).toBe(false)

    setIntersecting(wrapper.get('header').element, false)
    await nextTick()
    expect(button.isVisible()).toBe(true)

    await button.trigger('click')
    expect(layout.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
    expect(document.activeElement).toBe(wrapper.get('h1').element)

    setIntersecting(wrapper.get('header').element, true)
    await nextTick()
    expect(button.isVisible()).toBe(false)
  })

  it('jumps to three viewports from the top before gliding when far down the list', async () => {
    const wrapper = await mountHomeView()
    const button = wrapper.get('button[aria-label="回到最上方"]')

    // 距離在三個畫面高以內：直接平滑捲動。
    layout.scrollWindowTo(VIEWPORT_HEIGHT * 3)
    layout.scrollTo.mockClear()
    await button.trigger('click')
    expect(layout.scrollTo.mock.calls).toEqual([[{ top: 0, behavior: 'smooth' }]])

    // 距離較遠：先瞬間跳到三個畫面高的位置，只平滑捲動最後一段。
    layout.scrollWindowTo(20_000)
    layout.scrollTo.mockClear()
    await button.trigger('click')
    expect(layout.scrollTo.mock.calls).toEqual([[{ top: VIEWPORT_HEIGHT * 3 }], [{ top: 0, behavior: 'smooth' }]])
  })
})
