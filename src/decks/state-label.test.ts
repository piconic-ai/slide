import { expect, test } from 'vitest'
import { stateLabel } from './history'

test('Given a ready deployment, When labeled, Then the upload state does not claim a publication state', () => {
  // Publication is shown separately; a ready version may be public.
  expect(stateLabel('ready', 'ja')).toBe('受領完了')
})
