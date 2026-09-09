import { describe, expect, it, vi } from 'vitest'
import type { GameState, PlayerState } from '../game/types'
import { calculateBoardLayout, createCanvasRenderer } from './canvas-renderer'

describe('calculateBoardLayout', () => {
  it('fits the largest square cells and centers the logical board', () => {
    expect(calculateBoardLayout(500, 300, 20, 10)).toEqual({ cellSize: 25, boardWidth: 500, boardHeight: 250, offsetX: 0, offsetY: 25 })
  })
  it('handles zero-sized CSS dimensions without invalid numbers', () => {
    expect(calculateBoardLayout(0, 300, 20, 10)).toEqual({ cellSize: 0, boardWidth: 0, boardHeight: 0, offsetX: 0, offsetY: 150 })
  })
})

describe('canvas renderer', () => {
  it('resizes responsively, clears, and draws food and every player body', () => {
    const calls: unknown[][] = []
    const context = { setTransform: (...args: unknown[]) => calls.push(['setTransform', ...args]), clearRect: (...args: unknown[]) => calls.push(['clearRect', ...args]), fillRect: (...args: unknown[]) => calls.push(['fillRect', ...args]), fillStyle: '' } as unknown as CanvasRenderingContext2D
    const canvas = { width: 0, height: 0, getBoundingClientRect: () => ({ width: 200, height: 100 }) } as unknown as HTMLCanvasElement
    const renderer = createCanvasRenderer(canvas, context, () => 1.5)
    const players = Object.create(null) as Record<string, PlayerState>
    players.alpha = { id: 'alpha', body: [{ x: 0, y: 0 }, { x: 1, y: 0 }], direction: 'right', queuedDirections: [], score: 0 }
    players.beta = { id: 'beta', body: [{ x: 3, y: 2 }], direction: 'up', queuedDirections: [], score: 0 }
    renderer.render({ config: { width: 4, height: 2 } as GameState['config'], players, food: { x: 2, y: 1 }, status: 'running', tickIntervalMs: 100 })
    expect(canvas.width).toBe(300)
    expect(canvas.height).toBe(150)
    expect(calls[0]).toEqual(['setTransform', 1.5, 0, 0, 1.5, 0, 0])
    expect(calls[1]).toEqual(['clearRect', 0, 0, 200, 100])
    expect(calls.filter(([name]) => name === 'fillRect')).toHaveLength(4)
    expect(context.fillStyle).toBe('#55d66b')
  })
  it('supports client-size fallback and no food', () => {
    const context = { setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D
    const canvas = { width: 0, height: 0, clientWidth: 120, clientHeight: 80 } as unknown as HTMLCanvasElement
    createCanvasRenderer(canvas, context, () => 2).render({ config: { width: 6, height: 4 } as GameState['config'], players: Object.create(null), food: null, status: 'ready', tickIntervalMs: 100 })
    expect(canvas.width).toBe(240)
    expect(canvas.height).toBe(160)
    expect(context.fillRect).not.toHaveBeenCalled()
  })
})
