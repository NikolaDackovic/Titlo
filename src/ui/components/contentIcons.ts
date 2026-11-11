import { AudioLines, Clapperboard, FileText, Film, Mic, MonitorPlay, Tv } from 'lucide-react'
import type { ContentType } from '../../domain/types'

export const CONTENT_ICON: Record<ContentType, typeof Film> = {
  movie: Film,
  'tv-series': Tv,
  documentary: Clapperboard,
  podcast: Mic,
  youtube: MonitorPlay,
  interview: AudioLines,
  other: FileText,
}
