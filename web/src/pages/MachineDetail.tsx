import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { Badge, Button, Card, ErrorState, KeyValue, KpiCard, PageHeader, Section, TableSkeleton } from '../components/ui'
import { DriftChart } from '../components/charts'
import { useApi } from '../lib/useApi'
import { dateShort, dateTime, downloadCsv, num, pct, titleCase } from '../lib/format'

export default function MachineDetail() {
  const { id = '' } = useParams()
  const { data, loading, error, reload } = useApi<any>(`/machines/${encodeURIComponent(id)}`)

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

  const machine = data.machine
  const weeks = data.weeks ?? []
  const steps = data.steps ?? []
  const defects = data.defects ?? []
  const flagged = weeks.filter((week: any) => week.drift_suspected)

  return (
    <div className="space-y-4">
      <Link to="/machines" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={13} /> Machines &amp; processes
      </Link>

      <PageHeader
        title={machine.name}
        subtitle={`${machine.machine_id} · ${titleCase(machine.machine_type)} · ${machine.plant} / ${machine.line}`}
        meta={
          <>
            <Badge status={machine.status} dot />
            <Badge tone={machine.decision === 'MAINTENANCE_REVIEW' ? 'warning' : 'success'}>
              {machine.decision.replace(/_/g, ' ')}
            </Badge>
            {flagged.length > 0 && <Badge tone="danger">{flagged.length} drift weeks</Badge>}
          </>
        }
        actions={
          <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv(`${machine.machine_id}-weeks.csv`, weeks)} disabled={!weeks.length}>
            Export weeks
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Process steps" value={num(machine.step_count)} sub={`${num(machine.input_qty)} units in`} />
        <KpiCard label="Scrap rate" value={pct(machine.scrap_rate)} sub={`${num(machine.scrap_qty)} units scrapped`} tone={machine.scrap_rate > 0.02 ? 'warning' : 'neutral'} />
        <KpiCard label="Inspections" value={num(machine.inspections)} sub={`${num(machine.inspected_qty)} units inspected`} />
        <KpiCard label="Defect rate" value={pct(machine.defect_rate)} sub={`${num(machine.defect_qty)} defect units`} tone={machine.defect_rate > 0.01 ? 'danger' : 'neutral'} />
        <KpiCard label="Drift weeks" value={num(machine.drift_weeks)} sub={flagged.length ? 'Excluded from baseline' : 'None flagged'} tone={machine.drift_weeks >= 2 ? 'danger' : 'neutral'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Weekly scrap rate" description="Solid line: observed scrap rate. Dashed: machine median baseline." action={<Badge tone="neutral">{weeks.length} weeks</Badge>} bodyClassName="pt-2">
          <DriftChart weeks={weeks} height={260} />
        </Section>

        <Section title="Asset master" description="Installation and maintenance attributes.">
          <KeyValue
            columns={2}
            items={[
              { label: 'Machine', value: machine.machine_id },
              { label: 'Type', value: titleCase(machine.machine_type) },
              { label: 'Plant', value: machine.plant },
              { label: 'Line', value: machine.line },
              { label: 'Status', value: titleCase(machine.status) },
              { label: 'Design rate', value: `${num(machine.design_uph, 0)} units/h` },
              { label: 'Commissioned', value: dateShort(machine.commissioned_on) },
              { label: 'Last maintenance', value: dateShort(machine.last_maintenance_on) },
            ]}
          />
          <div className="mt-4 space-y-1.5 rounded-lg border border-line bg-slate-50/70 p-3 text-[11.5px] text-muted">
            <p className="font-medium text-ink">Drift interpretation</p>
            <p>Weeks with fewer than 200 units are not evaluable and never flagged.</p>
            <p>{flagged.length} flagged weeks · {weeks.filter((w: any) => !w.evaluable).length} not evaluable.</p>
          </div>
        </Section>
      </div>

      <Section title="Recent process steps" description="Latest operations executed on this machine." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Step</th>
                <th className="px-4 py-2 font-semibold">Order</th>
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
                  <td className="px-4 py-2">
                    <p className="font-medium text-ink">{step.step_name}</p>
                    <p className="text-[11px] text-faint">seq {step.sequence_no} · {step.operator_code}</p>
                  </td>
                  <td className="px-4 py-2">
                    <Link to={`/orders/${step.order_id}`} className="text-accent hover:underline">{step.order_id}</Link>
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

      <Section title="Defects produced on this machine" description="Most recent defect events linked to the asset." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[12.5px]">
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
              {!defects.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-muted">No defects linked to this machine.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
