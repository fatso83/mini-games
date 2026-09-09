import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG } from './config'
import { listFreeCells, placeFood } from './food'
import type { PlayerState } from './types'

const player = (body: PlayerState['body']): PlayerState => ({ id: 'one', body, direction: 'right', queuedDirections: [], score: 0 })

describe('food placement', () => {
  it('lists free cells in stable row-major order and excludes every body', () => {
    const config = { ...DEFAULT_GAME_CONFIG, width: 3, height: 2 }
    expect(listFreeCells(config, [player([{ x: 1, y: 0 }]), { ...player([{ x: 2, y: 1 }]), id: 'two' }])).toEqual([
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
    ])
  })
  it('chooses first for zero and last for values near one', () => {
    const config = { ...DEFAULT_GAME_CONFIG, width: 2, height: 2 }
    const players = [player([{ x: 0, y: 0 }])]
    expect(placeFood(config, players, () => 0)).toEqual({ x: 1, y: 0 })
    expect(placeFood(config, players, () => 0.999)).toEqual({ x: 1, y: 1 })
  })
  it('returns null on a full board and rejects invalid random values', () => {
    const config = { ...DEFAULT_GAME_CONFIG, width: 1, height: 1 }
    expect(placeFood(config, [player([{ x: 0, y: 0 }])], () => 0)).toBeNull()
    expect(() => placeFood(config, [], () => -0.1)).toThrow(/random/i)
    expect(() => placeFood(config, [], () => 1)).toThrow(/random/i)
  })
})
