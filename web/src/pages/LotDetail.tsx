import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Boxes, Download } from 'lucide-react'
import { Badge, Button, Card, ErrorState, KeyValue, KpiCard, PageHeader, Progress, Section, TableSkeleton } from '../components/ui'
import { useApi } from '../lib/useApi'
import { dateShort, dateTime, downloadCsv, num, pct, titleCase } from '../lib/format'

export default function LotDetail() {
  const { id = '' } = useParams()
  const { data, loading, error, reload } = useApi<any>(`/lots/${encodeURIComponent(id)}`)

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

  const lot = data.lot
  const consumptions = data.consumptions ?? []
  const inspections = data.inspections ?? []
  const defects = data.defects ?? []
  const events = data.events ?? []
  const consumedPct = lot.received_qty ? lot.consumed_qty / lot.received_qty : 0

  return (
    <div className="space-y-4">
      <Link to="/lots" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={13} /> Material lots
      </Link>

      <PageHeader
        title={lot.lot_id}
        subtitle={`${lot.material_name} · supplied by ${lot.supplier_name} · received ${dateShort(lot.received_date)}`}
        meta={
          <>
            <Badge status={lot.status} dot />
            <Badge tone={lot.coa_pass ? 'success' : 'danger'}>{lot.coa_pass ? 'COA pass' : 'COA fail'}</Badge>
            <Badge tone="neutral">Expires {dateShort(lot.expiry_date)}</Badge>
          </>
        }
        actions={
          <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv(`${lot.lot_id}-consumption.csv`, consumptions)} disabled={!consumptions.length}>
            Export consumption
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Received" value={`${num(lot.received_qty)} ${lot.uom}`} sub={`On ${dateShort(lot.received_date)}`} icon={<Boxes size={15} />} />
        <KpiCard label="Consumed" value={`${num(lot.consumed_qty)} ${lot.uom}`} sub={`${pct(consumedPct)} of receipt`} />
        <KpiCard label="Remaining" value={`${num(lot.remaining_qty)} ${lot.uom}`} sub={lot.status === 'expired' ? 'Expired balance — do not issue' : 'Available balance'} tone={lot.status === 'expired' ? 'danger' : 'neutral'} />
        <KpiCard label="Consumption records" value={num(consumptions.length)} sub={`${num(defects.length)} defect events linked`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Lot balance" description="Received quantity equals consumed plus remaining; recomputed by the validator.">
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="label">Consumed</p>
                <p className="text-[22px] font-semibold text-ink tabular">{pct(consumedPct, 1)}</p>
              </div>
              <p className="text-[12px] text-muted tabular">
                {num(lot.remaining_qty)} {lot.uom} left
              </p>
            </div>
            <Progress value={consumedPct} tone={lot.status === 'expired' ? 'danger' : 'accent'} className="h-2" />
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
              {[
                ['Received', num(lot.received_qty)],
                ['Consumed', num(lot.consumed_qty)],
                ['Remaining', num(lot.remaining_qty)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10.5px] uppercase tracking-wide text-faint">{label}</p>
                  <p className="mt-0.5 text-[13px] font-medium text-ink tabular">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <Section className="xl:col-span-2" title="Lot master" description="Source, material and shelf-life attributes.">
          <KeyValue
            columns={3}
            items={[
              { label: 'Lot ID', value: lot.lot_id },
              { label: 'Material', value: <Link className="text-accent hover:underline" to={`/products/${lot.material_product_id}`}>{lot.material_name}</Link> },
              { label: 'Family', value: lot.family },
              { label: 'Supplier', value: <Link className="text-accent hover:underline" to={`/suppliers/${lot.supplier_id}`}>{lot.supplier_name}</Link> },
              { label: 'Risk tier', value: `Tier ${lot.risk_tier}` },
              { label: 'Qualification', value: titleCase(lot.qualification_state) },
              { label: 'Received', value: dateShort(lot.received_date) },
              { label: 'Expiry', value: dateShort(lot.expiry_date) },
              { label: 'Certificate', value: lot.certificate_ref },
              { label: 'Unit of measure', value: lot.uom },
              { label: 'Status', value: titleCase(lot.status) },
              { label: 'Created', value: dateShort(lot.created_at) },
            ]}
          />
        </Section>
      </div>

      <Section title="Consumption by production order" description="Chronological material issues; this is the forward link used by the trace engine." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Consumed at</th>
                <th className="px-4 py-2 font-semibold">Order</th>
                <th className="px-4 py-2 font-semibold">Product</th>
                <th className="px-4 py-2 font-semibold">Step</th>
                <th className="px-4 py-2 text-right font-semibold">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {consumptions.map((row: any) => (
                <tr key={row.consumption_id} className="border-t border-line/70">
                  <td className="px-4 py-2 text-muted">{dateTime(row.consumed_at)}</td>
                  <td className="px-4 py-2">
                    <Link to={`/orders/${row.order_id}`} className="font-medium text-accent hover:underline">{row.order_id}</Link>
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-2 text-muted">{row.product_name}</td>
                  <td className="px-4 py-2 text-muted">{row.sequence_no ? `Step ${row.sequence_no}` : '—'}</td>
                  <td className="px-4 py-2 text-right tabular">{num(row.qty_consumed, 2)}</td>
                </tr>
              ))}
              {!consumptions.length && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[12px] text-muted">No consumption recorded for this lot.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Inspections" description="Incoming and in-process inspections on this lot." bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] text-left text-[12.5px]">
              <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Inspection</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Result</th>
                  <th className="px-4 py-2 text-right font-semibold">Defects</th>
                </tr>
              </thead>
              <tbody>
                {inspections.map((row: any) => (
                  <tr key={row.inspection_id} className="border-t border-line/70">
                    <td className="px-4 py-2">
                      <Link to={`/inspections/${row.inspection_id}`} className="font-medium text-accent hover:underline">{row.inspection_id}</Link>
                      <p className="text-[11px] text-faint">{dateShort(row.inspected_at)}</p>
                    </td>
                    <td className="px-4 py-2 capitalize text-muted">{row.inspection_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2"><Badge status={row.result} dot /></td>
                    <td className="px-4 py-2 text-right tabular">{num(row.defect_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Lot event history" description="Append-only state transitions." bodyClassName="px-4 py-3">
          <ol className="space-y-3">
            {events.map((event: any) => (
              <li key={event.event_id} className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent/70" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-ink">
                    {event.event_type.replace(/_/g, ' ')}
                    {event.from_state && <span className="text-muted"> · {event.from_state} → {event.to_state}</span>}
                  </p>
                  <p className="text-[11.5px] text-muted">{dateTime(event.occurred_at)} · {event.actor_code}</p>
                  {event.note && <p className="text-[11.5px] text-faint">{event.note}</p>}
                </div>
              </li>
            ))}
            {!events.length && <li className="text-[12px] text-muted">No events recorded.</li>}
          </ol>
        </Section>
      </div>

      <Section title="Defects linked to this lot" description="Quality events where this lot is the implicated source." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Defect</th>
                <th className="px-4 py-2 font-semibold">Severity</th>
                <th className="px-4 py-2 text-right font-semibold">Qty</th>
                <th className="px-4 py-2 font-semibold">Detected</th>
                <th className="px-4 py-2 font-semibold">Order</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((defect: any) => (
                <tr key={defect.defect_id} className="border-t border-line/70">
                  <td className="px-4 py-2">
                    <Link to={`/defects/${defect.defect_id}`} className="font-medium text-accent hover:underline">{defect.defect_name}</Link>
                    <p className="text-[11px] text-faint">{defect.defect_id}</p>
                  </td>
                  <td className="px-4 py-2"><Badge tone={defect.severity === 'critical' ? 'danger' : defect.severity === 'major' ? 'warning' : 'neutral'}>{defect.severity}</Badge></td>
                  <td className="px-4 py-2 text-right tabular">{num(defect.qty)}</td>
                  <td className="px-4 py-2 text-muted">{dateShort(defect.detected_at)}</td>
                  <td className="px-4 py-2 text-muted">{defect.order_id ?? '—'}</td>
                  <td className="px-4 py-2"><Badge status={defect.status} dot /></td>
                </tr>
              ))}
              {!defects.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-muted">No defects linked to this lot.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
