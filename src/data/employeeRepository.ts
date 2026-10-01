import type { Employee } from '../types/employee'

export const PAGE_SIZE = 500
export const DEFAULT_DATASET_SIZE = 10_000_000

export const DATASET_SIZE_OPTIONS = [
  { label: '1,000', value: 1_000 },
  { label: '100,000', value: 100_000 },
  { label: '1,000,000', value: 1_000_000 },
  { label: '10,000,000', value: 10_000_000 },
] as const

export type EmployeeSortField = 'dataNumber' | 'name' | 'position' | 'location' | 'age' | 'dateStart'
export type SortDirection = 'asc' | 'desc'

export interface EmployeeQuery {
  search?: string
  sortBy?: EmployeeSortField | null
  sortDirection?: SortDirection
}

export interface EmployeePageRequest extends EmployeeQuery {
  offset: number
  limit: number
}

export interface EmployeePage {
  records: Employee[]
  manualPositions: Array<{ id: string; position: number }>
  total: number
  pageTotal: number
  offset: number
  limit: number
}

export type EmployeeDraft = Omit<Employee, 'id'>

export interface EmployeeRepository {
  getPage(request: EmployeePageRequest): Promise<EmployeePage>
  create(employee: EmployeeDraft): Promise<Employee>
  update(id: string, employee: EmployeeDraft): Promise<Employee>
  // 手動位置使用 UI 顯示的 1 起始列號。
  delete(id: string, currentPosition: number, query?: EmployeeQuery): Promise<void>
  moveToPosition(id: string, currentPosition: number, targetPosition: number, query?: EmployeeQuery): Promise<void>
}