import type { Employee } from '../types/employee'
import { matchesEmployeeSearch } from './employeeQuery'
import type {
  EmployeeQueryWorkerMessage,
  EmployeeQueryWorkerRequest,
  EmployeeQueryWorkerResponse,
} from './employeeQueryProtocol'
import { createEmployee } from './employeeData'
import {
  DEFAULT_DATASET_SIZE,
  PAGE_SIZE,
  type EmployeeDraft,
  type EmployeePage,
  type EmployeePageRequest,
  type EmployeeQuery,
  type EmployeeRepository,
} from './employeeRepository'

let queryWorker: Worker | undefined
let nextQueryRequestId = 1
const pendingQueryRequests = new Map<number, {
  resolve: (page: EmployeePage) => void
  reject: (error: Error) => void
}>()

function getQueryWorker(): Worker {
  if (!queryWorker) {
    const worker = new Worker(new URL('./employeeQuery.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<EmployeeQueryWorkerResponse>) => {
      const pending = pendingQueryRequests.get(event.data.requestId)
      if (!pending) return

      pendingQueryRequests.delete(event.data.requestId)
      if (event.data.error) pending.reject(new Error(event.data.error))
      else if (event.data.result) pending.resolve(event.data.result)
      else pending.reject(new Error('查詢 Worker 未回傳結果。'))
    })
    worker.addEventListener('error', (event) => {
      const error = new Error(event.message || '查詢 Worker 發生錯誤。')
      for (const pending of pendingQueryRequests.values()) pending.reject(error)
      pendingQueryRequests.clear()
      worker.terminate()
      if (queryWorker === worker) queryWorker = undefined
    })
    queryWorker = worker
  }

  return queryWorker
}

function cancelPendingEmployeeQueries(): void {
  if (pendingQueryRequests.size === 0) return

  const workerToStop = queryWorker
  queryWorker = undefined
  workerToStop?.terminate()

  const cancellationError = new DOMException('查詢已由新條件取代。', 'AbortError')
  for (const pending of pendingQueryRequests.values()) pending.reject(cancellationError)
  pendingQueryRequests.clear()
}

function runEmployeeQuery(request: Omit<EmployeeQueryWorkerRequest, 'type' | 'requestId'>): Promise<EmployeePage> {
  // Worker 同步掃描時無法及時處理 cancel message；直接終止舊 Worker，確保過期全量掃描停止耗用 CPU。
  cancelPendingEmployeeQueries()
  const worker = getQueryWorker()
  const requestId = nextQueryRequestId
  nextQueryRequestId += 1

  return new Promise((resolve, reject) => {
    pendingQueryRequests.set(requestId, { resolve, reject })
    const message: EmployeeQueryWorkerMessage = { ...request, type: 'query', requestId }
    try {
      worker.postMessage(message)
    } catch (error) {
      pendingQueryRequests.delete(requestId)
      reject(error instanceof Error ? error : new Error('無法傳送查詢至 Worker。'))
    }
  })
}

function resetEmployeeQueryWorker(): void {
  if (pendingQueryRequests.size > 0) {
    cancelPendingEmployeeQueries()
    return
  }

  queryWorker?.postMessage({ type: 'clear' })
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
  let revision = 0

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
      if (request.search?.trim() || request.sortBy) {
        return runEmployeeQuery({
          recordCount,
          total,
          offset: request.offset,
          limit: request.limit,
          revision,
          query: {
            search: request.search,
            sortBy: request.sortBy,
            sortDirection: request.sortDirection,
          },
          created: [...created.values()],
          updated: [...updated.values()],
          deletedIds: [...deleted],
          manualPositions: [...manualPositions].map(([id, position]) => ({ id, position })),
        })
      }

      resetEmployeeQueryWorker()
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
      revision += 1
      return record
    },

    async update(id: string, employee: EmployeeDraft): Promise<Employee> {
      if (!getEmployee(id)) throw new Error('找不到要更新的人員資料。')

      const record = { ...employee, id }
      if (created.has(id)) created.set(id, record)
      else updated.set(id, record)
      revision += 1
      return record
    },

    async delete(id: string, currentPosition: number, query?: EmployeeQuery): Promise<void> {
      if (!getEmployee(id)) throw new Error('找不到要刪除的人員資料。')

      const currentIndex = Math.max(0, Math.floor(currentPosition) - 1)
      const page = await this.getPage({ offset: currentIndex, limit: 1, ...(query ?? {}) })
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
      revision += 1
    },

    async moveToPosition(
      id: string,
      currentPosition: number,
      targetPosition: number,
      query?: EmployeeQuery,
    ): Promise<void> {
      const currentIndex = Math.max(0, Math.floor(currentPosition) - 1)
      const page = await this.getPage({ offset: currentIndex, limit: 1, ...(query ?? {}) })
      if (page.records[0]?.id !== id) throw new Error('資料位置已變更，請重新確認後再調整。')

      const boundedTarget = Math.min(page.pageTotal - 1, Math.max(0, Math.floor(targetPosition) - 1))

      const occupiedPosition = [...manualPositions].find(
        ([manualId, position]) => manualId !== id && position === boundedTarget,
      )
      if (occupiedPosition) {
        throw new Error(`第 ${boundedTarget + 1} 筆已被其他資料 PIN，請選擇不同位置。`)
      }

      // PIN 列號是固定位置，只更新本筆的 reservation；其他 PIN 位置不隨一般資料搬動或刪除而位移。
      manualPositions.set(id, boundedTarget)
      revision += 1
    },
  }
}