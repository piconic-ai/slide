import { messages } from './i18n'

/** The words of the top page, which begins with the place to drop slides. */
export const homeText = messages({
  ja: {
    title: 'スライドを置く',
    dropTitle: 'スライドをここにドロップ',
    chooseFile: 'ファイルを選ぶ',
    dropNote:
      '共有用の URL ができます。HTML、zip に対応。公開するまでは自分だけが見られます。',
    communitiesHeading: 'フォローしているコミュニティの新着',
    seeAll: 'すべて見る',
    communitiesEmpty: 'フォローしているコミュニティの新着は、まだありません。',
    followingHeading: 'フォロー中の人の新着',
    followingEmpty: 'フォローしている人の新着は、まだありません。',
    followingFailed: '新着を読み込めませんでした。',
    loading: '読み込み中',
    retry: 'もう一度読み込む',
    recentHeading: '最近のスライド',
    newCommunitiesHeading: '新着のコミュニティ',
    newCommunitiesEmpty: 'コミュニティは、まだありません。',
    newCommunitiesFailed: 'コミュニティを読み込めませんでした。',
  },
  en: {
    title: 'Put your slides up',
    dropTitle: 'Drop your slides here',
    chooseFile: 'Choose a file',
    dropNote:
      'You get a link to share. HTML and zip files work. Only you can see them until you publish.',
    communitiesHeading: 'New from communities you follow',
    seeAll: 'See all',
    communitiesEmpty: 'Nothing new from the communities you follow yet.',
    followingHeading: 'New from people you follow',
    followingEmpty: 'Nothing new from the people you follow yet.',
    followingFailed: 'Could not load the new slides.',
    loading: 'Loading',
    retry: 'Try again',
    recentHeading: 'Recent slides',
    newCommunitiesHeading: 'New communities',
    newCommunitiesEmpty: 'No communities yet.',
    newCommunitiesFailed: 'Could not load the communities.',
  },
})
