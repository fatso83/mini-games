import { createGame } from './create-game'
import type { Direction, GameState, PlayerState, PlayerId, RandomSource } from './types'

export type RoundCommand = 'toggle-pause' | 'new-round'

const opposites: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' }

function isOpposite(first: Direction, second: Direction): boolean {
  return opposites[first] === second
}

function copyPlayers(state: GameState, update: (player: PlayerState) => PlayerState): Readonly<Record<PlayerId, PlayerState>> {
  const players: Record<PlayerId, PlayerState> = Object.create(null) as Record<PlayerId, PlayerState>
  for (const id of Object.keys(state.players)) players[id] = update(state.players[id]!)
  return Object.freeze(players)
}

export function queueDirection(state: GameState, playerId: PlayerId, direction: Direction): GameState {
  if (state.status !== 'ready' && state.status !== 'running') return state
  if (!Object.prototype.hasOwnProperty.call(state.players, playerId)) return state
  const player = state.players[playerId]!
  const comparison = player.queuedDirections[player.queuedDirections.length - 1] ?? player.direction
  if (isOpposite(comparison, direction)) return state

  if (state.status === 'ready') {
    return { ...state, status: 'running', players: copyPlayers(state, (candidate) => candidate.id === playerId ? { ...candidate, direction, queuedDirections: [] } : candidate) }
  }
  if (player.queuedDirections.length >= state.config.inputQueueSize) return state
  return {
    ...state,
    players: copyPlayers(state, (candidate) => candidate.id === playerId
      ? { ...candidate, queuedDirections: [...candidate.queuedDirections, direction] }
      : candidate),
  }
}

export function applyRoundCommand(state: GameState, command: RoundCommand, random: RandomSource): GameState {
  if (command === 'new-round') {
    return createGame({ config: state.config, playerIds: Object.keys(state.players), random })
  }
  if (command !== 'toggle-pause') return state
  if (state.status === 'ready') return { ...state, status: 'running' }
  if (state.status === 'paused') return { ...state, status: 'running' }
  if (state.status !== 'running') return state
  return {
    ...state,
    status: 'paused',
    players: copyPlayers(state, (player) => player.queuedDirections.length ? { ...player, queuedDirections: [] } : player),
  }
}
