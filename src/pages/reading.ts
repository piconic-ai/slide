/**
 * The pure part of the page script: how a page number is read from, or
 * written for, what a slide tool shows. It is the text of functions that
 * take everything they use as arguments, so the page script can hold it
 * inline (the script is served as one string; see script.ts) and the tests
 * can run the same text, with plain values, without a browser.
 *
 * What touches the document (the address, the tool's own API, events) stays
 * in script.ts. A tool's reading is a pair of these functions and a few
 * lines there: one that tells which page is on show, one that opens a page.
 */
export const READING_SOURCE = `
  const numberOf = (text) => {
    const spelled = /^([1-9][0-9]{0,3})$/.exec(text)
    return spelled ? Number(spelled[1]) : null
  }
  const pageIn = (search, hash) => {
    const query = new URLSearchParams(search).get('slide')
    if (query !== null) return numberOf(query)
    if (hash === '' || hash === '#') return 1
    return numberOf(hash.slice(1))
  }
  const requestedIn = (hash) => numberOf(hash.slice(1))

  // reveal.js: a deck is columns, each holding one slide or a stack of
  // slides one above the other. A page is a slide counted in reading order;
  // "columns" is how many slides each column holds, in order.
  const pageOfSlide = (columns, h, v) => {
    if (!Number.isInteger(h) || !Number.isInteger(v)) return null
    if (h < 0 || h >= columns.length || v < 0 || v >= columns[h]) return null
    let before = 0
    for (let column = 0; column < h; column++) before += columns[column]
    return before + v + 1
  }
  const slideOfPage = (columns, page) => {
    let left = page
    for (let h = 0; h < columns.length; h++) {
      if (left <= columns[h]) return { h, v: left - 1 }
      left -= columns[h]
    }
    const last = columns.length - 1
    return last < 0 ? null : { h: last, v: columns[last] - 1 }
  }

  // Slidev keeps the page in the path (/3, from 1). Its other routes (the
  // presenter's, the overview) and its hash mode (#/3) tell no page.
  const slidevPageIn = (pathname, hash) => {
    if (hash.startsWith('#/')) return null
    if (pathname === '/') return 1
    const spelled = /^\\/([1-9][0-9]{0,3})\\/?$/.exec(pathname)
    return spelled ? Number(spelled[1]) : null
  }
  const slidevPathOf = (page) => '/' + page

  // suraido.js: the page is the fragment, counted from 0 (#2 is the third
  // page, #0 the first). A name (#intro) or a step (#2.1) tells no page.
  const suraidoPageIn = (hash) => {
    const spelled = /^#(0|[1-9][0-9]{0,3})$/.exec(hash)
    return spelled && Number(spelled[1]) < 9999 ? Number(spelled[1]) + 1 : null
  }
  const suraidoHashOf = (page) => '#' + (page - 1)
`
