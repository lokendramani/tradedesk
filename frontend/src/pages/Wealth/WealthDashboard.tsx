import {
  ArrowUpRight,
  CalendarDays,
  CircleCheck,
  Coins,
  Sparkles,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const sampleMonths = [
  { month: 'May', equity: 5.5, debt: 8.4, total: 13.9 },
  { month: 'Jun', equity: 5.7, debt: 8.6, total: 14.3 },
  { month: 'Jul', equity: 5.9, debt: 8.8, total: 14.7 },
  { month: 'Aug', equity: 6.1, debt: 9.0, total: 15.1 },
  { month: 'Sep', equity: 6.3, debt: 9.2, total: 15.5 },
  { month: 'Oct', equity: 6.4, debt: 9.6, total: 16.0 },
]

const sampleSips = [
  { fund: 'Nifty 50 Index Fund', amount: 10000 },
  { fund: 'Flexi Cap Fund', amount: 8000 },
  { fund: 'Debt Fund', amount: 5000 },
]

const inr = (value: number) => `₹${new Intl.NumberFormat('en-IN').format(value)}`

function Coin({ className, size, small = false }: { className: string; size: string; small?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute flex items-center justify-center rounded-full border border-[#f7df91]/80 bg-[radial-gradient(circle_at_35%_28%,#f6dc8b,#d5a63b_75%)] text-[#8f6b20] shadow-[0_7px_16px_rgba(0,0,0,0.2),inset_0_0_0_4px_rgba(255,245,194,0.35)] ${className}`}
      style={{ width: size, height: size }}
    >
      <span className={`rounded-full border border-[#a77e27]/45 font-serif font-bold leading-none ${small ? 'p-1 text-sm' : 'p-2 text-2xl'}`}>₹</span>
    </div>
  )
}

function SampleNotice() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#e8d9a8] bg-[#fff9e8] px-3.5 py-2.5 text-xs leading-5 text-[#725d2c]">
      <Sparkles size={15} className="mt-0.5 shrink-0 text-[#a47c24]" />
      <p><strong>Sample dashboard preview.</strong> Figures below are illustrative design values, not your portfolio data. Wealth data connections are not available yet.</p>
    </div>
  )
}

function MetricCard({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <section className="rounded-xl border border-[#e7e5dc] bg-white px-5 py-4 shadow-[0_5px_16px_rgba(32,49,38,0.04)]">
      <p className="text-xs font-medium text-[#7b8981]">{label}</p>
      <p className={`mt-1 font-serif text-[27px] font-bold tracking-tight ${accent ? 'text-[#247657]' : 'text-[#18382f]'}`}>{value}</p>
      <p className="mt-1 text-[11px] text-[#829087]">{detail}</p>
    </section>
  )
}

function MonthTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: typeof sampleMonths[number] }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return (
    <div className="rounded-lg border border-[#e1e5db] bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[#18382f]">{label} · total {item.total.toFixed(1)}L</p>
      <p className="mt-1 text-[#216a50]">Equity {item.equity.toFixed(1)}L</p>
      <p className="text-[#a8c4b4]">Debt {item.debt.toFixed(1)}L</p>
    </div>
  )
}

export default function WealthDashboard() {
  const sipTotal = sampleSips.reduce((sum, item) => sum + item.amount, 0)
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-7 xl:px-9">
      <SampleNotice />

      <section className="relative isolate min-h-[236px] overflow-hidden rounded-2xl bg-[linear-gradient(112deg,#0c342a_0%,#165541_64%,#1d654b_100%)] px-6 py-7 text-white shadow-[0_14px_28px_rgba(18,64,48,0.15)] sm:px-9 sm:py-8">
        <div className="relative z-10 max-w-[650px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#e8cb73]">WEALTHONCRUISE</p>
          <h1 className="mt-2 max-w-[540px] font-serif text-[30px] font-semibold leading-[1.12] tracking-tight sm:text-[38px]">
            Set it once. Let your wealth cruise.
          </h1>
          <div className="mt-5">
            <p className="text-xs text-white/75">Net worth <span className="ml-1 rounded-full border border-white/20 px-2 py-0.5 text-[9px] uppercase tracking-wide text-[#f0d77f]">sample</span></p>
            <p className="mt-0.5 font-serif text-4xl font-bold tracking-tight sm:text-[42px]">₹16,00,000</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-[#a4e1bd]"><ArrowUpRight size={14} /> +₹50,000 this month</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-[#f3e3aa]">
            <span className="rounded-full border border-[#d3b65d]/70 px-2.5 py-1">Autopilot on</span>
            <span className="rounded-full border border-[#d3b65d]/70 px-2.5 py-1">3 SIPs · next on 5 Nov</span>
            <span className="rounded-full border border-[#d3b65d]/70 px-2.5 py-1">NAV sync not connected</span>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] sm:block">
          <Coin className="right-[44%] top-[31%] opacity-90" size="52px" small />
          <Coin className="right-[25%] top-[56%] opacity-95" size="76px" />
          <Coin className="right-[5%] top-[17%]" size="112px" />
          <Coin className="right-[1%] bottom-[11%] opacity-90" size="62px" small />
        </div>
        <Coins aria-hidden="true" className="absolute -bottom-5 -right-4 text-[#d7b750]/10 sm:hidden" size={100} />
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetricCard label="Fund invested" value="₹5,75,000" detail="Sample · from transaction log" />
        <MetricCard label="Fund value" value="₹6,80,000" detail="+18.3% simple return · sample" accent />
        <MetricCard label="Portfolio XIRR" value="11.8%" detail="Sample · across all funds" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="min-w-0 rounded-xl border border-[#e7e5dc] bg-white p-4 shadow-[0_5px_16px_rgba(32,49,38,0.04)] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-serif text-lg font-bold text-[#18382f]">Month by month</h2>
              <p className="mt-0.5 text-[11px] text-[#849087]">Sample portfolio value · total in lakh</p>
            </div>
            <span className="rounded-full bg-[#f4f2e9] px-2.5 py-1 text-[10px] font-medium text-[#61756b]">May – Oct</span>
          </div>
          <div className="mt-4 h-[225px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sampleMonths} margin={{ top: 14, right: 4, left: -15, bottom: 0 }} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="#edf0e9" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#849087', fontSize: 11 }} />
                <YAxis hide domain={[0, 18]} />
                <Tooltip content={<MonthTooltip />} cursor={{ fill: '#f7f8f4' }} />
                <Bar dataKey="debt" stackId="wealth" fill="#bed2c5" radius={[0, 0, 2, 2]} />
                <Bar dataKey="equity" stackId="wealth" fill="#237457" radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="total" position="top" formatter={(value) => `${Number(value).toFixed(1)}L`} fill="#6e7b73" fontSize={9} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center gap-4 text-[10px] text-[#7c8981]">
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#237457]" /> Equity</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#bed2c5]" /> Debt</span>
          </div>
        </section>

        <section className="rounded-xl border border-[#e7e5dc] bg-white p-4 shadow-[0_5px_16px_rgba(32,49,38,0.04)] sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-serif text-lg font-bold text-[#18382f]">Autopilot SIPs</h2>
              <p className="mt-0.5 text-[11px] text-[#849087]">Sample monthly investments</p>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-[#eaf4ed] px-2.5 py-1 text-[10px] font-semibold text-[#287454]"><CircleCheck size={12} /> ON</span>
          </div>
          <div className="mt-4 divide-y divide-[#eef0e9] border-y border-[#eef0e9]">
            {sampleSips.map((item) => (
              <div key={item.fund} className="flex items-center justify-between gap-3 py-3 text-xs">
                <span className="text-[#53645b]">{item.fund}</span>
                <span className="shrink-0 font-medium tabular-nums text-[#203d32]">{inr(item.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between py-3 text-xs font-bold text-[#203d32]">
              <span>Total per month</span><span className="tabular-nums">{inr(sipTotal)}</span>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#f7f5ed] p-3 text-[11px] leading-5 text-[#718078]">
            <CalendarDays size={14} className="mt-0.5 shrink-0 text-[#a27e2d]" />
            <p>Uses 37% of this month’s ₹62,000 surplus. Next debit 5 Nov. <span className="font-medium text-[#8c7130]">Sample schedule</span></p>
          </div>
        </section>
      </div>

      <p className="mt-4 text-center text-[10px] text-[#99a198]">Sample figures mirror the design reference and are not connected to your account.</p>
    </div>
  )
}
