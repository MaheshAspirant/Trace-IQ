import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Download, ShieldAlert, ShieldCheck } from 'lucide-react'
import { DataTable, type Column } from '../components/DataTable'
import { Badge, Button, Card, ErrorState, PageHeader, Pagination, SearchInput, Select } from '../components/ui'
import { qs } from '../lib/api'
import { useApi } from '../lib/useApi'
import { dateShort, downloadCsv, num, titleCase } from '../lib/format'

export default function Capa() {
  const [params] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [owner, setOwner] = useState(params.get('owner') ?? '')
  const [overdue, setOverdue] = useState(params.get('overdue') === '1')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const [sort, setSort] = useState({ key: 'due_at', dir: 'asc' })
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<any>(
    `/capas${qs({ q: term, status, owner, overdue, page, size, sort: sort.key, dir: sort.dir })}`,
  )

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )

  const columns: Column<any>[] = [
    {
      key: 'capa_id',
      header: 'CAPA',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink">{row.capa_id}</p>
          <p className="text-[11px] text-faint">{row.defect_id} · {row.severity}</p>
        </div>
      ),
    },
    {
      key: 'defect_name',
      header: 'Defect / product',
      render: (row) => (
        <div className="max-w-[220px]">
          <p className="truncate text-ink">{row.defect_name}</p>
          <p className="truncate text-[11px] text-faint">{row.product_name ?? row.supplier_name ?? '—'}</p>
        </div>
      ),
    },
    { key: 'root_cause_category', header: 'Root cause', render: (row) => <span className="text-muted">{titleCase(row.root_cause_category)}</span> },
    { key: 'owner_role', header: 'Owner', mobile: true, render: (row) => <span className="text-muted">{titleCase(row.owner_role)}</span> },
    { key: 'opened_at', header: 'Opened', sortable: true, render: (row) => <span className="text-muted">{dateShort(row.opened_at)}</span> },
    { key: 'due_at', header: 'Due', mobile: true, sortable: true, render: (row) => <span className="text-muted">{dateShort(row.due_at)}</span> },
    { key: 'status', header: 'Status', mobile: true, render: (row) => <Badge status={row.status} dot /> },
    {
      key: 'gate',
      header: 'Gate',
      render: (row) => {
        if (row.status !== 'closed') return <span className="text-[11.5px] text-faint">—</span>
        return row.closure_allowed ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-success"><ShieldCheck size={12} /> OK</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-danger"><ShieldAlert size={12} /> {row.gate_reason?.replace(/_/g, ' ') ?? 'violation'}</span>
        )
      },
    },
    {
      key: 'days_overdue',
      header: 'Overdue',
      align: 'right',
      sortable: true,
      render: (row) => (row.days_overdue > 0 ? <Badge tone="danger">{row.days_overdue}d</Badge> : <span className="text-[11.5px] text-faint">—</span>),
    },
    { key: 'action', header: '', width: '40px', render: () => <ChevronRight size={14} className="text-faint" /> },
  ]

  const summary = data?.summary

  return (
    <div className="space-y-4">
      <PageHeader
        title="Corrective actions"
        subtitle="CAPA register with root cause, containment, verification and a closure gate that cannot be bypassed through the interface."
        meta={
          <>
            <Badge tone="neutral">{num(summary?.total)} in view</Badge>
            <Badge tone="info">{num(summary?.open)} in progress</Badge>
            <Badge tone="warning">{num(summary?.pending_verification)} awaiting verification</Badge>
            <Badge tone="danger">{num(summary?.overdue)} overdue</Badge>
            {summary?.gate_violations ? <Badge tone="danger">{num(summary.gate_violations)} gate violations</Badge> : null}
          </>
        }
        actions={
          <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv('capas.csv', data?.rows ?? [])} disabled={!data?.rows?.length}>
            Export page
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(summary?.by_status ?? {}).map(([key, value]) => (
          <Card key={key} padded className="flex items-center justify-between">
            <div>
              <p className="label">{key.replace(/_/g, ' ')}</p>
              <p className="mt-1 text-[18px] font-semibold text-ink tabular">{num(Number(value))}</p>
            </div>
            <Badge status={key} dot className="hidden lg:inline-flex" />
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-3 xl:flex-row xl:items-center">
          <SearchInput
            value={term}
            onChange={(value) => { setTerm(value); setPage(1) }}
            placeholder="Search CAPA, defect, supplier or product"
            className="xl:max-w-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} aria-label="Status" className="w-[175px]">
              <option value="">All statuses</option>
              {['open', 'in_progress', 'pending_verification', 'verified', 'closed', 'cancelled'].map((option) => (
                <option key={option} value={option}>{titleCase(option)}</option>
              ))}
            </Select>
            <Select value={owner} onChange={(event) => { setOwner(event.target.value); setPage(1) }} aria-label="Owner" className="w-[180px]">
              <option value="">All owners</option>
              {['quality_engineer', 'supplier_quality', 'process_engineer', 'maintenance_lead', 'production_supervisor', 'quality_manager'].map((option) => (
                <option key={option} value={option}>{titleCase(option)}</option>
              ))}
            </Select>
            <label className="flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-2.5 text-[12.5px] text-muted sm:h-9">
              <input type="checkbox" checked={overdue} onChange={(event) => { setOverdue(event.target.checked); setPage(1) }} className="h-3.5 w-3.5 rounded border-slate-300 text-accent" />
              Overdue only
            </label>
            {(term || status || owner || overdue) && (
              <Button variant="ghost" size="sm" onClick={() => { setTerm(''); setStatus(''); setOwner(''); setOverdue(false); setPage(1) }}>Clear</Button>
            )}
          </div>
          <span className="ml-auto hidden text-[11.5px] text-faint xl:block">{num(data?.total)} matching</span>
        </div>

        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.capa_id}
          loading={loading}
          onRowClick={(row) => navigate(`/capa/${row.capa_id}`)}
          sort={sort}
          onSort={(key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })}
          emptyTitle="No corrective actions match these filters"
        />

        {data && (
          <Pagination page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} onSize={(value) => { setSize(value); setPage(1) }} />
        )}
      </Card>
    </div>
  )
}
