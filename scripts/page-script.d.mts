export const PAGE_SCRIPT_SRC: string
export function parsePageScript(value: string | undefined): boolean
export function loadsPageScript(html: string): boolean
export function withPageScript<T extends Uint8Array>(
  path: string,
  bytes: T,
): T | Buffer
