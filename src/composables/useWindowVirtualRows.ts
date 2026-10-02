import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'

export interface VirtualRange {
  start: number
  end: number
}

export interface VirtualRangeInput {
  count: number
  rowPitch: number
  // 視窗上下緣相對於列表頂端的位移（px），列表在視窗下方時為負值。
  viewportStart: number
  viewportEnd: number
  overscanPx: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function getVirtualRange({ count, rowPitch, viewportStart, viewportEnd, overscanPx }: VirtualRangeInput): VirtualRange {
  if (count <= 0 || rowPitch <= 0) return { start: 0, end: 0 }

  const start = clamp(Math.floor((viewportStart - overscanPx) / rowPitch), 0, count)
  const end = clamp(Math.ceil((viewportEnd + overscanPx) / rowPitch), start, count)
  return { start, end }
}

interface WindowVirtualRowsOptions {
  container: Readonly<Ref<HTMLElement | null>>
  count: () => number
  rowSelector: string
  estimatedRowPitch: number
  overscanPx: number
}

// 以視窗捲動為準的虛擬列表：只渲染視窗上下 overscan 範圍內的列，其餘以上下 spacer 撐出高度。
// 列高假設一致（由 CSS 固定），實際間距從相鄰兩列的位置量測，因此桌機表格與手機卡片可共用。
export function useWindowVirtualRows(options: WindowVirtualRowsOptions) {
  const rowPitch = ref(options.estimatedRowPitch)
  const range = shallowRef<VirtualRange>({ start: 0, end: 0 })
  let frame = 0

  function updateRange(): void {
    if (frame) cancelAnimationFrame(frame)
    frame = 0

    const container = options.container.value
    if (!container) return

    const top = container.getBoundingClientRect().top
    const next = getVirtualRange({
      count: options.count(),
      rowPitch: rowPitch.value,
      viewportStart: -top,
      viewportEnd: window.innerHeight - top,
      overscanPx: options.overscanPx,
    })
    if (next.start !== range.value.start || next.end !== range.value.end) range.value = next
  }

  function scheduleRangeUpdate(): void {
    if (!frame) frame = requestAnimationFrame(updateRange)
  }

  function measureRowPitch(): void {
    const rows = options.container.value?.querySelectorAll<HTMLElement>(options.rowSelector)
    if (!rows || rows.length < 2) return

    const pitch = rows.item(1).getBoundingClientRect().top - rows.item(0).getBoundingClientRect().top
    if (pitch > 0 && Math.abs(pitch - rowPitch.value) >= 0.5) rowPitch.value = pitch
  }

  function handleResize(): void {
    measureRowPitch()
    scheduleRangeUpdate()
  }

  // 列數變動（重設、附加、刪除）要在渲染前同步算出新範圍，避免一個 frame 用舊範圍切出空白。
  watch(options.count, updateRange)
  watch(rowPitch, updateRange)
  watch(range, measureRowPitch, { flush: 'post' })

  const visibleStart = computed(() => Math.min(range.value.start, options.count()))
  const visibleEnd = computed(() => Math.min(range.value.end, options.count()))
  const paddingTop = computed(() => visibleStart.value * rowPitch.value)
  const paddingBottom = computed(() => (options.count() - visibleEnd.value) * rowPitch.value)

  // 先依列高估算捲到目標附近並同步更新範圍，呼叫端在 nextTick 後即可找到該列做精確定位。
  function scrollToIndex(index: number): void {
    const container = options.container.value
    if (!container) return

    const rowTop = container.getBoundingClientRect().top + window.scrollY + index * rowPitch.value
    window.scrollTo({ top: Math.max(0, rowTop - (window.innerHeight - rowPitch.value) / 2) })
    updateRange()
  }

  onMounted(() => {
    window.addEventListener('scroll', scheduleRangeUpdate, { passive: true })
    window.addEventListener('resize', handleResize, { passive: true })
    updateRange()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', scheduleRangeUpdate)
    window.removeEventListener('resize', handleResize)
    if (frame) cancelAnimationFrame(frame)
  })

  return { visibleStart, visibleEnd, paddingTop, paddingBottom, scrollToIndex }
}
