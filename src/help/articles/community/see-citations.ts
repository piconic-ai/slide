import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 20,
  form: 'reference',
  related: ['community/cite-slides'],
  ja: {
    title: '引用されたことを知る',
    lead: () =>
      html`引用は、引用された側と引用した側の viewer
      の下と、プロフィールの「引用した」「引用された」に出ます。`,
    body: (n) =>
      html`<h2>どこに出るか</h2>

        <ul>
          <li>
            引用された側の viewer
            の下に「このスライドを引用しているスライド」、引用した側の viewer
            の下に「このスライドが引用しているスライド」が、表紙のカードで出ます。${n.citationsShown}
            件まで並べ、残りは「ほか N 件」と件数で示します。1
            件もないときは、見出しごと出ません。
          </li>
          <li>
            スライドの中の共有 URL へのリンクを読者が押すと、viewer
            がそのスライドへ移ります。ほかの URL へは移りません。
          </li>
          <li>
            プロフィールの「引用した」には、その人のスライド(または記事)が引用した、ほかの人のスライドが出ます。「引用された」には、ほかの人のスライド(または記事)が引用した、その人のスライドが出ます。どちらも、引用の組ごとに
            1
            行で、引用が生まれた日の新しい順に並び、件数はそれぞれのタブの横に出ます。
          </li>
          <li>
            自分のスライド同士の引用は、プロフィールの一覧にも件数にも入りません(viewer
            には出ます)。
          </li>
        </ul>
        <h2>消えるとき</h2>

        <p>
          viewer
          の引用は、引用した側と、された側の両方が一般公開されている間だけ出ます。どちらかの公開を止めると消え、もう一度公開すると戻ります。読むのは公開中の版なので、新しい版を受け取っても、公開中の版を入れ替えるまでは、出る引用は変わりません。viewer
          では、読者がミュートしている作者のスライドは出ません。運営が非表示にしたスライド、停止中の作者のスライドは、どちらにも出ません。引用は表紙のカードで出すだけで、引用したスライドを相手のページの上で動かすことはしません。
        </p>`,
  },
  en: {
    title: 'See who cites your slides',
    lead: () =>
      html`Citations show under the viewer of both slides, and in “Cited” and
      “Cited by” on the profile.`,
    body: (n) =>
      html`<h2>Where it shows</h2>

        <ul>
          <li>
            Under the viewer of the cited slides, “Slides citing these slides”
            shows as cover cards, and under the viewer of the citing slides,
            “Slides these slides cite”. Up to ${n.citationsShown} are shown and
            the rest as “N more”. When there are none, the heading is left out.
          </li>
          <li>
            When a reader presses a link to a share link inside the slides, the
            viewer moves to those slides. It does not move to other URLs.
          </li>
          <li>
            On a profile, “Citing” lists the slides of other people that this
            person’s slides (or articles) cite, and “Cited” lists this person’s
            slides that other people’s slides (or articles) cite. Each pair is
            one row, newest citation first, and each count is beside its tab.
          </li>
          <li>
            Citations between a person’s own slides are in neither the lists nor
            the counts of the profile (the viewer still shows them).
          </li>
        </ul>
        <h2>When it goes away</h2>

        <p>
          A citation in the viewer shows only while both the citing and the
          cited slides are public. Stopping either one removes it, and
          publishing again brings it back. The public version is the one that is
          read, so receiving a new version changes the citations only after you
          replace the public version. In the viewer, slides by an author the
          reader muted are not shown. Slides the operators hid, and slides by a
          suspended author, are shown in neither. Citations appear only as cover
          cards; the citing slides are never run on the other slides’ page.
        </p>`,
  },
})
