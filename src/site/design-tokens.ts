import { raw } from 'hono/html'

/**
 * Shared design tokens for every service page's inline <style>.
 *
 * Variable names follow `slide-design-handoff/reference/tokens.css` /
 * DESIGN.md. Stage 1 keeps **current** color values so appearance does not
 * change; stage 2 switches values to DESIGN.md.
 *
 * Transitional names (`--ink-strong`, `--mock-*`, extra radii) hold colors
 * and radii that the current UI uses but DESIGN.md does not yet define.
 * Do not add new ones without updating DESIGN.md first.
 *
 * Use `designTokensCssRaw` inside `hono/html` templates so quoted font
 * families are not escaped to `&quot;`. Plain string pages can use
 * `designTokensCss` directly.
 */
export const designTokensCss = `:root {
  /* Frame — names match tokens.css; values are the current UI (stage 1). */
  --background: #f4f6fa;
  --foreground: #152439;
  --card: #ffffff;
  --card-foreground: #152439;
  --primary: #153b70;
  --primary-foreground: #ffffff;
  --secondary: #eef1f6;
  --secondary-foreground: #152439;
  --muted: #eef1f6;
  --muted-foreground: #4f5f78;
  --accent: #eef1f6;
  --accent-foreground: #152439;
  --destructive: #8a1c1c;
  --destructive-foreground: #ffffff;
  --border: #d6dde8;
  --input: #c4cedd;
  --ring: #153b70;

  /* Names from tokens.css that the current UI already uses in places. */
  --border-soft: #eef1f6;
  --stage: #111111;
  --success: #1f6f43;
  --success-soft: #e6f4ea;
  --warning: #b26a00;
  --warning-soft: #fff6e5;
  --destructive-soft: #fbe9e9;
  --shadow-menu: 0 6px 20px rgb(21 36 57 / 12%);

  /* Transitional: current UI only; not in DESIGN.md yet. */
  --ink-strong: #173a6f;
  --ink-body: #3b4a62;
  --footer-ink: #4a5a70;
  --input-strong: #aab6c9;
  --border-loose: #cccccc;
  --info-soft: #e7eef9;
  --danger-emphasis: #b42318;
  --surface-note: #f3f5f9;
  --mock-muted: #777777;
  --mock-faint: #aaaaaa;
  --mock-dim: #888888;
  --mock-line: #444444;
  --mock-panel: #1c1c1c;
  --mock-code: #dddddd;
  --mock-wash: #e3e8f0;

  /*
   * Type — stage 1 keeps the faces pages already used. 'Segoe UI' stays so
   * hono/html escaping can be tested; Hiragino/Noto wait for stage 2 because
   * inserting them after system-ui changes Japanese metrics on Chromium.
   */
  --font-sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, Menlo, Consolas, monospace;

  /* Shape — current radii. Extra steps beyond DESIGN.md are transitional. */
  --radius: 8px;
  --radius-sm: 6px;
  --radius-xs: 4px;
  --radius-chip: 5px;
  --radius-card: 10px;
  --radius-panel: 12px;
  --radius-full: 999px;
}`

/** Same declarations, safe to splice into `html\`...\`` without escaping. */
export const designTokensCssRaw = raw(designTokensCss)
