import { createGameConfig } from './config'
import { placeFood } from './food'
import type { GameConfig, GameState, PlayerId, PlayerState, RandomSource } from './types'

export interface CreateGameOptions {
  readonly config: GameConfig
  readonly playerIds: readonly PlayerId[]
  readonly random: RandomSource
}

export function createGame(options: CreateGameOptions): GameState {
  if (!options.playerIds.length) throw new Error('playerIds must not be empty')
  if (new Set(options.playerIds).size !== options.playerIds.length) throw new Error('playerIds must be unique')
  const config = createGameConfig(options.config)
  const players: Record<PlayerId, PlayerState> = Object.create(null) as Record<PlayerId, PlayerState>
  for (const id of options.playerIds) {
    players[id] = {
      id,
      body: config.startingBody.map((position) => ({ ...position })),
      direction: config.startingDirection,
      queuedDirections: [],
      score: 0,
    }
  }
  return {
    config,
    players: Object.freeze(players),
    food: placeFood(config, Object.values(players), options.random),
    status: 'ready',
    tickIntervalMs: config.baseTickMs,
  }
}
