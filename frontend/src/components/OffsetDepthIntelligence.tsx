import { useEffect, useMemo, useState } from 'react'
import { Activity, ChevronRight, Ruler } from 'lucide-react'
import type { Correlation, DrillingMeasurement, LiveFeed, OffsetMatch, Well } from '../lib/api'
import { api } from '../lib/api'
import { formatDepth, formatDistance, humanize } from '../lib/format'

type Props = {
  activeWell: Well
  activeMeasurements: DrillingMeasurement[]
  correlation: Correlation
  depthWindowM: number
  selectedOffsetId?: string
  onSelectOffset: (wellId: string) => void
  onSelectEvent: (event: OffsetMatch) => void
}

type Track = { key: 'rop_m_per_hr' | 'torque_knm'; label: string; unit: string; color: string }

const TRACKS: Track[] = [
  { key: 'rop_m_per_hr', label: 'ROP', unit: 'm/hr', color: '#287453' },
  { key: 'torque_knm', label: 'TORQUE', unit: 'kN·m', color: '#438f89' },
]

const CHART = { width: 1080, height: 430, top: 48, bottom: 392, axisX: 68, ropStart: 94, ropEnd: 420, torqueStart: 450, torqueEnd: 776, eventDotX: 806, eventTextX: 824 }

export function OffsetDepthIntelligence({ activeWell, activeMeasurements, correlation, depthWindowM, selectedOffsetId, onSelectOffset, onSelectEvent }: Props) {
  const [offsetMeasurements, setOffsetMeasurements] = useState<DrillingMeasurement[]>([])
  const [offsetLoading, setOffsetLoading] = useState(false)
  const [offsetError, setOffsetError] = useState(false)
  const comparables = correlation.comparable_wells
  const selected = comparables.find((row) => row.offset_well.id === selectedOffsetId) ?? comparables[0]
  const selectedWellId = selected?.offset_well.id

  useEffect(() => {
    if (!selectedWellId) {
      setOffsetMeasurements([])
      return
    }
    let current = true
    setOffsetLoading(true)
    setOffsetError(false)
    setOffsetMeasurements([])
    api<LiveFeed>(`/live/${selectedWellId}?limit=100`)
      .then((feed) => {
        if (current) setOffsetMeasurements(feed.states.map((row) => row.measurement))
      })
      .catch(() => {
        if (current) {
          setOffsetMeasurements([])
          setOffsetError(true)
        }
      })
      .finally(() => { if (current) setOffsetLoading(false) })
    return () => { current = false }
  }, [selectedWellId])

  const selectedEvents = useMemo(() => correlation.historical_events
    .filter((event) => event.offset_well.id === selectedWellId)
    .sort((left, right) => left.historical_depth_m - right.historical_depth_m), [correlation.historical_events, selectedWellId])
  const strongestSelectedEvent = selectedEvents.reduce<OffsetMatch | null>((strongest, event) => !strongest || event.relevance_score > strongest.relevance_score ? event : strongest, null)
  const currentDepth = activeWell.current_depth ?? activeMeasurements[activeMeasurements.length - 1]?.measured_depth_m ?? null
  const upcoming = selectedEvents
    .filter((event) => event.depth_difference_m > 0)
    .sort((left, right) => left.depth_difference_m - right.depth_difference_m)[0]
  const selectedScore = selectedEvents.length ? Math.max(...selectedEvents.map((event) => event.relevance_score)) : null
  const formationLabel = selected?.formation_match === 'exact' || selected?.formation_match === 'alias'
    ? 'Same formation'
    : selected ? `${humanize(selected.formation_match)} formation` : 'Formation unavailable'

  const minDepth = Math.max(0, (currentDepth ?? 0) - 40)
  const aheadRange = Math.max(Math.min(Math.max(depthWindowM, 60), 300), upcoming ? Math.min(upcoming.depth_difference_m + 20, 1000) : 0)
  const maxDepth = Math.max(minDepth + 1, (currentDepth ?? 0) + aheadRange)
  const yAt = (depth: number) => CHART.top + ((depth - minDepth) / (maxDepth - minDepth)) * (CHART.bottom - CHART.top)
  const visibleEvents = selectedEvents.filter((event) => event.historical_depth_m >= minDepth && event.historical_depth_m <= maxDepth).slice(0, 7)
  const positionedEvents = positionEventLabels(visibleEvents, yAt)
  const ticks: number[] = []
  const tickStep = maxDepth - minDepth > 190 ? 50 : 25
  for (let tick = Math.ceil(minDepth / tickStep) * tickStep; tick <= maxDepth; tick += tickStep) ticks.push(tick)

  const metrics = TRACKS.filter((track) => activeMeasurements.some((row) => row[track.key] != null)
    || offsetMeasurements.some((row) => row[track.key] != null))

  return <section className="panel offset-depth-panel" aria-labelledby="offset-depth-title">
    <div className="panel-heading offset-depth-heading">
      <div><div className="eyebrow">OFFSET DEPTH INTELLIGENCE</div><h2 id="offset-depth-title">Shared measured-depth view</h2></div>
      <span className="panel-meta"><Ruler size={15} />Depth in metres</span>
    </div>

    <div className="offset-depth-current">
      <div><span>CURRENT WELL</span><strong>{activeWell.well_name}</strong><small>{activeWell.current_formation?.name ?? 'Formation not recorded'}</small></div>
      <div className="current-depth-readout"><span>CURRENT DEPTH</span><strong>{formatDepth(currentDepth)}</strong></div>
      <div className={`next-precedent-readout ${upcoming ? 'has-precedent' : ''}`}>
        <span>NEXT HISTORICAL PRECEDENT</span>
        {upcoming ? <><strong>{Math.round(upcoming.depth_difference_m)} m ahead</strong><small>{humanize(upcoming.event_type)} · {formatDepth(upcoming.historical_depth_m)}</small></> : <strong>No upcoming matched event</strong>}
      </div>
    </div>

    {metrics.length === 0 ? <div className="offset-depth-empty"><Activity size={17} />No stored ROP or torque samples are available for these wells.</div> : <>
      <div className="offset-depth-chart-scroll">
        <svg className="offset-depth-chart" viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="group" aria-label={`Offset measured depth chart for ${activeWell.well_name}${selected ? ` and ${selected.offset_well.well_name}` : ''}`}>
          {upcoming && upcoming.historical_depth_m <= maxDepth && <rect className="upcoming-depth-zone" x={CHART.axisX} y={yAt(currentDepth ?? 0)} width={CHART.torqueEnd - CHART.axisX} height={Math.max(0, yAt(upcoming.historical_depth_m) - yAt(currentDepth ?? 0))} />}
          {ticks.map((tick) => <g key={tick} className="depth-grid-tick"><line x1={CHART.axisX} x2={CHART.torqueEnd} y1={yAt(tick)} y2={yAt(tick)} /><text x={CHART.axisX - 9} y={yAt(tick) + 4} textAnchor="end">{tick.toLocaleString()}</text></g>)}
          <line className="shared-depth-axis" x1={CHART.axisX} x2={CHART.axisX} y1={CHART.top} y2={CHART.bottom} />
          <text className="depth-axis-title" x="16" y={(CHART.top + CHART.bottom) / 2} transform={`rotate(-90 16 ${(CHART.top + CHART.bottom) / 2})`}>MEASURED DEPTH · m</text>
          {metrics.map((track) => {
            const start = track.key === 'rop_m_per_hr' ? CHART.ropStart : CHART.torqueStart
            const end = track.key === 'rop_m_per_hr' ? CHART.ropEnd : CHART.torqueEnd
            const activePoints = activeMeasurements.filter((row) => row[track.key] != null && row.measured_depth_m >= minDepth && row.measured_depth_m <= maxDepth)
            const offsetPoints = offsetMeasurements.filter((row) => row[track.key] != null && row.measured_depth_m >= minDepth && row.measured_depth_m <= maxDepth)
            const maximum = Math.max(1, ...[...activePoints, ...offsetPoints].map((row) => row[track.key] ?? 0))
            const xAt = (value: number) => start + (value / maximum) * (end - start)
            return <g key={track.key} className="parameter-track">
              <text className="parameter-track-title" x={start} y="23">{track.label}<tspan>{` · ${track.unit}`}</tspan></text>
              <line className="parameter-track-axis" x1={start} x2={end} y1={CHART.bottom + 1} y2={CHART.bottom + 1} />
              {[0, 0.5, 1].map((ratio) => <g key={ratio}><line className="parameter-track-guide" x1={start + (end - start) * ratio} x2={start + (end - start) * ratio} y1={CHART.top} y2={CHART.bottom} /><text className="parameter-track-tick" x={start + (end - start) * ratio} y={CHART.bottom + 18} textAnchor={ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle'}>{(maximum * ratio).toFixed(track.key === 'torque_knm' ? 1 : 0)}</text></g>)}
              <path className="measurement-line active" d={linePath(activePoints, track.key, xAt, yAt)} />
              <path className="measurement-line offset" d={linePath(offsetPoints, track.key, xAt, yAt)} />
              {activePoints.map((row) => <circle key={`active-${row.id}`} className="measurement-point active" cx={xAt(row[track.key] ?? 0)} cy={yAt(row.measured_depth_m)} r="3.5"><title>{`${activeWell.well_name} · ${track.label} ${row[track.key]} ${track.unit} · ${formatDepth(row.measured_depth_m)}`}</title></circle>)}
              {offsetPoints.map((row) => <circle key={`offset-${row.id}`} className="measurement-point offset" cx={xAt(row[track.key] ?? 0)} cy={yAt(row.measured_depth_m)} r="3.5"><title>{`${selected?.offset_well.well_name ?? 'Offset'} · ${track.label} ${row[track.key]} ${track.unit} · ${formatDepth(row.measured_depth_m)}`}</title></circle>)}
            </g>
          })}
          <text className="event-rail-title" x={CHART.eventDotX} y="23">HISTORICAL EVENTS</text>
          {positionedEvents.map(({ event, labelY }) => {
            const eventY = yAt(event.historical_depth_m)
            const name = `${humanize(event.event_type)} · ${formatDepth(event.historical_depth_m)}`
            return <g className="depth-event-marker" key={event.event_id} role="button" tabIndex={0} aria-label={`${name}, ${event.offset_well.well_name}, open evidence`} onClick={() => onSelectEvent(event)} onKeyDown={(key) => { if (key.key === 'Enter' || key.key === ' ') { key.preventDefault(); onSelectEvent(event) } }}>
              <line x1={CHART.torqueEnd} x2={CHART.eventDotX} y1={eventY} y2={eventY} />
              <line className="event-label-leader" x1={CHART.eventDotX} x2={CHART.eventDotX + 7} y1={eventY} y2={labelY} />
              <circle cx={CHART.eventDotX} cy={eventY} r="5"><title>{name} · {event.offset_well.well_name}</title></circle>
              <text className="depth-event-name" x={CHART.eventTextX} y={labelY - 2}>{name}</text>
              <text className="depth-event-well" x={CHART.eventTextX} y={labelY + 12}>{event.offset_well.well_name} · {Math.round(event.relevance_score)} relevance</text>
            </g>
          })}
          {currentDepth != null && <g className="current-depth-line"><line x1={CHART.axisX} x2={CHART.torqueEnd} y1={yAt(currentDepth)} y2={yAt(currentDepth)} /><rect x={CHART.axisX + 7} y={yAt(currentDepth) - 18} width="134" height="18" rx="3" /><text x={CHART.axisX + 13} y={yAt(currentDepth) - 5}>CURRENT · {formatDepth(currentDepth)}</text></g>}
          {selectedEvents.length === 0 && selected && <text className="no-event-note" x={CHART.eventDotX} y={CHART.top + 20}>No matched events to plot</text>}
        </svg>
      </div>
      <div className="offset-depth-legend"><span><i className="legend-active" />{activeWell.well_name}</span>{selected && <span><i className="legend-offset" />{selected.offset_well.well_name}</span>}<span><i className="legend-historical" />Historical event</span><small>{offsetLoading ? 'Loading offset samples…' : offsetError ? 'Offset measurement sequence unavailable.' : 'Stored sample values · null measurements are omitted.'}</small></div>
    </>}

    <div className="offset-well-selector" aria-label="Select an offset well for comparison">
      <span className="eyebrow">COMPARE WITH</span>
      {comparables.map((row) => <button
        type="button"
        className={`offset-select-chip ${row.offset_well.id === selectedWellId ? 'selected' : ''}`}
        key={row.offset_well.id}
        aria-pressed={row.offset_well.id === selectedWellId}
        onClick={() => onSelectOffset(row.offset_well.id)}
      ><strong>{row.offset_well.well_name}</strong><span>{formatDistance(row.distance_km)}</span><small>{row.historical_events.length} {row.historical_events.length === 1 ? 'event' : 'events'}</small></button>)}
      {comparables.length === 0 && <span className="offset-selector-empty">No comparable offset wells are available in this radius.</span>}
    </div>

    {selected && <div className="offset-why-card">
      <div className="offset-why-heading"><div><span className="eyebrow">OFFSET COMPARISON</span><strong>{activeWell.well_name} <i>vs</i> {selected.offset_well.well_name}</strong></div><span className={`offset-score ${selectedScore == null ? 'none' : scoreBand(selectedScore)}`}>{selectedScore == null ? '—' : Math.round(selectedScore)}<small>{selectedScore == null ? ' no score' : ' relevance'}</small></span></div>
      <div className="offset-why-facts">
        <span><small>FORMATION</small><strong>{formationLabel}</strong></span>
        <span><small>DEPTH</small><strong>{upcoming ? `${Math.round(upcoming.depth_difference_m)} m ahead` : 'No upcoming event'}</strong></span>
        <span><small>DISTANCE</small><strong>{formatDistance(selected.distance_km)}</strong></span>
        <span><small>EVENTS</small><strong>{selected.historical_events.length} relevant</strong></span>
      </div>
      <details className="offset-why-details"><summary>Why relevant</summary>
        {strongestSelectedEvent ? <div className="relevance-factor-list">{Object.entries(strongestSelectedEvent.components).map(([key, factor]) => <div key={key}><span>{factorLabel(key)}</span><i><b style={{ width: `${Math.max(0, Math.min(100, factor.score * 100))}%` }} /></i><strong>{Math.round(factor.score * 100)}%</strong></div>)}</div> : <p>No event relevance components are available for this offset.</p>}
        <small>Factors mirror the existing correlation response; no new score is calculated here.</small>
      </details>
    </div>}

    {selected && <div className="offset-depth-footer"><span>{selected.offset_formation_interval?.formation.name ?? selected.offset_well.current_formation?.name ?? 'Offset formation unavailable'} · {selectedEvents.length} correlated event{selectedEvents.length === 1 ? '' : 's'}</span><button type="button" onClick={() => { if (selectedEvents[0]) onSelectEvent(selectedEvents[0]) }} disabled={selectedEvents.length === 0}>View offset events <ChevronRight size={14} /></button></div>}
  </section>
}

function linePath(rows: DrillingMeasurement[], key: Track['key'], xAt: (value: number) => number, yAt: (depth: number) => number) {
  const sorted = [...rows].sort((left, right) => left.measured_depth_m - right.measured_depth_m)
  const points = sorted.map((row) => ({ x: xAt(row[key] ?? 0), y: yAt(row.measured_depth_m) }))
  if (points.length <= 2) return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]
    const next = points[index + 1]
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
  }
  const last = points[points.length - 1]
  return `${path} L ${last.x} ${last.y}`
}

function positionEventLabels(events: OffsetMatch[], yAt: (depth: number) => number) {
  const labels = events.map((event) => ({ event, labelY: yAt(event.historical_depth_m) }))
  for (let index = 1; index < labels.length; index += 1) {
    if (labels[index].labelY - labels[index - 1].labelY < 34) labels[index].labelY = labels[index - 1].labelY + 34
  }
  const overflow = (labels[labels.length - 1]?.labelY ?? CHART.bottom) - (CHART.bottom - 16)
  if (overflow > 0) for (const label of labels) label.labelY -= overflow
  if (labels[0] && labels[0].labelY < CHART.top + 15) {
    const shift = CHART.top + 15 - labels[0].labelY
    for (const label of labels) label.labelY += shift
  }
  return labels
}

function factorLabel(key: string) {
  return ({ formation: 'Formation', depth_proximity: 'Depth', spatial_proximity: 'Distance', event_similarity: 'Event similarity', source_confidence: 'Source confidence' } as Record<string, string>)[key] ?? humanize(key)
}

function scoreBand(score: number) {
  return score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low'
}
