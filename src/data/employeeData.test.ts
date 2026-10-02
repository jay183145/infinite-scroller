import { describe, expect, it } from 'vitest'
import { createEmployee } from './employeeData'

describe('createEmployee', () => {
  // 固定種子的假資料必須可重現：查表最佳化前後，同一個索引要產生完全相同的資料。
  it('keeps generating the same records for fixed indexes', () => {
    expect(createEmployee(0)).toEqual({ id: 'EMP-00000001', dataNumber: 'DATA-00000001', name: 'Iris Brown', position: 'UX Researcher', location: 'Lisbon', age: 56, dateStart: '2021-10-24' })
    expect(createEmployee(1)).toEqual({ id: 'EMP-00000002', dataNumber: 'DATA-00000002', name: 'Ava Rossi', position: 'Product Designer', location: 'Singapore', age: 37, dateStart: '2023-04-17' })
    expect(createEmployee(4_017)).toEqual({ id: 'EMP-00004018', dataNumber: 'DATA-00004018', name: 'Ethan Patel', position: 'Marketing Specialist', location: 'Nairobi', age: 47, dateStart: '2020-04-14' })
    expect(createEmployee(9_999_999)).toEqual({ id: 'EMP-10000000', dataNumber: 'DATA-10000000', name: 'Yuki Patel', position: 'Data Analyst', location: 'Taipei', age: 47, dateStart: '2015-04-02' })
  })
})
