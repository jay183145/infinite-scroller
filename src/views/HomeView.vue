<script setup lang="ts">
const sampleRecords = [
  { id: 'USR-1048', name: 'Alex Morgan', position: 'Product Designer', location: 'Taipei', age: 31, dateStart: '2022-04-18' },
  { id: 'USR-1052', name: 'Jin Park', position: 'Data Analyst', location: 'Seoul', age: 28, dateStart: '2021-11-02' },
  { id: 'USR-1061', name: 'Maya Chen', position: 'Operations Lead', location: 'Singapore', age: 36, dateStart: '2019-07-15' },
  { id: 'USR-1074', name: 'Noah Williams', position: 'People Partner', location: 'London', age: 33, dateStart: '2020-02-24' },
  { id: 'USR-1083', name: 'Yuki Sato', position: 'UX Researcher', location: 'Tokyo', age: 30, dateStart: '2023-01-09' },
  { id: 'USR-1090', name: 'Lucas Ferreira', position: 'Platform Engineer', location: 'Lisbon', age: 34, dateStart: '2018-09-03' },
  { id: 'USR-1102', name: 'Amara Okafor', position: 'Program Manager', location: 'Nairobi', age: 29, dateStart: '2022-06-20' },
  { id: 'USR-1117', name: 'Theo Martin', position: 'Finance Associate', location: 'Paris', age: 27, dateStart: '2024-03-11' },
]
</script>

<template>
  <div class="min-h-screen bg-canvas text-ink">
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex min-h-16 max-w-[1480px] items-center justify-between px-4 sm:px-6 lg:px-10">
        <div class="flex items-center gap-3">
          <span class="grid size-8 place-items-center rounded-md bg-accent text-sm font-semibold text-white">P</span>
          <span class="text-sm font-semibold tracking-[0.08em]">PEOPLE DIRECTORY</span>
        </div>
        <span class="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted">介面樣本</span>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1480px] px-4 pb-12 pt-8 sm:px-6 sm:pt-10 lg:px-10">
      <section aria-labelledby="page-title" class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-accent">DIRECTORY / PEOPLE</p>
          <h1 id="page-title" class="mt-2 text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">人員資料</h1>
        </div>
        <p class="pb-1 text-sm text-muted">示範資料 · 8 筆</p>
      </section>

      <section aria-label="資料摘要" class="mt-7 grid grid-cols-3 border-y border-line">
        <div class="py-4 pr-3 sm:py-5">
          <p class="text-xs text-muted sm:text-sm">樣本總筆數</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums sm:text-[1.75rem]">08</p>
        </div>
        <div class="border-l border-line px-3 py-4 sm:px-6 sm:py-5">
          <p class="text-xs text-muted sm:text-sm">符合條件</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums sm:text-[1.75rem]">08</p>
        </div>
        <div class="border-l border-line pl-3 py-4 sm:pl-6 sm:py-5">
          <p class="text-xs text-muted sm:text-sm">已載入</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums sm:text-[1.75rem]">08</p>
        </div>
      </section>

      <section aria-labelledby="table-title" class="mt-8">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="table-title" class="text-base font-semibold">人員目錄</h2>
            <p class="mt-1 text-sm text-muted">欄位樣本，不代表完整資料集</p>
          </div>
          <span class="text-xs font-medium uppercase tracking-[0.08em] text-muted">8 records</span>
        </div>

        <div class="mt-4 overflow-hidden rounded-md border border-line bg-surface">
          <div class="overflow-x-auto">
            <table class="people-table w-full border-collapse text-left text-sm">
              <caption class="sr-only">人員資料樣本，包含姓名、職位、地點、年齡與到職日</caption>
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
                <tr v-for="record in sampleRecords" :key="record.id" class="transition-colors hover:bg-[#f8fbf9]">
                  <td data-label="姓名" class="whitespace-nowrap px-5 py-4 font-medium">{{ record.name }}</td>
                  <td data-label="職位" class="whitespace-nowrap px-5 py-4 text-muted">{{ record.position }}</td>
                  <td data-label="地點" class="whitespace-nowrap px-5 py-4 text-muted">{{ record.location }}</td>
                  <td data-label="年齡" class="whitespace-nowrap px-5 py-4 tabular-nums text-muted">{{ record.age }}</td>
                  <td data-label="到職日" class="whitespace-nowrap px-5 py-4 font-mono text-xs text-muted">{{ record.dateStart }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 px-1 py-3 text-xs text-muted">
          <span class="inline-flex items-center gap-2">
            <span aria-hidden="true" class="size-1.5 rounded-full bg-accent"></span>
            目前列出 8 筆介面樣本
          </span>
          <span>完整資料集將於後續階段接入</span>
        </div>
      </section>
    </main>
  </div>
</template>
