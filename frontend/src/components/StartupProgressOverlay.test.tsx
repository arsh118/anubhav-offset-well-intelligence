import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { StartupProgressOverlay } from './StartupProgressOverlay'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('startup progress overlay', () => {
  it('holds estimated progress below completion while waiting, then completes after backend readiness', async () => {
    vi.useFakeTimers()
    const { rerender } = render(<StartupProgressOverlay apiStatus="loading" />)

    expect(screen.getByRole('dialog', { name: 'Preparing Safety Intelligence' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'ANUBHAV' }).getAttribute('src')).toBe('/assets/anubhav_logo.png')
    expect(screen.getByText(/First-time initialization may take up to a minute/)).toBeTruthy()
    expect(screen.getByText('Please keep this window open', { exact: false })).toBeTruthy()
    expect(screen.getByText('Connecting to safety intelligence engine...')).toBeTruthy()
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100)

    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(screen.getByText('Loading safety data...')).toBeTruthy()
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThanOrEqual(45)

    await act(async () => { await vi.advanceTimersByTimeAsync(62_000) })

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('94')
    expect(screen.getByText('Finalizing dashboard...')).toBeTruthy()

    rerender(<StartupProgressOverlay apiStatus="online" />)
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThan(100)
    await act(async () => { await vi.advanceTimersByTimeAsync(650) })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    expect(screen.getByText('Safety intelligence ready. Opening your dashboard...')).toBeTruthy()

    await act(async () => { await vi.advanceTimersByTimeAsync(180) })
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('dismisses the loading overlay on a permanent backend failure', () => {
    render(<StartupProgressOverlay apiStatus="offline" />)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})
