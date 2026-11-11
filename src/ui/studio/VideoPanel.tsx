import { Film, Maximize, Mic, Pause, Play, Upload, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { formatDisplayTime } from '../../domain/time'
import type { MediaFileRecord } from '../../domain/types'
import { stripMarkup } from '../../formats/markup'
import { useT } from '../../i18n'
import type { SessionMedia } from './mediaStore'
import { Waveform } from './Waveform'

export interface VideoHandle {
  seek: (ms: number) => void
  togglePlay: () => void
  /** Play from `fromMs` and pause at `toMs` (review a subtitle with context). Returns false without media. */
  playRange: (fromMs: number, toMs: number) => boolean
}

interface Props {
  media: SessionMedia | null
  record: MediaFileRecord | null
  subtitle: string | null
  onAttach: () => void
  onDetach: () => void
  onTime: (ms: number) => void
  onPlayingChange: (playing: boolean) => void
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** Real media playback (HTML5). Audio-only files get a waveform "podcast" view. Nothing fake. */
export const VideoPanel = forwardRef<VideoHandle, Props>(function VideoPanel({ media, record, subtitle, onAttach, onDetach, onTime, onPlayingChange }, ref) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [stageWidth, setStageWidth] = useState(600)
  /** End of a range being reviewed; playback pauses there. */
  const stopAt = useRef<number | null>(null)

  useImperativeHandle(ref, () => ({
    seek: (ms) => {
      const v = videoRef.current
      if (v && Number.isFinite(ms)) v.currentTime = ms / 1000
    },
    togglePlay: () => {
      const v = videoRef.current
      if (!v) return
      if (v.paused) void v.play().catch((e: Error) => setError(e.message))
      else v.pause()
    },
    playRange: (fromMs, toMs) => {
      const v = videoRef.current
      if (!v || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) return false
      v.currentTime = Math.max(0, fromMs) / 1000
      stopAt.current = toMs
      void v.play().catch((e: Error) => setError(e.message))
      return true
    },
  }))

  useEffect(() => {
    setError(null)
    setTime(0)
  }, [media?.url])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate
  }, [rate])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageWidth(Math.max(200, el.clientWidth - 48)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [media?.url])

  // requestAnimationFrame while playing gives smooth subtitle sync (timeupdate is ~4 Hz).
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      if (v) {
        const ms = v.currentTime * 1000
        setTime(ms)
        onTime(ms)
        if (stopAt.current !== null && ms >= stopAt.current) {
          stopAt.current = null
          v.pause()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, onTime])

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    stopAt.current = null
    if (v.paused) void v.play().catch((e: Error) => setError(e.message))
    else v.pause()
  }

  const head = (
    <div className="panel-head">
      <span className="panel-title">{media?.isVideo === false ? t('Audio') : t('Preview')}</span>
      {media && <span className="tiny muted ellipsis" style={{ maxWidth: 260 }}>{media.name}</span>}
      <span className="spacer" />
      {media && (
        <button className="btn ghost sm" onClick={onDetach} title={t('Detach media')}>
          <X size={13} /> <span className="hide-narrow">{t('Detach')}</span>
        </button>
      )}
      <button className="btn sm" onClick={onAttach}>
        <Upload size={13} /> {media ? t('Replace') : t('Attach video/audio')}
      </button>
    </div>
  )

  if (!media) {
    return (
      <div className="panel" style={{ minHeight: 0 }}>
        {head}
        <div className="video-empty">
          <div className="empty-icon"><Film size={24} /></div>
          <strong style={{ color: 'var(--text-0)' }}>{t('No video or audio attached')}</strong>
          <p className="small" style={{ maxWidth: 400 }}>
            {record
              ? t('"{file}" was attached earlier. The browser cannot keep access to local files after a restart — select the file again.', { file: record.fileName })
              : t('Attach the video or audio to watch subtitles in sync or to turn speech into subtitles. The file stays on this computer.')}
          </p>
          <button className="btn primary" onClick={onAttach}>
            <Upload size={15} /> {record ? t('Select {file} again', { file: record.fileName }) : t('Attach video/audio')}
          </button>
        </div>
      </div>
    )
  }

  const audioOnly = !media.isVideo

  return (
    <div className="panel" style={{ minHeight: 0, overflow: 'hidden' }}>
      {head}
      <div className="video-wrap" ref={wrapRef}>
        <video
          ref={videoRef}
          src={media.url}
          style={audioOnly ? { opacity: 0, position: 'absolute' } : undefined}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration * 1000)}
          onTimeUpdate={(e) => {
            if (!playing) {
              const ms = e.currentTarget.currentTime * 1000
              setTime(ms)
              onTime(ms)
            }
          }}
          onPlay={() => (setPlaying(true), onPlayingChange(true))}
          onPause={() => (setPlaying(false), onPlayingChange(false))}
          onError={() => setError(t('This file cannot be played by the built-in player (unsupported codec). Editing and transcription may still work; MKV/HEVC preview needs the desktop version.'))}
          onClick={toggle}
        />
        {audioOnly && (
          <div className="audio-stage" onClick={toggle}>
            <span className="podcast-badge"><Mic size={13} /> {t('Podcast / audio')}</span>
            {media.peaks ? (
              <Waveform peaks={media.peaks} width={Math.min(900, stageWidth)} height={120} progress={duration ? time / duration : 0} />
            ) : (
              <p className="small muted">{t('The waveform appears after transcription.')}</p>
            )}
            <div className="now-line">{subtitle ? stripMarkup(subtitle) : ''}</div>
          </div>
        )}
        {!audioOnly && subtitle && (
          <div className="video-sub">
            <span>{stripMarkup(subtitle)}</span>
          </div>
        )}
        {error && <div className="callout err small" style={{ position: 'absolute', top: 10, left: 10, right: 10 }}>{error}</div>}
      </div>
      <div className="video-controls">
        <button className="btn icon sm" onClick={toggle} title={t('Play / pause (Ctrl+Space)')} aria-label={t('Play / pause (Ctrl+Space)')}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span className="mono" style={{ minWidth: 140 }}>{formatDisplayTime(time)} / {formatDisplayTime(duration || 0)}</span>
        <input type="range" min={0} max={Math.max(1, duration)} step={10} value={Math.min(time, duration || 0)} onChange={(e) => { const v = videoRef.current; if (v) v.currentTime = Number(e.target.value) / 1000 }} aria-label={t('Seek')} />
        <select className="select" style={{ width: 74, height: 28 }} value={rate} onChange={(e) => setRate(Number(e.target.value))} title={t('Playback speed')}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        {!audioOnly && (
          <button className="btn icon sm" onClick={() => void wrapRef.current?.requestFullscreen?.()} title={t('Fullscreen')} aria-label={t('Fullscreen')}>
            <Maximize size={14} />
          </button>
        )}
      </div>
    </div>
  )
})
