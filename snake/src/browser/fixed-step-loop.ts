export interface AdvanceResult {
  readonly accumulatorMs: number
  readonly steps: number
}

export function advanceAccumulator(
  accumulatorMs: number,
  elapsedMs: number,
  tickMs: number,
  maxCatchUpSteps: number,
): AdvanceResult {
  if (!Number.isFinite(accumulatorMs) || accumulatorMs < 0) throw new RangeError('accumulatorMs must be non-negative')
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('elapsedMs must be non-negative')
  if (!Number.isFinite(tickMs) || tickMs <= 0) throw new RangeError('tickMs must be positive')
  if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps < 0) throw new RangeError('maxCatchUpSteps must be a non-negative integer')
  let accumulated = accumulatorMs + elapsedMs
  let steps = 0
  while (accumulated >= tickMs && steps < maxCatchUpSteps) {
    accumulated -= tickMs
    steps += 1
  }
  // Keep a sub-tick remainder, dropping any backlog beyond the catch-up limit.
  if (accumulated >= tickMs) accumulated %= tickMs
  return { accumulatorMs: accumulated, steps }
}

export interface FixedStepLoopOptions {
  readonly now: () => number
  readonly requestFrame: (callback: FrameRequestCallback) => number
  readonly cancelFrame: (handle: number) => void
  readonly getTickMs: () => number
  readonly shouldRun: () => boolean
  readonly onStep: () => void
  readonly onRender: () => void
  readonly maxCatchUpSteps: number
}

export interface FixedStepLoop {
  readonly start: () => void
  readonly stop: () => void
  readonly resetTiming: () => void
}

export function createFixedStepLoop(options: FixedStepLoopOptions): FixedStepLoop {
  let active = false
  let frameHandle: number | null = null
  let lastNow: number | null = null
  let accumulatorMs = 0

  const resetTiming = (): void => {
    accumulatorMs = 0
    lastNow = null
  }

  const frame = (): void => {
    frameHandle = null
    if (!active) return
    const current = options.now()
    if (!options.shouldRun()) {
      resetTiming()
    } else if (lastNow === null) {
      lastNow = current
    } else {
      const result = advanceAccumulator(accumulatorMs, Math.max(0, current - lastNow), options.getTickMs(), options.maxCatchUpSteps)
      accumulatorMs = result.accumulatorMs
      lastNow = current
      for (let index = 0; index < result.steps; index += 1) options.onStep()
    }
    options.onRender()
    frameHandle = options.requestFrame(() => frame())
  }

  return {
    start: () => {
      if (active) return
      active = true
      resetTiming()
      frameHandle = options.requestFrame(() => frame())
    },
    stop: () => {
      if (!active) return
      active = false
      if (frameHandle !== null) options.cancelFrame(frameHandle)
      frameHandle = null
      resetTiming()
    },
    resetTiming,
  }
}
