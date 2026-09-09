import type { Direction, GameState, PlayerId, PlayerState, Position, RandomSource } from './types'

function wrap(value: number, limit: number): number {
  return ((value % limit) + limit) % limit
}

function nextHead(head: Position, direction: Direction, state: GameState): Position {
  const delta: Record<Direction, Position> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }
  const movement = delta[direction]
  return {
    x: wrap(head.x + movement.x, state.config.width),
    y: wrap(head.y + movement.y, state.config.height),
  }
}

function movePlayer(player: PlayerState, state: GameState): PlayerState {
  const direction = player.queuedDirections[0] ?? player.direction
  const queuedDirections = player.queuedDirections.length ? player.queuedDirections.slice(1) : player.queuedDirections
  const head = nextHead(player.body[0]!, direction, state)
  return {
    ...player,
    body: [head, ...player.body.slice(0, -1)],
    direction,
    queuedDirections,
  }
}

export function stepGame(state: GameState, playerId: PlayerId, _random: RandomSource): GameState {
  if (state.status !== 'running' || !Object.prototype.hasOwnProperty.call(state.players, playerId)) return state
  const players: Record<PlayerId, PlayerState> = Object.create(null) as Record<PlayerId, PlayerState>
  for (const id of Object.keys(state.players)) {
    const player = state.players[id]!
    players[id] = id === playerId ? movePlayer(player, state) : player
  }
  return { ...state, players: Object.freeze(players) }
}
