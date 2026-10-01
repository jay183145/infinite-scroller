import type { Employee } from '../types/employee'
import type { EmployeeSortField, SortDirection } from './employeeRepository'

const searchableFields: Array<keyof Omit<Employee, 'id'>> = [
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

export function compareEmployees(
  left: Employee,
  right: Employee,
  sortBy: EmployeeSortField,
  direction: SortDirection,
): number {
  const directionFactor = direction === 'asc' ? 1 : -1
  const fieldComparison = sortBy === 'age'
    ? left.age - right.age
    : String(left[sortBy]).localeCompare(String(right[sortBy]), 'en-US', {
        numeric: true,
        sensitivity: 'base',
      })

  if (fieldComparison !== 0) return fieldComparison * directionFactor
  return left.id.localeCompare(right.id, 'en-US', { numeric: true })
}