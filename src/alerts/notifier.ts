import type { Notice } from './notice'

/**
 * Tells an alert to whoever must act. It never rejects: a failure to send is
 * logged by the sender, and the work that raised the alert goes on (D-58).
 * Work M builds the sender; code that raises alerts calls this type.
 */
export type Notifier = (notice: Notice) => Promise<void>

/** The sender used until there is a real one: it sends nothing and says nothing. */
export const noopNotifier: Notifier = async () => {}
