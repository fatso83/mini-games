import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ statuses: [] as Array<'won' | 'ready'> }))
vi.mock('./game/create-game', () => ({
  createGame: ({ config, playerIds }: { config: { startingBody: readonly { x: number; y: number }[]; startingDirection: 'right'; baseTickMs: number }; playerIds: readonly string[] }) => {
    const players = Object.fromEntries(playerIds.map((id) => [id, { id, body: config.startingBody.map((position) => ({ ...position })), direction: config.startingDirection, queuedDirections: [], score: 0 }]))
    return { config, players: Object.freeze(players), food: null, status: fixture.statuses.shift() ?? 'ready', tickIntervalMs: config.baseTickMs }
  },
}))

import { mountGame } from './main'

function dependencies() {
  const frames: FrameRequestCallback[] = []
  return {
    random: () => 0,
    now: () => 0,
    requestFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length },
    cancelFrame: vi.fn(),
    getCanvasContext: () => ({ setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D),
    devicePixelRatio: () => 1,
    frames,
  }
}

describe('won round integration', () => {
  it('restarts a won round with Enter', () => {
    const root = document.createElement('main')
    const deps = dependencies()
    fixture.statuses = ['won', 'ready']
    const mounted = mountGame(root, deps)
    const canvas = root.querySelector('canvas')!
    expect(mounted.getState().status).toBe('won')
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(mounted.getState().status).toBe('ready')
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(mounted.getState().status).toBe('ready')
    mounted.destroy()
  })

  it('restarts a fresh won round with the New round button and focuses Canvas', () => {
    const root = document.createElement('main')
    const deps = dependencies()
    fixture.statuses = ['won', 'ready']
    const mounted = mountGame(root, deps)
    const canvas = root.querySelector('canvas')!
    expect(mounted.getState().status).toBe('won')
    const focus = vi.spyOn(canvas, 'focus')
    root.querySelector('button')!.click()
    expect(mounted.getState().status).toBe('ready')
    expect(mounted.getState().players.local?.score).toBe(0)
    expect(focus).toHaveBeenCalled()
    mounted.destroy()
  })
})
