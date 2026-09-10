import { applyRoundCommand, queueDirection } from './game/commands'
import { DEFAULT_GAME_CONFIG } from './game/config'
import { createGame } from './game/create-game'
import { stepGame } from './game/step-game'
import type { GameState, RandomSource } from './game/types'
import { createCanvasRenderer } from './browser/canvas-renderer'
import { createFixedStepLoop } from './browser/fixed-step-loop'
import { bindGameInput, type GameInputCommand } from './browser/input'
import './styles.css'

export interface AppDependencies {
  readonly random: RandomSource
  readonly now: () => number
  readonly requestFrame: (callback: FrameRequestCallback) => number
  readonly cancelFrame: (handle: number) => void
  readonly getCanvasContext: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null
  readonly devicePixelRatio: () => number
}

export interface MountedGame {
  readonly destroy: () => void
  readonly getState: () => GameState
}

const PLAYER_ID = 'local'
const statusLabel = (status: GameState['status']): string => ({ ready: 'Klar', running: 'Pågår', paused: 'Pause', lost: 'Tapt', won: 'Seier' })[status]

function createView(root: HTMLElement): { canvas: HTMLCanvasElement; score: HTMLElement; status: HTMLElement; newRound: HTMLButtonElement; error: HTMLElement } {
  const existingCanvas = root.querySelector<HTMLCanvasElement>('canvas')
  root.classList.add('snake-app')
  root.innerHTML = `<section class="snake-card" aria-label="Snake-spill">
    <header class="snake-header"><div><p class="eyebrow">Nettlespill</p><h1 id="game-title">Snake</h1></div><dl class="snake-score"><dt>Poeng</dt><dd data-score>0</dd></dl></header>
    <p class="snake-status" id="game-status" data-status aria-live="polite">Klar</p>
    <div class="snake-board-wrap"><p class="snake-error" data-error role="alert" hidden></p></div>
    <div class="snake-actions"><button type="button" data-new-round>Ny runde</button></div>
    <p class="snake-instructions" id="game-instructions">Bruk piltaster eller WASD for å styre. Mellomrom pauser og fortsetter.</p>
  </section>`
  const boardWrap = root.querySelector<HTMLElement>('.snake-board-wrap')!
  const canvas = existingCanvas ?? document.createElement('canvas')
  canvas.classList.add('snake-board')
  if (!canvas.width) canvas.width = 400
  if (!canvas.height) canvas.height = 400
  if (!canvas.getAttribute('aria-label')) canvas.setAttribute('aria-label', 'Snake-spillflate')
  canvas.setAttribute('role', 'application')
  canvas.setAttribute('aria-labelledby', 'game-title')
  canvas.setAttribute('aria-describedby', 'game-status game-instructions')
  boardWrap.prepend(canvas)
  return { canvas, score: root.querySelector('[data-score]')!, status: root.querySelector('[data-status]')!, newRound: root.querySelector('[data-new-round]')!, error: root.querySelector('[data-error]')! }
}

export function mountGame(root: HTMLElement, deps: AppDependencies): MountedGame {
  const view = createView(root)
  let state = createGame({ config: DEFAULT_GAME_CONFIG, playerIds: [PLAYER_ID], random: deps.random })
  let destroyed = false
  const updateDom = (): void => { view.score.textContent = String(state.players[PLAYER_ID]?.score ?? 0); view.status.textContent = statusLabel(state.status) }
  updateDom()
  let renderer: ReturnType<typeof createCanvasRenderer> | null = null
  try {
    const context = deps.getCanvasContext(view.canvas)
    if (!context) throw new Error('Canvas 2D-kontekst er ikke tilgjengelig')
    renderer = createCanvasRenderer(view.canvas, context, deps.devicePixelRatio)
  } catch (error) {
    view.error.hidden = false
    view.error.textContent = 'Kan ikke starte spillet: Canvas-grafikk er ikke tilgjengelig.'
    view.newRound.disabled = true
    const instructions = root.querySelector<HTMLElement>('.snake-instructions')
    if (instructions) instructions.hidden = true
    console.error(error)
    return { destroy: () => undefined, getState: () => state }
  }
  const render = (): void => { renderer?.render(state); updateDom() }
  const loop = createFixedStepLoop({
    now: deps.now, requestFrame: deps.requestFrame, cancelFrame: deps.cancelFrame,
    getTickMs: () => state.tickIntervalMs, shouldRun: () => state.status === 'running',
    onStep: () => {
      const beforeRunning = state.status === 'running'
      state = stepGame(state, PLAYER_ID, deps.random)
      if (beforeRunning !== (state.status === 'running')) loop.resetTiming()
      updateDom()
    }, onRender: render, maxCatchUpSteps: 5,
  })
  const applyCommand = (command: GameInputCommand): void => {
    if (destroyed) return
    const beforeRunning = state.status === 'running'
    if (command.type === 'direction') state = queueDirection(state, PLAYER_ID, command.direction)
    else if (command.command === 'new-round') {
      if (state.status !== 'lost' && state.status !== 'won') return
      state = applyRoundCommand(state, command.command, deps.random)
    } else state = applyRoundCommand(state, command.command, deps.random)
    if (beforeRunning !== (state.status === 'running')) loop.resetTiming()
    render()
  }
  const unbindInput = bindGameInput(view.canvas, { onCommand: (command) => {
    if (command.type === 'round' && command.command === 'new-round' && state.status !== 'lost' && state.status !== 'won') return
    applyCommand(command)
  } })
  const onNewRound = (): void => {
    const beforeRunning = state.status === 'running'
    state = applyRoundCommand(state, 'new-round', deps.random)
    if (beforeRunning !== (state.status === 'running')) loop.resetTiming()
    render(); view.canvas.focus()
  }
  view.newRound.addEventListener('click', onNewRound)
  render(); loop.start()
  return { destroy: () => { if (destroyed) return; destroyed = true; loop.stop(); unbindInput(); view.newRound.removeEventListener('click', onNewRound) }, getState: () => state }
}

const app = document.querySelector<HTMLElement>('#app')
if (app) mountGame(app, { random: () => Math.random(), now: () => performance.now(), requestFrame: (callback) => requestAnimationFrame(callback), cancelFrame: (handle) => cancelAnimationFrame(handle), getCanvasContext: (canvas) => canvas.getContext('2d'), devicePixelRatio: () => globalThis.devicePixelRatio || 1 })
