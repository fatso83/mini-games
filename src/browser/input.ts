import type { Direction } from '../game/types'
import type { RoundCommand } from '../game/commands'

export type GameInputCommand =
  | { readonly type: 'direction'; readonly direction: Direction }
  | { readonly type: 'round'; readonly command: RoundCommand }

export interface GameInputHandlers {
  readonly onCommand: (command: GameInputCommand) => void
}

const directionByKey: Readonly<Record<string, Direction>> = {
  arrowup: 'up', w: 'up',
  arrowdown: 'down', s: 'down',
  arrowleft: 'left', a: 'left',
  arrowright: 'right', d: 'right',
}

export function mapKeyToCommand(key: string): GameInputCommand | null {
  const normalized = key.toLowerCase()
  const direction = directionByKey[normalized]
  if (direction) return { type: 'direction', direction }
  if (key === ' ' || key === 'Spacebar') return { type: 'round', command: 'toggle-pause' }
  if (key === 'Enter') return { type: 'round', command: 'new-round' }
  return null
}

export function bindGameInput(canvas: HTMLCanvasElement, handlers: GameInputHandlers): () => void {
  canvas.tabIndex = 0
  const onKeyDown = (event: KeyboardEvent): void => {
    const command = mapKeyToCommand(event.key)
    if (!command) return
    event.preventDefault()
    handlers.onCommand(command)
  }
  const onClick = (): void => { canvas.focus() }
  canvas.addEventListener('keydown', onKeyDown)
  canvas.addEventListener('click', onClick)
  return () => {
    canvas.removeEventListener('keydown', onKeyDown)
    canvas.removeEventListener('click', onClick)
  }
}
