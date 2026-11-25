import { expect, test } from 'vitest'
import { viewerEventsFrame } from '../share/viewer-events-frame'
import { viewerLinksFrame } from '../share/viewer-links-frame'
import {
  viewerSameCommunityFrame,
  viewerSameEventFrame,
} from '../share/viewer-recommendations-frame'
import { LANGS } from './i18n'

test.each(LANGS)(
  'Given the frames of the other works are not filled, When they are rendered in %s, Then each holds nothing at all, not even white space',
  (lang) => {
    expect(
      [
        viewerLinksFrame([], lang),
        viewerEventsFrame(lang),
        viewerSameEventFrame(lang),
        viewerSameCommunityFrame(lang),
      ].map(String),
    ).toEqual(Array(4).fill(''))
  },
)
