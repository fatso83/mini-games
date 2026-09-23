import { describe, expect, it } from 'vitest'
import { initialProtocolState, reduceServerMessage } from './protocol'

describe('client protocol reducer', () => {
  it('uses canonical snapshot status and derives lobby roster', () => {
    const state = reduceServerMessage(initialProtocolState(), { cmd: 'snapshot', seq: 1, state: { status: 'lobby', players: [{ id: 'a', name: 'Ada' }] } })
    expect(state.phase).toBe('lobby')
    expect(state.roster).toEqual([{ id: 'a', name: 'Ada' }])
  })

  it('applies diff state and transitions to running only when server says so', () => {
    const lobby = reduceServerMessage(initialProtocolState(), { cmd: 'snapshot', seq: 1, state: { status: 'lobby', players: [] } })
    const running = reduceServerMessage(lobby, { cmd: 'diff', seq: 2, state: { status: 'running', players: [{ id: 'b', name: 'Bob' }] } })
    expect(running.phase).toBe('running')
    expect(running.snapshot).toMatchObject({ status: 'running' })
    expect(running.roster[0]?.name).toBe('Bob')
  })

  it('accepts an initial sequence zero snapshot and clears a prior gap', () => {
    const state = { ...initialProtocolState(), lastSeq: 2, gap: true }
    const next = reduceServerMessage(state, { cmd: 'snapshot', seq: 0, state: { status: 'lobby', players: [] } })
    expect(next.lastSeq).toBe(0)
    expect(next.gap).toBe(false)
  })

  it('exposes countdown snapshots as a distinct phase', () => {
    const state = reduceServerMessage(initialProtocolState(), { cmd: 'snapshot', seq: 1, state: { status: 'countdown', countdown: { step: 3, label: '3' }, players: [] } })
    expect(state.phase).toBe('countdown')
    expect(state.snapshot).toMatchObject({ status: 'countdown', countdown: { step: 3, label: '3' } })
  })

  it('exposes a paused session without discarding its authoritative snapshot', () => {
    const state = reduceServerMessage(initialProtocolState(), { cmd: 'snapshot', seq: 4, state: { status: 'paused', pause: { reason: 'connection_lost' }, players: [{ id: 'p1', name: 'Ada' }] } })
    expect(state.phase).toBe('paused')
    expect(state.snapshot).toMatchObject({ status: 'paused' })
  })
})
