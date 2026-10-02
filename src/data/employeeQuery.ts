import type { Employee } from '../types/employee'
import type { EmployeeQuery, EmployeeSearchField, EmployeeSortField, SortDirection } from './employeeRepository'

export const EMPLOYEE_QUERY_CACHE_TTL_MS = 30_000

export interface EmployeeQueryCacheLease {
  key: string
  expiresAt: number
}

export function canReuseEmployeeQueryCache(
  cache: EmployeeQueryCacheLease | undefined,
  key: string,
  now: number,
): boolean {
  return cache !== undefined && cache.key === key && now < cache.expiresAt
}

const searchableFields: Array<keyof Omit<Employee, 'id'>> = [
  'dataNumber',
  'name',
  'position',
  'location',
  'age',
  'dateStart',
]

export function createEmployeeSearchMatcher(
  search: string,
  field: EmployeeSearchField | null = null,
): (employee: Employee) => boolean {
  // 每次查詢只正規化一次搜尋詞，避免千萬筆掃描中重複執行 locale 轉換；欄位文字仍需逐筆比較。
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) return () => true

  if (field === 'age') {
    // 指定年齡時做整數完全比對：搜「30」不該找到 23 或 35 歲；不是整數就沒有符合的資料。
    const age = /^\d+$/.test(normalizedSearch) ? Number(normalizedSearch) : Number.NaN
    return (employee) => employee.age === age
  }

  const fields = field ? [field] : searchableFields
  return (employee) => fields.some((name) =>
    String(employee[name]).toLowerCase().includes(normalizedSearch),
  )
}

export function matchesEmployeeSearch(employee: Employee, search: string, field: EmployeeSearchField | null = null): boolean {
  return createEmployeeSearchMatcher(search, field)(employee)
}

// Worker 快取鍵：資料版本與所有查詢條件都要一致才能重用排序結果。
export function employeeQueryCacheKey(recordCount: number, revision: number, query: EmployeeQuery): string {
  return JSON.stringify([
    recordCount,
    revision,
    query.search?.trim().toLocaleLowerCase('en-US') ?? '',
    query.searchField ?? null,
    query.sortBy ?? null,
    query.sortDirection ?? 'asc',
  ])
}

// 共用 Collator：localeCompare 帶 options 時每次呼叫都會重建比對器，大量比較時成本很高。
export const employeeCollator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' })
const idCollator = new Intl.Collator('en-US', { numeric: true })

export function compareEmployees(
  left: Employee,
  right: Employee,
  sortBy: EmployeeSortField,
  direction: SortDirection,
): number {
  const directionFactor = direction === 'asc' ? 1 : -1
  const fieldComparison = sortBy === 'age'
    ? left.age - right.age
    : employeeCollator.compare(String(left[sortBy]), String(right[sortBy]))

  if (fieldComparison !== 0) return fieldComparison * directionFactor
  return idCollator.compare(left.id, right.id)
}