import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 50,
  form: 'reference',
  related: ['slides/upload', 'sharing/page-url'],
  ja: {
    title: 'URL の名前を変える',
    lead: () =>
      html`URL の名前は、公開する前だけ、スライドの編集の画面の「URL
      を変える」で変えられます。`,
    body: (n) =>
      html`<p>
        公開したあとは、その行は出ません。公開した URL は、viewer
        の「共有」からコピーできます。英小文字、数字、ハイフンで、${n.slugLength}
        文字までです。先頭と末尾は、英小文字か数字にします。<code
          >following</code
        >
        や
        <code>followers</code>
        など、サービスが使っている名前は選べません。一度公開したスライドは、公開を止めたあとも変えられません。同じ人の中で名前が重なったときは、<code>-2</code>、<code
          >-3</code
        >
        を付けます。
      </p>`,
  },
  en: {
    title: 'Change the name in the URL',
    lead: () =>
      html`You can change the name in the URL with “Change the URL” on the edit
      page, only before you publish.`,
    body: (n) =>
      html`<p>
        After that the row is gone; copy the public URL with “Share” in the
        viewer. Use lowercase letters, digits and hyphens, up to ${n.slugLength}
        characters, starting and ending with a letter or a digit. Names the
        service uses, such as <code>following</code> and <code>followers</code>,
        cannot be chosen. Once slides were published, the name cannot be
        changed, even after you stop publishing. When a name is already taken
        among your slides, <code>-2</code>, <code>-3</code> is added.
      </p>`,
  },
})
