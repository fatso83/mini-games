import { describe, expect, it } from 'vitest'
import { SESSION_ALPHABET, createSessionCode, parseClientCommand, validDisplayName, type PublicGameSummary } from './protocol'

describe('session protocol utilities', () => {
  it('creates six-character codes from the safe alphabet', () => { const code = createSessionCode(() => 0.5); expect(code).toHaveLength(6); expect([...code].every((character) => SESSION_ALPHABET.includes(character))).toBe(true) })
  it('validates and normalizes Unicode names while preserving display casing', () => { expect(validDisplayName(' Alice ')).toBe('Alice'); expect(validDisplayName('a'.repeat(21))).toBeNull(); expect(validDisplayName('A\u030Ake')).toBe('Åke'); expect(validDisplayName('Åke')).toBe('Åke'); expect(validDisplayName('山田太郎')).toBe('山田太郎'); expect(validDisplayName('😀'.repeat(20))).toBe('😀'.repeat(20)); expect(validDisplayName('😀'.repeat(21))).toBeNull(); expect(validDisplayName('Alice\nBob')).toBeNull(); expect(validDisplayName('Alice\u2028Bob')).toBeNull(); expect(validDisplayName('Alice\u2029Bob')).toBeNull() })
  it('parses the client-facing cmd protocol', () => { expect(parseClientCommand('{"cmd":"join","name":"Alice"}')).toEqual({ cmd: 'join', name: 'Alice' }); expect(parseClientCommand('{"cmd":"start"}')).toEqual({ cmd: 'start' }); expect(parseClientCommand('{"cmd":"restart"}')).toEqual({ cmd: 'restart' }); expect(parseClientCommand('{"type":"start_game"}')).toBeNull() })
  it('defines public lobby summaries without private player data', () => {
    const summary: PublicGameSummary = { code: 'ABC234', hostName: 'Alice', playerCount: 1, maxPlayers: 4 }
    expect(summary).toEqual({ code: 'ABC234', hostName: 'Alice', playerCount: 1, maxPlayers: 4 })
  })
})
