import { useEffect, useRef, useState } from 'react'
import { BrandLogo } from './BrandLogo'

type ApiStatus = 'loading' | 'online' | 'offline'

const progressMilestones = [
  { elapsedMs: 0, progress: 10 },
  { elapsedMs: 2_500, progress: 25 },
  { elapsedMs: 8_000, progress: 45 },
  { elapsedMs: 20_000, progress: 65 },
  { elapsedMs: 35_000, progress: 80 },
  { elapsedMs: 55_000, progress: 92 },
  { elapsedMs: 70_000, progress: 94 },
]

function estimateProgress(elapsedMs: number) {
  const nextMilestone = progressMilestones.findIndex((milestone) => milestone.elapsedMs > elapsedMs)
  if (nextMilestone === -1) return 94
  const previous = progressMilestones[nextMilestone - 1]
  const next = progressMilestones[nextMilestone]
  const progressInSegment = (elapsedMs - previous.elapsedMs) / (next.elapsedMs - previous.elapsedMs)
  return Math.min(94, Math.round(previous.progress + (next.progress - previous.progress) * progressInSegment))
}

function statusForProgress(progress: number) {
  if (progress <= 25) return 'Connecting to safety intelligence engine...'
  if (progress < 45) return 'Waking analysis services...'
  if (progress <= 65) return 'Loading safety data...'
  if (progress <= 80) return 'Preparing analytics...'
  return 'Finalizing dashboard...'
}

export function StartupProgressOverlay({ apiStatus }: { apiStatus: ApiStatus }) {
  const [visible, setVisible] = useState(apiStatus === 'loading')
  const [progress, setProgress] = useState(apiStatus === 'loading' ? 10 : 100)
  const [statusMessage, setStatusMessage] = useState(statusForProgress(10))
  const [complete, setComplete] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)
  const startedAt = useRef(Date.now())
  const progressRef = useRef(apiStatus === 'loading' ? 10 : 100)

  useEffect(() => {
    if (apiStatus === 'loading') {
      startedAt.current = Date.now()
      setVisible(true)
      setProgress(10)
      progressRef.current = 10
      setComplete(false)
      setFadeOut(false)
      setStatusMessage(statusForProgress(10))
      const timer = window.setInterval(() => {
        const elapsedMs = Date.now() - startedAt.current
        progressRef.current = estimateProgress(elapsedMs)
        setProgress(progressRef.current)
        setStatusMessage(statusForProgress(progressRef.current))
      }, 150)
      return () => window.clearInterval(timer)
    }

    if (apiStatus === 'online') {
      setVisible(true)
      setComplete(true)
      setStatusMessage('Safety intelligence ready. Opening your dashboard...')
      const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      const completionDuration = prefersReducedMotion ? 0 : 650
      let progressTimer: number | undefined
      if (completionDuration === 0) {
        progressRef.current = 100
        setProgress(100)
      } else {
        const completionStartedAt = Date.now()
        const initialProgress = progressRef.current
        progressTimer = window.setInterval(() => {
          const ratio = Math.min(1, (Date.now() - completionStartedAt) / completionDuration)
          progressRef.current = Math.round(initialProgress + (100 - initialProgress) * ratio)
          setProgress(progressRef.current)
          if (ratio >= 1 && progressTimer !== undefined) window.clearInterval(progressTimer)
        }, 25)
      }
      const fadeTimer = window.setTimeout(() => setFadeOut(true), completionDuration)
      const dismissTimer = window.setTimeout(() => setVisible(false), completionDuration + (prefersReducedMotion ? 0 : 180))
      return () => {
        if (progressTimer !== undefined) window.clearInterval(progressTimer)
        window.clearTimeout(fadeTimer)
        window.clearTimeout(dismissTimer)
      }
    }

    setVisible(false)
    setComplete(false)
    setFadeOut(false)
    return undefined
  }, [apiStatus])

  if (!visible || apiStatus === 'offline') return null

  const completion = Math.max(0, Math.min(100, progress))
  const circumference = 2 * Math.PI * 39
  const strokeOffset = circumference * (1 - completion / 100)

  return <div className={`startup-overlay${fadeOut ? ' is-fading' : ''}`}>
    <section className="startup-card" role="dialog" aria-modal="true" aria-labelledby="startup-title" aria-describedby="startup-description startup-keep-open">
      <BrandLogo className="startup-logo" />
      <h2 id="startup-title">Preparing Safety Intelligence</h2>
      <p id="startup-description" className="startup-description">Initializing the analysis engine.<br />First-time initialization may take up to a minute.</p>

      <div className="startup-progress-wrap">
        <div
          className="startup-progress-circle"
          role="progressbar"
          aria-label="Estimated initialization progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completion}
          aria-valuetext={completion >= 100 ? 'Initialization complete' : complete ? 'Backend ready; completing the indicator' : `${completion}% estimated; waiting for backend response`}
        >
          <svg viewBox="0 0 96 96" aria-hidden="true">
            <circle className="startup-progress-track" cx="48" cy="48" r="39" />
            <circle className="startup-progress-value" cx="48" cy="48" r="39" style={{ strokeDasharray: circumference, strokeDashoffset: strokeOffset }} />
            {!complete && <circle className="startup-progress-orbit" cx="48" cy="48" r="44" />}
          </svg>
          <span><strong>{completion}</strong><small>%</small></span>
        </div>
        <span className="startup-estimate-label">Estimated progress</span>
      </div>

      <p className="startup-status" role="status" aria-live="polite"><i aria-hidden="true" /><span key={statusMessage} className="startup-status-copy">{statusMessage}</span></p>
      <p id="startup-keep-open" className="startup-keep-open"><strong>Please keep this window open</strong> — the dashboard will load automatically.</p>
    </section>
  </div>
}
