import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Correlation, DrillingMeasurement, LiveFeed, OffsetMatch, Well } from '../lib/api'
import { OffsetDepthIntelligence } from './OffsetDepthIntelligence'

const formation = { id: 'formation-x', name: 'X Formation', normalized_name: 'x formation', aliases: ['x-fm'] }
const document = { id: 'doc-02', well_id: 'well-02', filename: 'DDR-ANB-02.pdf', document_type: 'daily_drilling_report', source: 'Synthetic', origin: 'seeded_demo' as const, source_label: 'Seeded Demo Evidence', uploaded_at: '2024-07-14T08:15:00Z', processing_status: 'processed' as const, page_count: 12 }

const activeWell: Well = {
  id: 'well-01', well_name: 'ANB-01', field: 'Demo Field', latitude: 27.45, longitude: 95.2, spud_date: null, completion_date: null,
  total_depth: 3400, current_depth: 2842, current_formation: formation, formations: [], role: 'active', status: 'drilling', source: 'Synthetic',
}

const activeMeasurements: DrillingMeasurement[] = [2842, 2850, 2858].map((depth, index) => ({
  id: `active-${index}`, well_id: activeWell.id, sampled_at: `2026-10-03T10:${index * 5}:00Z`, measured_depth_m: depth,
  true_vertical_depth_m: depth - 240, mud_weight_sg: 1.16, ecd_sg: 1.19, rop_m_per_hr: 12 - index, wob_kn: 65,
  rpm: 100, torque_knm: 8.5 + index * .2, standpipe_pressure_mpa: 14.5, inclination_deg: 18, azimuth_deg: 45,
  casing_depth_m: 2490, cementing_metadata: null, source: 'Representative Synthetic Demo Data', created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z',
}))

const event = {
  event_id: 'event-02', offset_well: { id: 'well-02', well_name: 'ANB-02', field: 'Demo Field', latitude: 27.48, longitude: 95.21 },
  distance_km: 4.2, historical_depth_m: 2865, active_depth_m: 2842, depth_difference_m: 23, absolute_depth_difference_m: 23,
  depth_band: 'near', formation, formation_match: 'exact', event_type: 'lost_circulation', event_title: 'Lost circulation', description: 'Recorded losses',
  consequence: null, mitigation: 'Loss-control treatment recorded.', relevance_score: 91, relevance_score_normalized: .91, relevance_band: 'high',
  components: { formation: { score: 1, weight: .25 }, depth_proximity: { score: .91, weight: .3 }, spatial_proximity: { score: .58, weight: .2 }, event_similarity: { score: 1, weight: .15 }, source_confidence: { score: .96, weight: .1 } },
  source_document: document, source_page: 3, evidence_excerpt: 'Source excerpt', source_confidence: .96, existing_alert: null, explanation: 'Same formation near current depth.',
} as unknown as OffsetMatch

const offsetWell: Well = {
  id: 'well-02', well_name: 'ANB-02', field: 'Demo Field', latitude: 27.48, longitude: 95.21, spud_date: null, completion_date: null,
  total_depth: 3420, current_depth: 3420, current_formation: formation, formations: [], role: 'offset', status: 'completed', source: 'Synthetic',
}

const correlation = {
  active_well: { id: activeWell.id, well_name: activeWell.well_name, field: activeWell.field, latitude: activeWell.latitude, longitude: activeWell.longitude, active_depth_m: 2842, active_formation: 'X Formation' },
  radius_km: 20, depth_window_m: 100, heuristic_weights: {}, matched_wells: [], historical_events: [event], total_matching_events: 1,
  active_formation_interval: null, active_drilling_parameters: activeMeasurements[0], comparable_wells: [{
    offset_well: offsetWell, distance_km: 4.2, depth_alignment_m: 23, formation_match: 'exact', active_formation_interval: null,
    offset_formation_interval: null, geological_similarity: 1, reservoir_similarity: null, active_drilling_parameters: activeMeasurements[0],
    offset_drilling_parameters: null, drilling_parameter_comparison: {}, historical_events: [event], comparison_reasons: [], source_label: 'Representative Synthetic Demo Data',
  }], data_notice: 'Representative Synthetic Demo Data', message: null,
} as unknown as Correlation

const offsetMeasurement = { ...activeMeasurements[0], id: 'offset-1', well_id: offsetWell.id, measured_depth_m: 2865, rop_m_per_hr: 10, torque_knm: 8.8 }
const offsetFeed: LiveFeed = { well_id: offsetWell.id, well_name: offsetWell.well_name, feed_type: 'deterministic_simulated_replay', status: 'Representative Synthetic Demo Data', states: [{ measurement: offsetMeasurement, formation: 'X Formation', pressure_indicator: null }], message: null, data_notice: 'Representative Synthetic Demo Data' }

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('offset depth intelligence', () => {
  it('synchronizes stored parameter tracks and opens evidence from a depth-aligned event marker', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => offsetFeed })
    vi.stubGlobal('fetch', fetchMock)
    const onSelectEvent = vi.fn()
    const onSelectOffset = vi.fn()

    render(<OffsetDepthIntelligence activeWell={activeWell} activeMeasurements={activeMeasurements} correlation={correlation} depthWindowM={100} selectedOffsetId={offsetWell.id} onSelectOffset={onSelectOffset} onSelectEvent={onSelectEvent} />)

    expect(await screen.findByRole('button', { name: /Lost Circulation · 2,865 m, ANB-02, open evidence/ })).toBeTruthy()
    expect(screen.getAllByText('23 m ahead').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('91')).toBeTruthy()
    expect(screen.getAllByText('ROP').length).toBeGreaterThan(0)
    expect(screen.getByText('TORQUE')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /4.2 km/ }))
    expect(onSelectOffset).toHaveBeenCalledWith(offsetWell.id)
    fireEvent.click(screen.getByRole('button', { name: /Lost Circulation · 2,865 m, ANB-02, open evidence/ }))
    expect(onSelectEvent).toHaveBeenCalledWith(event)
  })
})
