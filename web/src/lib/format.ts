const numberFormat = new Intl.NumberFormat('en-US')

export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return digits > 0
    ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : numberFormat.format(value)
}

export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function dppm(value: number | null | undefined): string {
  if (!value) return '0'
  return numberFormat.format(Math.round(value))
}

export function dateShort(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function dateTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function monthLabel(value: string): string {
  const date = new Date(`${value}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

export function titleCase(value?: string | null): string {
  if (!value) return '—'
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent'

const STATUS_TONES: Record<string, Tone> = {
  pass: 'success',
  passed: 'success',
  approved: 'success',
  completed: 'success',
  closed: 'success',
  verified: 'success',
  running: 'success',
  released: 'info',
  in_progress: 'info',
  pending_verification: 'warning',
  conditional: 'warning',
  pending: 'warning',
  planned: 'neutral',
  open: 'warning',
  contained: 'info',
  rework: 'warning',
  scrap: 'danger',
  fail: 'danger',
  failed: 'danger',
  rejected: 'danger',
  blocked: 'danger',
  cancelled: 'danger',
  expired: 'danger',
  down: 'danger',
  maintenance: 'warning',
  idle: 'neutral',
  consumed: 'neutral',
  partially_consumed: 'info',
  quarantine: 'warning',
  obsolete: 'neutral',
  phase_out: 'warning',
  active: 'success',
}

export function toneFor(status?: string | null): Tone {
  if (!status) return 'neutral'
  return STATUS_TONES[status] ?? 'neutral'
}

export function severityTone(severity?: string | null): Tone {
  switch (severity) {
    case 'critical':
      return 'danger'
    case 'high':
      return 'warning'
    case 'major':
      return 'warning'
    case 'medium':
      return 'info'
    case 'low':
    case 'minor':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function initials(name?: string | null): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
