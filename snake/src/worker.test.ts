import { describe, expect, it, vi } from 'vitest'
import worker, { GameRoom, PublicGameRegistry } from './worker'

class MemoryStorage {
  private values = new Map<string, unknown>()
  alarm: number | null = null
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined }
  async put(key: string, value: unknown): Promise<void> { this.values.set(key, value) }
  async deleteAll(): Promise<void> { this.values.clear() }
  async setAlarm(value: number): Promise<void> { this.alarm = value }
}

class FakeNamespace {
  readonly rooms = new Map<string, GameRoom>()
  readonly storages = new Map<string, MemoryStorage>()
  idFromName(name: string): string { return name }
  get(id: string): { fetch: (request: Request) => Promise<Response> } {
    let room = this.rooms.get(id)
    if (!room) { const storage = new MemoryStorage(); this.storages.set(id, storage); room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never); this.rooms.set(id, room) }
    return room
  }
}

class FakeRegistry {
  summaries: unknown[] = []
  requests: string[] = []
  async fetch(request: Request): Promise<Response> {
    this.requests.push(new URL(request.url).pathname)
    if (new URL(request.url).pathname === '/list') return new Response(JSON.stringify(this.summaries), { headers: { 'content-type': 'application/json' } })
    return new Response('ok')
  }
}

describe('Worker session boundary', () => {
  it('creates a session and rejects a websocket for a nonexistent room', async () => {
    const namespace = new FakeNamespace()
    const env = { ASSETS: { fetch: async () => new Response('<!doctype html>') }, GAME_ROOMS: namespace }
    const created = await worker.fetch(new Request('https://snake.test/api/sessions', { method: 'POST' }), env)
    expect(created.status).toBe(201)
    const body = await created.json() as { code: string }
    expect(body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/)
    const missing = await worker.fetch(new Request('https://snake.test/api/sessions/ZZZZZZ/socket', { headers: { Upgrade: 'websocket' } }), env)
    expect(missing.status).toBe(404)
  })

  it('accepts and returns the public session flag and lists public games', async () => {
    const namespace = new FakeNamespace(); const registry = new FakeRegistry()
    const env = { ASSETS: { fetch: async () => new Response('<!doctype html>') }, GAME_ROOMS: namespace, PUBLIC_GAMES: { idFromName: () => 'public', get: () => registry } }
    const created = await worker.fetch(new Request('https://snake.test/api/sessions', { method: 'POST', body: JSON.stringify({ isPublic: true }), headers: { 'content-type': 'application/json' } }), env)
    expect(await created.json()).toMatchObject({ isPublic: true })
    registry.summaries = [{ code: 'ABC234', hostName: 'Alice', playerCount: 1, maxPlayers: 4 }]
    const listed = await worker.fetch(new Request('https://snake.test/api/public-games'), env)
    expect(await listed.json()).toEqual({ games: registry.summaries })
    expect(registry.requests).toContain('/list')
  })

  it('registry returns only recent summaries and removes stale entries', async () => {
    const storage = new MemoryStorage(); const registry = new PublicGameRegistry({ storage } as never, {} as never)
    await registry.fetch(new Request('https://registry.test/register', { method: 'POST', body: JSON.stringify({ code: 'ABC234', hostName: 'Alice', playerCount: 1, maxPlayers: 4, revision: 1 }) }))
    expect(await (await registry.fetch(new Request('https://registry.test/list'))).json()).toEqual([{ code: 'ABC234', hostName: 'Alice', playerCount: 1, maxPlayers: 4 }])
  })

  it('does not revive a lobby when a delayed registration follows its removal', async () => {
    const storage = new MemoryStorage(); const registry = new PublicGameRegistry({ storage } as never, {} as never)
    const register = (revision: number): Request => new Request('https://registry.test/register', { method: 'POST', body: JSON.stringify({ code: 'ABC234', hostName: 'Oskar', playerCount: 1, maxPlayers: 4, revision }) })
    await registry.fetch(register(1))
    await registry.fetch(new Request('https://registry.test/unregister', { method: 'POST', body: JSON.stringify({ code: 'ABC234', revision: 2 }) }))
    await registry.fetch(register(1))
    expect(await (await registry.fetch(new Request('https://registry.test/list'))).json()).toEqual([])
  })

  it('uses configured share origins and rejects invalid local configuration', async () => {
    const namespace = new FakeNamespace(); const assets = { fetch: async () => new Response('<!doctype html>') }
    const configured = await worker.fetch(new Request('https://snake.test/api/sessions', { method: 'POST' }), { ASSETS: assets, GAME_ROOMS: namespace, SERVER_URL: 'https://share.example.test' })
    expect((await configured.json() as { shareUrlBase: string }).shareUrlBase).toBe('https://share.example.test')
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const invalid = await worker.fetch(new Request('http://localhost:5173/'), { ASSETS: assets, GAME_ROOMS: namespace, SERVER_URL: 'not-an-origin' })
    expect(invalid.status).toBe(500); expect(await invalid.text()).toContain('configuration error')
    expect(diagnostic).toHaveBeenCalled(); diagnostic.mockRestore()
  })

  it('initializes a room and schedules lobby expiry', async () => {
    const namespace = new FakeNamespace()
    const room = namespace.get('ABC234') as GameRoom
    const initialized = await room.fetch(new Request('https://room.test/init?code=ABC234'))
    expect(initialized.status).toBe(200)
    expect(namespace.storages.get('ABC234')!.alarm).toBeTypeOf('number')
  })

  it('joins players, transfers host, and rejects late joiners', async () => {
    const storage = new MemoryStorage(); const sockets: FakeSocket[] = []
    const state = { storage, acceptWebSocket: (socket: WebSocket) => sockets.push(socket as unknown as FakeSocket), getWebSockets: () => sockets as unknown as WebSocket[] }
    const room = new GameRoom(state, {} as never)
    await room.fetch(new Request('https://room.test/init?code=ABC234'))
    const first = new FakeSocket(); const second = new FakeSocket(); sockets.push(first, second)
    await room.webSocketMessage(first as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'Alice' }))
    await room.webSocketMessage(second as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'alice' }))
    expect(second.sent.some(message => message.includes('display name'))).toBe(true)
    await room.webSocketMessage(first as unknown as WebSocket, JSON.stringify({ cmd: 'start' }))
    expect(first.sent.some(message => message.includes('"cmd":"diff"'))).toBe(true)
    await room.webSocketClose(first as unknown as WebSocket)
    expect(second.sent.at(-1)).toContain('hostId')
  })

  it('starts a four-second countdown before running and advances it safely', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    try {
      const storage = new MemoryStorage(); const sockets: FakeSocket[] = []
      const state = { storage, acceptWebSocket: (socket: WebSocket) => sockets.push(socket as unknown as FakeSocket), getWebSockets: () => sockets as unknown as WebSocket[] }
      const room = new GameRoom(state, {} as never)
      await room.fetch(new Request('https://room.test/init?code=ABC234'))
      const socket = new FakeSocket(); sockets.push(socket)
      await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'Alice' }))
      await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ cmd: 'start' }))
      expect((await storage.get<{ status: string; countdown: unknown }>('room'))).toMatchObject({ status: 'countdown', countdown: { step: 3, label: '3', startedAt: 1_000, endsAt: 2_000 } })
      await room.alarm()
      expect((await storage.get<{ countdown: { step: number } }>('room'))?.countdown.step).toBe(3)
      vi.setSystemTime(2_000); await room.alarm()
      expect((await storage.get<{ countdown: { step: number; label: string; startedAt: number; endsAt: number } }>('room'))?.countdown).toMatchObject({ step: 2, label: '2', startedAt: 2_000, endsAt: 3_000 })
      vi.setSystemTime(3_000); await room.alarm()
      expect((await storage.get<{ countdown: { step: number; label: string; startedAt: number; endsAt: number } }>('room'))?.countdown).toMatchObject({ step: 1, label: '1', startedAt: 3_000, endsAt: 4_000 })
      vi.setSystemTime(4_000); await room.alarm()
      expect((await storage.get<{ countdown: { step: number; label: string; startedAt: number; endsAt: number } }>('room'))?.countdown).toMatchObject({ step: 0, label: 'Gå', startedAt: 4_000, endsAt: 5_000 })
      vi.setSystemTime(5_000); await room.alarm()
      expect((await storage.get<{ status: string; countdown: unknown }>('room'))).toMatchObject({ status: 'running', countdown: null })
      expect(storage.alarm).toBe(5_140)
    } finally { vi.useRealTimers() }
  })

  it('rejects joins and ignores directions while counting down', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000)
    try {
      const storage = new MemoryStorage(); const sockets: FakeSocket[] = []
      const state = { storage, acceptWebSocket: (socket: WebSocket) => sockets.push(socket as unknown as FakeSocket), getWebSockets: () => sockets as unknown as WebSocket[] }
      const room = new GameRoom(state, {} as never)
      await room.fetch(new Request('https://room.test/init?code=ABC234'))
      const host = new FakeSocket(); const late = new FakeSocket(); sockets.push(host, late)
      await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'Alice' }))
      await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ cmd: 'start' }))
      await room.webSocketMessage(late as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'Bob' }))
      expect(late.sent.at(-1)).toContain('already started')
      const before = (await storage.get<{ players: Array<{ queuedDirections: unknown[] }> }>('room'))!.players[0]!.queuedDirections
      await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ cmd: 'direction', direction: 'up' }))
      expect((await storage.get<{ players: Array<{ queuedDirections: unknown[] }> }>('room'))!.players[0]!.queuedDirections).toEqual(before)
    } finally { vi.useRealTimers() }
  })

  it('explains the display-name validation rule for invalid names', async () => {
    const storage = new MemoryStorage(); const socket = new FakeSocket()
    const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [socket as unknown as WebSocket] }, {} as never)
    await room.fetch(new Request('https://room.test/init?code=ABC234'))
    await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'Alice\nBob' }))
    expect(socket.sent.at(-1)).toContain('1-20 characters, on a single line, without control characters')
  })

  it('prepares connected players and automatically counts down after results', async () => {
    vi.useFakeTimers(); vi.setSystemTime(5_000)
    try {
      const storage = new MemoryStorage()
      await storage.put('room', { code: 'ABC234', status: 'results', hostId: 'p1', level: 1, tick: 4, seq: 7, food: { x: 9, y: 9 }, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'right', queuedDirections: ['up'], score: 3, status: 'active', connected: true }], createdAt: 1_000, resultsAt: 3_000, winnerId: 'p1' })
      const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never)
      await room.alarm()
      expect(await storage.get<{ status: string; level: number; countdown: { step: number; label: string } | null; players: Array<{ score: number; queuedDirections: unknown[] }> }>('room')).toMatchObject({ status: 'countdown', level: 2, countdown: { step: 3, label: '3' }, players: [{ score: 0, queuedDirections: [] }] })
      expect(storage.alarm).toBe(6_000)
    } finally { vi.useRealTimers() }
  })

  it('catches up a late countdown alarm from its original start time', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000)
    try {
      const storage = new MemoryStorage(); const sockets: FakeSocket[] = []
      const state = { storage, acceptWebSocket: (socket: WebSocket) => sockets.push(socket as unknown as FakeSocket), getWebSockets: () => sockets as unknown as WebSocket[] }
      const room = new GameRoom(state, {} as never)
      await room.fetch(new Request('https://room.test/init?code=ABC234'))
      const socket = new FakeSocket(); sockets.push(socket)
      await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'Alice' }))
      await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ cmd: 'start' }))
      vi.setSystemTime(5_500); await room.alarm()
      expect(await storage.get<{ status: string; countdown: unknown }>('room')).toMatchObject({ status: 'running', countdown: null })
      expect(storage.alarm).toBe(5_640)
    } finally { vi.useRealTimers() }
  })

  it('recovers corrupt countdown state to lobby and broadcasts the recovery', async () => {
    vi.useFakeTimers(); vi.setSystemTime(5_000)
    try {
      const storage = new MemoryStorage(); const socket = new FakeSocket()
      await storage.put('room', { code: 'ABC234', status: 'countdown', countdown: null, hostId: null, level: 1, tick: 0, seq: 4, food: null, players: [], createdAt: 1_000, resultsAt: null, winnerId: null })
      const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [socket as unknown as WebSocket] }, {} as never)
      await room.alarm()
      expect(await storage.get<{ status: string; countdown: unknown; seq: number }>('room')).toMatchObject({ status: 'lobby', countdown: null, seq: 5 })
      expect(socket.sent.at(-1)).toContain('"status":"lobby"')
      expect(storage.alarm).toBe(181_000)
    } finally { vi.useRealTimers() }
  })

  it('retries level four after an all-loss result instead of finishing', async () => {
    vi.useFakeTimers(); vi.setSystemTime(5_000)
    try {
      const storage = new MemoryStorage()
      await storage.put('room', { code: 'ABC234', status: 'results', countdown: null, hostId: 'p1', level: 4, tick: 4, seq: 7, food: { x: 9, y: 9 }, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'right', queuedDirections: [], score: 3, status: 'out', connected: true }], createdAt: 1_000, resultsAt: 3_000, winnerId: null })
      const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never)
      await room.alarm()
      expect(await storage.get<{ status: string; level: number; countdown: { step: number } | null }>('room')).toMatchObject({ status: 'countdown', level: 4, countdown: { step: 3 } })
    } finally { vi.useRealTimers() }
  })

  it('clears the host when results fall back to an empty lobby', async () => {
    vi.useFakeTimers(); vi.setSystemTime(5_000)
    try {
      const storage = new MemoryStorage(); const sockets: FakeSocket[] = []
      await storage.put('room', { code: 'ABC234', status: 'results', countdown: null, hostId: 'old-host', level: 1, tick: 4, seq: 7, food: null, players: [{ id: 'old-host', displayName: 'Old', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'right', queuedDirections: [], score: 0, status: 'out', connected: false }], createdAt: 1_000, resultsAt: 3_000, winnerId: null })
      const room = new GameRoom({ storage, acceptWebSocket: (socket: WebSocket) => sockets.push(socket as unknown as FakeSocket), getWebSockets: () => sockets as unknown as WebSocket[] }, {} as never)
      await room.alarm()
      expect(await storage.get<{ status: string; hostId: string | null }>('room')).toMatchObject({ status: 'lobby', hostId: null })
      const newcomer = new FakeSocket(); sockets.push(newcomer)
      await room.webSocketMessage(newcomer as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'New' }))
      await room.webSocketMessage(newcomer as unknown as WebSocket, JSON.stringify({ cmd: 'start' }))
      expect(await storage.get<{ status: string; hostId: string | null; countdown: { step: number } | null }>('room')).toMatchObject({ status: 'countdown', hostId: expect.any(String), countdown: { step: 3 } })
    } finally { vi.useRealTimers() }
  })

  it('rejects canonically equivalent display names as duplicates', async () => {
    const storage = new MemoryStorage(); const sockets: FakeSocket[] = []
    const room = new GameRoom({ storage, acceptWebSocket: (socket: WebSocket) => sockets.push(socket as unknown as FakeSocket), getWebSockets: () => sockets as unknown as WebSocket[] }, {} as never)
    await room.fetch(new Request('https://room.test/init?code=ABC234'))
    const first = new FakeSocket(); const second = new FakeSocket(); sockets.push(first, second)
    await room.webSocketMessage(first as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'A\u030Ake' }))
    await room.webSocketMessage(second as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'Åke' }))
    expect(second.sent.at(-1)).toContain('display name is already in use')
  })

  it('keeps results active immediately before the two-second boundary', async () => {
    vi.useFakeTimers(); vi.setSystemTime(4_999)
    try {
      const storage = new MemoryStorage()
      await storage.put('room', { code: 'ABC234', status: 'results', countdown: null, hostId: 'p1', level: 1, tick: 4, seq: 7, food: null, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'right', queuedDirections: [], score: 3, status: 'active', connected: true }], createdAt: 1_000, resultsAt: 3_000, winnerId: 'p1' })
      const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never)
      await room.alarm()
      expect(await storage.get<{ status: string; resultsAt: number }>('room')).toMatchObject({ status: 'results', resultsAt: 3_000 })
      expect(storage.alarm).toBe(5_000)
    } finally { vi.useRealTimers() }
  })

  it('finishes after the boundary when the level-four result has a winner', async () => {
    vi.useFakeTimers(); vi.setSystemTime(5_000)
    try {
      const storage = new MemoryStorage()
      await storage.put('room', { code: 'ABC234', status: 'results', countdown: null, hostId: 'p1', level: 4, tick: 4, seq: 7, food: null, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'right', queuedDirections: [], score: 3, status: 'active', connected: true }], createdAt: 1_000, resultsAt: 3_000, winnerId: 'p1' })
      const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never)
      await room.alarm()
      expect(await storage.get<{ status: string; countdown: unknown; resultsAt: number }>('room')).toMatchObject({ status: 'finished', countdown: null, resultsAt: 5_000 })
      expect(storage.alarm).toBe(185_000)
    } finally { vi.useRealTimers() }
  })

  it('keeps a finished room alive while a player remains connected', async () => {
    vi.useFakeTimers(); vi.setSystemTime(5_000)
    try {
      const storage = new MemoryStorage()
      await storage.put('room', { code: 'ABC234', status: 'results', countdown: null, hostId: 'p1', level: 4, tick: 4, seq: 7, food: null, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'right', queuedDirections: [], score: 3, status: 'active', connected: true }], createdAt: 1_000, resultsAt: 3_000, winnerId: 'p1' })
      const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never)
      await room.alarm()
      expect(await storage.get<{ status: string; resultsAt: number }>('room')).toMatchObject({ status: 'finished', resultsAt: 5_000 })
      expect(storage.alarm).toBe(185_000)
    } finally { vi.useRealTimers() }
  })

  it('migrates old players and exposes cumulative total scores', async () => {
    const storage = new MemoryStorage(); const socket = new FakeSocket()
    await storage.put('room', { code: 'ABC234', status: 'lobby', countdown: null, hostId: 'p1', level: 1, tick: 0, seq: 1, food: null, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }], direction: 'right', queuedDirections: [], score: 7, status: 'active', connected: true }], createdAt: 1_000, resultsAt: null, winnerId: null })
    const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [socket as unknown as WebSocket] }, {} as never)
    socket.serializeAttachment({ playerId: 'p1' })
    await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ cmd: 'join', name: 'Alice' }))
    expect((await storage.get<{ players: Array<{ totalScore: number }> }>('room'))!.players[0]!.totalScore).toBe(7)
  })

  it('allows only the host to restart a finished room and resets it to lobby', async () => {
    const storage = new MemoryStorage(); const sockets: FakeSocket[] = []
    await storage.put('room', { code: 'ABC234', status: 'finished', countdown: null, hostId: 'p1', level: 4, tick: 20, seq: 7, food: { x: 9, y: 9 }, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }], direction: 'right', queuedDirections: [], score: 3, totalScore: 30, status: 'active', connected: true }, { id: 'p2', displayName: 'Bob', body: [{ x: 4, y: 4 }], direction: 'left', queuedDirections: [], score: 2, totalScore: 20, status: 'out', connected: true }], createdAt: 1_000, resultsAt: 5_000, winnerId: 'p1' })
    const state = { storage, acceptWebSocket: (socket: WebSocket) => sockets.push(socket as unknown as FakeSocket), getWebSockets: () => sockets as unknown as WebSocket[] }
    const room = new GameRoom(state, {} as never)
    const host = new FakeSocket(); const other = new FakeSocket(); sockets.push(host, other)
    host.serializeAttachment({ playerId: 'p1' }); other.serializeAttachment({ playerId: 'p2' })
    await room.webSocketMessage(other as unknown as WebSocket, JSON.stringify({ cmd: 'restart' }))
    expect(other.sent.at(-1)).toContain('only the host')
    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ cmd: 'restart' }))
    expect(await storage.get<{ status: string; level: number; totalScore: number; winnerId: string | null; players: Array<{ totalScore: number; score: number; status: string }> }>('room')).toMatchObject({ status: 'lobby', level: 1, winnerId: null, players: [{ totalScore: 0, score: 0, status: 'active' }, { totalScore: 0, score: 0, status: 'active' }] })
  })

  it('reschedules finished cleanup while connected and deletes after final disconnect grace', async () => {
    vi.useFakeTimers(); vi.setSystemTime(5_000)
    try {
      const storage = new MemoryStorage()
      await storage.put('room', { code: 'ABC234', status: 'finished', countdown: null, hostId: 'p1', level: 4, tick: 4, seq: 7, food: null, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }], direction: 'right', queuedDirections: [], score: 3, totalScore: 30, status: 'active', connected: true }], createdAt: 1_000, resultsAt: 3_000, winnerId: 'p1' })
      const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never)
      await room.alarm()
      expect(await storage.get('room')).toBeTruthy()
      expect(storage.alarm).toBe(185_000)
      await storage.put('room', { ...(await storage.get<Record<string, unknown>>('room'))!, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }], direction: 'right', queuedDirections: [], score: 3, totalScore: 30, status: 'out', connected: false }] })
      vi.setSystemTime(185_000); await new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never).alarm()
      expect(await storage.get('room')).toBeUndefined()
    } finally { vi.useRealTimers() }
  })

  it('increments total score once when food is eaten and preserves it into the next round', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000)
    try {
      const storage = new MemoryStorage()
      await storage.put('room', { code: 'ABC234', status: 'running', countdown: null, hostId: 'p1', level: 1, tick: 0, seq: 1, food: { x: 3, y: 2 }, players: [{ id: 'p1', displayName: 'Alice', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'right', queuedDirections: [], score: 0, totalScore: 0, status: 'active', connected: true }], createdAt: 1_000, resultsAt: null, winnerId: null })
      const room = new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never)
      await room.alarm()
      expect(await storage.get<{ players: Array<{ score: number; totalScore: number }> }>('room')).toMatchObject({ players: [{ score: 10, totalScore: 10 }] })
      await storage.put('room', { ...(await storage.get<Record<string, unknown>>('room'))!, status: 'results', level: 1, resultsAt: 1_000, winnerId: 'p1' })
      vi.setSystemTime(3_000); await new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never).alarm()
      expect(await storage.get<{ level: number; players: Array<{ score: number; totalScore: number }> }>('room')).toMatchObject({ level: 2, players: [{ score: 0, totalScore: 10 }] })
    } finally { vi.useRealTimers() }
  })

  it('freezes a late running alarm instead of simulating a missed tick', async () => {
    vi.useFakeTimers(); vi.setSystemTime(2_000)
    try {
      const storage = new MemoryStorage()
      await storage.put('room', { code: 'ABC234', isPublic: false, status: 'running', countdown: null, pause: null, nextTickAt: 1_000, hostId: 'p1', level: 1, tick: 0, seq: 4, food: { x: 9, y: 9 }, players: [{ id: 'p1', recoveryToken: 'recovery-token-1234', displayName: 'Alice', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'right', queuedDirections: [], score: 0, totalScore: 0, status: 'active', connected: true }], createdAt: 1_000, resultsAt: null, winnerId: null })
      await new GameRoom({ storage, acceptWebSocket: () => undefined, getWebSockets: () => [] }, {} as never).alarm()
      expect(await storage.get<{ status: string; tick: number; pause: { reason: string; waitingPlayerIds: string[] } }>('room')).toMatchObject({ status: 'paused', tick: 0, pause: { reason: 'connection_lost', waitingPlayerIds: ['p1'] } })
    } finally { vi.useRealTimers() }
  })

  it('restores a paused player with their recovery token and restarts the countdown', async () => {
    const storage = new MemoryStorage(); const sockets: FakeSocket[] = []
    const state = { storage, acceptWebSocket: (socket: WebSocket) => sockets.push(socket as unknown as FakeSocket), getWebSockets: () => sockets as unknown as WebSocket[] }
    await storage.put('room', { code: 'ABC234', isPublic: false, status: 'paused', countdown: null, pause: { reason: 'connection_lost', pausedAt: 1_000, expiresAt: 181_000, waitingPlayerIds: ['p1'] }, nextTickAt: null, hostId: 'p1', level: 1, tick: 7, seq: 4, food: { x: 9, y: 9 }, players: [{ id: 'p1', recoveryToken: 'recovery-token-1234', displayName: 'Alice', body: [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }], direction: 'right', queuedDirections: [], score: 10, totalScore: 20, status: 'active', connected: false }], createdAt: 1_000, resultsAt: null, winnerId: null })
    const room = new GameRoom(state, {} as never); const socket = new FakeSocket(); sockets.push(socket)
    await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify({ cmd: 'resume', token: 'recovery-token-1234' }))
    expect(await storage.get<{ status: string; tick: number; countdown: { label: string }; players: Array<{ connected: boolean }> }>('room')).toMatchObject({ status: 'countdown', tick: 7, countdown: { label: '3' }, players: [{ connected: true }] })
    expect(socket.sent.some(message => message.includes('recovery-token-1234'))).toBe(true)
  })
})

class FakeSocket {
  sent: string[] = []
  private attachment: unknown = null
  send(value: string): void { this.sent.push(value) }
  serializeAttachment(value: unknown): void { this.attachment = value }
  deserializeAttachment(): unknown { return this.attachment }
}
