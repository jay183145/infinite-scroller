import { vi } from 'vitest'

interface FakeWindowLayoutOptions {
  // 列表容器在文件中的頂端位置（px）。
  listTop: number
  rowPitch: number
  viewportHeight: number
  listSelector: string
}

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

// happy-dom 不做版面配置：依列號與 spacer 高度模擬出列表的位置，並接管捲動與 requestAnimationFrame 以便逐 frame 檢查。
export function installFakeWindowLayout({ listTop, rowPitch, viewportHeight, listSelector }: FakeWindowLayoutOptions) {
  let scrollY = 0
  let nextFrameId = 1
  const frames = new Map<number, FrameRequestCallback>()

  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewportHeight })
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId++
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })

  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(((options: ScrollToOptions) => {
    scrollY = options.top ?? scrollY
  }) as typeof window.scrollTo)
  const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})

  function listHeight(list: Element): number {
    const spacerHeight = [...list.querySelectorAll<HTMLElement>('[style*="height"]')]
      .reduce((sum, element) => sum + Number.parseFloat(element.style.height), 0)
    return spacerHeight + list.querySelectorAll('[data-row-position]').length * rowPitch
  }

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = listTop - scrollY
    const list = document.querySelector(listSelector)
    if (this === list) return rect(top, listHeight(this))

    const position = this instanceof HTMLElement ? Number(this.dataset.rowPosition) : Number.NaN
    if (Number.isFinite(position)) return rect(top + (position - 1) * rowPitch, rowPitch)

    // 其餘元素（例如無限載入 sentinel）都視為緊接在列表下方。
    return rect(list ? top + listHeight(list) : top, 0)
  })

  return {
    scrollTo,
    scrollIntoView,
    pendingFrames: () => frames.size,
    scrollWindowTo(top: number): void {
      scrollY = top
      window.dispatchEvent(new Event('scroll'))
    },
    flushFrames(): void {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(performance.now())
    },
  }
}
