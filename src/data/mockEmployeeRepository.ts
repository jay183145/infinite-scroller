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
  const manualPositions = new Map<string, number>()
  let nextCreatedId = 1

  function getEmployee(id: string): Employee | undefined {
    if (deleted.has(id)) return undefined
    return created.get(id) ?? updated.get(id) ?? (() => {
      const index = getBaseIndex(id)
      return index !== undefined && index < recordCount ? createEmployee(index) : undefined
    })()
  }

  function getExcludedBaseIndexes(): number[] {
    return [...new Set([
      ...[...deleted, ...manualPositions.keys()]
        .map(getBaseIndex)
        .filter((index): index is number => index !== undefined && index < recordCount),
    ])].sort((left, right) => left - right)
  }

  return {
    async getPage(request: EmployeePageRequest): Promise<EmployeePage> {
      const total = recordCount - deleted.size + created.size
      const manualEntries = [...manualPositions]
        .filter(([id, position]) => getEmployee(id) !== undefined && position < total)
        .map(([id, position]) => ({ id, position }))
        .sort((left, right) => left.position - right.position)
      const manualIds = new Set(manualEntries.map(({ id }) => id))
      const manualByPosition = new Map(manualEntries.map(({ position, id }) => [position, id]))
      const newRecords = [...created.values()].filter((employee) => !manualIds.has(employee.id))
      const excludedBase = getExcludedBaseIndexes()
      const pageTotal = total
      const offset = Math.min(total, Math.max(0, Math.floor(request.offset)))
      const limit = Math.min(PAGE_SIZE, Math.max(0, Math.floor(request.limit)))
      const pageLength = Math.min(limit, Math.max(0, total - offset))
      const pageRecords: Employee[] = []
      let manualPointer = 0
      let manualBefore = 0

      // 只記錄被手動移動的列，讀取時覆寫目前頁面的位置，不為千萬筆資料建立重排陣列；成本會隨手動調整筆數增加。
      for (let position = offset; position < offset + pageLength; position += 1) {
        while (manualPointer < manualEntries.length) {
          const entry = manualEntries[manualPointer]
          if (!entry || entry.position >= position) break
          manualBefore += 1
          manualPointer += 1
        }

        const manualId = manualByPosition.get(position)
        if (manualId) {
          const employee = getEmployee(manualId)
          if (employee) pageRecords.push(employee)
          continue
        }

        const unplacedRank = position - manualBefore
        const createdRecord = newRecords[unplacedRank]
        if (createdRecord) {
          pageRecords.push(createdRecord)
          continue
        }

        const baseRank = unplacedRank - newRecords.length
        const baseIndex = findBaseIndexByRank(baseRank, excludedBase, recordCount)
        const id = `EMP-${String(baseIndex + 1).padStart(8, '0')}`
        const employee = updated.get(id) ?? createEmployee(baseIndex)
        pageRecords.push(employee)
      }

      return {
        records: pageRecords,
        manualPositions: manualEntries,
        total,
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

    async delete(id: string, currentPosition: number): Promise<void> {
      if (!getEmployee(id)) throw new Error('找不到要刪除的人員資料。')

      const currentIndex = Math.max(0, Math.floor(currentPosition) - 1)
      const page = await this.getPage({ offset: currentIndex, limit: 1 })
      if (page.records[0]?.id !== id) throw new Error('資料位置已變更，請重新確認後再刪除。')

      const totalAfterDelete = recordCount - deleted.size + created.size - 1
      const outOfRangePin = [...manualPositions].find(
        ([manualId, position]) => manualId !== id && position >= totalAfterDelete,
      )
      if (outOfRangePin) {
        throw new Error(`刪除後會讓第 ${outOfRangePin[1] + 1} 筆 PIN 超出資料範圍，請先調整 PIN 位置。`)
      }

      if (created.has(id)) created.delete(id)
      else deleted.add(id)

      updated.delete(id)
      manualPositions.delete(id)
    },

    async moveToPosition(id: string, currentPosition: number, targetPosition: number): Promise<void> {
      const currentIndex = Math.max(0, Math.floor(currentPosition) - 1)
      const page = await this.getPage({ offset: currentIndex, limit: 1 })
      if (page.records[0]?.id !== id) throw new Error('資料位置已變更，請重新確認後再調整。')

      const boundedTarget = Math.min(page.total - 1, Math.max(0, Math.floor(targetPosition) - 1))

      const occupiedPosition = [...manualPositions].find(
        ([manualId, position]) => manualId !== id && position === boundedTarget,
      )
      if (occupiedPosition) {
        throw new Error(`第 ${boundedTarget + 1} 筆已被其他資料 PIN，請選擇不同位置。`)
      }

      // PIN 列號是固定位置，只更新本筆的 reservation；其他 PIN 位置不隨一般資料搬動或刪除而位移。
      manualPositions.set(id, boundedTarget)
    },
  }
}