import type { NetworkAddress, ServerUrlChoice } from './launcher-core.mjs'
export function createLauncherPlan(override: string | undefined, interfaces: NetworkAddress[]): { choice: ServerUrlChoice; args: string[] }
