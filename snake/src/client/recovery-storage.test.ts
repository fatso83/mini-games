import { describe, expect, it } from 'vitest'
import { createRecoveryTokenStorage } from './recovery-storage'

describe('recovery token storage', () => {
  it('keeps separate recovery tokens per game code', async () => {
    const storage = createRecoveryTokenStorage()
    await storage.set('ABC234', 'token-for-abc234')
    await storage.set('DEF567', 'token-for-def567')
    expect(await storage.get('ABC234')).toBe('token-for-abc234')
    expect(await storage.get('DEF567')).toBe('token-for-def567')
  })
})
