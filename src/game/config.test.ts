import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG, createGameConfig } from './config'

describe('game configuration', () => {
  it('provides the approved defaults', () => {
    expect(DEFAULT_GAME_CONFIG).toEqual({
      width: 20, height: 20,
      startingBody: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
      startingDirection: 'right', baseTickMs: 140, speedStepMs: 8,
      minTickMs: 60, pointsPerFood: 10, inputQueueSize: 2,
    })
  })

  it.each([
    ['width', { width: 0 }], ['height', { height: 0 }],
    ['fractional width', { width: 2.5 }], ['fractional height', { height: 2.5 }],
    ['empty body', { startingBody: [] }],
    ['duplicate body', { startingBody: [{ x: 1, y: 1 }, { x: 1, y: 1 }] }],
    ['full body', { width: 2, height: 2, startingBody: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] }],
    ['outside position', { startingBody: [{ x: 20, y: 10 }] }],
    ['fractional position', { startingBody: [{ x: 1.5, y: 1 }] }],
    ['base below minimum', { baseTickMs: 59, minTickMs: 60 }],
    ['zero speed step', { speedStepMs: 0 }], ['negative speed step', { speedStepMs: -1 }],
    ['zero minimum', { minTickMs: 0 }], ['zero points', { pointsPerFood: 0 }],
    ['NaN points', { pointsPerFood: Number.NaN }], ['infinite points', { pointsPerFood: Number.POSITIVE_INFINITY }], ['negative infinite points', { pointsPerFood: Number.NEGATIVE_INFINITY }],
    ['zero queue', { inputQueueSize: 0 }], ['fractional queue', { inputQueueSize: 1.5 }],
  ])('rejects %s', (_name, change) => {
    expect(() => createGameConfig({ ...DEFAULT_GAME_CONFIG, ...change })).toThrow()
  })

  it('returns a deeply immutable defensive copy', () => {
    const source = { ...DEFAULT_GAME_CONFIG, startingBody: [...DEFAULT_GAME_CONFIG.startingBody.map((p) => ({ ...p }))] }
    const result = createGameConfig(source)
    expect(result).not.toBe(source)
    expect(result.startingBody).not.toBe(source.startingBody)
    expect(result.startingBody[0]).not.toBe(source.startingBody[0])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.startingBody)).toBe(true)
    expect(Object.isFrozen(result.startingBody[0])).toBe(true)
  })
})
