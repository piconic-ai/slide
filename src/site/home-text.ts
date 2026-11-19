import { messages } from './i18n'

/** The words of the top page, which begins with the place to drop slides. */
export const homeText = messages({
  ja: {
    title: 'スライドを置く',
    dropTitle: 'スライドをここにドロップ',
    chooseFile: 'ファイルを選ぶ',
    dropNote:
      '共有用の URL ができます。HTML、zip に対応。公開するまでは自分だけが見られます。',
    ownHeading: '自分のスライド',
    seeAll: 'すべて見る',
    public: '公開中',
    authorOnly: '作者のみ',
    followingHeading: 'フォロー中の人の新着',
    recentHeading: '最近のスライド',
  },
  en: {
    title: 'Put your slides up',
    dropTitle: 'Drop your slides here',
    chooseFile: 'Choose a file',
    dropNote:
      'You get a link to share. HTML and zip files work. Only you can see them until you publish.',
    ownHeading: 'Your slides',
    seeAll: 'See all',
    public: 'Public',
    authorOnly: 'Only you',
    followingHeading: 'New from people you follow',
    recentHeading: 'Recent slides',
  },
})
