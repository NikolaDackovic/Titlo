/** Timecode helpers. All internal times are integer milliseconds. */

const pad = (value: number, size = 2) => String(value).padStart(size, '0')

const split = (ms: number) => {
  const safe = Math.max(0, Math.round(ms))
  return {
    h: Math.floor(safe / 3_600_000),
    m: Math.floor((safe % 3_600_000) / 60_000),
    s: Math.floor((safe % 60_000) / 1000),
    ms: safe % 1000,
  }
}

/** `HH:MM:SS,mmm` */
export const formatSrtTime = (ms: number) => {
  const t = split(ms)
  return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)},${pad(t.ms, 3)}`
}

/** `HH:MM:SS.mmm` */
export const formatVttTime = (ms: number) => formatSrtTime(ms).replace(',', '.')

/** `H:MM:SS.cc` (centiseconds, ASS). */
export const formatAssTime = (ms: number) => {
  const cs = Math.round(Math.max(0, ms) / 10)
  const h = Math.floor(cs / 360_000)
  const m = Math.floor((cs % 360_000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs % 100)}`
}

/** Short display form used in the editor: `MM:SS.mmm` or `H:MM:SS.mmm`. */
export const formatDisplayTime = (ms: number) => {
  const t = split(ms)
  const base = `${pad(t.m)}:${pad(t.s)}.${pad(t.ms, 3)}`
  return t.h > 0 ? `${t.h}:${base}` : base
}

export const formatDuration = (ms: number) => `${(ms / 1000).toFixed(2)}s`

/**
 * Parses `HH:MM:SS,mmm`, `HH:MM:SS.mmm`, `MM:SS.mmm`, `H:MM:SS.cc`.
 * Returns `null` for anything that is not a valid timecode (no silent coercion).
 */
export const parseTimecode = (raw: string): number | null => {
  const value = raw.trim()
  const match = value.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/)
  if (!match) return null
  const [, h = '0', m, s, frac = '0'] = match
  const minutes = Number(m)
  const seconds = Number(s)
  if (minutes > 59 || seconds > 59) return null
  // Fractions are positional: ".5" = 500ms, ".05" = 50ms, ".005" = 5ms.
  const ms = Number(frac.padEnd(3, '0'))
  return Number(h) * 3_600_000 + minutes * 60_000 + seconds * 1000 + ms
}
