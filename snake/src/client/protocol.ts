export type ClientCommand = 'join' | 'start' | 'direction'

export interface ServerMessage {
  readonly cmd: string
  readonly seq?: number
  readonly [key: string]: unknown
}

export interface ClientSnapshot {
  readonly [key: string]: unknown
}

export interface ClientProtocolState {
  readonly lastSeq: number
  readonly gap: boolean
  readonly connected: boolean
  readonly phase: 'idle' | 'lobby' | 'countdown' | 'running' | 'ended' | 'error'
  readonly snapshot: ClientSnapshot | null
  readonly roster: readonly Record<string, unknown>[]
  readonly error: string | null
  readonly selfPlayerId: string | null
}

export const initialProtocolState = (): ClientProtocolState => ({ lastSeq: 0, gap: false, connected: false, phase: 'idle', snapshot: null, roster: [], error: null, selfPlayerId: null })

export function reduceServerMessage(state: ClientProtocolState, message: ServerMessage): ClientProtocolState {
  const seq = typeof message.seq === 'number' && Number.isFinite(message.seq) ? message.seq : null
  if (seq !== null && seq < state.lastSeq && message.cmd !== 'snapshot') return state
  if (seq !== null && seq === state.lastSeq && state.snapshot !== null) return state
  const nextSeq = seq === null ? state.lastSeq : seq
  const gap = message.cmd === 'snapshot' ? false : seq !== null && seq > state.lastSeq + 1 ? true : state.gap
  const sessionState = message.state && typeof message.state === 'object' ? message.state as ClientSnapshot : null
  const statusPhase = (value: unknown): ClientProtocolState['phase'] => value === 'countdown' ? 'countdown' : value === 'running' ? 'running' : value === 'results' || value === 'finished' ? 'ended' : 'lobby'
  const nextSnapshot = sessionState ?? (message.snapshot && typeof message.snapshot === 'object' ? message.snapshot as ClientSnapshot : null)
  const nextRoster = sessionState && Array.isArray(sessionState.players) ? sessionState.players as Record<string, unknown>[] : Array.isArray(message.players) ? message.players as Record<string, unknown>[] : state.roster
  const selfPlayerId = typeof message.selfPlayerId === 'string' ? message.selfPlayerId : typeof sessionState?.selfPlayerId === 'string' ? sessionState.selfPlayerId as string : state.selfPlayerId
  if (message.cmd === 'snapshot' || message.cmd === 'diff') {
    return { ...state, lastSeq: nextSeq, gap, snapshot: nextSnapshot ?? state.snapshot, phase: sessionState ? statusPhase(sessionState.status) : state.phase, roster: nextRoster, error: null, selfPlayerId }
  }
  switch (message.cmd) {
    case 'snapshot':
      return state
    case 'lobby':
      return { ...state, lastSeq: nextSeq, gap, phase: 'lobby', roster: Array.isArray(message.players) ? message.players as Record<string, unknown>[] : state.roster, error: null }
    case 'player-joined':
    case 'player-left':
      return { ...state, lastSeq: nextSeq, gap, phase: 'lobby', roster: Array.isArray(message.players) ? message.players as Record<string, unknown>[] : state.roster }
    case 'started': return { ...state, lastSeq: nextSeq, gap, phase: 'running', error: null }
    case 'ended': return { ...state, lastSeq: nextSeq, gap, phase: 'ended' }
    case 'error': return { ...state, lastSeq: nextSeq, gap, phase: 'error', error: String(message.message ?? 'Serverfeil') }
    default: return { ...state, lastSeq: nextSeq, gap }
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && typeof (value as { cmd?: unknown }).cmd === 'string' ? value as ServerMessage : null
  } catch { return null }
}
