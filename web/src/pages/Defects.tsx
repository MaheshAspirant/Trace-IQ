import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Download } from 'lucide-react'
import { DataTable, type Column } from '../components/DataTable'
import { Badge, Button, Card, ErrorState, PageHeader, Pagination, SearchInput, Select } from '../components/ui'
import { qs } from '../lib/api'
import { useApi } from '../lib/useApi'
import { dateShort, downloadCsv, num, severityTone, titleCase, type Tone } from '../lib/format'

export default function Defects() {
  const [params] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [severity, setSeverity] = useState(params.get('severity') ?? '')
  const [category, setCategory] = useState(params.get('category') ?? '')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const [sort, setSort] = useState({ key: 'detected_at', dir: 'desc' })
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<any>(
    `/defects${qs({ q: term, severity, category, status, page, size, sort: sort.key, dir: sort.dir })}`,
  )

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )

  const columns: Column<any>[] = [
    {
      key: 'defect_name',
      header: 'Defect',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink">{row.defect_name}</p>
          <p className="text-[11px] text-faint">{row.defect_id} · {row.defect_code}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', render: (row) => <span className="capitalize text-muted">{row.category}</span> },
    { key: 'severity', header: 'Severity', mobile: true, render: (row) => <Badge tone={severityTone(row.severity)} dot>{row.severity}</Badge> },
    { key: 'qty', header: 'Qty', align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.qty)}</span> },
    {
      key: 'product_name',
      header: 'Product / supplier',
      render: (row) => (
        <div className="max-w-[190px]">
          <p className="truncate text-ink">{row.product_name ?? '—'}</p>
          <p className="truncate text-[11px] text-faint">{row.supplier_name ?? 'no supplier attribution'}</p>
        </div>
      ),
    },
    { key: 'machine_name', header: 'Machine', render: (row) => <span className="text-muted">{row.machine_name ?? '—'}</span> },
    { key: 'detected_at', header: 'Detected', mobile: true, sortable: true, render: (row) => <span className="text-muted">{dateShort(row.detected_at)}</span> },
    { key: 'status', header: 'Status', mobile: true, render: (row) => <Badge status={row.status} dot /> },
    {
      key: 'capa_id',
      header: 'CAPA',
      render: (row) =>
        row.capa_id ? (
          <Badge tone="info">{row.capa_id.replace('CAPA-2026-', '#')}</Badge>
        ) : (
          <span className="text-[11.5px] text-faint">none</span>
        ),
    },
    { key: 'action', header: '', width: '40px', render: () => <ChevronRight size={14} className="text-faint" /> },
  ]

  const summary = data?.summary
  const chips: Array<{ label: string; value: string; tone: Tone }> = [
    { label: 'Defects in view', value: num(summary?.total), tone: 'neutral' },
    { label: 'Critical', value: num(summary?.critical), tone: 'danger' },
    { label: 'Open', value: num(summary?.open), tone: 'warning' },
    { label: 'Units affected', value: num(summary?.qty), tone: 'neutral' },
    { label: 'CAPA linked', value: num(summary?.capa_linked), tone: 'info' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Defect management"
        subtitle="Register of quality events with the implicated product, lot, order and machine — each links to its decision and corrective action."
        meta={chips.map((chip) => (
          <Badge key={chip.label} tone={chip.tone}>
            {chip.label}: {chip.value}
          </Badge>
        ))}
        actions={
          <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv('defects.csv', data?.rows ?? [])} disabled={!data?.rows?.length}>
            Export page
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-3 xl:flex-row xl:items-center">
          <SearchInput
            value={term}
            onChange={(value) => { setTerm(value); setPage(1) }}
            placeholder="Search defect, order or lot"
            className="xl:max-w-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Select value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1) }} aria-label="Severity" className="w-[140px]">
              <option value="">All severity</option>
              {['critical', 'major', 'minor'].map((option) => (
                <option key={option} value={option}>{titleCase(option)}</option>
              ))}
            </Select>
            <Select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }} aria-label="Category" className="w-[160px]">
              <option value="">All categories</option>
              {['dimensional', 'material', 'assembly', 'functional', 'cosmetic', 'documentation'].map((option) => (
                <option key={option} value={option}>{titleCase(option)}</option>
              ))}
            </Select>
            <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} aria-label="Status" className="w-[140px]">
              <option value="">All statuses</option>
              {['open', 'contained', 'rework', 'scrap', 'closed'].map((option) => (
                <option key={option} value={option}>{titleCase(option)}</option>
              ))}
            </Select>
            {(term || severity || category || status) && (
              <Button variant="ghost" size="sm" onClick={() => { setTerm(''); setSeverity(''); setCategory(''); setStatus(''); setPage(1) }}>Clear</Button>
            )}
          </div>
          <span className="ml-auto hidden text-[11.5px] text-faint xl:block">
            {num(data?.total)} matching · {num(summary?.qty)} units affected
          </span>
        </div>

        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.defect_id}
          loading={loading}
          onRowClick={(row) => navigate(`/defects/${row.defect_id}`)}
          sort={sort}
          onSort={(key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })}
          emptyTitle="No defects match these filters"
        />

        {data && (
          <Pagination page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} onSize={(value) => { setSize(value); setPage(1) }} />
        )}
      </Card>
    </div>
  )
}
