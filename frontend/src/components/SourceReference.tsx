import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

type Props = {
  documentId?: string | null
  eventId?: string | null
  page?: number | null
  className?: string
  ariaLabel?: string
  children: ReactNode
}

export function SourceReference({ documentId, eventId, page, className, ariaLabel, children }: Props) {
  if (!documentId || !eventId || page == null) return <span className={className}>{children}</span>
  const query = new URLSearchParams({ documentId, eventId, page: String(page) })
  return <Link className={className} to={`/documents?${query.toString()}`} aria-label={ariaLabel ?? `Open stored evidence at source page ${page}`}>{children}</Link>
}
