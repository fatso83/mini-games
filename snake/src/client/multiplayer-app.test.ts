import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(() => Promise.resolve()) } }))
import { mountMultiplayerApp } from './multiplayer-app'

class FakeSocket {
  static instance: FakeSocket
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  readonly sent: string[] = []
  constructor(_url: string) { FakeSocket.instance = this }
  send(value: string): void { this.sent.push(value) }
  close(): void { this.onclose?.() }
}

afterEach(() => { document.body.innerHTML = '' })

describe('multiplayer board input', () => {
  it('focuses the visible board when running and sends normalized WASD directions', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D))
    const root = document.createElement('main')
    document.body.append(root)
    const mount = mountMultiplayerApp(root, 'join', 'ABC123', { WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const form = root.querySelector('form')!
    expect((form.elements.namedItem('code') as HTMLInputElement).value).toBe('ABC123')
    expect(root.querySelector('.multiplayer-board-wrap .snake-board')).not.toBeNull()
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    FakeSocket.instance.onopen?.()
    FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq: 0, selfPlayerId: 'p1', state: { status: 'running', hostId: 'p1', players: [] } }) } as MessageEvent)
    const board = root.querySelector<HTMLCanvasElement>('[data-remote-board]')!
    expect(document.activeElement).toBe(board)
    board.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', cancelable: true }))
    expect(FakeSocket.instance.sent.at(-1)).toContain('"direction":"up"')
    mount()
  })
})
