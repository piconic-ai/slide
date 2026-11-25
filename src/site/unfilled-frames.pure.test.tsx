import { expect, test } from 'vitest'
import { viewerLinksFrame } from '../share/viewer-links-frame'
import { LANGS } from './i18n'

test.each(LANGS)(
  'Given the frames of the other works are not filled, When they are rendered in %s, Then each holds nothing at all, not even white space',
  (lang) => {
    expect([viewerLinksFrame([], lang)].map(String)).toEqual([''])
  },
)
