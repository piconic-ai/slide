/**
 * What macOS adds to a zip it makes: a folder of resource forks
 * (`__MACOSX`), the Finder's notes on each folder (`.DS_Store`), and, on
 * disks that cannot hold them otherwise, a resource fork beside each file
 * (`._name`, AppleDouble). None is part of the slide.
 */
const isFinderFile = (path: string): boolean => {
  const segments = path.split('/')
  const name = segments.at(-1) ?? ''
  return (
    segments.includes('__MACOSX') ||
    name === '.DS_Store' ||
    name.startsWith('._')
  )
}

export type Root =
  /** `prefix` is '' for the top of the zip, or `folder/`. */
  | Readonly<{ ok: true; prefix: string; paths: readonly string[] }>
  | Readonly<{ ok: false }>

/**
 * Where a zip's slide starts: the top, when index.html is there; else the
 * one folder everything is in, when index.html is at its top. `paths` are
 * the slide's files below that root, without what macOS added. With no
 * such root the zip is not a slide this service can open.
 */
export function chooseRoot(all: readonly string[]): Root {
  const paths = all.filter((path) => !isFinderFile(path))
  if (paths.includes('index.html')) return { ok: true, prefix: '', paths }
  const folders = new Set(paths.map((path) => path.split('/')[0]))
  const [folder] = folders
  if (folders.size !== 1 || folder === undefined) return { ok: false }
  const prefix = `${folder}/`
  // A file at the top named like the folder has no slash after it.
  if (!paths.every((path) => path.startsWith(prefix))) return { ok: false }
  const below = paths.map((path) => path.slice(prefix.length))
  return below.includes('index.html')
    ? { ok: true, prefix, paths: below }
    : { ok: false }
}
