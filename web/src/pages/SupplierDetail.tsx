import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, ExternalLink } from 'lucide-react'
import { Badge, Button, Card, ErrorState, KeyValue, KpiCard, PageHeader, Section, TableSkeleton } from '../components/ui'
import { VolumeTrend } from '../components/charts'
import { useApi } from '../lib/useApi'
import { dateShort, downloadCsv, num, pct, titleCase, toneFor } from '../lib/format'

const DECISION_TONE: Record<string, 'danger' | 'warning' | 'info' | 'success' | 'neutral'> = {
  BLOCK_AND_AUDIT: 'danger',
  ESCALATE_8D: 'warning',
  CONDITIONAL_MONITOR: 'info',
  MONITOR: 'success',
}

export default function SupplierDetail() {
  const { id = '' } = useParams()
  const { data, loading, error, reload } = useApi<any>(`/suppliers/${encodeURIComponent(id)}`)

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

  const supplier = data.supplier
  const lots = data.lots ?? []
  const materials = data.materials ?? []
  const defects = data.defects ?? []
  const capas = data.capas ?? []

  return (
    <div className="space-y-4">
      <Link to="/suppliers" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={13} /> Suppliers
      </Link>

      <PageHeader
        title={supplier.name}
        subtitle={`${supplier.supplier_id} · ${supplier.country} · ${titleCase(supplier.supplier_type)} · lead time ${supplier.lead_time_days} days`}
        meta={
          <>
            <Badge status={supplier.qualification_state} dot />
            <Badge tone={DECISION_TONE[supplier.decision] ?? 'neutral'}>{supplier.decision?.replace(/_/g, ' ')}</Badge>
            <Badge tone={supplier.risk_tier === 'C' ? 'danger' : supplier.risk_tier === 'B' ? 'warning' : 'success'}>
              Risk tier {supplier.risk_tier}
            </Badge>
          </>
        }
        actions={
          <>
            <Link to={`/lots?q=${encodeURIComponent(supplier.supplier_id)}`}>
              <Button size="sm" icon={<ExternalLink size={14} />}>View lots</Button>
            </Link>
            <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv(`${supplier.supplier_id}-lots.csv`, lots)} disabled={!lots.length}>
              Export lots
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Incoming inspections" value={num(supplier.incoming_inspections)} sub={`${num(supplier.incoming_inspected_qty)} units inspected`} />
        <KpiCard
          label="Incoming defect rate"
          value={pct(supplier.incoming_defect_rate)}
          sub={`${num(supplier.incoming_defect_qty)} defective units`}
          tone={supplier.incoming_defect_rate > 0.02 ? 'danger' : 'neutral'}
        />
        <KpiCard label="Attributed defects" value={num(supplier.attributed_defect_qty)} sub={`${num(supplier.attributed_defect_events)} events · ${num(supplier.critical_events)} critical`} />
        <KpiCard label="Lots received" value={num(supplier.lots_received)} sub={`${num(supplier.lots_rejected)} rejected · ${num(supplier.lots_expired)} expired`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Supplier master" description="Qualification and commercial attributes.">
          <KeyValue
            columns={2}
            items={[
              { label: 'Supplier ID', value: supplier.supplier_id },
              { label: 'Country', value: supplier.country },
              { label: 'Type', value: titleCase(supplier.supplier_type) },
              { label: 'Risk tier', value: `Tier ${supplier.risk_tier}` },
              { label: 'Qualification', value: titleCase(supplier.qualification_state) },
              { label: 'Approved on', value: dateShort(supplier.approved_on) },
              { label: 'Lead time', value: `${supplier.lead_time_days} days` },
              { label: 'Quality contact', value: titleCase(supplier.quality_contact_role) },
              { label: 'Effective from', value: dateShort(supplier.effective_from) },
              { label: 'Effective to', value: supplier.effective_to ? dateShort(supplier.effective_to) : 'Open' },
            ]}
          />
          <div className="mt-4 rounded-lg border border-line bg-slate-50/70 p-3">
            <p className="label">Decision rationale</p>
            <p className="mt-1 text-[12.5px] text-ink">
              <Badge tone={DECISION_TONE[supplier.decision] ?? 'neutral'}>{supplier.decision?.replace(/_/g, ' ')}</Badge>
            </p>
            <p className="mt-1 text-[12px] leading-5 text-muted">{supplier.decision_reason}</p>
            {supplier.portfolio_median_rate !== undefined && (
              <p className="mt-1 text-[11.5px] text-faint">
                Portfolio median incoming rate {pct(supplier.portfolio_median_rate)}
              </p>
            )}
          </div>
        </Section>

        <Section
          className="xl:col-span-2"
          title="Incoming quality trend"
          description="Inspected units against defective units at goods receipt."
          action={<Badge tone="neutral">{data.trend?.length ?? 0} months</Badge>}
          bodyClassName="pt-2"
        >
          <VolumeTrend data={data.trend ?? []} height={250} />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Materials supplied" description="Approved part numbers and unit price." bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[12.5px]">
              <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Material</th>
                  <th className="px-4 py-2 font-semibold">Qualification</th>
                  <th className="px-4 py-2 text-right font-semibold">Unit price</th>
                  <th className="px-4 py-2 font-semibold">Since</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((material: any) => (
                  <tr key={material.supplier_material_id} className="border-t border-line/70">
                    <td className="px-4 py-2">
                      <Link to={`/products/${material.product_id}`} className="font-medium text-accent hover:underline">{material.name}</Link>
                      <p className="text-[11px] text-faint">{material.product_id} · {material.family}</p>
                    </td>
                    <td className="px-4 py-2"><Badge status={material.qualification_state} dot /></td>
                    <td className="px-4 py-2 text-right tabular">${num(material.unit_price_usd, 2)}</td>
                    <td className="px-4 py-2 text-muted">{dateShort(material.effective_from)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Quality-linked CAPAs" description="Corrective actions opened against defects attributed to this supplier." bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[12.5px]">
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
                      <Link to={`/capa/${capa.capa_id}`} className="font-medium text-accent hover:underline">{capa.capa_id}</Link>
                      <p className="max-w-[190px] truncate text-[11px] text-faint">{capa.defect_name}</p>
                    </td>
                    <td className="px-4 py-2"><Badge status={capa.status} dot /></td>
                    <td className="px-4 py-2 text-muted">{dateShort(capa.due_at)}</td>
                    <td className="px-4 py-2">
                      {capa.status === 'closed' && !capa.closure_allowed ? (
                        <Badge tone="danger">Violation</Badge>
                      ) : (
                        <Badge tone="success">OK</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {!capas.length && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-[12px] text-muted">No CAPAs attributed to this supplier.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section title="Recent material lots" description="Latest receipts with remaining balance." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Lot</th>
                <th className="px-4 py-2 font-semibold">Material</th>
                <th className="px-4 py-2 font-semibold">Received</th>
                <th className="px-4 py-2 font-semibold">Expiry</th>
                <th className="px-4 py-2 text-right font-semibold">Received qty</th>
                <th className="px-4 py-2 text-right font-semibold">Remaining</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">COA</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot: any) => (
                <tr key={lot.lot_id} className="border-t border-line/70 hover:bg-slate-50/70">
                  <td className="px-4 py-2">
                    <Link to={`/lots/${lot.lot_id}`} className="font-medium text-accent hover:underline">{lot.lot_id}</Link>
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-2 text-muted">{lot.material_name}</td>
                  <td className="px-4 py-2 text-muted">{dateShort(lot.received_date)}</td>
                  <td className="px-4 py-2 text-muted">{dateShort(lot.expiry_date)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(lot.received_qty)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(lot.remaining_qty)}</td>
                  <td className="px-4 py-2"><Badge status={lot.status} dot /></td>
                  <td className="px-4 py-2"><Badge tone={lot.coa_pass ? 'success' : 'danger'}>{lot.coa_pass ? 'Pass' : 'Fail'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Attributed defects" description="Most recent defect events traced to this supplier's lots." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Defect</th>
                <th className="px-4 py-2 font-semibold">Severity</th>
                <th className="px-4 py-2 text-right font-semibold">Qty</th>
                <th className="px-4 py-2 font-semibold">Detected</th>
                <th className="px-4 py-2 font-semibold">Lot</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((defect: any) => (
                <tr key={defect.defect_id} className="border-t border-line/70 hover:bg-slate-50/70">
                  <td className="px-4 py-2">
                    <Link to={`/defects/${defect.defect_id}`} className="font-medium text-accent hover:underline">{defect.defect_name}</Link>
                    <p className="text-[11px] text-faint">{defect.defect_code} · {defect.defect_id}</p>
                  </td>
                  <td className="px-4 py-2"><Badge tone={toneFor(defect.severity)}>{defect.severity}</Badge></td>
                  <td className="px-4 py-2 text-right tabular">{num(defect.qty)}</td>
                  <td className="px-4 py-2 text-muted">{dateShort(defect.detected_at)}</td>
                  <td className="px-4 py-2 text-muted">{defect.lot_id ?? '—'}</td>
                  <td className="px-4 py-2"><Badge status={defect.status} dot /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
