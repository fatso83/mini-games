import type { Direction, Position } from '../game/types'

export const SESSION_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const SESSION_CODE_LENGTH = 6
export type ClientCommand =
  | { readonly cmd: 'join'; readonly name: string }
  | { readonly cmd: 'direction'; readonly direction: Direction }
  | { readonly cmd: 'start' }
  | { readonly cmd: 'restart' }
export interface PublicPlayer { readonly id: string; readonly name: string; readonly status: 'active' | 'out'; readonly connected: boolean; readonly score: number; readonly totalScore: number; readonly body: readonly Position[] }
export interface PublicGameSummary { readonly code: string; readonly hostName: string; readonly playerCount: number; readonly maxPlayers: 4 }
export interface PublicCountdown { readonly step: 3 | 2 | 1 | 0; readonly label: '3' | '2' | '1' | 'Gå'; readonly startedAt: number; readonly endsAt: number }
export interface PublicSession { readonly code: string; readonly isPublic: boolean; readonly status: 'lobby' | 'countdown' | 'running' | 'results' | 'finished'; readonly countdown: PublicCountdown | null; readonly hostId: string | null; readonly winnerId: string | null; readonly level: number; readonly tick: number; readonly config: { readonly width: number; readonly height: number; readonly tickIntervalMs: number }; readonly obstacles: readonly Position[]; readonly players: readonly PublicPlayer[]; readonly food: Position | null }
export interface SnapshotEvent { readonly cmd: 'snapshot'; readonly seq: number; readonly selfPlayerId: string | undefined; readonly state: PublicSession; readonly players: readonly PublicPlayer[] }
export interface DiffEvent { readonly cmd: 'diff'; readonly seq: number; readonly selfPlayerId: string | undefined; readonly state: PublicSession; readonly events?: readonly { readonly cmd: string; readonly [key: string]: unknown }[] }
export type ServerEvent = SnapshotEvent | DiffEvent | { readonly cmd: 'error'; readonly message: string; readonly selfPlayerId: string | undefined }
export function createSessionCode(random: () => number = Math.random): string { let code = ''; for (let i = 0; i < SESSION_CODE_LENGTH; i += 1) code += SESSION_ALPHABET[Math.min(SESSION_ALPHABET.length - 1, Math.floor(random() * SESSION_ALPHABET.length))]!; return code }
export function validDisplayName(value: unknown): string | null { if (typeof value !== 'string') return null; const name = value.trim().normalize('NFC'); const characters = Array.from(name); return characters.length >= 1 && characters.length <= 20 && !/[\p{C}\u2028\u2029]/u.test(name) ? name : null }
export function parseClientCommand(value: string | ArrayBuffer): ClientCommand | null {
  try { const parsed: unknown = JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value)); if (!parsed || typeof parsed !== 'object' || !('cmd' in parsed)) return null; const candidate = parsed as { cmd?: unknown; name?: unknown; direction?: unknown }; if (candidate.cmd === 'join' && typeof candidate.name === 'string') return { cmd: 'join', name: candidate.name }; if (candidate.cmd === 'start') return { cmd: 'start' }; if (candidate.cmd === 'restart') return { cmd: 'restart' }; if (candidate.cmd === 'direction' && (candidate.direction === 'up' || candidate.direction === 'down' || candidate.direction === 'left' || candidate.direction === 'right')) return { cmd: 'direction', direction: candidate.direction }; } catch { /* malformed */ } return null
}
