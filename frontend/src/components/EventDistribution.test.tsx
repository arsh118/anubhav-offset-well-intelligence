import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { WellEvent } from '../lib/api'
import { EventDistribution } from './EventDistribution'

const events = Array.from({ length: 8 }, (_, index) => ({
  id: `event-${index}`, event_type: index < 5 ? 'lost_circulation' : 'stuck_pipe', measured_depth: 2700 + index * 50,
  formation: { id: index % 2 === 0 ? 'formation-x' : 'formation-y', name: index % 2 === 0 ? 'X Formation' : 'Y Shale' },
} as unknown as WellEvent))

describe('historical event distributions', () => {
  it('uses event depths and source event counts in the distribution and formation matrix', () => {
    render(<EventDistribution events={events} />)

    expect(screen.getByRole('list', { name: /Event counts by measured depth from 2700 to 3050 metres/ })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Historical event counts by event type' })).toBeTruthy()
    expect(screen.getAllByText('Lost Circulation').length).toBeGreaterThan(1)
    fireEvent.click(screen.getByText('Open matrix'))
    expect(screen.getByRole('cell', { name: 'X Formation, Lost Circulation: 3 events' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Y Shale, Stuck Pipe: 2 events' })).toBeTruthy()
  })
})
