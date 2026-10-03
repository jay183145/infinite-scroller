// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { installFakeWindowLayout } from '../test/fakeWindowLayout'
import HomeView from './HomeView.vue'

// 可暫停 getPage 的閘門，用來模擬排序／搜尋開著時要數秒才重抓完的列表；未設定時直接放行。
const pageGate = vi.hoisted(() => ({ wait: undefined as Promise<void> | undefined }))
// 記錄列表發出的整批 getPage（排除 repository 內部確認位置用的單筆查詢），用來斷言異動後重抓了哪些批次。
const pageRequests = vi.hoisted(() => [] as Array<{ offset: number; limit: number }>)

vi.mock('../data/mockEmployeeRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/mockEmployeeRepository')>()
  return {
    ...actual,
    createMockEmployeeRepository: (...args: Parameters<typeof actual.createMockEmployeeRepository>) => {
      const repository = actual.createMockEmployeeRepository(...args)
      return {
        ...repository,
        async getPage(request: Parameters<typeof repository.getPage>[0]) {
          if (request.limit > 1) pageRequests.push({ offset: request.offset, limit: request.limit })
          if (pageGate.wait) await pageGate.wait
          return repository.getPage(request)
        },
      }
    },
  }
})

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
  return wrapper.find('[data-summary="loaded"]').text()
}

async function mountHomeView(): Promise<VueWrapper> {
  const wrapper = mount(HomeView, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  pageRequests.length = 0
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
    expect(wrapper.get('#action-status').text()).toBe(`${movedName} 已移至第 300 筆。`)
    // 焦點回到移動後那一列的 PIN 按鈕，鍵盤使用者不會掉回頁首。
    expect(document.activeElement).toBe(movedRow.get('[data-action="position"]').element)
  })
})

describe('HomeView action feedback', () => {
  function dialogButton(wrapper: VueWrapper, text: string) {
    return wrapper.findAll('dialog button').find((button) => button.text() === text)!
  }

  it('announces the result and returns focus to the affected row after edit and delete', async () => {
    const wrapper = await mountHomeView()
    const statusRegion = wrapper.get('#action-status')
    expect(statusRegion.attributes('aria-live')).toBe('polite')

    const editedId = row(wrapper, 2).attributes('data-record-id')
    await row(wrapper, 2).get('[data-action="edit"]').trigger('click')
    await wrapper.get('dialog form').trigger('submit')
    await dialogButton(wrapper, '確認更新').trigger('click')
    await flushPromises()

    expect(statusRegion.text()).toBe('人員資料已更新。')
    expect(document.activeElement).toBe(wrapper.get(`tr[data-record-id="${editedId}"] [data-action="edit"]`).element)

    // 刪除後原本那筆不存在，焦點落在遞補到同一列號的資料上。
    await row(wrapper, 2).get('[data-action="delete"]').trigger('click')
    await dialogButton(wrapper, '確認刪除').trigger('click')
    await flushPromises()

    expect(statusRegion.text()).toBe('人員資料已刪除。')
    expect(row(wrapper, 2).attributes('data-record-id')).not.toBe(editedId)
    expect(document.activeElement).toBe(row(wrapper, 2).get('[data-action="edit"]').element)
  })

  it('shows the success message only after a slow list reload finishes', async () => {
    const wrapper = await mountHomeView()
    let release!: () => void
    pageGate.wait = new Promise((resolve) => {
      release = resolve
    })

    await row(wrapper, 2).get('[data-action="edit"]').trigger('click')
    await wrapper.get('dialog form').trigger('submit')
    await dialogButton(wrapper, '確認更新').trigger('click')
    await flushPromises()

    // 列表還在重抓：成功提示不能先出現，否則重抓超過提示時間就會在列表更新前消失。
    expect(wrapper.get('#action-status').text()).not.toContain('人員資料已更新。')

    pageGate.wait = undefined
    release()
    await flushPromises()
    expect(wrapper.get('#action-status').text()).toContain('人員資料已更新。')
  })
})

describe('HomeView reload after changes', () => {
  async function loadBatches(wrapper: VueWrapper, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      for (const callback of intersectionCallbacks) {
        callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      }
      await flushPromises()
    }
  }

  async function rowAt(wrapper: VueWrapper, position: number) {
    layout.scrollWindowTo(LIST_TOP + (position - 1) * ROW_PITCH)
    layout.flushFrames()
    await nextTick()
    return row(wrapper, position)
  }

  it('refetches only the batches between the original and target position after PIN TO', async () => {
    const wrapper = await mountHomeView()
    await loadBatches(wrapper, 2)
    expect(loadedCount(wrapper)).toBe('1,500')
    pageRequests.length = 0

    const movedRow = await rowAt(wrapper, 600)
    expect(movedRow.text()).toContain('DATA-00000600')
    await movedRow.get('[data-action="position"]').trigger('click')
    await wrapper.get('dialog input[type="number"]').setValue(5)
    await wrapper.get('dialog form').trigger('submit')
    await flushPromises()

    // 第 5～600 筆分布在前兩批；第三批（第 1,001 筆起）不受影響，沿用已載入的資料。
    expect(pageRequests).toEqual([{ offset: 0, limit: 500 }, { offset: 500, limit: 500 }])
    expect(loadedCount(wrapper)).toBe('1,500')
    expect((await rowAt(wrapper, 5)).text()).toContain('DATA-00000600')
    expect((await rowAt(wrapper, 6)).text()).toContain('DATA-00000005')
    expect((await rowAt(wrapper, 600)).text()).toContain('DATA-00000599')
    expect((await rowAt(wrapper, 601)).text()).toContain('DATA-00000601')
    expect((await rowAt(wrapper, 1_200)).text()).toContain('DATA-00001200')
  })

  it('refetches only the edited row batch when the edit keeps the row in place', async () => {
    const wrapper = await mountHomeView()
    await loadBatches(wrapper, 2)
    pageRequests.length = 0

    await row(wrapper, 2).get('[data-action="edit"]').trigger('click')
    await wrapper.get('dialog input[name="name"]').setValue('Zed Example')
    await wrapper.get('dialog form').trigger('submit')
    await wrapper.findAll('dialog button').find((button) => button.text() === '確認更新')!.trigger('click')
    await flushPromises()

    expect(pageRequests).toEqual([{ offset: 0, limit: 500 }])
    expect(loadedCount(wrapper)).toBe('1,500')
    expect(row(wrapper, 2).text()).toContain('Zed Example')
    expect((await rowAt(wrapper, 1_200)).text()).toContain('DATA-00001200')
  })
})

describe('HomeView search', () => {
  it('searches by data number by default', async () => {
    const wrapper = await mountHomeView()

    expect((wrapper.get('#search-field').element as HTMLSelectElement).value).toBe('dataNumber')
    expect(wrapper.get('#employee-search').attributes('placeholder')).toBe('例如 DATA-00000123')
    expect(wrapper.get('label[for="employee-search"]').text()).toBe('搜尋資料編號')
  })

  it('shows the matching count only after a search, not in the summary', async () => {
    const wrapper = await mountHomeView()

    expect(wrapper.get('.summary-grid').text()).not.toContain('符合條件')
    expect(wrapper.get('form[role="search"] + p[aria-live]').text()).toBe('')
  })
})

describe('HomeView default sort', () => {
  it('sorts by data number ascending by default without waiting for a full sort', async () => {
    const wrapper = await mountHomeView()

    expect(wrapper.findAll('thead th')[0]!.attributes('aria-sort')).toBe('ascending')
    expect((wrapper.get('#sort-field').element as HTMLSelectElement).value).toBe('dataNumber')
    // 測試環境沒有 Worker：首批能直接渲染，表示預設排序走的是索引分頁。
    expect(row(wrapper, 1).text()).toContain('DATA-00000001')
    expect(row(wrapper, 2).text()).toContain('DATA-00000002')
  })
})

describe('HomeView sorting feedback', () => {
  // 排序交給 Worker；讓 Worker 永不回應，模擬千萬筆排序仍在進行中。
  class PendingWorker {
    addEventListener(): void {}
    postMessage(): void {}
    terminate(): void {}
  }

  it('shows what is being sorted once the query takes longer than a moment', async () => {
    vi.stubGlobal('Worker', PendingWorker)
    const wrapper = await mountHomeView()
    const nameHeader = wrapper.findAll('thead th')[1]!

    await nameHeader.get('button').trigger('click')
    // 短暫的查詢不顯示提示，避免一閃而過。
    expect(wrapper.get('#action-status').text()).toBe('')

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(wrapper.get('#action-status').text()).toBe('正在依姓名正序排序 10,000,000 筆資料…')
    expect(nameHeader.attributes('aria-sort')).toBe('ascending')
    expect(nameHeader.find('svg.animate-spin').exists()).toBe(true)
    expect(wrapper.get('[aria-busy]').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('tbody').classes()).toContain('opacity-50')
    expect(wrapper.get('thead').classes()).not.toContain('opacity-50')
  })
})

describe('HomeView back to top', () => {
  it('appears once the page header leaves the viewport and returns focus to the page title', async () => {
    const wrapper = await mountHomeView()
    const button = wrapper.get('button[aria-label="回到最上方"]')
    const compactHeader = wrapper.get('[data-compact-header]')
    expect(button.isVisible()).toBe(false)
    expect(compactHeader.isVisible()).toBe(false)

    // 頁首捲走後，精簡頁首與「回到最上方」同時出現。
    setIntersecting(wrapper.get('header').element, false)
    await nextTick()
    expect(button.isVisible()).toBe(true)
    expect(compactHeader.isVisible()).toBe(true)
    expect(compactHeader.get('button').text()).toBe('新增人員')

    await button.trigger('click')
    expect(layout.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
    expect(document.activeElement).toBe(wrapper.get('h1').element)

    setIntersecting(wrapper.get('header').element, true)
    await nextTick()
    expect(button.isVisible()).toBe(false)
    expect(compactHeader.isVisible()).toBe(false)
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
