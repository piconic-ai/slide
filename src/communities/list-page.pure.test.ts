import { describe, expect, it } from 'vitest'
import type { Handle } from '../share/handle'
import { toCommunityCard } from './community-card'
import { newCommunitiesBody } from './list-page'

const flat = async (markup: unknown) =>
  String(await markup).replace(/\s+/g, ' ')

describe('newCommunitiesBody', () => {
  const cards = [
    toCommunityCard({
      id: 7,
      handle: 'kanagawapm' as Handle,
      name: 'Kanagawa.pm',
      description: '',
      color: 'green',
      logoAt: null,
      coverAt: null,
    }),
  ]

  it.each([
    [1, 0, 'コミュニティは、まだありません。', []],
    [1, 1, null, []],
    [1, 51, null, ['next:/communities?page=2']],
    [2, 51, null, ['prev:/communities']],
    [
      9,
      51,
      'このページには、コミュニティがありません。',
      ['prev:/communities?page=2'],
    ],
  ] as const)(
    'F30-AC45: Given page %i of %i communities, When the list is drawn, Then it says %s and links %j',
    async (page, total, note, links) => {
      const shown = note === null ? cards : []
      const html = await flat(
        newCommunitiesBody({ cards: shown, page, total }, 'ja'),
      )
      if (note) expect(html).toContain(note)
      const found = [...html.matchAll(/rel="(prev|next)" href="([^"]+)"/g)].map(
        (match) => `${match[1]}:${match[2]}`,
      )
      expect(found).toEqual(links)
    },
  )
})
