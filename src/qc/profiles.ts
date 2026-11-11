import type { QcProfile } from './types'

/**
 * QC presets.
 *
 * These values are common subtitling conventions (≈42 characters per line, 2 lines,
 * 15–20 characters per second). They are NOT an official standard — broadcasters and
 * platforms publish their own style guides, and those should be followed when known.
 */
export const QC_PROFILES: QcProfile[] = [
  {
    id: 'standard',
    label: 'Standard (film & TV)',
    description: 'Balanced defaults for films and series.',
    maxCharsPerLine: 42,
    maxLines: 2,
    minDurationMs: 1000,
    maxDurationMs: 7000,
    maxCps: 17,
    maxWpm: 180,
    minGapMs: 80,
  },
  {
    id: 'online',
    label: 'Online video / podcast',
    description: 'Faster reading speed tolerated for YouTube, podcasts and interviews.',
    maxCharsPerLine: 42,
    maxLines: 2,
    minDurationMs: 833,
    maxDurationMs: 7000,
    maxCps: 20,
    maxWpm: 220,
    minGapMs: 0,
  },
  {
    id: 'conservative',
    label: 'Conservative (children / broadcast)',
    description: 'Slower reading speed and shorter lines.',
    maxCharsPerLine: 37,
    maxLines: 2,
    minDurationMs: 1200,
    maxDurationMs: 6000,
    maxCps: 14,
    maxWpm: 150,
    minGapMs: 120,
  },
]

export const getQcProfile = (id: string) => QC_PROFILES.find((p) => p.id === id) ?? QC_PROFILES[0]
