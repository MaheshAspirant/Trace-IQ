import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, GitBranch } from 'lucide-react'
import { Badge, Button, Card, ErrorState, KeyValue, KpiCard, PageHeader, Progress, Section, TableSkeleton } from '../components/ui'
import { useApi } from '../lib/useApi'
import { dateShort, dateTime, downloadCsv, num, pct } from '../lib/format'

export default function OrderDetail() {
  const { id = '' } = useParams()
  const { data, loading, error, reload } = useApi<any>(`/orders/${encodeURIComponent(id)}`)

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-80 skeleton" />
        <Card><TableSkeleton rows={6} columns={4} /></Card>
      </div>
    )
  }

  const order = data.order
  const steps = data.steps ?? []
  const consumptions = data.consumptions ?? []
  const inspections = data.inspections ?? []
  const defects = data.defects ?? []
  const capas = data.capas ?? []
  const events = data.events ?? []

  return (
    <div className="space-y-4">
      <Link to="/orders" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={13} /> Production orders
      </Link>

      <PageHeader
        title={order.order_id}
        subtitle={`${order.product_name} · ${order.plant} / ${order.line} · planner ${order.planner_code}`}
        meta={
          <>
            <Badge status={order.status} dot />
            <Badge tone={order.priority === 'expedite' ? 'warning' : 'neutral'}>{order.priority}</Badge>
            {order.rework_of_order_id && (
              <Badge tone="info">Rework of {order.rework_of_order_id}</Badge>
            )}
            <Badge tone="neutral">Started {dateShort(order.actual_start)}</Badge>
          </>
        }
        actions={
          <>
            {defects.length > 0 && (
              <Link to={`/defects/${defects[0].defect_id}`}>
                <Button size="sm" icon={<GitBranch size={14} />}>Investigate defect</Button>
              </Link>
            )}
            <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv(`${order.order_id}-consumption.csv`, consumptions)} disabled={!consumptions.length}>
              Export material
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Planned" value={num(order.planned_qty)} sub={`${order.product_id}`} />
        <KpiCard label="Actual" value={num(order.actual_qty)} sub={pct(order.progress, 1) + ' complete'} />
        <KpiCard label="Good" value={num(order.good_qty)} sub="Conforming output" />
        <KpiCard label="Scrap" value={num(order.scrap_qty)} sub={pct(order.scrap_rate) + ' of actual'} tone={order.scrap_qty ? 'warning' : 'neutral'} />
        <KpiCard
          label="Defect rate"
          value={pct(order.defect_rate)}
          sub={`${num(order.defect_qty)} of ${num(order.inspected_qty)} inspected`}
          tone={order.defect_rate > 0.01 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Order progress" description="Planned versus actual output and routing completion.">
          <div className="flex items-end justify-between">
            <div>
              <p className="label">Quantity completion</p>
              <p className="text-[24px] font-semibold text-ink tabular">{pct(order.progress, 1)}</p>
            </div>
            <div className="text-right text-[12px] text-muted">
              <p className="tabular">{num(order.actual_qty)} / {num(order.planned_qty)}</p>
              <p>{steps.filter((step: any) => step.status === 'completed').length} of {steps.length} steps done</p>
            </div>
          </div>
          <Progress value={order.progress} tone={order.status === 'completed' ? 'success' : 'accent'} className="mt-3 h-2" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 p-2.5">
              <p className="label">Planned window</p>
              <p className="mt-0.5 text-[12px] text-ink">{dateShort(order.planned_start)} → {dateShort(order.planned_end)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2.5">
              <p className="label">Actual window</p>
              <p className="mt-0.5 text-[12px] text-ink">{dateShort(order.actual_start)} → {dateShort(order.actual_end)}</p>
            </div>
          </div>
        </Section>

        <Section className="xl:col-span-2" title="Order master" description="Product, scheduling and rework linkage.">
          <KeyValue
            columns={3}
            items={[
              { label: 'Order', value: order.order_id },
              { label: 'Product', value: <Link className="text-accent hover:underline" to={`/products/${order.product_id}`}>{order.product_name}</Link> },
              { label: 'Family', value: order.family },
              { label: 'Plant / line', value: `${order.plant} / ${order.line}` },
              { label: 'Status', value: order.status },
              { label: 'Priority', value: order.priority },
              { label: 'Planned start', value: dateShort(order.planned_start) },
              { label: 'Planned end', value: dateShort(order.planned_end) },
              { label: 'Actual start', value: dateShort(order.actual_start) },
              { label: 'Actual end', value: dateShort(order.actual_end) },
              { label: 'Rework of', value: order.rework_of_order_id ?? '—' },
              { label: 'Created', value: dateShort(order.created_at) },
            ]}
          />
        </Section>
      </div>

      <Section title="Process routing" description="Steps executed on the shop floor with machine assignment and scrap." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">#</th>
                <th className="px-4 py-2 font-semibold">Step</th>
                <th className="px-4 py-2 font-semibold">Machine</th>
                <th className="px-4 py-2 font-semibold">Started</th>
                <th className="px-4 py-2 text-right font-semibold">Input</th>
                <th className="px-4 py-2 text-right font-semibold">Output</th>
                <th className="px-4 py-2 text-right font-semibold">Scrap</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step: any) => (
                <tr key={step.step_id} className="border-t border-line/70">
                  <td className="px-4 py-2 text-muted tabular">{step.sequence_no}</td>
                  <td className="px-4 py-2">
                    <p className="font-medium text-ink">{step.step_name}</p>
                    <p className="text-[11px] text-faint">{step.step_id} · {step.operator_code}</p>
                  </td>
                  <td className="px-4 py-2">
                    <Link to={`/machines/${step.machine_id}`} className="text-accent hover:underline">{step.machine_name}</Link>
                    <p className="text-[11px] text-faint">{step.machine_type}</p>
                  </td>
                  <td className="px-4 py-2 text-muted">{dateTime(step.started_at)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(step.input_qty)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(step.output_qty)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(step.scrap_qty)}</td>
                  <td className="px-4 py-2"><Badge status={step.status} dot /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Material consumption" description="Lots issued to this order, newest first." bodyClassName="p-0">
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead className="sticky top-0 bg-slate-50 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Component</th>
                  <th className="px-4 py-2 font-semibold">Lot / supplier</th>
                  <th className="px-4 py-2 text-right font-semibold">Qty</th>
                  <th className="px-4 py-2 font-semibold">Issued</th>
                </tr>
              </thead>
              <tbody>
                {consumptions.map((row: any) => (
                  <tr key={row.consumption_id} className="border-t border-line/70">
                    <td className="px-4 py-2">
                      <p className="font-medium text-ink">{row.component_name}</p>
                      <p className="text-[11px] text-faint">{row.bom_id}</p>
                    </td>
                    <td className="px-4 py-2">
                      <Link to={`/lots/${row.lot_id}`} className="text-accent hover:underline">{row.lot_id}</Link>
                      <p className="text-[11px] text-faint">{row.supplier_name}</p>
                    </td>
                    <td className="px-4 py-2 text-right tabular">{num(row.qty_consumed, 2)}</td>
                    <td className="px-4 py-2 text-muted">{dateShort(row.consumed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Inspections & defects" description="Quality records raised against this order." bodyClassName="p-0">
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full min-w-[480px] text-left text-[12.5px]">
              <thead className="sticky top-0 bg-slate-50 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Record</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Result / severity</th>
                  <th className="px-4 py-2 text-right font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody>
                {inspections.map((row: any) => (
                  <tr key={row.inspection_id} className="border-t border-line/70">
                    <td className="px-4 py-2">
                      <Link to={`/inspections/${row.inspection_id}`} className="text-accent hover:underline">{row.inspection_id}</Link>
                      <p className="text-[11px] text-faint">{dateShort(row.inspected_at)}</p>
                    </td>
                    <td className="px-4 py-2 capitalize text-muted">{row.inspection_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2"><Badge status={row.result} dot /></td>
                    <td className="px-4 py-2 text-right tabular">{num(row.inspected_qty)}</td>
                  </tr>
                ))}
                {defects.map((row: any) => (
                  <tr key={row.defect_id} className="border-t border-line/70 bg-danger-soft/20">
                    <td className="px-4 py-2">
                      <Link to={`/defects/${row.defect_id}`} className="text-accent hover:underline">{row.defect_name}</Link>
                      <p className="text-[11px] text-faint">{row.defect_id}</p>
                    </td>
                    <td className="px-4 py-2 capitalize text-muted">defect</td>
                    <td className="px-4 py-2"><Badge tone={row.severity === 'critical' ? 'danger' : row.severity === 'major' ? 'warning' : 'neutral'}>{row.severity}</Badge></td>
                    <td className="px-4 py-2 text-right tabular">{num(row.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Corrective actions" description="CAPAs opened from defects on this order." bodyClassName="p-0">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">CAPA</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Due</th>
                <th className="px-4 py-2 font-semibold">Gate</th>
              </tr>
            </thead>
            <tbody>
              {capas.map((capa: any) => (
                <tr key={capa.capa_id} className="border-t border-line/70">
                  <td className="px-4 py-2">
                    <Link to={`/capa/${capa.capa_id}`} className="text-accent hover:underline">{capa.capa_id}</Link>
                  </td>
                  <td className="px-4 py-2"><Badge status={capa.status} dot /></td>
                  <td className="px-4 py-2 text-muted">{dateShort(capa.due_at)}</td>
                  <td className="px-4 py-2">
                    {capa.status === 'closed' && !capa.closure_allowed ? <Badge tone="danger">Violation</Badge> : <span className="text-[11.5px] text-muted">—</span>}
                  </td>
                </tr>
              ))}
              {!capas.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-[12px] text-muted">No CAPAs for this order.</td></tr>}
            </tbody>
          </table>
        </Section>

        <Section title="Order event history" description="State transitions recorded for this order." bodyClassName="px-4 py-3">
          <ol className="max-h-[260px] space-y-3 overflow-auto pr-1">
            {events.map((event: any) => (
              <li key={event.event_id} className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent/70" />
                <div>
                  <p className="text-[12.5px] font-medium text-ink">
                    {event.event_type.replace(/_/g, ' ')}
                    <span className="text-muted"> · {event.from_state ?? '—'} → {event.to_state}</span>
                  </p>
                  <p className="text-[11.5px] text-muted">{dateTime(event.occurred_at)} · {event.actor_code}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  )
}
