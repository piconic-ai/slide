import {
  BIO_MAX,
  checkUrl,
  LINKS_MAX,
  LOCATION_MAX,
  lengthOf,
  multiLineOf,
  NAME_MAX,
  oneLineOf,
  type UrlRefusal,
} from './profile-lines'

/** What the settings form can say about a profile, as it was typed. */
export type ProfileFields = Readonly<{
  name: string
  bio: string
  location: string
  website: string
  /** Every link field, empty ones included. */
  links: readonly string[]
  useGravatar: boolean
}>

/** What is saved: only values that passed, and nothing for an empty field. */
export type ProfileInput = Readonly<{
  name: string
  bio: string | null
  location: string | null
  website: string | null
  links: readonly string[]
  useGravatar: boolean
}>

/** One thing wrong with the form, naming the field so its message sits there. */
export type ProfileProblem =
  | Readonly<{ field: 'name'; reason: 'empty' | 'too_long' }>
  | Readonly<{ field: 'bio' | 'location'; reason: 'too_long' }>
  | Readonly<{ field: 'website'; reason: UrlRefusal }>
  | Readonly<{ field: 'link'; index: number; reason: UrlRefusal }>
  | Readonly<{ field: 'links'; reason: 'too_many' }>

export type ProfileCheck =
  | Readonly<{ kind: 'valid'; profile: ProfileInput }>
  | Readonly<{ kind: 'invalid'; problems: readonly ProfileProblem[] }>

/** A text field that may be left empty, which then stores nothing. */
function optionalText(text: string, max: number) {
  if (text === '') return { value: null, tooLong: false }
  return { value: text, tooLong: lengthOf(text) > max }
}

/** The links written, each checked, and the problems found in them. */
function checkLinks(typed: readonly string[]) {
  const written = typed
    .map((value, index) => ({ value: value.trim(), index }))
    .filter(({ value }) => value !== '')
  const problems: ProfileProblem[] = []
  const urls: string[] = []
  if (written.length > LINKS_MAX)
    problems.push({ field: 'links', reason: 'too_many' })
  for (const { value, index } of written.slice(0, LINKS_MAX)) {
    const check = checkUrl(value)
    if (check.kind === 'valid') urls.push(check.url)
    else problems.push({ field: 'link', index, reason: check.reason })
  }
  return { urls, problems }
}

/**
 * Decides whether the typed profile can be saved. The name is required;
 * every other field may be empty, and an empty one is stored as nothing. The
 * lengths count characters, an emoji as one, and the longest allowed value is
 * kept. Addresses must be `https:`. Every problem is reported at once, so
 * the author fixes the form in one go.
 */
export function checkProfile(fields: ProfileFields): ProfileCheck {
  const problems: ProfileProblem[] = []
  const name = oneLineOf(fields.name)
  if (name === '') problems.push({ field: 'name', reason: 'empty' })
  else if (lengthOf(name) > NAME_MAX)
    problems.push({ field: 'name', reason: 'too_long' })
  const bio = optionalText(multiLineOf(fields.bio), BIO_MAX)
  if (bio.tooLong) problems.push({ field: 'bio', reason: 'too_long' })
  const location = optionalText(oneLineOf(fields.location), LOCATION_MAX)
  if (location.tooLong) problems.push({ field: 'location', reason: 'too_long' })
  let website: string | null = null
  if (fields.website.trim() !== '') {
    const check = checkUrl(fields.website)
    if (check.kind === 'valid') website = check.url
    else problems.push({ field: 'website', reason: check.reason })
  }
  const links = checkLinks(fields.links)
  problems.push(...links.problems)
  if (problems.length > 0) return { kind: 'invalid', problems }
  return {
    kind: 'valid',
    profile: {
      name,
      bio: bio.value,
      location: location.value,
      website,
      links: links.urls,
      useGravatar: fields.useGravatar,
    },
  }
}

/** Longer than any field may be, so a huge body is cut before it is read. */
const FIELD_READ_MAX = 10_000

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, FIELD_READ_MAX) : ''

/**
 * The "use Gravatar" choice of a form. The form sends `0` for the unchecked
 * box and `1` after it for the checked one, so the last value decides. A form
 * that says nothing leaves the earlier choice as it was.
 */
function gravatarChoiceOf(value: unknown, earlier: boolean): boolean {
  const last = Array.isArray(value) ? value[value.length - 1] : value
  if (last === '1') return true
  if (last === '0') return false
  return earlier
}

/**
 * The profile fields of a posted form. A field that is missing or is not
 * text (a file, say) reads as empty. Text beyond what any field may hold is
 * cut, which still leaves it too long to save. Where the form does not carry
 * the Gravatar choice, the author's earlier choice carries over.
 */
export function fieldsOfForm(
  form: Readonly<Record<string, unknown>>,
  useGravatar: boolean,
): ProfileFields {
  const links = Array.isArray(form.link)
    ? form.link.map(textOf)
    : form.link === undefined
      ? []
      : [textOf(form.link)]
  return {
    name: textOf(form.name),
    bio: textOf(form.bio),
    location: textOf(form.location),
    website: textOf(form.website),
    // One more than the limit is enough to know there are too many.
    links: links.slice(0, 50),
    useGravatar: gravatarChoiceOf(form.gravatar, useGravatar),
  }
}
