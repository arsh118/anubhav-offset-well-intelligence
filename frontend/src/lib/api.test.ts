import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('API request timeout', () => {
  it('aborts a stalled request at its configured timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const request = api('/health', {}, 25)
    const rejection = expect(request).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: 'ANUBHAV is taking longer to respond. Please try again.',
    })

    await actTimeout(25)
    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

async function actTimeout(milliseconds: number) {
  await vi.advanceTimersByTimeAsync(milliseconds)
}
