import { messages } from './i18n'

/** The words of the top page, which begins with the place to drop slides. */
export const homeText = messages({
  ja: {
    title: 'スライドを置く',
    dropTitle: 'スライドをここにドロップ',
    chooseFile: 'ファイルを選ぶ',
    dropNote:
      '共有用の URL ができます。HTML、zip に対応。公開するまでは自分だけが見られます。',
    tabsLabel: 'トップの一覧',
    tabAll: 'すべて',
    tabFollowing: 'フォロー',
    allEmpty: '公開されたスライドは、まだありません。',
    followingEmpty:
      'フォローしている人やコミュニティの新着は、まだありません。',
    failed: '読み込めませんでした。',
    loading: '読み込み中',
    retry: 'もう一度読み込む',
    followingPromptTitle:
      'フォローした人やコミュニティの新しいスライドが、ここに並びます',
    followingPromptBody:
      '気になる人やコミュニティをフォローすると、その新しいスライドを、ここで追えます。',
    signInToFollow: 'ログインしてフォローする',
    showAll: 'すべてを見る',
    more: 'もっと見る',
    moreFailed: '続きを読み込めませんでした。',
    openViewer: 'ビューアーで開く',
    flipOf: (name: string) => `${name} を、ここでめくる`,
    followedAuthor: 'フォロー中',
    carouselPeople: 'ユーザー',
    carouselCommunities: 'コミュニティ',
    carouselPrev: '前へ',
    carouselNext: '次へ',
    follow: 'フォロー',
    following: 'フォロー中',
    followOf: (name: string) => `${name} をフォローする`,
    unfollowOf: (name: string) => `${name} のフォローを解除する`,
  },
  en: {
    title: 'Put your slides up',
    dropTitle: 'Drop your slides here',
    chooseFile: 'Choose a file',
    dropNote:
      'You get a link to share. HTML and zip files work. Only you can see them until you publish.',
    tabsLabel: 'Lists on the top page',
    tabAll: 'All',
    tabFollowing: 'Following',
    allEmpty: 'No slide is public yet.',
    followingEmpty:
      'Nothing new from the people and communities you follow yet.',
    failed: 'Could not load.',
    loading: 'Loading',
    retry: 'Try again',
    followingPromptTitle:
      'New slides of the people and communities you follow appear here',
    followingPromptBody:
      'Follow people and communities you like, and keep up with their new slides, right here.',
    signInToFollow: 'Sign in to follow',
    showAll: 'See all',
    more: 'Show more',
    moreFailed: 'Could not load more.',
    openViewer: 'Open in the viewer',
    flipOf: (name: string) => `Page through ${name} here`,
    followedAuthor: 'Following',
    carouselPeople: 'People',
    carouselCommunities: 'Communities',
    carouselPrev: 'Previous',
    carouselNext: 'Next',
    follow: 'Follow',
    following: 'Following',
    followOf: (name: string) => `Follow ${name}`,
    unfollowOf: (name: string) => `Unfollow ${name}`,
  },
})
