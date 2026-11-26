import type { ArticleText, TransmissionText } from './document'

/**
 * Texts for the tests, not the operator's. They have every shape the pages
 * draw, and they let a test pick the date and the blanks it needs.
 */
export const sampleText = (
  date: string,
  extra: Partial<ArticleText> = {},
): ArticleText => ({
  form: 'articles',
  title: '見本',
  preamble: ['前文 <b>と</b> & 引用'],
  articles: [
    {
      number: 1,
      title: '適用',
      body: {
        kind: 'clauses',
        clauses: [
          { text: '第一項', items: [] },
          { text: '第二項。次のとおり。', items: ['甲', '乙'] },
        ],
      },
    },
    {
      number: 2,
      title: '送信',
      body: {
        kind: 'plain',
        paragraphs: ['「外部への送信」を見る。', '二つ目の段落'],
        items: ['号一', '号二'],
      },
    },
    {
      number: 3,
      title: '無号',
      body: { kind: 'plain', paragraphs: ['ただの文'], items: [] },
    },
  ],
  links: [{ phrase: '「外部への送信」', href: '/privacy/external' }],
  history: [{ date, summary: '制定' }],
  ...extra,
})

export const sampleTransmission = (date: string): TransmissionText => ({
  form: 'transmission',
  title: '送信見本',
  description: '説明の文。',
  columns: ['送り先', '送る情報', '目的', 'ポリシー'],
  rows: [
    {
      destination: 'A 社 <script>',
      information: '情報 A',
      purpose: '目的 A',
      policy: { label: 'ポリシー A', url: 'https://a.example/policy?x=1&y=2' },
    },
    {
      destination: 'B 社',
      information: '情報 B',
      purpose: '目的 B',
      policy: { label: 'ポリシー B', url: 'https://b.example/' },
    },
  ],
  history: [{ date, summary: '制定' }],
})
