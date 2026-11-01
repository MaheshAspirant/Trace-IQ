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
import { dateShort, downloadCsv, num } from '../lib/format'

export default function Lots() {
  const [params] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const [sort, setSort] = useState({ key: 'received_date', dir: 'desc' })
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<any>(
    `/lots${qs({ q: term, status, page, size, sort: sort.key, dir: sort.dir })}`,
  )

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )

  const columns: Column<any>[] = [
    {
      key: 'lot_id',
      header: 'Material lot',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink">{row.lot_id}</p>
          <p className="text-[11px] text-faint">{row.consumption_count} consumption records</p>
        </div>
      ),
    },
    {
      key: 'material_name',
      header: 'Material',
      render: (row) => (
        <div>
          <p className="text-ink">{row.material_name}</p>
          <p className="text-[11px] text-faint">{row.material_product_id}</p>
        </div>
      ),
    },
    {
      key: 'supplier_name',
      header: 'Supplier',
      render: (row) => (
        <div>
          <p className="text-ink">{row.supplier_name}</p>
          <p className="text-[11px] text-faint">{row.supplier_id}</p>
        </div>
      ),
    },
    { key: 'received_date', header: 'Received', mobile: true, sortable: true, render: (row) => <span className="text-muted">{dateShort(row.received_date)}</span> },
    { key: 'expiry_date', header: 'Expiry', mobile: true, render: (row) => <span className={row.status === 'expired' ? 'text-danger' : 'text-muted'}>{dateShort(row.expiry_date)}</span> },
    {
      key: 'remaining_qty',
      header: 'Balance',
      mobile: true,
      align: 'right',
      sortable: true,
      render: (row) => (
        <div className="ml-auto w-[120px]">
          <p className="text-[11.5px] tabular">
            {num(row.remaining_qty)} / {num(row.received_qty)} {row.uom}
          </p>
          <Progress
            value={row.received_qty ? row.remaining_qty / row.received_qty : 0}
            tone={row.status === 'expired' ? 'danger' : row.remaining_qty === 0 ? 'success' : 'accent'}
            className="mt-1"
          />
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <Badge status={row.status} dot /> },
    { key: 'coa_pass', header: 'COA', align: 'center', render: (row) => <Badge tone={row.coa_pass ? 'success' : 'danger'}>{row.coa_pass ? 'Pass' : 'Fail'}</Badge> },
    { key: 'action', header: '', width: '40px', render: () => <ChevronRight size={14} className="text-faint" /> },
  ]

  const summary = data?.summary

  return (
    <div className="space-y-4">
      <PageHeader
        title="Material lots"
        subtitle="Supplier batches with received, consumed and remaining quantity. Balance and status are recomputed from consumption records, never edited directly."
        meta={
          <>
            <Badge tone="neutral">{num(data?.total)} lots</Badge>
            <Badge tone="neutral">{num(summary?.remaining_qty, 0)} units remaining</Badge>
          </>
        }
        actions={
          <Button
            size="sm"
            icon={<Download size={14} />}
            onClick={() => downloadCsv('material-lots.csv', data?.rows ?? [])}
            disabled={!data?.rows?.length}
          >
            Export page
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Lots in view', value: num(summary?.total), tone: 'neutral' },
          { label: 'Fully consumed', value: num(summary?.consumed), tone: 'success' },
          { label: 'Rejected', value: num(summary?.rejected), tone: 'danger' },
          { label: 'Expired', value: num(summary?.expired), tone: 'warning' },
        ].map((item) => (
          <Card key={item.label} padded>
            <p className="label">{item.label}</p>
            <p className="mt-1 text-[18px] font-semibold text-ink tabular">{item.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center">
          <SearchInput
            value={term}
            onChange={(value) => { setTerm(value); setPage(1) }}
            placeholder="Search lot, supplier or material"
            className="sm:max-w-xs"
          />
          <Select
            value={status}
            onChange={(event) => { setStatus(event.target.value); setPage(1) }}
            aria-label="Lot status"
            className="w-[190px]"
          >
            <option value="">All statuses</option>
            {(data?.facets ?? []).map((facet: any) => (
              <option key={facet.value} value={facet.value}>
                {facet.value.replace(/_/g, ' ')} ({facet.count})
              </option>
            ))}
          </Select>
          {(term || status) && (
            <Button variant="ghost" size="sm" onClick={() => { setTerm(''); setStatus(''); setPage(1) }}>
              Clear
            </Button>
          )}
          <span className="ml-auto hidden text-[11.5px] text-faint sm:block">{num(data?.total)} matching</span>
        </div>

        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.lot_id}
          loading={loading}
          onRowClick={(row) => navigate(`/lots/${row.lot_id}`)}
          sort={sort}
          onSort={(key) => setSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })}
          emptyTitle="No lots match these filters"
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
