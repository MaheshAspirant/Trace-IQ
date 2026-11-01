import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { monthLabel, num, pct } from '../lib/format'
import { EmptyState, cx } from './ui'

const AXIS = { fontSize: 11, fill: '#94a3b8' }
const GRID = '#eef0f3'
const ACCENT = '#2f6fed'
const TEAL = '#0f9d58'
const AMBER = '#c77700'
const RED = '#d92d20'
const SLATE = '#94a3b8'

function TooltipBox({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 shadow-pop">
      {label !== undefined && (
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
          {typeof label === 'string' && /^\d{4}-\d{2}$/.test(label) ? monthLabel(label) : label}
        </p>
      )}
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4 text-[12px]">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-2 w-2 rounded-sm" style={{ background: entry.color }} />
            {entry.name}
          </span>
          <span className="font-medium text-ink tabular">
            {formatter ? formatter(entry.value, entry.name, entry) : num(entry.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function ChartFrame({
  children,
  height = 240,
  empty,
  emptyLabel = 'No data for this selection',
}: {
  children: React.ReactElement
  height?: number
  empty?: boolean
  emptyLabel?: string
}) {
  if (empty) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <EmptyState title={emptyLabel} />
      </div>
    )
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}

export function QualityTrend({
  data,
  height = 260,
}: {
  data: Array<Record<string, any>>
  height?: number
}) {
  return (
    <ChartFrame height={height} empty={!data.length}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(value: number) => `${(value * 100).toFixed(1)}%`}
          tick={AXIS}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={
            <TooltipBox
              formatter={(value: number, name: string) =>
                name === 'Defect rate' ? pct(value) : num(value)
              }
            />
          }
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 11, color: '#64748b' }}
        />
        <Bar yAxisId="left" dataKey="defect_qty" name="Defect quantity" fill={ACCENT} opacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={26} />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="defect_rate"
          name="Defect rate"
          stroke={AMBER}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </ComposedChart>
    </ChartFrame>
  )
}

export function VolumeTrend({ data, height = 220 }: { data: Array<Record<string, any>>; height?: number }) {
  return (
    <ChartFrame height={height} empty={!data.length}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
        <Tooltip content={<TooltipBox />} />
        <Area
          type="monotone"
          dataKey="inspected_qty"
          name="Inspected units"
          stroke={TEAL}
          fill={TEAL}
          fillOpacity={0.12}
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="defect_qty"
          name="Defect quantity"
          stroke={RED}
          fill={RED}
          fillOpacity={0.1}
          strokeWidth={2}
        />
        <Legend verticalAlign="top" align="right" height={26} iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
      </AreaChart>
    </ChartFrame>
  )
}

export function RankedBars({
  data,
  nameKey = 'name',
  valueKey = 'qty',
  color = ACCENT,
  height = 240,
  labelWidth = 130,
  secondaryKey,
}: {
  data: Array<Record<string, any>>
  nameKey?: string
  valueKey?: string
  color?: string
  height?: number
  labelWidth?: number
  secondaryKey?: string
}) {
  return (
    <ChartFrame height={height} empty={!data.length}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey={nameKey}
          width={labelWidth}
          tick={{ ...AXIS, width: labelWidth }}
          tickFormatter={(value: string) => (value.length > 22 ? `${value.slice(0, 21)}…` : value)}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<TooltipBox formatter={(value: number) => num(value)} />} />
        <Bar dataKey={valueKey} name="Defect qty" fill={color} radius={[0, 3, 3, 0]} maxBarSize={16}>
          {secondaryKey &&
            data.map((row, index) => (
              <Cell key={index} fill={row[secondaryKey] === 'critical' ? RED : color} />
            ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}

export function ParetoChart({ data, height = 280 }: { data: Array<Record<string, any>>; height?: number }) {
  return (
    <ChartFrame height={height} empty={!data.length}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="code" tick={{ ...AXIS, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-28} textAnchor="end" height={58} />
        <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
          tick={AXIS}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<TooltipBox formatter={(value: number, name: string) => (name === 'Cumulative' ? pct(value) : num(value))} />} />
        <Bar yAxisId="left" dataKey="qty" name="Defect qty" fill={ACCENT} radius={[3, 3, 0, 0]} maxBarSize={30} />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cumulative"
          name="Cumulative"
          stroke={AMBER}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ChartFrame>
  )
}

const DONUT_COLORS = ['#2f6fed', '#0f9d58', '#c77700', '#d92d20', '#7c3aed', '#0e7490']

export function CategoryDonut({
  data,
  height = 240,
}: {
  data: Array<{ category: string; qty: number }>
  height?: number
}) {
  const total = data.reduce((sum, row) => sum + row.qty, 0)
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div style={{ height, width: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="qty"
              nameKey="category"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((_, index) => (
                <Cell key={index} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox formatter={(value: number) => num(value)} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-2">
        {data.map((row, index) => (
          <li key={row.category} className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }}
              />
              <span className="truncate capitalize">{row.category}</span>
            </span>
            <span className="shrink-0 text-ink tabular">
              {num(row.qty)}
              <span className="ml-1.5 text-[11px] text-faint">
                {total ? `${Math.round((row.qty / total) * 100)}%` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const DECISION_COLORS: Record<string, string> = {
  BLOCK_AND_AUDIT: RED,
  ESCALATE_8D: AMBER,
  CONDITIONAL_MONITOR: ACCENT,
  MONITOR: TEAL,
}

export function SupplierScatter({
  data,
  height = 280,
}: {
  data: Array<Record<string, any>>
  height?: number
}) {
  return (
    <ChartFrame height={height} empty={!data.length}>
      <ScatterChart margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis
          type="number"
          dataKey="lots"
          name="Lots received"
          tick={AXIS}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="number"
          dataKey="incoming_defect_rate"
          name="Incoming defect rate"
          tickFormatter={(value: number) => `${(value * 100).toFixed(1)}%`}
          tick={AXIS}
          axisLine={false}
          tickLine={false}
        />
        <ZAxis type="number" dataKey="attributed_qty" range={[30, 150]} />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null
            const row = payload[0].payload
            return (
              <div className="rounded-lg border border-line bg-white px-3 py-2 shadow-pop">
                <p className="text-[12px] font-medium text-ink">{row.name}</p>
                <p className="text-[11.5px] text-muted">{row.supplier_id}</p>
                <p className="mt-1 text-[11.5px] text-ink">
                  {pct(row.incoming_defect_rate)} incoming · {row.lots} lots
                </p>
                <p className="text-[11px] text-muted">{row.decision.replace(/_/g, ' ')}</p>
              </div>
            )
          }}
        />
        <Scatter data={data} name="Suppliers">
          {data.map((row, index) => (
            <Cell key={index} fill={DECISION_COLORS[row.decision] ?? SLATE} fillOpacity={0.8} />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartFrame>
  )
}

export function DriftChart({
  weeks,
  height = 260,
}: {
  weeks: Array<Record<string, any>>
  height?: number
}) {
  const data = weeks.map((week) => ({ ...week, label: week.week_start?.slice(5) }))
  return (
    <ChartFrame height={height} empty={!data.length}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={(value: number) => `${(value * 100).toFixed(1)}%`}
          tick={AXIS}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={
            <TooltipBox
              formatter={(value: number, name: string) => `${(value * 100).toFixed(2)}% ${name === 'Baseline' ? 'baseline' : ''}`}
            />
          }
        />
        <ReferenceLine y={0} stroke="transparent" />
        <Line type="monotone" dataKey="scrap_rate" name="Scrap rate" stroke={ACCENT} strokeWidth={2} dot={false} />
        <Line
          type="monotone"
          dataKey="baseline_rate"
          name="Baseline"
          stroke={SLATE}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
        />
      </LineChart>
    </ChartFrame>
  )
}

export function Sparkline({
  data,
  dataKey = 'value',
  color = ACCENT,
  height = 34,
}: {
  data: Array<Record<string, any>>
  dataKey?: string
  color?: string
  height?: number
}) {
  if (!data.length) return <div style={{ height }} />
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            fill={color}
            fillOpacity={0.14}
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function MiniBars({ data, color = ACCENT }: { data: number[]; color?: string }) {
  return (
    <div className="flex h-9 items-end gap-[3px]">
      {data.map((value, index) => {
        const max = Math.max(...data, 1)
        return (
          <span
            key={index}
            className={cx('w-1.5 rounded-sm')}
            style={{ height: `${Math.max(8, (value / max) * 100)}%`, background: color, opacity: 0.35 + (index / data.length) * 0.65 }}
          />
        )
      })}
    </div>
  )
}
