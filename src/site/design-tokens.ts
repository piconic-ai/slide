import { raw } from 'hono/html'

/**
 * Shared design tokens for every service page's inline <style>.
 *
 * Names and values follow DESIGN.md and
 * `slide-design-handoff/reference/tokens.css`. Stage 2 uses those values.
 *
 * Transitional names (`--ink-strong`, `--mock-*`, extra radii) alias a
 * DESIGN token, or hold mock colors the home page still draws. Do not add
 * new ones without updating DESIGN.md first.
 *
 * Use `designTokensCssRaw` inside `hono/html` templates so quoted font
 * families are not escaped to `&quot;`. Plain string pages can use
 * `designTokensCss` directly.
 */
export const designTokensCss = `:root {
  /* Frame — DESIGN.md colors, under the names in tokens.css. */
  --background: #ffffff;
  --foreground: #111111;
  --card: #ffffff;
  --card-foreground: #111111;
  --primary: #111111;
  --primary-foreground: #ffffff;
  --secondary: #f7f7f5;
  --secondary-foreground: #111111;
  --muted: #f7f7f5;
  --muted-foreground: #5c5c5c;
  --accent: #f7f7f5;
  --accent-foreground: #111111;
  --destructive: #8a1c1c;
  --destructive-foreground: #ffffff;
  --border: #e6e6e6;
  --input: #8c8c8c;
  --ring: #111111;

  --border-soft: #f1f1f1;
  --stage: #000000;
  --block-yellow: #feeba6;
  --block-yellow-deep: #f8da64;
  --block-yellow-deeper: #e7c100;
  --block-blue: #cce8ff;
  --block-blue-deep: #a4d3ff;
  --block-blue-deeper: #60aaf3;
  --block-red: #ffd8d0;
  --block-red-deep: #ffb5a9;
  --block-red-deeper: #f9786a;
  --block-green: #c9f4d7;
  --block-green-deep: #9be5b4;
  --block-green-deeper: #55c483;
  --block-ecru: #f5f0e3;
  --block-ecru-deep: #eae1c8;
  --block-ecru-deeper: #d6c69b;
  --block-purple: #ecddff;
  --block-purple-deep: #dac0fb;
  --block-purple-deeper: #b88fe6;
  --block-navy: #153b70;
  --block-navy-foreground: #ffffff;
  --unread: #ff3d8b;
  --success: #1f6f43;
  --success-soft: #e6f4ea;
  --warning: #8a5200;
  --warning-soft: #fff6e5;
  --destructive-soft: #fbe9e9;
  --shadow-menu: 0 6px 20px rgb(0 0 0 / 0.12);

  /* Transitional names still referenced by pages. Values are DESIGN tokens. */
  --ink-strong: var(--foreground);
  --ink-body: var(--foreground);
  --footer-ink: var(--muted-foreground);
  --input-strong: var(--input);
  --border-loose: var(--border);
  --info-soft: var(--secondary);
  --danger-emphasis: var(--destructive);
  --surface-note: var(--secondary);
  /* Home mocks stay until stage 4. */
  --mock-muted: #777777;
  --mock-faint: #aaaaaa;
  --mock-dim: #888888;
  --mock-line: #444444;
  --mock-panel: #1c1c1c;
  --mock-code: #dddddd;
  --mock-wash: #e3e8f0;

  /* Type — DESIGN.md stacks, including Japanese faces and SF Mono. */
  --font-sans:
    system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP',
    sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* Shape — md is --radius. Extra names map to the nearest DESIGN step. */
  --radius: 8px;
  --radius-sm: 6px;
  --radius-xs: 2px;
  --radius-chip: 6px;
  --radius-card: 8px;
  --radius-panel: 8px;
  --radius-block: 24px;
  --radius-block-lg: 32px;
  --radius-full: 9999px;

  --space-section: 96px;
  --space-block: 48px;

  --duration-fast: 0.15s;
  --ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
}

@media (max-width: 759px) {
  :root {
    --space-section: 56px;
    --space-block: 24px;
  }
}`

/** Same declarations, safe to splice into `html\`...\`` without escaping. */
export const designTokensCssRaw = raw(designTokensCss)
