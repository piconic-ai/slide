import { MAX_OTHER_DECKS } from '../articles/embed-decks'
import { MAX_ARTICLE_CHARS } from '../articles/markdown'
import { CODE_ATTEMPTS, CODE_LENGTH, CODE_SECONDS } from '../auth/login-policy'
import { MAX_ARGUMENT_BYTES } from '../mcp/files'
import { MAX_LINKS, MAX_TITLE_LENGTH } from '../links/link'
import { PICTURE_MAX_BYTES, PICTURE_SIDE } from '../profile/picture-policy'
import {
  BIO_MAX,
  LINKS_MAX,
  LOCATION_MAX,
  NAME_MAX,
} from '../profile/profile-lines'
import { LINK_SCAN_BYTES } from '../citations/citation'
import { DECKS_SHOWN } from '../citations/citing'
import { MAX_SHOT_PAGE } from '../covers/shot'
import { MAX_SLUG_LENGTH } from '../decks/slug-name'
import { STASH_CONTINUE_MAX_AGE_MS, STASH_MAX_AGE_MS } from '../drops/stash'
import { HOME_FOLLOWING_SHOWN } from '../site/home-shape'
import { MAX_PAGE } from '../share/path'
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'
import { MAX_COMMUNITY_LINKS } from '../communities/link-rules'
import {
  DESCRIPTION_MAX as COMMUNITY_DESCRIPTION_MAX,
  MAX_SITES as COMMUNITY_SITES,
  NAME_MAX as COMMUNITY_NAME_MAX,
} from '../communities/community-input'
import { IMAGE_RULES } from '../communities/image-policy'
import { HANDLE_HOLD_SECONDS } from '../handles/hold'

const MEBIBYTE = 1024 * 1024

/**
 * The numbers the help quotes, taken from the code that enforces them, so
 * that a changed limit changes the help and no figure is typed twice.
 */
export const helpNumbers = () =>
  Object.freeze({
    versionMb: DEFAULT_UPLOAD_LIMITS.deploymentBytes / MEBIBYTE,
    fileMb: DEFAULT_UPLOAD_LIMITS.fileBytes / MEBIBYTE,
    files: DEFAULT_UPLOAD_LIMITS.files,
    decks: DEFAULT_UPLOAD_LIMITS.decks,
    authorMb: DEFAULT_UPLOAD_LIMITS.authorBytes / MEBIBYTE,
    agentMb: MAX_ARGUMENT_BYTES / MEBIBYTE,
    shotPage: MAX_SHOT_PAGE,
    viewerPage: MAX_PAGE,
    citationsShown: DECKS_SHOWN,
    followingShown: HOME_FOLLOWING_SHOWN,
    linkScanKb: LINK_SCAN_BYTES / 1024,
    stashHours: STASH_MAX_AGE_MS / 3_600_000,
    continueMinutes: STASH_CONTINUE_MAX_AGE_MS / 60_000,
    slugLength: MAX_SLUG_LENGTH,
    codeDigits: CODE_LENGTH,
    codeMinutes: CODE_SECONDS / 60,
    codeAttempts: CODE_ATTEMPTS,
    articleChars: MAX_ARTICLE_CHARS.toLocaleString('en-US'),
    embedDecks: MAX_OTHER_DECKS,
    maxLinks: MAX_LINKS,
    linkTitleChars: MAX_TITLE_LENGTH,
    nameChars: NAME_MAX,
    bioChars: BIO_MAX,
    locationChars: LOCATION_MAX,
    profileLinks: LINKS_MAX,
    pictureMb: PICTURE_MAX_BYTES / MEBIBYTE,
    pictureSide: PICTURE_SIDE,
    communityNameChars: COMMUNITY_NAME_MAX,
    communityDescriptionChars: COMMUNITY_DESCRIPTION_MAX,
    communitySites: COMMUNITY_SITES,
    communityLinks: MAX_COMMUNITY_LINKS,
    logoMb: IMAGE_RULES.logo.maxBytes / MEBIBYTE,
    coverMb: IMAGE_RULES.cover.maxBytes / MEBIBYTE,
    handleHoldDays: HANDLE_HOLD_SECONDS / 86_400,
  })

export type HelpNumbers = ReturnType<typeof helpNumbers>
