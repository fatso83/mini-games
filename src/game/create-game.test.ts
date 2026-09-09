import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG } from './config'
import { createGame } from './create-game'

describe('createGame', () => {
  it('creates a ready game with independent stable players and deterministic food', () => {
    const game = createGame({ config: DEFAULT_GAME_CONFIG, playerIds: ['alpha', 'beta'], random: () => 0 })
    expect(game.status).toBe('ready')
    expect(Object.keys(game.players)).toEqual(['alpha', 'beta'])
    expect(game.players.alpha).toEqual({ id: 'alpha', body: DEFAULT_GAME_CONFIG.startingBody, direction: 'right', queuedDirections: [], score: 0 })
    expect(game.players.alpha!).not.toBe(game.players.beta!)
    expect(game.players.alpha!.body).not.toBe(game.players.beta!.body)
    expect(game.tickIntervalMs).toBe(DEFAULT_GAME_CONFIG.baseTickMs)
    expect(game.food).toEqual({ x: 0, y: 0 })
  })
  it.each([[[]], [['same', 'same']]])('rejects player IDs %j', (playerIds) => {
    expect(() => createGame({ config: DEFAULT_GAME_CONFIG, playerIds, random: () => 0 })).toThrow(/player/i)
  })
  it('validates and freezes the supplied configuration', () => {
    const game = createGame({ config: { ...DEFAULT_GAME_CONFIG }, playerIds: ['one'], random: () => 0 })
    expect(Object.isFrozen(game.config)).toBe(true)
  })
})
