import { describe, expect, it } from 'vitest'
import { DATASET_SIZE_OPTIONS, DEFAULT_DATASET_SIZE, PAGE_SIZE } from './employeeRepository'
import { createMockEmployeeRepository } from './mockEmployeeRepository'

describe('mock employee repository', () => {
  it('supports all requested dataset sizes without pre-generating their records', async () => {
    for (const { value } of DATASET_SIZE_OPTIONS) {
      const repository = createMockEmployeeRepository(value)
      const page = await repository.getPage({ offset: 0, limit: PAGE_SIZE })

      expect(page.total).toBe(value)
      expect(page.records).toHaveLength(PAGE_SIZE)
    }

    expect(DEFAULT_DATASET_SIZE).toBe(10_000_000)
  })

  it('returns deterministic records for the same offset', async () => {
    const firstRepository = createMockEmployeeRepository(1_000)
    const secondRepository = createMockEmployeeRepository(1_000)
    const request = { offset: 280, limit: 12 }
    const firstPage = await firstRepository.getPage(request)
    const secondPage = await secondRepository.getPage(request)

    expect(firstPage).toEqual(secondPage)
  })

  it('caps each request at 500 records and returns a short final page', async () => {
    const repository = createMockEmployeeRepository(1_205)
    const oversizedPage = await repository.getPage({ offset: 0, limit: 900 })
    const finalPage = await repository.getPage({ offset: 1_200, limit: PAGE_SIZE })

    expect(oversizedPage.records).toHaveLength(500)
    expect(oversizedPage.limit).toBe(500)
    expect(finalPage.records).toHaveLength(5)
    expect(finalPage.records[0]?.id).toBe('EMP-00001201')
  })

  it('keeps generated field types and date format within the schema', async () => {
    const repository = createMockEmployeeRepository(1_000)
    const { records } = await repository.getPage({ offset: 0, limit: PAGE_SIZE })

    for (const record of records) {
      expect(Number.isInteger(record.age)).toBe(true)
      expect(record.dateStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(record.name.length).toBeGreaterThan(0)
    }
  })
})