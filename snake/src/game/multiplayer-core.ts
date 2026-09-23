import type { Direction, PlayerId, Position, RandomSource } from './types'

export type MultiplayerStatus = 'active' | 'lost'
export interface MultiplayerPlayer {
  readonly id: PlayerId
  readonly body: readonly Position[]
  readonly direction: Direction
  readonly queuedDirections: readonly Direction[]
  readonly score: number
  readonly status: MultiplayerStatus
}
export type MultiplayerEvent =
  | { readonly type: 'players-collided'; readonly playerIds: readonly PlayerId[]; readonly position: Position }
  | { readonly type: 'player-lost'; readonly playerId: PlayerId; readonly reason: 'obstacle' | 'body' | 'head-on' }
  | { readonly type: 'player-ate'; readonly playerId: PlayerId; readonly position: Position }
export interface MultiplayerTickInput {
  readonly width: number
  readonly height: number
  readonly players: readonly MultiplayerPlayer[]
  readonly food: Position | null
  readonly obstacles: readonly Position[]
  readonly random: RandomSource
  readonly pointsPerFood?: number
}
export interface MultiplayerTickResult {
  readonly players: readonly MultiplayerPlayer[]
  readonly food: Position | null
  readonly events: readonly MultiplayerEvent[]
}

const key = (p: Position): string => `${p.x},${p.y}`
const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y
const opposite: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' }
const delta: Record<Direction, Position> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }
const wrap = (value: number, limit: number): number => ((value % limit) + limit) % limit

export function resolveMultiplayerTick(input: MultiplayerTickInput): MultiplayerTickResult {
  const active = input.players.filter((player) => player.status === 'active')
  const proposed = new Map<PlayerId, { player: MultiplayerPlayer; head: Position; ate: boolean; direction: Direction }>()
  for (const player of active) {
    const requested = player.queuedDirections[0]
    const direction = requested && requested !== opposite[player.direction] ? requested : player.direction
    const d = delta[direction]
    const head = { x: wrap(player.body[0]!.x + d.x, input.width), y: wrap(player.body[0]!.y + d.y, input.height) }
    proposed.set(player.id, { player, head, direction, ate: input.food !== null && same(head, input.food) })
  }
  const events: MultiplayerEvent[] = []
  const lost = new Set<PlayerId>()
  const heads = new Map<string, PlayerId[]>()
  for (const [id, move] of proposed) heads.set(key(move.head), [...(heads.get(key(move.head)) ?? []), id])
  for (const ids of heads.values()) if (ids.length > 1) {
    const position = proposed.get(ids[0]!)!.head
    ids.forEach((id) => lost.add(id))
    events.push({ type: 'players-collided', playerIds: ids, position })
  }
  const proposedEntries = [...proposed.entries()]
  for (let i = 0; i < proposedEntries.length; i += 1) for (let j = i + 1; j < proposedEntries.length; j += 1) {
    const [aId, a] = proposedEntries[i]!
    const [bId, b] = proposedEntries[j]!
    if (same(a.head, b.player.body[0]!) && same(b.head, a.player.body[0]!)) { lost.add(aId); lost.add(bId); events.push({ type: 'players-collided', playerIds: [aId, bId], position: a.head }) }
  }
  for (const [id, move] of proposed) {
    if (input.obstacles.some((position) => same(position, move.head))) { lost.add(id); events.push({ type: 'player-lost', playerId: id, reason: 'obstacle' }) }
  }
  for (const [id, move] of proposed) {
    if (lost.has(id)) continue
    const obstacle = input.obstacles.some((position) => same(position, move.head))
    if (obstacle) continue
    const bodyCollision = active.some((other) => {
      if (other.id === id) return other.body.slice(move.ate ? 0 : 1, move.ate ? undefined : -1).some((position) => same(position, move.head))
      const otherMove = proposed.get(other.id)!
      const tailVacates = !lost.has(other.id) && !otherMove.ate && same(other.body[other.body.length - 1]!, move.head)
      return !tailVacates && other.body.some((position) => same(position, move.head))
    })
    if (bodyCollision) { lost.add(id); events.push({ type: 'player-lost', playerId: id, reason: 'body' }) }
  }
  const points = input.pointsPerFood ?? 10
  const resultPlayers = input.players.map((player) => {
    const move = proposed.get(player.id)
    if (!move || lost.has(player.id)) return lost.has(player.id) ? { ...player, status: 'lost' as const } : player
    const queuedDirections = player.queuedDirections.length ? player.queuedDirections.slice(1) : player.queuedDirections
    const body = move.ate ? [move.head, ...player.body] : [move.head, ...player.body.slice(0, -1)]
    if (move.ate) events.push({ type: 'player-ate', playerId: player.id, position: move.head })
    return { ...player, body, direction: move.direction, queuedDirections, score: player.score + (move.ate ? points : 0), status: 'active' as const }
  })
  let food = input.food
  if (resultPlayers.some((player) => player.status === 'active' && player.body.some((position) => same(position, input.food ?? { x: -1, y: -1 })))) {
    const occupied = new Set(resultPlayers.filter((player) => player.status === 'active').flatMap((player) => player.body.map(key)))
    const blocked = new Set(input.obstacles.map(key))
    const free: Position[] = []
    for (let y = 0; y < input.height; y += 1) for (let x = 0; x < input.width; x += 1) if (!occupied.has(`${x},${y}`) && !blocked.has(`${x},${y}`)) free.push({ x, y })
    food = free.length ? free[Math.floor(input.random() * free.length)]! : null
  }
  return { players: resultPlayers, food, events }
}

export const resolveSimultaneousTick = resolveMultiplayerTick
