import { networkInterfaces } from 'node:os'
import { spawn } from 'node:child_process'
import { buildWranglerArgs, chooseServerUrl } from './launcher-core.mjs'

export function createLauncherPlan(override, interfaces) {
  const choice = chooseServerUrl(override, interfaces)
  return { choice, args: buildWranglerArgs(choice) }
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const interfaces = Object.values(networkInterfaces()).flatMap((values) => values ?? [])
  const { choice, args } = createLauncherPlan(process.env.SERVER_URL, interfaces)
  console.log(`SERVER_URL=${choice.baseUrl} source=${choice.source} bind=${choice.bind}`)
  if (choice.warning) console.warn(choice.warning)
  const child = spawn('npx', args, { stdio: 'inherit', env: { ...process.env, SERVER_URL: choice.baseUrl } })
  child.on('exit', (code) => process.exit(code ?? 1))
}
