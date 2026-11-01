import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Download } from 'lucide-react'
import { DataTable, type Column } from '../components/DataTable'
import {
  Badge,
  Button,
  Card,
  ErrorState,
  PageHeader,
  Pagination,
  Progress,
  SearchInput,
  Select,
} from '../components/ui'
import { qs } from '../lib/api'
import { useApi } from '../lib/useApi'
import { dateShort, downloadCsv, num, pct } from '../lib/format'

export default function Orders() {
  const [params] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [plant, setPlant] = useState(params.get('plant') ?? '')
  const [rework, setRework] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const [sort, setSort] = useState({ key: 'order_id', dir: 'desc' })
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<any>(
    `/orders${qs({ q: term, status, plant, rework, page, size, sort: sort.key, dir: sort.dir })}`,
  )

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )

  const columns: Column<any>[] = [
    {
      key: 'order_id',
      header: 'Order',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink">{row.order_id}</p>
          <p className="text-[11px] text-faint">
            {row.plant} / {row.line} · {row.priority}
          </p>
        </div>
      ),
    },
    {
      key: 'product_name',
      header: 'Product',
      mobile: true,
      render: (row) => (
        <div className="max-w-[200px]">
          <p className="truncate text-ink">{row.product_name}</p>
          <p className="text-[11px] text-faint">{row.product_id}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', mobile: true, render: (row) => <Badge status={row.status} dot /> },
    {
      key: 'actual_qty',
      header: 'Progress',
      mobile: true,
      align: 'right',
      sortable: true,
      render: (row) => (
        <div className="ml-auto w-[110px]">
          <p className="text-[11.5px] tabular">
            {num(row.actual_qty)} / {num(row.planned_qty)}
          </p>
          <Progress value={row.progress} tone={row.status === 'completed' ? 'success' : 'accent'} className="mt-1" />
        </div>
      ),
    },
    { key: 'steps_done', header: 'Steps', align: 'right', render: (row) => <span className="tabular text-muted">{row.steps_done}/{row.steps_total}</span> },
    { key: 'scrap_qty', header: 'Scrap', align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.scrap_qty)}</span> },
    { key: 'scrap_rate', header: 'Scrap rate', align: 'right', render: (row) => <span className="tabular text-muted">{pct(row.scrap_rate)}</span> },
    { key: 'defect_events', header: 'Defects', align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.defect_events)}</span> },
    { key: 'actual_start', header: 'Started', mobile: true, sortable: true, render: (row) => <span className="text-muted">{dateShort(row.actual_start)}</span> },
    { key: 'action', header: '', width: '40px', render: () => <ChevronRight size={14} className="text-faint" /> },
  ]

  const summary = data?.summary

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production orders"
        subtitle="Work orders with machine routing, material consumption and the resulting rework and scrap quantities."
        meta={
          <>
            <Badge tone="neutral">{num(data?.total)} orders</Badge>
            <Badge tone="info">{num(summary?.in_progress)} in progress</Badge>
            <Badge tone="success">{num(summary?.completed)} completed</Badge>
          </>
        }
        actions={
          <Button
            size="sm"
            icon={<Download size={14} />}
            onClick={() => downloadCsv('production-orders.csv', data?.rows ?? [])}
            disabled={!data?.rows?.length}
          >
            Export page
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-3 xl:flex-row xl:items-center">
          <SearchInput
            value={term}
            onChange={(value) => { setTerm(value); setPage(1) }}
            placeholder="Search order, SKU or product"
            className="xl:max-w-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} aria-label="Status" className="w-[160px]">
              <option value="">All statuses</option>
              {['planned', 'released', 'in_progress', 'completed', 'closed', 'cancelled'].map((option) => (
                <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
              ))}
            </Select>
            <Select value={plant} onChange={(event) => { setPlant(event.target.value); setPage(1) }} aria-label="Plant" className="w-[140px]">
              <option value="">All plants</option>
              <option value="PLANT-01">PLANT-01</option>
              <option value="PLANT-02">PLANT-02</option>
              <option value="PLANT-03">PLANT-03</option>
            </Select>
            <label className="flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-2.5 text-[12.5px] text-muted sm:h-9">
              <input
                type="checkbox"
                checked={rework}
                onChange={(event) => { setRework(event.target.checked); setPage(1) }}
                className="h-3.5 w-3.5 rounded border-slate-300 text-accent"
              />
              Rework only
            </label>
            {(term || status || plant || rework) && (
              <Button variant="ghost" size="sm" onClick={() => { setTerm(''); setStatus(''); setPlant(''); setRework(false); setPage(1) }}>
                Clear
              </Button>
            )}
          </div>
          <span className="ml-auto hidden text-[11.5px] text-faint xl:block">{num(data?.total)} matching</span>
        </div>

        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.order_id}
          loading={loading}
          onRowClick={(row) => navigate(`/orders/${row.order_id}`)}
          sort={sort}
          onSort={(key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })}
          emptyTitle="No orders match these filters"
        />

        {data && (
          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            size={data.size}
            onPage={setPage}
            onSize={(value) => { setSize(value); setPage(1) }}
          />
        )}
      </Card>
    </div>
  )
}
