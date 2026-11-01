import { useEffect, useState } from 'react'
import { Database, RefreshCw, Save, Trash2 } from 'lucide-react'
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
  Toggle,
  useToast,
} from '../components/ui'
import { post, put } from '../lib/api'
import { useApi } from '../lib/useApi'
import { dateShort, dateTime, num, titleCase } from '../lib/format'

export default function Settings() {
  const { data, loading, error, reload } = useApi<any>('/api/settings')
  const toast = useToast()
  const [prefs, setPrefs] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (data) setPrefs({ ...data.defaults, ...data.preferences })
  }, [data])

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )

  const dataset = data?.dataset

  async function save() {
    setSaving(true)
    try {
      await put('/api/settings', { preferences: prefs })
      toast.push({ tone: 'success', title: 'Preferences saved', description: 'Defaults apply to new table views.' })
      reload()
    } catch (err) {
      toast.push({ tone: 'error', title: 'Could not save', description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  async function clearHistory() {
    setClearing(true)
    try {
      await post('/api/settings/clear-history', {})
      toast.push({ tone: 'success', title: 'Action history cleared', description: 'Generated evidence was not modified.' })
      setClearOpen(false)
      reload()
    } catch (err) {
      toast.push({ tone: 'error', title: 'Could not clear history', description: (err as Error).message })
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        subtitle="Workspace preferences, dataset provenance and the audit log for actions recorded outside the generated evidence."
        meta={
          <>
            <Badge tone="success" dot>API {dataset?.api_version ?? '—'}</Badge>
            <Badge tone="neutral">Writable action layer</Badge>
          </>
        }
        actions={
          <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saving} onClick={save} disabled={loading}>
            Save preferences
          </Button>
        }
      />

      {loading && !data ? (
        <Card><TableSkeleton rows={5} columns={3} /></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Section className="xl:col-span-2" title="Workspace preferences" description="Applied to tables and notification badges in this browser.">
            <div className="divide-y divide-line">
              <Toggle
                label="Critical quality notifications"
                description="Show gate violations, critical defects and severe data exceptions in the notification menu."
                checked={Boolean(prefs.notify_critical)}
                onChange={(value) => setPrefs({ ...prefs, notify_critical: value })}
              />
              <Toggle
                label="Overdue CAPA reminders"
                description="Surface corrective actions that passed their committed due date."
                checked={Boolean(prefs.notify_overdue)}
                onChange={(value) => setPrefs({ ...prefs, notify_overdue: value })}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" icon={<Save size={14} />} loading={saving} onClick={save}>Save preferences</Button>
            </div>
          </Section>

          <Section title="Dataset provenance" description="Generated evidence is read-only.">
            <KeyValue
              columns={2}
              items={[
                { label: 'Profile', value: titleCase(dataset?.profile) },
                { label: 'Seed', value: String(dataset?.seed ?? '—') },
                { label: 'Version', value: dataset?.dataset_version ?? '—' },
                { label: 'Reference date', value: dateShort(dataset?.reference_date) },
                { label: 'Generated', value: dataset?.generated_at ? dateTime(dataset.generated_at) : '—' },
                { label: 'Actions recorded', value: num(dataset?.actions_recorded) },
              ]}
            />
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-[11.5px] text-muted">
              <p className="font-medium text-ink">Generator</p>
              <p className="mt-0.5 break-words font-mono text-[10.5px]">{dataset?.generator_command ?? '—'}</p>
              <p className="mt-2">Row counts</p>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {Object.entries(dataset?.row_counts ?? {}).slice(0, 10).map(([key, value]) => (
                  <span key={key} className="flex justify-between gap-2">
                    <span className="truncate">{key.replace(/_/g, ' ')}</span>
                    <span className="font-medium text-ink tabular">{num(Number(value))}</span>
                  </span>
                ))}
              </div>
            </div>
          </Section>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Action audit log" description="Append-only record of CAPA and defect actions in this workspace." bodyClassName="p-0">
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full min-w-[600px] text-left text-[12.5px]">
              <thead className="sticky top-0 bg-slate-50 text-2xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-4 py-2 font-semibold">Entity</th>
                  <th className="px-4 py-2 font-semibold">Action</th>
                  <th className="px-4 py-2 font-semibold">Transition</th>
                  <th className="px-4 py-2 font-semibold">Actor</th>
                </tr>
              </thead>
              <tbody>
                {(data?.activity ?? []).map((event: any) => (
                  <tr key={event.id} className="border-t border-line/70">
                    <td className="px-4 py-2 text-muted">{dateTime(event.created_at)}</td>
                    <td className="px-4 py-2">
                      <p className="font-medium text-ink">{event.entity_id}</p>
                      <p className="text-[11px] text-faint">{event.entity_type}</p>
                    </td>
                    <td className="px-4 py-2 capitalize text-ink">{event.action.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 text-muted">
                      {event.from_state ? `${event.from_state} → ${event.to_state}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-muted">{event.actor}</td>
                  </tr>
                ))}
                {!(data?.activity ?? []).length && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[12px] text-muted">No actions recorded yet. Open a CAPA to start.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="space-y-4">
          <Card padded>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent"><Database size={15} /></span>
              <div>
                <p className="text-[13px] font-medium text-ink">API surface</p>
                <p className="text-[11.5px] text-muted">Read model + action layer</p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-[11.5px] text-muted">
              <li><code className="text-ink">GET /api/dashboard</code></li>
              <li><code className="text-ink">GET /api/trace-graph</code></li>
              <li><code className="text-ink">POST /api/capas/:id/actions</code></li>
              <li><code className="text-ink">POST /api/defects/:id/actions</code></li>
              <li><code className="text-ink">GET /api/validation</code></li>
            </ul>
            <p className="mt-3 text-[11px] text-faint">
              The server is same-origin only and rejects cross-origin mutations.
            </p>
          </Card>

          <Card padded>
            <p className="text-[13px] font-medium text-ink">Regenerate the dataset</p>
            <p className="mt-1 text-[11.5px] text-muted">
              Generated evidence is replaced by the pipeline; workspace actions live in a separate database.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-2.5 text-[10.5px] leading-4 text-slate-200">
{`./run.sh all
./run.sh serve`}
            </pre>
            <div className="mt-3 flex items-center gap-2 text-[11.5px] text-muted">
              <RefreshCw size={13} /> Deterministic for a fixed seed
            </div>
          </Card>

          <Card padded className="border-danger/20">
            <p className="text-[13px] font-medium text-ink">Clear action history</p>
            <p className="mt-1 text-[11.5px] text-muted">
              Removes CAPA/defect overrides and audit events. The generated dataset and reports are untouched.
            </p>
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} className="mt-3" onClick={() => setClearOpen(true)}>
              Clear history
            </Button>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="Clear all workspace actions?"
        description="CAPA overrides, defect status overrides and the audit log will be deleted. This cannot be undone."
        confirmLabel="Clear history"
        loading={clearing}
        onCancel={() => setClearOpen(false)}
        onConfirm={clearHistory}
      >
        <div className="rounded-lg bg-danger-soft p-3 text-[12px] text-danger">
          Generated records, validation reports and the read-only evidence layer are not affected.
        </div>
      </ConfirmDialog>
    </div>
  )
}
