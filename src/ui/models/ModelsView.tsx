import { CheckCircle2, ExternalLink, Languages, LoaderCircle, Mic, ShieldCheck, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useServices } from '../../app/services'
import { useSettings } from '../../app/settingsContext'
import { useT } from '../../i18n'
import { WHISPER_MODELS } from '../../media/types'
import { reportError } from '../../services/errors'
import { MODEL_PHASE_LABEL, reportAvailability, transcriptionModelStatus, useModelStatus, type ModelStatus } from '../../services/modelStatus'
import { MODEL_CANDIDATES, type ModelVerdict } from '../../translation/modelRegistry'
import { isLoopbackUrl } from '../../translation/providers/localLlm'
import { OpusMtProvider } from '../../translation/providers/opusMt'
import { createProvider, PROVIDER_OPTIONS, type ProviderId, type TranslationSettings } from '../../translation/registry'
import type { ProviderAvailability } from '../../translation/types'
import { Field } from '../components/Field'

const VERDICT: Record<ModelVerdict, { label: string; cls: string }> = {
  selected: { label: 'Selected', cls: 'ok' },
  fallback: { label: 'Fallback', cls: 'accent' },
  optional: { label: 'Optional (via Local LLM)', cls: 'blue' },
  unverified: { label: 'Unverified', cls: 'warn' },
  rejected: { label: 'Not used', cls: 'err' },
}

function StatusLine({ status, onLoad, loading, disabled }: { status: ModelStatus; onLoad: () => void; loading: boolean; disabled?: boolean }) {
  const t = useT()
  const busy = loading || status.phase === 'loading'
  return (
    <div className="row wrap" style={{ gap: 10 }}>
      <span className={`dot ${status.phase === 'ready' ? 'ok' : status.phase === 'error' || status.phase === 'not-installed' ? 'err' : status.phase === 'loading' ? 'warn' : ''}`} />
      <span className="small"><strong>{t(MODEL_PHASE_LABEL[status.phase])}</strong> <span className="muted">{status.message}</span></span>
      <span className="spacer" />
      <button className="btn sm" onClick={onLoad} disabled={disabled || busy || status.phase === 'ready'}>
        {busy && <LoaderCircle size={13} className="spin" />} {t('Load model now')}
      </button>
    </div>
  )
}

export function ModelsView() {
  const t = useT()
  const { providerDeps, transcription } = useServices()
  const { settings, update } = useSettings()
  const tr = settings.translation
  const [check, setCheck] = useState<ProviderAvailability | 'checking' | null>(null)
  const [speechCheck, setSpeechCheck] = useState<ProviderAvailability | null>(null)
  const [loadingModel, setLoadingModel] = useState(false)
  const [loadingSpeech, setLoadingSpeech] = useState(false)
  const modelStatus = useModelStatus()
  const speechStatus = transcriptionModelStatus.useStatus()

  const setTr = (patch: Partial<TranslationSettings>) => {
    setCheck(null)
    update({ translation: { ...tr, ...patch } })
  }

  useEffect(() => {
    let cancelled = false
    void transcription.checkModel(settings.transcription.modelId).then((r) => !cancelled && setSpeechCheck(r))
    return () => {
      cancelled = true
    }
  }, [settings.transcription.modelId, transcription])

  const runCheck = async () => {
    setCheck('checking')
    try {
      const result = await createProvider(tr, providerDeps).checkAvailability()
      if (tr.providerId === 'opus-mt-en-sh') reportAvailability(tr.opusModelId, result.available, result.message)
      setCheck(result)
    } catch (error) {
      setCheck({ available: false, message: (error as Error).message })
    }
  }

  /** Loads the translation model in its worker now, so the first translation does not wait. */
  const loadModel = async () => {
    setLoadingModel(true)
    try {
      const provider = createProvider(tr, providerDeps)
      const availability = await provider.checkAvailability()
      reportAvailability(tr.opusModelId, availability.available, availability.message)
      if (availability.available && provider instanceof OpusMtProvider) await provider.warmUp()
      else if (!availability.available) setCheck(availability)
    } catch (error) {
      reportError(t('Could not load the model'), error)
    } finally {
      setLoadingModel(false)
    }
  }

  const loadSpeech = async () => {
    setLoadingSpeech(true)
    try {
      const availability = await transcription.checkModel(settings.transcription.modelId)
      setSpeechCheck(availability)
      if (availability.available) await transcription.warmUp(settings.transcription.modelId)
    } catch (error) {
      reportError(t('Could not load the model'), error)
    } finally {
      setLoadingSpeech(false)
    }
  }

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>{t('Local AI models')}</h1>
            <div className="muted">{t('Everything runs on this computer. Models are never downloaded automatically.')}</div>
          </div>
        </div>

        <div className="callout info">
          <ShieldCheck size={16} color="var(--ok)" />
          <div className="small">{t('Privacy: subtitles, audio and video never leave this computer. The Local LLM option only accepts servers on localhost / 127.0.0.1; remote addresses are blocked.')}</div>
        </div>

        {/* ---------------- Speech → text ---------------- */}
        <div className="card col" style={{ gap: 14 }}>
          <div className="row"><Mic size={16} color="var(--accent-strong)" /><div className="section-title" style={{ margin: 0 }}>{t('Speech → text (Whisper)')}</div></div>
          <p className="small muted">{t('Turns the audio of a video or podcast into timed subtitles. Runs in the browser on the CPU (WebAssembly).')}</p>
          <div className="grid-2">
            {WHISPER_MODELS.map((m) => (
              <button key={m.id} className={`choice${settings.transcription.modelId === m.id ? ' active' : ''}`} onClick={() => update({ transcription: { modelId: m.id } })}>
                <span className="wf-icon"><Mic size={17} /></span>
                <span><strong>{m.label} · ~{m.sizeMb} MB</strong><span>{t(m.note)}</span></span>
              </button>
            ))}
          </div>
          {speechCheck && !speechCheck.available && (
            <div className="callout warn">
              <XCircle size={16} />
              <div className="small">
                <strong>{t('Not installed.')}</strong> {t('Run once in the project folder (only the download needs internet):')}
                <pre className="mono" style={{ margin: '6px 0 0' }}>{settings.transcription.modelId.endsWith('base') ? 'npm run model:install:whisper -- --size base' : 'npm run model:install:whisper'}</pre>
              </div>
            </div>
          )}
          <StatusLine status={speechStatus} onLoad={() => void loadSpeech()} loading={loadingSpeech} disabled={!speechCheck?.available} />
        </div>

        {/* ---------------- Translation ---------------- */}
        <div className="card col" style={{ gap: 14 }}>
          <div className="row"><Languages size={16} color="var(--accent-strong)" /><div className="section-title" style={{ margin: 0 }}>{t('Translation (English → Serbian / Croatian / Bosnian)')}</div></div>
          <div className="grid-3">
            {PROVIDER_OPTIONS.map((p) => (
              <button key={p.id} className={`choice${tr.providerId === p.id ? ' active' : ''}`} onClick={() => setTr({ providerId: p.id as ProviderId })}>
                <span><strong>{t(p.label)}</strong><span>{t(p.description)}</span></span>
              </button>
            ))}
          </div>

          {tr.providerId === 'opus-mt-en-sh' && (
            <div className="grid-3">
              <Field label={t('Model id (folder under models/)')} hint="Helsinki-NLP/opus-mt-tc-base-en-sh">
                <input className="input mono" value={tr.opusModelId} onChange={(e) => setTr({ opusModelId: e.target.value.trim() })} />
              </Field>
              <Field label={t('Hardware acceleration')} hint={t('WebGPU needs a supported GPU/driver; CPU (WASM) works everywhere.')}>
                <select className="select" value={tr.opus.device} onChange={(e) => setTr({ opus: { ...tr.opus, device: e.target.value as typeof tr.opus.device } })}>
                  <option value="wasm">CPU (WebAssembly)</option>
                  <option value="webgpu">{t('GPU (WebGPU, experimental)')}</option>
                </select>
              </Field>
              <Field label={t('Precision')} hint={t('int8 is about 4× smaller and faster; fp32 is the reference quality.')}>
                <select className="select" value={tr.opus.dtype} onChange={(e) => setTr({ opus: { ...tr.opus, dtype: e.target.value as typeof tr.opus.dtype } })}>
                  <option value="q8">int8</option>
                  <option value="fp32">fp32</option>
                  <option value="fp16">fp16</option>
                </select>
              </Field>
              <Field label={t('Beam search')} hint={t('Higher = slightly better, slower.')}>
                <select className="select" value={tr.opus.numBeams} onChange={(e) => setTr({ opus: { ...tr.opus, numBeams: Number(e.target.value) } })}>
                  {[1, 2, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            </div>
          )}

          {tr.providerId === 'local-llm' && (
            <div className="grid-3">
              <Field label={t('Server URL')} hint={isLoopbackUrl(tr.llm.baseUrl) ? 'llama-server 8080 · Ollama 11434 · LM Studio 1234' : t('Blocked: must be on this computer.')}>
                <input className={`input mono${isLoopbackUrl(tr.llm.baseUrl) ? '' : ' invalid'}`} value={tr.llm.baseUrl} onChange={(e) => setTr({ llm: { ...tr.llm, baseUrl: e.target.value.trim() } })} />
              </Field>
              <Field label={t('Model name')} hint={t('As listed by the server (e.g. eurollm-9b-instruct, qwen3:8b).')}>
                <input className="input mono" value={tr.llm.model} onChange={(e) => setTr({ llm: { ...tr.llm, model: e.target.value.trim() } })} />
              </Field>
              <Field label={t('Temperature')}>
                <input className="input" type="number" step="0.1" min="0" max="1" value={tr.llm.temperature} onChange={(e) => setTr({ llm: { ...tr.llm, temperature: Number(e.target.value) } })} />
              </Field>
              <Field label={t('Context lines')} hint={t('Neighbouring subtitles passed before/after each line.')}>
                <select className="select" value={tr.contextSize} onChange={(e) => setTr({ contextSize: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            </div>
          )}

          {tr.providerId === 'test' && (
            <div className="callout warn small">{t('The TEST provider does not translate. It marks the source with [TEST] so you can try the workflow. Quality control reports its output as an error.')}</div>
          )}

          <div className="row wrap">
            <button className="btn" onClick={() => void runCheck()} disabled={check === 'checking'}>
              {check === 'checking' && <LoaderCircle size={14} className="spin" />} {t('Check availability')}
            </button>
            {check && check !== 'checking' && (
              <span className="row small">
                {check.available ? <CheckCircle2 size={15} color="var(--ok)" /> : <XCircle size={15} color="var(--warn)" />}
                {check.message}
              </span>
            )}
          </div>
          {check && check !== 'checking' && check.details && (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {check.details.map((d) => <li key={d} className="mono">{d}</li>)}
            </ul>
          )}
          {tr.providerId === 'opus-mt-en-sh' && <StatusLine status={modelStatus} onLoad={() => void loadModel()} loading={loadingModel} />}

          <details>
            <summary className="small" style={{ cursor: 'pointer' }}>{t('How to install the translation model (one-time, ~400 MB, no Python)')}</summary>
            <div className="small col" style={{ marginTop: 8, color: 'var(--text-1)' }}>
              <pre className="mono" style={{ background: 'var(--bg-0)', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', margin: 0 }}>{`npm run model:install
npm run model:smoke`}</pre>
              <p className="tiny muted">{t('Status: Experimental. Quality has not been evaluated by people; the result is a draft that must be reviewed. Details: docs/MODELS.md and docs/TRANSLATION_QUALITY_REPORT.md.')}</p>
            </div>
          </details>
        </div>

        <details className="panel">
          <summary className="panel-head" style={{ cursor: 'pointer' }}><span className="panel-title">{t('Model research and licences (technical details, in English)')}</span></summary>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Model</th><th>Languages (as stated)</th><th>Licence / commercial use</th><th>Size · RAM</th><th>Status</th></tr>
              </thead>
              <tbody>
                {MODEL_CANDIDATES.map((m) => (
                  <tr key={m.id}>
                    <td style={{ minWidth: 200 }}>
                      <strong>{m.name}</strong>
                      <div className="tiny muted">{m.task}</div>
                      <a className="tiny" href={m.source} target="_blank" rel="noreferrer">model card <ExternalLink size={10} /></a>
                    </td>
                    <td className="small">{m.languages}</td>
                    <td className="small"><strong>{m.license}</strong><div className="tiny muted">{m.commercial}</div></td>
                    <td className="small">{m.size}<div className="tiny muted">{m.ram} · {m.hardware}</div></td>
                    <td className="small" style={{ minWidth: 220 }}>
                      <span className={`badge ${VERDICT[m.verdict].cls}`}>{VERDICT[m.verdict].label}</span>
                      <div className="tiny muted" style={{ marginTop: 4 }}>{m.notes}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <div className="small muted">
          {t('Attribution')}: Whisper © OpenAI (MIT). OPUS-MT © Language Technology Research Group, University of Helsinki (CC-BY-4.0). Transformers.js © Hugging Face (Apache-2.0). ONNX Runtime © Microsoft (MIT). SQLite (public domain), sql.js (MIT).
        </div>
      </div>
    </div>
  )
}
