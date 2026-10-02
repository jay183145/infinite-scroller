import type { Employee } from '../types/employee'
import { PAGE_SIZE, type EmployeePage } from './employeeRepository'
import {
  canReuseEmployeeQueryCache,
  compareEmployees,
  createEmployeeSearchMatcher,
  EMPLOYEE_QUERY_CACHE_TTL_MS,
} from './employeeQuery'
import type {
  EmployeeQueryWorkerMessage,
  EmployeeQueryWorkerRequest,
  EmployeeQueryWorkerResponse,
} from './employeeQueryProtocol'
import { createEmployee } from './employeeData'
import { createEmployeeSorter, MAX_FAST_SORT_CANDIDATES } from './employeeSort'

interface MatchedPin {
  id: string
  position: number
  token: number
}

interface QueryCache {
  key: string
  expiresAt: number
  sortedTokens: Uint32Array
  matchingCount: number
  matchingPins: MatchedPin[]
  request: EmployeeQueryWorkerRequest
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<EmployeeQueryWorkerMessage>) => void) | null
  postMessage(message: EmployeeQueryWorkerResponse): void
}

let cache: QueryCache | undefined

function employeeIdForBaseIndex(index: number): string {
  return `EMP-${String(index + 1).padStart(8, '0')}`
}

function getEmployeeForToken(
  token: number,
  request: EmployeeQueryWorkerRequest,
  updatedById: ReadonlyMap<string, Employee>,
): Employee | undefined {
  if (token < request.recordCount) {
    const id = employeeIdForBaseIndex(token)
    return updatedById.get(id) ?? createEmployee(token)
  }

  return request.created[token - request.recordCount]
}

function getTokenForId(id: string, request: EmployeeQueryWorkerRequest): number | undefined {
  const baseMatch = /^EMP-(\d{8})$/.exec(id)
  if (baseMatch?.[1]) {
    const index = Number(baseMatch[1]) - 1
    return index >= 0 && index < request.recordCount ? index : undefined
  }

  const createdIndex = request.created.findIndex((employee) => employee.id === id)
  return createdIndex >= 0 ? request.recordCount + createdIndex : undefined
}

function buildQueryCache(request: EmployeeQueryWorkerRequest): QueryCache {
  const updatedById = new Map(request.updated.map((employee) => [employee.id, employee]))
  const deletedIds = new Set(request.deletedIds)
  const pinPositionById = new Map(request.manualPositions.map(({ id, position }) => [id, position]))
  const candidateTokens = new Uint32Array(request.recordCount + request.created.length)
  const matchingPins: MatchedPin[] = []
  const matchesSearch = createEmployeeSearchMatcher(request.query.search ?? '')
  const { sortBy, sortDirection = 'asc' } = request.query
  // 排序鍵在同一次全量掃描中順便算好，不再於每次比較時重建資料；超出快速排序上限時退回比較器排序。
  const sorter = sortBy && candidateTokens.length <= MAX_FAST_SORT_CANDIDATES
    ? createEmployeeSorter(sortBy, sortDirection, candidateTokens.length)
    : undefined
  let matchingCount = 0

  const visit = (employee: Employee, token: number): void => {
    if (!matchesSearch(employee)) return

    candidateTokens[matchingCount] = token
    matchingCount += 1
    sorter?.add(employee, token)
    const position = pinPositionById.get(employee.id)
    if (position !== undefined) matchingPins.push({ id: employee.id, position, token })
  }

  for (let index = 0; index < request.recordCount; index += 1) {
    const id = employeeIdForBaseIndex(index)
    if (deletedIds.has(id)) continue
    visit(updatedById.get(id) ?? createEmployee(index), index)
  }

  request.created.forEach((employee, index) => {
    visit(employee, request.recordCount + index)
  })

  const sortedTokens = candidateTokens.subarray(0, matchingCount)
  const getEmployee = (token: number) => getEmployeeForToken(token, request, updatedById)
  if (sorter) {
    sorter.sort(sortedTokens, getEmployee)
  } else if (sortBy) {
    sortedTokens.sort((leftToken, rightToken) => {
      const left = getEmployee(leftToken)
      const right = getEmployee(rightToken)
      if (!left || !right) return leftToken - rightToken
      return compareEmployees(left, right, sortBy, sortDirection)
    })
  }

  // 快取只保留一份 Uint32 索引，不在主執行緒建立完整 Employee 陣列；10M 筆約占 40MB。
  // 排序時另需一份 Float64 排序鍵（10M 筆約 80MB），排完即可回收。
  const key = JSON.stringify([
    request.recordCount,
    request.revision,
    request.query.search?.trim().toLocaleLowerCase('en-US') ?? '',
    request.query.sortBy ?? null,
    request.query.sortDirection ?? 'asc',
  ])

  return {
    key,
    expiresAt: Date.now() + EMPLOYEE_QUERY_CACHE_TTL_MS,
    sortedTokens,
    matchingCount,
    matchingPins,
    request,
  }
}

function makePage(queryCache: QueryCache, request: EmployeeQueryWorkerRequest): EmployeePage {
  const { sortedTokens, matchingCount } = queryCache
  const visiblePins = queryCache.matchingPins
    .filter(({ position }) => position < matchingCount)
    .sort((left, right) => left.position - right.position)
  const pinByPosition = new Map(visiblePins.map(({ position, token }) => [position, token]))
  const pinnedTokens = new Set(visiblePins.map(({ token }) => token))
  const offset = Math.min(matchingCount, Math.max(0, Math.floor(request.offset)))
  const limit = Math.min(PAGE_SIZE, Math.max(0, Math.floor(request.limit)))
  const pageLength = Math.min(limit, Math.max(0, matchingCount - offset))
  const records: Employee[] = []
  const updatedById = new Map(request.updated.map((employee) => [employee.id, employee]))
  let sortedIndex = 0

  // PIN 位置在搜尋/排序完成後套用；其他排序結果依序填入空位，已 PIN 資料不再出現在其原排序位置。
  for (let position = 0; position < offset + pageLength; position += 1) {
    const pinnedToken = pinByPosition.get(position)
    if (pinnedToken !== undefined) {
      if (position >= offset) {
        const employee = getEmployeeForToken(pinnedToken, request, updatedById)
        if (employee) records.push(employee)
      }
      continue
    }

    while (sortedIndex < matchingCount && pinnedTokens.has(sortedTokens[sortedIndex]!)) {
      sortedIndex += 1
    }

    const token = sortedTokens[sortedIndex]
    if (token === undefined) break
    sortedIndex += 1

    if (position >= offset) {
      const employee = getEmployeeForToken(token, request, updatedById)
      if (employee) records.push(employee)
    }
  }

  return {
    records,
    manualPositions: visiblePins.map(({ id, position }) => ({ id, position })),
    total: request.total,
    pageTotal: matchingCount,
    offset,
    limit,
  }
}

workerScope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'clear') {
    cache = undefined
    return
  }

  try {
    const key = JSON.stringify([
      message.recordCount,
      message.revision,
      message.query.search?.trim().toLocaleLowerCase('en-US') ?? '',
      message.query.sortBy ?? null,
      message.query.sortDirection ?? 'asc',
    ])
    // 容量維持單筆以限制 Worker 的索引記憶體，快取固定 30 秒且資料 revision/查詢條件必須一致；到期後會重新全量掃描。
    if (!canReuseEmployeeQueryCache(cache, key, Date.now())) cache = buildQueryCache(message)
    const activeCache = cache
    if (!activeCache) throw new Error('無法建立查詢快取。')

    workerScope.postMessage({
      requestId: message.requestId,
      result: makePage(activeCache, message),
    })
  } catch (error) {
    workerScope.postMessage({
      requestId: message.requestId,
      error: error instanceof Error ? error.message : '查詢失敗。',
    })
  }
}