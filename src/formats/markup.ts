/**
 * Inline markup handling.
 *
 * SRT/VTT use HTML-like tags (`<i>`, `<b>`, `<u>`, `<font color>`), ASS uses override
 * blocks (`{\i1}`, `{\an8}`). Translation must not destroy them and must not send
 * them to the model as text, so we split a segment into a markup "shell" and plain text.
 */

const HTML_TAG = /<\/?(?:i|b|u|s|font|c|v|lang|ruby|rt)(?:[\s.][^>]*)?>/gi
const ASS_OVERRIDE = /\{\\[^}]*\}/g

export const stripMarkup = (text: string) => text.replace(HTML_TAG, '').replace(ASS_OVERRIDE, '')

export const hasMarkup = (text: string) => {
  HTML_TAG.lastIndex = 0
  ASS_OVERRIDE.lastIndex = 0
  return HTML_TAG.test(text) || ASS_OVERRIDE.test(text)
}

export interface MarkupShell {
  /** Markup that wraps the whole segment and can be re-applied safely. */
  prefix: string
  suffix: string
  /** Plain text to translate (line breaks preserved). */
  inner: string
  /** True when markup existed inside the text and could not be preserved positionally. */
  lostInlineMarkup: boolean
}

/**
 * Extract wrapping markup, e.g. `{\an8}<i>Hello\nthere</i>` → prefix `{\an8}<i>`, suffix `</i>`.
 * Inline markup in the middle of the text cannot be mapped onto a translation reliably;
 * we strip it and report it so the segment is flagged for review.
 */
export function extractMarkupShell(text: string): MarkupShell {
  let rest = text
  let prefix = ''
  let suffix = ''

  // Leading ASS override blocks (positioning, styling).
  const leadingAss = rest.match(/^(?:\{\\[^}]*\})+/)
  if (leadingAss) {
    prefix += leadingAss[0]
    rest = rest.slice(leadingAss[0].length)
  }

  // Whole-text wrapping tags, possibly nested: <i><b>...</b></i>
  for (;;) {
    const open = rest.match(/^<(i|b|u|font)(\s[^>]*)?>/i)
    if (!open) break
    const tag = open[1].toLowerCase()
    const close = new RegExp(`</${tag}>$`, 'i')
    if (!close.test(rest)) break
    const closing = rest.match(close)![0]
    const innerCandidate = rest.slice(open[0].length, rest.length - closing.length)
    // Only treat as wrapper if the tag is not reopened inside (e.g. "<i>a</i> b <i>c</i>").
    if (new RegExp(`</${tag}>`, 'i').test(innerCandidate)) break
    prefix += open[0]
    suffix = closing + suffix
    rest = innerCandidate
  }

  const inner = stripMarkup(rest)
  return { prefix, suffix, inner, lostInlineMarkup: inner !== rest }
}

export const applyMarkupShell = (shell: Pick<MarkupShell, 'prefix' | 'suffix'>, text: string) =>
  `${shell.prefix}${text}${shell.suffix}`

/** Convert SRT/VTT HTML-ish tags to ASS overrides. Unknown tags are removed. */
export const htmlToAss = (text: string) =>
  text
    .replace(/<i>/gi, '{\\i1}')
    .replace(/<\/i>/gi, '{\\i0}')
    .replace(/<b>/gi, '{\\b1}')
    .replace(/<\/b>/gi, '{\\b0}')
    .replace(/<u>/gi, '{\\u1}')
    .replace(/<\/u>/gi, '{\\u0}')
    .replace(HTML_TAG, '')

/**
 * Convert ASS overrides to SRT tags. Italic/bold/underline are mapped; positioning
 * and other overrides have no SRT equivalent. `{\anN}` is kept because most SRT
 * players honour it; everything else is dropped and counted.
 */
export function assToHtml(text: string): { text: string; dropped: number } {
  let dropped = 0
  const out = text.replace(ASS_OVERRIDE, (block) => {
    const tags = block.slice(1, -1).split('\\').filter(Boolean)
    let result = ''
    for (const tag of tags) {
      if (tag === 'i1') result += '<i>'
      else if (tag === 'i0') result += '</i>'
      else if (tag === 'b1') result += '<b>'
      else if (tag === 'b0') result += '</b>'
      else if (tag === 'u1') result += '<u>'
      else if (tag === 'u0') result += '</u>'
      else if (/^an[1-9]$/.test(tag)) result += `{\\${tag}}`
      else dropped += 1
    }
    return result
  })
  return { text: out, dropped }
}
