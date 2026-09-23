import { LEVELS, CORNER_SPAWNS } from './game/levels'
import { resolveMultiplayerTick, type MultiplayerPlayer } from './game/multiplayer-core'
import type { Direction, Position } from './game/types'
import { SESSION_ALPHABET, createSessionCode, parseClientCommand, validDisplayName, type ClientCommand, type PublicCountdown, type PublicGameSummary, type PublicPlayer, type PublicSession, type ServerEvent } from './server/protocol'
import { validateServerUrl } from './server/launcher'

interface StorageLike { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>; deleteAll(): Promise<void>; setAlarm(time: number): Promise<void> }
interface DurableObjectStateLike { readonly storage: StorageLike; acceptWebSocket(socket: WebSocket): void; getWebSockets(): WebSocket[] }
interface DurableObjectNamespaceLike { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
interface FetcherLike { fetch(request: Request): Promise<Response> }
export interface Env { readonly ASSETS: FetcherLike; readonly GAME_ROOMS: DurableObjectNamespaceLike; readonly PUBLIC_GAMES?: DurableObjectNamespaceLike; readonly SERVER_URL?: string }
type RoomStatus = PublicSession['status']
interface RoomPlayer extends Omit<MultiplayerPlayer, 'status'> { readonly status: 'active' | 'lost' | 'out'; readonly displayName: string; readonly connected: boolean; readonly totalScore: number }
interface RoomState { code: string; isPublic: boolean; status: RoomStatus; countdown: PublicCountdown | null; hostId: string | null; level: number; tick: number; seq: number; food: Position | null; players: RoomPlayer[]; createdAt: number; resultsAt: number | null; winnerId: string | null }
interface RegistryState { entries: Record<string, PublicGameSummary & { updatedAt: number }> }

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y
declare class WebSocketPair { readonly 0: WebSocket; readonly 1: WebSocket }

export class PublicGameRegistry {
  private readonly state: DurableObjectStateLike
  constructor(state: DurableObjectStateLike, _env: Env) { this.state = state }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    const current = await this.state.storage.get<RegistryState>('registry') ?? { entries: {} }
    const now = Date.now()
    for (const [code, entry] of Object.entries(current.entries)) if (now - entry.updatedAt > 180_000) delete current.entries[code]
    if (path === '/register' && request.method === 'POST') {
      const value = await request.json() as Partial<PublicGameSummary>
      if (typeof value.code !== 'string' || typeof value.hostName !== 'string' || value.playerCount !== 1 && value.playerCount !== 2 && value.playerCount !== 3 && value.playerCount !== 4) return new Response('invalid summary', { status: 400 })
      current.entries[value.code] = { code: value.code, hostName: value.hostName, playerCount: value.playerCount, maxPlayers: 4, updatedAt: now }; await this.state.storage.put('registry', current); return new Response('ok')
    }
    if (path === '/unregister' && request.method === 'POST') { const value = await request.json() as { code?: unknown }; if (typeof value.code === 'string') delete current.entries[value.code]; await this.state.storage.put('registry', current); return new Response('ok') }
    if (path === '/list' && request.method === 'GET') { await this.state.storage.put('registry', current); return json(Object.values(current.entries).map(({ updatedAt: _updatedAt, ...entry }) => entry)) }
    return new Response('Not found', { status: 404 })
  }
}

export class GameRoom {
  private readonly state: DurableObjectStateLike
  private readonly env: Env
  private room: RoomState | null = null

  constructor(state: DurableObjectStateLike, env: Env) { this.state = state; this.env = env }

  async fetch(request: Request): Promise<Response> {
    await this.load()
    if (new URL(request.url).pathname === '/init') { if (this.room!.code) return new Response('already exists', { status: 409 }); const initUrl = new URL(request.url); this.room!.code = initUrl.searchParams.get('code') ?? ''; this.room!.isPublic = initUrl.searchParams.get('isPublic') === 'true'; await this.save(); await this.state.storage.setAlarm(Date.now() + 180_000); return new Response('ok') }
    if (!this.room!.code) return new Response('session does not exist', { status: 404 })
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
    const pair = new WebSocketPair()
    this.state.acceptWebSocket(pair[1]!)
    this.setAttachment(pair[1]!, { playerId: null })
    this.send(pair[1]!, { cmd: 'snapshot', seq: this.room!.seq, selfPlayerId: undefined, state: this.publicState(), players: this.publicState().players })
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit & { webSocket: WebSocket })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.load()
    const command = parseClientCommand(message)
    if (!command) return this.error(socket, 'invalid command')
    const attachment = this.getAttachment(socket)
    if (command.cmd === 'join') return this.join(socket, command, attachment?.playerId ?? null)
    if (!attachment?.playerId) return this.error(socket, 'join first')
    if (command.cmd === 'direction') return this.direction(attachment.playerId, command.direction)
    if (command.cmd === 'start') return this.start(socket, attachment.playerId)
    if (command.cmd === 'restart') return this.restart(socket, attachment.playerId)
  }

  async webSocketClose(socket: WebSocket): Promise<void> { await this.disconnect(socket); await this.scheduleFinishedCleanup() }
  async webSocketError(socket: WebSocket): Promise<void> { await this.disconnect(socket); await this.scheduleFinishedCleanup() }

  private async scheduleFinishedCleanup(): Promise<void> { await this.load(); if (this.room!.status === 'finished' && this.room!.players.every((player) => !player.connected)) await this.state.storage.setAlarm(Date.now() + 180_000) }

  async alarm(): Promise<void> {
    await this.load(); const room = this.room!
    const now = Date.now()
    if (room.status === 'results' && room.players.every((player) => !player.connected)) room.hostId = null
    if (room.status === 'lobby' && room.players.length === 0) { if (now - room.createdAt >= 180_000) { await this.state.storage.deleteAll(); this.room = null; return } await this.state.storage.setAlarm(room.createdAt + 180_000); return }
    if (room.status === 'finished' && room.resultsAt !== null) { if (room.players.some((player) => player.connected)) { await this.state.storage.setAlarm(now + 180_000); return } if (now - room.resultsAt >= 180_000) { await this.unregister(); await this.state.storage.deleteAll(); this.room = null; return } await this.state.storage.setAlarm(room.resultsAt + 180_000); return }
    if (room.status === 'countdown') return this.advanceCountdown(now)
    if (room.status === 'running') { const events = this.tick(); room.seq += 1; await this.save(); this.broadcast({ cmd: 'diff', seq: room.seq, selfPlayerId: undefined, state: this.publicState(), events }); if (room.status === 'running') await this.state.storage.setAlarm(Date.now() + LEVELS[room.level - 1]!.tickIntervalMs); else await this.state.storage.setAlarm(Date.now() + 2_000); return }
    if (room.status === 'results' && room.resultsAt !== null) { if (now < room.resultsAt + 2_000) { await this.state.storage.setAlarm(room.resultsAt + 2_000); return } room.players = room.players.filter((player) => player.connected); if (room.players.length === 0) { room.status = 'lobby'; room.countdown = null; room.resultsAt = null; room.winnerId = null; await this.state.storage.setAlarm(now + 180_000) } else if (room.level >= LEVELS.length && room.winnerId) { room.status = 'finished'; room.resultsAt = now; room.countdown = null; await this.state.storage.setAlarm(now + 180_000); } else { room.level += room.winnerId ? 1 : 0; room.tick = 0; room.hostId = room.players[0]?.id ?? null; room.players = room.players.map((player, index) => { const spawn = CORNER_SPAWNS[index]!; return { ...player, body: spawn.body.map((position) => ({ ...position })), direction: spawn.direction, queuedDirections: [], score: 0, status: 'active', connected: player.connected } }); const level = LEVELS[room.level - 1]!; const occupied = new Set(room.players.flatMap((player) => player.body.map((position) => `${position.x},${position.y}`))); room.food = null; for (let y = 0; y < level.height && room.food === null; y += 1) for (let x = 0; x < level.width; x += 1) if (!occupied.has(`${x},${y}`) && !level.obstacles.some((position) => position.x === x && position.y === y)) { room.food = { x, y }; break } room.resultsAt = null; room.winnerId = null; this.beginCountdown(now); await this.state.storage.setAlarm(now + 1_000) } room.seq += 1; await this.save(); await this.syncRegistry(); this.broadcast({ cmd: 'diff', seq: room.seq, selfPlayerId: undefined, state: this.publicState() }); }
  }

  private async load(): Promise<void> { if (this.room) return; const stored = await this.state.storage.get<RoomState>('room'); this.room = stored ? { ...stored, isPublic: stored.isPublic ?? false, countdown: stored.countdown ?? null, players: stored.players.map((player) => ({ ...player, totalScore: player.totalScore ?? player.score })) } : { code: '', isPublic: false, status: 'lobby', countdown: null, hostId: null, level: 1, tick: 0, seq: 0, food: null, players: [], createdAt: Date.now(), resultsAt: null, winnerId: null } }
  private async save(): Promise<void> { await this.state.storage.put('room', this.room!) }
  private publicState(): PublicSession { const room = this.room!; const level = LEVELS[room.level - 1]!; return { code: room.code, isPublic: room.isPublic, status: room.status, countdown: room.countdown, hostId: room.hostId, winnerId: room.winnerId, level: room.level, tick: room.tick, config: { width: level.width, height: level.height, tickIntervalMs: level.tickIntervalMs }, obstacles: level.obstacles, food: room.food, players: room.players.map((player): PublicPlayer => ({ id: player.id, name: player.displayName, status: player.status === 'active' ? 'active' : 'out', connected: player.connected, score: player.score, totalScore: player.totalScore, body: player.body })) } }
  private send(socket: WebSocket, event: ServerEvent): void { try { socket.send(JSON.stringify(event)) } catch { /* closed */ } }
  private error(socket: WebSocket, message: string): void { this.send(socket, { cmd: 'error', message, selfPlayerId: undefined }) }
  private broadcast(event: ServerEvent): void { for (const socket of this.state.getWebSockets()) { const playerId = this.getAttachment(socket)?.playerId ?? undefined; this.send(socket, { ...event, selfPlayerId: playerId }) as never } }
  private async update(): Promise<void> { this.room!.seq += 1; await this.save(); await this.syncRegistry(); this.broadcast({ cmd: 'diff', seq: this.room!.seq, selfPlayerId: undefined, state: this.publicState() }) }
  private async unregister(): Promise<void> { const namespace = this.env.PUBLIC_GAMES; if (!namespace || !this.room?.code) return; await namespace.get(namespace.idFromName('public')).fetch(new Request('https://registry.internal/unregister', { method: 'POST', body: JSON.stringify({ code: this.room.code }) })) }
  private async syncRegistry(): Promise<void> { const namespace = this.env.PUBLIC_GAMES; const room = this.room; if (!namespace || !room?.code) return; const target = namespace.get(namespace.idFromName('public')); if (room.isPublic && room.status === 'lobby' && room.players.length > 0) { const host = room.players.find((player) => player.id === room.hostId) ?? room.players[0]!; await target.fetch(new Request('https://registry.internal/register', { method: 'POST', body: JSON.stringify({ code: room.code, hostName: host.displayName, playerCount: room.players.length, maxPlayers: 4 }) })); } else await this.unregister() }

  private async join(socket: WebSocket, command: Extract<ClientCommand, { cmd: 'join' }>, existingId: string | null): Promise<void> {
    const room = this.room!; const name = validDisplayName(command.name)
    if (!name) return this.error(socket, 'display name must be 1-20 characters, on a single line, without control characters')
    if (room.status !== 'lobby') return this.error(socket, 'game has already started')
    let player = existingId ? room.players.find((candidate) => candidate.id === existingId) : undefined
    if (!player && room.players.length >= 4) return this.error(socket, 'session is full')
    if (room.players.some((candidate) => candidate.id !== player?.id && candidate.displayName.toLowerCase() === name.toLowerCase())) return this.error(socket, 'display name is already in use')
    if (!player) { const spawn = CORNER_SPAWNS[room.players.length]!; player = { id: crypto.randomUUID(), displayName: name, body: spawn.body.map((position) => ({ ...position })), direction: spawn.direction, queuedDirections: [], score: 0, totalScore: 0, status: 'active', connected: true }; room.players.push(player) }
    else Object.assign(player, { displayName: name, connected: true, status: 'active' })
    if (!room.hostId) room.hostId = player.id
    this.setAttachment(socket, { playerId: player.id })
    if (room.players.length === 1) room.food = { x: 9, y: 9 }
    await this.update()
  }

  private async direction(playerId: string, direction: Direction): Promise<void> { const player = this.room!.players.find((candidate) => candidate.id === playerId); if (!player || this.room!.status !== 'running' || player.status !== 'active') return; const last = player.queuedDirections[player.queuedDirections.length - 1] ?? player.direction; const opposites: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' }; if (opposites[last] !== direction && player.queuedDirections.length < 3) (player.queuedDirections as Direction[]).push(direction); await this.update() }
  private beginCountdown(now: number): void { const room = this.room!; room.status = 'countdown'; room.countdown = { step: 3, label: '3', startedAt: now, endsAt: now + 1_000 }; room.tick = 0 }
  private async advanceCountdown(now: number): Promise<void> { const room = this.room!; const countdown = room.countdown; if (!countdown) { room.status = 'lobby'; room.seq += 1; await this.save(); this.broadcast({ cmd: 'diff', seq: room.seq, selfPlayerId: undefined, state: this.publicState() }); if (room.players.length === 0) await this.state.storage.setAlarm(room.createdAt + 180_000); return } const initialStartedAt = countdown.startedAt - (3 - countdown.step) * 1_000; const elapsed = now - initialStartedAt; const boundary = initialStartedAt + 1_000; if (elapsed < 1_000) { await this.state.storage.setAlarm(boundary); return } if (elapsed < 4_000) { const step = (3 - Math.floor(elapsed / 1_000)) as 2 | 1 | 0; const label = step === 0 ? 'Gå' : String(step) as '1' | '2'; const startedAt = initialStartedAt + (3 - step) * 1_000; room.countdown = { ...countdown, step, label, startedAt, endsAt: startedAt + 1_000 }; room.seq += 1; await this.save(); this.broadcast({ cmd: 'diff', seq: room.seq, selfPlayerId: undefined, state: this.publicState() }); await this.state.storage.setAlarm(room.countdown.endsAt); return } room.status = 'running'; room.countdown = null; room.seq += 1; await this.save(); this.broadcast({ cmd: 'diff', seq: room.seq, selfPlayerId: undefined, state: this.publicState() }); await this.state.storage.setAlarm(now + LEVELS[room.level - 1]!.tickIntervalMs) }
  private async start(socket: WebSocket, playerId: string): Promise<void> { const room = this.room!; if (room.status !== 'lobby') return this.error(socket, 'game has already started'); if (room.hostId !== playerId) return this.error(socket, 'only the host can start the game'); if (room.players.length < 1) return this.error(socket, 'join the session first'); this.beginCountdown(Date.now()); await this.update(); await this.state.storage.setAlarm(this.room!.countdown!.endsAt) }
  private async restart(socket: WebSocket, playerId: string): Promise<void> { const room = this.room!; if (room.status !== 'finished') return this.error(socket, 'game has already started'); if (room.hostId !== playerId) return this.error(socket, 'only the host can restart the game'); room.status = 'lobby'; room.level = 1; room.tick = 0; room.countdown = null; room.resultsAt = null; room.winnerId = null; room.hostId = room.players.find((player) => player.connected && player.id === playerId)?.id ?? room.players.find((player) => player.connected)?.id ?? null; room.players = room.players.filter((player) => player.connected).map((player, index) => { const spawn = CORNER_SPAWNS[index]!; return { ...player, body: spawn.body.map((position) => ({ ...position })), direction: spawn.direction, queuedDirections: [], score: 0, totalScore: 0, status: 'active', connected: true } }); const level = LEVELS[0]!; const occupied = new Set(room.players.flatMap((player) => player.body.map((position) => `${position.x},${position.y}`))); room.food = null; for (let y = 0; y < level.height && room.food === null; y += 1) for (let x = 0; x < level.width; x += 1) if (!occupied.has(`${x},${y}`) && !level.obstacles.some((position) => position.x === x && position.y === y)) { room.food = { x, y }; break } await this.update() }
  private tick(): readonly { readonly cmd: string; readonly [key: string]: unknown }[] { const room = this.room!; const level = LEVELS[room.level - 1]!; const corePlayers = room.players.map(({ displayName: _name, connected: _connected, ...player }) => ({ ...player, status: player.status === 'active' ? 'active' as const : 'lost' as const })); const result = resolveMultiplayerTick({ width: level.width, height: level.height, players: corePlayers, food: room.food, obstacles: level.obstacles, random: Math.random }); const events: { cmd: string; [key: string]: unknown }[] = result.events.map((event) => event.type === 'player-ate' ? { cmd: 'food_spawned', playerId: event.playerId, position: event.position } : event.type === 'player-lost' ? { cmd: 'snake_lost', playerId: event.playerId, reason: event.reason } : { cmd: 'snake_lost', playerIds: event.playerIds, position: event.position }); room.players = result.players.map((player) => { const prior = room.players.find((candidate) => candidate.id === player.id)!; return { ...player, displayName: prior.displayName, connected: prior.connected, totalScore: prior.totalScore + (player.score - prior.score) } }); room.food = result.food; room.tick += 1; for (const player of room.players) { const moved = result.players.find((candidate) => candidate.id === player.id); if (moved && moved.status === 'active') events.push({ cmd: 'snake_moved', playerId: player.id, body: moved.body, direction: moved.direction, score: moved.score }) } const active = room.players.filter((player) => player.status === 'active'); if ((room.players.length > 1 && active.length <= 1) || (room.players.length === 1 && active.length === 0)) { room.status = 'results'; room.resultsAt = Date.now(); room.winnerId = active[0]?.id ?? null; events.push({ cmd: 'round_finished', winnerId: room.winnerId }) } return events }
  private setAttachment(socket: WebSocket, attachment: { playerId: string | null }): void { (socket as WebSocket & { serializeAttachment(value: unknown): void }).serializeAttachment(attachment) }
  private getAttachment(socket: WebSocket): { playerId: string | null } | null { return (socket as WebSocket & { deserializeAttachment(): unknown }).deserializeAttachment() as { playerId: string | null } | null }
  private async disconnect(socket: WebSocket): Promise<void> { await this.load(); const playerId = this.getAttachment(socket)?.playerId; if (!playerId) return; const room = this.room!; const index = room.players.findIndex((player) => player.id === playerId); if (index < 0) return; if (room.status === 'lobby') room.players.splice(index, 1); else room.players[index] = { ...room.players[index]!, connected: false, status: 'out' }; if (room.hostId === playerId) room.hostId = room.players.find((player) => player.connected && player.status === 'active')?.id ?? room.players.find((player) => player.connected)?.id ?? null; await this.update(); if (room.status === 'lobby' && room.players.length === 0) await this.state.storage.setAlarm(Date.now() + 180_000) }
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const configured = env.SERVER_URL ? validateServerUrl(env.SERVER_URL) : null
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url.origin)
  const effectiveBase = configured ?? (env.SERVER_URL === undefined && !localOrigin ? url.origin : null)
  if (!effectiveBase) { console.error('Invalid SERVER_URL configuration; set an absolute http(s) origin without path, query, or hash.'); return new Response('<h1>Server configuration error</h1><p>Set SERVER_URL to an absolute HTTP(S) origin.</p>', { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } }) }
  if (url.pathname === '/api/public-games' && request.method === 'GET') { if (!env.PUBLIC_GAMES) return json({ games: [] }); const response = await env.PUBLIC_GAMES.get(env.PUBLIC_GAMES.idFromName('public')).fetch(new Request('https://registry.internal/list')); return json({ games: await response.json() }) }
  if (url.pathname === '/api/sessions' && request.method === 'POST') {
    let isPublic = false; try { const body = await request.json() as { isPublic?: unknown }; isPublic = body.isPublic === true } catch { /* optional body */ }
    let code = ''; for (let attempt = 0; attempt < 10 && !code; attempt += 1) { const candidate = createSessionCode(); const id = env.GAME_ROOMS.idFromName(candidate); const response = await env.GAME_ROOMS.get(id).fetch(new Request(`https://room.internal/init?code=${candidate}&isPublic=${isPublic}`, { method: 'GET' })); if (response.ok) code = candidate }
    if (!code) return json({ error: 'could not allocate session' }, 503)
    return json({ code, isPublic, socket: `/api/sessions/${code}/socket`, shareUrlBase: effectiveBase }, 201)
  }
  const match = url.pathname.match(/^\/api\/sessions\/([0-9A-Z]{6})\/socket$/i)
  const code = match?.[1]?.toUpperCase()
  if (code && [...code].every((character) => SESSION_ALPHABET.includes(character)) && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code)).fetch(request)
  if (request.method === 'GET') { const asset = await env.ASSETS.fetch(request); if (asset.status !== 404) return asset; return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request)) }
  return new Response('Not found', { status: 404 })
} }
