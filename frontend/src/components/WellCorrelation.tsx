import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, GitCompareArrows } from 'lucide-react'
import type { Correlation, OffsetMatch, ParameterComparison, WellCorrelationComparison } from '../lib/api'
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

  return <section className="panel well-correlation-panel" aria-label="Well correlation">
    <div className="panel-heading">
      <div><div className="eyebrow">GEOLOGY · RESERVOIR · DRILLING</div><h2>Well Correlation</h2></div>
      <span className="panel-meta"><GitCompareArrows size={14} /> {comparable.length} nearby comparisons</span>
    </div>
    <div className="well-correlation-context">
      <strong>{active.well_name}</strong><span>{active.active_depth_m?.toLocaleString() ?? '—'} m MD</span>
      <span>{activeInterval?.formation.name ?? active.active_formation ?? 'Formation unavailable'}</span>
      <span>{activeInterval?.lithology ?? 'Lithology unavailable'}</span>
      <small>{correlation.data_notice} · Similarity scores are heuristic comparisons.</small>
    </div>
    {comparable.length === 0 ? <div className="empty-state"><strong>No offset wells are available for parameter comparison.</strong><p>Increase the configured radius or check the active well coordinates.</p></div> : <div className="well-correlation-scroll">
      <table className="well-correlation-table">
        <thead><tr><th scope="col">Parameter</th><th scope="col">
          <span className="correlation-well-label">ACTIVE WELL</span><strong>{active.well_name}</strong>
          <small>{active.active_depth_m?.toLocaleString() ?? '—'} m MD · {active.active_formation ?? 'Formation unavailable'}</small>
        </th>{comparable.map((row) => <th scope="col" key={row.offset_well.id}>
          <span className="correlation-well-label">OFFSET WELL</span><strong>{row.offset_well.well_name}</strong>
          <small>{row.distance_km.toFixed(1)} km away · {row.formation_match} formation match</small>
          <small>Geology {row.geological_similarity == null ? '—' : `${Math.round(row.geological_similarity * 100)}%`} · Reservoir {row.reservoir_similarity == null ? '—' : `${Math.round(row.reservoir_similarity * 100)}%`}</small>
          <ul className="well-correlation-reasons" aria-label={`Why ${row.offset_well.well_name} is comparable`}>
            {row.comparison_reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <small className="correlation-source">{row.source_label}</small>
        </th>)}</tr></thead>
        <tbody>
          {renderMetrics(DEPTH_METRICS)}
          <tr><th scope="row">Formation</th>
            <td>{activeInterval?.formation.name ?? active.active_formation ?? '—'}
              {activeInterval && <small className="table-secondary">Normalized: {activeInterval.formation.normalized_name} · Aliases: {activeInterval.formation.aliases.join(', ') || '—'}</small>}
            </td>
            {comparable.map((row) => {
              const interval = offsetInterval(row)
              return <td key={row.offset_well.id}>{interval?.formation.name ?? '—'}
                {interval && <small className="table-secondary">Normalized: {interval.formation.normalized_name} · Aliases: {interval.formation.aliases.join(', ') || '—'}</small>}
              </td>
            })}
          </tr>
          <tr><th scope="row">Lithology</th><td><DescriptorCell value={activeInterval?.lithology} /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.lithology} /></td>)}</tr>
          <tr><th scope="row">Geological zone</th><td><DescriptorCell value={activeInterval?.geological_zone} /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.geological_zone} /></td>)}</tr>
          <tr><th scope="row">Reservoir / zone</th><td><DescriptorCell value={activeInterval?.reservoir_zone} /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.reservoir_zone} /></td>)}</tr>
          <tr><th scope="row">Pressure indicator</th><td><DescriptorCell value={activeInterval?.pressure_indicator} /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.pressure_indicator} /></td>)}</tr>
          <tr><th scope="row">Porosity</th><td><DescriptorCell value={activeInterval?.porosity_percent} unit="%" /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.porosity_percent} unit="%" /></td>)}</tr>
          <tr><th scope="row">Permeability</th><td><DescriptorCell value={activeInterval?.permeability_md} unit=" mD" /></td>{comparable.map((row) => <td key={row.offset_well.id}><DescriptorCell value={offsetInterval(row)?.permeability_md} unit=" mD" /></td>)}</tr>
          {renderMetrics(DRILLING_METRICS)}
          <tr><th scope="row">Historical events</th><td>Current depth {active.active_depth_m?.toLocaleString() ?? '—'} m MD</td>{comparable.map((row) => <td key={row.offset_well.id}>
            {row.historical_events.length === 0 ? <small className="table-secondary">No matched event in depth window</small> : <div className="well-correlation-events">
              {row.historical_events.map((event) => <button type="button" key={event.event_id} onClick={() => setSelectedMatch(event)}>
                <strong>{event.event_title}</strong><small>{event.historical_depth_m.toLocaleString()} m MD · {signedDepth(event.depth_difference_m)} · {event.source_document.filename} · p.{event.source_page ?? '—'}</small><span>View evidence</span>
              </button>)}
            </div>}
          </td>)}</tr>
          <tr><th scope="row">Cementing metadata</th><td>{activeParameters?.cementing_metadata ?? '—'}</td>{comparable.map((row) => <td key={row.offset_well.id}>{row.offset_drilling_parameters?.cementing_metadata ?? '—'}</td>)}</tr>
        </tbody>
      </table>
    </div>}
    <div className="well-correlation-footer">Prototype depths use meters and comparable measured-depth values. Similarity heuristics are not expert validated or OIL-approved limits. Bars scale to each pair for display only.</div>
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
