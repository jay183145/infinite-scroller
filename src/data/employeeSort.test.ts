import { describe, expect, it } from 'vitest'
import type { Employee } from '../types/employee'
import { createEmployee } from './employeeData'
import { compareEmployees } from './employeeQuery'
import type { EmployeeSortField, SortDirection } from './employeeRepository'
import { createEmployeeSorter } from './employeeSort'

// 一般產生的資料，加上使用者可能輸入的非常規值：非 DATA-數字 的編號、前導零不同、只差大小寫的姓名。
function sampleEmployees(): Employee[] {
  const employees = Array.from({ length: 3_000 }, (_, index) => createEmployee(index))
  employees[10] = { ...employees[10]!, dataNumber: 'ABC-7' }
  employees[20] = { ...employees[20]!, dataNumber: 'zz-last' }
  employees[30] = { ...employees[30]!, dataNumber: 'DATA-5' }
  employees[40] = { ...employees[40]!, dataNumber: 'DATA-00000040x' }
  employees[50] = { ...employees[50]!, name: 'alex brown' }
  employees[60] = { ...employees[60]!, name: 'Zed 10' }
  employees[61] = { ...employees[61]!, name: 'Zed 9' }
  employees[70] = { ...employees[70]!, dateStart: '2030-01-05' }
  employees.push({ ...createEmployee(0), id: 'NEW-00000001', dataNumber: 'DATA-00000001', name: 'Alex Brown' })
  return employees
}

const fields: EmployeeSortField[] = ['dataNumber', 'name', 'position', 'location', 'age', 'dateStart']
const directions: SortDirection[] = ['asc', 'desc']

describe('createEmployeeSorter', () => {
  const employees = sampleEmployees()

  for (const sortBy of fields) {
    for (const direction of directions) {
      it(`matches compareEmployees when sorting by ${sortBy} ${direction}`, () => {
        // token 即陣列索引，依 token 升冪加入，與 Worker 掃描順序相同。
        const tokens = Uint32Array.from(employees, (_, token) => token)
        const sorter = createEmployeeSorter(sortBy, direction, tokens.length)
        employees.forEach((employee, token) => sorter.add(employee, token))
        sorter.sort(tokens, (token) => employees[token])

        const expected = employees
          .map((_, token) => token)
          .sort((left, right) => compareEmployees(employees[left]!, employees[right]!, sortBy, direction))
        expect([...tokens]).toEqual(expected)
      })
    }
  }
})
