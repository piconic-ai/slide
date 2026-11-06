import type { Deployment } from '../db/schema'
import type { UploadLimits } from './limits'

type SessionClock = Pick<
  Deployment,
  'state' | 'expires_at' | 'credential_expires_at'
>

export type SessionErrorCode =
  | 'credential_expired'
  | 'session_expired'
  | 'session_failed'
  | 'session_changed'

export type CredentialCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: SessionErrorCode }

export type ResumeDecision =
  | { readonly ok: true; readonly credentialExpiresAt: number }
  | { readonly ok: false; readonly code: SessionErrorCode }

export type WriteDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: SessionErrorCode | 'immutable' }

/** True while an uploading session may still receive files. */
export function isSessionOpen(row: SessionClock, now: number): boolean {
  return row.state === 'uploading' && row.expires_at > now
}

/** A credential never outlives the session it belongs to. */
export function credentialExpiry(
  sessionExpiresAt: number,
  now: number,
  limits: Pick<UploadLimits, 'credentialSeconds'>,
): number {
  return Math.min(now + limits.credentialSeconds, sessionExpiresAt)
}

/** Decides whether a presented, matching credential may still be used. */
export function checkCredential(
  row: SessionClock,
  now: number,
): CredentialCheck {
  if (row.state === 'expired') return { ok: false, code: 'session_expired' }
  // A failed session cannot be renewed, so do not ask for re-authentication.
  if (row.state === 'failed' && row.credential_expires_at <= now)
    return { ok: false, code: 'session_failed' }
  if (row.state === 'uploading' && !isSessionOpen(row, now))
    return { ok: false, code: 'session_expired' }
  if (row.credential_expires_at <= now)
    return { ok: false, code: 'credential_expired' }
  return { ok: true }
}

/** Decides whether a file receipt or finalize may change the session. */
export function writeDecision(row: Pick<Deployment, 'state'>): WriteDecision {
  switch (row.state) {
    case 'uploading':
      return { ok: true }
    case 'ready':
      return { ok: false, code: 'immutable' }
    case 'failed':
      return { ok: false, code: 'session_failed' }
    case 'expired':
      return { ok: false, code: 'session_expired' }
  }
}

/**
 * Decides whether a fresh GitHub identity may rotate the credential of an
 * existing session. Expired or failed sessions are not resumed.
 */
export function resumeSession(
  row: SessionClock,
  now: number,
  limits: Pick<UploadLimits, 'credentialSeconds'>,
): ResumeDecision {
  switch (row.state) {
    case 'failed':
      return { ok: false, code: 'session_failed' }
    case 'expired':
      return { ok: false, code: 'session_expired' }
    case 'ready':
      return { ok: true, credentialExpiresAt: now + limits.credentialSeconds }
    case 'uploading':
      return isSessionOpen(row, now)
        ? {
            ok: true,
            credentialExpiresAt: credentialExpiry(row.expires_at, now, limits),
          }
        : { ok: false, code: 'session_expired' }
  }
}
