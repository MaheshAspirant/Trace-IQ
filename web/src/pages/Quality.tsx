import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Download, ShieldAlert, XCircle } from 'lucide-react'
import { Badge, Button, Card, ErrorState, PageHeader, Pagination, SearchInput, Section, Select, TableSkeleton, Tabs, cx } from '../components/ui'
import { qs } from '../lib/api'
import { useApi } from '../lib/useApi'
import { downloadCsv, num, pct, severityTone } from '../lib/format'

const KIND_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  DATA: 'danger',
  DECISION: 'warning',
  INVENTORY: 'info',
  TRACE: 'neutral',
}

export default function Quality() {
  const [term, setTerm] = useState('')
  const [severity, setSeverity] = useState('')
  const [type, setType] = useState('')
  const [kind, setKind] = useState('')
  const [tab, setTab] = useState('exceptions')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const { data, loading, error, reload } = useApi<any>(
    `/exceptions${qs({ q: term, severity, type, kind, page, size })}`,
  )

  if (error)
    return (
      <Card>
        <ErrorState message={error} onRetry={reload} />
      </Card>
    )

  const counts = data?.severity_counts ?? {}
  const checks = data?.validation ?? []
  const evaluation = data?.evaluation
  const failedChecks = checks.filter((check: any) => check.status !== 'PASS')

  return (
    <div className="space-y-4">
      <PageHeader
        title="Data quality & exceptions"
        subtitle="Labelled anomalies, gate violations, overdue actions and the validation evidence behind the dataset."
        meta={
          <>
            <Badge tone="danger">{num(counts.critical)} critical</Badge>
            <Badge tone="warning">{num(counts.high)} high</Badge>
            <Badge tone="info">{num(counts.medium)} medium</Badge>
            <Badge tone="neutral">{num(counts.low)} low</Badge>
          </>
        }
        actions={
          <Button size="sm" icon={<Download size={14} />} onClick={() => downloadCsv('exceptions.csv', data?.rows ?? [])} disabled={!data?.rows?.length}>
            Export page
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(counts).map(([key, value]) => (
          <Card key={key} padded className="flex items-center justify-between">
            <div>
              <p className="label">{key}</p>
              <p className="mt-1 text-[20px] font-semibold text-ink tabular">{num(Number(value))}</p>
            </div>
            <span
              className={cx(
                'flex h-8 w-8 items-center justify-center rounded-lg',
                key === 'critical' && 'bg-danger-soft text-danger',
                key === 'high' && 'bg-warning-soft text-warning',
                key === 'medium' && 'bg-info-soft text-info',
                key === 'low' && 'bg-slate-100 text-slate-500',
              )}
            >
              <ShieldAlert size={15} />
            </span>
          </Card>
        ))}
      </div>

      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'exceptions', label: 'Exception queue', count: data?.total },
            { value: 'validation', label: 'Validation evidence', count: checks.length },
            { value: 'evaluation', label: 'Engine evaluation' },
          ]}
        />

        {tab === 'exceptions' && (
          <>
            <div className="flex flex-col gap-2 border-b border-line p-3 lg:flex-row lg:items-center">
              <SearchInput
                value={term}
                onChange={(value) => { setTerm(value); setPage(1) }}
                placeholder="Search record, type or detail"
                className="lg:max-w-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Select value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1) }} aria-label="Severity" className="w-[150px]">
                  <option value="">All severity</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </Select>
                <Select value={kind} onChange={(event) => { setKind(event.target.value); setPage(1) }} aria-label="Kind" className="w-[160px]">
                  <option value="">All sources</option>
                  <option value="DATA">Data anomaly</option>
                  <option value="DECISION">Decision rule</option>
                  <option value="INVENTORY">Inventory</option>
                  <option value="TRACE">Traceability</option>
                </Select>
                <Select value={type} onChange={(event) => { setType(event.target.value); setPage(1) }} aria-label="Issue type" className="w-[260px]">
                  <option value="">All issue types</option>
                  {(data?.type_counts ?? []).map((row: any) => (
                    <option key={row.type} value={row.type}>{row.type.replace(/_/g, ' ')} ({row.count})</option>
                  ))}
                </Select>
                {(term || severity || kind || type) && (
                  <Button variant="ghost" size="sm" onClick={() => { setTerm(''); setSeverity(''); setKind(''); setType(''); setPage(1) }}>Clear</Button>
                )}
              </div>
              <span className="ml-auto hidden text-[11.5px] text-faint lg:block">{num(data?.total)} matching</span>
            </div>

            {loading ? (
              <TableSkeleton rows={8} columns={5} />
            ) : (
              <>
                {!(data?.rows ?? []).length && (
                  <p className="px-4 py-10 text-center text-[12px] text-muted md:hidden">
                    No exceptions match these filters.
                  </p>
                )}
                <div className="divide-y divide-line md:hidden">
                  {(data?.rows ?? []).map((row: any) => (
                    <div key={`${row.kind}-${row.id}-${row.rule}`} data-mobile-row className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            to={
                              row.source === 'capa' ? `/capa/${row.id}`
                                : row.source === 'defect' ? `/defects/${row.ref}`
                                  : row.source === 'material_lot' ? `/lots/${row.id}`
                                    : '#'
                            }
                            className="font-medium text-accent hover:underline"
                          >
                            {row.id}
                          </Link>
                          <p className="text-[11px] text-faint">
                            {row.source} · {row.kind}
                          </p>
                        </div>
                        <Badge tone={severityTone(row.severity)} dot>
                          {row.severity}
                        </Badge>
                      </div>
                      <p className="mt-2 text-[12px] font-medium capitalize text-ink">
                        {row.type.replace(/_/g, ' ')}
                      </p>
                      <p className="mt-1 text-[12.5px] leading-5 text-muted">{row.detail}</p>
                      <p className="mt-2 text-[12px] leading-5 text-muted">
                        <span className="font-medium text-ink">Resolve:</span> {row.action}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[900px] text-left text-[12.5px]">
                  <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Record</th>
                      <th className="px-4 py-2 font-semibold">Issue type</th>
                      <th className="px-4 py-2 font-semibold">Severity</th>
                      <th className="px-4 py-2 font-semibold">Detail</th>
                      <th className="px-4 py-2 font-semibold">Detection rule</th>
                      <th className="px-4 py-2 font-semibold">Recommended resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.rows ?? []).map((row: any) => (
                      <tr key={`${row.kind}-${row.id}-${row.rule}`} className="border-t border-line/70 align-top">
                        <td className="px-4 py-2.5">
                          <Link
                            to={
                              row.source === 'capa' ? `/capa/${row.id}`
                                : row.source === 'defect' ? `/defects/${row.ref}`
                                  : row.source === 'material_lot' ? `/lots/${row.id}`
                                    : '#'
                            }
                            className="font-medium text-accent hover:underline"
                          >
                            {row.id}
                          </Link>
                          <p className="text-[11px] text-faint">{row.source} · {row.kind}</p>
                        </td>
                        <td className="px-4 py-2.5 text-muted">{row.type.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-2.5"><Badge tone={severityTone(row.severity)} dot>{row.severity}</Badge></td>
                        <td className="max-w-[300px] px-4 py-2.5 text-muted">{row.detail}</td>
                        <td className="px-4 py-2.5 text-[11px] text-faint">{row.rule}</td>
                        <td className="max-w-[260px] px-4 py-2.5 text-muted">{row.action}</td>
                      </tr>
                    ))}
                    {!(data?.rows ?? []).length && (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-[12px] text-muted">No exceptions match these filters.</td></tr>
                    )}
                  </tbody>
                </table>
                </div>
              </>
            )}

            {data && (
              <Pagination page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} onSize={(value) => { setSize(value); setPage(1) }} />
            )}
          </>
        )}

        {tab === 'validation' && (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={failedChecks.length ? 'danger' : 'success'}>
                {checks.filter((check: any) => check.status === 'PASS').length} / {checks.length} checks pass
              </Badge>
              <span className="text-[11.5px] text-faint">Integrity, keys, domains, reconciliation, lifecycle and ground-truth separation.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[12.5px]">
                <thead className="bg-slate-50/80 text-2xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">ID</th>
                    <th className="px-3 py-2 font-semibold">Check</th>
                    <th className="px-3 py-2 font-semibold">Category</th>
                    <th className="px-3 py-2 font-semibold">Result</th>
                    <th className="px-3 py-2 font-semibold">Expected</th>
                    <th className="px-3 py-2 font-semibold">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map((check: any) => (
                    <tr key={check.id} className="border-t border-line/70">
                      <td className="px-3 py-2 font-medium text-ink">{check.id}</td>
                      <td className="px-3 py-2 text-ink">{check.name}</td>
                      <td className="px-3 py-2 capitalize text-muted">{check.category}</td>
                      <td className="px-3 py-2">
                        <span className={cx('inline-flex items-center gap-1 text-[11.5px] font-medium', check.status === 'PASS' ? 'text-success' : 'text-danger')}>
                          {check.status === 'PASS' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                          {check.status}
                        </span>
                      </td>
                      <td className="max-w-[240px] px-3 py-2 text-muted">{check.expected}</td>
                      <td className="max-w-[300px] px-3 py-2 text-muted">{check.actual}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'evaluation' && (
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-4">
              <p className="label">Decision agreement</p>
              <p className="mt-1 text-[24px] font-semibold text-ink tabular">
                {evaluation?.decision_agreement != null ? pct(evaluation.decision_agreement, 2) : '—'}
              </p>
              <p className="mt-1 text-[12px] text-muted">Engine disposition vs documented ground truth.</p>
            </div>
            <div className="rounded-lg border border-line p-4">
              <p className="label">Drift detection</p>
              <p className="mt-1 text-[24px] font-semibold text-ink tabular">
                {evaluation?.drift?.f1 != null ? pct(evaluation.drift.f1, 1) : '—'}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                Precision {pct(evaluation?.drift?.precision, 1)} · recall {pct(evaluation?.drift?.recall, 1)} on machine-weeks.
              </p>
            </div>
            <div className="sm:col-span-2 rounded-lg border border-line bg-slate-50/60 p-4">
              <p className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                <AlertTriangle size={14} className="text-warning" /> How to read this
              </p>
              <p className="mt-1.5 text-[12px] leading-5 text-muted">
                The dataset contains labelled anomalies injected after the clean baseline. The validation suite re-detects
                them from stored rows and compares the exact sets; the engine evaluation measures decisions and drift detection
                against ground truth that is never exposed to the application.
              </p>
              <Link to="/analytics" className="mt-2 inline-flex text-[12px] font-medium text-accent hover:underline">
                Review the analytics and reports view
              </Link>
            </div>
          </div>
        )}
      </Card>

      <Section title="Issue types" description="Grouped anomaly and exception counts." bodyClassName="p-0">
        <div className="grid gap-0 sm:grid-cols-2">
          {(data?.type_counts ?? []).map((row: any) => (
            <div key={row.type} className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Badge wrap tone={KIND_TONE[row.kind] ?? 'neutral'}>{row.type.replace(/_/g, ' ')}</Badge>
              </div>
              <span className="shrink-0 text-[12.5px] font-medium text-ink tabular">{num(row.count)}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
