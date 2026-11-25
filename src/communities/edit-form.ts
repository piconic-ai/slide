import {
  MAX_SITES,
  parseDescription,
  parseName,
  parseSites,
  type DescriptionRefusal,
  type NameRefusal,
  type SiteField,
} from './community-input'
import type { Community } from './community'
import {
  editedLinkFields,
  type LinkFieldView,
  type LinkListProblem,
} from './link-fields'
import { checkCommunityLinks, type CommunityLink } from './link-rules'
import { editActionOf, valueOf, valuesOf, type FormBody } from './new-form'

/** What the editing form shows: what was typed, and what is wrong. */
export type EditCommunityForm = Readonly<{
  name: string
  description: string
  sites: readonly SiteField[]
  links: readonly LinkFieldView[]
  problems: Readonly<{
    name: NameRefusal | null
    description: DescriptionRefusal | null
    links: LinkListProblem | null
  }>
}>

/** The fields of the other links, always MAX_SITES of them. */
const siteFields = (fields: readonly SiteField[]): readonly SiteField[] => [
  ...fields,
  ...Array.from({ length: Math.max(0, MAX_SITES - fields.length) }, () => ({
    value: '',
    problem: null,
  })),
]

/** The form as a community stands. */
export const editFormOf = (community: Community): EditCommunityForm => ({
  name: community.name,
  description: community.description,
  sites: siteFields(community.sites.map((value) => ({ value, problem: null }))),
  links: community.links.map((link) => ({ value: link.url, problem: null })),
  problems: { name: null, description: null, links: null },
})

export type EditCommunityRead =
  | Readonly<{ kind: 'edited'; form: EditCommunityForm }>
  | Readonly<{ kind: 'refused'; form: EditCommunityForm }>
  | Readonly<{
      kind: 'valid'
      name: string
      description: string
      sites: readonly string[]
      links: readonly CommunityLink[]
      form: EditCommunityForm
    }>

/**
 * Reads the editing form (F30-AC25): name, description, other links and
 * links. A row added or removed draws it again; otherwise every field is
 * checked and keeps what was typed.
 */
export function readEditForm(body: FormBody): EditCommunityRead {
  const nameText = valueOf(body, 'name')
  const descriptionText = valueOf(body, 'description')
  const siteValues = valuesOf(body, 'site').slice(0, MAX_SITES + 1)
  const linkValues = valuesOf(body, 'link')
  const action = editActionOf(body)
  const typedSites = siteValues.map((value) => ({ value, problem: null }))
  if (action)
    return {
      kind: 'edited',
      form: {
        name: nameText,
        description: descriptionText,
        sites: siteFields(typedSites),
        links: editedLinkFields(linkValues, action),
        problems: { name: null, description: null, links: null },
      },
    }
  const name = parseName(nameText)
  const description = parseDescription(descriptionText)
  const sites = parseSites(siteValues)
  const links = checkCommunityLinks(linkValues)
  const form: EditCommunityForm = {
    name: nameText,
    description: descriptionText,
    sites: siteFields(
      sites.ok
        ? siteValues.map((value) => ({ value, problem: null }))
        : withEmpty(siteValues, sites.fields),
    ),
    links: links.fields.map((field) => ({
      value: field.value,
      problem: field.problem
        ? { kind: 'refused', reason: field.problem }
        : null,
    })),
    problems: {
      name: name.ok ? null : name.reason,
      description: description.ok ? null : description.reason,
      links: links.ok ? null : links.list,
    },
  }
  if (!name.ok || !description.ok || !sites.ok || !links.ok)
    return { kind: 'refused', form }
  return {
    kind: 'valid',
    name: name.value,
    description: description.value,
    sites: sites.sites,
    links: links.links,
    form,
  }
}

/** The typed fields in order, the empty ones kept, with the problems of the rest. */
function withEmpty(
  values: readonly string[],
  checked: readonly SiteField[],
): readonly SiteField[] {
  let next = 0
  return values.map((value) => {
    if (value.trim() === '') return { value, problem: null }
    const field = checked[next++]
    return { value, problem: field?.problem ?? null }
  })
}
