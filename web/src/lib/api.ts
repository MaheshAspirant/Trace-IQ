export class ApiError extends Error {
  status: number
  payload: Record<string, unknown>

  constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

function endpoint(path: string): string {
  if (path === '/api' || path.startsWith('/api/')) return path
  return `/api${path.startsWith('/') ? path : `/${path}`}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  const text = await response.text()
  let body: any = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { error: text.slice(0, 300) }
    }
  }
  if (!response.ok) {
    throw new ApiError(
      body?.error || `${response.status} ${response.statusText}`,
      response.status,
      body,
    )
  }
  return body as T
}

export function get<T = any>(path: string): Promise<T> {
  return request<T>(path)
}

export function post<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export function put<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
}

export interface Envelope<T = any> {
  rows: T[]
  total: number
  page: number
  size: number
  pages: number
  [key: string]: any
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === false) return
    search.set(key, String(value))
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}
