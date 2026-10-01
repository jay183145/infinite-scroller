import type { Employee } from '../types/employee'
import {
  DEFAULT_DATASET_SIZE,
  PAGE_SIZE,
  type EmployeeDraft,
  type EmployeePage,
  type EmployeePageRequest,
  type EmployeeRepository,
} from './employeeRepository'

const firstNames = [
  'Alex', 'Jin', 'Maya', 'Noah', 'Yuki', 'Lucas', 'Amara', 'Theo',
  'Sofia', 'Ethan', 'Nina', 'Omar', 'Iris', 'Mateo', 'Ava', 'Kai',
]

const lastNames = [
  'Morgan', 'Park', 'Chen', 'Williams', 'Sato', 'Ferreira', 'Okafor', 'Martin',
  'Rossi', 'Patel', 'Kim', 'Garcia', 'Liu', 'Singh', 'Brown', 'Tanaka',
]

const positions = [
  'Product Designer', 'Data Analyst', 'Operations Lead', 'People Partner',
  'UX Researcher', 'Platform Engineer', 'Program Manager', 'Finance Associate',
  'Software Engineer', 'Customer Success Manager', 'Recruiter', 'Marketing Specialist',
]

const locations = [
  'Taipei', 'Seoul', 'Singapore', 'London', 'Tokyo', 'Lisbon',
  'Nairobi', 'Paris', 'Toronto', 'Sydney', 'Berlin', 'Manila',
]

function hashIndex(index: number, salt: number): number {
  let value = Math.imul(index + salt + 1, 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return (value ^ (value >>> 16)) >>> 0
}

function pickValue<T>(values: readonly T[], seed: number): T {
  const value = values[seed % values.length]
  if (value === undefined) throw new Error('假資料樣本清單不可為空。')
  return value
}

function createEmployee(index: number): Employee {
  const nameSeed = hashIndex(index, 11)
  const positionSeed = hashIndex(index, 23)
  const locationSeed = hashIndex(index, 37)
  const dateSeed = hashIndex(index, 53)
  const startDate = new Date(Date.UTC(2015, 0, 1) + (dateSeed % 4_018) * 86_400_000)

  return {
    id: `EMP-${String(index + 1).padStart(8, '0')}`,
    name: `${pickValue(firstNames, nameSeed)} ${pickValue(lastNames, nameSeed >>> 8)}`,
    position: pickValue(positions, positionSeed),
    location: pickValue(locations, locationSeed),
    age: 20 + (hashIndex(index, 71) % 46),
    dateStart: startDate.toISOString().slice(0, 10),
  }
}

function getBaseIndex(id: string): number | undefined {
  const match = /^EMP-(\d{8})$/.exec(id)
  if (!match?.[1]) return undefined

  const index = Number(match[1]) - 1
  return index >= 0 ? index : undefined
}

function countBefore(sortedValues: readonly number[], exclusiveEnd: number): number {
  let start = 0
  let end = sortedValues.length

  while (start < end) {
    const middle = Math.floor((start + end) / 2)
    const value = sortedValues[middle]
    if (value !== undefined && value < exclusiveEnd) start = middle + 1
    else end = middle
  }

  return start
}

function findBaseIndexByRank(rank: number, excluded: readonly number[], total: number): number {
  let start = rank
  let end = Math.min(total - 1, rank + excluded.length)

  while (start < end) {
    const middle = Math.floor((start + end) / 2)
    const includedThroughMiddle = middle + 1 - countBefore(excluded, middle + 1)

    if (includedThroughMiddle > rank) end = middle
    else start = middle + 1
  }

  return start
}

export function createMockEmployeeRepository(
  total = DEFAULT_DATASET_SIZE,
): EmployeeRepository {
  const recordCount = Math.max(0, Math.floor(total))
  const created = new Map<string, Employee>()
  const updated = new Map<string, Employee>()
  const deleted = new Set<string>()
  const pinnedIds: string[] = []
  let nextCreatedId = 1

  function getEmployee(id: string): Employee | undefined {
    if (deleted.has(id)) return undefined
    return created.get(id) ?? updated.get(id) ?? (() => {
      const index = getBaseIndex(id)
      return index !== undefined && index < recordCount ? createEmployee(index) : undefined
    })()
  }

  function getPinnedIds(): string[] {
    return pinnedIds.filter((id) => getEmployee(id) !== undefined)
  }

  function getExcludedBaseIndexes(): number[] {
    return [...new Set([
      ...[...deleted, ...getPinnedIds()]
        .map(getBaseIndex)
        .filter((index): index is number => index !== undefined && index < recordCount),
    ])].sort((left, right) => left - right)
  }

  return {
    async getPage(request: EmployeePageRequest): Promise<EmployeePage> {
      const pinned = getPinnedIds()
      const pinnedSet = new Set(pinned)
      const newRecords = [...created.values()].filter((employee) => !pinnedSet.has(employee.id))
      const excludedBase = getExcludedBaseIndexes()
      const pageTotal = newRecords.length + recordCount - excludedBase.length
      const offset = Math.min(pageTotal, Math.max(0, Math.floor(request.offset)))
      const limit = Math.min(PAGE_SIZE, Math.max(0, Math.floor(request.limit)))
      const pageLength = Math.min(limit, Math.max(0, pageTotal - offset))
      const createdStart = Math.min(offset, newRecords.length)
      const createdEnd = Math.min(offset + pageLength, newRecords.length)
      const pageRecords = newRecords.slice(createdStart, createdEnd)
      const baseOffset = Math.max(0, offset - newRecords.length)
      const baseLength = pageLength - pageRecords.length

      // 二分定位指定頁的基礎資料，避免深頁查詢從第一筆逐列掃描；查詢成本仍會隨變更 ID 數增加。
      for (let pageIndex = 0; pageIndex < baseLength; pageIndex += 1) {
        const rank = baseOffset + pageIndex
        const baseIndex = findBaseIndexByRank(rank, excludedBase, recordCount)
        pageRecords.push(updated.get(`EMP-${String(baseIndex + 1).padStart(8, '0')}`) ?? createEmployee(baseIndex))
      }

      // 每次只生成目前要求的最多 500 筆，不保存千萬筆陣列；全域搜尋/排序仍應交由有索引的正式 API。
      const pinnedRecords = pinned.flatMap((id) => {
        const employee = getEmployee(id)
        return employee ? [employee] : []
      })

      return {
        records: pageRecords,
        pinnedRecords,
        total: recordCount - deleted.size + created.size,
        pageTotal,
        offset,
        limit,
      }
    },

    async create(employee: EmployeeDraft): Promise<Employee> {
      const id = `NEW-${String(nextCreatedId).padStart(8, '0')}`
      nextCreatedId += 1
      const record = { ...employee, id }
      created.set(id, record)
      return record
    },

    async update(id: string, employee: EmployeeDraft): Promise<Employee> {
      if (!getEmployee(id)) throw new Error('找不到要更新的人員資料。')

      const record = { ...employee, id }
      if (created.has(id)) created.set(id, record)
      else updated.set(id, record)
      return record
    },

    async delete(id: string): Promise<void> {
      if (!getEmployee(id)) throw new Error('找不到要刪除的人員資料。')

      if (created.has(id)) created.delete(id)
      else deleted.add(id)

      const pinnedIndex = pinnedIds.indexOf(id)
      if (pinnedIndex >= 0) pinnedIds.splice(pinnedIndex, 1)
    },

    async setPinned(id: string, pinned: boolean): Promise<void> {
      if (!getEmployee(id)) throw new Error('找不到要置頂的人員資料。')

      const pinnedIndex = pinnedIds.indexOf(id)
      if (pinned && pinnedIndex < 0) pinnedIds.push(id)
      else if (!pinned && pinnedIndex >= 0) pinnedIds.splice(pinnedIndex, 1)
    },

    async movePinned(id: string, direction: 'up' | 'down'): Promise<void> {
      const currentIndex = pinnedIds.indexOf(id)
      if (currentIndex < 0) throw new Error('找不到置頂的人員資料。')

      const nextIndex = currentIndex + (direction === 'up' ? -1 : 1)
      if (nextIndex < 0 || nextIndex >= pinnedIds.length) return

      const [recordId] = pinnedIds.splice(currentIndex, 1)
      if (recordId) pinnedIds.splice(nextIndex, 0, recordId)
    },
  }
}