import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ActiveAlerts, Correlation, LiveFeed, OffsetMatch, PredictiveRisk } from '../lib/api'
import { LiveIntelligence } from './LiveIntelligence'

const measurement = {
  id: 'measurement-01', well_id: 'well-active', sampled_at: '2026-10-03T10:00:00Z',
  measured_depth_m: 2842, true_vertical_depth_m: 2602, mud_weight_sg: 1.16, ecd_sg: 1.19,
  rop_m_per_hr: 12, wob_kn: 65, rpm: 100, torque_knm: 8.5, standpipe_pressure_mpa: 14.5,
  inclination_deg: 18, azimuth_deg: 45, casing_depth_m: 2490, cementing_metadata: null,
  source: 'Representative Synthetic Demo Data', created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z',
}

const feed = {
  well_id: 'well-active', well_name: 'ANB-01', feed_type: 'deterministic_simulated_replay',
  status: 'Simulated eRTMAC / Representative Synthetic Data', states: [{ measurement, formation: 'X Formation', pressure_indicator: 'review_indicator' }],
  message: null, data_notice: "Simulated eRTMAC / Representative Synthetic Data. This deterministic replay is not connected to OIL's actual eRTMAC system.",
} as LiveFeed

const correlation = { historical_events: [] } as unknown as Correlation
const alerts = { title: 'No significant historical precedent', alerts: [], recommendation: null } as unknown as ActiveAlerts
const supportingEvent = {
  event_id: 'event-01',
  event_title: 'Partial lost circulation in X Formation',
  event_type: 'lost_circulation',
  distance_km: 4.2,
  offset_well: { well_name: 'ANB-02' },
  historical_depth_m: 2865,
  formation: { name: 'X Formation' },
  source_document: { filename: 'DDR-ANB-02-2024-07.pdf' },
  source_page: 3,
} as unknown as OffsetMatch
const secondUpcomingEvent = {
  ...supportingEvent,
  event_id: 'event-02',
  event_title: 'Mud weight adjustment in X Formation',
  event_type: 'mud_weight_adjustment',
  historical_depth_m: 2868,
} as unknown as OffsetMatch
const prediction = {
  active_well_id: 'well-active', active_well_name: 'ANB-01', status: 'available',
  model_name: 'ANUBHAV synthetic event-category logistic regression', model_version: '0.2.0-prototype',
  model_metadata: {}, training_sample_count: 21, message: null,
  notice: 'Prototype model — evaluation limited by representative synthetic data.',
  signals: [{
    risk_type: 'Mud Loss', probability: 0.78, risk_band: 'Historical Risk Signal',
    top_contributing_features: [{
      feature: 'formation_similarity', value: 1, contribution: 0.4,
      explanation: 'Same formation supports this category.',
    }],
    supporting_offset_wells: ['ANB-02'], supporting_historical_events: [supportingEvent],
  }],
} as PredictiveRisk

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('prototype predictive risk presentation', () => {
  it('keeps the estimate secondary and shows its limits, review requirement, contributors, and source evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: string) => {
      const response = input.includes('/live/') ? feed
        : input.includes('/predictive-risk/') ? prediction
          : input.includes('/alerts/') ? alerts
            : correlation
      return Promise.resolve({ ok: true, status: 200, json: async () => response })
    }))

    render(<LiveIntelligence activeWellId="well-active" radiusKm={10} depthWindowM={100} />)

    expect(await screen.findByText('Mud Loss')).toBeTruthy()
    expect(screen.getByText('Prototype probability: 0.78')).toBeTruthy()
    expect(screen.getByText('Historical Risk Signal')).toBeTruthy()
    expect(screen.getByText('Prototype model — evaluation limited by representative synthetic data.')).toBeTruthy()
    expect(screen.queryByText('Prototype ML estimate based on representative data.')).toBeNull()
    expect(screen.getByText('Engineer review required.')).toBeTruthy()
    expect(screen.getByText('Same formation supports this category.')).toBeTruthy()
    expect(screen.getByText('Partial lost circulation in X Formation')).toBeTruthy()
    expect(screen.getByText(/DDR-ANB-02-2024-07.pdf · p.3 · View evidence/)).toBeTruthy()
    expect(screen.getByText('SIMULATED eRTMAC')).toBeTruthy()
    expect(screen.getByText('Representative Synthetic Data')).toBeTruthy()
    expect(screen.getByText("No connection to OIL's actual eRTMAC system")).toBeTruthy()
    expect(screen.getByText('review_indicator')).toBeTruthy()
    expect(screen.getByText('No significant historical precedent at this replay depth.')).toBeTruthy()
    expect(screen.queryByText(/% prototype estimate/)).toBeNull()
  })

  it('shows an evidence-backed upcoming precedent and its recommendation source', async () => {
    const activeAlerts = {
      ...alerts,
      title: 'HIGH HISTORICAL RELEVANCE',
      alerts: [{
        id: 'alert-01', active_well_id: 'well-active', historical_event_id: 'event-01', alert_type: 'historical_precedent',
        alert_title: 'Historical Precedent Alert', relevance_score: 91, explanation: 'Same formation and nearby depth.',
        distance_km: 4.2, depth_difference_m: 23, formation_match: true, status: 'open',
        created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z',
      }, {
        id: 'alert-02', active_well_id: 'well-active', historical_event_id: 'event-02', alert_type: 'historical_precedent',
        alert_title: 'Historical Precedent Alert', relevance_score: 88, explanation: 'Same formation and nearby depth.',
        distance_km: 4.2, depth_difference_m: 26, formation_match: true, status: 'open',
        created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z',
      }],
      recommendation: {
        label: 'Decision support — engineer review required.',
        message: 'Comparable historical wells contain documented mitigation. Review the recorded mitigation and current drilling conditions before proceeding.',
        reason: 'A source-linked lost circulation event was recorded 23 m ahead in X Formation, 4.2 km away.',
        source_event_id: 'event-01', source_event_title: 'Partial lost circulation in X Formation', source_well_name: 'ANB-02',
        source_document: 'DDR-ANB-02-2024-07.pdf', source_page: 3,
        evidence_excerpt: 'Losses were recorded in the X Formation.', recorded_mitigation: 'Recorded mitigation: loss-control material was noted.',
      },
    } as unknown as ActiveAlerts
    const correlated = { ...correlation, historical_events: [supportingEvent, secondUpcomingEvent] } as unknown as Correlation
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: string) => {
      const response = input.includes('/live/') ? feed
        : input.includes('/predictive-risk/') ? { ...prediction, status: 'insufficient_data', signals: [] }
          : input.includes('/alerts/') ? activeAlerts
            : correlated
      return Promise.resolve({ ok: true, status: 200, json: async () => response })
    }))

    render(<LiveIntelligence activeWellId="well-active" radiusKm={10} depthWindowM={100} />)

    expect(await screen.findByText('Partial lost circulation in X Formation')).toBeTruthy()
    expect(screen.getByText('Relevant historical precedent detected ahead in the configured search window.')).toBeTruthy()
    expect(screen.getByText('Event type: Lost Circulation')).toBeTruthy()
    expect(screen.getByText('Offset well: ANB-02')).toBeTruthy()
    expect(screen.getByText('Upcoming depth: 2,865 m MD')).toBeTruthy()
    expect(screen.getByText('Distance: 4.2 km')).toBeTruthy()
    expect(screen.getByText('Depth ahead: 23 m')).toBeTruthy()
    expect(screen.getByText('Latest alert: OPEN')).toBeTruthy()
    expect(screen.getByText(/Also ahead in the configured window/)).toBeTruthy()
    expect(screen.getByText('Mud weight adjustment in X Formation')).toBeTruthy()
    expect(screen.getByText('ANB-02 · 26 m ahead · 4.2 km')).toBeTruthy()
    expect(screen.getByText('Decision support — engineer review required.')).toBeTruthy()
    expect(screen.getByText(/Partial lost circulation in X Formation · ANB-02 · DDR-ANB-02-2024-07.pdf · p.3/)).toBeTruthy()
    expect(screen.getByText(/Comparable historical wells contain documented mitigation/)).toBeTruthy()
  })

  it('advances deterministically and pauses and resets the replay controls', async () => {
    const replayFeed = {
      ...feed,
      states: [
        ...feed.states,
        { ...feed.states[0], measurement: { ...measurement, measured_depth_m: 2850, sampled_at: '2026-10-03T10:05:00Z' } },
        { ...feed.states[0], measurement: { ...measurement, measured_depth_m: 2858, sampled_at: '2026-10-03T10:10:00Z' } },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: string) => {
      const response = input.includes('/live/') ? replayFeed
        : input.includes('/predictive-risk/') ? prediction
          : input.includes('/alerts/') ? alerts
            : correlation
      return Promise.resolve({ ok: true, status: 200, json: async () => response })
    }))

    const { container } = render(<LiveIntelligence activeWellId="well-active" radiusKm={10} depthWindowM={100} />)
    await screen.findByText('ANB-01')
    expect(container.querySelector('.live-current-depth strong')?.textContent).toContain('2,842')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /Start live monitoring/i }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1800) })
    expect(container.querySelector('.live-current-depth strong')?.textContent).toContain('2,850')

    fireEvent.click(screen.getByRole('button', { name: /Pause/i }))
    await act(async () => { await vi.advanceTimersByTimeAsync(3600) })
    expect(container.querySelector('.live-current-depth strong')?.textContent).toContain('2,850')

    fireEvent.click(screen.getByRole('button', { name: /Reset/i }))
    expect(container.querySelector('.live-current-depth strong')?.textContent).toContain('2,842')
  })
})
