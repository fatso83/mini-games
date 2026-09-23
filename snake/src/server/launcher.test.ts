import { describe, expect, it } from 'vitest'
import { buildWranglerArgs, chooseServerUrl, validateServerUrl } from './launcher'
import { createLauncherPlan } from '../../scripts/dev-launcher.mjs'
describe('local server URL selection', () => {
  it('accepts only safe IPv4/domain origin overrides', () => {
    expect(validateServerUrl('https://example.test/')).toBe('https://example.test')
    expect(validateServerUrl('http://x.test/path')).toBeNull()
    expect(validateServerUrl('file:///tmp/x')).toBeNull()
    expect(validateServerUrl('http://user:pass@example.test')).toBeNull()
    expect(validateServerUrl('http://[::1]')).toBeNull()
    expect(validateServerUrl('http://127.0.0.2')).toBeNull()
  })
  it('scores a public IPv4 above all private tiers', () => {
    expect(chooseServerUrl(undefined, [
      { address: '192.168.1.2', family: 'IPv4' },
      { address: '10.0.0.2', family: 'IPv4' },
      { address: '172.16.0.2', family: 'IPv4' },
      { address: '8.8.8.8', family: 'IPv4' },
    ]).baseUrl).toBe('http://8.8.8.8:5173')
  })
  it.each([
    ['192.168/16', '192.168.1.2'],
    ['10/8', '10.1.2.3'],
    ['172.16/12', '172.20.2.3'],
  ])('uses the %s private tier in the documented order', (_label, address) => {
    const interfaces = [
      { address: '172.20.1.2', family: 'IPv4' },
      { address: '10.1.1.2', family: 'IPv4' },
      { address: '192.168.1.2', family: 'IPv4' },
    ]
    expect(chooseServerUrl(undefined, interfaces).baseUrl).toBe('http://192.168.1.2:5173')
    expect(chooseServerUrl(undefined, interfaces.filter((item) => item.address !== '192.168.1.2')).baseUrl).toBe('http://10.1.1.2:5173')
    expect(chooseServerUrl(undefined, interfaces.filter((item) => item.address === '172.20.1.2')).baseUrl).toBe('http://172.20.1.2:5173')
  })
  it('rejects CGNAT, link-local, and reserved addresses before falling back', () => {
    expect(chooseServerUrl(undefined, [
      { address: '100.64.0.1', family: 'IPv4' },
      { address: '169.254.1.1', family: 'IPv4' },
      { address: '192.0.2.1', family: 'IPv4' },
      { address: '240.0.0.1', family: 'IPv4' },
    ]).source).toBe('localhost')
  })
  it('uses localhost when there is no usable IPv4 interface', () => { expect(chooseServerUrl(undefined, [{ address: '127.0.0.1', family: 'IPv4', internal: true }]).source).toBe('localhost') })
  it('passes the selected URL to Wrangler as a Worker var binding', () => {
    expect(buildWranglerArgs({ baseUrl: 'http://192.168.1.2:5173', source: 'network', bind: '0.0.0.0' })).toContainEqual('--var')
    expect(buildWranglerArgs({ baseUrl: 'http://192.168.1.2:5173', source: 'network', bind: '0.0.0.0' })).toContainEqual('SERVER_URL:http://192.168.1.2:5173')
  })
  it('smoke-tests the plain Node launcher plan without spawning Wrangler', () => {
    const plan = createLauncherPlan(undefined, [{ address: '10.0.0.22', family: 'IPv4' }])
    expect(plan.choice.baseUrl).toBe('http://10.0.0.22:5173')
    expect(plan.args).toContain('SERVER_URL:http://10.0.0.22:5173')
  })
})
