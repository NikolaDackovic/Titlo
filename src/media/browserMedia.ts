import type { MediaInfo, MediaProcessor } from './types'

/** Reads metadata of media the browser can decode (used for the preview and QC). */
export class BrowserMediaProcessor implements MediaProcessor {
  probe(file: File): Promise<MediaInfo> {
    return new Promise((resolve) => {
      const isVideo = file.type.startsWith('video/') || /\.(mp4|mkv|mov|webm)$/i.test(file.name)
      const el = document.createElement(isVideo ? 'video' : 'audio')
      const url = URL.createObjectURL(file)
      const done = (info: MediaInfo) => {
        URL.revokeObjectURL(url)
        el.removeAttribute('src')
        resolve(info)
      }
      el.preload = 'metadata'
      el.onloadedmetadata = () => {
        const duration = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null
        const video = el as HTMLVideoElement
        done({ durationMs: duration, hasVideo: isVideo && video.videoWidth > 0, width: video.videoWidth || undefined, height: video.videoHeight || undefined })
      }
      el.onerror = () => done({ durationMs: null, hasVideo: false })
      el.src = url
    })
  }
}
