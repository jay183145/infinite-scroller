import { describe, expect, it } from 'vitest'
import { DATASET_SIZE_OPTIONS, DEFAULT_DATASET_SIZE, PAGE_SIZE } from './employeeRepository'
import { compareEmployees, matchesEmployeeSearch } from './employeeQuery'
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
      expect(record.dataNumber).toMatch(/^DATA-\d{8}$/)
      expect(record.name.length).toBeGreaterThan(0)
    }
    expect(new Set(records.map(({ dataNumber }) => dataNumber)).size).toBe(records.length)
  })

  it('searches every requested column case-insensitively', () => {
    const employee = {
      id: 'EMP-00000001',
      dataNumber: 'DATA-00000001',
      name: 'Alex Morgan',
      position: 'Product Designer',
      location: 'Taipei',
      age: 31,
      dateStart: '2022-04-18',
    }

    expect(matchesEmployeeSearch(employee, 'alex')).toBe(true)
    expect(matchesEmployeeSearch(employee, 'DESIGNER')).toBe(true)
    expect(matchesEmployeeSearch(employee, 'taipei')).toBe(true)
    expect(matchesEmployeeSearch(employee, '31')).toBe(true)
    expect(matchesEmployeeSearch(employee, '2022-04')).toBe(true)
    expect(matchesEmployeeSearch(employee, 'nairobi')).toBe(false)
  })

  it('sorts age numerically and uses ID as an ascending stable tie-breaker', () => {
    const younger = {
      id: 'EMP-00000002',
      dataNumber: 'DATA-00000002',
      name: 'Alex Morgan',
      position: 'Designer',
      location: 'Taipei',
      age: 9,
      dateStart: '2022-04-18',
    }
    const older = { ...younger, id: 'EMP-00000003', age: 31 }
    const sameAgeLowerId = { ...younger, id: 'EMP-00000001' }

    expect([older, younger, sameAgeLowerId].sort((left, right) =>
      compareEmployees(left, right, 'age', 'asc'),
    ).map(({ id }) => id)).toEqual([
      'EMP-00000001',
      'EMP-00000002',
      'EMP-00000003',
    ])
  })

  it('keeps create, update, and delete changes in the repository session', async () => {
    const repository = createMockEmployeeRepository(1_000)
    const created = await repository.create({
      dataNumber: 'DATA-CUSTOM-001',
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
      dataNumber: 'DATA-CUSTOM-001',
      name: 'Rina Ito',
      position: 'Staff Security Engineer',
      location: 'Osaka',
      age: 33,
      dateStart: '2023-05-12',
    })

    const updatedPage = await repository.getPage({ offset: 0, limit: PAGE_SIZE })
    expect(updatedPage.records[0]?.position).toBe('Staff Security Engineer')

    await repository.delete(created.id, 1)
    const afterDelete = await repository.getPage({ offset: 0, limit: PAGE_SIZE })
    expect(afterDelete.total).toBe(1_000)
    expect(afterDelete.records[0]?.id).toBe('EMP-00000001')
  })

  it('moves a record to an exact position and shifts intervening records', async () => {
    const repository = createMockEmployeeRepository(6)
    await repository.moveToPosition('EMP-00000006', 6, 2)

    const page = await repository.getPage({ offset: 0, limit: PAGE_SIZE })

    expect(page.records.map((record) => record.id)).toEqual([
      'EMP-00000001',
      'EMP-00000006',
      'EMP-00000002',
      'EMP-00000003',
      'EMP-00000004',
      'EMP-00000005',
    ])
    expect(page.manualPositions).toEqual([
      { id: 'EMP-00000006', position: 1 },
    ])
    expect(page.total).toBe(6)
    expect(page.pageTotal).toBe(6)

    await repository.moveToPosition('EMP-00000002', 3, 5)
    const reorderedPage = await repository.getPage({ offset: 0, limit: PAGE_SIZE })

    expect(reorderedPage.records.map((record) => record.id)).toEqual([
      'EMP-00000001',
      'EMP-00000006',
      'EMP-00000003',
      'EMP-00000004',
      'EMP-00000002',
      'EMP-00000005',
    ])
    expect(page.total).toBe(6)
  })

  it('supports multiple independently pinned records and exposes their positions', async () => {
    const repository = createMockEmployeeRepository(8)
    await repository.moveToPosition('EMP-00000008', 8, 2)
    await repository.moveToPosition('EMP-00000006', 7, 4)

    const page = await repository.getPage({ offset: 0, limit: PAGE_SIZE })

    expect(page.records.map((record) => record.id)).toEqual([
      'EMP-00000001',
      'EMP-00000008',
      'EMP-00000002',
      'EMP-00000006',
      'EMP-00000003',
      'EMP-00000004',
      'EMP-00000005',
      'EMP-00000007',
    ])
    expect(page.manualPositions).toEqual([
      { id: 'EMP-00000008', position: 1 },
      { id: 'EMP-00000006', position: 3 },
    ])
  })

  it('keeps an existing PIN position fixed when another record moves across it', async () => {
    const repository = createMockEmployeeRepository(8)
    await repository.moveToPosition('EMP-00000008', 8, 4)
    await repository.moveToPosition('EMP-00000007', 8, 2)

    const page = await repository.getPage({ offset: 0, limit: PAGE_SIZE })

    expect(page.records[3]?.id).toBe('EMP-00000008')
    expect(page.manualPositions.find(({ id }) => id === 'EMP-00000008')?.position).toBe(3)
  })

  it('keeps an existing PIN position fixed when an earlier record is deleted', async () => {
    const repository = createMockEmployeeRepository(8)
    await repository.moveToPosition('EMP-00000008', 8, 4)
    await repository.delete('EMP-00000002', 2)

    const page = await repository.getPage({ offset: 0, limit: PAGE_SIZE })

    expect(page.records[3]?.id).toBe('EMP-00000008')
    expect(page.manualPositions.find(({ id }) => id === 'EMP-00000008')?.position).toBe(3)
  })

  it('records a PIN even when the selected row is already at its target position', async () => {
    const repository = createMockEmployeeRepository(4)
    await repository.moveToPosition('EMP-00000004', 4, 4)

    const page = await repository.getPage({ offset: 0, limit: PAGE_SIZE })

    expect(page.manualPositions).toEqual([
      { id: 'EMP-00000004', position: 3 },
    ])
  })

  it('rejects a deletion that would push a fixed PIN beyond the final row', async () => {
    const repository = createMockEmployeeRepository(4)
    await repository.moveToPosition('EMP-00000004', 4, 4)

    await expect(repository.delete('EMP-00000001', 1)).rejects.toThrow(
      '請先調整 PIN 位置',
    )
  })

  it('keeps deep-page positions correct after a delete and a manual move', async () => {
    const repository = createMockEmployeeRepository(1_205)
    await repository.delete('EMP-00000003', 3)
    await repository.moveToPosition('EMP-00001205', 1_204, 501)

    const page = await repository.getPage({ offset: 500, limit: PAGE_SIZE })

    expect(page.records).toHaveLength(500)
    expect(page.records[0]?.id).toBe('EMP-00001205')
    expect(page.records[1]?.id).toBe('EMP-00000502')
    expect(page.pageTotal).toBe(1_204)
  })
})