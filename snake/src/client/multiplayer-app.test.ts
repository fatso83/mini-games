import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(() => Promise.resolve()) } }))
import { countdownFontSize, mountMultiplayerApp, normalizeShareBase } from './multiplayer-app'

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
  it('sizes countdown text from 80% toward 40% over the server stage interval', () => {
    const countdown = { step: 3 as const, label: '3' as const, startedAt: 1_000, endsAt: 2_000 }
    expect(countdownFontSize(countdown, 1_000, 400)).toBe(320)
    expect(countdownFontSize(countdown, 1_500, 400)).toBe(240)
    expect(countdownFontSize(countdown, 1_900, 400)).toBe(176)
    expect(countdownFontSize(countdown, 2_200, 400)).toBe(160)
  })

  it('normalizes only HTTP(S) share origins', () => {
    expect(normalizeShareBase('http://10.0.0.22:5173', 'http://127.0.0.1:5173')).toBe('http://10.0.0.22:5173')
    expect(normalizeShareBase('javascript:alert(1)', 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173')
  })

  it('uses server share URL base for host display links', async () => {
    const root = document.createElement('main')
    document.body.append(root)
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ code: 'ABC123', shareUrlBase: 'http://10.0.0.22:5173' }) })
    mountMultiplayerApp(root, 'host', null, { fetch: fetcher, WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const form = root.querySelector('form')!
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(root.querySelector('[data-share]')?.textContent).toBe('http://10.0.0.22:5173/join?game=ABC123'))
  })

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

  it('shows a server-driven countdown overlay and never sends direction during countdown', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D))
    const root = document.createElement('main')
    document.body.append(root)
    const mount = mountMultiplayerApp(root, 'join', 'ABC123', { WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const form = root.querySelector('form')!
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    FakeSocket.instance.onopen?.()
    FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq: 1, selfPlayerId: 'p1', state: { status: 'countdown', countdown: { step: 3, label: '3', startedAt: 1_000, endsAt: 2_000 }, config: { width: 20, height: 20 }, players: [] } }) } as MessageEvent)
    const overlay = root.querySelector<HTMLElement>('[data-countdown-overlay]')!
    expect(overlay.hidden).toBe(false)
    expect(root.querySelector('[data-countdown-label]')?.textContent).toBe('3')
    expect(root.querySelector('[data-room-status]')?.textContent).toBe('Spillet starter…')
    const board = root.querySelector<HTMLCanvasElement>('[data-remote-board]')!
    board.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    expect(FakeSocket.instance.sent.some(value => value.includes('"cmd":"direction"'))).toBe(false)
    mount()
  })

  it('uses epoch time for a late countdown snapshot rather than the animation-frame clock', () => {
    const context = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context)
    vi.spyOn(Date, 'now').mockReturnValue(1_500)
    const root = document.createElement('main')
    document.body.append(root)
    const mount = mountMultiplayerApp(root, 'join', 'ABC123', { WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const form = root.querySelector('form')!
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    FakeSocket.instance.onopen?.()
    FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq: 1, selfPlayerId: 'p1', state: { status: 'countdown', countdown: { step: 3, label: '3', startedAt: 1_000, endsAt: 2_000 }, config: { width: 20, height: 20 }, players: [] } }) } as MessageEvent)
    expect(root.querySelector<HTMLElement>('[data-countdown-label]')?.style.fontSize).toBe('90px')
    mount()
  })

  it('only schedules animation frames for countdown or a living self snake', () => {
    const context = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context)
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length })
    const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const root = document.createElement('main')
    document.body.append(root)
    const mount = mountMultiplayerApp(root, 'join', 'ABC123', { WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const form = root.querySelector('form')!
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    FakeSocket.instance.onopen?.()
    const send = (seq: number, status: string, players: unknown[]) => FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq, selfPlayerId: 'p1', state: { status, config: { width: 20, height: 20 }, players } }) } as MessageEvent)
    send(1, 'lobby', [])
    expect(requestFrame).not.toHaveBeenCalled()
    send(2, 'running', [{ id: 'p2', name: 'Bob', body: [{ x: 1, y: 1 }] }])
    expect(requestFrame).not.toHaveBeenCalled()
    send(3, 'running', [{ id: 'p1', name: 'Ada', status: 'active', body: [{ x: 1, y: 1 }] }])
    expect(requestFrame).toHaveBeenCalledTimes(1)
    send(4, 'results', [{ id: 'p1', name: 'Ada', body: [] }])
    expect(cancelFrame).toHaveBeenCalled()
    mount()
  })

  it('does not rewrite the accessible countdown label on every animation frame', () => {
    const context = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length })
    const root = document.createElement('main')
    document.body.append(root)
    const mount = mountMultiplayerApp(root, 'join', 'ABC123', { WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const label = root.querySelector<HTMLElement>('[data-countdown-label]')!
    let labelValue = ''
    let writes = 0
    Object.defineProperty(label, 'textContent', { configurable: true, get: () => labelValue, set: value => { writes += 1; labelValue = String(value) } })
    const form = root.querySelector('form')!
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    FakeSocket.instance.onopen?.()
    FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq: 1, selfPlayerId: 'p1', state: { status: 'countdown', countdown: { step: 3, label: '3', startedAt: 1_000, endsAt: 2_000 }, config: { width: 20, height: 20 }, players: [] } }) } as MessageEvent)
    expect(writes).toBe(1)
    frames[0]?.(1_100)
    expect(writes).toBe(1)
    mount()
  })

  it('cancels active redraw and clears stale snapshot when the socket closes', () => {
    const clearRect = vi.fn()
    const context = { clearRect, fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length })
    const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const root = document.createElement('main')
    document.body.append(root)
    const mount = mountMultiplayerApp(root, 'join', 'ABC123', { WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const form = root.querySelector('form')!
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    FakeSocket.instance.onopen?.()
    FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq: 1, selfPlayerId: 'p1', state: { status: 'countdown', countdown: { step: 3, label: '3', startedAt: 1_000, endsAt: 2_000 }, config: { width: 20, height: 20 }, players: [] } }) } as MessageEvent)
    expect(frames).toHaveLength(1)
    const drawsBeforeClose = clearRect.mock.calls.length
    FakeSocket.instance.close()
    expect(cancelFrame).toHaveBeenCalledWith(1)
    frames[0]?.(1_100)
    expect(clearRect).toHaveBeenCalledTimes(drawsBeforeClose)
    mount()
  })

  it('draws visible player initials and pulses only the self player snake', () => {
    const shadowBlurs: number[] = []
    const context = {
      clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
      fillStyle: '', strokeStyle: '', lineWidth: 0, shadowBlur: 0, shadowColor: '', font: '', textAlign: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(context, 'shadowBlur', { configurable: true, get: () => shadowBlurs.at(-1) ?? 0, set: value => shadowBlurs.push(Number(value)) })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context)
    const root = document.createElement('main')
    document.body.append(root)
    const mount = mountMultiplayerApp(root, 'join', 'ABC123', { WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const form = root.querySelector('form')!
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    FakeSocket.instance.onopen?.()
    FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq: 1, selfPlayerId: 'p1', state: { status: 'running', config: { width: 20, height: 20 }, players: [{ id: 'p1', name: 'Åsa', status: 'active', body: [{ x: 1, y: 2 }] }, { id: 'p2', name: 'Bob', status: 'active', body: [{ x: 3, y: 4 }] }] } }) } as MessageEvent)
    expect(context.strokeText).toHaveBeenCalledWith('Å', expect.any(Number), expect.any(Number))
    expect(context.fillText).toHaveBeenCalledWith('B', expect.any(Number), expect.any(Number))
    expect(shadowBlurs.some(value => value > 0)).toBe(true)
    mount()
  })

  it('does not pulse or animate a retained body for an eliminated self player', () => {
    const shadowBlurs: number[] = []
    const context = {
      clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
      fillStyle: '', strokeStyle: '', lineWidth: 0, shadowBlur: 0, shadowColor: '', font: '', textAlign: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D
    Object.defineProperty(context, 'shadowBlur', { configurable: true, get: () => shadowBlurs.at(-1) ?? 0, set: value => shadowBlurs.push(Number(value)) })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context)
    const requestFrame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1)
    const root = document.createElement('main')
    document.body.append(root)
    const mount = mountMultiplayerApp(root, 'join', 'ABC123', { WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const form = root.querySelector('form')!
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    FakeSocket.instance.onopen?.()
    FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq: 1, selfPlayerId: 'p1', state: { status: 'running', config: { width: 20, height: 20 }, players: [{ id: 'p1', name: 'Ada', status: 'out', body: [{ x: 1, y: 1 }] }, { id: 'p2', name: 'Bob', status: 'active', body: [{ x: 3, y: 3 }] }] } }) } as MessageEvent)
    expect(shadowBlurs.some(value => value > 0)).toBe(false)
    expect(requestFrame).not.toHaveBeenCalled()
    mount()
  })

  it('does not reset canvas backing dimensions when the board dimensions are unchanged', () => {
    const context = { clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context)
    const width = vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set')
    const height = vi.spyOn(HTMLCanvasElement.prototype, 'height', 'set')
    const root = document.createElement('main')
    document.body.append(root)
    const mount = mountMultiplayerApp(root, 'join', 'ABC123', { WebSocket: FakeSocket as unknown as typeof WebSocket, location: window.location })
    const board = root.querySelector<HTMLCanvasElement>('[data-remote-board]')!
    board.width = 200
    board.height = 200
    const form = root.querySelector('form')!
    ;(form.elements.namedItem('name') as HTMLInputElement).value = 'Ada'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    FakeSocket.instance.onopen?.()
    FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq: 1, selfPlayerId: 'p1', state: { status: 'lobby', config: { width: 20, height: 20 }, players: [] } }) } as MessageEvent)
    FakeSocket.instance.onmessage?.({ data: JSON.stringify({ cmd: 'snapshot', seq: 2, selfPlayerId: 'p1', state: { status: 'lobby', config: { width: 20, height: 20 }, players: [] } }) } as MessageEvent)
    expect(width).toHaveBeenCalledTimes(1)
    expect(height).toHaveBeenCalledTimes(1)
    mount()
  })
})
