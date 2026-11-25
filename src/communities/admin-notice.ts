/** What an action on the admins or the deletion left to say. */
export const ADMIN_NOTICES = [
  'admin-added',
  'admin-already',
  'admin-unknown',
  'admin-removed',
  'admin-last',
  'delete-mismatch',
] as const
export type AdminNotice = (typeof ADMIN_NOTICES)[number]

export const adminNoticeOf = (value: string | undefined): AdminNotice | null =>
  ADMIN_NOTICES.find((notice) => notice === value) ?? null

/** Whether a notice tells of something refused. */
export const isRefusal = (notice: AdminNotice) =>
  notice === 'admin-unknown' ||
  notice === 'admin-last' ||
  notice === 'delete-mismatch' ||
  notice === 'admin-already'
