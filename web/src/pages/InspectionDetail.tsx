import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { Badge, Button, Card, ErrorState, KeyValue, KpiCard, PageHeader, Section, TableSkeleton } from '../components/ui'
import { useApi } from '../lib/useApi'
import { dateShort, dateTime, downloadCsv, num, pct, titleCase } from '../lib/format'

export default function InspectionDetail() {
  const { id = '' } = useParams()
  const { data, loading, error, reload } = useApi<any>(`/inspections/${encodeURIComponent(id)}`)

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

  const inspection = data.inspection
  const defects = data.defects ?? []
  const capas = data.capas ?? []

  return (
    <div className="space-y-4">
      <Link to="/inspections" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={13} /> Inspections
      </Link>

      <PageHeader
        title={inspection.inspection_id}
        subtitle={`${titleCase(inspection.inspection_type)} inspection · ${dateTime(inspection.inspected_at)} · inspector ${inspection.inspector_code}`}
        meta={
          <>
            <Badge status={inspection.result} dot />
            <Badge tone="neutral">{num(inspection.inspected_qty)} units inspected</Badge>
            {inspection.order_id && <Badge tone="neutral">Order {inspection.order_id}</Badge>}
            {inspection.lot_id && <Badge tone="neutral">Lot {inspection.lot_id}</Badge>}
          </>
        }
        actions={
          <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv(`${inspection.inspection_id}-defects.csv`, defects)} disabled={!defects.length}>
            Export defects
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Inspected" value={num(inspection.inspected_qty)} sub={`Sample ${num(inspection.sampled_qty)}`} />
        <KpiCard label="Defects found" value={num(inspection.defect_count)} sub={`${pct(inspection.defect_rate)} defect rate`} tone={inspection.defect_count ? 'warning' : 'success'} />
        <KpiCard label="Accept / reject" value={`${num(inspection.acceptance_qty)} / ${num(inspection.rejection_qty)}`} sub="Plan limits" />
        <KpiCard label="AQL" value={inspection.aql_level ?? '—'} sub={`Sample size ${num(inspection.sample_size)}`} />
        <KpiCard label="Result" value={titleCase(inspection.result)} sub={inspection.result === 'pass' ? 'Accepted' : inspection.result === 'fail' ? 'Rejected' : 'Conditional release'} tone={inspection.result === 'pass' ? 'success' : inspection.result === 'fail' ? 'danger' : 'warning'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Inspection context" description="Links back to production, material and process.">
          <KeyValue
            columns={2}
            items={[
              { label: 'Type', value: titleCase(inspection.inspection_type) },
              { label: 'Inspected at', value: dateTime(inspection.inspected_at) },
              { label: 'Order', value: inspection.order_id ? <Link className="text-accent hover:underline" to={`/orders/${inspection.order_id}`}>{inspection.order_id}</Link> : '—' },
              { label: 'Product', value: inspection.product_id ? <Link className="text-accent hover:underline" to={`/products/${inspection.product_id}`}>{inspection.product_name}</Link> : '—' },
              { label: 'Lot', value: inspection.lot_id ? <Link className="text-accent hover:underline" to={`/lots/${inspection.lot_id}`}>{inspection.lot_id}</Link> : '—' },
              { label: 'Supplier', value: inspection.supplier_id ? <Link className="text-accent hover:underline" to={`/suppliers/${inspection.supplier_id}`}>{inspection.supplier_name}</Link> : '—' },
              { label: 'Step', value: inspection.step_id ? `${inspection.sequence_no ?? '—'} · ${inspection.step_name ?? '—'}` : '—' },
              { label: 'Machine', value: inspection.machine_id ? <Link className="text-accent hover:underline" to={`/machines/${inspection.machine_id}`}>{inspection.machine_id}</Link> : '—' },
              { label: 'Plan', value: inspection.plan_id },
              { label: 'Criteria', value: inspection.criteria ?? '—' },
            ]}
          />
        </Section>

        <Section title="Measurement" description="Sampled value against the specification window.">
          {inspection.measured_value !== null && inspection.measured_value !== undefined ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-slate-50/70 p-4 text-center">
                <p className="label">Measured value</p>
                <p className="mt-1 text-[26px] font-semibold text-ink tabular">{num(inspection.measured_value, 3)}</p>
                <p className="text-[11.5px] text-muted">
                  Spec {num(inspection.spec_min, 3)} – {num(inspection.spec_max, 3)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-line p-2.5">
                  <p className="label">Defect rate</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-ink tabular">{pct(inspection.defect_rate)}</p>
                </div>
                <div className="rounded-lg border border-line p-2.5">
                  <p className="label">Sampled</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-ink tabular">{num(inspection.sampled_qty)}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">
              This is an attribute inspection (visual, certificate or functional) with no numeric measurement.
            </p>
          )}
        </Section>

        <Section title="Corrective actions" description="CAPAs raised from defects on this inspection." bodyClassName="p-0">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">CAPA</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Due</th>
              </tr>
            </thead>
            <tbody>
              {capas.map((capa: any) => (
                <tr key={capa.capa_id} className="border-t border-line/70">
                  <td className="px-4 py-2">
                    <Link to={`/capa/${capa.capa_id}`} className="text-accent hover:underline">{capa.capa_id}</Link>
                    <p className="max-w-[160px] truncate text-[11px] text-faint">{capa.defect_name}</p>
                  </td>
                  <td className="px-4 py-2"><Badge status={capa.status} dot /></td>
                  <td className="px-4 py-2 text-muted">{dateShort(capa.due_at)}</td>
                </tr>
              ))}
              {!capas.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-[12px] text-muted">No CAPA raised from this inspection.</td></tr>}
            </tbody>
          </table>
        </Section>
      </div>

      <Section title="Defects identified" description="Every defect event raised by this inspection." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Defect</th>
                <th className="px-4 py-2 font-semibold">Category</th>
                <th className="px-4 py-2 font-semibold">Severity</th>
                <th className="px-4 py-2 text-right font-semibold">Qty</th>
                <th className="px-4 py-2 font-semibold">Supplier responsibility</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((defect: any) => (
                <tr key={defect.defect_id} className="border-t border-line/70">
                  <td className="px-4 py-2">
                    <Link to={`/defects/${defect.defect_id}`} className="font-medium text-accent hover:underline">{defect.defect_name}</Link>
                    <p className="text-[11px] text-faint">{defect.defect_id} · {defect.defect_code}</p>
                  </td>
                  <td className="px-4 py-2 capitalize text-muted">{defect.category}</td>
                  <td className="px-4 py-2"><Badge tone={defect.severity === 'critical' ? 'danger' : defect.severity === 'major' ? 'warning' : 'neutral'}>{defect.severity}</Badge></td>
                  <td className="px-4 py-2 text-right tabular">{num(defect.qty)}</td>
                  <td className="px-4 py-2 text-muted">{defect.supplier_responsibility ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2"><Badge status={defect.status} dot /></td>
                </tr>
              ))}
              {!defects.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-muted">This inspection found no defects.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
