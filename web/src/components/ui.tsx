import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Search,
  X,
  XCircle,
} from 'lucide-react'
import { toneFor, type Tone } from '../lib/format'

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------ badges */
const BADGE_TONES: Record<Tone, string> = {
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/20',
  danger: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-info-soft text-info border-info/20',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  accent: 'bg-accent-soft text-accent-strong border-accent/20',
}

export function Badge({
  children,
  tone,
  status,
  dot = false,
  wrap = false,
  className,
}: {
  children?: ReactNode
  tone?: Tone
  status?: string | null
  dot?: boolean
  wrap?: boolean
  className?: string
}) {
  const resolved = tone ?? toneFor(status)
  const label = children ?? (status ? status.replace(/_/g, ' ') : '—')
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-2xs font-medium capitalize',
        wrap ? 'whitespace-normal' : 'whitespace-nowrap',
        BADGE_TONES[resolved],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {label}
    </span>
  )
}

export function SeverityBadge({ severity }: { severity?: string | null }) {
  const tone: Tone =
    severity === 'critical' ? 'danger' : severity === 'major' ? 'warning' : 'neutral'
  return (
    <Badge tone={tone} dot>
      {severity ?? 'unknown'}
    </Badge>
  )
}

/* ----------------------------------------------------------------- buttons */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-sm hover:bg-accent-strong disabled:bg-accent/60',
  secondary: 'border border-line bg-white text-ink hover:bg-slate-50',
  ghost: 'text-muted hover:bg-slate-100 hover:text-ink',
  danger: 'bg-danger text-white hover:bg-red-700',
  subtle: 'bg-accent-soft text-accent-strong hover:bg-blue-100',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}) {
  return (
    <button
      className={cx(
        'focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-9 px-3 text-[12.5px] sm:h-8 sm:px-2.5' : 'h-10 px-3.5 text-[13px] sm:h-9',
        BUTTON_VARIANTS[variant],
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'focus-ring inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-slate-100 hover:text-ink sm:h-8 sm:w-8',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ inputs */
export function Input({
  className,
  icon,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint">
          {icon}
        </span>
      )}
      <input
        className={cx(
          'h-11 w-full rounded-lg border border-line bg-white text-base text-ink shadow-sm transition-colors placeholder:text-faint focus:border-accent/50 sm:h-9 sm:text-[13px]',
          icon ? 'pl-8 pr-3' : 'px-3',
          className,
        )}
        {...props}
      />
    </div>
  )
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cx(
          'h-11 w-full appearance-none rounded-lg border border-line bg-white pl-3 pr-8 text-base text-ink shadow-sm focus:border-accent/50 sm:h-9 sm:text-[13px]',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronRight
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 text-faint"
      />
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      icon={<Search size={14} />}
      className={className}
      aria-label={placeholder}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <p className="text-[13px] font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'focus-ring relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors after:absolute after:-inset-3 after:content-[""]',
          checked ? 'bg-accent' : 'bg-slate-300',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------- cards */
export function Card({
  children,
  className,
  padded = false,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return <div className={cx('card', padded && 'card-pad', className)}>{children}</div>
}

export function Section({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className={cx('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </Card>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  meta,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-[20px] font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[13px] text-muted">{subtitle}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
  loading = false,
  delta,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: Tone
  loading?: boolean
  delta?: number | null
}) {
  const toneRing: Record<Tone, string> = {
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
    neutral: 'bg-slate-100 text-slate-500',
    accent: 'bg-accent-soft text-accent',
  }
  return (
    <Card className="card-pad">
      <div className="flex items-start justify-between gap-3">
        <p className="label">{label}</p>
        {icon && (
          <span className={cx('flex h-7 w-7 items-center justify-center rounded-lg', toneRing[tone])}>
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-24 skeleton" />
      ) : (
        <p className="mt-1.5 text-[22px] font-semibold leading-8 tracking-tight text-ink tabular">
          {value}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
        {delta !== undefined && delta !== null && (
          <span
            className={cx(
              'inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-medium tabular',
              delta > 0 ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success',
            )}
          >
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(2)} pp
          </span>
        )}
        {sub}
      </div>
    </Card>
  )
}

export function Progress({
  value,
  tone = 'accent',
  className,
}: {
  value: number
  tone?: 'accent' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  const fill = {
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  }[tone]
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div
        className={cx('h-full rounded-full transition-[width] duration-300', fill)}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  )
}

export function Stepper({
  steps,
}: {
  steps: Array<{ label: string; detail?: string; state: 'done' | 'current' | 'todo' }>
}) {
  return (
    <ol className="flex flex-col gap-0">
      {steps.map((step, index) => (
        <li key={step.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                step.state === 'done' && 'border-success/30 bg-success-soft text-success',
                step.state === 'current' && 'border-accent bg-accent text-white',
                step.state === 'todo' && 'border-line bg-white text-faint',
              )}
            >
              {step.state === 'done' ? <Check size={12} /> : index + 1}
            </span>
            {index < steps.length - 1 && <span className="my-1 h-6 w-px bg-line" />}
          </div>
          <div className="pb-3">
            <p
              className={cx(
                'text-[12.5px] font-medium',
                step.state === 'todo' ? 'text-faint' : 'text-ink',
              )}
            >
              {step.label}
            </p>
            {step.detail && <p className="text-[11.5px] text-muted">{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function KeyValue({
  items,
  columns = 2,
}: {
  items: Array<{ label: string; value: ReactNode }>
  columns?: 2 | 3 | 4
}) {
  return (
    <dl
      className={cx(
        'grid gap-x-6 gap-y-3',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        columns === 4 && 'grid-cols-2 lg:grid-cols-4',
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="label">{item.label}</dt>
          <dd className="mt-0.5 truncate text-[13px] font-medium text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* --------------------------------------------------------------- feedback */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={18} className={cx('animate-spin text-accent', className)} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon ?? <Info size={18} />}
      </div>
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[12.5px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle size={18} />
      </div>
      <p className="text-[13.5px] font-medium text-ink">Could not load this view</p>
      <p className="mt-1 max-w-md text-[12.5px] text-muted">{message}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <div
              key={columnIndex}
              className="h-6 flex-1 skeleton"
              style={{ maxWidth: columnIndex === 0 ? '110px' : undefined }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ tabs */
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: Array<{ value: string; label: string; count?: number }>
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <div className={cx('no-scrollbar flex flex-wrap gap-1 border-b border-line sm:flex-nowrap sm:overflow-x-auto', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => onChange(item.value)}
          className={cx(
            'focus-ring relative whitespace-nowrap px-3 py-3 text-[13px] font-medium transition-colors sm:py-2.5',
            value === item.value ? 'text-ink' : 'text-muted hover:text-ink',
          )}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-muted tabular">
              {item.count}
            </span>
          )}
          {value === item.value && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
          )}
        </button>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- overlays */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative z-10 w-full animate-slide-up rounded-t-2xl border border-line bg-white shadow-pop sm:rounded-2xl',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-1 text-[12.5px] text-muted">{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-slate-50/60 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-xl',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-[1px]">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Details"
        className={cx(
          'relative z-10 flex h-full w-full animate-slide-up flex-col border-l border-line bg-white shadow-pop',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ink">{title}</div>
            {subtitle && <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>}
          </div>
          <IconButton label="Close panel" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="border-t border-line bg-slate-50/60 px-5 py-3">{footer}</div>
        )}
      </aside>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}

/* ----------------------------------------------------------------- toasts */
type ToastTone = 'success' | 'error' | 'info'
interface Toast {
  id: number
  title: string
  description?: string
  tone: ToastTone
}

const ToastContext = createContext<{
  push: (toast: Omit<Toast, 'id'>) => void
} | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++counter.current
    setToasts((current) => [...current, { ...toast, id }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 4800)
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex animate-slide-up items-start gap-3 rounded-xl border border-line bg-white p-3.5 shadow-pop"
          >
            <span
              className={cx(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                toast.tone === 'success' && 'bg-success-soft text-success',
                toast.tone === 'error' && 'bg-danger-soft text-danger',
                toast.tone === 'info' && 'bg-info-soft text-info',
              )}
            >
              {toast.tone === 'success' ? (
                <CheckCircle2 size={14} />
              ) : toast.tone === 'error' ? (
                <XCircle size={14} />
              ) : (
                <Info size={14} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-[12px] leading-4 text-muted">{toast.description}</p>
              )}
            </div>
            <button
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
              className="text-faint hover:text-ink"
              aria-label="Dismiss notification"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}

/* -------------------------------------------------------------- pagination */
export function Pagination({
  page,
  pages,
  total,
  size,
  onPage,
  onSize,
}: {
  page: number
  pages: number
  total: number
  size: number
  onPage: (page: number) => void
  onSize?: (size: number) => void
}) {
  const start = total === 0 ? 0 : (page - 1) * size + 1
  const end = Math.min(total, page * size)
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 sm:flex-row">
      <p className="text-[12px] text-muted">
        Showing <span className="font-medium text-ink tabular">{start.toLocaleString()}</span>–
        <span className="font-medium text-ink tabular">{end.toLocaleString()}</span> of{' '}
        <span className="font-medium text-ink tabular">{total.toLocaleString()}</span>
      </p>
      <div className="flex items-center gap-2">
        {onSize && (
          <Select
            value={size}
            onChange={(event) => onSize(Number(event.target.value))}
            className="h-8 w-[92px] text-[12px]"
            aria-label="Rows per page"
          >
            {[10, 25, 50, 100].map((option) => (
              <option key={option} value={option}>
                {option} / page
              </option>
            ))}
          </Select>
        )}
        <div className="flex items-center gap-1">
          <IconButton
            label="Previous page"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className="disabled:opacity-40"
          >
            <ChevronLeft size={15} />
          </IconButton>
          <span className="px-1 text-[12px] text-muted tabular">
            {page} / {pages}
          </span>
          <IconButton
            label="Next page"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
            className="disabled:opacity-40"
          >
            <ChevronRight size={15} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
