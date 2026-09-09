import type { Direction, GameState, PlayerId, PlayerState, Position, RandomSource } from './types'
import { placeFood } from './food'

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

type MoveResult = { player: PlayerState; ate: boolean; collision: boolean }

function movePlayer(player: PlayerState, state: GameState): MoveResult {
  const direction = player.queuedDirections[0] ?? player.direction
  const queuedDirections = player.queuedDirections.length ? player.queuedDirections.slice(1) : player.queuedDirections
  const head = nextHead(player.body[0]!, direction, state)
  const ate = state.food !== null && state.food.x === head.x && state.food.y === head.y
  const body = ate ? [head, ...player.body] : [head, ...player.body.slice(0, -1)]
  const collision = body.slice(1).some((position) => position.x === head.x && position.y === head.y)
  return { player: {
    ...player,
    body,
    direction,
    queuedDirections,
    score: ate ? player.score + state.config.pointsPerFood : player.score,
  }, ate, collision }
}

export function stepGame(state: GameState, playerId: PlayerId, random: RandomSource): GameState {
  if (state.status !== 'running' || !Object.prototype.hasOwnProperty.call(state.players, playerId)) return state
  const players: Record<PlayerId, PlayerState> = Object.create(null) as Record<PlayerId, PlayerState>
  let moved: MoveResult | undefined
  for (const id of Object.keys(state.players)) {
    const player = state.players[id]!
    if (id === playerId) {
      moved = movePlayer(player, state)
      players[id] = moved.player
    } else players[id] = player
  }
  if (!moved) return state
  if (moved.collision) return { ...state, players: Object.freeze(players), status: 'lost' }
  if (!moved.ate) return { ...state, players: Object.freeze(players) }
  const food = placeFood(state.config, Object.values(players), random)
  const tickIntervalMs = Math.max(state.config.minTickMs, state.tickIntervalMs - state.config.speedStepMs)
  return {
    ...state,
    players: Object.freeze(players),
    food,
    status: food === null ? 'won' : 'running',
    tickIntervalMs,
  }
}
