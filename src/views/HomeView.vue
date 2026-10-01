<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import EmployeeDialog from '../components/EmployeeDialog.vue'
import { createMockEmployeeRepository } from '../data/mockEmployeeRepository'
import {
  DATASET_SIZE_OPTIONS,
  DEFAULT_DATASET_SIZE,
  PAGE_SIZE,
  type EmployeeDraft,
  type EmployeeQuery,
  type EmployeeRepository,
  type EmployeeSortField,
  type SortDirection,
} from '../data/employeeRepository'
import type { Employee } from '../types/employee'

const datasetSize = ref<number>(DEFAULT_DATASET_SIZE)
const records = ref<Employee[]>([])
const manualPositions = ref(new Map<string, number>())
const totalRecords = ref(0)
const pageTotal = ref(0)
const matchingRecords = ref(0)
const searchInput = ref('')
const activeSearch = ref('')
const sortBy = ref<EmployeeSortField | null>(null)
const sortDirection = ref<SortDirection>('asc')
const currentOffset = ref(0)
const isLoading = ref(false)
const errorMessage = ref('')
const dialogOpen = ref(false)
const dialogMode = ref<'create' | 'edit' | 'delete' | 'position'>('create')
const activeEmployee = ref<Employee | null>(null)
const activePosition = ref(1)
const dialogError = ref('')
const isSaving = ref(false)
const statusMessage = ref('')

const repositories = new Map<number, EmployeeRepository>()

function getRepository(size = datasetSize.value): EmployeeRepository {
  let repository = repositories.get(size)
  if (!repository) {
    repository = createMockEmployeeRepository(size)
    repositories.set(size, repository)
  }
  return repository
}

const pageNumber = computed(() => Math.floor(currentOffset.value / PAGE_SIZE) + 1)
const pageCount = computed(() => Math.ceil(pageTotal.value / PAGE_SIZE))
const rangeStart = computed(() => (records.value.length > 0 ? currentOffset.value + 1 : 0))
const rangeEnd = computed(() => currentOffset.value + records.value.length)
const hasPreviousPage = computed(() => currentOffset.value > 0)
const hasNextPage = computed(() => rangeEnd.value < pageTotal.value)
const loadedCount = computed(() => records.value.length)

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

function submitSearch(): void {
  activeSearch.value = searchInput.value.trim()
  void loadPage(0)
}

function clearSearch(): void {
  searchInput.value = ''
  activeSearch.value = ''
  void loadPage(0)
}

function sortRecords(field: EmployeeSortField): void {
  if (sortBy.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = field
    sortDirection.value = 'asc'
  }
  void loadPage(0)
}

function sortIndicator(field: EmployeeSortField): string {
  if (sortBy.value !== field) return ''
  return sortDirection.value === 'asc' ? '↑' : '↓'
}

function getPinnedPosition(employee: Employee): number | undefined {
  const position = manualPositions.value.get(employee.id)
  return position === undefined ? undefined : position + 1
}

async function loadPage(offset = currentOffset.value, query = getCurrentQuery()): Promise<void> {
  if (isLoading.value) return

  isLoading.value = true
  errorMessage.value = ''

  try {
    const page = await getRepository().getPage({ ...query, offset, limit: PAGE_SIZE })

    records.value = page.records
    manualPositions.value = new Map(page.manualPositions.map(({ id, position }) => [id, position]))
    totalRecords.value = page.total
    pageTotal.value = page.pageTotal
    matchingRecords.value = page.pageTotal
    currentOffset.value = page.offset
  } catch {
    errorMessage.value = '資料載入失敗，請重試。'
  } finally {
    isLoading.value = false
  }
}

function changeDatasetSize(event: Event): void {
  const nextSize = Number((event.currentTarget as HTMLSelectElement).value)
  if (!DATASET_SIZE_OPTIONS.some((option) => option.value === nextSize)) return

  datasetSize.value = nextSize
  void loadPage(0)
}

function goToPreviousPage(): void {
  void loadPage(Math.max(0, currentOffset.value - PAGE_SIZE))
}

function goToNextPage(): void {
  if (hasNextPage.value) void loadPage(currentOffset.value + PAGE_SIZE)
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

async function refreshAfterMutation(offset = currentOffset.value): Promise<void> {
  await loadPage(offset)
  if (records.value.length === 0 && offset > 0) {
    await loadPage(Math.max(0, offset - PAGE_SIZE))
  }
}

async function createEmployee(employee: EmployeeDraft): Promise<void> {
  isSaving.value = true
  dialogError.value = ''
  try {
    await getRepository().create(employee)
    closeDialog()
    statusMessage.value = '人員資料已新增。'
    await loadPage(0)
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
    await refreshAfterMutation()
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
    await refreshAfterMutation()
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
    statusMessage.value = `${activeEmployee.value.name} 已移至第 ${formatCount(targetPosition)} 筆。`
    await loadPage(Math.floor((targetPosition - 1) / PAGE_SIZE) * PAGE_SIZE, getCurrentQuery())
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : '位置調整失敗，請重新載入資料後再試。'
  } finally {
    isSaving.value = false
  }
}

onMounted(() => {
  void loadPage(0)
})
</script>

<template>
  <div class="min-h-screen bg-canvas text-ink">
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex min-h-16 max-w-[1480px] items-center justify-between px-4 sm:px-6 lg:px-10">
        <div class="flex items-center gap-3">
          <span class="grid size-8 place-items-center rounded-md bg-accent text-sm font-semibold text-white">P</span>
          <span class="text-sm font-semibold tracking-[0.08em]">PEOPLE DIRECTORY</span>
        </div>
        <span class="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted">本地模擬</span>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1480px] px-4 pb-12 pt-8 sm:px-6 sm:pt-10 lg:px-10">
      <section aria-labelledby="page-title" class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-accent">DIRECTORY / PEOPLE</p>
          <h1 id="page-title" class="mt-2 text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">人員資料</h1>
        </div>
        <div class="flex items-center gap-3">
          <p class="text-sm text-muted">固定種子 · 可重現資料</p>
          <button class="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d6045] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" @click="openDialog('create')">新增人員</button>
        </div>
      </section>

      <p v-if="statusMessage" role="status" aria-live="polite" class="mt-4 text-sm text-accent">{{ statusMessage }}</p>

      <section aria-label="資料摘要" class="summary-grid mt-7 grid grid-cols-3 border-y border-line">
        <div class="min-w-0 py-4 pr-3 sm:py-5">
          <p class="text-xs text-muted sm:text-sm">總資料量</p>
          <p class="mt-2 min-w-0 whitespace-nowrap text-xl font-semibold leading-7 tabular-nums sm:text-[1.75rem]">{{ formatCount(totalRecords) }}</p>
        </div>
        <div class="min-w-0 border-l border-line px-3 py-4 sm:px-6 sm:py-5">
          <p class="text-xs text-muted sm:text-sm">符合條件</p>
          <p class="mt-2 min-w-0 whitespace-nowrap text-xl font-semibold leading-7 tabular-nums sm:text-[1.75rem]">{{ formatCount(matchingRecords) }}</p>
        </div>
        <div class="min-w-0 border-l border-line py-4 pl-3 sm:py-5 sm:pl-6">
          <p class="text-xs text-muted sm:text-sm">目前載入</p>
          <p class="mt-2 min-w-0 whitespace-nowrap text-xl font-semibold leading-7 tabular-nums sm:text-[1.75rem]">{{ formatCount(loadedCount) }}</p>
        </div>
      </section>

      <section aria-labelledby="table-title" class="mt-8">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="table-title" class="text-base font-semibold">人員目錄</h2>
            <p v-if="matchingRecords > 0" class="mt-1 text-sm text-muted">目前顯示第 {{ formatCount(rangeStart) }}–{{ formatCount(rangeEnd) }} 筆</p>
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
            :disabled="isLoading"
            class="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted/75 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
          <div class="flex gap-2">
            <button type="submit" class="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1d6045] disabled:opacity-50" :disabled="isLoading">搜尋</button>
            <button v-if="activeSearch" type="button" class="rounded-md border border-line px-4 py-2.5 text-sm font-medium hover:bg-canvas disabled:opacity-50" :disabled="isLoading" @click="clearSearch">清除</button>
          </div>
          <span v-if="isLoading" role="status" aria-live="polite" class="text-xs text-muted">正在搜尋或排序…</span>
        </form>

        <div class="my-4 flex flex-wrap items-center justify-between gap-3">
          <label class="flex items-center gap-3 text-sm font-medium text-ink">
            資料規模
            <select
              :value="datasetSize"
              :disabled="isLoading"
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
          <button class="font-semibold underline underline-offset-2" @click="loadPage()">重新載入</button>
        </p>

        <div class="mt-4 overflow-hidden rounded-md border border-line bg-surface">
          <div class="overflow-x-auto">
            <table class="people-table w-full border-collapse text-left text-sm">
              <caption class="sr-only">人員資料，包含資料編號、姓名、職位、地點、年齡與到職日</caption>
              <thead class="bg-[#f7f9f7] text-xs font-semibold text-muted">
                <tr>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'dataNumber' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink disabled:opacity-50" :disabled="isLoading" @click="sortRecords('dataNumber')">資料編號 {{ sortIndicator('dataNumber') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink disabled:opacity-50" :disabled="isLoading" @click="sortRecords('name')">姓名 {{ sortIndicator('name') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'position' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink disabled:opacity-50" :disabled="isLoading" @click="sortRecords('position')">職位 {{ sortIndicator('position') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'location' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink disabled:opacity-50" :disabled="isLoading" @click="sortRecords('location')">地點 {{ sortIndicator('location') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'age' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink disabled:opacity-50" :disabled="isLoading" @click="sortRecords('age')">年齡 {{ sortIndicator('age') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5" :aria-sort="sortBy === 'dateStart' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="font-semibold hover:text-ink disabled:opacity-50" :disabled="isLoading" @click="sortRecords('dateStart')">到職日 {{ sortIndicator('dateStart') }}</button>
                  </th>
                  <th scope="col" class="px-5 py-3.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line">
                <tr
                  v-for="(record, index) in records"
                  :key="record.id"
                  class="transition-colors"
                  :class="getPinnedPosition(record) ? 'bg-accent-soft hover:bg-accent-soft' : 'hover:bg-[#f8fbf9]'"
                >
                  <td data-label="資料編號" class="whitespace-nowrap px-5 py-4 font-mono text-xs text-muted">{{ record.dataNumber }}</td>
                  <td data-label="姓名" class="whitespace-nowrap px-5 py-4 font-medium">
                    <span class="inline-flex flex-wrap items-center gap-2">
                      {{ record.name }}
                      <span v-if="getPinnedPosition(record)" class="rounded-full border border-accent/30 bg-surface px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-accent">
                        PIN TO #{{ formatCount(getPinnedPosition(record)!) }}
                      </span>
                    </span>
                  </td>
                  <td data-label="職位" class="whitespace-nowrap px-5 py-4 text-muted">{{ record.position }}</td>
                  <td data-label="地點" class="whitespace-nowrap px-5 py-4 text-muted">{{ record.location }}</td>
                  <td data-label="年齡" class="whitespace-nowrap px-5 py-4 tabular-nums text-muted">{{ record.age }}</td>
                  <td data-label="到職日" class="whitespace-nowrap px-5 py-4 font-mono text-xs text-muted">{{ record.dateStart }}</td>
                  <td data-label="操作" class="px-5 py-3 text-right">
                    <div class="flex flex-wrap justify-end gap-x-3 gap-y-2">
                      <button class="text-xs font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50" :disabled="isLoading" @click="openDialog('edit', record, currentOffset + index + 1)">編輯</button>
                      <button
                        :class="getPinnedPosition(record) ? 'rounded-md bg-accent px-2 py-1 text-[0.7rem] font-semibold uppercase text-white shadow-sm hover:bg-[#1d6045]' : 'text-xs font-semibold uppercase text-accent underline-offset-2 hover:underline'"
                        :aria-label="`PIN TO position for ${record.name}`"
                        :disabled="isLoading"
                        @click="openDialog('position', record, currentOffset + index + 1)"
                      >
                        {{ getPinnedPosition(record) ? `PIN TO #${formatCount(getPinnedPosition(record)!)}` : 'PIN TO' }}
                      </button>
                      <button class="text-xs font-medium text-red-700 underline-offset-2 hover:underline disabled:opacity-50" :disabled="isLoading" @click="openDialog('delete', record, currentOffset + index + 1)">刪除</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="isLoading && records.length === 0">
                  <td colspan="7" class="px-5 py-12 text-center text-sm text-muted" role="status">正在載入資料…</td>
                </tr>
                <tr v-else-if="records.length === 0 && !errorMessage">
                  <td colspan="7" class="px-5 py-12 text-center text-sm text-muted">目前沒有資料</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="flex flex-col gap-3 px-1 py-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p v-if="matchingRecords > 0" aria-live="polite">第 {{ formatCount(pageNumber) }} / {{ formatCount(pageCount) }} 頁 · 顯示 {{ formatCount(rangeStart) }}–{{ formatCount(rangeEnd) }} 筆，共 {{ formatCount(matchingRecords) }} 筆符合（總資料 {{ formatCount(totalRecords) }} 筆）</p>
          <p v-else aria-live="polite">沒有符合的資料 · 總資料 {{ formatCount(totalRecords) }} 筆</p>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <button
              class="rounded-md border border-line bg-surface px-3 py-2 font-medium text-ink transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="!hasPreviousPage || isLoading"
              @click="goToPreviousPage"
            >
              ← 上一頁
            </button>
            <button
              class="rounded-md border border-line bg-surface px-3 py-2 font-medium text-ink transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="!hasNextPage || isLoading"
              @click="goToNextPage"
            >
              下一頁 →
            </button>
          </div>
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
  </div>
</template>
