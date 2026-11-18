import { returnToShare } from '../share/path'

export function landingOf(to: string | undefined): string {
  return to === 'settings' ? '/settings' : returnToShare(to)
}
