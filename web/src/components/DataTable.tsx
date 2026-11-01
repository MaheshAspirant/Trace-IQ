import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Inbox } from 'lucide-react'
import { EmptyState, TableSkeleton, cx } from './ui'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
  width?: string
  className?: string
  /** Include this field in the compact record card shown below the md breakpoint. */
  mobile?: boolean
}

export interface SortState {
  key: string
  dir: string
}

export function DataTable<T extends Record<string, any>>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription = 'Adjust the filters or search for a different term.',
  onRowClick,
  sort,
  onSort,
  footer,
  dense = false,
  stickyHeader = false,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: T) => void
  sort?: SortState
  onSort?: (key: string) => void
  footer?: ReactNode
  dense?: boolean
  stickyHeader?: boolean
}) {
  if (loading) return <TableSkeleton rows={8} columns={Math.min(columns.length, 6)} />
  if (!rows.length) {
    return <EmptyState icon={<Inbox size={18} />} title={emptyTitle} description={emptyDescription} />
  }

  const titleColumn = columns[0]
  const cell = (column: Column<T>, row: T) =>
    column.render ? column.render(row) : ((row[column.key] ?? '—') as ReactNode)

  const marked = columns.filter(
    (column) => column.mobile && column.key !== titleColumn.key && column.key !== 'action',
  )
  const mobileDetails = marked.length
    ? marked
    : columns
        .filter((column) => column.key !== titleColumn.key && column.key !== 'action')
        .slice(0, 3)
  const sortable = columns.filter((column) => column.sortable && column.key !== 'action')

  return (
    <>
      <div className="md:hidden">
        {onSort && sort && sortable.length > 0 && (
          <div className="flex items-center gap-2 border-b border-line bg-slate-50/50 px-3 py-2">
            <span className="text-2xs font-semibold uppercase tracking-[0.05em] text-faint">
              Sort
            </span>
            <select
              value={sort.key}
              onChange={(event) => onSort(event.target.value)}
              aria-label="Sort records by"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-base text-ink focus:border-accent/50"
            >
              {sortable.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.header}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onSort(sort.key)}
              aria-label={sort.dir === 'asc' ? 'Sort descending' : 'Sort ascending'}
              className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-muted"
            >
              {sort.dir === 'asc' ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        )}

        <div className="divide-y divide-line">
          {rows.map((row) => {
            const content = (
              <>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">{cell(titleColumn, row)}</div>
                  {onRowClick && (
                    <ChevronRight size={16} className="mt-1 shrink-0 text-faint" />
                  )}
                </div>
                {mobileDetails.length > 0 && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                    {mobileDetails.map((column) => (
                      <div
                        key={column.key}
                        className={cx('min-w-0', column.align === 'right' && 'text-right')}
                      >
                        <dt className="text-2xs font-semibold uppercase tracking-[0.05em] text-faint">
                          {column.header}
                        </dt>
                        <dd className="mt-0.5 break-words text-[12.5px] leading-5 text-ink">
                          {cell(column, row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            )

            if (!onRowClick) {
              return (
                <div key={rowKey(row)} data-mobile-row className="px-4 py-3">
                  {content}
                </div>
              )
            }

            return (
              <div
                key={rowKey(row)}
                data-mobile-row
                role="button"
                tabIndex={0}
                onClick={() => onRowClick(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onRowClick(row)
                  }
                }}
                className="cursor-pointer px-4 py-3 transition-colors active:bg-slate-50"
              >
                {content}
              </div>
            )
          })}
        </div>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className={cx('bg-slate-50/80', stickyHeader && 'sticky top-0 z-10')}>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={{ width: column.width }}
                    className={cx(
                      'whitespace-nowrap border-b border-line px-4 py-2.5 text-2xs font-semibold uppercase tracking-[0.05em] text-muted',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.sortable && onSort && 'cursor-pointer select-none hover:text-ink',
                      column.className,
                    )}
                    onClick={column.sortable && onSort ? () => onSort(column.key) : undefined}
                    aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <span className={cx('inline-flex items-center gap-1', column.align === 'right' && 'flex-row-reverse')}>
                      {column.header}
                      {column.sortable && onSort && (
                        <span className="text-faint">
                          {active ? (
                            sort?.dir === 'asc' ? (
                              <ChevronUp size={12} />
                            ) : (
                              <ChevronDown size={12} />
                            )
                          ) : (
                            <ChevronDown size={12} className="opacity-35" />
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx(
                  'border-b border-line/70 last:border-0',
                  onRowClick && 'cursor-pointer transition-colors hover:bg-slate-50/80',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'px-4 align-middle text-[12.5px] text-ink',
                      dense ? 'py-2' : 'py-2.5',
                      column.align === 'right' && 'text-right tabular',
                      column.align === 'center' && 'text-center',
                      column.className,
                    )}
                  >
                    {cell(column, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
    </>
  )
}
