import { buildCatalog } from './catalog'
import { HELP_REGISTRY } from './registry.generated'

/** Every article of the help, in reading order. */
export const HELP_CATALOG = buildCatalog(HELP_REGISTRY)
