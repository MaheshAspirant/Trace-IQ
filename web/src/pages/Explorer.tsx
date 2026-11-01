import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Cog,
  ExternalLink,
  FileWarning,
  GitBranch,
  Package,
  ShieldCheck,
  Boxes,
  Search,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  KeyValue,
  PageHeader,
  Section,
  TableSkeleton,
  cx,
} from '../components/ui'
import { useApi } from '../lib/useApi'
import { dateShort, num, pct, severityTone, titleCase, toneFor } from '../lib/format'

const KIND_ICON: Record<string, JSX.Element> = {
  supplier: <Building2 size={14} />,
  lot: <Boxes size={14} />,
  product: <Package size={14} />,
  order: <ClipboardList size={14} />,
  step: <GitBranch size={14} />,
  machine: <Cog size={14} />,
  inspection: <ClipboardCheck size={14} />,
  defect: <FileWarning size={14} />,
  capa: <ShieldCheck size={14} />,
}

export default function Explorer() {
  const [params, setParams] = useSearchParams()
  const initial = (params.get('defect') ?? '').toUpperCase()
  const [term, setTerm] = useState(initial)
  const [activeId, setActiveId] = useState(initial)
  const [selected, setSelected] = useState<any>(null)

  const graph = useApi<any>(activeId ? `/trace-graph?defect_id=${encodeURIComponent(activeId)}` : null)
  const recent = useApi<any>('/defects?severity=critical&size=6&sort=detected_at&dir=desc')

  useEffect(() => {
    if (initial && initial !== activeId) {
      setTerm(initial)
      setActiveId(initial)
    }
  }, [initial, activeId])

  const data = graph.data
  const selectedNode = useMemo(
    () => (data?.nodes ?? []).find((node: any) => node.id === selected?.id),
    [data, selected],
  )

  function load(id: string) {
    const next = id.trim().toUpperCase()
    if (!next) return
    setActiveId(next)
    setTerm(next)
    setParams({ defect: next })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Traceability explorer"
        subtitle="Follow a defect backwards to its material lot and supplier, and forwards through inspection to the corrective action."
        meta={
          <>
            <Badge tone="neutral" wrap>Supplier → lot → order → machine → inspection → defect → CAPA</Badge>
            {data && <Badge tone={data.chain_complete ? 'success' : 'warning'} dot>{data.chain_complete ? 'Chain complete' : 'Chain broken'}</Badge>}
          </>
        }
      />

      <Card padded className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') load(term)
            }}
            placeholder="Enter a defect ID, e.g. DEF-2026-000001"
            icon={<Search size={14} />}
            aria-label="Defect ID"
          />
        </div>
        <Button variant="primary" onClick={() => load(term)} icon={<GitBranch size={14} />}>
          Trace defect
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            const response = await fetch('/api/sample-defect?severity=critical')
            const sample = await response.json()
            if (sample?.defect_id) load(sample.defect_id)
          }}
        >
          Load example
        </Button>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-faint">Recent critical defects:</span>
        {(recent.data?.rows ?? []).map((row: any) => (
          <button
            key={row.defect_id}
            onClick={() => load(row.defect_id)}
            className={cx(
              'rounded-md border px-2 py-1 text-[11.5px] transition-colors',
              row.defect_id === activeId
                ? 'border-accent/40 bg-accent-soft text-accent-strong'
                : 'border-line bg-white text-muted hover:text-ink',
            )}
          >
            {row.defect_id} · {row.defect_name}
          </button>
        ))}
      </div>

      {!activeId && (
        <Card>
          <EmptyState
            icon={<GitBranch size={18} />}
            title="Choose a defect to trace"
            description="Enter a defect identifier or pick one of the recent critical defects above. Every node in the resulting chain is clickable."
          />
        </Card>
      )}

      {graph.error && (
        <Card>
          <ErrorState message={graph.error} onRetry={graph.reload} />
        </Card>
      )}

      {activeId && graph.loading && (
        <Card>
          <TableSkeleton rows={5} columns={6} />
        </Card>
      )}

      {data && !graph.loading && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card padded>
              <p className="label">Defect</p>
              <p className="mt-1 truncate text-[13px] font-medium text-ink">
                {(data.nodes ?? []).find((n: any) => n.kind === 'defect')?.title}
              </p>
              <p className="text-[11.5px] text-faint">{data.defect_id}</p>
            </Card>
            <Card padded>
              <p className="label">Disposition</p>
              <p className="mt-1 text-[13px] font-medium text-ink">{data.decision.disposition.replace(/_/g, ' ')}</p>
              <p className="text-[11.5px] text-faint">{data.decision.disposition_rule}</p>
            </Card>
            <Card padded>
              <p className="label">CAPA required</p>
              <p className="mt-1 text-[13px] font-medium text-ink">{data.decision.capa_required ? 'Yes' : 'No'}</p>
              <p className="text-[11.5px] text-faint">{data.capa?.capa_id ?? 'No CAPA linked'}</p>
            </Card>
            <Card padded>
              <p className="label">Quantity at risk</p>
              <p className="mt-1 text-[13px] font-medium text-ink tabular">{num(data.containment.qty_at_risk, 2)}</p>
              <p className="text-[11.5px] text-faint">{data.chain_complete ? 'Trace spans every stage' : 'A stage is missing'}</p>
            </Card>
          </div>

          <Card>
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-[14px] font-semibold text-ink">Relationship rail</h2>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Left to right: source material, production, process, inspection, defect, corrective action. Click a node for details; scroll horizontally if the chain extends past the card.
              </p>
            </div>
            <div className="overflow-x-auto p-4 pb-3 focus-ring sm:p-5" tabIndex={0} role="region" aria-label="Trace relationship rail">
              <div className="flex min-w-[900px] items-stretch gap-2">
                {(data.stages ?? []).map((stage: any, index: number) => (
                  <div key={stage.key} className="flex items-stretch gap-2">
                    <div className="w-[155px]">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                        {stage.label}
                      </p>
                      <div className="space-y-2">
                        {stage.node_ids.length === 0 && (
                          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11.5px] text-faint">
                            No record
                          </div>
                        )}
                        {stage.node_ids.map((nodeId: string) => {
                          const node = (data.nodes ?? []).find((n: any) => n.id === nodeId)
                          if (!node) return null
                          return (
                            <button
                              key={node.id}
                              onClick={() => setSelected(node)}
                              className="w-full rounded-lg border border-line bg-white p-2.5 text-left shadow-sm transition-colors hover:border-accent/40 hover:bg-accent-soft/30"
                            >
                              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-faint">
                                <span className="text-accent">{KIND_ICON[node.kind]}</span>
                                {node.kind}
                              </span>
                              <span className="mt-1 block truncate text-[12.5px] font-medium text-ink">{node.title}</span>
                              <span className="block truncate text-[11px] text-muted">{node.subtitle}</span>
                              {node.status && (
                                <span className="mt-1.5 block">
                                  <Badge tone={toneFor(node.status)}>{node.status.replace(/_/g, ' ')}</Badge>
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {index < data.stages.length - 1 && (
                      <div className="flex w-4 items-center justify-center pt-6">
                        <ArrowRight size={14} className="text-slate-300" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Containment plan" description="Recommended actions from the trace engine." bodyClassName="px-4 py-3">
              <ul className="space-y-2 text-[12.5px] text-muted">
                {(data.containment.actions ?? []).map((line: string) => (
                  <li key={line} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-warning" />
                    {line}
                  </li>
                ))}
                {!(data.containment.actions ?? []).length && <li>No containment actions required.</li>}
              </ul>
              <p className="mt-3 text-[11.5px] text-faint">{data.containment.note}</p>
            </Section>

            <Section title="Exposure" description="Records sharing the source lot or machine window." bodyClassName="px-4 py-3">
              <KeyValue
                columns={2}
                items={[
                  { label: 'Orders sharing lot', value: num(data.exposure.orders_sharing_lot?.length ?? 0) },
                  { label: 'Lots same source', value: num(data.exposure.lots_same_source?.length ?? 0) },
                  { label: 'Orders same machine window', value: num(data.exposure.orders_same_machine_window?.length ?? 0) },
                  { label: 'Order actual quantity', value: data.nodes.find((n: any) => n.kind === 'order')?.meta?.actual ? num(data.nodes.find((n: any) => n.kind === 'order').meta.actual) : '—' },
                ]}
              />
            </Section>
          </div>
        </>
      )}

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selectedNode?.title ?? 'Record'}
        subtitle={selectedNode?.subtitle}
        footer={
          selectedNode?.href && (
            <Link to={selectedNode.href} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent">
              Open full record <ExternalLink size={13} />
            </Link>
          )
        }
      >
        {selectedNode && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                {KIND_ICON[selectedNode.kind]}
              </span>
              <div>
                <p className="text-[10.5px] uppercase tracking-wide text-faint">{selectedNode.kind}</p>
                <p className="text-[13px] font-medium text-ink">{selectedNode.title}</p>
              </div>
              {selectedNode.status && <Badge className="ml-auto" status={selectedNode.status} dot />}
            </div>
            <KeyValue columns={2} items={Object.entries(selectedNode.meta ?? {}).map(([key, value]) => ({ label: titleCase(key), value: String(value ?? '—') }))} />
            {selectedNode.kind === 'defect' && (
              <div className="rounded-lg border border-line bg-slate-50/70 p-3 text-[12px] text-muted">
                <p className="font-medium text-ink">Decision</p>
                <p className="mt-1">{data?.decision.disposition.replace(/_/g, ' ')} · {data?.decision.disposition_rule}</p>
                <p className="mt-1">{data?.decision.rationale?.[0]}</p>
              </div>
            )}
            {selectedNode.kind === 'capa' && data?.capa && (
              <div className="rounded-lg border border-line bg-slate-50/70 p-3 text-[12px] text-muted">
                <p className="font-medium text-ink">Closure gate</p>
                <p className="mt-1">
                  {data.capa.status === 'closed'
                    ? data.capa.closure_allowed
                      ? 'Closed with verified evidence.'
                      : `Gate violation — ${data.capa.gate_reason?.replace(/_/g, ' ') ?? 'verification missing'}`
                    : data.capa.verified_at
                      ? 'Verification recorded — closure permitted.'
                      : 'Closure requires a passing verification inspection.'}
                </p>
                <p className="mt-1">Due {dateShort(data.capa.due_at)} · effectiveness {data.capa.effectiveness_score != null ? pct(data.capa.effectiveness_score, 0) : '—'}</p>
              </div>
            )}
            {selectedNode.kind === 'defect' && (
              <Badge tone={severityTone(data?.nodes.find((n: any) => n.kind === 'defect')?.status)}>
                severity {data?.decision.inputs?.severity ?? '—'}
              </Badge>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
