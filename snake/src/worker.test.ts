import { describe, expect, it } from 'vitest'
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
})

class FakeSocket {
  sent: string[] = []
  private attachment: unknown = null
  send(value: string): void { this.sent.push(value) }
  serializeAttachment(value: unknown): void { this.attachment = value }
  deserializeAttachment(): unknown { return this.attachment }
}
