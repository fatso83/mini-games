import type { GameConfig, PlayerState, Position, RandomSource } from './types'

export function listFreeCells(config: GameConfig, players: readonly PlayerState[]): Position[] {
  const occupied = new Set(players.flatMap((player) => player.body.map((position) => `${position.x},${position.y}`)))
  const free: Position[] = []
  for (let y = 0; y < config.height; y += 1) {
    for (let x = 0; x < config.width; x += 1) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  return free
}

export function placeFood(config: GameConfig, players: readonly PlayerState[], random: RandomSource): Position | null {
  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('random source must return a value in [0, 1)')
  const free = listFreeCells(config, players)
  if (!free.length) return null
  return free[Math.floor(value * free.length)] ?? null
}
