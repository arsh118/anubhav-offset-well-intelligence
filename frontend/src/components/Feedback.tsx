import { AlertCircle, LoaderCircle } from 'lucide-react'

export function Loading({ label = 'Loading operational data' }: { label?: string }) {
  return <div className="feedback"><LoaderCircle className="spin" size={18} /><span>{label}</span></div>
}

export function ErrorState({ message, retry, title = 'Data unavailable', retryLabel = 'Try again' }: { message: string; retry?: () => void; title?: string; retryLabel?: string }) {
  return <div className="error-state"><AlertCircle size={18} /><div><strong>{title}</strong><p>{message}</p>{retry && <button className="text-button" onClick={retry}>{retryLabel}</button>}</div></div>
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-mark" /><strong>{title}</strong><p>{detail}</p></div>
}

export function ActiveWellGate({ state, readyDetail }: { state: 'loading' | 'ready' | 'empty' | 'error'; readyDetail: string }) {
  if (state === 'loading') return <div className="panel loading-panel"><Loading label="Loading active well context" /></div>
  if (state === 'error') return <div className="context-error-note">The active well context could not be loaded. Use TRY AGAIN above to reconnect.</div>
  if (state === 'empty') return <EmptyState title="No active well available" detail="The API returned an empty well dataset." />
  return <EmptyState title="Select an active well" detail={readyDetail} />
}
