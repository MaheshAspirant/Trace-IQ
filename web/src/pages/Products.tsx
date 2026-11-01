import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Download, Package } from 'lucide-react'
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
  cx,
} from '../components/ui'
import { qs } from '../lib/api'
import { useApi } from '../lib/useApi'
import { downloadCsv, num, pct, titleCase } from '../lib/format'

export default function Products() {
  const [term, setTerm] = useState('')
  const [family, setFamily] = useState('')
  const [lifecycle, setLifecycle] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const [sort, setSort] = useState({ key: 'product_id', dir: 'asc' })
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<any>(
    `/products${qs({ q: term, family, lifecycle, page, size, sort: sort.key, dir: sort.dir })}`,
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
      header: 'Product',
      sortable: true,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.name}</p>
          <p className="text-[11px] text-faint">
            {row.product_id} · rev {row.revision}
          </p>
        </div>
      ),
    },
    { key: 'family', header: 'Family', mobile: true, sortable: true, render: (row) => <span className="text-muted">{row.family}</span> },
    { key: 'product_type', header: 'Type', render: (row) => <span className="capitalize text-muted">{titleCase(row.product_type)}</span> },
    { key: 'lifecycle_state', header: 'Lifecycle', mobile: true, render: (row) => <Badge status={row.lifecycle_state} dot /> },
    { key: 'bom_lines', header: 'BOM', align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.bom_lines)}</span> },
    { key: 'orders', header: 'Orders', align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.orders)}</span> },
    { key: 'produced_qty', header: 'Produced', align: 'right', sortable: true, render: (row) => <span className="tabular">{num(row.produced_qty)}</span> },
    {
      key: 'defect_rate',
      header: 'Defect rate',
      mobile: true,
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={cx('tabular', row.defect_rate > 0.01 ? 'font-medium text-danger' : 'text-ink')}>
          {pct(row.defect_rate)}
        </span>
      ),
    },
    { key: 'scrap_rate', header: 'Scrap rate', align: 'right', sortable: true, render: (row) => <span className="tabular text-muted">{pct(row.scrap_rate)}</span> },
    { key: 'action', header: '', width: '40px', render: () => <ChevronRight size={14} className="text-faint" /> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products & BOM"
        subtitle="Master data, bill-of-material composition and the quality performance of every finished good and component."
        meta={
          <>
            <Badge tone="neutral">{num(data?.total)} products</Badge>
            <Badge tone="neutral">{(data?.facets ?? []).length} families</Badge>
          </>
        }
        actions={
          <Button
            size="sm"
            icon={<Download size={14} />}
            onClick={() => downloadCsv('products.csv', data?.rows ?? [])}
            disabled={!data?.rows?.length}
          >
            Export page
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center">
          <SearchInput
            value={term}
            onChange={(value) => {
              setTerm(value)
              setPage(1)
            }}
            placeholder="Search SKU or product name"
            className="sm:max-w-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Select
              value={family}
              onChange={(event) => {
                setFamily(event.target.value)
                setPage(1)
              }}
              aria-label="Filter by family"
              className="w-[170px]"
            >
              <option value="">All families</option>
              {(data?.facets ?? []).map((facet: any) => (
                <option key={facet.value} value={facet.value}>
                  {facet.value}
                </option>
              ))}
            </Select>
            <Select
              value={lifecycle}
              onChange={(event) => {
                setLifecycle(event.target.value)
                setPage(1)
              }}
              aria-label="Filter by lifecycle"
              className="w-[150px]"
            >
              <option value="">All lifecycle</option>
              <option value="active">Active</option>
              <option value="phase_out">Phase out</option>
              <option value="obsolete">Obsolete</option>
            </Select>
            {(term || family || lifecycle) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTerm('')
                  setFamily('')
                  setLifecycle('')
                  setPage(1)
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <span className="ml-auto hidden text-[11.5px] text-faint sm:block">
            {num(data?.total)} matching
          </span>
        </div>

        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.product_id}
          loading={loading}
          onRowClick={(row) => navigate(`/products/${row.product_id}`)}
          sort={sort}
          onSort={(key) =>
            setSort((current) =>
              current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
            )
          }
          emptyTitle="No products match these filters"
        />

        {data && (
          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            size={data.size}
            onPage={setPage}
            onSize={(value) => {
              setSize(value)
              setPage(1)
            }}
          />
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {(data?.facets ?? []).slice(0, 6).map((facet: any) => (
          <Card key={facet.value} padded className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Package size={15} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium text-ink">{facet.value}</p>
              <p className="text-[11.5px] text-muted">{num(facet.count)} SKUs</p>
            </div>
            <button
              onClick={() => {
                setFamily(facet.value)
                setPage(1)
              }}
              className="ml-auto text-[11.5px] font-medium text-accent hover:underline"
            >
              View
            </button>
          </Card>
        ))}
      </div>
    </div>
  )
}
