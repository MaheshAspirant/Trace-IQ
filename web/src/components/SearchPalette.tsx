import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Building2, ClipboardList, Cog, FileWarning, Package, Search, ShieldCheck, Boxes, ClipboardCheck, X } from 'lucide-react'
import { useApi, useDebounced } from '../lib/useApi'
import { Spinner, cx } from './ui'

const ICONS: Record<string, JSX.Element> = {
  product: <Package size={14} />,
  order: <ClipboardList size={14} />,
  lot: <Boxes size={14} />,
  supplier: <Building2 size={14} />,
  defect: <FileWarning size={14} />,
  capa: <ShieldCheck size={14} />,
  machine: <Cog size={14} />,
  inspection: <ClipboardCheck size={14} />,
}

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('')
  const debounced = useDebounced(term, 180)
  const { data, loading } = useApi<any>(
    debounced.trim().length >= 2 ? `/search?q=${encodeURIComponent(debounced.trim())}` : null,
  )
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const flat = useMemo(() => {
    const items: Array<{ href: string; title: string; subtitle: string; kind: string }> = []
    ;(data?.groups ?? []).forEach((group: any) => {
      group.items.forEach((item: any) => items.push({ ...item, kind: group.kind }))
    })
    return items
  }, [data])

  useEffect(() => {
    if (open) {
      setTerm('')
      setActive(0)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [debounced])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((value) => (flat.length ? (value + 1) % flat.length : 0))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((value) => (flat.length ? (value - 1 + flat.length) % flat.length : 0))
      }
      if (event.key === 'Enter' && flat[active]) {
        navigate(flat[active].href)
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, flat, active, navigate, onClose])

  if (!open) return null

  let cursor = -1
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-3 pt-4 backdrop-blur-[2px] sm:px-4 sm:pt-[10vh]">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-white shadow-pop"
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-faint" />
          <input
            ref={inputRef}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search orders, lots, suppliers, defects, CAPAs…"
            className="h-14 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-faint sm:h-12 sm:text-[14px]"
            aria-label="Global search"
          />
          {loading && <Spinner className="mr-1" />}
          <kbd className="hidden rounded border border-line bg-slate-50 px-1.5 py-0.5 text-[10px] text-muted sm:inline">Esc</kbd>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-slate-100 sm:hidden"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {term.trim().length < 2 && (
            <div className="px-4 py-6 text-center">
              <p className="text-[12.5px] text-muted">
                Type at least two characters. Search matches identifiers, product names and suppliers.
              </p>
              <p className="mt-2 text-[11.5px] text-faint">
                ↑ ↓ to navigate · Enter to open · Esc to close
              </p>
            </div>
          )}
          {term.trim().length >= 2 && !loading && flat.length === 0 && (
            <p className="px-4 py-6 text-center text-[12.5px] text-muted">
              No matches for “{term.trim()}”.
            </p>
          )}
          {(data?.groups ?? []).map((group: any) => (
            <div key={group.kind} className="mb-1">
              <p className="px-4 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-faint">
                {group.label}
              </p>
              {group.items.map((item: any) => {
                cursor += 1
                const index = cursor
                return (
                  <button
                    key={`${group.kind}-${item.id}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      navigate(item.href)
                      onClose()
                    }}
                    className={cx(
                      'flex w-full items-center gap-3 px-4 py-3 text-left sm:py-2',
                      index === active ? 'bg-accent-soft' : 'hover:bg-slate-50',
                    )}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                      {ICONS[group.kind] ?? <Search size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{item.title}</span>
                      <span className="block truncate text-[11.5px] text-muted">{item.subtitle}</span>
                    </span>
                    <span className="hidden text-[11px] text-faint sm:block">{item.id}</span>
                    <ArrowRight size={13} className="text-faint" />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="hidden items-center justify-between border-t border-line bg-slate-50/70 px-4 py-2 text-[11px] text-faint sm:flex">
          <span>Search covers master data, transactions and quality records</span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-line bg-white px-1 py-0.5">⌘</kbd>
            <kbd className="rounded border border-line bg-white px-1 py-0.5">K</kbd>
          </span>
        </div>
      </div>
    </div>
  )
}
