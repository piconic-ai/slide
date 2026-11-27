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
`
