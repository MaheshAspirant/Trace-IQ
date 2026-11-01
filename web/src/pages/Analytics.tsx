import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import {
  CategoryDonut,
  ParetoChart,
  QualityTrend,
  SupplierScatter,
  VolumeTrend,
} from '../components/charts'
import { Badge, Button, Card, ErrorState, KpiCard, PageHeader, Section, TableSkeleton } from '../components/ui'
import { useApi } from '../lib/useApi'
import { downloadCsv, num, pct, titleCase } from '../lib/format'

export default function Analytics() {
  const { data, loading, error, reload } = useApi<any>('/api/analytics')

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )

  const trend = data?.trend ?? []
  const latest = trend[trend.length - 1] ?? {}
  const capa = data?.capa_performance ?? {}
  const mix = data?.inspection_mix ?? []
  const families = data?.families ?? []
  const plants = data?.plants ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics & reports"
        subtitle="Portfolio-level quality analytics: trend, Pareto of defect codes, supplier performance and corrective action cycle time."
        meta={
          <>
            <Badge tone="neutral">{trend.length} months</Badge>
            <Badge tone="neutral">All figures derived from persisted rows</Badge>
          </>
        }
        actions={
          <Button
            size="sm"
            icon={<Download size={14} />}
            onClick={() => downloadCsv('quality-trend.csv', trend)}
            disabled={!trend.length}
          >
            Export trend
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Latest defect rate" value={pct(latest.defect_rate)} sub={`${num(latest.inspected_qty)} inspected`} loading={loading} tone={latest.defect_rate > 0.01 ? 'danger' : 'neutral'} />
        <KpiCard label="Latest scrap rate" value={pct(latest.scrap_rate)} sub={`${num(latest.produced_qty)} produced`} loading={loading} />
        <KpiCard label="CAPA cycle time" value={`${num(capa.avg_days_to_close, 1)} d`} sub={`${num(capa.closed)} closed`} loading={loading} />
        <KpiCard
          label="On-time closure"
          value={capa.closed ? pct(capa.on_time / capa.closed, 1) : '—'}
          sub={`${num(capa.on_time)} of ${num(capa.closed)}`}
          loading={loading}
        />
        <KpiCard label="Gate violations" value={num(capa.gate_violations)} sub="Closed without verification" loading={loading} tone={capa.gate_violations ? 'danger' : 'success'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Quality trend" description="Defect quantity and defect rate by month." bodyClassName="pt-2">
          {loading ? <TableSkeleton rows={5} columns={4} /> : <QualityTrend data={trend} height={280} />}
        </Section>
        <Section title="Inspection mix" description="Volume and failure rate by inspection type." bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {mix.map((row: any) => (
              <li key={row.type} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12.5px] font-medium capitalize text-ink">{row.type.replace(/_/g, ' ')}</p>
                  <Badge tone={row.failed / (row.count || 1) > 0.1 ? 'warning' : 'neutral'}>
                    {pct(row.failed / (row.count || 1), 1)} fail
                  </Badge>
                </div>
                <p className="mt-1 text-[11.5px] text-muted">
                  {num(row.count)} inspections · {num(row.inspected_qty)} units · {num(row.defect_qty)} defects
                </p>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Defect Pareto" description="Defect code contribution with cumulative share." bodyClassName="pt-2">
          {loading ? <TableSkeleton rows={5} columns={3} /> : <ParetoChart data={data?.pareto ?? []} />}
        </Section>
        <Section title="Category mix" description="Quantity share by defect category.">
          {loading ? <TableSkeleton rows={5} columns={2} /> : <CategoryDonut data={(data?.pareto ?? []).slice(0, 6).map((row: any) => ({ category: row.category, qty: row.qty }))} height={200} />}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Supplier performance" description="Incoming defect rate against received volume, bubble size = attributed defect quantity." bodyClassName="pt-2">
          {loading ? <TableSkeleton rows={5} columns={3} /> : <SupplierScatter data={data?.suppliers ?? []} />}
        </Section>
        <Section title="Production volume" description="Inspected units against defect quantity by month." bodyClassName="pt-2">
          {loading ? <TableSkeleton rows={5} columns={3} /> : <VolumeTrend data={trend} height={280} />}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Plant comparison" description="Scrap and defect rates by plant." bodyClassName="p-0">
          <div className="divide-y divide-line md:hidden">
            {plants.map((row: any) => (
              <div key={row.plant} data-mobile-row className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-ink">{row.plant}</p>
                  <span className="text-[11.5px] text-muted">{num(row.orders)} orders</span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-faint">Produced</dt>
                    <dd className="tabular text-[12px] text-ink">{num(row.produced_qty)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-faint">Scrap</dt>
                    <dd className="tabular text-[12px] text-ink">{pct(row.scrap_rate)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-faint">Defect</dt>
                    <dd className="tabular text-[12px] text-ink">{pct(row.defect_rate)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[520px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Plant</th>
                <th className="px-4 py-2 text-right font-semibold">Orders</th>
                <th className="px-4 py-2 text-right font-semibold">Produced</th>
                <th className="px-4 py-2 text-right font-semibold">Scrap rate</th>
                <th className="px-4 py-2 text-right font-semibold">Defect rate</th>
              </tr>
            </thead>
            <tbody>
              {plants.map((row: any) => (
                <tr key={row.plant} className="border-t border-line/70">
                  <td className="px-4 py-2 font-medium text-ink">{row.plant}</td>
                  <td className="px-4 py-2 text-right tabular">{num(row.orders)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(row.produced_qty)}</td>
                  <td className="px-4 py-2 text-right tabular">{pct(row.scrap_rate)}</td>
                  <td className="px-4 py-2 text-right tabular">{pct(row.defect_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Section>

        <Section title="Product family quality" description="Yield and scrap by family." bodyClassName="p-0">
          <div className="divide-y divide-line md:hidden">
            {families.map((row: any) => (
              <div key={row.family} data-mobile-row className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-ink">{row.family}</p>
                  <span className="text-[11.5px] text-muted">{num(row.orders)} orders</span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-faint">Produced</dt>
                    <dd className="tabular text-[12px] text-ink">{num(row.produced_qty)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-faint">Scrap</dt>
                    <dd className="tabular text-[12px] text-ink">{pct(row.scrap_rate)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-faint">Defect</dt>
                    <dd className="tabular text-[12px] text-ink">{pct(row.defect_rate)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[520px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Family</th>
                <th className="px-4 py-2 text-right font-semibold">Orders</th>
                <th className="px-4 py-2 text-right font-semibold">Produced</th>
                <th className="px-4 py-2 text-right font-semibold">Scrap rate</th>
                <th className="px-4 py-2 text-right font-semibold">Defect rate</th>
              </tr>
            </thead>
            <tbody>
              {families.map((row: any) => (
                <tr key={row.family} className="border-t border-line/70">
                  <td className="px-4 py-2 font-medium text-ink">{row.family}</td>
                  <td className="px-4 py-2 text-right tabular">{num(row.orders)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(row.produced_qty)}</td>
                  <td className="px-4 py-2 text-right tabular">{pct(row.scrap_rate)}</td>
                  <td className="px-4 py-2 text-right tabular">{pct(row.defect_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="CAPA by root cause" description="Volume and closure progress per root-cause category." bodyClassName="p-0">
          <div className="divide-y divide-line md:hidden">
            {(capa.by_root_cause ?? []).map((row: any) => (
              <div key={row.category} data-mobile-row className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-ink">{titleCase(row.category)}</p>
                  <p className="text-[12.5px] font-medium text-ink tabular">
                    {pct(row.count ? row.closed / row.count : 0, 1)}
                  </p>
                </div>
                <p className="mt-1 text-[11.5px] text-muted">
                  {num(row.count)} CAPAs · {num(row.closed)} closed
                </p>
              </div>
            ))}
          </div>
          <table className="hidden w-full text-left text-[12.5px] md:table">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Root cause</th>
                <th className="px-4 py-2 text-right font-semibold">CAPAs</th>
                <th className="px-4 py-2 text-right font-semibold">Closed</th>
                <th className="px-4 py-2 text-right font-semibold">Closure rate</th>
              </tr>
            </thead>
            <tbody>
              {(capa.by_root_cause ?? []).map((row: any) => (
                <tr key={row.category} className="border-t border-line/70">
                  <td className="px-4 py-2 font-medium text-ink">{titleCase(row.category)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(row.count)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(row.closed)}</td>
                  <td className="px-4 py-2 text-right tabular">{pct(row.count ? row.closed / row.count : 0, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Machine drift ranking" description="Flagged machine-weeks in the period." bodyClassName="p-0">
          <div className="divide-y divide-line md:hidden">
            {(data?.drift ?? []).map((row: any) => (
              <Link
                key={row.machine_id}
                to={`/machines/${row.machine_id}`}
                data-mobile-row
                className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-accent">{row.name}</p>
                  <p className="text-[11px] text-faint">{num(row.drift_weeks)} flagged weeks</p>
                </div>
                <div className="text-right">
                  <p className="text-2xs uppercase tracking-wide text-faint">Scrap</p>
                  <p className="text-[12px] text-ink tabular">{pct(row.scrap_rate)}</p>
                </div>
              </Link>
            ))}
          </div>
          <table className="hidden w-full text-left text-[12.5px] md:table">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Machine</th>
                <th className="px-4 py-2 text-right font-semibold">Weeks</th>
                <th className="px-4 py-2 text-right font-semibold">Scrap rate</th>
              </tr>
            </thead>
            <tbody>
              {(data?.drift ?? []).map((row: any) => (
                <tr key={row.machine_id} className="border-t border-line/70">
                  <td className="px-4 py-2">
                    <Link to={`/machines/${row.machine_id}`} className="font-medium text-accent hover:underline">{row.name}</Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular">{num(row.drift_weeks)}</td>
                  <td className="px-4 py-2 text-right tabular">{pct(row.scrap_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <Section title="Top defect codes" description="Pareto table backing the chart above." bodyClassName="p-0">
        <div className="divide-y divide-line md:hidden">
          {(data?.pareto ?? []).map((row: any) => (
            <div key={row.code} data-mobile-row className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-ink">{row.name}</p>
                  <p className="text-[11px] text-faint">{row.code} · {row.category}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[12.5px] font-medium text-ink tabular">{num(row.qty)}</p>
                  <p className="text-[11px] text-faint tabular">{pct(row.share, 1)} share</p>
                </div>
              </div>
              <p className="mt-1 text-[11.5px] text-muted tabular">
                {num(row.events)} events · {pct(row.cumulative, 1)} cumulative
              </p>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Code</th>
                <th className="px-4 py-2 font-semibold">Defect</th>
                <th className="px-4 py-2 font-semibold">Category</th>
                <th className="px-4 py-2 text-right font-semibold">Events</th>
                <th className="px-4 py-2 text-right font-semibold">Quantity</th>
                <th className="px-4 py-2 text-right font-semibold">Share</th>
                <th className="px-4 py-2 text-right font-semibold">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {(data?.pareto ?? []).map((row: any) => (
                <tr key={row.code} className="border-t border-line/70">
                  <td className="px-4 py-2 font-medium text-ink">{row.code}</td>
                  <td className="px-4 py-2 text-muted">{row.name}</td>
                  <td className="px-4 py-2 capitalize text-muted">{row.category}</td>
                  <td className="px-4 py-2 text-right tabular">{num(row.events)}</td>
                  <td className="px-4 py-2 text-right tabular">{num(row.qty)}</td>
                  <td className="px-4 py-2 text-right tabular">{pct(row.share, 1)}</td>
                  <td className="px-4 py-2 text-right tabular">{pct(row.cumulative, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
