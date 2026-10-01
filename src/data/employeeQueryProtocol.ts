import type { Employee } from '../types/employee'
import type { EmployeePage, EmployeeQuery } from './employeeRepository'

export interface EmployeeQueryWorkerRequest {
  type: 'query'
  requestId: number
  recordCount: number
  total: number
  offset: number
  limit: number
  revision: number
  query: EmployeeQuery
  created: Employee[]
  updated: Employee[]
  deletedIds: string[]
  manualPositions: Array<{ id: string; position: number }>
}

export interface ClearEmployeeQueryWorkerRequest {
  type: 'clear'
}

export type EmployeeQueryWorkerMessage = EmployeeQueryWorkerRequest | ClearEmployeeQueryWorkerRequest

export interface EmployeeQueryWorkerResponse {
  requestId: number
  result?: EmployeePage
  error?: string
}