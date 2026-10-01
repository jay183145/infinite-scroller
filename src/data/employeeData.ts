import type { Employee } from '../types/employee'

const firstNames = [
  'Alex', 'Jin', 'Maya', 'Noah', 'Yuki', 'Lucas', 'Amara', 'Theo',
  'Sofia', 'Ethan', 'Nina', 'Omar', 'Iris', 'Mateo', 'Ava', 'Kai',
]

const lastNames = [
  'Morgan', 'Park', 'Chen', 'Williams', 'Sato', 'Ferreira', 'Okafor', 'Martin',
  'Rossi', 'Patel', 'Kim', 'Garcia', 'Liu', 'Singh', 'Brown', 'Tanaka',
]

const positions = [
  'Product Designer', 'Data Analyst', 'Operations Lead', 'People Partner',
  'UX Researcher', 'Platform Engineer', 'Program Manager', 'Finance Associate',
  'Software Engineer', 'Customer Success Manager', 'Recruiter', 'Marketing Specialist',
]

const locations = [
  'Taipei', 'Seoul', 'Singapore', 'London', 'Tokyo', 'Lisbon',
  'Nairobi', 'Paris', 'Toronto', 'Sydney', 'Berlin', 'Manila',
]

function hashIndex(index: number, salt: number): number {
  let value = Math.imul(index + salt + 1, 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return (value ^ (value >>> 16)) >>> 0
}

function pickValue<T>(values: readonly T[], seed: number): T {
  const value = values[seed % values.length]
  if (value === undefined) throw new Error('假資料樣本清單不可為空。')
  return value
}

export function createEmployee(index: number): Employee {
  const nameSeed = hashIndex(index, 11)
  const positionSeed = hashIndex(index, 23)
  const locationSeed = hashIndex(index, 37)
  const dateSeed = hashIndex(index, 53)
  const startDate = new Date(Date.UTC(2015, 0, 1) + (dateSeed % 4_018) * 86_400_000)

  return {
    id: `EMP-${String(index + 1).padStart(8, '0')}`,
    dataNumber: `DATA-${String(index + 1).padStart(8, '0')}`,
    name: `${pickValue(firstNames, nameSeed)} ${pickValue(lastNames, nameSeed >>> 8)}`,
    position: pickValue(positions, positionSeed),
    location: pickValue(locations, locationSeed),
    age: 20 + (hashIndex(index, 71) % 46),
    dateStart: startDate.toISOString().slice(0, 10),
  }
}