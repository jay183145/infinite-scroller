import type { Employee } from '../types/employee'

export const PAGE_SIZE = 500
export const DEFAULT_DATASET_SIZE = 10_000_000

export const DATASET_SIZE_OPTIONS = [
  { label: '1,000', value: 1_000 },
  { label: '100,000', value: 100_000 },
  { label: '1,000,000', value: 1_000_000 },
  { label: '10,000,000', value: 10_000_000 },
] as const

export interface EmployeePageRequest {
  offset: number
  limit: number
}

export interface EmployeePage {
  records: Employee[]
  pinnedRecords: Employee[]
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
  delete(id: string): Promise<void>
  setPinned(id: string, pinned: boolean): Promise<void>
  movePinned(id: string, direction: 'up' | 'down'): Promise<void>
}