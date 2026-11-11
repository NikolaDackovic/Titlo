import { useEffect, useRef } from 'react'

interface Props {
  peaks: Float32Array
  /** CSS pixel width to draw (canvas is capped at 16 000 px for very long media). */
  width: number
  height: number
  /** 0–1 playback position; the played part is drawn brighter. */
  progress?: number
  className?: string
  mirrored?: boolean
}

/** Real waveform drawn from decoded audio peaks (no fake animation). */
export function Waveform({ peaks, width, height, progress = 0, className, mirrored = true }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !peaks.length || width <= 0) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pxWidth = Math.min(16000, Math.round(width * dpr))
    canvas.width = pxWidth
    canvas.height = Math.round(height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const bar = Math.max(1, Math.floor(pxWidth / peaks.length))
    const step = peaks.length / (pxWidth / bar)
    const mid = mirrored ? canvas.height / 2 : canvas.height
    const played = progress * pxWidth
    const playedGrad = ctx.createLinearGradient(0, 0, pxWidth, 0)
    playedGrad.addColorStop(0, '#8b7cf6')
    playedGrad.addColorStop(1, '#4fb3ff')
    for (let x = 0, i = 0; x < pxWidth; x += bar, i += step) {
      const v = peaks[Math.min(peaks.length - 1, Math.floor(i))]
      const h = Math.max(1, v * (mirrored ? canvas.height * 0.48 : canvas.height * 0.95))
      ctx.fillStyle = x < played ? playedGrad : 'rgba(170, 176, 200, 0.45)'
      if (mirrored) ctx.fillRect(x, mid - h, Math.max(1, bar - 1), h * 2)
      else ctx.fillRect(x, mid - h, Math.max(1, bar - 1), h)
    }
  }, [peaks, width, height, progress, mirrored])

  return <canvas ref={ref} className={className} style={{ width, height }} aria-hidden="true" />
}
