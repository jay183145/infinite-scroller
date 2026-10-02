import type { Employee } from '../types/employee'
import { compareEmployees, employeeCollator } from './employeeQuery'
import type { EmployeeSortField, SortDirection } from './employeeRepository'

// 排序鍵與候選序號打包成一個 double：鍵 × 2^24 + 序號。兩者都是整數且結果 < 2^53，可精確還原；
// 原生 Float64Array.sort（不帶比較函式）一次就完成「依鍵排序、同鍵依序號」，序號依 token 升冪產生，等同 id 升冪的 tie-breaker。
const INDEX_RANGE = 2 ** 24
const KEY_RANGE = 2 ** 29

export const MAX_FAST_SORT_CANDIDATES = INDEX_RANGE

const DATA_NUMBER_PATTERN = /^DATA-(\d{1,8})$/i
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

type NumericKey = (employee: Employee) => number | undefined

// 回傳的整數鍵順序必須與 compareEmployees 一致；算不出鍵（使用者輸入的非常規格式）的資料改由比較器處理。
function numericKeyFor(sortBy: EmployeeSortField): NumericKey | undefined {
  switch (sortBy) {
    case 'age':
      return (employee) => (Number.isInteger(employee.age) && employee.age >= 0 && employee.age < KEY_RANGE ? employee.age : undefined)
    case 'dateStart':
      return (employee) => {
        const match = DATE_PATTERN.exec(employee.dateStart)
        return match ? Number(match[1]) * 10_000 + Number(match[2]) * 100 + Number(match[3]) : undefined
      }
    case 'dataNumber':
      return (employee) => {
        const match = DATA_NUMBER_PATTERN.exec(employee.dataNumber)
        return match ? Number(match[1]) : undefined
      }
    default:
      // 姓名、職位、地點的相異值很少，改用字典排名。
      return undefined
  }
}

export interface EmployeeSorter {
  // 依 token 升冪逐筆加入候選資料。
  add(employee: Employee, token: number): void
  // 將 add 時依序收集的 tokens 就地排成最終順序。
  sort(tokens: Uint32Array, getEmployee: (token: number) => Employee | undefined): void
}

export function createEmployeeSorter(sortBy: EmployeeSortField, direction: SortDirection, capacity: number): EmployeeSorter {
  if (capacity > INDEX_RANGE) throw new Error('候選資料超過快速排序的上限。')

  const packed = new Float64Array(capacity)
  const numericKey = numericKeyFor(sortBy)
  const dictionary = numericKey ? undefined : new Map<string, number>()
  const distinctValues: string[] = []
  const irregular: Array<{ employee: Employee; token: number }> = []
  let count = 0

  function add(employee: Employee, token: number): void {
    const index = count
    count += 1

    if (dictionary) {
      const value = String(employee[sortBy])
      let id = dictionary.get(value)
      if (id === undefined) {
        id = distinctValues.length
        dictionary.set(value, id)
        distinctValues.push(value)
      }
      // 先暫存字典編號，sort 時才換成排名。
      packed[index] = id
      return
    }

    const key = numericKey!(employee)
    if (key === undefined) {
      packed[index] = Number.POSITIVE_INFINITY
      irregular.push({ employee, token })
    } else {
      packed[index] = key
    }
  }

  function rankDictionary(): Uint32Array {
    const order = distinctValues.map((_, id) => id).sort((left, right) => employeeCollator.compare(distinctValues[left]!, distinctValues[right]!))
    const ranks = new Uint32Array(distinctValues.length)
    let rank = 0
    order.forEach((id, position) => {
      // 比較器視為相等的值（例如只差大小寫）共用同一個排名，同名時才會依 id 排序。
      if (position > 0 && employeeCollator.compare(distinctValues[order[position - 1]!]!, distinctValues[id]!) !== 0) rank += 1
      ranks[id] = rank
    })
    return ranks
  }

  function sort(tokens: Uint32Array, getEmployee: (token: number) => Employee | undefined): void {
    const ranks = dictionary ? rankDictionary() : undefined

    for (let index = 0; index < count; index += 1) {
      const raw = packed[index]!
      if (raw === Number.POSITIVE_INFINITY) continue
      const key = ranks ? ranks[raw]! : raw
      const directedKey = direction === 'asc' ? key : KEY_RANGE - 1 - key
      packed[index] = directedKey * INDEX_RANGE + index
    }

    // 非常規資料標成 Infinity，排序後集中在尾端。
    const entries = packed.subarray(0, count)
    entries.sort()

    // 還原成 token 暫存在 packed 前段（double 可精確表示 uint32），之後 tokens 可安全覆寫。
    const regularCount = count - irregular.length
    for (let position = 0; position < regularCount; position += 1) {
      packed[position] = tokens[packed[position]! % INDEX_RANGE]!
    }

    if (irregular.length === 0) {
      tokens.set(packed.subarray(0, regularCount))
      return
    }

    // 非常規資料通常只有幾筆：用比較器排好後，以二分搜尋找插入點，只需 O(k log n) 次比較。
    irregular.sort((left, right) => compareEmployees(left.employee, right.employee, sortBy, direction))
    let read = 0
    let write = 0
    for (const { employee, token } of irregular) {
      let low = read
      let high = regularCount
      while (low < high) {
        const middle = (low + high) >>> 1
        const other = getEmployee(packed[middle]!)
        if (other && compareEmployees(other, employee, sortBy, direction) < 0) low = middle + 1
        else high = middle
      }
      while (read < low) tokens[write++] = packed[read++]!
      tokens[write++] = token
    }
    while (read < regularCount) tokens[write++] = packed[read++]!
  }

  return { add, sort }
}
