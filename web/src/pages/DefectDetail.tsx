import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  GitBranch,
  ShieldAlert,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  KeyValue,
  PageHeader,
  Section,
  TableSkeleton,
  useToast,
  Input,
} from '../components/ui'
import { post } from '../lib/api'
import { useApi } from '../lib/useApi'
import { dateShort, dateTime, downloadCsv, num, pct, severityTone, titleCase } from '../lib/format'

const ACTION_LABEL: Record<string, string> = {
  contain: 'Record containment',
  rework: 'Send to rework',
  scrap: 'Scrap affected units',
  close: 'Close defect',
}

const CHAIN_LINK: Record<string, (record: string, orderId?: string) => string> = {
  defect: (record) => `/defects/${record}`,
  inspection: (record) => `/inspections/${record}`,
  process_step: (_record, orderId) => (orderId ? `/orders/${orderId}` : '#'),
  machine: (record) => `/machines/${record}`,
  production_order: (record) => `/orders/${record}`,
  material_lot: (record) => `/lots/${record}`,
  supplier: (record) => `/suppliers/${record}`,
}

export default function DefectDetail() {
  const { id = '' } = useParams()
  const { data, loading, error, reload } = useApi<any>(`/defects/${encodeURIComponent(id)}`)
  const toast = useToast()
  const [action, setAction] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const trace = data?.trace
  const defect = trace?.defect
  const decision = data?.decision
  const capa = data?.capa

  const chain = useMemo(() => trace?.chain ?? [], [trace])

  async function submitAction() {
    if (!action) return
    setSaving(true)
    try {
      await post(`/defects/${encodeURIComponent(id)}/actions`, { action, note })
      toast.push({ tone: 'success', title: 'Defect updated', description: `Action “${ACTION_LABEL[action]}” recorded.` })
      setAction(null)
      setNote('')
      reload()
    } catch (err) {
      toast.push({ tone: 'error', title: 'Action failed', description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

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

  const allowed: string[] = data.allowed_actions ?? []

  return (
    <div className="space-y-4">
      <Link to="/defects" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={13} /> Defect register
      </Link>

      <PageHeader
        title={defect.defect_name}
        subtitle={`${defect.defect_id} · ${defect.defect_code} · detected ${dateTime(defect.detected_at)}`}
        meta={
          <>
            <Badge tone={severityTone(defect.severity)} dot>{defect.severity}</Badge>
            <Badge status={defect.status} dot />
            <Badge tone="neutral">{titleCase(defect.category)}</Badge>
            <Badge tone="neutral">{num(defect.qty)} units</Badge>
            <Badge tone={defect.supplier_responsibility ? 'warning' : 'neutral'}>
              {defect.supplier_responsibility ? 'Supplier responsibility' : 'Internal responsibility'}
            </Badge>
          </>
        }
        actions={
          <>
            <Link to={`/explorer?defect=${defect.defect_id}`}>
              <Button size="sm" icon={<GitBranch size={14} />}>Open explorer</Button>
            </Link>
            <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv(`${defect.defect_id}-trace.csv`, chain)}>
              Export trace
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Traceability chain" description="The record path re-derived from stored rows, not from labels.">
          <ol className="space-y-0">
            {chain.map((stage: any, index: number) => {
              const href = CHAIN_LINK[stage.stage]?.(stage.record, defect.order_id)
              return (
                <li key={`${stage.stage}-${stage.record}`} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-white text-[10px] font-semibold text-muted">
                      {index + 1}
                    </span>
                    {index < chain.length - 1 && <span className="my-1 h-5 w-px bg-line" />}
                  </div>
                  <div className="pb-3">
                    <p className="text-[10.5px] uppercase tracking-wide text-faint">{stage.stage.replace(/_/g, ' ')}</p>
                    {href && href !== '#' ? (
                      <Link to={href} className="text-[13px] font-medium text-accent hover:underline">{stage.record}</Link>
                    ) : (
                      <span className="text-[13px] font-medium text-ink">{stage.record}</span>
                    )}
                    <p className="text-[12px] text-muted">{stage.detail}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </Section>

        <Section title="Disposition decision" description="Documented rule, re-derived on every request.">
          <div className="flex items-center justify-between">
            <Badge tone={decision.disposition === 'SCRAP' ? 'danger' : decision.disposition === 'RETURN_TO_SUPPLIER' ? 'warning' : 'info'}>
              {decision.disposition.replace(/_/g, ' ')}
            </Badge>
            <span className="text-[11.5px] text-faint">{decision.disposition_rule}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {Object.entries(decision.inputs ?? {}).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-line px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wide text-faint">{key.replace(/_/g, ' ')}</p>
                <p className="text-[12.5px] font-medium text-ink tabular">
                  {typeof value === 'number' && key.includes('rate') ? pct(value) : String(value)}
                </p>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1.5 text-[12px] leading-5 text-muted">
            {(decision.rationale ?? []).map((line: string) => (
              <li key={line} className="flex gap-1.5">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                {line}
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[12px] text-muted">
            CAPA required: <span className="font-medium text-ink">{decision.capa_required ? 'Yes' : 'No'}</span>
            {decision.capa_rule && <span className="text-faint"> · {decision.capa_rule}</span>}
          </div>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Containment" description="Exposure scoped from the implicated lot and machine window.">
          <div className="rounded-lg border border-line bg-slate-50/70 p-3">
            <p className="label">Quantity at risk</p>
            <p className="mt-1 text-[22px] font-semibold text-ink tabular">{num(trace.containment.qty_at_risk, 2)}</p>
            <p className="mt-1 text-[11.5px] text-muted">{trace.containment.note}</p>
          </div>
          <ul className="mt-3 space-y-1.5 text-[12px] text-muted">
            {(trace.containment.actions ?? []).map((line: string) => (
              <li key={line} className="flex gap-1.5">
                <ShieldAlert size={13} className="mt-0.5 shrink-0 text-warning" />
                {line}
              </li>
            ))}
          </ul>
          {(trace.containment.open_orders ?? []).length > 0 && (
            <div className="mt-3">
              <p className="label">Open orders consuming the lot</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {trace.containment.open_orders.slice(0, 8).map((order: any) => (
                  <Link key={order.order_id} to={`/orders/${order.order_id}`} className="rounded-md border border-line px-2 py-1 text-[11.5px] text-accent hover:bg-accent-soft">
                    {order.order_id}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Section>

        <Section title="Exposure" description="Other records that share the lot or machine window.">
          <div className="space-y-3 text-[12px]">
            {[
              ['Orders sharing the lot', trace.exposure.orders_sharing_lot?.length ?? 0],
              ['Lots from the same supplier/material (±30d)', trace.exposure.lots_same_source?.length ?? 0],
              ['Orders on the machine (±3d)', trace.exposure.orders_same_machine_window?.length ?? 0],
              ['Orders of the same product after detection', trace.downstream.orders_same_product?.length ?? 0],
              ['Later lots from the supplier', trace.downstream.affected_lots?.length ?? 0],
            ].map(([label, count]) => (
              <div key={String(label)} className="flex items-center justify-between border-b border-line/60 pb-1.5 last:border-0">
                <span className="text-muted">{label}</span>
                <span className="font-medium text-ink tabular">{num(Number(count))}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Corrective action" description="CAPA linked to this defect and its closure gate.">
          {capa ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Link to={`/capa/${capa.capa_id}`} className="text-[13px] font-medium text-accent hover:underline">{capa.capa_id}</Link>
                <Badge status={capa.status} dot />
              </div>
              <KeyValue
                columns={2}
                items={[
                  { label: 'Root cause', value: titleCase(capa.root_cause_category) },
                  { label: 'Owner', value: titleCase(capa.owner_role) },
                  { label: 'Opened', value: dateShort(capa.opened_at) },
                  { label: 'Due', value: dateShort(capa.due_at) },
                  { label: 'Verified', value: capa.verified_at ? dateShort(capa.verified_at) : '—' },
                  { label: 'Effectiveness', value: capa.effectiveness_score != null ? pct(capa.effectiveness_score, 0) : '—' },
                ]}
              />
              {capa.status === 'closed' && !capa.closure_allowed ? (
                <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">
                  Closed without a passing verification — {capa.gate_reason?.replace(/_/g, ' ')}.
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[12px] text-success">
                  <CheckCircle2 size={14} /> Gate {capa.closure_allowed ? 'satisfied' : 'open'}
                </div>
              )}
              <Link to={`/capa/${capa.capa_id}`} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent">
                Open corrective action <ExternalLink size={12} />
              </Link>
            </div>
          ) : (
            <div className="rounded-lg border border-line bg-slate-50/70 p-3 text-[12px] text-muted">
              No CAPA is linked to this defect. {decision.capa_required ? 'A corrective action is required by the decision rule.' : 'The decision rule does not require one.'}
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Investigation history" description="Generated defect record plus actions recorded in this workspace.">
          <ol className="space-y-3">
            <li className="flex gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-400" />
              <div>
                <p className="text-[12.5px] font-medium text-ink">Defect detected</p>
                <p className="text-[11.5px] text-muted">{dateTime(defect.detected_at)} · inspection {defect.inspection_id}</p>
              </div>
            </li>
            {(data.activity ?? []).map((event: any) => (
              <li key={event.id} className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                <div>
                  <p className="text-[12.5px] font-medium text-ink">
                    {event.action.replace(/_/g, ' ')}
                    {event.from_state && <span className="text-muted"> · {event.from_state} → {event.to_state}</span>}
                  </p>
                  <p className="text-[11.5px] text-muted">{event.created_at} · {event.actor}</p>
                  {event.note && <p className="text-[11.5px] text-faint">{event.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Record actions" description="State transitions permitted from the current status.">
          {allowed.length ? (
            <div className="space-y-2">
              {allowed.map((key) => (
                <Button
                  key={key}
                  variant={key === 'scrap' ? 'danger' : key === 'close' ? 'secondary' : 'primary'}
                  className="w-full justify-start"
                  onClick={() => { setAction(key); setNote('') }}
                >
                  {ACTION_LABEL[key] ?? key}
                </Button>
              ))}
              <p className="pt-1 text-[11.5px] text-faint">
                Actions are appended to the workspace audit log; the generated dataset is never modified.
              </p>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">No further transitions are available for a {defect.status} defect.</p>
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={Boolean(action)}
        title={action ? ACTION_LABEL[action] : 'Confirm action'}
        description={action ? `This records “${ACTION_LABEL[action]}” against ${defect.defect_id}.` : undefined}
        confirmLabel={action ? ACTION_LABEL[action] : 'Confirm'}
        tone={action === 'scrap' || action === 'close' ? 'danger' : 'primary'}
        loading={saving}
        onCancel={() => setAction(null)}
        onConfirm={submitAction}
      >
        <label className="label" htmlFor="defect-note">Investigation note (optional)</label>
        <Input
          id="defect-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. containment verified at end-of-line quarantine"
          className="mt-1"
        />
        <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[11.5px] text-muted">
          Decision rule expects <span className="font-medium text-ink">{decision.disposition.replace(/_/g, ' ')}</span>
          {' '}— record a note when the action deviates from it.
        </div>
      </ConfirmDialog>
    </div>
  )
}
