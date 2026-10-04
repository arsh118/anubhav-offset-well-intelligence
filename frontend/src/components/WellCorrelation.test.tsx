import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Correlation } from '../lib/api'
import { WellCorrelation } from './WellCorrelation'

const interval = {
  id: 'interval-x',
  formation_id: 'formation-x',
  formation: { id: 'formation-x', name: 'X Formation', normalized_name: 'x formation', aliases: ['x-fm'] },
  top_depth: 2490,
  base_depth: 3200,
  depth_unit: 'm',
  lithology: 'interbedded sandstone and shale',
  geological_zone: 'X Formation interval',
  reservoir_zone: 'X sandstone unit',
  pressure_indicator: 'review_indicator',
  porosity_percent: 16,
  permeability_md: 60,
}

const activeParameters = {
  id: 'sample-active', well_id: 'well-active', sampled_at: '2026-10-03T10:00:00Z',
  measured_depth_m: 2842, true_vertical_depth_m: 2602, mud_weight_sg: 1.16, ecd_sg: 1.19,
  rop_m_per_hr: 12, wob_kn: 65, rpm: 100, torque_knm: 8.5, standpipe_pressure_mpa: 14.5,
  inclination_deg: 18, azimuth_deg: 45, casing_depth_m: 2490, cementing_metadata: null,
  source: 'Representative Synthetic Demo Data', created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z',
}

const comparison = {
  active_value: 2842,
  offset_value: 2865,
  difference: 23,
  unit: 'm',
}

const correlation = {
  active_well: {
    id: 'well-active', well_name: 'ANB-01', field: 'Upper-Assam-Demo', latitude: 27.45, longitude: 95.2,
    active_depth_m: 2842, active_formation: 'X Formation',
  },
  radius_km: 10,
  depth_window_m: 100,
  heuristic_weights: {},
  matched_wells: [],
  historical_events: [],
  total_matching_events: 0,
  active_formation_interval: interval,
  active_drilling_parameters: activeParameters,
  comparable_wells: [{
    offset_well: {
      id: 'well-offset', well_name: 'ANB-02', field: 'Upper-Assam-Demo', latitude: 27.48, longitude: 95.21,
      spud_date: '2024-06-12', completion_date: '2024-11-20', total_depth: 3420, current_depth: 3420,
      current_formation: null, formations: [interval], role: 'offset', status: 'completed',
      source: 'Representative Synthetic Demo Data', created_at: '2024-06-12T00:00:00Z', updated_at: '2024-11-20T00:00:00Z',
    },
    distance_km: 4.2,
    depth_alignment_m: 23,
    formation_match: 'exact',
    active_formation_interval: interval,
    offset_formation_interval: interval,
    geological_similarity: 1,
    reservoir_similarity: 1,
    active_drilling_parameters: activeParameters,
    offset_drilling_parameters: { ...activeParameters, id: 'sample-offset', well_id: 'well-offset', measured_depth_m: 2865 },
    drilling_parameter_comparison: { measured_depth_m: comparison, true_vertical_depth_m: comparison },
    historical_events: [],
    comparison_reasons: [
      '4.2 km from active well',
      'Same formation: X Formation',
      'Historical event 23 m ahead of active depth: Partial lost circulation in X Formation',
      'Drilling samples at 2842 m MD and 2865 m MD; 10 shared parameter values are compared below',
    ],
    source_label: 'Representative Synthetic Demo Data',
  }],
  data_notice: 'Representative Synthetic Demo Data',
  message: null,
} as unknown as Correlation

describe('well correlation comparison', () => {
  it('shows active versus offset evidence and representative geological and drilling descriptors', () => {
    render(<WellCorrelation correlation={correlation} />)

    expect(screen.getByText('ACTIVE WELL')).toBeTruthy()
    expect(screen.getByText('OFFSET WELL')).toBeTruthy()
    expect(screen.getAllByText('Same formation: X Formation').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Historical event 23 m ahead of active depth: Partial lost circulation in X Formation').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Normalized: x formation · Aliases: x-fm')).toHaveLength(2)
    expect(screen.getByText('Reservoir / zone')).toBeTruthy()
    expect(screen.getByText('Porosity')).toBeTruthy()
    expect(screen.getByText('Permeability')).toBeTruthy()
    expect(screen.getByText('True vertical depth')).toBeTruthy()
    expect(screen.getByText('Mud weight')).toBeTruthy()
    expect(screen.getByText('ECD')).toBeTruthy()
    expect(screen.getByText('ROP')).toBeTruthy()
    expect(screen.getByText('WOB')).toBeTruthy()
    expect(screen.getByText('Torque')).toBeTruthy()
    expect(screen.getByText('Historical events')).toBeTruthy()
    expect(screen.getAllByText(/Representative Synthetic Demo Data/).length).toBeGreaterThan(0)
    expect(screen.getByText(/not expert validated or OIL-approved limits/)).toBeTruthy()
  })
})
