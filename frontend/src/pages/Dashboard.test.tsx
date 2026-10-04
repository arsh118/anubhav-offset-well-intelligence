import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { AppProvider } from '../lib/AppContext'
import { Dashboard } from './Dashboard'

function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as Response
}

function renderDashboard() {
  return render(<MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AppProvider><Routes><Route element={<AppShell />}><Route path="/" element={<Dashboard />} /></Route></Routes></AppProvider>
  </MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('dashboard initialization', () => {
  it('keeps the shell and skeletons visible until health and well data resolve, then shows a true empty state', async () => {
    let resolveHealth!: (response: Response) => void
    let resolveWells!: (response: Response) => void
    const healthRequest = new Promise<Response>((resolve) => { resolveHealth = resolve })
    const wellsRequest = new Promise<Response>((resolve) => { resolveWells = resolve })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) return healthRequest
      if (url.endsWith('/wells?limit=500')) return wellsRequest
      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Connecting to ANUBHAV intelligence...')
    expect(screen.queryByText('No active well available')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/health$/)

    await act(async () => { resolveHealth(jsonResponse({ status: 'ok', database: 'connected' })) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/wells\?limit=500$/)
    expect(screen.queryByText('No active well available')).toBeNull()

    await act(async () => { resolveWells(jsonResponse([])) })
    expect(await screen.findByText('No active well available')).toBeTruthy()
    expect(screen.getByText('The API returned an empty well dataset. An active well record is needed before offset relevance can be calculated.')).toBeTruthy()
  })

  it('stops after two automatic retries and offers a manual retry instead of an empty state', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)

    renderDashboard()
    expect(screen.queryByText('No active well available')).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.getByText('ANUBHAV is taking longer to respond.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'TRY AGAIN' })).toBeTruthy()
    expect(screen.queryByText('No active well available')).toBeNull()
  })
})
