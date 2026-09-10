import { describe, expect, it } from 'vitest'
import { createGameConfig, DEFAULT_GAME_CONFIG } from './config'
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

  it('grows and scores when the next head reaches food, then places food on a free cell', () => {
    const state = withPlayer(runningGame(), 'one', { body: [{ x: 10, y: 10 }, { x: 9, y: 10 }], direction: 'right' })
    const withFood = { ...state, food: { x: 11, y: 10 } }
    const result = stepGame(withFood, 'one', () => 0)
    expect(result.players.one!.body).toEqual([{ x: 11, y: 10 }, { x: 10, y: 10 }, { x: 9, y: 10 }])
    expect(result.players.one!.score).toBe(DEFAULT_GAME_CONFIG.pointsPerFood)
    expect(result.food).not.toBeNull()
    expect(result.food).not.toEqual({ x: 11, y: 10 })
    expect(result.players.one!.body).not.toContainEqual(result.food)
  })

  it('reduces speed by each food step without going below the minimum', () => {
    const config = createGameConfig({ ...DEFAULT_GAME_CONFIG, baseTickMs: 100, speedStepMs: 35, minTickMs: 40 })
    const initial = { ...createGame({ config, playerIds: ['one'], random }), status: 'running' as const }
    const state = withPlayer({ ...initial, food: { x: 11, y: 10 } }, 'one', { body: [{ x: 10, y: 10 }], direction: 'right' })
    const first = stepGame(state, 'one', () => 0)
    expect(first.tickIntervalMs).toBe(65)
    const secondState = withPlayer({ ...first, food: { x: 12, y: 10 } }, 'one', { direction: 'right' })
    expect(stepGame(secondState, 'one', () => 0).tickIntervalMs).toBe(40)
  })

  it('loses on collision with a retained body segment and does not score or replace food', () => {
    const food = { x: 5, y: 5 }
    const state = withPlayer({ ...runningGame(), food }, 'one', { body: [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }], direction: 'right', score: 7 })
    const result = stepGame(state, 'one', () => 0)
    expect(result.status).toBe('lost')
    expect(result.players.one!.score).toBe(7)
    expect(result.food).toEqual(food)
  })

  it('allows moving into the tail cell when the tail is vacated', () => {
    const state = withPlayer(runningGame(), 'one', { body: [{ x: 10, y: 10 }, { x: 9, y: 10 }], direction: 'left' })
    const result = stepGame(state, 'one', random)
    expect(result.status).toBe('running')
    expect(result.players.one!.body[0]).toEqual({ x: 9, y: 10 })
  })

  it.each([
    {
      name: 'on the tail directly ahead',
      body: [{ x: 10, y: 10 }, { x: 11, y: 10 }],
      direction: 'right' as const,
      food: { x: 11, y: 10 },
    },
    {
      name: 'on the tail across the wrap boundary',
      body: [{ x: 0, y: 10 }, { x: 19, y: 10 }],
      direction: 'left' as const,
      food: { x: 19, y: 10 },
    },
  ])('loses without awarding the food when it grows into its tail: $name', ({ body, direction, food }) => {
    const state = withPlayer({ ...runningGame(), food }, 'one', { body, direction, score: 7 })
    let randomCalls = 0
    const result = stepGame(state, 'one', () => {
      randomCalls += 1
      return 0
    })

    expect(result.status).toBe('lost')
    expect(result.players.one!.score).toBe(7)
    expect(result.food).toEqual(food)
    expect(result.tickIntervalMs).toBe(state.tickIntervalMs)
    expect(randomCalls).toBe(0)
  })

  it('wins after eating the final free cell', () => {
    const config = createGameConfig({ ...DEFAULT_GAME_CONFIG, width: 2, height: 2, startingBody: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] })
    const initial = { ...createGame({ config, playerIds: ['one'], random }), status: 'running' as const, food: { x: 0, y: 1 } }
    const headedDown = withPlayer(initial, 'one', { direction: 'down' })
    const result = stepGame(headedDown, 'one', random)
    expect(result.status).toBe('won')
    expect(result.food).toBeNull()
    expect(result.players.one!.body).toHaveLength(4)
    expect(result.players.one!.score).toBe(config.pointsPerFood)
    expect(result.tickIntervalMs).toBe(config.baseTickMs - config.speedStepMs)
  })

  it('keeps unrelated players unchanged when the addressed player eats', () => {
    const state = { ...withPlayer(runningGame(['one', 'two']), 'one', { body: [{ x: 10, y: 10 }], direction: 'right' }), food: { x: 11, y: 10 } }
    const remote = state.players.two!
    const result = stepGame(state, 'one', random)
    expect(result.players.two).toBe(remote)
    expect(result.players.two).toEqual(remote)
  })
})
