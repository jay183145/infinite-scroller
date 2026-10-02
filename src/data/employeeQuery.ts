import type { Employee } from '../types/employee'
import type { EmployeeSortField, SortDirection } from './employeeRepository'

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

export function createEmployeeSearchMatcher(search: string): (employee: Employee) => boolean {
  // 每次查詢只正規化一次搜尋詞，避免千萬筆掃描中重複執行 locale 轉換；欄位文字仍需逐筆比較。
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) return () => true

  return (employee) => searchableFields.some((field) =>
    String(employee[field]).toLowerCase().includes(normalizedSearch),
  )
}

export function matchesEmployeeSearch(employee: Employee, search: string): boolean {
  return createEmployeeSearchMatcher(search)(employee)
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