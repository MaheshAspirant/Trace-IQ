import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Download } from 'lucide-react'
import { DataTable, type Column } from '../components/DataTable'
import { Badge, Button, Card, ErrorState, Input, PageHeader, Pagination, SearchInput, Select } from '../components/ui'
import { qs } from '../lib/api'
import { useApi } from '../lib/useApi'
import { dateShort, downloadCsv, num, pct, titleCase } from '../lib/format'

export default function Inspections() {
  const [term, setTerm] = useState('')
  const [type, setType] = useState('')
  const [result, setResult] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const [sort, setSort] = useState({ key: 'inspected_at', dir: 'desc' })
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<any>(
    `/inspections${qs({ q: term, type, result, from, to, page, size, sort: sort.key, dir: sort.dir })}`,
  )

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )

  const columns: Column<any>[] = [
    {
      key: 'inspection_id',
      header: 'Inspection',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink">{row.inspection_id}</p>
          <p className="text-[11px] text-faint">{dateShort(row.inspected_at)}</p>
        </div>
      ),
    },
    { key: 'inspection_type', header: 'Type', render: (row) => <span className="capitalize text-muted">{row.inspection_type.replace(/_/g, ' ')}</span> },
    { key: 'result', header: 'Result', mobile: true, render: (row) => <Badge status={row.result} dot /> },
    {
      key: 'order_id',
      header: 'Order / lot',
      render: (row) => (
        <div className="max-w-[180px]">
          <p className="truncate text-ink">{row.order_id ?? row.lot_id ?? '—'}</p>
          <p className="truncate text-[11px] text-faint">{row.product_name ?? row.supplier_name ?? '—'}</p>
        </div>
      ),
    },
    { key: 'inspected_qty', header: 'Inspected', mobile: true, align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.inspected_qty)}</span> },
    { key: 'defect_count', header: 'Defects', mobile: true, align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.defect_count)}</span> },
    {
      key: 'defect_rate',
      header: 'Rate',
      align: 'right',
      sortable: true,
      render: (row) => <span className="tabular">{pct(row.defect_rate)}</span>,
    },
    { key: 'step_name', header: 'Step', render: (row) => <span className="text-muted">{row.step_name ?? '—'}</span> },
    { key: 'machine_name', header: 'Machine', render: (row) => <span className="text-muted">{row.machine_name ?? '—'}</span> },
    { key: 'action', header: '', width: '40px', render: () => <ChevronRight size={14} className="text-faint" /> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inspections"
        subtitle="Incoming, in-process and final inspection records with measured quantity, defects found and the resulting disposition."
        meta={
          <>
            <Badge tone="neutral">{num(data?.summary?.total)} inspections</Badge>
            <Badge tone="danger">{num(data?.summary?.failed)} failed</Badge>
            <Badge tone="warning">{num(data?.summary?.conditional)} conditional</Badge>
            <Badge tone="success">{pct(data?.summary?.pass_rate, 1)} pass</Badge>
          </>
        }
        actions={
          <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv('inspections.csv', data?.rows ?? [])} disabled={!data?.rows?.length}>
            Export page
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-3 xl:flex-row xl:items-center">
          <SearchInput
            value={term}
            onChange={(value) => { setTerm(value); setPage(1) }}
            placeholder="Search inspection, order, lot or product"
            className="xl:max-w-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={type} onChange={(event) => { setType(event.target.value); setPage(1) }} aria-label="Inspection type" className="w-[155px]">
              <option value="">All types</option>
              {['incoming', 'in_process', 'final'].map((option) => (
                <option key={option} value={option}>{titleCase(option)}</option>
              ))}
            </Select>
            <Select value={result} onChange={(event) => { setResult(event.target.value); setPage(1) }} aria-label="Result" className="w-[150px]">
              <option value="">All results</option>
              {['pass', 'conditional', 'fail', 'pending'].map((option) => (
                <option key={option} value={option}>{titleCase(option)}</option>
              ))}
            </Select>
            <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} aria-label="From date" className="w-[150px]" />
            <Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} aria-label="To date" className="w-[150px]" />
            {(term || type || result || from || to) && (
              <Button variant="ghost" size="sm" onClick={() => { setTerm(''); setType(''); setResult(''); setFrom(''); setTo(''); setPage(1) }}>Clear</Button>
            )}
          </div>
          <span className="ml-auto hidden text-[11.5px] text-faint xl:block">{num(data?.total)} matching</span>
        </div>

        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.inspection_id}
          loading={loading}
          onRowClick={(row) => navigate(`/inspections/${row.inspection_id}`)}
          sort={sort}
          onSort={(key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })}
          emptyTitle="No inspections match these filters"
        />

        {data && (
          <Pagination page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} onSize={(value) => { setSize(value); setPage(1) }} />
        )}
      </Card>
    </div>
  )
}
