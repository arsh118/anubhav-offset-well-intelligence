import { AlertCircle, LoaderCircle } from 'lucide-react'

export function Loading({ label = 'Loading operational data' }: { label?: string }) {
  return <div className="feedback"><LoaderCircle className="spin" size={18} /><span>{label}</span></div>
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-state"><AlertCircle size={18} /><div><strong>Data unavailable</strong><p>{message}</p>{retry && <button className="text-button" onClick={retry}>Try again</button>}</div></div>
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-mark" /><strong>{title}</strong><p>{detail}</p></div>
}
