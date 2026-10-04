import type { WellEvent } from '../lib/api'
import { humanize } from '../lib/format'

export function EventDistribution({ events }: { events: WellEvent[] }) {
  const depths = events.map((event) => event.measured_depth).filter((depth): depth is number => depth != null)
  const typeCounts = countBy(events, (event) => event.event_type)
  const formationCounts = countBy(events.filter((event) => event.formation), (event) => event.formation?.name ?? '')
  const matrixReady = events.length >= 8 && formationCounts.length >= 2 && formationCounts.length <= 6 && typeCounts.length >= 2 && typeCounts.length <= 6
  const bins = makeDepthBins(depths)
  const maximumBin = Math.max(1, ...bins.map((bin) => bin.count))
  const maximumType = Math.max(1, ...typeCounts.map((row) => row.count))
  const maximumCell = Math.max(1, ...formationCounts.flatMap((formation) => typeCounts.map((type) => countPair(events, formation.label, type.label))))

  if (events.length < 4) return null

  return <section className="event-distribution" aria-label="Historical event distribution">
    {bins.length > 0 && <article className="event-distribution-card depth-distribution-card">
      <div className="distribution-heading"><div><span className="eyebrow">DEPTH DISTRIBUTION</span><h2>Where events cluster</h2></div><span>{depths.length} depth records</span></div>
      <div className="depth-distribution" role="list" aria-label={`Event counts by measured depth from ${Math.round(Math.min(...depths))} to ${Math.round(Math.max(...depths))} metres`}>
        {bins.map((bin) => <div className="depth-distribution-bin" key={bin.label} role="listitem" aria-label={`${bin.label}: ${bin.count} events`} title={`${bin.label}: ${bin.count} historical events`}>
          <span className="depth-bin-count">{bin.count || ''}</span><i className={bin.count ? '' : 'empty-bin'} style={{ height: `${bin.count ? (bin.count / maximumBin) * 66 : 0}%` }} /><small>{bin.shortLabel}</small>
        </div>)}
      </div>
      <p>Counts use recorded event depths from the current result set.</p>
    </article>}

    {events.length >= 4 && typeCounts.length >= 2 && <article className="event-distribution-card type-distribution-card">
      <div className="distribution-heading"><div><span className="eyebrow">EVENT TYPE</span><h2>Most recorded problems</h2></div><span>{events.length} records</span></div>
      <div className="type-distribution" role="list" aria-label="Historical event counts by event type">
        {typeCounts.slice(0, 6).map((item) => <div className="type-distribution-row" key={item.label} role="listitem"><span>{humanize(item.label)}</span><i aria-hidden="true"><b style={{ width: `${(item.count / maximumType) * 100}%` }} /></i><strong>{item.count}</strong></div>)}
      </div>
    </article>}

    {matrixReady && <details className="event-distribution-card formation-event-matrix">
      <summary><span><span className="eyebrow">FORMATION × EVENT</span><strong>Recorded event pattern</strong></span><small>Open matrix</small></summary>
      <div className="matrix-scroll"><table><thead><tr><th scope="col">Formation</th>{typeCounts.map((type) => <th scope="col" key={type.label}>{humanize(type.label)}</th>)}</tr></thead><tbody>
        {formationCounts.map((formation) => <tr key={formation.label}><th scope="row">{formation.label}</th>{typeCounts.map((type) => { const count = countPair(events, formation.label, type.label); return <td key={type.label} aria-label={`${formation.label}, ${humanize(type.label)}: ${count} events`}><span style={{ opacity: count ? 0.18 + (count / maximumCell) * 0.72 : 0.08 }}>{count || '·'}</span></td> })}</tr>)}
      </tbody></table></div>
      <p>Counts reflect only events with a recorded formation.</p>
    </details>}
  </section>
}

function countBy(events: WellEvent[], key: (event: WellEvent) => string) {
  const counts = new Map<string, number>()
  events.forEach((event) => { const label = key(event); if (label) counts.set(label, (counts.get(label) ?? 0) + 1) })
  return [...counts].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

function countPair(events: WellEvent[], formation: string, eventType: string) {
  return events.filter((event) => event.formation?.name === formation && event.event_type === eventType).length
}

function makeDepthBins(depths: number[]) {
  if (depths.length === 0) return []
  const minimum = Math.min(...depths)
  const maximum = Math.max(...depths)
  const width = Math.max(25, Math.ceil((maximum - minimum || 25) / 8 / 25) * 25)
  const start = Math.floor(minimum / width) * width
  const end = Math.ceil((maximum + 1) / width) * width
  const bins = Array.from({ length: Math.max(1, Math.ceil((end - start) / width)) }, (_, index) => {
    const from = start + index * width
    const to = from + width
    return { from, to, count: 0, label: `${from.toLocaleString()}–${to.toLocaleString()} m`, shortLabel: `${from.toLocaleString()}` }
  })
  depths.forEach((depth) => {
    const index = Math.min(bins.length - 1, Math.floor((depth - start) / width))
    bins[index].count += 1
  })
  return bins
}
