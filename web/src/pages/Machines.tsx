import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Download, Gauge } from 'lucide-react'
import { DataTable, type Column } from '../components/DataTable'
import { Badge, Button, Card, ErrorState, PageHeader, Pagination, SearchInput, Select } from '../components/ui'
import { qs } from '../lib/api'
import { useApi } from '../lib/useApi'
import { downloadCsv, num, pct, titleCase } from '../lib/format'

export default function Machines() {
  const [term, setTerm] = useState('')
  const [status, setStatus] = useState('')
  const [plant, setPlant] = useState('')
  const [drift, setDrift] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const [sort, setSort] = useState({ key: 'machine_id', dir: 'asc' })
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<any>(
    `/machines${qs({ q: term, status, plant, drift, page, size, sort: sort.key, dir: sort.dir })}`,
  )

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )

  const columns: Column<any>[] = [
    {
      key: 'name',
      header: 'Machine',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink">{row.name}</p>
          <p className="text-[11px] text-faint">{row.machine_id} · {titleCase(row.machine_type)}</p>
        </div>
      ),
    },
    { key: 'plant', header: 'Plant / line', render: (row) => <span className="text-muted">{row.plant} / {row.line}</span> },
    { key: 'status', header: 'Status', mobile: true, render: (row) => <Badge status={row.status} dot /> },
    { key: 'step_count', header: 'Steps', align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.step_count)}</span> },
    { key: 'scrap_rate', header: 'Scrap rate', mobile: true, align: 'right', sortable: true, render: (row) => <span className="tabular">{pct(row.scrap_rate)}</span> },
    { key: 'defect_rate', header: 'Defect rate', align: 'right', sortable: true, render: (row) => <span className="tabular">{pct(row.defect_rate)}</span> },
    {
      key: 'drift_weeks',
      header: 'Drift weeks',
      mobile: true,
      align: 'right',
      sortable: true,
      render: (row) =>
        row.drift_weeks ? <Badge tone={row.drift_weeks >= 2 ? 'danger' : 'warning'}>{row.drift_weeks}</Badge> : <span className="text-muted">0</span>,
    },
    {
      key: 'decision',
      header: 'Maintenance',
      render: (row) => <Badge tone={row.decision === 'MAINTENANCE_REVIEW' ? 'warning' : 'success'}>{row.decision.replace(/_/g, ' ')}</Badge>,
    },
    { key: 'action', header: '', width: '40px', render: () => <ChevronRight size={14} className="text-faint" /> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Machines & processes"
        subtitle="Assets, throughput and the machine-week drift signal computed from scrap rate against each machine's own baseline."
        meta={
          <>
            <Badge tone="neutral">{num(data?.summary?.total)} machines</Badge>
            <Badge tone="success">{num(data?.summary?.running)} running</Badge>
            <Badge tone={data?.summary?.drift ? 'warning' : 'neutral'}>{num(data?.summary?.drift)} in drift review</Badge>
          </>
        }
        actions={
          <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv('machines.csv', data?.rows ?? [])} disabled={!data?.rows?.length}>
            Export page
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-3 lg:flex-row lg:items-center">
          <SearchInput
            value={term}
            onChange={(value) => { setTerm(value); setPage(1) }}
            placeholder="Search machine, ID or plant"
            className="lg:max-w-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} aria-label="Status" className="w-[150px]">
              <option value="">All statuses</option>
              {['running', 'idle', 'maintenance', 'down'].map((option) => (
                <option key={option} value={option}>{titleCase(option)}</option>
              ))}
            </Select>
            <Select value={plant} onChange={(event) => { setPlant(event.target.value); setPage(1) }} aria-label="Plant" className="w-[140px]">
              <option value="">All plants</option>
              <option value="PLANT-01">PLANT-01</option>
              <option value="PLANT-02">PLANT-02</option>
              <option value="PLANT-03">PLANT-03</option>
            </Select>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-2.5 text-[12.5px] text-muted">
              <input type="checkbox" checked={drift} onChange={(event) => { setDrift(event.target.checked); setPage(1) }} className="h-3.5 w-3.5 rounded border-slate-300 text-accent" />
              Drift only
            </label>
            {(term || status || plant || drift) && (
              <Button variant="ghost" size="sm" onClick={() => { setTerm(''); setStatus(''); setPlant(''); setDrift(false); setPage(1) }}>Clear</Button>
            )}
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.machine_id}
          loading={loading}
          onRowClick={(row) => navigate(`/machines/${row.machine_id}`)}
          sort={sort}
          onSort={(key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })}
          emptyTitle="No machines match these filters"
        />

        {data && (
          <Pagination page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} onSize={(value) => { setSize(value); setPage(1) }} />
        )}
      </Card>

      <Card padded className="flex flex-wrap items-center gap-3 bg-slate-50/60">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-accent shadow-sm"><Gauge size={15} /></span>
        <p className="text-[12.5px] text-muted">
          Drift rule: an evaluable machine-week (≥ 200 units) is flagged when its scrap rate is at least 2× the machine's median
          weekly scrap rate and above 0.5%. Machines with two or more flagged weeks move to maintenance review.
        </p>
      </Card>
    </div>
  )
}
