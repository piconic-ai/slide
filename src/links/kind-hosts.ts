import type { LinkKind } from './link'

/**
 * The sites whose links are told apart from the rest: the kind a link has is
 * read from its host name. A host matches the name itself and every
 * subdomain of it. One place for the data, so a site is added by adding a
 * line. Anything not listed is "other".
 */
export const KIND_HOSTS: Readonly<
  Record<Exclude<LinkKind, 'other'>, readonly string[]>
> = {
  video: [
    'youtube.com',
    'youtu.be',
    'vimeo.com',
    'nicovideo.jp',
    'nico.ms',
    'twitch.tv',
    'loom.com',
  ],
  article: [
    'zenn.dev',
    'qiita.com',
    'note.com',
    'medium.com',
    'dev.to',
    'substack.com',
    // Hatena Blog and Hatena Diary.
    'hatenablog.com',
    'hatenablog.jp',
    'hateblo.jp',
    'hatenadiary.com',
    'hatenadiary.jp',
    'd.hatena.ne.jp',
  ],
}
