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
  SearchInput,
  Select,
} from '../components/ui'
import { qs } from '../lib/api'
import { useApi } from '../lib/useApi'
import { downloadCsv, num, pct, type Tone } from '../lib/format'

const DECISION_TONE: Record<string, Tone> = {
  BLOCK_AND_AUDIT: 'danger',
  ESCALATE_8D: 'warning',
  CONDITIONAL_MONITOR: 'info',
  MONITOR: 'success',
}

export default function Suppliers() {
  const [params] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [risk, setRisk] = useState('')
  const [qualification, setQualification] = useState('')
  const [decision, setDecision] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const [sort, setSort] = useState({ key: 'supplier_id', dir: 'asc' })
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<any>(
    `/suppliers${qs({ q: term, risk, qualification, decision, page, size, sort: sort.key, dir: sort.dir })}`,
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
      header: 'Supplier',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink">{row.name}</p>
          <p className="text-[11px] text-faint">
            {row.supplier_id} · {row.country} · {row.supplier_type.replace(/_/g, ' ')}
          </p>
        </div>
      ),
    },
    { key: 'risk_tier', header: 'Risk', mobile: true, align: 'center', render: (row) => <Badge tone={row.risk_tier === 'C' ? 'danger' : row.risk_tier === 'B' ? 'warning' : 'success'}>Tier {row.risk_tier}</Badge> },
    { key: 'qualification_state', header: 'Qualification', mobile: true, render: (row) => <Badge status={row.qualification_state} dot /> },
    { key: 'lots_received', header: 'Lots', align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.lots_received)}</span> },
    {
      key: 'incoming_defect_rate',
      header: 'Incoming rate',
      align: 'right',
      sortable: true,
      render: (row) => <span className="tabular">{pct(row.incoming_defect_rate)}</span>,
    },
    { key: 'attributed_defect_qty', header: 'Attributed qty', align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.attributed_defect_qty)}</span> },
    { key: 'lots_rejected', header: 'Rejected', align: 'right', render: (row) => <span className="tabular text-muted">{num(row.lots_rejected)}</span> },
    { key: 'decision', header: 'Decision', mobile: true, render: (row) => <Badge tone={DECISION_TONE[row.decision] ?? 'neutral'}>{row.decision.replace(/_/g, ' ')}</Badge> },
    { key: 'action', header: '', width: '40px', render: () => <ChevronRight size={14} className="text-faint" /> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Suppliers"
        subtitle="Supplier directory with incoming quality, attributed defects and the escalation decision computed from persisted records."
        meta={
          <>
            <Badge tone="neutral">{num(data?.total)} suppliers</Badge>
            <span className="text-[11.5px] text-faint">
              Decisions: block & audit, escalate 8D, conditional monitor, monitor
            </span>
          </>
        }
        actions={
          <Button
            size="sm"
            icon={<Download size={14} />}
            onClick={() => downloadCsv('suppliers.csv', data?.rows ?? [])}
            disabled={!data?.rows?.length}
          >
            Export page
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-3 lg:flex-row lg:items-center">
          <SearchInput
            value={term}
            onChange={(value) => {
              setTerm(value)
              setPage(1)
            }}
            placeholder="Search supplier name, ID or country"
            className="lg:max-w-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Select value={risk} onChange={(event) => { setRisk(event.target.value); setPage(1) }} aria-label="Risk tier" className="w-[130px]">
              <option value="">All risk</option>
              <option value="A">Tier A</option>
              <option value="B">Tier B</option>
              <option value="C">Tier C</option>
            </Select>
            <Select value={qualification} onChange={(event) => { setQualification(event.target.value); setPage(1) }} aria-label="Qualification" className="w-[160px]">
              <option value="">All qualification</option>
              <option value="approved">Approved</option>
              <option value="conditional">Conditional</option>
              <option value="blocked">Blocked</option>
            </Select>
            <Select value={decision} onChange={(event) => { setDecision(event.target.value); setPage(1) }} aria-label="Decision" className="w-[175px]">
              <option value="">All decisions</option>
              <option value="BLOCK_AND_AUDIT">Block &amp; audit</option>
              <option value="ESCALATE_8D">Escalate 8D</option>
              <option value="CONDITIONAL_MONITOR">Conditional monitor</option>
              <option value="MONITOR">Monitor</option>
            </Select>
            {(term || risk || qualification || decision) && (
              <Button variant="ghost" size="sm" onClick={() => { setTerm(''); setRisk(''); setQualification(''); setDecision(''); setPage(1) }}>
                Clear
              </Button>
            )}
          </div>
          <span className="ml-auto hidden text-[11.5px] text-faint lg:block">{num(data?.total)} matching</span>
        </div>

        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.supplier_id}
          loading={loading}
          onRowClick={(row) => navigate(`/suppliers/${row.supplier_id}`)}
          sort={sort}
          onSort={(key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })}
          emptyTitle="No suppliers match these filters"
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(['BLOCK_AND_AUDIT', 'ESCALATE_8D', 'CONDITIONAL_MONITOR', 'MONITOR'] as const).map((key) => {
          const count = (data?.rows ?? []).filter((row: any) => row.decision === key).length
          return (
            <Card key={key} padded className="flex items-center justify-between">
              <div>
                <p className="label">{key.replace(/_/g, ' ')}</p>
                <p className="mt-1 text-[18px] font-semibold text-ink tabular">{count}</p>
                <p className="text-[11px] text-faint">on this page</p>
              </div>
              <Badge tone={DECISION_TONE[key]} dot />
            </Card>
          )
        })}
      </div>
    </div>
  )
}
