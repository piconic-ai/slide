/** The script a slide loads so the viewer knows which page is on screen. */
export const PAGE_SCRIPT_SRC: string
/** Parses SLIDE_PAGE_SCRIPT: empty or true adds the script, false leaves files as built. */
export function parsePageScript(value: string | undefined): boolean
/**
 * The bytes to send for `path`: an HTML document that does not load the page
 * script yet gets its tag; anything else comes back as it is, the same
 * array.
 */
export function withPageScript(path: string, bytes: Uint8Array): Uint8Array
