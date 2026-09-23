import QRCode from 'qrcode'
import { createDisplayNameStorage } from './name-storage'
import { initialProtocolState, parseServerMessage, reduceServerMessage, type ClientProtocolState } from './protocol'

export interface MultiplayerAppOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly WebSocket?: typeof globalThis.WebSocket
  readonly location?: Location
}

type Point = { readonly x: number; readonly y: number }

export interface CountdownView {
  readonly step: 3 | 2 | 1 | 0
  readonly label: '3' | '2' | '1' | 'Gå'
  readonly startedAt: number
  readonly endsAt: number
}

export function countdownFontSize(countdown: CountdownView, now: number, boardHeight: number): number {
  const duration = Math.max(1, countdown.endsAt - countdown.startedAt)
  const progress = Math.max(0, Math.min(1, (now - countdown.startedAt) / duration))
  return Math.round(boardHeight * (0.8 - progress * 0.4))
}

function firstVisibleCharacter(name: unknown): string {
  const character = Array.from(typeof name === 'string' ? name : '').find(value => !/^\s$/u.test(value))
  return character ? character.toLocaleUpperCase() : '?'
}

function drawSnapshot(canvas: HTMLCanvasElement, snapshot: Record<string, unknown>, selfPlayerId: string | null = null, now = globalThis.performance?.now?.() ?? Date.now()): void {
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
  const pixelWidth = Math.round(width)
  const pixelHeight = Math.round(height)
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#0d1c12'
  context.fillRect(0, 0, width, height)
  const obstacles = Array.isArray(snapshot.obstacles) ? snapshot.obstacles : []
  context.fillStyle = '#30483b'
  obstacles.forEach(value => { const obstacle = point(value); if (obstacle) context.fillRect(obstacle.x * cell, obstacle.y * cell, cell, cell) })
  const players = Array.isArray(snapshot.players)
    ? snapshot.players
    : snapshot.players && typeof snapshot.players === 'object' ? Object.values(snapshot.players as Record<string, unknown>) : []
  players.forEach((value, playerIndex) => {
    const player = value && typeof value === 'object' ? value as { id?: unknown; name?: unknown; displayName?: unknown; status?: unknown; body?: unknown } : {}
    const body = Array.isArray(player.body) ? player.body : []
    const isSelf = typeof player.id === 'string' && player.id === selfPlayerId && player.status === 'active'
    const pulse = 0.5 + 0.5 * Math.sin(now / 150)
    context.shadowBlur = isSelf ? 5 + pulse * 10 : 0
    context.shadowColor = isSelf ? '#8dff9f' : 'transparent'
    body.forEach((cellValue, index) => {
      const cellPosition = point(cellValue)
      if (!cellPosition) return
      context.fillStyle = index === 0 ? (playerIndex === 0 ? '#55d66b' : '#62b6ff') : '#2d9f52'
      if (isSelf) context.globalAlpha = 0.78 + pulse * 0.22
      context.fillRect(cellPosition.x * cell, cellPosition.y * cell, cell, cell)
      if (index === 0) {
        const label = firstVisibleCharacter(player.name ?? player.displayName)
        const centerX = (cellPosition.x + 0.5) * cell
        const centerY = (cellPosition.y + 0.5) * cell
        context.font = `700 ${Math.max(10, cell * 0.65)}px system-ui, sans-serif`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.lineWidth = Math.max(2, cell * 0.12)
        context.strokeStyle = '#07100a'
        context.fillStyle = '#f4fff6'
        context.strokeText?.(label, centerX, centerY)
        context.fillText?.(label, centerX, centerY)
      }
    })
    context.globalAlpha = 1
    context.shadowBlur = 0
    context.shadowColor = 'transparent'
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

export function normalizeShareBase(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback
    return parsed.origin.replace(/\/$/, '')
  } catch { return fallback }
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
      <div data-room hidden><p class="room-code" data-room-code></p><p data-share></p><button type="button" data-copy>Copy share link</button><canvas data-qr aria-label="QR-kode"></canvas><div class="snake-board-wrap multiplayer-board-wrap"><canvas class="snake-board" data-remote-board tabindex="0" aria-label="Flerspillerbrett"></canvas><p class="countdown-overlay" data-countdown-overlay aria-live="assertive" aria-atomic="true" hidden><span data-countdown-label></span></p></div>
      <p data-room-status aria-live="polite">Venter…</p><ul data-roster></ul><button type="button" data-start hidden>Start spill</button></div>
    <button type="button" data-back>Tilbake</button></section>`
  const form = root.querySelector<HTMLFormElement>('[data-multiplayer-form]')!
  const room = root.querySelector<HTMLElement>('[data-room]')!
  const status = root.querySelector<HTMLElement>('[data-room-status]')!
  const roster = root.querySelector<HTMLElement>('[data-roster]')!
  const board = root.querySelector<HTMLCanvasElement>('[data-remote-board]')!
  const countdownOverlay = root.querySelector<HTMLElement>('[data-countdown-overlay]')!
  const countdownLabel = root.querySelector<HTMLElement>('[data-countdown-label]')!
  const qr = root.querySelector<HTMLCanvasElement>('[data-qr]')!
  const start = root.querySelector<HTMLButtonElement>('[data-start]')!
  const copy = root.querySelector<HTMLButtonElement>('[data-copy]')!
  let animationFrame: number | null = null
  let lastCountdownLabel: string | null = null

  const hasOwnSnake = (): boolean => {
    if (!protocol.snapshot || !protocol.selfPlayerId) return false
    const players = Array.isArray(protocol.snapshot.players)
      ? protocol.snapshot.players
      : protocol.snapshot.players && typeof protocol.snapshot.players === 'object' ? Object.values(protocol.snapshot.players as Record<string, unknown>) : []
    return players.some(value => value && typeof value === 'object' && (value as { id?: unknown; status?: unknown }).id === protocol.selfPlayerId && (value as { status?: unknown }).status === 'active' && Array.isArray((value as { body?: unknown }).body) && (value as { body: unknown[] }).body.length > 0)
  }

  const shouldAnimate = (): boolean => protocol.snapshot !== null && (protocol.phase === 'countdown' || (protocol.phase === 'running' && hasOwnSnake()))

  const cancelRedraw = (): void => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    animationFrame = null
  }

  const updateCountdown = (now: number): void => {
    const countdown = protocol.phase === 'countdown' && protocol.snapshot?.countdown && typeof protocol.snapshot.countdown === 'object'
      ? protocol.snapshot.countdown as CountdownView
      : null
    if (!countdown) {
      countdownOverlay.hidden = true
      lastCountdownLabel = null
      return
    }
    countdownOverlay.hidden = false
    if (lastCountdownLabel !== countdown.label) {
      countdownLabel.textContent = countdown.label
      lastCountdownLabel = countdown.label
    }
    const boardHeight = board.clientHeight || board.height || 400
    countdownLabel.style.fontSize = `${countdownFontSize(countdown, now, boardHeight)}px`
  }

  const renderFrame = (now: number): void => {
    animationFrame = null
    if (destroyed || !protocol.snapshot) return
    drawSnapshot(board, protocol.snapshot, protocol.selfPlayerId, now)
    updateCountdown(Date.now())
    if (shouldAnimate()) animationFrame = requestAnimationFrame(renderFrame)
  }

  const requestRedraw = (): void => {
    if (animationFrame === null && shouldAnimate()) animationFrame = requestAnimationFrame(renderFrame)
  }
  if (initialCode) { const codeField = form.elements.namedItem('code') as HTMLInputElement | null; if (codeField) codeField.value = initialCode.toUpperCase() }
  void names.get().then(name => { const field = form.elements.namedItem('name') as HTMLInputElement | null; if (field && name) field.value = name })

  const connect = (code: string, name: string, shareUrlBase = location.origin): void => {
    if (destroyed) return
    const normalizedCode = code.trim().toUpperCase()
    void names.set(name)
    room.hidden = false
    form.hidden = true
    root.querySelector<HTMLElement>('[data-room-code]')!.textContent = `Spillkode: ${normalizedCode}`
    const shareUrl = `${normalizeShareBase(shareUrlBase, location.origin)}/join?game=${encodeURIComponent(normalizedCode)}`
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
      } else status.textContent = protocol.error ?? (protocol.gap ? 'Mangler oppdateringer – venter på ny status.' : protocol.phase === 'running' ? 'Spillet pågår' : protocol.phase === 'countdown' ? 'Spillet starter…' : 'Venter på spillere')
      if (protocol.phase === 'running' && document.activeElement !== board) board.focus()
      roster.replaceChildren(...protocol.roster.map(player => { const item = document.createElement('li'); item.textContent = String(player.name ?? player.id ?? 'Spiller'); return item }))
      if (protocol.snapshot) {
        drawSnapshot(board, protocol.snapshot, protocol.selfPlayerId)
        updateCountdown(Date.now())
        if (shouldAnimate()) requestRedraw()
        else cancelRedraw()
      }
    }
    socket.onerror = () => { status.textContent = 'Kunne ikke koble til spillet.' }
    socket.onclose = () => {
      if (destroyed) return
      cancelRedraw()
      protocol = { ...protocol, snapshot: null }
      countdownOverlay.hidden = true
      if (protocol.phase !== 'ended') status.textContent = 'Tilkoblingen ble avsluttet.'
    }
  }
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    const code = String(data.get('code') || initialCode || '').trim().toUpperCase()
    if (!name) return
    if (mode === 'join') { if (code) connect(code, name); return }
    void fetcher('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then(response => { if (!response.ok) throw new Error('session'); return response.json() as Promise<{ code: string; shareUrlBase?: string }> }).then(result => connect(result.code, name, result.shareUrlBase)).catch(() => { status.textContent = 'Kunne ikke opprette spill.' })
  }
  form.addEventListener('submit', submit)
  start.addEventListener('click', () => socket?.send(JSON.stringify({ cmd: 'start' })))
  const onKey = (event: KeyboardEvent): void => { const key = event.key.length === 1 ? event.key.toLowerCase() : event.key; const directions: Record<string, string> = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' }; const direction = directions[key]; if (direction && socket && protocol.phase === 'running') { event.preventDefault(); socket.send(JSON.stringify({ cmd: 'direction', direction })) } }
  board.addEventListener('keydown', onKey)
  root.querySelector('[data-back]')!.addEventListener('click', () => { socket?.close(); window.history.pushState({}, '', '/'); root.dispatchEvent(new CustomEvent('snake:navigate-home')) })
  return () => {
    destroyed = true
    form.removeEventListener('submit', submit)
    board.removeEventListener('keydown', onKey)
    cancelRedraw()
    socket?.close()
  }
}
