/** Words that should stay with the following word when breaking a subtitle line. */
const STICKY = new Set(['i', 'a', 'u', 'na', 'za', 'od', 'do', 'sa', 's', 'iz', 'po', 'o', 'k', 'ka', 'kod', 'da', 'ali', 'ili', 'ni', 'pa', 'te', 'se', 'je', 'и', 'а', 'у', 'на', 'за', 'од', 'до', 'са', 'с', 'из', 'по', 'о', 'да', 'се', 'је'])

/**
 * Break a single-line text into at most two balanced lines when it exceeds
 * `maxChars`. Prefers breaking after punctuation, avoids leaving short function
 * words at the end of the first line. Text that already has line breaks is kept.
 */
export function reflowSubtitle(text: string, maxChars: number): string {
  const clean = text.replace(/[ \t]+/g, ' ').trim()
  if (clean.includes('\n') || clean.length <= maxChars) return clean
  const words = clean.split(' ')
  if (words.length < 2) return clean

  let best = -1
  let bestScore = Number.POSITIVE_INFINITY
  for (let i = 1; i < words.length; i += 1) {
    const first = words.slice(0, i).join(' ')
    const second = words.slice(i).join(' ')
    let score = Math.abs(first.length - second.length)
    if (first.length > maxChars || second.length > maxChars) score += 1000
    const last = words[i - 1]
    if (/[,.;:!?…]$/.test(last)) score -= 8
    if (STICKY.has(last.toLowerCase())) score += 25
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`
}
