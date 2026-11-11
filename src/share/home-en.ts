import { html } from 'hono/html'
import type { HomeCopy, HomeSection } from './home'
import { slideUrl, toolsFigure } from './home-mock'

const courseFigure = html`${slideUrl('@kobaken/courses/workers-from-zero')}
  <div class="mock-card">
    <div class="mock-card-head">
      <b>Cloudflare Workers from zero</b>
      <span>4 parts · 92 pages · kobaken</span>
    </div>
    <ol class="mock-course">
      <li>
        <span class="mock-thumb"></span>
        <span
          >1. How Workers run<small
            >Isolates, cold starts, the CPU time limit · 22 pages</small
          ></span
        >
        <span>Done</span>
      </li>
      <li>
        <span class="mock-thumb"></span>
        <span
          >2. Routing and middleware with Hono<small
            >Router order, c.env, typing Bindings · 26 pages</small
          ></span
        >
        <span>Done</span>
      </li>
      <li class="is-current">
        <span class="mock-thumb"></span>
        <span
          >3. Wiring up D1 and R2<small
            >Drizzle migrations, serving R2 without signing · 24 pages</small
          ></span
        >
        <span>Up next</span>
      </li>
      <li class="is-locked">
        <span class="mock-thumb"></span>
        <span
          >4. Publishing from GitHub Actions with OIDC<small
            >id-token, audience, short-lived credentials · 20 pages</small
          ></span
        >
        <span>Not yet</span>
      </li>
    </ol>
  </div>`

const aiFigure = html`<dl class="mock-kv">
  <div>
    <dt>OGP images</dt>
    <dd>Made for every page</dd>
  </div>
  <div>
    <dt>Transcripts</dt>
    <dd>Notes turned into prose</dd>
  </div>
  <div>
    <dt>Translation</dt>
    <dd>ja / zh / ko</dd>
  </div>
  <div>
    <dt>Analytics</dt>
    <dd>How far readers get, and where they stop</dd>
  </div>
</dl>`

const thanksFigure = html`<dl class="mock-kv">
  <div>
    <dt>Courses</dt>
    <dd>Sell them at your price</dd>
  </div>
  <div>
    <dt>Decks</dt>
    <dd>Receive tips as thanks</dd>
  </div>
</dl>`

const readerSections: readonly HomeSection[] = [
  {
    id: 'touch-demo',
    title: 'Run the demos.',
    status: 'done',
    body: [
      'An HTML slide is not an image or a PDF; it arrives as a program that runs in the browser. The inputs and sliders the speaker used for a demo work the same in your hands. You are not limited to the one case shown in the talk: try the cases you are curious about and see what happens.',
      'The example on the right is a slide about retry waits. Change the factor and the number of tries, and it shows right away how long each try waits and how long they take in total.',
    ],
    figure: { live: 'backoff', path: '@kobaken/hono-on-workers' },
  },
  {
    id: 'touch-safe',
    title: 'Open a stranger’s slides without worry.',
    status: 'wip',
    body: [
      'Live slides made by someone you do not know carry real risks: being sent to another page, being made to download a file, or having a service you are signed in to used behind your back.',
      'slide serves every deck in a sandboxed iframe from an origin apart from the dashboard. The browser stops the slide from sending the parent page to a fake sign-in screen, opening other tabs, downloading files, or submitting forms, and it cannot reach your sign-in on slide. Limits on what a slide can send to other sites are coming next.',
    ],
    figure: { live: 'sandbox', path: '@someone/deck' },
  },
  {
    id: 'touch-review',
    title: 'Find the good ones sooner.',
    status: 'spec',
    body: [
      'Tired of hollow slides and articles mass-produced by AI? On slide, AI reads each published deck with its notes and reviews it: does it have demos you can try, enough context, concrete detail, original insight? Only reviews the author chooses to share are shown, so you can tell what a deck offers before you read it.',
      'We do not stop anyone from making things with AI. If you used AI to make something good, the review backs that up. It exists so readers can spend their time on good work.',
    ],
    figure: { live: 'review', path: '@kobaken/hono-on-workers · AI review' },
  },
]

const learnSections: readonly HomeSection[] = [
  {
    id: 'learn-notes',
    title: 'Read what the speaker said, too.',
    status: 'spec',
    body: [
      'What a speaker says out loud is lost when only the slides remain, and raw notes are hard to read. So slide has AI draft prose from the slides and notes, and the author edits it into an article you can read straight through. People who were not in the room can follow why things were designed the way they were.',
      'Readers choose whether to read with notes or flip through the slides. Both views share one URL, and a page number takes you to a single slide.',
    ],
    figure: { live: 'notes', path: '@kobaken/hono-on-workers' },
  },
  {
    id: 'learn-course',
    title: 'Learn in courses.',
    status: 'spec',
    body: [
      'Creators can put several decks in order and publish them as one course. Every part has notes and live demos, so you can read, try it yourself, and move on.',
      'Your progress stays with you, so you can pick up from any part. Unlike a video course, you can also search for the one slide you need, open it, and try just that.',
    ],
    figure: courseFigure,
  },
]

const creatorSections: readonly HomeSection[] = [
  {
    id: 'creator-ai',
    title: 'Leave the chores to AI.',
    status: 'spec',
    body: [
      'AI takes on the work that piles up after you publish: an OGP image for each page, turning speaker notes into article prose, translation, and analytics on how far readers get. You can focus on writing slides and notes.',
    ],
    figure: aiFigure,
  },
  {
    id: 'creator-tools',
    title: 'Use the tools you already use.',
    status: 'done',
    body: [
      'Slidev, Marp, reveal.js, Peitho: any tool that outputs HTML works, and slide takes the build output as it is. GitHub Actions signs in with OIDC, so there is no secret key to issue or store. A push gives you a URL only you can open, and you publish after checking it.',
    ],
    figure: toolsFigure,
  },
  {
    id: 'creator-thanks',
    title: 'Say thanks for what you learned.',
    status: 'spec',
    body: [
      'Keeping knowledge flowing takes money too. A course that took as much work as writing a book can be sold at a price you set. The first part is free to read, so buyers can see what they get before they decide. A deck you liked can be thanked with a tip, so the “that was great” after a talk can be more than words.',
      'Once you have received, pass it on to the next person who is learning. slide values a cycle where receiving is not the end, and kindness is paid forward.',
    ],
    figure: thanksFigure,
  },
]

const heroFigure = html`${slideUrl('@kobaken/b-tree-index')}
  <div class="mock-slide mock-cover">
    <div>How does search answer in an instant, even over 100 million rows?</div>
    <span class="mock-no">1</span>
  </div>`

export const en: HomeCopy = {
  title: 'Touch it, get it',
  statusLabels: {
    done: 'Available',
    wip: 'In progress',
    spec: 'Being designed',
  },
  hero: {
    heading: 'Touch it, get it.',
    lead: 'Slides should not stop at reading. Readers run the demos with their own hands, so even people who missed the talk go beyond “I saw it” to “I get it.” Authors just push the HTML their usual tools make.',
    start: 'Start with GitHub',
    tryIt: 'Try it',
    figure: heroFigure,
  },
  recentHeading: 'Recently published',
  groups: { touch: 'Touch it', learn: 'Get it', creators: 'For creators' },
  readerSections,
  learnSections,
  creatorSections,
  outro: {
    body: 'Sign in with your GitHub account and push your first deck. Until you publish, you can check it at a URL only you can open.',
  },
}
