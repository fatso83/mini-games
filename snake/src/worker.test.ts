import { describe, expect, it, vi } from 'vitest'
import worker, { GameRoom } from './worker'

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
})

class FakeSocket {
  sent: string[] = []
  private attachment: unknown = null
  send(value: string): void { this.sent.push(value) }
  serializeAttachment(value: unknown): void { this.attachment = value }
  deserializeAttachment(): unknown { return this.attachment }
}
