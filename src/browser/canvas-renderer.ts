import type { GameState, Position } from '../game/types'

export interface BoardLayout {
  readonly cellSize: number
  readonly boardWidth: number
  readonly boardHeight: number
  readonly offsetX: number
  readonly offsetY: number
}

export interface CanvasRenderer {
  readonly render: (state: GameState) => void
}

export function calculateBoardLayout(cssWidth: number, cssHeight: number, columns: number, rows: number): BoardLayout {
  const width = Math.max(0, Number.isFinite(cssWidth) ? cssWidth : 0)
  const height = Math.max(0, Number.isFinite(cssHeight) ? cssHeight : 0)
  const cellSize = Math.max(0, Math.min(width / columns, height / rows))
  const boardWidth = cellSize * columns
  const boardHeight = cellSize * rows
  return { cellSize, boardWidth, boardHeight, offsetX: (width - boardWidth) / 2, offsetY: (height - boardHeight) / 2 }
}

function drawCell(context: CanvasRenderingContext2D, position: Position, layout: BoardLayout): void {
  context.fillRect(layout.offsetX + position.x * layout.cellSize, layout.offsetY + position.y * layout.cellSize, layout.cellSize, layout.cellSize)
}

export function createCanvasRenderer(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, getDevicePixelRatio: () => number = () => globalThis.devicePixelRatio || 1): CanvasRenderer {
  return {
    render(state) {
      const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null
      const cssWidth = rect ? rect.width : canvas.clientWidth || 0
      const cssHeight = rect ? rect.height : canvas.clientHeight || 0
      const dprValue = getDevicePixelRatio()
      const dpr = Number.isFinite(dprValue) && dprValue > 0 ? dprValue : 1
      const backingWidth = Math.round(cssWidth * dpr)
      const backingHeight = Math.round(cssHeight * dpr)
      if (canvas.width !== backingWidth) canvas.width = backingWidth
      if (canvas.height !== backingHeight) canvas.height = backingHeight
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, cssWidth, cssHeight)
      const layout = calculateBoardLayout(cssWidth, cssHeight, state.config.width, state.config.height)
      if (state.food !== null) {
        context.fillStyle = '#f4bd4f'
        drawCell(context, state.food, layout)
      }
      for (const player of Object.values(state.players)) {
        for (const [index, segment] of player.body.entries()) {
          context.fillStyle = index === 0 ? '#55d66b' : '#2d9f52'
          drawCell(context, segment, layout)
        }
      }
    },
  }
}
