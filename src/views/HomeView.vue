<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import EmployeeDialog from '../components/EmployeeDialog.vue'
import { createMockEmployeeRepository } from '../data/mockEmployeeRepository'
import {
  DATASET_SIZE_OPTIONS,
  DEFAULT_DATASET_SIZE,
  PAGE_SIZE,
  type EmployeeDraft,
  type EmployeeRepository,
} from '../data/employeeRepository'
import type { Employee } from '../types/employee'

const datasetSize = ref<number>(DEFAULT_DATASET_SIZE)
const records = ref<Employee[]>([])
const pinnedRecords = ref<Employee[]>([])
const totalRecords = ref(0)
const pageTotal = ref(0)
const currentOffset = ref(0)
const isLoading = ref(false)
const errorMessage = ref('')
const dialogOpen = ref(false)
const dialogMode = ref<'create' | 'edit' | 'delete'>('create')
const activeEmployee = ref<Employee | null>(null)
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
const loadedCount = computed(() => records.value.length + pinnedRecords.value.length)

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

async function loadPage(offset = currentOffset.value): Promise<void> {
  if (isLoading.value) return

  isLoading.value = true
  errorMessage.value = ''

  try {
    const page = await getRepository().getPage({ offset, limit: PAGE_SIZE })

    records.value = page.records
    pinnedRecords.value = page.pinnedRecords
    totalRecords.value = page.total
    pageTotal.value = page.pageTotal
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

function openDialog(mode: 'create' | 'edit' | 'delete', employee: Employee | null = null): void {
  dialogMode.value = mode
  activeEmployee.value = employee
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
    await getRepository().delete(id)
    closeDialog()
    statusMessage.value = '人員資料已刪除。'
    await refreshAfterMutation()
  } catch {
    dialogError.value = '刪除失敗，請重試。'
  } finally {
    isSaving.value = false
  }
}

async function togglePinned(employee: Employee): Promise<void> {
  const shouldPin = !pinnedRecords.value.some((record) => record.id === employee.id)
  await getRepository().setPinned(employee.id, shouldPin)
  statusMessage.value = shouldPin ? `${employee.name} 已置頂。` : `${employee.name} 已取消置頂。`
  await refreshAfterMutation()
}

async function movePinned(employee: Employee, direction: 'up' | 'down'): Promise<void> {
  await getRepository().movePinned(employee.id, direction)
  statusMessage.value = '置頂順序已更新。'
  await loadPage(currentOffset.value)
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
          <p class="mt-2 min-w-0 whitespace-nowrap text-xl font-semibold leading-7 tabular-nums sm:text-[1.75rem]">{{ formatCount(totalRecords) }}</p>
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
            <p class="mt-1 text-sm text-muted">目前顯示第 {{ formatCount(rangeStart) }}–{{ formatCount(rangeEnd) }} 筆</p>
          </div>
          <span class="text-xs font-medium text-muted">每批 {{ PAGE_SIZE }} 筆</span>
        </div>

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

        <section v-if="pinnedRecords.length > 0" aria-label="已置頂人員" class="mb-5 border-y border-line bg-accent-soft/45">
          <div class="flex items-baseline justify-between gap-3 px-4 py-3">
            <h3 class="text-sm font-semibold">置頂順序</h3>
            <span class="text-xs text-muted">{{ formatCount(pinnedRecords.length) }} 筆 · 固定顯示於一般資料上方</span>
          </div>
          <ol class="divide-y divide-line/70">
            <li v-for="(employee, index) in pinnedRecords" :key="employee.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div class="flex min-w-0 items-center gap-3">
                <span class="w-6 shrink-0 text-xs font-semibold tabular-nums text-accent">{{ String(index + 1).padStart(2, '0') }}</span>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">{{ employee.name }}</p>
                  <p class="truncate text-xs text-muted">{{ employee.position }} · {{ employee.location }}</p>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button class="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-surface disabled:opacity-40" :disabled="index === 0 || isLoading" :aria-label="`將 ${employee.name} 上移`" @click="movePinned(employee, 'up')">上移</button>
                <button class="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-surface disabled:opacity-40" :disabled="index === pinnedRecords.length - 1 || isLoading" :aria-label="`將 ${employee.name} 下移`" @click="movePinned(employee, 'down')">下移</button>
                <button class="rounded px-2 py-1 text-xs font-medium text-muted hover:bg-surface" :aria-label="`取消置頂 ${employee.name}`" @click="togglePinned(employee)">取消置頂</button>
              </div>
            </li>
          </ol>
        </section>

        <p v-if="errorMessage" role="alert" class="mb-3 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {{ errorMessage }}
          <button class="font-semibold underline underline-offset-2" @click="loadPage()">重新載入</button>
        </p>

        <div class="mt-4 overflow-hidden rounded-md border border-line bg-surface">
          <div class="overflow-x-auto">
            <table class="people-table w-full border-collapse text-left text-sm">
              <caption class="sr-only">人員資料，包含姓名、職位、地點、年齡與到職日</caption>
              <thead class="bg-[#f7f9f7] text-xs font-semibold text-muted">
                <tr>
                  <th scope="col" class="px-5 py-3.5">姓名</th>
                  <th scope="col" class="px-5 py-3.5">職位</th>
                  <th scope="col" class="px-5 py-3.5">地點</th>
                  <th scope="col" class="px-5 py-3.5">年齡</th>
                  <th scope="col" class="px-5 py-3.5">到職日</th>
                  <th scope="col" class="px-5 py-3.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line">
                <tr v-for="record in records" :key="record.id" class="transition-colors hover:bg-[#f8fbf9]">
                  <td data-label="姓名" class="whitespace-nowrap px-5 py-4 font-medium">{{ record.name }}</td>
                  <td data-label="職位" class="whitespace-nowrap px-5 py-4 text-muted">{{ record.position }}</td>
                  <td data-label="地點" class="whitespace-nowrap px-5 py-4 text-muted">{{ record.location }}</td>
                  <td data-label="年齡" class="whitespace-nowrap px-5 py-4 tabular-nums text-muted">{{ record.age }}</td>
                  <td data-label="到職日" class="whitespace-nowrap px-5 py-4 font-mono text-xs text-muted">{{ record.dateStart }}</td>
                  <td data-label="操作" class="px-5 py-3 text-right">
                    <div class="flex flex-wrap justify-end gap-x-3 gap-y-2">
                      <button class="text-xs font-medium text-accent underline-offset-2 hover:underline" @click="openDialog('edit', record)">編輯</button>
                      <button class="text-xs font-medium text-accent underline-offset-2 hover:underline" @click="togglePinned(record)">{{ pinnedRecords.some((item) => item.id === record.id) ? '取消置頂' : '置頂' }}</button>
                      <button class="text-xs font-medium text-red-700 underline-offset-2 hover:underline" @click="openDialog('delete', record)">刪除</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="isLoading && records.length === 0">
                  <td colspan="6" class="px-5 py-12 text-center text-sm text-muted" role="status">正在載入資料…</td>
                </tr>
                <tr v-else-if="records.length === 0 && !errorMessage">
                  <td colspan="6" class="px-5 py-12 text-center text-sm text-muted">目前沒有資料</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="flex flex-col gap-3 px-1 py-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite">第 {{ formatCount(pageNumber) }} / {{ formatCount(pageCount) }} 頁 · 顯示 {{ formatCount(rangeStart) }}–{{ formatCount(rangeEnd) }} 筆，共 {{ formatCount(totalRecords) }} 筆</p>
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
      :saving="isSaving"
      :error="dialogError"
      @close="closeDialog"
      @create="createEmployee"
      @update="updateEmployee"
      @remove="deleteEmployee"
    />
  </div>
</template>
