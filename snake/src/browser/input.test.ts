import { describe, expect, it, vi } from 'vitest'
import { bindGameInput, mapKeyToCommand } from './input'

describe('mapKeyToCommand', () => {
  it.each([
    ['ArrowUp', 'up'], ['w', 'up'], ['W', 'up'],
    ['ArrowDown', 'down'], ['s', 'down'],
    ['ArrowLeft', 'left'], ['a', 'left'],
    ['ArrowRight', 'right'], ['d', 'right'],
  ])('%s maps to direction', (key, direction) => {
    expect(mapKeyToCommand(key)).toEqual({ type: 'direction', direction })
  })

  it.each([' ', 'Spacebar', 'p', 'P'])('%s toggles pause', (key) => {
    expect(mapKeyToCommand(key)).toEqual({ type: 'round', command: 'toggle-pause' })
  })

  it('maps Enter to a new round and unknown keys to null', () => {
    expect(mapKeyToCommand('Enter')).toEqual({ type: 'round', command: 'new-round' })
    expect(mapKeyToCommand('Escape')).toBeNull()
  })
})

describe('bindGameInput', () => {
  it('binds only to the canvas, focuses it, and prevents recognized keys', () => {
    const canvas = document.createElement('canvas')
    const outside = document.createElement('div')
    const onCommand = vi.fn()
    const cleanup = bindGameInput(canvas, { onCommand })
    expect(canvas.tabIndex).toBe(0)
    const key = new KeyboardEvent('keydown', { key: 'd', cancelable: true })
    canvas.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    expect(onCommand).toHaveBeenCalledWith({ type: 'direction', direction: 'right' })
    const unknown = new KeyboardEvent('keydown', { key: 'x', cancelable: true })
    canvas.dispatchEvent(unknown)
    expect(unknown.defaultPrevented).toBe(false)
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', cancelable: true }))
    expect(onCommand).toHaveBeenCalledTimes(1)
    const focus = vi.spyOn(canvas, 'focus')
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(focus).toHaveBeenCalled()
    cleanup()
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true }))
    expect(onCommand).toHaveBeenCalledTimes(1)
  })
})
