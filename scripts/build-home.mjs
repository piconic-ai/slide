// Generates public/index.html from src/site/home-page.tsx with Hono's toSSG.
// Run after `vite build`: the page imports the compiled component template.
import { resolve } from 'node:path'
import { renderHome } from './home-ssg.mjs'

await renderHome(resolve(import.meta.dirname, '..', 'public'))
