import { expect, test } from 'vitest'
import { communitiesListFrame } from '../profile/community-frames'
import { handleSchema } from '../share/handle'
import { viewerLinksFrame } from '../share/viewer-links-frame'
import { HomeCommunitiesFrame } from './home-communities-frame'
import { LANGS } from './i18n'

const handle = handleSchema.parse('kfly8')

test.each(LANGS)(
  'Given the frames of the other works are not filled, When they are rendered in %s, Then each holds nothing at all, not even white space',
  (lang) => {
    expect(
      [
        viewerLinksFrame([], lang),
        communitiesListFrame(handle, lang),
        <HomeCommunitiesFrame lang={lang} />,
      ].map(String),
    ).toEqual(Array(3).fill(''))
  },
)
