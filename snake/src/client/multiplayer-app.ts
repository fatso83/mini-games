import QRCode from 'qrcode'
import { createDisplayNameStorage } from './name-storage'
import { initialProtocolState, parseServerMessage, reduceServerMessage, type ClientProtocolState } from './protocol'

export interface MultiplayerAppOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly WebSocket?: typeof globalThis.WebSocket
  readonly location?: Location
}

type Point = { readonly x: number; readonly y: number }

function drawSnapshot(canvas: HTMLCanvasElement, snapshot: Record<string, unknown>): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const width = canvas.clientWidth || canvas.width || 400
  const height = canvas.clientHeight || canvas.height || 400
  const config = snapshot.config as { width?: number; height?: number } | undefined
  const columns = config?.width || 20
  const rows = config?.height || 20
  const cell = Math.min(width / columns, height / rows)
  const point = (value: unknown): Point | null => {
    if (!value || typeof value !== 'object') return null
    const candidate = value as { x?: unknown; y?: unknown }
    return typeof candidate.x === 'number' && typeof candidate.y === 'number' ? { x: candidate.x, y: candidate.y } : null
  }
  canvas.width = Math.round(width)
  canvas.height = Math.round(height)
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#0d1c12'
  context.fillRect(0, 0, width, height)
  const obstacles = Array.isArray(snapshot.obstacles) ? snapshot.obstacles : []
  context.fillStyle = '#30483b'
  obstacles.forEach(value => { const obstacle = point(value); if (obstacle) context.fillRect(obstacle.x * cell, obstacle.y * cell, cell, cell) })
  const players = snapshot.players && typeof snapshot.players === 'object' ? Object.values(snapshot.players as Record<string, unknown>) : []
  players.forEach((value, playerIndex) => {
    const body = value && typeof value === 'object' && Array.isArray((value as { body?: unknown }).body) ? (value as { body: unknown[] }).body : []
    body.forEach((cellValue, index) => {
      const cellPosition = point(cellValue)
      if (!cellPosition) return
      context.fillStyle = index === 0 ? (playerIndex === 0 ? '#55d66b' : '#62b6ff') : '#2d9f52'
      context.fillRect(cellPosition.x * cell, cellPosition.y * cell, cell, cell)
    })
  })
  const food = point(snapshot.food)
  if (food) {
    context.fillStyle = '#f4bd4f'
    context.fillRect(food.x * cell, food.y * cell, cell, cell)
  }
}

function websocketUrl(code: string, location: Location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/api/sessions/${encodeURIComponent(code)}/socket`
}

export function mountMultiplayerApp(root: HTMLElement, mode: 'host' | 'join', initialCode: string | null = null, options: MultiplayerAppOptions = {}): () => void {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const WebSocketClass = options.WebSocket ?? globalThis.WebSocket
  const location = options.location ?? globalThis.location
  const names = createDisplayNameStorage()
  let socket: WebSocket | null = null
  let protocol: ClientProtocolState = initialProtocolState()
  let destroyed = false
  root.className = 'snake-app'
  root.innerHTML = `<section class="snake-card multiplayer-card" aria-label="Flerspiller">
    <p class="eyebrow">Flerspiller</p><h1>${mode === 'host' ? 'Opprett spill' : 'Bli med i spill'}</h1>
    <form data-multiplayer-form>${mode === 'join' ? '<label>Spillkode<input name="code" maxlength="6" pattern="[A-Za-z0-9]{6}" required autocomplete="off"></label>' : ''}
      <label>Navn<input name="name" maxlength="24" required autocomplete="nickname"></label><button type="submit">${mode === 'host' ? 'Opprett spill' : 'Bli med'}</button></form>
      <div data-room hidden><p class="room-code" data-room-code></p><p data-share></p><button type="button" data-copy>Copy share link</button><canvas data-qr aria-label="QR-kode"></canvas><div class="snake-board-wrap multiplayer-board-wrap"><canvas class="snake-board" data-remote-board tabindex="0" aria-label="Flerspillerbrett"></canvas></div>
      <p data-room-status aria-live="polite">Venter…</p><ul data-roster></ul><button type="button" data-start hidden>Start spill</button></div>
    <button type="button" data-back>Tilbake</button></section>`
  const form = root.querySelector<HTMLFormElement>('[data-multiplayer-form]')!
  const room = root.querySelector<HTMLElement>('[data-room]')!
  const status = root.querySelector<HTMLElement>('[data-room-status]')!
  const roster = root.querySelector<HTMLElement>('[data-roster]')!
  const board = root.querySelector<HTMLCanvasElement>('[data-remote-board]')!
  const qr = root.querySelector<HTMLCanvasElement>('[data-qr]')!
  const start = root.querySelector<HTMLButtonElement>('[data-start]')!
  const copy = root.querySelector<HTMLButtonElement>('[data-copy]')!
  if (initialCode) { const codeField = form.elements.namedItem('code') as HTMLInputElement | null; if (codeField) codeField.value = initialCode.toUpperCase() }
  void names.get().then(name => { const field = form.elements.namedItem('name') as HTMLInputElement | null; if (field && name) field.value = name })

  const connect = (code: string, name: string): void => {
    if (destroyed) return
    const normalizedCode = code.trim().toUpperCase()
    void names.set(name)
    room.hidden = false
    form.hidden = true
    root.querySelector<HTMLElement>('[data-room-code]')!.textContent = `Spillkode: ${normalizedCode}`
    const shareUrl = `${location.origin}/join?game=${encodeURIComponent(normalizedCode)}`
    root.querySelector<HTMLElement>('[data-share]')!.textContent = shareUrl
    copy.onclick = () => { void navigator.clipboard?.writeText(shareUrl); copy.textContent = 'Copied!' }
    start.hidden = mode !== 'host'
    void QRCode.toCanvas(qr, shareUrl).catch(() => undefined)
    socket = new WebSocketClass(websocketUrl(normalizedCode, location))
    socket.onopen = () => { protocol = { ...protocol, connected: true, phase: 'lobby' }; socket?.send(JSON.stringify({ cmd: 'join', name })) }
    socket.onmessage = event => {
      const message = parseServerMessage(String(event.data))
      if (!message) return
      protocol = reduceServerMessage(protocol, message)
      const authoritativeState = protocol.snapshot
      start.hidden = !(protocol.phase === 'lobby' && authoritativeState?.hostId === protocol.selfPlayerId)
      if (protocol.phase === 'ended') {
        const winner = authoritativeState?.winnerId
        const winnerPlayer = winner && Array.isArray(authoritativeState?.players) ? (authoritativeState.players as Array<Record<string, unknown>>).find(player => player.id === winner) : null
        status.textContent = winner ? `Runden er ferdig – vinner: ${String(winnerPlayer?.name ?? winner)}` : 'Runden er ferdig.'
      } else status.textContent = protocol.error ?? (protocol.gap ? 'Mangler oppdateringer – venter på ny status.' : protocol.phase === 'running' ? 'Spillet pågår' : 'Venter på spillere')
      if (protocol.phase === 'running' && document.activeElement !== board) board.focus()
      roster.replaceChildren(...protocol.roster.map(player => { const item = document.createElement('li'); item.textContent = String(player.name ?? player.id ?? 'Spiller'); return item }))
      if (protocol.snapshot) drawSnapshot(board, protocol.snapshot)
    }
    socket.onerror = () => { status.textContent = 'Kunne ikke koble til spillet.' }
    socket.onclose = () => { if (!destroyed && protocol.phase !== 'ended') status.textContent = 'Tilkoblingen ble avsluttet.' }
  }
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    const code = String(data.get('code') || initialCode || '').trim().toUpperCase()
    if (!name) return
    if (mode === 'join') { if (code) connect(code, name); return }
    void fetcher('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then(response => { if (!response.ok) throw new Error('session'); return response.json() as Promise<{ code: string }> }).then(result => connect(result.code, name)).catch(() => { status.textContent = 'Kunne ikke opprette spill.' })
  }
  form.addEventListener('submit', submit)
  start.addEventListener('click', () => socket?.send(JSON.stringify({ cmd: 'start' })))
  const onKey = (event: KeyboardEvent): void => { const key = event.key.length === 1 ? event.key.toLowerCase() : event.key; const directions: Record<string, string> = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' }; const direction = directions[key]; if (direction && socket && protocol.phase === 'running') { event.preventDefault(); socket.send(JSON.stringify({ cmd: 'direction', direction })) } }
  board.addEventListener('keydown', onKey)
  root.querySelector('[data-back]')!.addEventListener('click', () => { socket?.close(); window.history.pushState({}, '', '/'); root.dispatchEvent(new CustomEvent('snake:navigate-home')) })
  return () => { destroyed = true; form.removeEventListener('submit', submit); board.removeEventListener('keydown', onKey); socket?.close() }
}
