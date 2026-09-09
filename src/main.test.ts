import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountGame, type AppDependencies } from './main'
import { DEFAULT_GAME_CONFIG } from './game/config'
import { listFreeCells } from './game/food'
import type { PlayerState } from './game/types'

function context(): CanvasRenderingContext2D {
  return { setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D
}

function deps(overrides: Partial<AppDependencies> = {}): AppDependencies & { frames: FrameRequestCallback[] } {
  const frames: FrameRequestCallback[] = []
  return {
    random: () => 0,
    now: () => 0,
    requestFrame: (callback) => { frames.push(callback); return frames.length },
    cancelFrame: vi.fn(),
    getCanvasContext: () => context(),
    devicePixelRatio: () => 1,
    frames,
    ...overrides,
  }
}

afterEach(() => document.body.innerHTML = '')

describe('mountGame', () => {
  it('mounts a semantic ready game with a focusable canvas', () => {
    const root = document.createElement('main')
    const mounted = mountGame(root, deps())
    expect(root.querySelector('canvas')).not.toBeNull()
    expect(root.querySelector('[data-score]')?.textContent).toBe('0')
    expect(root.querySelector('[data-status]')?.textContent).toBe('Klar')
    expect(root.textContent).toMatch(/piltaster|WASD/i)
    expect(root.querySelector('button')?.textContent).toMatch(/Ny runde/i)
    expect(root.querySelector('canvas')?.tabIndex).toBe(0)
    const canvas = root.querySelector('canvas')!
    expect(canvas.getAttribute('role')).toBe('application')
    expect(canvas.getAttribute('aria-labelledby')).toBe('game-title')
    expect(canvas.getAttribute('aria-describedby')).toBe('game-status game-instructions')
    expect(root.querySelector('h1')?.id).toBe('game-title')
    expect(root.querySelector('[data-status]')?.id).toBe('game-status')
    expect(root.querySelector('.snake-instructions')?.id).toBe('game-instructions')
    expect(mounted.getState().status).toBe('ready')
    mounted.destroy()
  })

  it('starts on a direction, pauses and resumes with space, and advances after a full interval', () => {
    let time = 0
    const input = deps({ now: () => time })
    const root = document.createElement('main')
    const mounted = mountGame(root, input)
    const canvas = root.querySelector('canvas')!
    input.frames.shift()!(0)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', cancelable: true }))
    expect(root.querySelector('[data-status]')?.textContent).toBe('Pågår')
    time = 140
    input.frames.shift()!(time)
    expect(mounted.getState().players.local?.body[0]).toEqual({ x: 10, y: 10 })
    time = 280
    input.frames.shift()!(time)
    expect(mounted.getState().players.local?.body[0]).toEqual({ x: 11, y: 10 })
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }))
    expect(root.querySelector('[data-status]')?.textContent).toBe('Pause')
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }))
    expect(root.querySelector('[data-status]')?.textContent).toBe('Pågår')
    time = 420
    input.frames.shift()!(time)
    expect(mounted.getState().players.local?.body[0]).toEqual({ x: 11, y: 10 })
    time = 560
    input.frames.shift()!(time)
    expect(mounted.getState().players.local?.body[0]).toEqual({ x: 12, y: 10 })
  })

  it.each(['ready', 'running', 'paused'] as const)('ignores Enter while %s', (status) => {
    const input = deps()
    const root = document.createElement('main')
    const mounted = mountGame(root, input)
    const canvas = root.querySelector('canvas')!
    if (status === 'running') canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    if (status === 'paused') { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' })); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })) }
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(mounted.getState().status).toBe(status)
  })

  it('restarts a lost round with Enter', () => {
    let time = 0
    const input = deps({ now: () => time })
    const root = document.createElement('main')
    const mounted = mountGame(root, input)
    const canvas = root.querySelector('canvas')!
    input.frames.shift()!(0)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))
    for (let tick = 0; tick < 4; tick += 1) { time += 140; input.frames.shift()!(time) }
    expect(mounted.getState().status).toBe('lost')
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(mounted.getState().status).toBe('ready')
  })

  it('shows a visible Norwegian error and does not start when context is unavailable', () => {
    const error = new Error('no 2d')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const input = deps({ getCanvasContext: () => null })
    const root = document.createElement('main')
    mountGame(root, input)
    expect(root.textContent).toMatch(/Canvas|grafikk/i)
    expect(root.querySelector('[data-error]')?.hasAttribute('hidden')).toBe(false)
    expect(root.querySelector('button')?.hasAttribute('disabled')).toBe(true)
    expect((root.querySelector('.snake-instructions') as HTMLElement | null)?.hidden).toBe(true)
    expect(input.frames).toHaveLength(0)
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Canvas 2D') }))
    log.mockRestore()
  })

  it('reads the injected device pixel ratio for each render', () => {
    let dpr = 1
    const calls: unknown[][] = []
    const input = deps({ devicePixelRatio: () => dpr, getCanvasContext: () => ({ setTransform: (...args: unknown[]) => calls.push(args), clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D) })
    const root = document.createElement('main')
    mountGame(root, input)
    dpr = 2
    input.frames.shift()!(0)
    expect(calls.at(-1)?.[0]).toBe(2)
  })

  it('updates the displayed score after eating food on a fixed tick', () => {
    let time = 0
    let randomCalls = 0
    const starter: PlayerState = { id: 'local', body: DEFAULT_GAME_CONFIG.startingBody, direction: 'right', queuedDirections: [], score: 0 }
    const free = listFreeCells(DEFAULT_GAME_CONFIG, [starter])
    const foodIndex = free.findIndex(({ x, y }) => x === 11 && y === 10)
    const input = deps({ now: () => time, random: () => randomCalls++ === 0 ? foodIndex / free.length : 0 })
    const root = document.createElement('main')
    const mounted = mountGame(root, input)
    const canvas = root.querySelector('canvas')!
    input.frames.shift()!(0)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    time = 140; input.frames.shift()!(time)
    time = 280; input.frames.shift()!(time)
    expect(mounted.getState().players.local?.score).toBe(10)
    expect(root.querySelector('[data-score]')?.textContent).toBe('10')
  })

  it('cleans up frame and input listeners', () => {
    const input = deps()
    const root = document.createElement('main')
    const mounted = mountGame(root, input)
    const canvas = root.querySelector('canvas')!
    const focus = vi.spyOn(canvas, 'focus')
    const button = root.querySelector('button')!
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    expect(mounted.getState().status).toBe('running')
    mounted.destroy()
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    button.click()
    expect(focus).not.toHaveBeenCalled()
    expect(mounted.getState().status).toBe('running')
    expect(input.cancelFrame).toHaveBeenCalled()
  })

  it('restarts from every status via the button and refocuses Canvas', () => {
    const input = deps()
    for (const status of ['ready', 'running', 'paused'] as const) {
      const root = document.createElement('main')
      const mounted = mountGame(root, input)
      const canvas = root.querySelector('canvas')!
      if (status === 'running') canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
      if (status === 'paused') { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' })); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })) }
      const focus = vi.spyOn(canvas, 'focus')
      root.querySelector('button')!.click()
      expect(mounted.getState().status).toBe('ready')
      expect(focus).toHaveBeenCalled()
      mounted.destroy()
    }
  })

  it('restarts a lost round via the button and refocuses Canvas', () => {
    let time = 0
    const input = deps({ now: () => time })
    const root = document.createElement('main')
    const mounted = mountGame(root, input)
    const canvas = root.querySelector('canvas')!
    input.frames.shift()!(0)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))
    for (let tick = 0; tick < 4; tick += 1) { time += 140; input.frames.shift()!(time) }
    expect(mounted.getState().status).toBe('lost')
    const focus = vi.spyOn(canvas, 'focus')
    root.querySelector('button')!.click()
    expect(mounted.getState().status).toBe('ready')
    expect(focus).toHaveBeenCalled()
  })
})
