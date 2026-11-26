import { expect, test } from 'vitest'
import { buildCatalog } from '../help/catalog'
import { HELP_CATALOG } from '../help/default-catalog'
import { MAINTENANCE_ARTICLE, maintenanceHelpPath } from './help-link'

test('F38-AC2: Given a help without the article on maintenance, When the link is made, Then it is the entrance of the help and not a page that is missing', () => {
  const has = HELP_CATALOG.some(
    (entry) =>
      entry.aim === MAINTENANCE_ARTICLE.aim &&
      entry.slug === MAINTENANCE_ARTICLE.slug,
  )
  expect(maintenanceHelpPath(HELP_CATALOG)).toBe(
    has ? '/help/safety/maintenance' : '/help',
  )
  expect(maintenanceHelpPath(buildCatalog([]))).toBe('/help')
})

test('F38-AC2: Given the article is written, When the link is made, Then it is the article', () => {
  const entry = HELP_CATALOG[0]!
  const only = [
    {
      ...entry,
      aim: MAINTENANCE_ARTICLE.aim,
      slug: MAINTENANCE_ARTICLE.slug,
      key: 'safety/maintenance',
      path: '/help/safety/maintenance',
    },
  ]
  expect(maintenanceHelpPath(only)).toBe('/help/safety/maintenance')
})
