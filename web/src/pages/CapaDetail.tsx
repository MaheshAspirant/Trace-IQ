import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Circle, ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Drawer,
  ErrorState,
  Input,
  KeyValue,
  Modal,
  PageHeader,
  Section,
  Select,
  Stepper,
  TableSkeleton,
  useToast,
} from '../components/ui'
import { post } from '../lib/api'
import { useApi } from '../lib/useApi'
import { dateShort, dateTime, num, pct, titleCase } from '../lib/format'

const OWNERS = [
  'quality_engineer', 'supplier_quality', 'process_engineer', 'maintenance_lead',
  'production_supervisor', 'quality_manager',
]

export default function CapaDetail() {
  const { id = '' } = useParams()
  const { data, loading, error, reload } = useApi<any>(`/capas/${encodeURIComponent(id)}`)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | 'close' | 'cancel' | 'reopen'>(null)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [inspection, setInspection] = useState('')
  const [score, setScore] = useState('')
  const [note, setNote] = useState('')
  const [owner, setOwner] = useState('')
  const [drawer, setDrawer] = useState<string | null>(null)

  const capa = data?.capa
  const checklist = data?.checklist ?? []
  const options = data?.verification_options ?? []
  const events = data?.events ?? []
  const activity = data?.activity ?? []
  const defect = data?.defect

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true)
    try {
      await post(`/capas/${encodeURIComponent(id)}/actions`, body)
      toast.push({ tone: 'success', title: success })
      setConfirm(null)
      setVerifyOpen(false)
      setNoteOpen(false)
      setAssignOpen(false)
      setNote('')
      setScore('')
      reload()
    } catch (err: any) {
      toast.push({
        tone: 'error',
        title: err?.payload?.gate_reason ? 'Closure gate failed' : 'Action blocked',
        description: err.message,
      })
    } finally {
      setBusy(false)
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

  const status = capa.status
  const steps = [
    { label: 'Opened', detail: dateShort(capa.opened_at), state: 'done' as const },
    {
      label: 'Containment',
      detail: capa.containment_completed_at ? dateShort(capa.containment_completed_at) : 'Not recorded',
      state: capa.containment_completed_at ? ('done' as const) : status === 'open' ? ('current' as const) : ('todo' as const),
    },
    {
      label: 'Corrective work',
      detail: titleCase(capa.owner_role),
      state: ['in_progress', 'pending_verification'].includes(status)
        ? ('current' as const)
        : ['verified', 'closed'].includes(status)
          ? ('done' as const)
          : ('todo' as const),
    },
    {
      label: 'Verification',
      detail: capa.verified_at ? dateShort(capa.verified_at) : 'Awaiting effectiveness evidence',
      state: capa.verified_at ? ('done' as const) : status === 'pending_verification' ? ('current' as const) : ('todo' as const),
    },
    {
      label: 'Closed',
      detail: capa.closed_at ? dateShort(capa.closed_at) : '—',
      state: status === 'closed' ? ('done' as const) : ('todo' as const),
    },
  ]

  const can = {
    start: status === 'open',
    contain: ['open', 'in_progress'].includes(status),
    submit: ['open', 'in_progress'].includes(status) && Boolean(capa.containment_completed_at),
    verify: ['pending_verification', 'in_progress'].includes(status) && options.length > 0,
    close: status === 'verified',
    reopen: ['closed', 'verified', 'cancelled'].includes(status),
    cancel: !['closed', 'cancelled'].includes(status),
  }

  return (
    <div className="space-y-4">
      <Link to="/capa" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={13} /> Corrective actions
      </Link>

      <PageHeader
        title={capa.capa_id}
        subtitle={`${capa.defect_name} · root cause ${titleCase(capa.root_cause_category)} · owner ${titleCase(capa.owner_role)}`}
        meta={
          <>
            <Badge status={status} dot />
            <Badge tone={capa.days_overdue > 0 ? 'danger' : 'neutral'}>
              Due {dateShort(capa.due_at)}{capa.days_overdue > 0 ? ` · ${capa.days_overdue}d overdue` : ''}
            </Badge>
            {capa.overridden && <Badge tone="info">Workspace action recorded</Badge>}
            {status === 'closed' && !capa.closure_allowed && <Badge tone="danger">Gate violation</Badge>}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => { setOwner(capa.owner_role); setAssignOpen(true) }}>
              Reassign
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setNoteOpen(true)}>Add note</Button>
            {can.close && !capa.closure_allowed ? (
              <Button size="sm" variant="primary" disabled title="Verification required">Close</Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Lifecycle" description="CAPA must be verified before it can be closed.">
          <Stepper steps={steps} />
          <div className="mt-2 space-y-2">
            {can.start && (
              <Button variant="primary" className="w-full" onClick={() => run({ action: 'start' }, 'CAPA started')} disabled={busy}>
                Start corrective work
              </Button>
            )}
            {can.contain && !capa.containment_completed_at && (
              <Button variant="primary" className="w-full" onClick={() => run({ action: 'contain' }, 'Containment recorded')} disabled={busy}>
                Record containment
              </Button>
            )}
            {can.submit && (
              <Button variant="secondary" className="w-full" onClick={() => run({ action: 'submit_verification' }, 'Submitted for verification')} disabled={busy}>
                Submit for verification
              </Button>
            )}
            {can.verify && (
              <Button variant="primary" className="w-full" onClick={() => { setInspection(options[0]?.inspection_id ?? ''); setVerifyOpen(true) }}>
                Record verification
              </Button>
            )}
            {can.close && (
              <Button variant={capa.closure_allowed ? 'primary' : 'secondary'} className="w-full" onClick={() => setConfirm('close')} disabled={!capa.closure_allowed}>
                {capa.closure_allowed ? 'Close CAPA' : 'Closure blocked'}
              </Button>
            )}
            {can.reopen && (
              <Button variant="secondary" className="w-full" onClick={() => setConfirm('reopen')} disabled={busy}>
                Reopen
              </Button>
            )}
            {can.cancel && (
              <Button variant="ghost" className="w-full" onClick={() => setConfirm('cancel')} disabled={busy}>
                Cancel CAPA
              </Button>
            )}
            {!can.close && status === 'verified' && !capa.closure_allowed && (
              <p className="text-[11.5px] text-danger">Gate not satisfied. Record a passing verification inspection.</p>
            )}
          </div>
        </Section>

        <Section className="xl:col-span-2" title="Closure gate" description="Evaluated from the persisted verification inspection and timestamps.">
          <ul className="grid gap-2 sm:grid-cols-2">
            {checklist.map((item: any) => (
              <li key={item.key} className="flex items-start gap-2 rounded-lg border border-line p-3">
                {item.ok ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
                ) : (
                  <Circle size={16} className="mt-0.5 shrink-0 text-faint" />
                )}
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-ink">{item.label}</p>
                  <p className="truncate text-[11.5px] text-muted">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
            {can.close ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-success"><ShieldCheck size={15} /> Closure permitted — verification recorded</span>
            ) : status === 'closed' ? (
              capa.closure_allowed ? (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-success"><ShieldCheck size={15} /> Closed with verified evidence</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-warning"><ShieldAlert size={15} /> Closure not permitted — {capa.gate_reason?.replace(/_/g, ' ') ?? 'verification required'}</span>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted"><ShieldAlert size={15} className="text-faint" /> Closure requires a passing verification</span>
            )}
            <span className="text-[11.5px] text-faint">
              Effectiveness {capa.effectiveness_score != null ? pct(capa.effectiveness_score, 0) : '—'} · Verified {capa.verified_at ? dateTime(capa.verified_at) : 'not yet'}
            </span>
          </div>
          {status === 'closed' && !capa.closure_allowed && (
            <div className="mt-3 rounded-lg border border-danger/20 bg-danger-soft p-3 text-[12px] text-danger">
              This CAPA is closed without a passing verification. Reopen it, run the effectiveness inspection, then close again.
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Root cause & actions" description="Containment, corrective and preventive commitments.">
          <KeyValue
            columns={2}
            items={[
              { label: 'Root cause', value: titleCase(capa.root_cause_category) },
              { label: 'Owner', value: titleCase(capa.owner_role) },
              { label: 'Opened', value: dateShort(capa.opened_at) },
              { label: 'Due', value: dateShort(capa.due_at) },
              { label: 'Verified', value: capa.verified_at ? dateShort(capa.verified_at) : '—' },
              { label: 'Closed', value: capa.closed_at ? dateShort(capa.closed_at) : '—' },
            ]}
          />
          <div className="mt-4 space-y-3 text-[12.5px]">
            {[
              ['Containment', capa.containment_action],
              ['Corrective action', capa.corrective_action],
              ['Preventive action', capa.preventive_action],
            ].map(([label, text]) => (
              <div key={String(label)} className="rounded-lg border border-line p-3">
                <p className="label">{label}</p>
                <p className="mt-1 leading-5 text-ink">{text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Linked defect" description="Trace back to the quality event." bodyClassName="px-4 py-3">
          {defect ? (
            <div className="space-y-3">
              <Link to={`/defects/${defect.defect_id}`} className="text-[13px] font-medium text-accent hover:underline">
                {defect.defect_name}
              </Link>
              <p className="text-[11.5px] text-faint">{defect.defect_id} · {defect.defect_code}</p>
              <KeyValue
                columns={2}
                items={[
                  { label: 'Severity', value: titleCase(defect.severity) },
                  { label: 'Quantity', value: num(defect.qty) },
                  { label: 'Detected', value: dateShort(defect.detected_at) },
                  { label: 'Status', value: titleCase(defect.status) },
                  { label: 'Order', value: defect.order_id ?? '—' },
                  { label: 'Lot', value: defect.lot_id ?? '—' },
                ]}
              />
              <Link to={`/explorer?defect=${defect.defect_id}`} className="inline-flex text-[12px] font-medium text-accent">
                Trace in explorer →
              </Link>
            </div>
          ) : (
            <p className="text-[12px] text-muted">Defect record not found.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Verification evidence" description="Passing inspections linked to the same order or lot." bodyClassName="p-0">
          <div className="max-h-[300px] overflow-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="sticky top-0 bg-slate-50 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Inspection</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Inspected</th>
                  <th className="px-4 py-2 text-right font-semibold">Defects</th>
                  <th className="px-4 py-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {options.map((option: any) => (
                  <tr key={option.inspection_id} className="border-t border-line/70">
                    <td className="px-4 py-2">
                      <Link to={`/inspections/${option.inspection_id}`} className="text-accent hover:underline">{option.inspection_id}</Link>
                    </td>
                    <td className="px-4 py-2 capitalize text-muted">{option.inspection_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 text-muted">{dateTime(option.inspected_at)}</td>
                    <td className="px-4 py-2 text-right tabular">{num(option.defect_count)}</td>
                    <td className="px-4 py-2"><Badge status={option.result} dot /></td>
                  </tr>
                ))}
                {!options.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-[12px] text-muted">No passing inspection available for this scope.</td></tr>}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Audit trail" description="Generated lifecycle events and workspace actions." bodyClassName="px-4 py-3">
          <ol className="max-h-[300px] space-y-3 overflow-auto pr-1">
            {events.map((event: any) => (
              <li key={event.event_id} className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                <div>
                  <p className="text-[12.5px] font-medium text-ink">
                    {event.event_type.replace(/_/g, ' ')}
                    <span className="text-muted"> · {event.from_state ?? '—'} → {event.to_state}</span>
                  </p>
                  <p className="text-[11.5px] text-muted">{dateTime(event.occurred_at)} · {event.actor_code}</p>
                </div>
              </li>
            ))}
            {activity.map((event: any) => (
              <li key={`ops-${event.id}`} className="flex gap-3">
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
            {!events.length && !activity.length && <li className="text-[12px] text-muted">No history recorded.</li>}
          </ol>
        </Section>
      </div>

      <Modal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        title="Record verification"
        description="Select the inspection that proves the corrective action worked. It must be a passing inspection on the same order or lot."
        footer={
          <>
            <Button variant="secondary" onClick={() => setVerifyOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!inspection}
              onClick={() => run({ action: 'verify', verification_inspection_id: inspection, effectiveness_score: score ? Number(score) : undefined }, 'Verification recorded')}
            >
              Record verification
            </Button>
          </>
        }
      >
        <label className="label" htmlFor="verification">Verification inspection</label>
        <Select id="verification" value={inspection} onChange={(event) => setInspection(event.target.value)} className="mt-1">
          <option value="">Select an inspection…</option>
          {options.map((option: any) => (
            <option key={option.inspection_id} value={option.inspection_id}>
              {option.inspection_id} · {option.inspection_type} · {dateShort(option.inspected_at)} · {option.defect_count} defects
            </option>
          ))}
        </Select>
        <label className="label mt-3 block" htmlFor="score">Effectiveness score (optional, 0–1)</label>
        <Input id="score" value={score} onChange={(event) => setScore(event.target.value)} placeholder="e.g. 0.95" className="mt-1" inputMode="decimal" />
        <label className="label mt-3 block" htmlFor="verify-note">Note</label>
        <Input id="verify-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Effectiveness evidence reference" className="mt-1" />
      </Modal>

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Add investigation note"
        description="Notes are appended to the audit log and never overwrite history."
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!note.trim()} onClick={() => run({ action: 'note', note }, 'Note added')}>
              Add note
            </Button>
          </>
        }
      >
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          placeholder="What was investigated, observed or decided?"
          className="w-full rounded-lg border border-line p-2.5 text-[12.5px] text-ink focus:border-accent/50"
        />
      </Modal>

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Reassign owner"
        description="The accountable role for this corrective action."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => run({ action: 'assign', owner_role: owner }, 'Owner updated')}>
              Save owner
            </Button>
          </>
        }
      >
        <Select value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="Owner role">
          {OWNERS.map((role) => (
            <option key={role} value={role}>{titleCase(role)}</option>
          ))}
        </Select>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm === 'close' ? 'Close this CAPA?' : confirm === 'cancel' ? 'Cancel this CAPA?' : 'Reopen this CAPA?'}
        description={
          confirm === 'close'
            ? 'Closure is only possible when the gate is satisfied: containment, a passing verification inspection after containment, and verification before closure.'
            : confirm === 'cancel'
              ? 'The CAPA will be marked cancelled. This is recorded in the audit log.'
              : 'Reopening clears the verification and closure timestamps so effectiveness must be proven again.'
        }
        confirmLabel={confirm === 'close' ? 'Close CAPA' : confirm === 'cancel' ? 'Cancel CAPA' : 'Reopen CAPA'}
        tone={confirm === 'close' ? 'primary' : 'danger'}
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run({ action: confirm }, confirm === 'close' ? 'CAPA closed' : confirm === 'cancel' ? 'CAPA cancelled' : 'CAPA reopened')}
      >
        {confirm === 'close' && (
          <ul className="space-y-1.5 text-[12px]">
            {checklist.map((item: any) => (
              <li key={item.key} className="flex items-center gap-2 text-muted">
                {item.ok ? <CheckCircle2 size={13} className="text-success" /> : <Circle size={13} className="text-faint" />}
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>

      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} title="Audit detail">
        <pre className="whitespace-pre-wrap break-words text-[11.5px] text-muted">{drawer}</pre>
      </Drawer>
    </div>
  )
}
