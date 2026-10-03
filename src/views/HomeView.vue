<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import EmployeeDialog from '../components/EmployeeDialog.vue'
import LoadingSpinner from '../components/LoadingSpinner.vue'
import { useWindowVirtualRows } from '../composables/useWindowVirtualRows'
import { matchesEmployeeSearch } from '../data/employeeQuery'
import { createMockEmployeeRepository } from '../data/mockEmployeeRepository'
import {
  DATASET_SIZE_OPTIONS,
  DEFAULT_DATASET_SIZE,
  PAGE_SIZE,
  type EmployeeDraft,
  type EmployeePage,
  type EmployeeQuery,
  type EmployeeRepository,
  type EmployeeSearchField,
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
const SORT_FIELDS: ReadonlyArray<{ value: EmployeeSortField; label: string }> = [
  { value: 'dataNumber', label: '資料編號' },
  { value: 'name', label: '姓名' },
  { value: 'position', label: '職位' },
  { value: 'location', label: '地點' },
  { value: 'age', label: '年齡' },
  { value: 'dateStart', label: '到職日' },
]
// 欄位名稱已顯示在選單上，placeholder 只給輸入範例（手機寬度放得下）；年齡是完全比對，其餘欄位為部分符合。
const SEARCH_PLACEHOLDERS: Record<EmployeeSearchField, string> = {
  dataNumber: '例如 DATA-00000123',
  name: '例如 Alex',
  position: '例如 Engineer',
  location: '例如 Taipei',
  age: '完全符合，例如 30',
  dateStart: '例如 2021-10',
}
const ALL_FIELDS_PLACEHOLDER = '關鍵字，例如 Taipei'
const ALL_FIELDS_LABEL = '搜尋資料編號、姓名、職位、地點、年齡或到職日'
// 精簡頁首高度（h-12）；頁首捲到它底下時才切換，兩者重疊時看不出交接。
const COMPACT_HEADER_PX = 48
// 固定區各層之間的留白，與 main.css 的遮罩帶高度（0.75rem）一致。
const STICKY_GAP_PX = 12
const BUSY_INDICATOR_DELAY_MS = 250
// 操作結果提示顯示的時間。
const STATUS_TOAST_MS = 5000
// 回到最上方時平滑捲動的最長距離（畫面高的倍數）；更遠的先瞬間跳到這個距離再捲動。
const BACK_TO_TOP_GLIDE_VIEWPORTS = 3

const datasetSize = ref<number>(DEFAULT_DATASET_SIZE)
// 列資料只會整批取代或附加，不會就地修改；shallowRef 避免累積上萬筆時為每筆建立深層 proxy。
const records = shallowRef<Employee[]>([])
const manualPositions = ref(new Map<string, number>())
const totalRecords = ref(0)
const pageTotal = ref(0)
const matchingRecords = ref(0)
const searchInput = ref('')
const activeSearch = ref('')
// 預設依資料編號搜尋；null 表示搜尋全部欄位。
const searchField = ref<EmployeeSearchField | null>('dataNumber')
// 一律有排序欄位，預設資料編號正序；未新增或改過資料編號時，repository 會直接依索引分頁，不需全量排序。
const sortBy = ref<EmployeeSortField>('dataNumber')
const sortDirection = ref<SortDirection>('asc')
const isResetting = ref(false)
// 重新查詢期間顯示的說明；排序千萬筆需要數秒，要讓使用者知道正在做什麼。
const busyMessage = ref('')
// 超過 BUSY_INDICATOR_DELAY_MS 才顯示忙碌提示，未排序的翻頁只要數十毫秒，避免提示一閃而過。
const showBusy = ref(false)
let busyTimer: ReturnType<typeof setTimeout> | undefined
const isLoadingMore = ref(false)
const loadMoreError = ref('')
const loadMoreSentinel = ref<HTMLElement | null>(null)
const tableBody = ref<HTMLElement | null>(null)
const summarySection = ref<HTMLElement | null>(null)
const pageHeader = ref<HTMLElement | null>(null)
const pageTitle = ref<HTMLElement | null>(null)
const searchInputElement = ref<HTMLInputElement | null>(null)
// 頁首捲到精簡頁首底下後為 true：顯示精簡頁首與「回到最上方」。
const pageHeaderScrolledAway = ref(false)
const tableHead = ref<HTMLElement | null>(null)
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
let statusTimer: ReturnType<typeof setTimeout> | undefined

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
    searchField: searchField.value,
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
    void resetList(getCurrentQuery(), searchingMessage())
  }, SEARCH_DEBOUNCE_MS)
})

watch(isResetting, (resetting) => {
  if (busyTimer !== undefined) clearTimeout(busyTimer)
  busyTimer = undefined
  if (!resetting) {
    showBusy.value = false
    return
  }
  busyTimer = setTimeout(() => {
    busyTimer = undefined
    showBusy.value = true
  }, BUSY_INDICATOR_DELAY_MS)
})

const searchPlaceholder = computed(() => (searchField.value ? SEARCH_PLACEHOLDERS[searchField.value] : ALL_FIELDS_PLACEHOLDER))
const searchLabel = computed(() => {
  const label = SORT_FIELDS.find((option) => option.value === searchField.value)?.label
  return label ? `搜尋${label}` : ALL_FIELDS_LABEL
})
// 只在有搜尋條件且查詢完成時顯示，避免查詢中顯示上一次的筆數。
const showSearchResult = computed(() => activeSearch.value !== '' && !isResetting.value)
const searchResultScope = computed(() => SORT_FIELDS.find((option) => option.value === searchField.value)?.label ?? '全部欄位')

function searchingMessage(): string {
  if (!activeSearch.value) return '正在載入全部資料…'
  const label = SORT_FIELDS.find((option) => option.value === searchField.value)?.label ?? ''
  return `正在搜尋${label}「${activeSearch.value}」…`
}

// 已有搜尋詞時換欄位要立即重查；沒有搜尋詞只是預先選好欄位。
function changeSearchField(event: Event): void {
  const value = (event.currentTarget as HTMLSelectElement).value
  searchField.value = SORT_FIELDS.find((option) => option.value === value)?.value ?? null
  if (!activeSearch.value) return
  cancelSearchDebounce()
  activeSearch.value = searchInput.value.trim()
  void resetList(getCurrentQuery(), searchingMessage())
}

function sortingMessage(): string {
  const label = SORT_FIELDS.find((option) => option.value === sortBy.value)?.label ?? ''
  return `正在依${label}${sortDirection.value === 'asc' ? '正序' : '反序'}排序 ${formatCount(matchingRecords.value)} 筆資料…`
}

function submitSearch(): void {
  cancelSearchDebounce()
  activeSearch.value = searchInput.value.trim()
  void resetList(getCurrentQuery(), searchingMessage())
}

function clearSearch(): void {
  cancelSearchDebounce()
  searchInput.value = ''
  activeSearch.value = ''
  void resetList(getCurrentQuery(), searchingMessage())
}

function sortRecords(field: EmployeeSortField): void {
  if (sortBy.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = field
    sortDirection.value = 'asc'
  }
  void resetList(getCurrentQuery(), sortingMessage())
}

// 卡片版面（< 1024px）沒有表頭，改用下拉選單選欄位、按鈕切換正反序。
function changeSortField(event: Event): void {
  const value = (event.currentTarget as HTMLSelectElement).value
  const field = SORT_FIELDS.find((option) => option.value === value)?.value
  if (!field) return
  sortBy.value = field
  sortDirection.value = 'asc'
  void resetList(getCurrentQuery(), sortingMessage())
}

function toggleSortDirection(): void {
  sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  void resetList(getCurrentQuery(), sortingMessage())
}

function ariaSort(field: EmployeeSortField): 'ascending' | 'descending' | 'none' {
  if (sortBy.value !== field) return 'none'
  return sortDirection.value === 'asc' ? 'ascending' : 'descending'
}

// 提示點下去會發生什麼：未排序的欄位先正序，已正序的改為反序。
function sortTitle(field: EmployeeSortField, label: string): string {
  return sortBy.value === field && sortDirection.value === 'asc' ? `依${label}反序排序` : `依${label}正序排序`
}

function getPinnedPosition(employee: Employee): number | undefined {
  const position = manualPositions.value.get(employee.id)
  return position === undefined ? undefined : position + 1
}

function pinLabel(employee: Employee): string {
  const position = getPinnedPosition(employee)
  return position === undefined ? 'PIN TO' : `PIN TO #${formatCount(position)}`
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

async function resetList(query = getCurrentQuery(), message = '正在載入資料…'): Promise<void> {
  const requestId = startListRequest()
  busyMessage.value = message
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

// 異動後只重抓 fromPosition～toPosition 所在的批次，範圍前後已載入的列原樣保留，捲動位置不變；全部抓完才一次替換，避免畫面閃動。
// 未指定 toPosition 時重抓到目前已載入的筆數：刪除或排序位置改變時，之後每一列都可能位移。
async function reloadLoadedRange(fromPosition = 1, toPosition = Number.POSITIVE_INFINITY): Promise<void> {
  const requestId = startListRequest()
  const query = getCurrentQuery()
  const previousRecords = records.value
  const targetCount = Math.max(previousRecords.length, PAGE_SIZE)
  // 結束位置對齊到批次邊界，接回的後段才會從整批的開頭開始。
  const endOffset = Math.min(targetCount, Math.ceil(Math.max(1, toPosition) / PAGE_SIZE) * PAGE_SIZE)
  let offset = Math.min(
    previousRecords.length,
    Math.floor((Math.max(1, fromPosition) - 1) / PAGE_SIZE) * PAGE_SIZE,
  )
  let nextRecords = previousRecords.slice(0, offset)
  let lastPage: EmployeePage | undefined
  busyMessage.value = '正在更新列表…'
  isResetting.value = true

  try {
    while (offset < endOffset) {
      const page = await getRepository().getPage({ ...query, offset, limit: PAGE_SIZE })
      if (isStaleRequest(requestId)) return

      lastPage = page
      nextRecords = nextRecords.concat(page.records)
      offset += page.records.length
      if (page.records.length < PAGE_SIZE) break
    }

    // 範圍內整批都抓到才接回後段；提早遇到不滿一批表示資料已到結尾，後段不再存在。
    records.value = offset >= endOffset ? nextRecords.concat(previousRecords.slice(endOffset)) : nextRecords
    if (lastPage) applyPageSummary(lastPage)
    void continueLoadingIfNeeded()
  } catch (error) {
    if (isStaleRequest(requestId) || isAbortError(error)) return
    errorMessage.value = '資料載入失敗，請重試。'
  } finally {
    if (!isStaleRequest(requestId)) isResetting.value = false
  }
}

// 某一筆從列表消失（刪除，或改完不再符合搜尋條件）時，之後的列往前一格就是新順序，直接在本地移除，不必重抓。
// PIN 固定在原位置、不會跟著往前移；已載入範圍內這筆之後還有 PIN 時回傳 false，由呼叫端重抓。
function removeLoadedRow(id: string, position: number, recordDeleted: boolean): boolean {
  const index = position - 1
  const loaded = records.value
  if (loaded[index]?.id !== id) return false
  for (const pinnedIndex of manualPositions.value.values()) {
    if (pinnedIndex > index && pinnedIndex < loaded.length) return false
  }

  // 讓進行中的 loadMore 失效：它的 offset 是依移除前的筆數算的，接上來會多出一筆重複的資料。
  startListRequest()
  records.value = loaded.slice(0, index).concat(loaded.slice(index + 1))
  const nextPositions = new Map(manualPositions.value)
  nextPositions.delete(id)
  manualPositions.value = nextPositions
  if (recordDeleted) totalRecords.value -= 1
  pageTotal.value -= 1
  matchingRecords.value = pageTotal.value
  void continueLoadingIfNeeded()
  return true
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
  void resetList(getCurrentQuery(), `正在切換為 ${formatCount(nextSize)} 筆資料…`)
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

// 提示固定在視窗底部，捲到深處操作也看得到；先清空再寫入，同樣的訊息連續出現時螢幕閱讀器也會再唸一次。
async function announce(message: string): Promise<void> {
  if (statusTimer !== undefined) clearTimeout(statusTimer)
  statusMessage.value = ''
  await nextTick()
  statusMessage.value = message
  statusTimer = setTimeout(() => {
    statusMessage.value = ''
    statusTimer = undefined
  }, STATUS_TOAST_MS)
}

// 重抓期間列上的按鈕會被停用而失去焦點；完成後把焦點放回同一筆資料，找不到（已刪除或不在已載入範圍）就放到同一列號，再不行才回到列表上方的搜尋框。
async function restoreRowFocus(recordId: string | undefined, position: number, action: 'edit' | 'position'): Promise<void> {
  await nextTick()
  const body = tableBody.value
  const target =
    (recordId ? body?.querySelector<HTMLElement>(`tr[data-record-id="${recordId}"] [data-action="${action}"]`) : null) ??
    body?.querySelector<HTMLElement>(`tr[data-row-position="${position}"] [data-action="${action}"]`) ??
    searchInputElement.value
  target?.focus()
}

async function createEmployee(employee: EmployeeDraft): Promise<void> {
  isSaving.value = true
  dialogError.value = ''
  try {
    const created = await getRepository().create(employee)
    closeDialog()
    // 列表重抓完才提示：有排序或搜尋時重抓需數秒，先提示會在列表更新前就消失；重抓期間由忙碌提示說明進度。
    await resetList(getCurrentQuery(), '正在更新列表…')
    void announce('人員資料已新增。')
    await restoreRowFocus(created.id, 1, 'edit')
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
    // 改到目前排序的欄位時，這筆可能移到更前面，需從第一批重抓到最後；
    // 改完不再符合搜尋條件時，這筆會從列表消失、之後每列往前一格，在本地移除（之後有 PIN 時才從這筆重抓到最後）；
    // 其他情況列的順序不變，只重抓這筆所在的批次。
    const { id } = activeEmployee.value
    const sortValueChanged = String(activeEmployee.value[sortBy.value]) !== String(employee[sortBy.value])
    const stillMatches = matchesEmployeeSearch({ ...employee, id }, activeSearch.value, searchField.value)
    await getRepository().update(id, employee)
    closeDialog()
    if (sortValueChanged) await reloadLoadedRange(1)
    else if (!stillMatches) {
      if (!removeLoadedRow(id, activePosition.value, false)) await reloadLoadedRange(activePosition.value)
    } else await reloadLoadedRange(activePosition.value, activePosition.value)
    void announce('人員資料已更新。')
    await restoreRowFocus(activeEmployee.value.id, activePosition.value, 'edit')
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
    if (!removeLoadedRow(id, activePosition.value, true)) await reloadLoadedRange(activePosition.value)
    void announce('人員資料已刪除。')
    await restoreRowFocus(undefined, activePosition.value, 'edit')
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
    // 只有原位置與目標位置之間的列會位移一格；之後的列少了一筆、也少了一個位置，兩者抵銷，不必重抓。
    await reloadLoadedRange(
      Math.min(activePosition.value, targetPosition),
      Math.max(activePosition.value, targetPosition),
    )

    const { id, name } = activeEmployee.value
    if (targetPosition <= records.value.length) {
      void announce(`${name} 已移至第 ${formatCount(targetPosition)} 筆。`)
      await scrollToPosition(targetPosition)
      await restoreRowFocus(id, targetPosition, 'position')
    } else {
      // 虛擬列表只涵蓋已依序載入的範圍，不為了跳到遠處一次載入大量列；繼續往下捲動即可看到。
      void announce(`${name} 已移至第 ${formatCount(targetPosition)} 筆（尚未載入到該位置）。`)
      await restoreRowFocus(undefined, activePosition.value, 'position')
    }
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : '位置調整失敗，請重新載入資料後再試。'
  } finally {
    isSaving.value = false
  }
}

function scrollToTop(): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const glideDistance = window.innerHeight * BACK_TO_TOP_GLIDE_VIEWPORTS
  // 遠距離先瞬間跳到 glideDistance，只平滑捲動最後一段，避免一路經過大量虛擬列、每幀重新渲染。
  if (!reduceMotion && window.scrollY > glideDistance) window.scrollTo({ top: glideDistance })
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

  // 固定區由上而下為：精簡頁首、留白、摘要、桌機表頭。表頭固定位置接在摘要下緣（CSS 變數），
  // scroll-padding 涵蓋整個固定區，讓鍵盤焦點與 scrollIntoView 不被遮住。表頭在卡片版面隱藏時高度為 0。
  summaryResizeObserver = new ResizeObserver(() => {
    const section = summarySection.value
    if (!section) return
    const summaryBottom = (parseFloat(getComputedStyle(section).top) || 0) + section.offsetHeight
    const headHeight = tableHead.value?.offsetHeight ?? 0
    // 摘要下方一律保留與上方相同的留白（由摘要的 box-shadow 填成頁面底色）；桌機表頭接在留白之後。
    const headTop = summaryBottom + STICKY_GAP_PX
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--sticky-table-head-top', `${headTop}px`)
    rootStyle.scrollPaddingTop = `${headTop + headHeight}px`
  })
  if (summarySection.value) summaryResizeObserver.observe(summarySection.value)
  if (tableHead.value) summaryResizeObserver.observe(tableHead.value)

  // 頁首捲到精簡頁首底下後，顯示精簡頁首與「回到最上方」；用 IntersectionObserver 判斷，不必另外監聽 scroll。
  backToTopObserver = new IntersectionObserver(
    (entries) => {
      pageHeaderScrolledAway.value = !entries.some((entry) => entry.isIntersecting)
    },
    { rootMargin: `-${COMPACT_HEADER_PX}px 0px 0px 0px` },
  )
  if (pageHeader.value) backToTopObserver.observe(pageHeader.value)
  void resetList()
})

onBeforeUnmount(() => {
  cancelSearchDebounce()
  loadMoreObserver?.disconnect()
  summaryResizeObserver?.disconnect()
  backToTopObserver?.disconnect()
  if (statusTimer !== undefined) clearTimeout(statusTimer)
  if (busyTimer !== undefined) clearTimeout(busyTimer)
  document.documentElement.style.removeProperty('scroll-padding-top')
  document.documentElement.style.removeProperty('--sticky-table-head-top')
})
</script>

<template>
  <div class="min-h-screen bg-surface text-ink">
    <header ref="pageHeader" class="border-b border-line bg-accent-soft">
      <section aria-labelledby="page-title" class="mx-auto flex w-full max-w-370 flex-wrap items-end justify-between gap-4 px-4 py-5 sm:px-6 sm:py-10 lg:px-10">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-accent">DIRECTORY / PEOPLE</p>
          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 id="page-title" ref="pageTitle" tabindex="-1" class="outline-none text-2xl font-semibold leading-tight sm:text-[2rem]">人員資料</h1>
            <!-- 資料性質放在頁首：整頁都是模擬資料，比夾在列表上方更容易注意到。 -->
            <span class="rounded-full border border-accent/30 bg-surface px-2.5 py-0.5 text-xs font-semibold text-accent">模擬資料</span>
          </div>
        </div>
        <!-- base.css 讓 button 繼承父層字型，字級寫在內層 span 才會生效。 -->
        <button class="shrink-0 rounded-md bg-accent px-3 py-1.5 font-semibold text-white hover:bg-[#1d6045] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:px-4 sm:py-2" @click="openDialog('create')"><span class="block text-[0.8125rem] leading-5 sm:text-base sm:leading-6">新增人員</span></button>
      </section>
    </header>

    <!-- 精簡頁首：原頁首照常捲走，捲出後才顯示；fixed 不佔版面，切換時內容不會跳動。標題文字已在原頁首，對輔助科技隱藏。 -->
    <Transition
      enter-active-class="transition duration-150 motion-reduce:transition-none"
      leave-active-class="transition duration-150 motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-show="pageHeaderScrolledAway" data-compact-header class="fixed inset-x-0 top-0 z-30 h-12 border-b border-line bg-accent-soft">
        <div class="mx-auto flex h-full w-full max-w-370 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
          <p aria-hidden="true" class="flex items-center gap-2 text-base font-semibold">
            人員資料
            <span class="rounded-full border border-accent/30 bg-surface px-2 py-px text-[0.6875rem] font-semibold text-accent">模擬資料</span>
          </p>
          <button class="shrink-0 rounded-md bg-accent px-2.5 py-1 font-semibold text-white hover:bg-[#1d6045] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:px-3 sm:py-1.5" @click="openDialog('create')"><span class="block text-[0.8125rem] leading-5 sm:text-base sm:leading-6">新增人員</span></button>
        </div>
      </div>
    </Transition>

    <!-- 底部留白要大於右下角浮動按鈕的高度，捲到底時「載入更多」才不會被蓋住。 -->
    <main class="mx-auto w-full max-w-370 px-4 pb-24 sm:px-6 lg:px-10">
      <section ref="summarySection" aria-label="資料摘要" class="summary-grid sticky top-15 z-10 mt-4 grid sm:mt-7 grid-cols-2 rounded-md border border-l-4 border-line border-l-accent bg-canvas px-4 sm:px-6">
        <div class="min-w-0 py-3 pr-3 sm:py-5">
          <!-- 總資料量直接當作資料規模選單，省掉列表上方獨立的一列。 -->
          <label for="dataset-size-summary" class="block text-xs text-ink/75 sm:text-sm">總資料量</label>
          <select
            id="dataset-size-summary"
            name="datasetSizeSummary"
            :value="datasetSize"
            :disabled="isResetting"
            class="summary-size-select mt-2 min-w-0 max-w-full rounded border-0 bg-transparent p-0 text-lg font-semibold leading-7 text-ink tabular-nums max-[359px]:text-[0.9375rem] outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 sm:text-[1.75rem]"
            @change="changeDatasetSize"
          >
            <option v-for="option in DATASET_SIZE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }} 筆</option>
          </select>
          <!-- 選單值是假資料的基礎筆數；新增、刪除後實際總數會不同，如實列出。 -->
          <p v-if="totalRecords > 0 && totalRecords !== datasetSize" class="mt-0.5 text-xs text-ink/75 sm:text-sm">目前共 {{ formatCount(totalRecords) }} 筆</p>
        </div>
        <!-- 符合條件筆數只在搜尋時有意義，改顯示在搜尋框下方；未搜尋時它等於總資料量。 -->
        <div class="min-w-0 border-l border-line py-3 pl-3 sm:py-5 sm:pl-6">
          <p class="text-xs text-ink/75 sm:text-sm">目前載入</p>
          <p class="mt-2 min-w-0 whitespace-nowrap text-lg font-semibold leading-7 tabular-nums max-[359px]:text-[0.9375rem] sm:text-[1.75rem]"><span data-summary="loaded">{{ formatCount(loadedCount) }}</span> 筆</p>
        </div>
      </section>

      <section aria-labelledby="table-title" class="mt-5 sm:mt-8">
        <!-- 頁首已有「人員資料」大標，畫面上不再重複；標題留給輔助科技做區塊命名與標題導覽。 -->
        <h2 id="table-title" class="sr-only">人員目錄</h2>

        <form class="flex items-stretch gap-2 sm:gap-3" role="search" @submit.prevent="submitSearch">
          <!-- 欄位選單與關鍵字共用一個外框：一眼看出是「在哪個欄位搜尋什麼」；焦點框畫在整組外框上。 -->
          <div class="flex min-w-0 flex-1 rounded-md border border-line bg-surface focus-within:ring-2 focus-within:ring-accent">
            <label class="sr-only" for="search-field">搜尋欄位</label>
            <select
              id="search-field"
              name="searchField"
              :value="searchField ?? ''"
              class="min-w-[calc(5em+2rem)] shrink-0 rounded-l-md border-0 border-r border-line bg-canvas px-3 py-2.5 text-sm outline-none"
              @change="changeSearchField"
            >
              <option value="">全部欄位</option>
              <option v-for="field in SORT_FIELDS" :key="field.value" :value="field.value">{{ field.label }}</option>
            </select>
            <label class="sr-only" for="employee-search">{{ searchLabel }}</label>
            <input
              id="employee-search"
              ref="searchInputElement"
              v-model="searchInput"
              type="search"
              autocomplete="off"
              :inputmode="searchField === 'age' ? 'numeric' : 'search'"
              :placeholder="searchPlaceholder"
              class="min-w-0 flex-1 rounded-r-md border-0 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted/75 disabled:opacity-60"
            >
          </div>
          <div class="flex gap-2">
            <!-- 手機寬度只顯示圖示，與搜尋框同一行以節省首屏高度；按鈕文字仍保留給輔助科技作為名稱。 -->
            <button type="submit" class="flex items-center justify-center rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#1d6045] sm:px-4">
              <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5 sm:hidden" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <span class="max-sm:sr-only">搜尋</span>
            </button>
            <button v-if="activeSearch" type="button" class="flex items-center justify-center rounded-md border border-line px-3 py-2.5 text-sm font-medium hover:bg-canvas sm:px-4" @click="clearSearch">
              <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5 sm:hidden" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              <span class="max-sm:sr-only">清除</span>
            </button>
          </div>
        </form>

        <!-- 符合筆數只在搜尋後出現；live region 常駐，結果更新時螢幕閱讀器會朗讀。 -->
        <p aria-live="polite" class="text-sm text-muted" :class="showSearchResult ? 'mt-2' : ''">
          <template v-if="showSearchResult">
            符合「{{ activeSearch }}」（{{ searchResultScope }}）：<strong class="font-semibold text-ink tabular-nums">{{ formatCount(matchingRecords) }}</strong> 筆
          </template>
        </p>

        <div class="mb-4 mt-2 flex flex-wrap items-center justify-between gap-2 sm:my-4 sm:gap-3 lg:hidden">
          <!-- 卡片版面（< 1024px）沒有表頭：「排序｜欄位｜方向」組成一組，標籤放在框內。 -->
          <div class="flex w-full rounded-md border border-line bg-surface focus-within:ring-2 focus-within:ring-accent sm:w-auto">
            <label for="sort-field" class="flex shrink-0 items-center rounded-l-md border-r border-line bg-canvas px-3 text-sm font-medium text-ink">排序</label>
            <select
              id="sort-field"
              name="sortField"
              :value="sortBy"
              :disabled="isResetting"
              class="min-w-[calc(5em+2rem)] flex-1 rounded-none border-0 bg-transparent px-3 py-2.5 text-sm outline-none disabled:opacity-60 sm:py-1.5"
              @change="changeSortField"
            >
              <option v-for="field in SORT_FIELDS" :key="field.value" :value="field.value">{{ field.label }}</option>
            </select>
            <button
              type="button"
              class="flex shrink-0 items-center gap-1.5 rounded-r-md border-l border-line px-3 py-2.5 text-sm font-medium text-accent sm:py-1.5 outline-none hover:bg-accent-soft disabled:opacity-50"
              :disabled="isResetting"
              @click="toggleSortDirection"
            >
              {{ sortDirection === 'asc' ? '正序' : '反序' }}
              <LoadingSpinner v-if="showBusy" class="size-3.5" />
              <span v-else aria-hidden="true">{{ sortDirection === 'asc' ? '↑' : '↓' }}</span>
            </button>
          </div>
        </div>

        <p v-if="errorMessage" role="alert" class="mb-3 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {{ errorMessage }}
          <button class="font-semibold underline underline-offset-2" @click="resetList()">重新載入</button>
        </p>

        <!--
          卡片版面（< 1024px）由外框畫邊線與圓角；桌機表格改由儲存格自己畫框（見 main.css），外框不畫，
          表頭固定後才是一塊獨立的圓角區塊，與摘要之間的留白不會有外框線穿過。overflow-clip 不建立捲動容器，不影響 sticky。
        -->
        <div class="mt-4 overflow-clip rounded-md border border-line bg-surface lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent" :aria-busy="isResetting">
          <div>
            <!-- 虛擬列表只渲染部分列，固定欄寬避免捲動時欄寬隨可見內容跳動。 -->
            <table class="people-table w-full table-fixed border-collapse text-left lg:border-separate lg:border-spacing-0 text-sm" :aria-rowcount="matchingRecords + 1">
              <caption class="sr-only">人員資料，包含資料編號、姓名、職位、地點、年齡與到職日</caption>
              <colgroup>
                <col class="w-32">
                <col class="w-48">
                <col>
                <col class="w-24">
                <col class="w-20">
                <col class="w-24">
                <col class="w-52">
              </colgroup>
              <thead ref="tableHead" class="bg-[#f7f9f7] text-xs font-semibold text-muted">
                <tr aria-rowindex="1">
                  <!-- 按鈕撐滿整格：整個表頭格都可點，常駐排序圖示讓「可排序」一眼可見，目前排序欄以強調色標示方向。 -->
                  <th
                    v-for="(field, index) in SORT_FIELDS"
                    :key="field.value"
                    scope="col"
                    class="p-0"
                    :class="sortBy === field.value ? 'bg-accent-soft' : ''"
                    :aria-sort="ariaSort(field.value)"
                  >
                    <button
                      type="button"
                      class="group flex w-full cursor-pointer items-center gap-1.5 whitespace-nowrap py-3.5 text-left font-semibold transition-colors hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                      :class="[index === 0 ? 'pl-5 pr-3' : 'px-3', sortBy === field.value ? 'text-accent' : 'text-muted']"
                      :title="sortTitle(field.value, field.label)"
                      @click="sortRecords(field.value)"
                    >
                      {{ field.label }}
                      <LoadingSpinner v-if="showBusy && sortBy === field.value" class="size-3.5" />
                      <svg v-else aria-hidden="true" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path v-if="sortBy !== field.value" class="opacity-50 transition-opacity group-hover:opacity-100" d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
                        <path v-else-if="sortDirection === 'asc'" d="M7 14l5-5 5 5" />
                        <path v-else d="M7 10l5 5 5-5" />
                      </svg>
                    </button>
                  </th>
                  <th scope="col" class="py-3.5 pl-3 pr-5 text-right">操作</th>
                </tr>
              </thead>
              <!-- 重新查詢期間只淡化資料列，表示畫面上的資料即將被取代；表頭保持清楚，才看得到排序中的欄位。 -->
              <tbody
                ref="tableBody"
                class="divide-y divide-line transition-opacity motion-reduce:transition-none"
                :class="showBusy && records.length > 0 ? 'opacity-50' : ''"
              >
                <tr v-if="virtualPaddingTop > 0" aria-hidden="true" class="virtual-spacer">
                  <td colspan="7" :style="{ height: `${virtualPaddingTop}px` }"></td>
                </tr>
                <tr
                  v-for="{ record, position } in visibleRows"
                  :key="record.id"
                  :data-row-position="position"
                  :data-record-id="record.id"
                  :aria-rowindex="position + 1"
                  class="transition-colors"
                  :class="getPinnedPosition(record) ? 'bg-accent-soft hover:bg-accent-soft' : 'hover:bg-[#f8fbf9]'"
                >
                  <td data-label="資料編號" class="whitespace-nowrap py-4 pl-5 pr-3 font-mono text-xs text-muted lg:truncate">{{ record.dataNumber }}</td>
                  <td data-label="姓名" class="whitespace-nowrap px-3 py-4 font-medium">
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="truncate" :title="record.name">{{ record.name }}</span>
                      <span v-if="getPinnedPosition(record)" class="shrink-0 rounded-full border border-accent/30 bg-surface px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-accent">
                        PIN TO #{{ formatCount(getPinnedPosition(record)!) }}
                      </span>
                    </span>
                  </td>
                  <td data-label="職位" class="whitespace-nowrap px-3 py-4 text-muted lg:truncate" :title="record.position">{{ record.position }}</td>
                  <td data-label="地點" class="whitespace-nowrap px-3 py-4 text-muted lg:truncate" :title="record.location">{{ record.location }}</td>
                  <td data-label="年齡" class="whitespace-nowrap px-3 py-4 tabular-nums text-muted">{{ record.age }}</td>
                  <td data-label="到職日" class="whitespace-nowrap px-3 py-4 font-mono text-xs text-muted lg:truncate">{{ record.dateStart }}</td>
                  <td data-label="操作" class="py-3 pl-3 pr-5 text-right">
                    <div class="flex flex-nowrap items-center justify-end gap-2">
                      <!-- aria-label 以畫面上的按鈕文字開頭再加姓名，符合 WCAG 2.5.3（Label in Name）。 -->
                      <button
                        data-action="edit"
                        class="text-xs font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50"
                        :aria-label="`編輯 ${record.name}`"
                        :disabled="isResetting"
                        @click="openDialog('edit', record, position)"
                      >
                        編輯
                      </button>
                      <button
                        data-action="position"
                        :class="getPinnedPosition(record) ? 'rounded-md bg-accent px-2 py-1 text-[0.7rem] font-semibold uppercase text-white shadow-sm hover:bg-[#1d6045]' : 'text-xs font-semibold uppercase text-accent underline-offset-2 hover:underline'"
                        :aria-label="`${pinLabel(record)} ${record.name}`"
                        :disabled="isResetting"
                        @click="openDialog('position', record, position)"
                      >
                        {{ pinLabel(record) }}
                      </button>
                      <button
                        data-action="delete"
                        class="text-xs font-medium text-red-700 underline-offset-2 hover:underline disabled:opacity-50"
                        :aria-label="`刪除 ${record.name}`"
                        :disabled="isResetting"
                        @click="openDialog('delete', record, position)"
                      >
                        刪除
                      </button>
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
            <template v-else-if="hasMore">已載入 {{ formatCount(loadedCount) }} / {{ formatCount(matchingRecords) }} 筆符合（總資料 {{ formatCount(totalRecords) }} 筆）· 向下捲動每次自動載入 {{ PAGE_SIZE }} 筆</template>
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

    <!-- live region 常駐在 DOM，只替換內容，螢幕閱讀器才能可靠地朗讀；右側留出「回到最上方」按鈕的空間。 -->
    <div
      id="action-status"
      role="status"
      aria-live="polite"
      class="pointer-events-none fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] right-20 z-20 flex flex-col items-start gap-2 sm:right-auto"
    >
      <Transition
        enter-active-class="transition duration-200 motion-reduce:transition-none"
        leave-active-class="transition duration-200 motion-reduce:transition-none"
        enter-from-class="translate-y-2 opacity-0"
        leave-to-class="translate-y-2 opacity-0"
      >
        <p v-if="showBusy" class="flex max-w-md items-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-medium text-white shadow-lg">
          <LoadingSpinner class="size-4" />
          {{ busyMessage }}
        </p>
      </Transition>
      <Transition
        enter-active-class="transition duration-200 motion-reduce:transition-none"
        leave-active-class="transition duration-200 motion-reduce:transition-none"
        enter-from-class="translate-y-2 opacity-0"
        leave-to-class="translate-y-2 opacity-0"
      >
        <p v-if="statusMessage" class="flex max-w-md items-center gap-2 rounded-md bg-ink px-4 py-3 text-sm text-white shadow-lg">
          <svg aria-hidden="true" viewBox="0 0 24 24" class="size-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
          {{ statusMessage }}
        </p>
      </Transition>
    </div>

    <Transition
      enter-active-class="transition duration-200 motion-reduce:transition-none"
      leave-active-class="transition duration-200 motion-reduce:transition-none"
      enter-from-class="translate-y-2 opacity-0"
      leave-to-class="translate-y-2 opacity-0"
    >
      <button
        v-show="pageHeaderScrolledAway"
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
