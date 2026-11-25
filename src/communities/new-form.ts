import { checkHandle } from '../auth/handle-rules'
import type { HandleProblem } from '../handles/refusals'
import type { Handle } from '../share/handle'
import { parseName } from './community-input'
import { editedLinkFields, type LinkFieldView } from './link-fields'
import {
  checkCommunityLink,
  checkCommunityLinks,
  type CommunityLink,
} from './link-rules'
import type { NewCommunityForm } from './new-page'

/** A form's fields, as a body parser gives them: one value, or a list. */
export type FormBody = Readonly<Record<string, unknown>>

/** Every value of a field, as text; anything else reads as nothing. */
export const valuesOf = (body: FormBody, name: string): readonly string[] => {
  const value = body[name]
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return list.filter((item): item is string => typeof item === 'string')
}

/** The one value of a field, as text; a list or anything else reads as ''. */
export const valueOf = (body: FormBody, name: string): string => {
  const value = body[name]
  return typeof value === 'string' ? value : ''
}

/**
 * Which of the form's buttons was pressed: "remove" on a row (its number),
 * "add a link", or the one that sends it.
 */
export function editActionOf(
  body: FormBody,
): Readonly<{ remove: number | null; add: boolean }> | null {
  const remove = valueOf(body, 'remove')
  const add = valueOf(body, 'add') !== ''
  const index = /^[0-9]{1,2}$/u.test(remove) ? Number(remove) : null
  return index === null && !add ? null : { remove: index, add }
}

/** What the form to make a community reads as. */
export type NewCommunityRead =
  /** A row was added or removed: draw the form again, nothing checked. */
  | Readonly<{ kind: 'edited'; form: NewCommunityForm }>
  | Readonly<{ kind: 'refused'; form: NewCommunityForm }>
  | Readonly<{
      kind: 'valid'
      handle: Handle
      name: string
      links: readonly CommunityLink[]
      form: NewCommunityForm
    }>

/**
 * Reads the form that makes a community: the handle as `/welcome` reads it,
 * the name and the links. What was typed stays in the form, with the
 * problem of each field.
 */
export function readNewCommunityForm(body: FormBody): NewCommunityRead {
  const handleText = valueOf(body, 'handle').trim()
  const nameText = valueOf(body, 'name')
  const linkValues = valuesOf(body, 'link')
  const action = editActionOf(body)
  const base = { handle: handleText, name: nameText }
  if (action)
    return {
      kind: 'edited',
      form: {
        ...base,
        links: editedLinkFields(linkValues, action),
        problems: { handle: null, name: null, links: null },
      },
    }
  const handle = checkHandle(handleText)
  const name = parseName(nameText)
  const links = checkCommunityLinks(linkValues)
  const form: NewCommunityForm = {
    ...base,
    links: links.fields.map((field): LinkFieldView => ({
      value: field.value,
      problem: field.problem
        ? { kind: 'refused', reason: field.problem }
        : null,
    })),
    problems: {
      handle: handle.kind === 'refused' ? handle.reason : null,
      name: name.ok ? null : name.reason,
      links: links.ok ? null : links.list,
    },
  }
  if (handle.kind === 'refused' || !name.ok || !links.ok)
    return { kind: 'refused', form }
  return {
    kind: 'valid',
    handle: handle.handle,
    name: name.value,
    links: links.links,
    form,
  }
}

/** The form again, with the problem the service found on saving. */
export function withSaveProblem(
  form: NewCommunityForm,
  problem:
    | Readonly<{ kind: 'handle'; reason: HandleProblem }>
    | Readonly<{ kind: 'links'; owners: ReadonlyMap<string, Handle> }>,
): NewCommunityForm {
  if (problem.kind === 'handle')
    return { ...form, problems: { ...form.problems, handle: problem.reason } }
  return { ...form, links: markTaken(form.links, problem.owners) }
}

/** Marks each field whose link another community holds, naming it (D-34). */
export function markTaken(
  fields: readonly LinkFieldView[],
  owners: ReadonlyMap<string, Handle>,
): readonly LinkFieldView[] {
  return fields.map((field) => {
    const check = checkCommunityLink(field.value)
    const handle = check.ok ? owners.get(check.link.url) : undefined
    return handle === undefined
      ? field
      : { value: field.value, problem: { kind: 'taken', handle } }
  })
}
