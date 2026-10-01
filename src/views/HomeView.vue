<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { createMockEmployeeRepository } from '../data/mockEmployeeRepository'
import {
  DATASET_SIZE_OPTIONS,
  DEFAULT_DATASET_SIZE,
  PAGE_SIZE,
} from '../data/employeeRepository'
import type { Employee } from '../types/employee'

const datasetSize = ref<number>(DEFAULT_DATASET_SIZE)
const records = ref<Employee[]>([])
const totalRecords = ref(0)
const currentOffset = ref(0)
const isLoading = ref(false)
const errorMessage = ref('')

const pageNumber = computed(() => Math.floor(currentOffset.value / PAGE_SIZE) + 1)
const pageCount = computed(() => Math.ceil(totalRecords.value / PAGE_SIZE))
const rangeStart = computed(() => (records.value.length > 0 ? currentOffset.value + 1 : 0))
const rangeEnd = computed(() => currentOffset.value + records.value.length)
const hasPreviousPage = computed(() => currentOffset.value > 0)
const hasNextPage = computed(() => rangeEnd.value < totalRecords.value)

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

async function loadPage(offset = currentOffset.value): Promise<void> {
  if (isLoading.value) return

  isLoading.value = true
  errorMessage.value = ''

  try {
    const repository = createMockEmployeeRepository(datasetSize.value)
    const page = await repository.getPage({ offset, limit: PAGE_SIZE })

    records.value = page.records
    totalRecords.value = page.total
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
        <p class="pb-1 text-sm text-muted">固定種子 · 可重現資料</p>
      </section>

      <section aria-label="資料摘要" class="mt-7 grid grid-cols-3 border-y border-line">
        <div class="py-4 pr-3 sm:py-5">
          <p class="text-xs text-muted sm:text-sm">總資料量</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums sm:text-[1.75rem]">{{ formatCount(totalRecords) }}</p>
        </div>
        <div class="border-l border-line px-3 py-4 sm:px-6 sm:py-5">
          <p class="text-xs text-muted sm:text-sm">符合條件</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums sm:text-[1.75rem]">{{ formatCount(totalRecords) }}</p>
        </div>
        <div class="border-l border-line pl-3 py-4 sm:pl-6 sm:py-5">
          <p class="text-xs text-muted sm:text-sm">目前載入</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums sm:text-[1.75rem]">{{ formatCount(records.length) }}</p>
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
                </tr>
              </thead>
              <tbody class="divide-y divide-line">
                <tr v-for="record in records" :key="record.id" class="transition-colors hover:bg-[#f8fbf9]">
                  <td data-label="姓名" class="whitespace-nowrap px-5 py-4 font-medium">{{ record.name }}</td>
                  <td data-label="職位" class="whitespace-nowrap px-5 py-4 text-muted">{{ record.position }}</td>
                  <td data-label="地點" class="whitespace-nowrap px-5 py-4 text-muted">{{ record.location }}</td>
                  <td data-label="年齡" class="whitespace-nowrap px-5 py-4 tabular-nums text-muted">{{ record.age }}</td>
                  <td data-label="到職日" class="whitespace-nowrap px-5 py-4 font-mono text-xs text-muted">{{ record.dateStart }}</td>
                </tr>
                <tr v-if="isLoading && records.length === 0">
                  <td colspan="5" class="px-5 py-12 text-center text-sm text-muted" role="status">正在載入資料…</td>
                </tr>
                <tr v-else-if="records.length === 0 && !errorMessage">
                  <td colspan="5" class="px-5 py-12 text-center text-sm text-muted">目前沒有資料</td>
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
  </div>
</template>
