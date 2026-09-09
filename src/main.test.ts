import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountGame, type AppDependencies } from './main'

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
    devicePixelRatio: 1,
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
    expect(mounted.getState().status).toBe('ready')
    mounted.destroy()
  })

  it('starts on a direction, pauses and resumes with space, and queues fixed steps', () => {
    let time = 0
    const input = deps({ now: () => time })
    const root = document.createElement('main')
    mountGame(root, input)
    const canvas = root.querySelector('canvas')!
    input.frames.shift()!(0)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', cancelable: true }))
    expect(root.querySelector('[data-status]')?.textContent).toBe('Pågår')
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }))
    expect(root.querySelector('[data-status]')?.textContent).toBe('Pause')
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }))
    expect(root.querySelector('[data-status]')?.textContent).toBe('Pågår')
    time = 140
    input.frames.shift()!(time)
    expect(mountGame).toBeDefined()
  })

  it('only lets Enter restart a finished round', () => {
    const input = deps()
    const root = document.createElement('main')
    const mounted = mountGame(root, input)
    const canvas = root.querySelector('canvas')!
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(mounted.getState().status).toBe('ready')
  })

  it('shows a visible Norwegian error and does not start when context is unavailable', () => {
    const error = new Error('no 2d')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const input = deps({ getCanvasContext: () => null })
    const root = document.createElement('main')
    mountGame(root, input)
    expect(root.textContent).toMatch(/Canvas|grafikk/i)
    expect(input.frames).toHaveLength(0)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
    void error
  })

  it('cleans up frame and input listeners', () => {
    const input = deps()
    const root = document.createElement('main')
    const mounted = mountGame(root, input)
    const canvas = root.querySelector('canvas')!
    mounted.destroy()
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    expect(mounted.getState().status).toBe('ready')
    expect(input.cancelFrame).toHaveBeenCalled()
  })
})
