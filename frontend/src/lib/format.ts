export function humanize(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatDepth(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value).toLocaleString()} m`
}

export function formatDistance(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(1)} km`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Date not recorded'
  return new Intl.DateTimeFormat('en-IN', { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(value))
}

export function signedDepth(value: number): string {
  return `${value > 0 ? '+' : ''}${Math.round(value)} m`
}
