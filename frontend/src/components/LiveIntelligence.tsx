import { useEffect, useMemo, useState } from 'react'
import { Activity, BookOpenText, CirclePause, RotateCcw, TriangleAlert } from 'lucide-react'
import type { ActiveAlerts, Alert, Correlation, LiveFeed, OffsetMatch, PredictiveRisk } from '../lib/api'
import { api, queryString } from '../lib/api'
import { EvidenceDrawer } from './EvidenceDrawer'
import { EmptyState, ErrorState, Loading } from './Feedback'

type Evaluation = { correlation: Correlation; alerts: ActiveAlerts; prediction: PredictiveRisk }

export function LiveIntelligence({ activeWellId, radiusKm, depthWindowM }: { activeWellId: string; radiusKm: number; depthWindowM: number }) {
  const [feed, setFeed] = useState<LiveFeed | null>(null)
  const [index, setIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [feedRevision, setFeedRevision] = useState(0)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [evaluationError, setEvaluationError] = useState<string | null>(null)
  const [selectedEvidence, setSelectedEvidence] = useState<OffsetMatch | null>(null)
  const state = feed?.states[index] ?? null

  useEffect(() => {
    let stale = false
    setFeed(null)
    setEvaluation(null)
    setIndex(0)
    setRunning(false)
    setLoading(true)
    setFeedError(null)
    api<LiveFeed>(`/live/${activeWellId}?limit=100`)
      .then((result) => { if (!stale) setFeed(result) })
      .catch((error: unknown) => { if (!stale) setFeedError(error instanceof Error ? error.message : 'Unable to load the simulated feed.') })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [activeWellId, feedRevision])

  useEffect(() => {
    if (!running || !feed || index >= feed.states.length - 1) return
    const timer = window.setTimeout(() => {
      if (index + 1 >= feed.states.length) {
        setRunning(false)
        return
      }
      setIndex(index + 1)
      if (index + 1 === feed.states.length - 1) setRunning(false)
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [running, feed, index])

  useEffect(() => {
    if (!activeWellId || !state) return
    let stale = false
    const measurement = state.measurement
    const params = queryString({
      radius_km: radiusKm,
      depth_window_m: depthWindowM,
      active_depth_m: measurement.measured_depth_m,
      active_formation: state.formation ?? undefined,
    })
    const body = JSON.stringify({
      radius_km: radiusKm,
      depth_window_m: depthWindowM,
      active_depth_m: measurement.measured_depth_m,
      active_formation: state.formation,
    })
    setEvaluationError(null)
    setEvaluation(null)
    Promise.all([
      api<Correlation>(`/intelligence/${activeWellId}/correlation${params}`),
      api<ActiveAlerts>(`/alerts/active/${activeWellId}${params}`),
      api<PredictiveRisk>(`/predictive-risk/${activeWellId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ]).then(([correlation, alerts, prediction]) => {
      if (!stale) setEvaluation({ correlation, alerts, prediction })
    }).catch((error: unknown) => {
      if (!stale) setEvaluationError(error instanceof Error ? error.message : 'Unable to evaluate this simulated feed state.')
    })
    return () => { stale = true }
  }, [activeWellId, radiusKm, depthWindowM, state])

  const upcomingPrecedents = useMemo(() => (evaluation?.alerts.alerts ?? [])
    .filter((alert) => alert.depth_difference_m != null && alert.depth_difference_m > 0)
    .sort((left, right) => (left.depth_difference_m ?? Infinity) - (right.depth_difference_m ?? Infinity))
    .map((alert) => ({
      alert,
      match: evaluation?.correlation.historical_events.find((match) => match.event_id === alert.historical_event_id) ?? null,
    }))
    .filter((item): item is { alert: Alert; match: OffsetMatch } => item.match !== null), [evaluation])
  const nearestAlert = upcomingPrecedents[0]?.alert ?? null
  const alertMatch = upcomingPrecedents[0]?.match ?? null
  const supportingWells = Array.from(new Set((evaluation?.correlation.historical_events ?? [])
    .filter((match) => match.formation_match === 'exact' && match.depth_difference_m > 0)
    .map((match) => match.offset_well.well_name))).slice(0, 4)

  const start = () => {
    if (!feed?.states.length) return
    if (index >= feed.states.length - 1) setIndex(0)
    setRunning(true)
  }

  return <section className="panel live-intelligence" aria-label="Live intelligence">
    <div className="panel-heading">
      <div><div className="eyebrow">REPLAY MONITORING</div><h2><Activity size={18} /> Live Intelligence</h2></div>
      <div className="live-panel-actions">
        <span className={`live-monitor-status ${running ? 'running' : ''}`}><i />{running ? 'MONITORING REPLAY' : index === (feed?.states.length ?? 0) - 1 && index > 0 ? 'REPLAY COMPLETE' : 'PAUSED'}</span>
        {running ? <button type="button" className="secondary-button" onClick={() => setRunning(false)}><CirclePause size={15} /> Pause replay</button> : <button type="button" className="primary-button" onClick={start} disabled={!feed?.states.length} aria-label="Start live monitoring replay"><Activity size={15} /> Start replay</button>}
        <button type="button" className="quiet-live-button" onClick={() => { setRunning(false); setIndex(0) }} disabled={!feed?.states.length} aria-label="Reset replay"><RotateCcw size={15} /> Reset</button>
      </div>
    </div>
    {loading ? <div className="live-loading"><Loading label="Loading deterministic drilling replay" /></div> : feedError ? <ErrorState message={feedError} retry={() => { setFeedError(null); setFeedRevision((value) => value + 1) }} /> : !state ? <EmptyState title="No simulated drilling samples are seeded for this well." detail="The historical well repository remains available; a live replay sequence is not currently available." /> : <>
      <div className="live-synthetic-banner"><strong>SIMULATED eRTMAC</strong><span>Representative Synthetic Data</span><span>No connection to OIL's actual eRTMAC system</span></div>
      <div className="live-dashboard-grid">
        <div className="live-replay-column">
          <div className="live-current-row">
            <div className="live-current-depth"><span>CURRENT REPLAY DEPTH</span><strong>{state.measurement.measured_depth_m.toLocaleString()}<small> m MD</small></strong><small>{state.formation ?? 'Formation unavailable'}</small></div>
            <div className="live-current-well"><span>REPLAY STATE</span><strong>{feed?.well_name}</strong><small>{running ? 'Monitoring' : index === (feed?.states.length ?? 0) - 1 && index > 0 ? 'Replay complete' : 'Paused'} · {new Date(state.measurement.sampled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>
          </div>
          <div className="live-parameter-heading">CURRENT DRILLING PARAMETERS</div>
          <div className="live-parameter-strip" aria-label="Current synthetic drilling parameters">
            <Parameter label="Mud weight" value={state.measurement.mud_weight_sg} unit="SG" decimals={3} />
            <Parameter label="ECD" value={state.measurement.ecd_sg} unit="SG" decimals={3} />
            <Parameter label="ROP" value={state.measurement.rop_m_per_hr} unit="m/hr" />
            <Parameter label="WOB" value={state.measurement.wob_kn} unit="kN" />
            <Parameter label="RPM" value={state.measurement.rpm} unit="rpm" />
            <Parameter label="Torque" value={state.measurement.torque_knm} unit="kN·m" />
            <Parameter label="SPP" value={state.measurement.standpipe_pressure_mpa} unit="MPa" />
            <Parameter label="Pressure indicator" textValue={state.pressure_indicator} />
          </div>
          <p className="live-step-note">Recorded at fixed five-minute steps. Playback advances deterministically.</p>
        </div>
        <div className="live-intelligence-column">
        <div className="live-precedent-card">
          <div className="live-card-heading"><TriangleAlert size={16} /><span>HISTORICAL INTELLIGENCE</span><small>{evaluation?.alerts.title ?? 'Evaluating'}</small></div>
          {evaluationError ? <div className="inline-error">{evaluationError}</div> : !evaluation ? <Loading label="Checking offset history and model signals" /> : alertMatch && nearestAlert ? <>
            <strong className="live-event-title">{alertMatch.event_title}</strong>
            <div className="live-alert-facts">
              <span>Event type: {formatEventType(alertMatch.event_type)}</span>
              <span>Offset well: {alertMatch.offset_well.well_name}</span>
              <span>Upcoming depth: {alertMatch.historical_depth_m.toLocaleString()} m MD</span>
              <span>Formation: {alertMatch.formation?.name ?? 'Formation not recorded'}</span>
              <span>Distance: {alertMatch.distance_km.toFixed(1)} km</span>
              <span>Depth ahead: {nearestAlert.depth_difference_m} m</span>
              <span>Latest alert: {nearestAlert.status.toUpperCase()}</span>
            </div>
            <p>{alertMatch.formation_match === 'exact' ? 'Relevant historical precedent detected ahead in the same formation.' : 'Relevant historical precedent detected ahead in the configured search window.'}</p>
            <div className="live-supporting-wells"><strong>Supporting wells</strong><span>{supportingWells.length ? supportingWells.join(' · ') : alertMatch.offset_well.well_name}</span></div>
            <button type="button" className="inline-link" onClick={() => setSelectedEvidence(alertMatch)}><BookOpenText size={15} /> View source evidence &amp; mitigation</button>
            {upcomingPrecedents.length > 1 && <details className="live-more-precedents">
              <summary>Also ahead in the configured window ({upcomingPrecedents.length - 1})</summary>
              <div className="live-upcoming-list">
                {upcomingPrecedents.slice(1, 4).map(({ alert, match }) => <button type="button" key={alert.id} onClick={() => setSelectedEvidence(match)}>
                  <span>{match.event_title}</span><small>{match.offset_well.well_name} · {alert.depth_difference_m} m ahead · {match.distance_km.toFixed(1)} km</small>
                </button>)}
              </div>
            </details>}
          </> : <EmptyState title="No significant historical precedent at this replay depth." detail="This reflects the representative historical records in the configured radius and depth window." />}
        </div>
        <div className="live-model-card">
          <div className="live-card-heading"><Activity size={16} /><span>PROTOTYPE ML SIGNAL</span><small>{evaluation?.prediction.model_version ?? 'Prototype'}</small></div>
          <div className="live-model-disclaimer">
            <strong>{evaluation?.prediction.notice ?? 'Prototype model — evaluation limited by representative synthetic data.'}</strong>
            <span>Engineer review required.</span>
          </div>
          {evaluation?.prediction.status === 'available' ? <>
            {evaluation.prediction.signals[0] && <RiskSignal signal={evaluation.prediction.signals[0]} onSelectEvidence={setSelectedEvidence} />}
            {evaluation.prediction.signals.length > 1 && <details className="live-additional-signals">
              <summary>Additional prototype signals ({evaluation.prediction.signals.length - 1})</summary>
              {evaluation.prediction.signals.slice(1).map((signal) => <RiskSignal key={signal.risk_type} signal={signal} onSelectEvidence={setSelectedEvidence} />)}
            </details>}
            <small className="live-model-notice">Probabilities are uncalibrated historical decision-support signals.</small>
          </> : evaluation ? <div className="live-insufficient">{evaluation.prediction.message ?? 'Insufficient matching historical event data for this context.'}</div> : <Loading label="Fitting deterministic demo classifier" />}
        </div>
        </div>
      </div>
      {evaluation?.alerts.recommendation && <details className="live-secondary-details">
        <summary>Recommendation, source and recorded mitigation</summary>
        <div className="live-recommendation">
        <div><span>{evaluation.alerts.recommendation.label}</span><strong>{evaluation.alerts.recommendation.message}</strong><small>{evaluation.alerts.recommendation.reason}</small></div>
        <div className="live-recommendation-source"><strong>{evaluation.alerts.recommendation.source_event_title} · {evaluation.alerts.recommendation.source_well_name} · {evaluation.alerts.recommendation.source_document} · p.{evaluation.alerts.recommendation.source_page ?? '—'}</strong><span>{evaluation.alerts.recommendation.recorded_mitigation}</span><small>{evaluation.alerts.recommendation.evidence_excerpt}</small></div>
        </div>
      </details>}
      <details className="live-secondary-details"><summary>Evidence workflow and additional replay details</summary><div className="live-workflow">CURRENT WELL <i /> DEPTH / FORMATION <i /> HISTORICAL PRECEDENT <i /> SOURCE EVIDENCE <i /> RECORDED MITIGATION <i /> ENGINEER REVIEW</div></details>
    </>}
    {selectedEvidence && <EvidenceDrawer match={selectedEvidence} relatedMatches={evaluation?.correlation.historical_events} onClose={() => setSelectedEvidence(null)} />}
  </section>
}

function formatEventType(eventType: string) {
  return eventType.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function RiskSignal({ signal, onSelectEvidence }: { signal: PredictiveRisk['signals'][number]; onSelectEvidence: (match: OffsetMatch) => void }) {
  return <div className="live-risk-signal">
    <div><strong>{signal.risk_type}</strong><span>Prototype probability: {signal.probability.toFixed(2)}</span></div>
    <small className="live-risk-band">{signal.risk_band}</small>
    <div className="live-risk-contributors"><strong>Top contributing features</strong>
      <ul>{signal.top_contributing_features.slice(0, 3).map((feature) => <li key={feature.feature} title={feature.explanation}>{feature.explanation}</li>)}</ul>
    </div>
    {signal.supporting_historical_events.length > 0 && <details className="live-risk-details">
      <summary>Supporting historical evidence ({signal.supporting_historical_events.length})</summary>
      <div className="live-risk-evidence">
        {signal.supporting_historical_events.map((event) => <button type="button" key={event.event_id} onClick={() => onSelectEvidence(event)}>
          <span>{event.event_title}</span>
          <small>{event.offset_well.well_name} · {event.historical_depth_m.toLocaleString()} m · {event.source_document.filename} · p.{event.source_page ?? '—'} · View evidence</small>
        </button>)}
      </div>
    </details>}
  </div>
}

function Parameter({ label, value, textValue, unit, decimals = 1 }: { label: string; value?: number | null; textValue?: string | null; unit?: string; decimals?: number }) {
  const displayValue = textValue ?? (value == null ? '—' : `${value.toFixed(decimals)} ${unit ?? ''}`.trim())
  return <div className="live-parameter"><span>{label}</span><strong>{displayValue}</strong></div>
}
