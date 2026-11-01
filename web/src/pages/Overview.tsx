import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileWarning,
  Gauge,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  Truck,
} from 'lucide-react'
import { QualityTrend, RankedBars, CategoryDonut } from '../components/charts'
import {
  Badge,
  Button,
  Card,
  ErrorState,
  KpiCard,
  PageHeader,
  Section,
  TableSkeleton,
  cx,
} from '../components/ui'
import { useApi } from '../lib/useApi'
import { dateShort, downloadCsv, num, pct, severityTone } from '../lib/format'

export default function Overview() {
  const { data, loading, error, reload } = useApi<any>('/api/dashboard')

  if (error) {
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )
  }

  const kpis = data?.kpis
  const trend = data?.trend ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quality overview"
        subtitle="Executive view of production volume, inspection performance and corrective action health — every figure is derived from the dataset, not pre-computed."
        meta={
          <>
            <Badge tone="neutral" dot>
              As of {dateShort(data?.as_of)}
            </Badge>
            <span className="text-[11.5px] text-faint">
              Rates name their denominator · defect rate over inspected units
            </span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              icon={<Download size={14} />}
              onClick={() => downloadCsv('quality-trend.csv', trend)}
              disabled={!trend.length}
            >
              Export trend
            </Button>
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Production orders"
          value={num(kpis?.orders.value)}
          sub={`${num(kpis?.orders.completed)} completed · ${num(kpis?.orders.rework)} rework`}
          icon={<ClipboardList size={15} />}
          loading={loading}
        />
        <KpiCard
          label="Inspections"
          value={num(kpis?.inspections.value)}
          sub={`${pct(kpis?.inspections.pass_rate, 1)} pass rate`}
          icon={<ClipboardCheck size={15} />}
          loading={loading}
        />
        <KpiCard
          label="Defects"
          value={num(kpis?.defects.value)}
          sub={`${num(kpis?.defects.qty)} units · ${num(kpis?.defects.critical_open)} critical open`}
          icon={<FileWarning size={15} />}
          tone={kpis?.defects.critical_open ? 'danger' : 'neutral'}
          loading={loading}
        />
        <KpiCard
          label="Defect rate"
          value={pct(kpis?.defect_rate.value)}
          sub={`${num(kpis?.defect_rate.dppm)} DPPM`}
          delta={kpis?.defect_rate.delta}
          icon={<Gauge size={15} />}
          loading={loading}
        />
        <KpiCard
          label="Scrap rate"
          value={pct(kpis?.scrap_rate.value)}
          sub={`${num(kpis?.scrap_rate.scrap_qty)} of ${num(kpis?.scrap_rate.produced_qty)} units`}
          icon={<TrendingDown size={15} />}
          loading={loading}
        />
        <KpiCard
          label="Rework rate"
          value={pct(kpis?.rework_rate.value)}
          sub={`${num(kpis?.rework_rate.rework_orders)} rework orders`}
          icon={<RefreshCw size={15} />}
          loading={loading}
        />
        <KpiCard
          label="Open CAPAs"
          value={num(kpis?.open_capas.value)}
          sub={`${num(kpis?.open_capas.overdue)} overdue · ${num(kpis?.open_capas.pending_verification)} awaiting verification`}
          tone={kpis?.open_capas.overdue ? 'warning' : 'neutral'}
          icon={<ShieldCheck size={15} />}
          loading={loading}
        />
        <KpiCard
          label="Supplier quality score"
          value={kpis?.supplier_score.value !== undefined ? kpis.supplier_score.value.toFixed(2) : '—'}
          sub={`Incoming ${pct(kpis?.supplier_score.incoming_rate, 2)} · ${num(kpis?.supplier_score.blocked)} blocked`}
          icon={<Truck size={15} />}
          loading={loading}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Section
          className="xl:col-span-2"
          title="Production quality trend"
          description="Monthly defect quantity against the defect rate on inspected units."
          action={<Badge tone="neutral">{trend.length} months</Badge>}
          bodyClassName="pt-2"
        >
          {loading ? <TableSkeleton rows={5} columns={4} /> : <QualityTrend data={trend} />}
        </Section>

        <Section
          title="Critical quality alerts"
          description="Derived from open CAPAs, gate checks and the anomaly register."
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-line">
            {(data?.alerts ?? []).map((alert: any) => (
              <li key={alert.title}>
                <Link to={alert.href} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50">
                  <span
                    className={cx(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      alert.severity === 'critical' && 'bg-danger-soft text-danger',
                      alert.severity === 'high' && 'bg-warning-soft text-warning',
                      alert.severity === 'medium' && 'bg-info-soft text-info',
                    )}
                  >
                    <AlertTriangle size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-ink">{alert.title}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-4 text-muted">{alert.detail}</span>
                  </span>
                  <ArrowRight size={13} className="mt-1 shrink-0 text-faint" />
                </Link>
              </li>
            ))}
            {!loading && !(data?.alerts ?? []).length && (
              <li className="px-4 py-8 text-center text-[12.5px] text-muted">No active alerts.</li>
            )}
          </ul>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Defects by supplier" description="Supplier-attributed defect quantity, top 8.">
          {loading ? <TableSkeleton rows={6} columns={2} /> : <RankedBars data={data?.defects_by_supplier ?? []} height={220} labelWidth={120} />}
        </Section>
        <Section title="Defects by machine" description="Where defects were produced, top 8.">
          {loading ? <TableSkeleton rows={6} columns={2} /> : <RankedBars data={data?.defects_by_machine ?? []} height={220} labelWidth={110} color="#0e7490" />}
        </Section>
        <Section title="Defect categories" description="Share of defect quantity by category.">
          {loading ? (
            <TableSkeleton rows={5} columns={2} />
          ) : (
            <CategoryDonut data={data?.top_categories ?? []} height={220} />
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Recent production orders"
          description="Latest orders by identifier."
          action={
            <Link to="/orders" className="text-[12px] font-medium text-accent hover:underline">
              All orders
            </Link>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-line md:hidden">
            {(data?.recent_orders ?? []).map((order: any) => (
              <Link
                key={order.order_id}
                to={`/orders/${order.order_id}`}
                data-mobile-row
                className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-medium text-accent">{order.order_id}</span>
                    <Badge status={order.status} dot />
                  </div>
                  <p className="mt-1 truncate text-[12px] text-muted">{order.product_name}</p>
                  <p className="mt-0.5 text-[11px] text-faint">Actual {num(order.actual_qty)} units</p>
                </div>
                <ArrowRight size={14} className="shrink-0 text-faint" />
              </Link>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Order</th>
                  <th className="px-4 py-2 font-semibold">Product</th>
                  <th className="px-4 py-2 text-right font-semibold">Qty</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent_orders ?? []).map((order: any) => (
                  <tr key={order.order_id} className="border-t border-line/70 hover:bg-slate-50/70">
                    <td className="px-4 py-2">
                      <Link to={`/orders/${order.order_id}`} className="font-medium text-accent hover:underline">
                        {order.order_id}
                      </Link>
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-2 text-muted">{order.product_name}</td>
                    <td className="px-4 py-2 text-right tabular">{num(order.actual_qty)}</td>
                    <td className="px-4 py-2">
                      <Badge status={order.status} dot />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Pending corrective actions"
          description="Ordered by due date, excluding closed and cancelled."
          action={
            <Link to="/capa" className="text-[12px] font-medium text-accent hover:underline">
              CAPA register
            </Link>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-line md:hidden">
            {(data?.pending_capas ?? []).map((capa: any) => (
              <Link
                key={capa.capa_id}
                to={`/capa/${capa.capa_id}`}
                data-mobile-row
                className="block px-4 py-3 transition-colors active:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-accent">{capa.capa_id}</p>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{capa.defect_name}</p>
                  </div>
                  <Badge status={capa.status} dot />
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11.5px] text-faint">
                  <span>Due {dateShort(capa.due_at)}</span>
                  {capa.days_overdue > 0 && <Badge tone="danger">{capa.days_overdue}d overdue</Badge>}
                  <ArrowRight size={13} className="ml-auto" />
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">CAPA</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Due</th>
                  <th className="px-4 py-2 text-right font-semibold">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {(data?.pending_capas ?? []).map((capa: any) => (
                  <tr key={capa.capa_id} className="border-t border-line/70 hover:bg-slate-50/70">
                    <td className="px-4 py-2">
                      <Link to={`/capa/${capa.capa_id}`} className="font-medium text-accent hover:underline">
                        {capa.capa_id}
                      </Link>
                      <p className="max-w-[180px] truncate text-[11.5px] text-muted">{capa.defect_name}</p>
                    </td>
                    <td className="px-4 py-2">
                      <Badge status={capa.status} dot />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{dateShort(capa.due_at)}</td>
                    <td className="px-4 py-2 text-right tabular">
                      {capa.days_overdue > 0 ? (
                        <Badge tone="danger">{capa.days_overdue}d</Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section
        title="Recent defects"
        description="Newest defect events across all products, lots and machines."
        action={
          <Link to="/defects" className="text-[12px] font-medium text-accent hover:underline">
            Defect register
          </Link>
        }
        bodyClassName="p-0"
      >
        <div className="divide-y divide-line md:hidden">
          {(data?.recent_defects ?? []).map((defect: any) => (
            <Link
              key={defect.defect_id}
              to={`/defects/${defect.defect_id}`}
              data-mobile-row
              className="block px-4 py-3 transition-colors active:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium text-accent">{defect.defect_name}</p>
                  <p className="text-[11px] text-faint">{defect.defect_code} · {defect.defect_id}</p>
                </div>
                <Badge tone={severityTone(defect.severity)}>{defect.severity}</Badge>
              </div>
              <p className="mt-1.5 truncate text-[12px] text-muted">
                {defect.product_name ?? '—'} · {defect.supplier_name ?? 'no supplier'}
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-faint">
                <span>{dateShort(defect.detected_at)}</span>
                <span>· {num(defect.qty)} units</span>
                <Badge className="ml-auto" status={defect.status} dot />
              </div>
            </Link>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-[12.5px]">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Defect</th>
                <th className="px-4 py-2 font-semibold">Product</th>
                <th className="px-4 py-2 font-semibold">Supplier</th>
                <th className="px-4 py-2 font-semibold">Severity</th>
                <th className="px-4 py-2 text-right font-semibold">Qty</th>
                <th className="px-4 py-2 font-semibold">Detected</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent_defects ?? []).map((defect: any) => (
                <tr key={defect.defect_id} className="border-t border-line/70 hover:bg-slate-50/70">
                  <td className="px-4 py-2">
                    <Link to={`/defects/${defect.defect_id}`} className="font-medium text-accent hover:underline">
                      {defect.defect_name}
                    </Link>
                    <p className="text-[11px] text-faint">{defect.defect_code} · {defect.defect_id}</p>
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-2 text-muted">{defect.product_name ?? '—'}</td>
                  <td className="max-w-[150px] truncate px-4 py-2 text-muted">{defect.supplier_name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Badge tone={severityTone(defect.severity)}>{defect.severity}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right tabular">{num(defect.qty)}</td>
                  <td className="px-4 py-2 text-muted">{dateShort(defect.detected_at)}</td>
                  <td className="px-4 py-2">
                    <Badge status={defect.status} dot />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
