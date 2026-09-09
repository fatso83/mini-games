import { describe, expect, it } from 'vitest'

describe('browser environment', () => {
  it('creates a canvas element', () => {
    expect(document.createElement('canvas')).toBeInstanceOf(HTMLCanvasElement)
  })
})
