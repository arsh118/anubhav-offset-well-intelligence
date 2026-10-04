import { useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, GitCompareArrows } from 'lucide-react'
import type { Correlation, OffsetMatch, ParameterComparison, WellCorrelationComparison } from '../lib/api'
import { humanize } from '../lib/format'
import { EvidenceDrawer } from './EvidenceDrawer'

type Metric = { key: string; label: string }
const DEPTH_METRICS: Metric[] = [
  { key: 'measured_depth_m', label: 'Measured depth' },
  { key: 'true_vertical_depth_m', label: 'True vertical depth' },
]
const DRILLING_METRICS: Metric[] = [
  { key: 'mud_weight_sg', label: 'Mud weight' },
  { key: 'ecd_sg', label: 'ECD' },
  { key: 'rop_m_per_hr', label: 'ROP' },
  { key: 'wob_kn', label: 'WOB' },
  { key: 'rpm', label: 'RPM' },
  { key: 'torque_knm', label: 'Torque' },
  { key: 'standpipe_pressure_mpa', label: 'Standpipe pressure' },
  { key: 'inclination_deg', label: 'Inclination' },
  { key: 'azimuth_deg', label: 'Azimuth' },
  { key: 'casing_depth_m', label: 'Casing depth' },
]

function format(value: number | null | undefined, unit: string, key: string) {
  if (value == null) return '—'
  const decimals = key.endsWith('_sg') ? 2 : key === 'rpm' ? 0 : 1
  return `${value.toFixed(decimals)} ${unit}`
}

function MetricCell({ value, keyName, unit, comparison }: {
  value: number | null
  keyName: string
  unit: string
  comparison?: ParameterComparison
}) {
  const active = comparison?.active_value ?? value
  const offset = comparison?.offset_value
  const maximum = Math.max(Math.abs(active ?? 0), Math.abs(offset ?? 0), 0.01)
  return <div className="well-correlation-metric">
    <span>{format(value, unit, keyName)}</span>
    {comparison?.difference != null && <small className={comparison.difference === 0 ? 'delta-neutral' : 'delta-value'}>
      {comparison.difference > 0 ? <ArrowUpRight size={11} /> : comparison.difference < 0 ? <ArrowDownRight size={11} /> : null}
      Δ {comparison.difference > 0 ? '+' : ''}{comparison.difference.toFixed(keyName.endsWith('_sg') ? 2 : 1)} {unit}
    </small>}
    {offset != null && <span className="comparison-bars" aria-hidden="true">
      <i className="comparison-bar-active" style={{ width: `${Math.max(4, ((active ?? 0) / maximum) * 100)}%` }} />
      <i className="comparison-bar-offset" style={{ width: `${Math.max(4, (offset / maximum) * 100)}%` }} />
    </span>}
  </div>
}

function DescriptorCell({ value, unit }: { value: string | number | null | undefined; unit?: string }) {
  if (value == null || value === '') return <>—</>
  return <>{typeof value === 'number' ? `${value.toLocaleString()}${unit ?? ''}` : value}</>
}

function offsetInterval(row: WellCorrelationComparison) {
  return row.offset_formation_interval
}

export function WellCorrelation({ correlation }: { correlation: Correlation }) {
  const [selectedMatch, setSelectedMatch] = useState<OffsetMatch | null>(null)
  const active = correlation.active_well
  const activeInterval = correlation.active_formation_interval
  const activeParameters = correlation.active_drilling_parameters
  const comparable = correlation.comparable_wells
  const closest = comparable[0]
  const activeDepth = active.active_depth_m
  const offsetSampleDepth = closest?.offset_drilling_parameters?.measured_depth_m
  const offsetEventDepth = closest?.historical_events[0]?.historical_depth_m
  const offsetDepth = offsetSampleDepth ?? offsetEventDepth ?? closest?.offset_well.current_depth ?? null
  const depthLabel = offsetSampleDepth != null ? 'Offset sample depth' : offsetEventDepth != null ? 'Offset event depth' : 'Offset measured depth'
  const depthDifference = closest?.depth_alignment_m ?? (activeDepth != null && offsetDepth != null ? Math.abs(activeDepth - offsetDepth) : null)
  const offsetFormation = closest?.offset_formation_interval?.formation.name ?? closest?.offset_well.current_formation?.name ?? 'Not recorded'
  const activeFormation = activeInterval?.formation.name ?? active.active_formation ?? 'Not recorded'
  const renderMetrics = (metrics: Metric[]) => metrics.map((metric) => {
    const activeValue = activeParameters ? (activeParameters as unknown as Record<string, number | null>)[metric.key] : null
    return <tr key={metric.key}><th scope="row">{metric.label}</th>
      <td><MetricCell value={activeValue ?? null} keyName={metric.key} unit={unitFor(metric.key)} /></td>
      {comparable.map((row) => {
        const comparison = row.drilling_parameter_comparison[metric.key]
        return <td key={row.offset_well.id}>
          <MetricCell value={comparison?.offset_value ?? null} keyName={metric.key} unit={unitFor(metric.key)} comparison={comparison} />
        </td>
      })}
    </tr>
  })
  const renderTableHead = () => <thead><tr><th scope="col">Parameter</th><th scope="col"><span className="correlation-well-label">ACTIVE WELL</span><strong>{active.well_name}</strong><small>{activeDepth?.toLocaleString() ?? '—'} m MD · {activeFormation}</small></th>{comparable.map((row) => <th scope="col" key={row.offset_well.id}><span className="correlation-well-label">OFFSET WELL</span><strong>{row.offset_well.well_name}</strong><small>{row.distance_km.toFixed(1)} km · {row.formation_match} match</small><small>Geology {row.geological_similarity == null ? '—' : `${Math.round(row.geological_similarity * 100)}%`} · Reservoir {row.reservoir_similarity == null ? '—' : `${Math.round(row.reservoir_similarity * 100)}%`}</small><ul className="well-correlation-reasons">{row.comparison_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><small className="correlation-source">{row.source_label}</small></th>)}</tr></thead>
  const renderTable = (rows: ReactNode) => <div className="well-correlation-scroll"><table className="well-correlation-table">{renderTableHead()}<tbody>{rows}</tbody></table></div>
  const formationRows = <>
    <tr><th scope="row">Formation</th><td>{activeInterval?.formation.name ?? active.active_formation ?? '—'}{activeInterval && <small className="table-secondary">Normalized: {activeInterval.formation.normalized_name} · Aliases: {activeInterval.formation.aliases.join(', ') || '—'}</small>}</td>{comparable.map((row) => { const interval = offsetInterval(row); return <td key={row.offset_well.id}>{interval?.formation.name ?? '—'}{interval && <small className="table-secondary">Normalized: {interval.formation.normalized_name} · Aliases: {interval.formation.aliases.join(', ') || '—'}</small>}</td> })}</tr>
    <tr><th scope="row">Lithology</th><td><DescriptorCell value={activeInterval?.lithology} /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.lithology} /></td>)}</tr>
    <tr><th scope="row">Geological zone</th><td><DescriptorCell value={activeInterval?.geological_zone} /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.geological_zone} /></td>)}</tr>
  </>
  const reservoirRows = <>
    <tr><th scope="row">Reservoir / zone</th><td><DescriptorCell value={activeInterval?.reservoir_zone} /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.reservoir_zone} /></td>)}</tr>
    <tr><th scope="row">Pressure indicator</th><td><DescriptorCell value={activeInterval?.pressure_indicator} /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.pressure_indicator} /></td>)}</tr>
    <tr><th scope="row">Porosity</th><td><DescriptorCell value={activeInterval?.porosity_percent} unit="%" /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.porosity_percent} unit="%" /></td>)}</tr>
    <tr><th scope="row">Permeability</th><td><DescriptorCell value={activeInterval?.permeability_md} unit=" mD" /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.permeability_md} unit=" mD" /></td>)}</tr>
  </>
  const drillingRows = <>
    {renderMetrics(DRILLING_METRICS)}
    <tr><th scope="row">Historical events</th><td>Current depth {active.active_depth_m?.toLocaleString() ?? '—'} m MD</td>{comparable.map((row) => <td key={row.offset_well.id}>{row.historical_events.length === 0 ? <small className="table-secondary">No matched event in depth window</small> : <div className="well-correlation-events">{row.historical_events.map((event) => <button type="button" key={event.event_id} onClick={() => setSelectedMatch(event)}><strong>{event.event_title}</strong><small>{event.historical_depth_m.toLocaleString()} m MD · {signedDepth(event.depth_difference_m)} · {event.source_document.filename} · p.{event.source_page ?? '—'}</small><span>View evidence</span></button>)}</div>}</td>)}</tr>
    <tr><th scope="row">Cementing metadata</th><td>{activeParameters?.cementing_metadata ?? '—'}</td>{comparable.map((row) => <td key={row.offset_well.id}>{row.offset_drilling_parameters?.cementing_metadata ?? '—'}</td>)}</tr>
  </>

  return <section className="panel well-correlation-panel" aria-label="Well correlation">
    <div className="panel-heading"><div><div className="eyebrow">OFFSET COMPARISON</div><h2>Well correlation</h2></div><span className="panel-meta"><GitCompareArrows size={14} /> {comparable.length} offsets</span></div>
    {comparable.length === 0 ? <div className="empty-state"><strong>No offset wells are available for parameter comparison.</strong><p>Increase the configured radius or check the active well coordinates.</p></div> : <>
      <div className="correlation-comparison-heading"><span className="eyebrow">CLOSEST OFFSET</span><strong>{active.well_name} <span>vs</span> {closest.offset_well.well_name}</strong></div>
      <div className="correlation-comparison-grid">
        <article className="correlation-comparison-card formation"><span>FORMATION</span><strong>{closest.formation_match === 'exact' ? 'MATCH' : humanize(closest.formation_match).toUpperCase()}</strong><small>{activeFormation} · {offsetFormation}</small></article>
        <article className="correlation-comparison-card depth"><span>DEPTH ALIGNMENT</span><strong>{depthDifference == null ? '—' : `${Math.round(depthDifference)} m`}</strong><small>{depthLabel}</small></article>
        <article className="correlation-comparison-card distance"><span>DISTANCE</span><strong>{closest.distance_km.toFixed(1)} <small>km</small></strong><small>Offset well</small></article>
        <article className="correlation-comparison-card events"><span>EVENTS</span><strong>{closest.historical_events.length}</strong><small>Historical records</small></article>
      </div>
      <details className="well-correlation-details"><summary>Geology, reservoir and drilling details <span>{comparable.length} wells</span></summary>
        <details className="well-correlation-group"><summary>Depth and trajectory</summary>{renderTable(renderMetrics(DEPTH_METRICS))}</details>
        <details className="well-correlation-group"><summary>Geology and lithology</summary>{renderTable(formationRows)}</details>
        <details className="well-correlation-group"><summary>Reservoir</summary>{renderTable(reservoirRows)}</details>
        <details className="well-correlation-group"><summary>Drilling parameters and historical events</summary>{renderTable(drillingRows)}</details>
        <details className="well-correlation-group"><summary>Why these wells</summary><div className="well-correlation-reason-list">{comparable.map((row) => <div key={row.offset_well.id}><strong>{row.offset_well.well_name}</strong><span>{row.comparison_reasons.join(' · ')}</span></div>)}</div></details>
        <details className="well-correlation-group"><summary>Comparison notes</summary><p className="well-correlation-footer">{correlation.data_notice} Similarity heuristics are for comparison and are not expert-validated limits. Bars scale to each pair for display only.</p></details>
      </details>
    </>}
    {selectedMatch && <EvidenceDrawer match={selectedMatch} relatedMatches={correlation.historical_events} onClose={() => setSelectedMatch(null)} />}
  </section>
}

function signedDepth(depth: number) {
  if (depth > 0) return `${depth.toLocaleString()} m ahead of active depth`
  if (depth < 0) return `${Math.abs(depth).toLocaleString()} m behind active depth`
  return 'at active depth'
}

function unitFor(key: string) {
  if (key === 'mud_weight_sg' || key === 'ecd_sg') return 'SG'
  if (key === 'rop_m_per_hr') return 'm/hr'
  if (key === 'wob_kn') return 'kN'
  if (key === 'rpm') return 'rpm'
  if (key === 'torque_knm') return 'kN·m'
  if (key === 'standpipe_pressure_mpa') return 'MPa'
  if (key === 'inclination_deg' || key === 'azimuth_deg') return '°'
  return 'm'
}
