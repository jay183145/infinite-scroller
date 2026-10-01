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

  it('keeps create, update, and delete changes in the repository session', async () => {
    const repository = createMockEmployeeRepository(1_000)
    const created = await repository.create({
      name: 'Rina Ito',
      position: 'Security Engineer',
      location: 'Osaka',
      age: 32,
      dateStart: '2023-05-12',
    })

    const createdPage = await repository.getPage({ offset: 0, limit: PAGE_SIZE })
    expect(createdPage.records[0]?.id).toBe(created.id)
    expect(createdPage.total).toBe(1_001)

    await repository.update(created.id, {
      name: 'Rina Ito',
      position: 'Staff Security Engineer',
      location: 'Osaka',
      age: 33,
      dateStart: '2023-05-12',
    })

    const updatedPage = await repository.getPage({ offset: 0, limit: PAGE_SIZE })
    expect(updatedPage.records[0]?.position).toBe('Staff Security Engineer')

    await repository.delete(created.id)
    const afterDelete = await repository.getPage({ offset: 0, limit: PAGE_SIZE })
    expect(afterDelete.total).toBe(1_000)
    expect(afterDelete.records[0]?.id).toBe('EMP-00000001')
  })

  it('keeps pinned rows ordered above the regular paged records', async () => {
    const repository = createMockEmployeeRepository(6)
    await repository.setPinned('EMP-00000003', true)
    await repository.setPinned('EMP-00000001', true)
    await repository.movePinned('EMP-00000001', 'up')

    const page = await repository.getPage({ offset: 0, limit: PAGE_SIZE })

    expect(page.pinnedRecords.map((record) => record.id)).toEqual([
      'EMP-00000001',
      'EMP-00000003',
    ])
    expect(page.records.map((record) => record.id)).toEqual([
      'EMP-00000002',
      'EMP-00000004',
      'EMP-00000005',
      'EMP-00000006',
    ])
    expect(page.total).toBe(6)
    expect(page.pageTotal).toBe(4)
  })

  it('keeps deep-page positions correct after pinned and deleted rows are excluded', async () => {
    const repository = createMockEmployeeRepository(1_205)
    await repository.setPinned('EMP-00000001', true)
    await repository.delete('EMP-00000003')

    const page = await repository.getPage({ offset: 500, limit: PAGE_SIZE })

    expect(page.records).toHaveLength(500)
    expect(page.records[0]?.id).toBe('EMP-00000503')
    expect(page.pageTotal).toBe(1_203)
  })
})