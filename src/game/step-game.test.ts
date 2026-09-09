import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG } from './config'
import { createGame } from './create-game'
import type { Direction, GameState, PlayerState } from './types'
import { stepGame } from './step-game'

const random = () => 0

const runningGame = (playerIds: readonly string[] = ['one']): GameState => ({
  ...createGame({ config: DEFAULT_GAME_CONFIG, playerIds, random }),
  status: 'running',
})

const withPlayer = (state: GameState, id: string, patch: Partial<PlayerState>): GameState => ({
  ...state,
  players: Object.freeze({ ...state.players, [id]: { ...state.players[id]!, ...patch } }),
})

describe('stepGame', () => {
  it.each<[Direction, { x: number; y: number }]>([
    ['right', { x: 11, y: 10 }],
    ['left', { x: 9, y: 10 }],
    ['up', { x: 10, y: 9 }],
    ['down', { x: 10, y: 11 }],
  ])('moves one square %s and removes the tail without mutating input', (direction, head) => {
    const state = withPlayer(runningGame(), 'one', { direction, body: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }] })
    const originalBody = state.players.one!.body
    const result = stepGame(state, 'one', random)
    expect(result.players.one!.body).toEqual([head, { x: 10, y: 10 }, { x: 9, y: 10 }])
    expect(result.players.one!.body).toHaveLength(originalBody.length)
    expect(state.players.one!.body).toBe(originalBody)
    expect(state.players.one!.queuedDirections).toEqual([])
  })

  it('updates only the addressed player and preserves the remote player reference', () => {
    const state = runningGame(['local', 'remote'])
    const remote = state.players.remote!
    const result = stepGame(state, 'local', random)
    expect(result.players.local!.body[0]).toEqual({ x: 11, y: 10 })
    expect(result.players.remote).toBe(remote)
    expect(result.players.remote).toEqual(remote)
  })

  it.each<GameState['status']>(['ready', 'paused', 'lost', 'won'])('returns the exact state for %s', (status) => {
    const state = { ...runningGame(), status }
    expect(stepGame(state, 'one', random)).toBe(state)
  })

  it('returns the exact state for an unknown player ID, including prototype keys', () => {
    const state = runningGame()
    expect(stepGame(state, 'missing', random)).toBe(state)
    expect(stepGame(state, '__proto__', random)).toBe(state)
  })

  it.each([
    [{ x: 0, y: 10 }, 'left', { x: 19, y: 10 }],
    [{ x: 19, y: 10 }, 'right', { x: 0, y: 10 }],
    [{ x: 10, y: 0 }, 'up', { x: 10, y: 19 }],
    [{ x: 10, y: 19 }, 'down', { x: 10, y: 0 }],
  ] as const)('wraps from %j moving %s to %j', (position, direction, expected) => {
    const state = withPlayer(runningGame(), 'one', { body: [position], direction })
    expect(stepGame(state, 'one', random).players.one!.body).toEqual([expected])
  })

  it('consumes exactly the first queued direction before moving and preserves the rest', () => {
    const state = withPlayer(runningGame(), 'one', { queuedDirections: ['up', 'left'] })
    const first = stepGame(state, 'one', random)
    expect(first.players.one!.direction).toBe('up')
    expect(first.players.one!.queuedDirections).toEqual(['left'])
    expect(first.players.one!.body[0]).toEqual({ x: 10, y: 9 })
    const second = stepGame(first, 'one', random)
    expect(second.players.one!.direction).toBe('left')
    expect(second.players.one!.queuedDirections).toEqual([])
    expect(second.players.one!.body[0]).toEqual({ x: 9, y: 9 })
  })
})
