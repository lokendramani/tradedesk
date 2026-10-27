import { useLocation } from 'react-router-dom'
import { ArrowUpRight, CircleDashed } from 'lucide-react'

const pages: Record<string, { title: string; subtitle: string; detail: string }> = {
  funds: {
    title: 'My funds',
    subtitle: 'See invested value, current value, and fund returns in one place.',
    detail: 'Fund holdings and transaction-backed returns will appear here once WealthOnCruise fund data is connected.',
  },
  portfolio: {
    title: 'Portfolio',
    subtitle: 'Track your monthly equity and debt allocation.',
    detail: 'Your month-by-month portfolio tracker is being prepared. No portfolio values have been loaded.',
  },
  'monthly-expense': {
    title: 'Monthly expense',
    subtitle: 'Understand income, savings, expenditure, and investable surplus.',
    detail: 'Monthly cashflow categories and entries are not connected yet. Your account has not been changed.',
  },
  milestones: {
    title: 'Milestones',
    subtitle: 'Plan for the future with goals and monthly investment estimates.',
    detail: 'Goal inputs and SIP projections will be available when the WealthOnCruise data layer is added.',
  },
  transactions: {
    title: 'Transactions',
    subtitle: 'Review investments and redemptions in a single transaction log.',
    detail: 'No WealthOnCruise transactions are available yet. The TradeDesk transaction data is kept separate.',
  },
}

export default function WealthSection() {
  const location = useLocation()
  const key = location.pathname.split('/').filter(Boolean).at(-1) ?? ''
  const page = pages[key] ?? pages.funds

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-7 sm:px-7 sm:py-10 xl:px-10">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8b773d]">WealthOnCruise</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-[#18382f]">{page.title}</h1>
          <p className="mt-1 text-sm text-[#738078]">{page.subtitle}</p>
        </div>
        <span className="rounded-full border border-[#e2d8b9] bg-[#fff9e8] px-3 py-1.5 text-[10px] font-medium text-[#8c7130]">Data connection pending</span>
      </div>
      <section className="mt-7 rounded-2xl border border-[#e7e5dc] bg-white px-6 py-12 text-center shadow-[0_5px_16px_rgba(32,49,38,0.04)] sm:px-10 sm:py-16">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#edf4ee] text-[#438061]">
          <CircleDashed size={25} strokeWidth={1.6} />
        </div>
        <h2 className="mt-5 font-serif text-xl font-bold text-[#18382f]">Your {page.title.toLowerCase()} space is ready</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#7c8981]">{page.detail}</p>
        <p className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-[#8c7130]">This section will use your own WealthOnCruise data <ArrowUpRight size={13} /></p>
      </section>
    </div>
  )
}
