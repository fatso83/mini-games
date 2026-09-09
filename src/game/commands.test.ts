import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG } from './config'
import { createGame } from './create-game'
import { applyRoundCommand, queueDirection } from './commands'
import type { Direction, GameState, PlayerState, RandomSource } from './types'

const random: RandomSource = () => 0
const game = (playerIds: readonly string[] = ['one']): GameState => createGame({ config: DEFAULT_GAME_CONFIG, playerIds, random })
const withStatus = (state: GameState, status: GameState['status']): GameState => ({ ...state, status })
const withPlayer = (state: GameState, id: string, patch: Partial<PlayerState>): GameState => ({
  ...state,
  players: Object.freeze(Object.keys(state.players).reduce((players, key) => {
    players[key] = key === id ? { ...state.players[key]!, ...patch } : state.players[key]!
    return players
  }, Object.create(null) as Record<string, PlayerState>)),
})

describe('queueDirection', () => {
  it('queues a valid perpendicular direction for a known running player immutably', () => {
    const state = withStatus(game(['one', 'two']), 'running')
    const player = state.players.one
    const result = queueDirection(state, 'one', 'up')
    expect(result).not.toBe(state)
    expect(result.players.one).not.toBe(player)
    expect(result.players.one!.queuedDirections).toEqual(['up'])
    expect(result.players.two).toBe(state.players.two)
    expect(state.players.one!.queuedDirections).toEqual([])
  })

  it('ignores unknown IDs and preserves the exact state', () => {
    const state = withStatus(game(), 'running')
    expect(queueDirection(state, 'missing', 'up')).toBe(state)
  })

  it.each([
    ['right', 'left'], ['up', 'down'], ['down', 'up'], ['left', 'right'],
  ] as const)('rejects a direct reversal from %s to %s', (current, direction) => {
    const state = withStatus(withPlayer(game(), 'one', { direction: current }), 'running')
    expect(queueDirection(state, 'one', direction)).toBe(state)
  })

  it('rejects a reversal in ready and does not start the round', () => {
    const state = game()
    expect(queueDirection(state, 'one', 'left')).toBe(state)
    expect(state.status).toBe('ready')
  })

  it('retains two legal rapid turns in order and ignores a third', () => {
    const state = withStatus(game(), 'running')
    const first = queueDirection(state, 'one', 'up')
    const second = queueDirection(first, 'one', 'left')
    const third = queueDirection(second, 'one', 'down')
    expect(second.players.one!.queuedDirections).toEqual(['up', 'left'])
    expect(third).toBe(second)
  })

  it.each<GameState['status']>(['paused', 'lost', 'won'])('ignores direction input while %s', (status) => {
    const state = withStatus(game(), status)
    expect(queueDirection(state, 'one', 'up')).toBe(state)
  })

  it('starts from ready on the first valid direction without queuing or moving', () => {
    const state = game()
    const result = queueDirection(state, 'one', 'up')
    expect(result.status).toBe('running')
    expect(result.players.one!.direction).toBe('up')
    expect(result.players.one!.queuedDirections).toEqual([])
    expect(result.players.one!.body).toEqual(state.players.one!.body)
  })

  it('supports the prototype key as an addressed player ID', () => {
    const state = withStatus(game(['__proto__']), 'running')
    expect(queueDirection(state, '__proto__', 'up').players['__proto__']!.queuedDirections).toEqual(['up'])
  })
})

describe('applyRoundCommand', () => {
  it.each([
    ['ready', 'running'], ['running', 'paused'], ['paused', 'running'],
  ] as const)('toggles %s to %s', (from, to) => {
    const state = withStatus(game(), from)
    expect(applyRoundCommand(state, 'toggle-pause', random).status).toBe(to)
  })

  it.each<GameState['status']>(['lost', 'won'])('leaves %s unchanged on toggle', (status) => {
    const state = withStatus(game(), status)
    expect(applyRoundCommand(state, 'toggle-pause', random)).toBe(state)
  })

  it('clears every player queue when pausing and keeps directions on resume', () => {
    const running = withStatus(game(['one', 'two']), 'running')
    const queued = queueDirection(queueDirection(running, 'one', 'up'), 'two', 'down')
    const paused = applyRoundCommand(queued, 'toggle-pause', random)
    expect(paused.players.one!.queuedDirections).toEqual([])
    expect(paused.players.two!.queuedDirections).toEqual([])
    expect(applyRoundCommand(paused, 'toggle-pause', random).players.one!.direction).toBe('right')
  })

  it('creates a ready new round with the same players, reset scores, and fresh food', () => {
    const state = withStatus(withPlayer(game(['one', 'two']), 'one', { score: 30 }), 'lost')
    const result = applyRoundCommand(state, 'new-round', () => 0.99)
    expect(result).not.toBe(state)
    expect(result.status).toBe('ready')
    expect(Object.keys(result.players)).toEqual(['one', 'two'])
    expect(result.players.one!.score).toBe(0)
    expect(result.players.one!.body).toEqual(DEFAULT_GAME_CONFIG.startingBody)
    expect(result.config).toEqual(state.config)
    expect(result.food).not.toBeNull()
  })

  it('restarts equally from every round status', () => {
    for (const status of ['ready', 'running', 'paused', 'lost', 'won'] as const) {
      expect(applyRoundCommand(withStatus(game(), status), 'new-round', random).status).toBe('ready')
    }
  })
})
