import type { Direction, GameConfig, Position } from './types'

export const DEFAULT_GAME_CONFIG: GameConfig = deepFreeze({
  width: 20,
  height: 20,
  startingBody: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
  startingDirection: 'right',
  baseTickMs: 140,
  speedStepMs: 8,
  minTickMs: 60,
  pointsPerFood: 10,
  inputQueueSize: 2,
})

export type GameConfigInput = {
  width: number
  height: number
  startingBody: readonly Position[]
  startingDirection: Direction
  baseTickMs: number
  speedStepMs: number
  minTickMs: number
  pointsPerFood: number
  inputQueueSize: number
}

export function createGameConfig(input: GameConfigInput): GameConfig {
  if (!Number.isInteger(input.width) || input.width < 1) throw new Error('width must be a positive integer')
  if (!Number.isInteger(input.height) || input.height < 1) throw new Error('height must be a positive integer')
  if (!input.startingBody.length) throw new Error('startingBody must not be empty')
  if (input.startingBody.length >= input.width * input.height) throw new Error('startingBody must leave at least one free cell')
  const seen = new Set<string>()
  for (const position of input.startingBody) {
    if (!Number.isInteger(position.x) || !Number.isInteger(position.y)) throw new Error('startingBody positions must use integer coordinates')
    if (position.x < 0 || position.x >= input.width || position.y < 0 || position.y >= input.height) throw new Error('startingBody position is outside the board')
    const key = `${position.x},${position.y}`
    if (seen.has(key)) throw new Error('startingBody must not contain duplicate positions')
    seen.add(key)
  }
  if (!Number.isFinite(input.baseTickMs) || input.baseTickMs < 1) throw new Error('baseTickMs must be positive')
  if (input.baseTickMs < input.minTickMs) throw new Error('baseTickMs must be at least minTickMs')
  if (!Number.isFinite(input.speedStepMs) || input.speedStepMs <= 0) throw new Error('speedStepMs must be positive')
  if (!Number.isFinite(input.minTickMs) || input.minTickMs < 1) throw new Error('minTickMs must be positive')
  if (!Number.isFinite(input.pointsPerFood) || input.pointsPerFood < 1) throw new Error('pointsPerFood must be a finite positive number')
  if (!Number.isInteger(input.inputQueueSize) || input.inputQueueSize < 1) throw new Error('inputQueueSize must be a positive integer')
  return deepFreeze({ ...input, startingBody: input.startingBody.map((position) => ({ ...position })) })
}

function deepFreeze<T extends object>(value: T): T {
  Object.freeze(value)
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child as object)
  }
  return value
}
