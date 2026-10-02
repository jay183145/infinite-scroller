<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import EmployeeDialog from '../components/EmployeeDialog.vue'
import { useWindowVirtualRows } from '../composables/useWindowVirtualRows'
import { createMockEmployeeRepository } from '../data/mockEmployeeRepository'
import {
  DATASET_SIZE_OPTIONS,
  DEFAULT_DATASET_SIZE,
  PAGE_SIZE,
  type EmployeeDraft,
  type EmployeePage,
  type EmployeeQuery,
  type EmployeeRepository,
  type EmployeeSortField,
  type SortDirection,
} from '../data/employeeRepository'
import type { Employee } from '../types/employee'

const SEARCH_DEBOUNCE_MS = 300
// 底部 sentinel 進入視窗下方 600px 內就先載入下一批，避免捲到底才看到空白。
const LOAD_AHEAD_PX = 600
// 虛擬列表在視窗上下各多渲染 600px 的列，快速捲動時不會先看到空白。
const RENDER_AHEAD_PX = 600
// 桌機列高由 CSS 固定為 3.5rem；手機卡片列高於首次渲染後實測。
const ESTIMATED_ROW_PITCH_PX = 56

const datasetSize = ref<number>(DEFAULT_DATASET_SIZE)
// 列資料只會整批取代或附加，不會就地修改；shallowRef 避免累積上萬筆時為每筆建立深層 proxy。
const records = shallowRef<Employee[]>([])
const manualPositions = ref(new Map<string, number>())
const totalRecords = ref(0)
const pageTotal = ref(0)
const matchingRecords = ref(0)
const searchInput = ref('')
const activeSearch = ref('')
const sortBy = ref<EmployeeSortField | null>(null)
const sortDirection = ref<SortDirection>('asc')
const isResetting = ref(false)
const isLoadingMore = ref(false)
const loadMoreError = ref('')
const loadMoreSentinel = ref<HTMLElement | null>(null)
const tableBody = ref<HTMLElement | null>(null)
const summarySection = ref<HTMLElement | null>(null)
const pageHeader = ref<HTMLElement | null>(null)
const pageTitle = ref<HTMLElement | null>(null)
const showBackToTop = ref(false)
const errorMessage = ref('')
const dialogOpen = ref(false)
const dialogMode = ref<'create' | 'edit' | 'delete' | 'position'>('create')
const activeEmployee = ref<Employee | null>(null)
const activePosition = ref(1)
const dialogError = ref('')
const isSaving = ref(false)
const statusMessage = ref('')

const repositories = new Map<number, EmployeeRepository>()
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined
let latestPageRequestId = 0
let loadMoreObserver: IntersectionObserver | undefined
let summaryResizeObserver: ResizeObserver | undefined
let backToTopObserver: IntersectionObserver | undefined

function getRepository(size = datasetSize.value): EmployeeRepository {
  let repository = repositories.get(size)
  if (!repository) {
    repository = createMockEmployeeRepository(size)
    repositories.set(size, repository)
  }
  return repository
}

const loadedCount = computed(() => records.value.length)
const hasMore = computed(() => loadedCount.value < pageTotal.value)
const nextBatchEnd = computed(() => Math.min(loadedCount.value + PAGE_SIZE, pageTotal.value))

const {
  visibleStart,
  visibleEnd,
  paddingTop: virtualPaddingTop,
  paddingBottom: virtualPaddingBottom,
  scrollToIndex,
} = useWindowVirtualRows({
  container: tableBody,
  count: () => records.value.length,
  rowSelector: '[data-row-position]',
  estimatedRowPitch: ESTIMATED_ROW_PITCH_PX,
  overscanPx: RENDER_AHEAD_PX,
})

const visibleRows = computed(() =>
  records.value
    .slice(visibleStart.value, visibleEnd.value)
    .map((record, index) => ({ record, position: visibleStart.value + index + 1 })),
)

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

function getCurrentQuery(): EmployeeQuery {
  return {
    search: activeSearch.value,
    sortBy: sortBy.value,
    sortDirection: sortDirection.value,
  }
}

function cancelSearchDebounce(): void {
  if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = undefined
}

watch(searchInput, (value) => {
  cancelSearchDebounce()
  const normalizedSearch = value.trim()
  if (normalizedSearch === activeSearch.value) return

  // 停止輸入 300ms 才觸發一次全域 Worker 查詢，避免每個字元都掃描全資料；不會取消已送出的查詢或快取結果。
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = undefined
    activeSearch.value = normalizedSearch
    void resetList()
  }, SEARCH_DEBOUNCE_MS)
})

function submitSearch(): void {
  cancelSearchDebounce()
  activeSearch.value = searchInput.value.trim()
  void resetList()
}

function clearSearch(): void {
  cancelSearchDebounce()
  searchInput.value = ''
  activeSearch.value = ''
  void resetList()
}

function sortRecords(field: EmployeeSortField): void {
  if (sortBy.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = field
    sortDirection.value = 'asc'
  }
  void resetList()
}

function sortIndicator(field: EmployeeSortField): string {
  if (sortBy.value !== field) return ''
  return sortDirection.value === 'asc' ? '↑' : '↓'
}

function getPinnedPosition(employee: Employee): number | undefined {
  const position = manualPositions.value.get(employee.id)
  return position === undefined ? undefined : position + 1
}

function startListRequest(): number {
  latestPageRequestId += 1
  isLoadingMore.value = false
  loadMoreError.value = ''
  errorMessage.value = ''
  return latestPageRequestId
}

function isStaleRequest(requestId: number): boolean {
  return requestId !== latestPageRequestId
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function applyPageSummary(page: EmployeePage): void {
  manualPositions.value = new Map(page.manualPositions.map(({ id, position }) => [id, position]))
  totalRecords.value = page.total
  pageTotal.value = page.pageTotal
  matchingRecords.value = page.pageTotal
}

function isSentinelNearViewport(): boolean {
  const sentinel = loadMoreSentinel.value
  return sentinel !== null && sentinel.getBoundingClientRect().top <= window.innerHeight + LOAD_AHEAD_PX
}

// IntersectionObserver 只在可見狀態改變時通知；一批載完 sentinel 仍在預載範圍內（大螢幕或資料列被篩少）時要主動接續。
async function continueLoadingIfNeeded(): Promise<void> {
  await nextTick()
  if (isSentinelNearViewport()) void loadMore()
}

async function resetList(query = getCurrentQuery()): Promise<void> {
  const requestId = startListRequest()
  isResetting.value = true

  try {
    const page = await getRepository().getPage({ ...query, offset: 0, limit: PAGE_SIZE })
    if (isStaleRequest(requestId)) return

    records.value = page.records
    applyPageSummary(page)
    window.scrollTo({ top: 0 })
    void continueLoadingIfNeeded()
  } catch (error) {
    if (isStaleRequest(requestId) || isAbortError(error)) return
    errorMessage.value = '資料載入失敗，請重試。'
  } finally {
    if (!isStaleRequest(requestId)) isResetting.value = false
  }
}

async function loadMore(): Promise<void> {
  if (isResetting.value || isLoadingMore.value || !hasMore.value || loadMoreError.value || errorMessage.value) return

  // 沿用目前的 request 世代，任何 reset 或重新整理都會讓這批結果失效，不會把舊條件的資料接到新清單後面。
  const requestId = latestPageRequestId
  const offset = records.value.length
  let appended = false
  isLoadingMore.value = true

  try {
    const page = await getRepository().getPage({ ...getCurrentQuery(), offset, limit: PAGE_SIZE })
    if (isStaleRequest(requestId)) return

    records.value = records.value.concat(page.records)
    applyPageSummary(page)
    appended = page.records.length > 0
  } catch (error) {
    if (isStaleRequest(requestId) || isAbortError(error)) return
    loadMoreError.value = `第 ${formatCount(offset + 1)} 筆之後的資料載入失敗。`
  } finally {
    if (!isStaleRequest(requestId)) isLoadingMore.value = false
  }

  if (appended) void continueLoadingIfNeeded()
}

function retryLoadMore(): void {
  loadMoreError.value = ''
  void loadMore()
}

// 異動後只重抓受影響批次到目前已載入的筆數，保留前面的列與捲動位置；全部抓完才一次替換，避免畫面閃動。
async function reloadLoadedRange(fromPosition = 1): Promise<void> {
  const requestId = startListRequest()
  const query = getCurrentQuery()
  const targetCount = Math.max(records.value.length, PAGE_SIZE)
  let offset = Math.min(
    records.value.length,
    Math.floor((Math.max(1, fromPosition) - 1) / PAGE_SIZE) * PAGE_SIZE,
  )
  let nextRecords = records.value.slice(0, offset)
  let lastPage: EmployeePage | undefined
  isResetting.value = true

  try {
    while (offset < targetCount) {
      const page = await getRepository().getPage({ ...query, offset, limit: PAGE_SIZE })
      if (isStaleRequest(requestId)) return

      lastPage = page
      nextRecords = nextRecords.concat(page.records)
      offset += page.records.length
      if (page.records.length < PAGE_SIZE) break
    }

    records.value = nextRecords
    if (lastPage) applyPageSummary(lastPage)
    void continueLoadingIfNeeded()
  } catch (error) {
    if (isStaleRequest(requestId) || isAbortError(error)) return
    errorMessage.value = '資料載入失敗，請重試。'
  } finally {
    if (!isStaleRequest(requestId)) isResetting.value = false
  }
}

// 目標列可能尚未渲染：先依列高捲到附近讓虛擬列表渲染該列，再以實際元素置中。
async function scrollToPosition(position: number): Promise<void> {
  scrollToIndex(position - 1)
  await nextTick()
  tableBody.value
    ?.querySelector(`[data-row-position="${position}"]`)
    ?.scrollIntoView({ block: 'center' })
}

function changeDatasetSize(event: Event): void {
  const nextSize = Number((event.currentTarget as HTMLSelectElement).value)
  if (!DATASET_SIZE_OPTIONS.some((option) => option.value === nextSize)) return

  datasetSize.value = nextSize
  void resetList()
}

function openDialog(
  mode: 'create' | 'edit' | 'delete' | 'position',
  employee: Employee | null = null,
  position = 1,
): void {
  dialogMode.value = mode
  activeEmployee.value = employee
  activePosition.value = position
  dialogError.value = ''
  dialogOpen.value = true
}

function closeDialog(): void {
  dialogOpen.value = false
  dialogError.value = ''
}

async function createEmployee(employee: EmployeeDraft): Promise<void> {
  isSaving.value = true
  dialogError.value = ''
  try {
    await getRepository().create(employee)
    closeDialog()
    statusMessage.value = '人員資料已新增。'
    await resetList()
  } catch {
    dialogError.value = '新增失敗，請檢查資料後重試。'
  } finally {
    isSaving.value = false
  }
}

async function updateEmployee(employee: EmployeeDraft): Promise<void> {
  if (!activeEmployee.value) return

  isSaving.value = true
  dialogError.value = ''
  try {
    await getRepository().update(activeEmployee.value.id, employee)
    closeDialog()
    statusMessage.value = '人員資料已更新。'
    // 有排序時，改值可能讓這筆移到更前面，需從第一批重抓；否則只影響這筆所在批次之後。
    await reloadLoadedRange(sortBy.value ? 1 : activePosition.value)
  } catch {
    dialogError.value = '更新失敗，請重試。'
  } finally {
    isSaving.value = false
  }
}

async function deleteEmployee(id: string): Promise<void> {
  isSaving.value = true
  dialogError.value = ''
  try {
    await getRepository().delete(id, activePosition.value, getCurrentQuery())
    closeDialog()
    statusMessage.value = '人員資料已刪除。'
    await reloadLoadedRange(activePosition.value)
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : '刪除失敗，請重試。'
  } finally {
    isSaving.value = false
  }
}

async function moveEmployeeToPosition(targetPosition: number): Promise<void> {
  if (!activeEmployee.value) return

  isSaving.value = true
  dialogError.value = ''
  try {
    await getRepository().moveToPosition(activeEmployee.value.id, activePosition.value, targetPosition, getCurrentQuery())
    closeDialog()
    await reloadLoadedRange(Math.min(activePosition.value, targetPosition))

    const name = activeEmployee.value.name
    if (targetPosition <= records.value.length) {
      statusMessage.value = `${name} 已移至第 ${formatCount(targetPosition)} 筆。`
      await scrollToPosition(targetPosition)
    } else {
      // 虛擬列表只涵蓋已依序載入的範圍，不為了跳到遠處一次載入大量列；繼續往下捲動即可看到。
      statusMessage.value = `${name} 已移至第 ${formatCount(targetPosition)} 筆（尚未載入到該位置）。`
    }
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : '位置調整失敗，請重新載入資料後再試。'
  } finally {
    isSaving.value = false
  }
}

function scrollToTop(): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  // 回到頂端後按鈕會隱藏；把焦點移到頁面標題，鍵盤使用者才不會失去焦點位置。
  pageTitle.value?.focus({ preventScroll: true })
}

onMounted(() => {
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore()
    },
    { rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px` },
  )
  if (loadMoreSentinel.value) loadMoreObserver.observe(loadMoreSentinel.value)

  // 摘要固定在頂端會蓋住捲到上緣的列；以實際高度設定 scroll-padding，讓鍵盤焦點與 scrollIntoView 不被遮住。
  // 手機版摘要排成兩列時，以負的 top 把第一列推出畫面，只固定「目前載入」，並保留列間距作為上方留白。
  summaryResizeObserver = new ResizeObserver(() => {
    const section = summarySection.value
    if (!section) return
    const lastItem = section.lastElementChild as HTMLElement | null
    const rowGap = parseFloat(getComputedStyle(section).rowGap) || 0
    const hiddenHeight = lastItem && lastItem.offsetTop > 0 ? section.clientTop + lastItem.offsetTop - rowGap : 0
    section.style.top = `${-hiddenHeight}px`
    document.documentElement.style.scrollPaddingTop = `${section.offsetHeight - hiddenHeight}px`
  })
  if (summarySection.value) summaryResizeObserver.observe(summarySection.value)

  // 頁首捲出視窗後才顯示「回到最上方」；用 IntersectionObserver 判斷，不必另外監聽 scroll。
  backToTopObserver = new IntersectionObserver((entries) => {
    showBackToTop.value = !entries.some((entry) => entry.isIntersecting)
  })
  if (pageHeader.value) backToTopObserver.observe(pageHeader.value)
  void resetList()
})

onBeforeUnmount(() => {
  cancelSearchDebounce()
  loadMoreObserver?.disconnect()
  summaryResizeObserver?.disconnect()
  backToTopObserver?.disconnect()
  document.documentElement.style.removeProperty('scroll-padding-top')
})
</script>

<template>
  <div class="min-h-screen bg-surface text-ink">
    <header ref="pageHeader" class="border-b border-line bg-accent-soft">
      <section aria-labelledby="page-title" class="mx-auto flex w-full max-w-370 flex-wrap items-end justify-between gap-4 px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-accent">DIRECTORY / PEOPLE</p>
          <h1 id="page-title" ref="pageTitle" tabindex="-1" class="mt-2 outline-none text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">人員資料</h1>
        </div>
        <button class="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d6045] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" @click="openDialog('create')">新增人員</button>
      </section>
    </header>

    <!-- 底部留白要大於右下角浮動按鈕的高度，捲到底時「載入更多」才不會被蓋住。 -->
    <main class="mx-auto w-full max-w-370 px-4 pb-24 sm:px-6 lg:px-10">
      <p v-if="statusMessage" role="status" aria-live="polite" class="mt-4 text-sm text-accent">{{ statusMessage }}</p>

      <section ref="summarySection" aria-label="資料摘要" class="summary-grid sticky top-0 z-10 mt-7 grid grid-cols-3 rounded-md border border-l-4 border-line border-l-accent bg-canvas px-4 sm:px-6">
        <div class="summary-group contents">
          <div class="min-w-0 py-4 pr-3 sm:py-5">
            <p class="text-xs text-ink/75 sm:text-sm">總資料量</p>
            <p class="mt-2 min-w-0 whitespace-nowrap text-xl font-semibold leading-7 tabular-nums sm:text-[1.75rem]">{{ formatCount(totalRecords) }}</p>
          </div>
          <div class="min-w-0 border-l border-line px-3 py-4 sm:px-6 sm:py-5">
            <p class="text-xs text-ink/75 sm:text-sm">符合條件</p>
            <p class="mt-2 min-w-0 whitespace-nowrap text-xl font-semibold leading-7 tabular-nums sm:text-[1.75rem]">{{ formatCount(matchingRecords) }}</p>
          </div>
        </div>
        <div class="min-w-0 border-l border-line py-4 pl-3 sm:py-5 sm:pl-6">
          <p class="text-xs text-ink/75 sm:text-sm">目前載入</p>
          <p class="mt-2 min-w-0 whitespace-nowrap text-xl font-semibold leading-7 tabular-nums sm:text-[1.75rem]">{{ formatCount(loadedCount) }}</p>
        </div>
      </section>

      <section aria-labelledby="table-title" class="mt-8">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="table-title" class="text-base font-semibold">人員目錄</h2>
            <p v-if="matchingRecords > 0" class="mt-1 text-sm text-muted">已載入 {{ formatCount(loadedCount) }} / {{ formatCount(matchingRecords) }} 筆</p>
            <p v-else class="mt-1 text-sm text-muted">沒有符合的資料</p>
          </div>
          <span class="text-xs font-medium text-muted">每批 {{ PAGE_SIZE }} 筆</span>
        </div>

        <form class="my-4 flex flex-col gap-3 sm:flex-row sm:items-center" role="search" @submit.prevent="submitSearch">
          <label class="sr-only" for="employee-search">搜尋資料編號、姓名、職位、地點、年齡或到職日</label>
          <input
            id="employee-search"
            v-model="searchInput"
            type="search"
            autocomplete="off"
            placeholder="搜尋資料編號、姓名、職位、地點、年齡或到職日"
            class="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted/75 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
          <div class="flex gap-2">
            <button type="submit" class="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1d6045]">搜尋</button>
            <button v-if="activeSearch" type="button" class="rounded-md border border-line px-4 py-2.5 text-sm font-medium hover:bg-canvas" @click="clearSearch">清除</button>
          </div>
          <span v-if="isResetting" role="status" aria-live="polite" class="text-xs text-muted">正在搜尋或排序…</span>
        </form>

        <div class="my-4 flex flex-wrap items-center justify-between gap-3">
          <label class="flex items-center gap-3 text-sm font-medium text-ink">
            資料規模
            <select
              :value="datasetSize"
              :disabled="isResetting"
              aria-label="選擇假資料總筆數"
              class="rounded-md border border-line bg-surface px-3 py-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
              @change="changeDatasetSize"
            >
              <option v-for="option in DATASET_SIZE_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }} 筆
              </option>
            </select>
          </label>
          <span class="text-xs text-muted">Mock repository · {{ formatCount(datasetSize) }} records</span>
        </div>

        <p v-if="errorMessage" role="alert" class="mb-3 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {{ errorMessage }}
          <button class="font-semibold underline underline-offset-2" @click="resetList()">重新載入</button>
        </p>

        <div class="mt-4 overflow-hidden rounded-md border border-line bg-surface">
          <div class="overflow-x-auto">
            <!-- 虛擬列表只渲染部分列，固定欄寬避免捲動時欄寬隨可見內容跳動。 -->
            <table class="people-table w-full table-fixed border-collapse text-left text-sm sm:min-w-300" :aria-rowcount="matchingRecords + 1">
              <caption class="sr-only">人員資料，包含資料編號、姓名、職位、地點、年齡與到職日</caption>
              <colgroup>
                <col class="w-36">
                <col class="w-64">
                <col>
                <col class="w-30">
                <col class="w-22">
                <col class="w-30">
                <col class="w-66">
              </colgroup>
              <thead class="bg-[#f7f9f7] text-xs font-semibold text-muted">
                <tr aria-rowindex="1">
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'dataNumber' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink" @click="sortRecords('dataNumber')">資料編號 {{ sortIndicator('dataNumber') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink" @click="sortRecords('name')">姓名 {{ sortIndicator('name') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'position' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink" @click="sortRecords('position')">職位 {{ sortIndicator('position') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'location' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink" @click="sortRecords('location')">地點 {{ sortIndicator('location') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'age' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink" @click="sortRecords('age')">年齡 {{ sortIndicator('age') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'dateStart' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink" @click="sortRecords('dateStart')">到職日 {{ sortIndicator('dateStart') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody ref="tableBody" class="divide-y divide-line">
                <tr v-if="virtualPaddingTop > 0" aria-hidden="true" class="virtual-spacer">
                  <td colspan="7" :style="{ height: `${virtualPaddingTop}px` }"></td>
                </tr>
                <tr
                  v-for="{ record, position } in visibleRows"
                  :key="record.id"
                  :data-row-position="position"
                  :aria-rowindex="position + 1"
                  class="transition-colors"
                  :class="getPinnedPosition(record) ? 'bg-accent-soft hover:bg-accent-soft' : 'hover:bg-[#f8fbf9]'"
                >
                  <td data-label="資料編號" class="whitespace-nowrap px-5 py-4 font-mono text-xs text-muted sm:truncate">{{ record.dataNumber }}</td>
                  <td data-label="姓名" class="whitespace-nowrap px-5 py-4 font-medium">
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="truncate">{{ record.name }}</span>
                      <span v-if="getPinnedPosition(record)" class="shrink-0 rounded-full border border-accent/30 bg-surface px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-accent">
                        PIN TO #{{ formatCount(getPinnedPosition(record)!) }}
                      </span>
                    </span>
                  </td>
                  <td data-label="職位" class="whitespace-nowrap px-5 py-4 text-muted sm:truncate">{{ record.position }}</td>
                  <td data-label="地點" class="whitespace-nowrap px-5 py-4 text-muted sm:truncate">{{ record.location }}</td>
                  <td data-label="年齡" class="whitespace-nowrap px-5 py-4 tabular-nums text-muted">{{ record.age }}</td>
                  <td data-label="到職日" class="whitespace-nowrap px-5 py-4 font-mono text-xs text-muted sm:truncate">{{ record.dateStart }}</td>
                  <td data-label="操作" class="px-5 py-3 text-right">
                    <div class="flex flex-nowrap items-center justify-end gap-3">
                      <button class="text-xs font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50" :disabled="isResetting" @click="openDialog('edit', record, position)">編輯</button>
                      <button
                        :class="getPinnedPosition(record) ? 'rounded-md bg-accent px-2 py-1 text-[0.7rem] font-semibold uppercase text-white shadow-sm hover:bg-[#1d6045]' : 'text-xs font-semibold uppercase text-accent underline-offset-2 hover:underline'"
                        :aria-label="`PIN TO position for ${record.name}`"
                        :disabled="isResetting"
                        @click="openDialog('position', record, position)"
                      >
                        {{ getPinnedPosition(record) ? `PIN TO #${formatCount(getPinnedPosition(record)!)}` : 'PIN TO' }}
                      </button>
                      <button class="text-xs font-medium text-red-700 underline-offset-2 hover:underline disabled:opacity-50" :disabled="isResetting" @click="openDialog('delete', record, position)">刪除</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="virtualPaddingBottom > 0" aria-hidden="true" class="virtual-spacer">
                  <td colspan="7" :style="{ height: `${virtualPaddingBottom}px` }"></td>
                </tr>
                <tr v-if="isResetting && records.length === 0">
                  <td colspan="7" class="px-5 py-12 text-center text-sm text-muted" role="status">正在載入資料…</td>
                </tr>
                <tr v-else-if="records.length === 0 && !errorMessage">
                  <td colspan="7" class="px-5 py-12 text-center text-sm text-muted">目前沒有資料</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 無限載入觸發點：進入視窗下方預載範圍時載入下一批。 -->
        <div ref="loadMoreSentinel" aria-hidden="true" class="h-px"></div>

        <div class="flex flex-col gap-3 px-1 py-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" :class="loadMoreError ? 'text-red-800' : ''">
            <template v-if="matchingRecords === 0">沒有符合的資料 · 總資料 {{ formatCount(totalRecords) }} 筆</template>
            <template v-else-if="isLoadingMore">正在載入第 {{ formatCount(loadedCount + 1) }}–{{ formatCount(nextBatchEnd) }} 筆…（已載入 {{ formatCount(loadedCount) }} / {{ formatCount(matchingRecords) }} 筆）</template>
            <template v-else-if="loadMoreError">{{ loadMoreError }}</template>
            <template v-else-if="hasMore">已載入 {{ formatCount(loadedCount) }} / {{ formatCount(matchingRecords) }} 筆符合（總資料 {{ formatCount(totalRecords) }} 筆）· 向下捲動自動載入</template>
            <template v-else>已載入全部 {{ formatCount(matchingRecords) }} 筆符合資料（總資料 {{ formatCount(totalRecords) }} 筆）</template>
          </p>
          <button
            v-if="matchingRecords > 0 && hasMore"
            class="self-end rounded-md border border-line bg-surface px-3 py-2 font-medium text-ink transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45 sm:self-auto"
            :disabled="isLoadingMore || isResetting"
            @click="retryLoadMore"
          >
            {{ loadMoreError ? '重試' : '載入更多' }}
          </button>
        </div>
      </section>
    </main>

    <EmployeeDialog
      :open="dialogOpen"
      :mode="dialogMode"
      :employee="activeEmployee"
      :current-position="activePosition"
      :total-positions="pageTotal"
      :saving="isSaving"
      :error="dialogError"
      @close="closeDialog"
      @create="createEmployee"
      @update="updateEmployee"
      @remove="deleteEmployee"
      @move-position="moveEmployeeToPosition"
    />

    <Transition
      enter-active-class="transition duration-200 motion-reduce:transition-none"
      leave-active-class="transition duration-200 motion-reduce:transition-none"
      enter-from-class="translate-y-2 opacity-0"
      leave-to-class="translate-y-2 opacity-0"
    >
      <button
        v-show="showBackToTop"
        type="button"
        aria-label="回到最上方"
        title="回到最上方"
        class="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-20 grid size-11 place-items-center rounded-full bg-accent text-white shadow-lg hover:bg-[#1d6045] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        @click="scrollToTop"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </Transition>
  </div>
</template>
