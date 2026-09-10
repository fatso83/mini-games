export type PlayerId = string

export type Direction = 'up' | 'down' | 'left' | 'right'

export type RoundStatus = 'ready' | 'running' | 'paused' | 'lost' | 'won'

export interface Position {
  readonly x: number
  readonly y: number
}

export interface PlayerState {
  readonly id: PlayerId
  readonly body: readonly Position[]
  readonly direction: Direction
  readonly queuedDirections: readonly Direction[]
  readonly score: number
}

export interface GameConfig {
  readonly width: number
  readonly height: number
  readonly startingBody: readonly Position[]
  readonly startingDirection: Direction
  readonly baseTickMs: number
  readonly speedStepMs: number
  readonly minTickMs: number
  readonly pointsPerFood: number
  readonly inputQueueSize: number
}

export interface GameState {
  readonly config: GameConfig
  readonly players: Readonly<Record<PlayerId, PlayerState>>
  readonly food: Position | null
  readonly status: RoundStatus
  readonly tickIntervalMs: number
}

export type RandomSource = () => number
