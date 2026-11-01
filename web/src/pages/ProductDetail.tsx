import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, ExternalLink } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  ErrorState,
  KpiCard,
  KeyValue,
  PageHeader,
  Section,
  TableSkeleton,
} from '../components/ui'
import { useApi } from '../lib/useApi'
import { dateShort, downloadCsv, num, pct, severityTone, titleCase } from '../lib/format'

export default function ProductDetail() {
  const { id = '' } = useParams()
  const { data, loading, error, reload } = useApi<any>(`/products/${encodeURIComponent(id)}`)

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-72 skeleton" />
        <Card><TableSkeleton rows={6} columns={4} /></Card>
      </div>
    )
  }

  const product = data.product
  const bom = data.bom ?? []
  const orders = data.orders ?? []
  const codes = data.defect_codes ?? []
  const plans = data.plans ?? []

  return (
    <div className="space-y-4">
      <Link to="/products" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={13} /> Products &amp; BOM
      </Link>

      <PageHeader
        title={product.name}
        subtitle={`${product.product_id} · ${product.family} · effective from ${dateShort(product.effective_from)}`}
        meta={
          <>
            <Badge status={product.lifecycle_state} dot />
            <Badge tone="neutral">{titleCase(product.product_type)}</Badge>
            <Badge tone="neutral">Revision {product.revision}</Badge>
            {product.rework_allowed ? <Badge tone="info">Rework allowed</Badge> : <Badge tone="warning">No rework</Badge>}
          </>
        }
        actions={
          <>
            <Link to={`/orders?q=${encodeURIComponent(product.product_id)}`}>
              <Button size="sm" icon={<ExternalLink size={14} />}>View orders</Button>
            </Link>
            <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv(`${product.product_id}-bom.csv`, bom)} disabled={!bom.length}>
              Export BOM
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Production orders" value={num(product.orders)} sub={`${num(product.rework_orders)} rework orders`} />
        <KpiCard label="Produced" value={num(product.produced_qty)} sub={`${num(product.good_qty)} good units`} />
        <KpiCard label="Scrap rate" value={pct(product.scrap_rate)} sub={`${num(product.scrap_qty)} scrapped`} tone={product.scrap_rate > 0.02 ? 'warning' : 'neutral'} />
        <KpiCard
          label="Defect rate"
          value={pct(product.defect_rate)}
          sub={`${num(product.defect_qty)} of ${num(product.inspected_qty)} inspected`}
          tone={product.defect_rate > 0.01 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section
          className="xl:col-span-2"
          title="Bill of materials"
          description="Component requirement per finished unit, including scrap allowance."
          action={<Badge tone="neutral">{bom.length} lines</Badge>}
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[12.5px]">
              <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Component</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 text-right font-semibold">Qty / unit</th>
                  <th className="px-4 py-2 text-right font-semibold">Scrap %</th>
                  <th className="px-4 py-2 text-right font-semibold">Suppliers</th>
                  <th className="px-4 py-2 text-right font-semibold">Lots</th>
                </tr>
              </thead>
              <tbody>
                {bom.map((line: any) => (
                  <tr key={line.bom_id} className="border-t border-line/70 hover:bg-slate-50/70">
                    <td className="px-4 py-2">
                      <Link to={`/products/${line.component_product_id}`} className="font-medium text-accent hover:underline">
                        {line.component_name}
                      </Link>
                      <p className="text-[11px] text-faint">{line.component_product_id}</p>
                    </td>
                    <td className="px-4 py-2 capitalize text-muted">{titleCase(line.product_type)}</td>
                    <td className="px-4 py-2 text-right tabular">
                      {num(line.qty_per_unit, 3)} {line.uom}
                    </td>
                    <td className="px-4 py-2 text-right tabular text-muted">{num(line.scrap_pct, 2)}%</td>
                    <td className="px-4 py-2 text-right tabular">{num(line.suppliers)}</td>
                    <td className="px-4 py-2 text-right tabular text-muted">{num(line.lots)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Product master" description="Lifecycle and planning attributes.">
          <KeyValue
            columns={2}
            items={[
              { label: 'SKU', value: product.product_id },
              { label: 'Family', value: product.family },
              { label: 'Type', value: titleCase(product.product_type) },
              { label: 'Unit of measure', value: product.uom },
              { label: 'Revision', value: product.revision },
              { label: 'Lifecycle', value: titleCase(product.lifecycle_state) },
              { label: 'Rework allowed', value: product.rework_allowed ? 'Yes' : 'No' },
              { label: 'Scrap tolerance', value: `${num(product.scrap_tolerance_pct, 1)}%` },
              { label: 'Effective from', value: dateShort(product.effective_from) },
              { label: 'Effective to', value: product.effective_to ? dateShort(product.effective_to) : 'Open' },
              { label: 'Created', value: dateShort(product.created_at) },
              { label: 'Failed inspections', value: num(product.failed_inspections) },
            ]}
          />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Most frequent defects" description="Defect quantity attributed to this product or its material lots." bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[12.5px]">
              <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Defect</th>
                  <th className="px-4 py-2 font-semibold">Severity</th>
                  <th className="px-4 py-2 text-right font-semibold">Events</th>
                  <th className="px-4 py-2 text-right font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code: any) => (
                  <tr key={code.defect_code} className="border-t border-line/70">
                    <td className="px-4 py-2">
                      <p className="font-medium text-ink">{code.defect_name}</p>
                      <p className="text-[11px] text-faint">{code.defect_code} · {code.category}</p>
                    </td>
                    <td className="px-4 py-2"><Badge tone={severityTone(code.severity)}>{code.severity}</Badge></td>
                    <td className="px-4 py-2 text-right tabular">{num(code.events)}</td>
                    <td className="px-4 py-2 text-right tabular">{num(code.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Inspection plans" description="Sampling and acceptance criteria by inspection type." bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[12.5px]">
              <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 text-right font-semibold">Sample</th>
                  <th className="px-4 py-2 text-right font-semibold">AQL</th>
                  <th className="px-4 py-2 text-right font-semibold">Accept / reject</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan: any) => (
                  <tr key={plan.plan_id} className="border-t border-line/70">
                    <td className="px-4 py-2">
                      <p className="font-medium capitalize text-ink">{plan.inspection_type.replace(/_/g, ' ')}</p>
                      <p className="text-[11px] text-faint">{plan.plan_id} · {plan.criteria}</p>
                    </td>
                    <td className="px-4 py-2 text-right tabular">{num(plan.sample_size)}</td>
                    <td className="px-4 py-2 text-right tabular">{plan.aql_level}</td>
                    <td className="px-4 py-2 text-right tabular">{plan.acceptance_qty} / {plan.rejection_qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section title="Recent orders" description="Latest work orders producing this SKU." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Order</th>
                <th className="px-4 py-2 font-semibold">Plant / line</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">Planned</th>
                <th className="px-4 py-2 text-right font-semibold">Actual</th>
                <th className="px-4 py-2 text-right font-semibold">Scrap</th>
                <th className="px-4 py-2 font-semibold">Started</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => (
                <tr key={order.order_id} className="border-t border-line/70 hover:bg-slate-50/70">
                  <td className="px-4 py-2">
                    <Link to={`/orders/${order.order_id}`} className="font-medium text-accent hover:underline">{order.order_id}</Link>
                  </td>
                  <td className="px-4 py-2 text-muted">{order.plant} / {order.line}</td>
                  <td className="px-4 py-2"><Badge status={order.status} dot /></td>
                  <td className="px-4 py-2 text-right tabular">{num(order.planned_qty)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(order.actual_qty)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(order.scrap_qty)}</td>
                  <td className="px-4 py-2 text-muted">{dateShort(order.actual_start)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
