import { describe, expect, it } from 'vitest'
import { SESSION_ALPHABET, createSessionCode, parseClientCommand, validDisplayName } from './protocol'

describe('session protocol utilities', () => {
  it('creates six-character codes from the safe alphabet', () => { const code = createSessionCode(() => 0.5); expect(code).toHaveLength(6); expect([...code].every((character) => SESSION_ALPHABET.includes(character))).toBe(true) })
  it('validates names while preserving display casing', () => { expect(validDisplayName(' Alice ')).toBe('Alice'); expect(validDisplayName('a'.repeat(21))).toBeNull(); expect(validDisplayName('Åke')).toBeNull() })
  it('parses the client-facing cmd protocol', () => { expect(parseClientCommand('{"cmd":"join","name":"Alice"}')).toEqual({ cmd: 'join', name: 'Alice' }); expect(parseClientCommand('{"cmd":"start"}')).toEqual({ cmd: 'start' }); expect(parseClientCommand('{"type":"start_game"}')).toBeNull() })
})
