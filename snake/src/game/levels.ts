import type { Position } from './types'

export interface LevelDefinition {
  readonly id: number
  readonly width: 20
  readonly height: 20
  readonly tickIntervalMs: number
  readonly obstacles: readonly Position[]
}

const cells = (predicate: (x: number, y: number) => boolean): readonly Position[] => {
  const result: Position[] = []
  for (let y = 0; y < 20; y += 1) for (let x = 0; x < 20; x += 1) if (predicate(x, y)) result.push({ x, y })
  return result
}

export const LEVELS: readonly LevelDefinition[] = Object.freeze([
  { id: 1, width: 20, height: 20, tickIntervalMs: 140, obstacles: Object.freeze([]) },
  { id: 2, width: 20, height: 20, tickIntervalMs: 120, obstacles: Object.freeze(cells((x, y) => (x === 9 || x === 10) && y >= 6 && y <= 13)) },
  { id: 3, width: 20, height: 20, tickIntervalMs: 100, obstacles: Object.freeze(cells((x, y) => (y === 9 || y === 10) && x >= 5 && x <= 14 || (x === 9 || x === 10) && y >= 5 && y <= 14)) },
  { id: 4, width: 20, height: 20, tickIntervalMs: 80, obstacles: Object.freeze(cells((x, y) => (x === 9 || x === 10) && (y >= 2 && y <= 7 || y >= 12 && y <= 17) || (y === 9 || y === 10) && (x >= 2 && x <= 7 || x >= 12 && x <= 17))) },
])

export const LEVEL_DEFINITIONS = LEVELS

export const CORNER_SPAWNS = Object.freeze([
  { body: Object.freeze([{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }]), direction: 'right' as const },
  { body: Object.freeze([{ x: 17, y: 2 }, { x: 18, y: 2 }, { x: 19, y: 2 }]), direction: 'left' as const },
  { body: Object.freeze([{ x: 17, y: 17 }, { x: 18, y: 17 }, { x: 19, y: 17 }]), direction: 'left' as const },
  { body: Object.freeze([{ x: 2, y: 17 }, { x: 1, y: 17 }, { x: 0, y: 17 }]), direction: 'right' as const },
])
export const SPAWN_LAYOUTS = CORNER_SPAWNS
export const CORNER_SPAWN_LAYOUTS = CORNER_SPAWNS
