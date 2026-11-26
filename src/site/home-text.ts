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
    tabRecent: '最近のスライド',
    tabCommunities: '最近のコミュニティ',
    tabFollowing: 'フォロー',
    tabFollowedCommunities: 'フォローコミュニティ',
    communitiesEmpty: 'フォローしているコミュニティの新着は、まだありません。',
    followingEmpty: 'フォローしている人の新着は、まだありません。',
    followingFailed: '新着を読み込めませんでした。',
    loading: '読み込み中',
    retry: 'もう一度読み込む',
    newCommunitiesEmpty: 'コミュニティは、まだありません。',
    newCommunitiesFailed: 'コミュニティを読み込めませんでした。',
    followingPromptTitle: 'フォローした人の新しいスライドが、ここに並びます',
    followingPromptBody:
      '気になる作者をフォローすると、その人が公開したスライドを、ここで追えます。',
    communitiesPromptTitle:
      'フォローしたコミュニティの新しい発表が、ここに並びます',
    communitiesPromptBody:
      'コミュニティをフォローすると、そこで発表されたスライドを、ここで追えます。',
    signInToFollow: 'ログインしてフォローする',
    showRecent: '最近のスライドを見る',
    showCommunities: '最近のコミュニティを見る',
  },
  en: {
    title: 'Put your slides up',
    dropTitle: 'Drop your slides here',
    chooseFile: 'Choose a file',
    dropNote:
      'You get a link to share. HTML and zip files work. Only you can see them until you publish.',
    tabsLabel: 'Lists on the top page',
    tabRecent: 'Recent slides',
    tabCommunities: 'Recent communities',
    tabFollowing: 'Following',
    tabFollowedCommunities: 'Followed communities',
    communitiesEmpty: 'Nothing new from the communities you follow yet.',
    followingEmpty: 'Nothing new from the people you follow yet.',
    followingFailed: 'Could not load the new slides.',
    loading: 'Loading',
    retry: 'Try again',
    newCommunitiesEmpty: 'No communities yet.',
    newCommunitiesFailed: 'Could not load the communities.',
    followingPromptTitle: 'New slides of the people you follow appear here',
    followingPromptBody:
      'Follow an author you like, and keep up with the slides they publish, right here.',
    communitiesPromptTitle:
      'New talks of the communities you follow appear here',
    communitiesPromptBody:
      'Follow a community, and keep up with the slides presented there, right here.',
    signInToFollow: 'Sign in to follow',
    showRecent: 'See recent slides',
    showCommunities: 'See recent communities',
  },
})
