import { html } from 'hono/html'
import type { HomeCopy, HomeSection } from './home'
import { slideUrl, toolsFigure } from './home-mock'

const backoffFigure = html`${slideUrl('@kobaken/hono-on-workers')}
  <div class="mock-slide">
    <div class="mock-title">Exponential backoff: how long before each try</div>
    <div class="mock-controls">
      <span>Factor</span><span class="mock-range"></span><span>×2</span>
      <span>Tries</span><span class="mock-range short"></span><span>5</span>
    </div>
    <ol class="mock-timeline">
      <li><b>Try 1</b><i></i><small>0s</small></li>
      <li><b>Try 2</b><i></i><small>+0.5s</small></li>
      <li><b>Try 3</b><i></i><small>+1s</small></li>
      <li><b>Try 4</b><i></i><small>+2s</small></li>
      <li><b>Try 5</b><i></i><small>+4s</small></li>
    </ol>
    <div class="mock-note">
      First wait 500ms. Top: each try; bottom: the wait before it. 7.5s in
      total.
    </div>
    <span class="mock-no">15</span>
  </div>`

const sandboxFigure = html`${slideUrl('@someone/deck')}
  <div class="mock-slide">
    <div class="mock-title">This slide tries to break out of its frame</div>
    <div class="mock-code">top.location = "https://evil.example"</div>
    <div class="mock-button">Send the parent page to a fake site</div>
    <div class="mock-log">
      ✕ top navigation … blocked by the sandbox (no allow-top-navigation)
    </div>
    <span class="mock-no">9</span>
  </div>
  <div class="mock-url">
    &lt;iframe sandbox="allow-scripts allow-same-origin"
    referrerpolicy="no-referrer"&gt; · served from an origin apart from the
    dashboard
  </div>`

const reviewFigure = html`${slideUrl('@kobaken/hono-on-workers · AI review')}
  <div class="mock-card">
    <div class="mock-card-head">
      <span
        >AI review · shared by the author · based only on the slides and
        notes</span
      >
      <span class="mono">22/25</span>
    </div>
    <div class="mock-review">
      <ul class="mock-axes">
        <li class="is-selected"><span>Hands-on</span><span>●●●●○</span></li>
        <li><span>Enough context</span><span>●●●●●</span></li>
        <li><span>Concrete</span><span>●●●●○</span></li>
        <li><span>Original insight</span><span>●●●●○</span></li>
        <li><span>Readable</span><span>●●●●●</span></li>
      </ul>
      <div class="mock-finding">
        <b>Hands-on 4/5</b>
        <p>
          Readers can change the values in the backoff on page 15 and the cache
          TTL on page 18 and watch what happens. The architecture diagram on
          page 3 is a still image, so there is nothing to try there.
        </p>
        <small class="mono">p.15, p.18 / p.3</small>
      </div>
    </div>
    <div class="mock-card-foot">
      Overall: a write-up for implementers that you can follow by doing. The
      numbers and the reasons behind each decision are all there.
    </div>
  </div>`

const notesFigure = html`${slideUrl('@kobaken/hono-on-workers')}
  <div class="mock-card">
    <div class="mock-card-head">
      <span>Hono on Workers · 24 pages · with notes</span>
      <span class="mock-toggle"
        ><b>Read with notes</b><span>Flip through slides</span></span
      >
    </div>
    <div class="mock-notes">
      <div class="mock-note-row">
        <div class="mock-thumb">Why Workers</div>
        <p>
          <small class="mono">14</small>Isolates mean almost no cold starts, and
          D1 and R2 sit inside the same boundary. Serving slides means reading
          many small files, so the 10ms CPU limit is no problem.
        </p>
      </div>
      <div class="mock-note-row">
        <div class="mock-thumb">Exponential backoff</div>
        <p>
          <small class="mono">15</small>Try the demo on this page yourself. With
          a factor of 2 and 5 tries, you wait 7.5 seconds in total. The server
          gives up after 3 tries and answers 503, and the client reloads.
        </p>
      </div>
    </div>
  </div>`

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
        <span>Read</span>
      </li>
      <li>
        <span class="mock-thumb"></span>
        <span
          >2. Routing and middleware with Hono<small
            >Router order, c.env, typing Bindings · 26 pages</small
          ></span
        >
        <span>Read</span>
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
    figure: backoffFigure,
  },
  {
    id: 'touch-safe',
    title: 'Open a stranger’s slides without worry.',
    status: 'wip',
    body: [
      'Live slides made by someone you do not know carry real risks: being sent to another page, being made to download a file, or having a service you are signed in to used behind your back.',
      'slide serves every deck in a sandboxed iframe from an origin apart from the dashboard. The browser stops the slide from sending the parent page to a fake sign-in screen, opening other tabs, downloading files, or submitting forms, and the slide cannot reach your slide sign-in. Limits on what a slide can send to other sites are coming next.',
    ],
    figure: sandboxFigure,
  },
  {
    id: 'touch-review',
    title: 'Find the good ones sooner.',
    status: 'spec',
    body: [
      'Tired of hollow slides and articles mass-produced by AI? On slide, AI reads each published deck with its notes and reviews it: does it have demos you can try, enough context, concrete detail, original insight? Only reviews the author chooses to share are shown, so you can tell what a deck offers before you read it.',
      'We do not stop anyone from making things with AI. If you used AI to make something good, the review backs that up. It exists so readers can spend their time on good work.',
    ],
    figure: reviewFigure,
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
    figure: notesFigure,
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
    title: 'Thanks for what you learned.',
    status: 'spec',
    body: [
      'Keeping knowledge flowing takes money too. A course that took as much work as writing a book can be sold at a price you set. The first part is free to read, so buyers can see what they get before they decide. A deck you liked can be thanked with a tip, so the “that was great” after a talk can be more than words.',
      'Once you have received, pass it on to someone who taught you. slide values a cycle where receiving is not the end, and kindness is paid forward.',
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
  statusLabels: { done: 'Live', wip: 'In progress', spec: 'Being designed' },
  hero: {
    heading: 'Touch it, get it.',
    lead: 'Slides should not stop at reading. Readers run the demos with their own hands, so even people who missed the talk go beyond “I saw it” to “I get it.” Authors just push the HTML their usual tools make.',
    start: 'Start with GitHub',
    tryIt: 'Try it',
    figure: heroFigure,
  },
  recentHeading: 'Recently published',
  groups: { touch: 'Touch', learn: 'Understand', creators: 'For creators' },
  readerSections,
  learnSections,
  creatorSections,
  outro: {
    body: 'Sign in with your GitHub account and push your first deck. Until you publish, you can check it at a URL only you can open.',
  },
}
