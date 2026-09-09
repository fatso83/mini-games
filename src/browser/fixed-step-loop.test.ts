import { describe, expect, it } from 'vitest'
import { advanceAccumulator, createFixedStepLoop } from './fixed-step-loop'

describe('advanceAccumulator', () => {
  it('advances whole ticks and preserves remainder', () => {
    expect(advanceAccumulator(0, 9, 10, 4)).toEqual({ accumulatorMs: 9, steps: 0 })
    expect(advanceAccumulator(9, 11, 10, 4)).toEqual({ accumulatorMs: 0, steps: 2 })
    expect(advanceAccumulator(0, 35, 10, 4)).toEqual({ accumulatorMs: 5, steps: 3 })
  })

  it('discards excessive accumulated time after catch-up limit', () => {
    expect(advanceAccumulator(0, 105, 10, 3)).toEqual({ accumulatorMs: 5, steps: 3 })
  })
})

describe('createFixedStepLoop', () => {
  it('renders each frame and waits a full interval after a non-running period', () => {
    let time = 0
    let running = false
    const frames: FrameRequestCallback[] = []
    let steps = 0
    let renders = 0
    let cancelled = 0
    const loop = createFixedStepLoop({
      now: () => time,
      requestFrame: (callback) => { frames.push(callback); return frames.length },
      cancelFrame: () => { cancelled += 1 },
      getTickMs: () => 10,
      shouldRun: () => running,
      onStep: () => { steps += 1 },
      onRender: () => { renders += 1 },
      maxCatchUpSteps: 4,
    })
    loop.start()
    frames.shift()!(0)
    expect(steps).toBe(0)
    running = true
    time = 10
    frames.shift()!(10)
    expect(steps).toBe(0)
    time = 20
    frames.shift()!(20)
    expect(steps).toBe(1)
    expect(renders).toBe(3)
    loop.stop()
    expect(cancelled).toBe(1)
  })

  it('clears a partial accumulator while paused and waits a full tick on resume', () => {
    let time = 0
    let running = true
    const frames: FrameRequestCallback[] = []
    let steps = 0
    const loop = createFixedStepLoop({
      now: () => time,
      requestFrame: (callback) => { frames.push(callback); return frames.length },
      cancelFrame: () => undefined,
      getTickMs: () => 10,
      shouldRun: () => running,
      onStep: () => { steps += 1 },
      onRender: () => undefined,
      maxCatchUpSteps: 4,
    })
    loop.start()
    frames.shift()!(0)
    time = 6
    frames.shift()!(6)
    running = false
    frames.shift()!(6)
    running = true
    time = 15
    frames.shift()!(15)
    expect(steps).toBe(0)
    time = 25
    frames.shift()!(25)
    expect(steps).toBe(1)
  })

  it('resetTiming discards the old baseline and requires a full interval', () => {
    let time = 0
    const frames: FrameRequestCallback[] = []
    let steps = 0
    const loop = createFixedStepLoop({
      now: () => time,
      requestFrame: (callback) => { frames.push(callback); return frames.length },
      cancelFrame: () => undefined,
      getTickMs: () => 10,
      shouldRun: () => true,
      onStep: () => { steps += 1 },
      onRender: () => undefined,
      maxCatchUpSteps: 4,
    })
    loop.start()
    frames.shift()!(0)
    time = 8
    frames.shift()!(8)
    loop.resetTiming()
    time = 9
    frames.shift()!(9)
    expect(steps).toBe(0)
    time = 19
    frames.shift()!(19)
    expect(steps).toBe(1)
  })
})
