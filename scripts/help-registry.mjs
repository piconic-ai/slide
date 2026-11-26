// Writes src/help/registry.generated.ts: the list of the help's article files.
// The help's articles are the files src/help/articles/<aim>/<slug>.ts. The
// Worker is bundled without a way to list a directory, so this script lists
// it. Run `pnpm help:registry` after adding or removing an article file;
// `pnpm build` runs it too, and a test fails when the written file is stale.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderRegistry } from './help-registry-text.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export { renderRegistry }
export const ARTICLES_DIR = join(ROOT, 'src/help/articles')
export const REGISTRY_FILE = join(ROOT, 'src/help/registry.generated.ts')

/** `<aim>/<slug>` for every article file under a directory, sorted. */
export function articleKeys(directory = ARTICLES_DIR) {
  return readdirSync(directory, { recursive: true })
    .map((file) => String(file).replaceAll('\\', '/'))
    .filter((file) => /^[^/]+\/[^/]+\.ts$/.test(file))
    .map((file) => file.replace(/\.ts$/, ''))
    .toSorted()
}

/** Whether the written registry lists exactly the article files that exist. */
export const isCurrent = () =>
  readFileSync(REGISTRY_FILE, 'utf8') === renderRegistry(articleKeys())

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    if (!isCurrent()) {
      console.error(
        'src/help/registry.generated.ts is stale; run `pnpm help:registry`.',
      )
      process.exitCode = 1
    }
  } else writeFileSync(REGISTRY_FILE, renderRegistry(articleKeys()))
}
