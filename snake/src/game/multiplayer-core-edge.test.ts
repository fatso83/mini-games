import { describe, expect, it } from 'vitest'
import { resolveMultiplayerTick, type MultiplayerPlayer } from './multiplayer-core'

const p = (id: string, body: MultiplayerPlayer['body'], direction: MultiplayerPlayer['direction']): MultiplayerPlayer => ({ id, body, direction, queuedDirections: [], score: 0, status: 'active' })
const run = (players: readonly MultiplayerPlayer[], food: { x: number; y: number } | null, width = 4, height = 4) => resolveMultiplayerTick({ width, height, players, food, obstacles: [], random: () => 0 })

describe('multiplayer edge cases', () => {
  it('kills both snakes on a head swap and emits one collision event', () => {
    const result = run([p('a', [{ x: 1, y: 1 }], 'right'), p('b', [{ x: 2, y: 1 }], 'left')], null)
    expect(result.players.every((player) => player.status === 'lost')).toBe(true)
    expect(result.events[0]!.type).toBe('players-collided')
  })
  it('allows a U-shaped snake to enter its vacating own tail', () => {
    const result = run([p('a', [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }], 'left')], null)
    expect(result.players[0]!.status).toBe('active')
  })
  it('does not treat a lost snake tail as vacating', () => {
    const result = resolveMultiplayerTick({ width: 5, height: 5, players: [p('a', [{ x: 1, y: 3 }], 'right'), p('b', [{ x: 3, y: 3 }, { x: 2, y: 3 }], 'right')], food: null, obstacles: [{ x: 4, y: 3 }], random: () => 0 })
    expect(result.players.map((player) => player.status)).toEqual(['lost', 'lost'])
  })
  it('applies a queued turn to both movement and direction state', () => {
    const player = { ...p('a', [{ x: 1, y: 1 }], 'right' as const), queuedDirections: ['down' as const] }
    const result = run([player], null)
    expect(result.players[0]!.body[0]).toEqual({ x: 1, y: 2 })
    expect(result.players[0]!.direction).toBe('down')
  })
  it('grows and respawns food, or returns null when the board is full', () => {
    const grown = run([p('a', [{ x: 1, y: 1 }], 'right')], { x: 2, y: 1 })
    expect(grown.players[0]!.body).toHaveLength(2)
    expect(grown.food).not.toEqual({ x: 2, y: 1 })
    const full = run([p('a', [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }], 'down')], { x: 1, y: 1 }, 2, 2)
    expect(full.food).toBeNull()
  })
})
