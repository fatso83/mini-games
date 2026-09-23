export interface NetworkAddress { address: string; family: string | number; internal?: boolean }
export interface ServerUrlChoice { baseUrl: string; source: 'override' | 'network' | 'localhost'; bind: string; warning?: string }
export function validateServerUrl(value: string): string | null
export function chooseServerUrl(override: string | undefined, interfaces: NetworkAddress[]): ServerUrlChoice
export function buildWranglerArgs(choice: ServerUrlChoice): string[]
