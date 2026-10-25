import { describe, expect, it } from 'vitest'
import { dedupeJoin } from './hooks'

describe('dedupeJoin', () => {
  it('returns history when nothing arrived live', () => {
    expect(dedupeJoin(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('appends live lines after history', () => {
    expect(dedupeJoin(['a'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('does not repeat lines present in both', () => {
    expect(dedupeJoin(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd'])
    expect(dedupeJoin(['a', 'b'], ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('caps the result', () => {
    const history = Array.from({ length: 600 }, (_, i) => `h${i}`)
    expect(dedupeJoin(history, ['x'])).toHaveLength(500)
    expect(dedupeJoin(history, ['x']).at(-1)).toBe('x')
  })
})
