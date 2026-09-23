import { describe, expect, it } from 'vitest'
import { LEVELS } from './levels'
import { resolveMultiplayerTick, type MultiplayerPlayer } from './multiplayer-core'

const p = (id: string, body: MultiplayerPlayer['body'], direction: MultiplayerPlayer['direction']): MultiplayerPlayer => ({
  id, body, direction, queuedDirections: [], score: 0, status: 'active',
})

describe('fixed levels', () => {
  it('defines the four requested 20x20 obstacle layouts and speeds', () => {
    expect(LEVELS.map((level) => [level.tickIntervalMs, level.obstacles.length])).toEqual([[140, 0], [120, 16], [100, 36], [80, 48]])
    expect(LEVELS[1]!.obstacles).toContainEqual({ x: 9, y: 6 })
    expect(LEVELS[2]!.obstacles).toContainEqual({ x: 5, y: 9 })
    expect(LEVELS[3]!.obstacles).toContainEqual({ x: 2, y: 9 })
  })
})

describe('resolveMultiplayerTick', () => {
  it('resolves simultaneous head collisions and preserves killed players', () => {
    const result = resolveMultiplayerTick({ width: 5, height: 5, obstacles: [], food: null, random: () => 0, players: [
      p('a', [{ x: 1, y: 2 }], 'right'), p('b', [{ x: 3, y: 2 }], 'left'),
    ] })
    expect(result.players.map((player) => player.status)).toEqual(['lost', 'lost'])
    expect(result.events).toEqual([{ type: 'players-collided', playerIds: ['a', 'b'], position: { x: 2, y: 2 } }])
  })

  it('allows entering a non-eating other tail that moves away', () => {
    const result = resolveMultiplayerTick({ width: 5, height: 5, obstacles: [], food: { x: 0, y: 0 }, random: () => 0, players: [
      p('a', [{ x: 1, y: 3 }], 'right'), p('b', [{ x: 2, y: 2 }, { x: 2, y: 3 }], 'right'),
    ] })
    expect(result.players[0]!.status).toBe('active')
    expect(result.players[0]!.body[0]).toEqual({ x: 2, y: 3 })
  })

  it('ignores obstacles for a single active snake but removes a snake hitting one in multiplayer', () => {
    const solo = resolveMultiplayerTick({ width: 5, height: 5, obstacles: [{ x: 2, y: 2 }], food: null, random: () => 0, players: [p('a', [{ x: 1, y: 2 }], 'right')] })
    expect(solo.players[0]!.status).toBe('active')
    const multi = resolveMultiplayerTick({ width: 5, height: 5, obstacles: [{ x: 2, y: 2 }], food: null, random: () => 0, players: [p('a', [{ x: 1, y: 2 }], 'right'), p('b', [{ x: 4, y: 4 }], 'up')] })
    expect(multi.players[0]!.status).toBe('lost')
  })
})
