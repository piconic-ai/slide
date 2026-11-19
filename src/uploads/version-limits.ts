/**
 * How large one version may be by default. Kept free of other modules, so
 * the sender in the browser can refuse a drop by the same numbers before it
 * sends anything. The service applies its configured limits whatever the
 * sender checked.
 */
export const VERSION_LIMITS = Object.freeze({
  /** All files of one version together. */
  deploymentBytes: 10 * 1024 * 1024,
  /** One file. */
  fileBytes: 5 * 1024 * 1024,
  /** How many files one version holds. */
  files: 100,
})
export type VersionLimits = Readonly<{
  deploymentBytes: number
  fileBytes: number
  files: number
}>
