import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Search, X } from 'lucide-react'
import { schemeCatalogueApi, type MutualFundScheme, type SchemeCatalogueFilters, type SchemeCataloguePage } from '../../api/schemeCatalogue'
import { useAuthStore } from '../../store/authStore'
import { buildSchemeCatalogueListParams, getSchemeCataloguePageCount } from '../../utils/schemeCataloguePagination'

type Filters = { fund_house: string; asset_class: string; category: string; plan_type: string; option_type: string }
const emptyFilters: Filters = { fund_house: '', asset_class: '', category: '', plan_type: '', option_type: '' }
const emptyPage: SchemeCataloguePage = { count: 0, next: null, previous: null, results: [] }

function humanize(value: string) {
  return value ? value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown'
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <label className="min-w-[135px] flex-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#718078]">
    {label}
    <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#e1e2d8] bg-white px-3 py-2.5 text-xs font-medium normal-case tracking-normal text-[#24483d] outline-none focus:border-[#b68d2f]">
      <option value="">All {label.toLowerCase()}s</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
}

export default function SchemeCatalogue() {
  const isAdmin = useAuthStore((state) => state.user?.is_admin === true)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [pageNumber, setPageNumber] = useState(1)
  const [data, setData] = useState(emptyPage)
  const [filterOptions, setFilterOptions] = useState<SchemeCatalogueFilters | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [detailReloadKey, setDetailReloadKey] = useState(0)
  const [detail, setDetail] = useState<MutualFundScheme | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPageNumber(1)
      setSearch(query.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const loadFilters = useCallback(async () => {
    try { setFilterOptions(await schemeCatalogueApi.filters()) } catch { /* list remains usable if metadata is temporarily unavailable */ }
  }, [])

  useEffect(() => {
    let active = true
    void schemeCatalogueApi.filters().then((options) => {
      if (active) setFilterOptions(options)
    }).catch(() => { /* list remains usable if metadata is temporarily unavailable */ })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const params = buildSchemeCatalogueListParams(pageNumber, search, filters)
    const load = async () => {
      await Promise.resolve()
      if (!active) return
      setLoading(true)
      setLoadError('')
      try { setData(await schemeCatalogueApi.list(params)) } catch {
        if (active) setLoadError('The scheme catalogue could not be loaded. Check your connection and retry.')
      } finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [pageNumber, filters, search, reloadKey])

  useEffect(() => {
    if (!selectedCode) return
    let active = true
    const load = async () => {
      await Promise.resolve()
      if (!active) return
      setDetail(null)
      setDetailError('')
      setDetailLoading(true)
      try { setDetail(await schemeCatalogueApi.detail(selectedCode)) } catch {
        if (active) setDetailError('Scheme details could not be loaded. Please retry.')
      } finally { if (active) setDetailLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [selectedCode, detailReloadKey])

  const filtered = useMemo(() => Boolean(search || Object.values(filters).some(Boolean)), [search, filters])
  const pageCount = getSchemeCataloguePageCount(data.count)

  const setFilter = (key: keyof Filters, value: string) => {
    setPageNumber(1)
    setFilters((current) => ({ ...current, [key]: value }))
  }
  const clearFilters = () => {
    setQuery('')
    setSearch('')
    setFilters(emptyFilters)
    setPageNumber(1)
  }

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const result = await schemeCatalogueApi.refresh()
      setRefreshMessage({ type: 'success', text: `Catalogue refreshed: ${result.inserted} added, ${result.updated} updated, ${result.unchanged} unchanged.` })
      setReloadKey((key) => key + 1)
      void loadFilters()
    } catch (error) {
      const responseMessage = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setRefreshMessage({ type: 'error', text: responseMessage || 'Refresh failed. Please try again.' })
    } finally { setRefreshing(false) }
  }

  const fundHouses = filterOptions?.fund_houses.map((value) => ({ value, label: value })) ?? []
  const categories = filterOptions?.categories.map((value) => ({ value, label: value })) ?? []

  return <div className="mx-auto max-w-[1320px] px-4 py-7 sm:px-7 sm:py-10 xl:px-10">
    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8b773d]">WealthOnCruise</p>
    <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-serif text-3xl font-bold tracking-tight text-[#18382f]">Scheme Catalogue</h1>
        <p className="mt-1 text-sm text-[#738078]">Browse AMFI mutual fund schemes and their published identifiers.</p>
      </div>
      {isAdmin && <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg bg-[#10372e] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#17483b] disabled:cursor-wait disabled:opacity-60">
        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh Catalogue'}
      </button>}
    </div>

    {refreshMessage && <div role={refreshMessage.type === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg border px-4 py-3 text-xs ${refreshMessage.type === 'error' ? 'border-[#efd9cf] bg-[#fcf2ee] text-[#9c4d37]' : 'border-[#d4e5d8] bg-[#f0f7f1] text-[#246747]'}`}>{refreshMessage.text}</div>}

    <section className="mt-6 rounded-2xl border border-[#e7e5dc] bg-white p-4 shadow-[0_5px_16px_rgba(32,49,38,0.04)] sm:p-5">
      <div className="flex flex-wrap gap-3">
        <label className="relative min-w-[220px] flex-[2] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#718078]">Search schemes
          <Search size={15} className="absolute bottom-[11px] left-3 text-[#819087]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Scheme name, code or fund house" className="mt-1.5 w-full rounded-lg border border-[#e1e2d8] bg-white py-2.5 pl-9 pr-3 text-xs font-medium normal-case tracking-normal text-[#24483d] outline-none placeholder:text-[#a1aaa4] focus:border-[#b68d2f]" />
        </label>
        <FilterSelect label="Fund house" value={filters.fund_house} options={fundHouses} onChange={(value) => setFilter('fund_house', value)} />
        <FilterSelect label="Asset class" value={filters.asset_class} options={filterOptions?.asset_classes ?? []} onChange={(value) => setFilter('asset_class', value)} />
        <FilterSelect label="Category" value={filters.category} options={categories} onChange={(value) => setFilter('category', value)} />
        <FilterSelect label="Plan" value={filters.plan_type} options={filterOptions?.plan_types ?? []} onChange={(value) => setFilter('plan_type', value)} />
        <FilterSelect label="Option" value={filters.option_type} options={filterOptions?.option_types ?? []} onChange={(value) => setFilter('option_type', value)} />
      </div>
      {filtered && <button type="button" onClick={clearFilters} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#547367] hover:text-[#18382f]">Clear filters <X size={13} /></button>}
    </section>

    <section className="mt-4 overflow-hidden rounded-2xl border border-[#e7e5dc] bg-white shadow-[0_5px_16px_rgba(32,49,38,0.04)]">
      {loading ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-[#718078]"><LoaderCircle size={17} className="animate-spin" />Loading schemes…</div>
        : loadError ? <div className="p-10 text-center"><p role="alert" className="text-sm text-[#9c4d37]">{loadError}</p><button type="button" onClick={() => setReloadKey((key) => key + 1)} className="mt-3 rounded-lg border border-[#d7ded5] px-3 py-2 text-xs font-semibold text-[#315b4d]">Retry</button></div>
          : data.count === 0 ? <div className="px-6 py-14 text-center"><h2 className="font-serif text-lg font-bold text-[#18382f]">{filtered ? 'No matching schemes' : 'Catalogue is empty'}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#7c8981]">{filtered ? 'Try a different search or clear your filters.' : 'The catalogue is empty. Try again shortly while it initializes.'}</p>{filtered && <button onClick={clearFilters} className="mt-4 text-xs font-semibold text-[#8c7130]">Clear filters</button>}</div>
            : <>
              <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left">
                <thead className="border-b border-[#ecece5] bg-[#fafaf6] text-[10px] uppercase tracking-[0.12em] text-[#78857d]"><tr><th className="px-5 py-3.5 font-semibold">Scheme name</th><th className="px-4 py-3.5 font-semibold">Fund house</th><th className="px-4 py-3.5 font-semibold">Category</th><th className="px-4 py-3.5 font-semibold">Asset class</th><th className="px-4 py-3.5 font-semibold">Plan</th><th className="px-4 py-3.5 font-semibold">Option</th><th className="px-4 py-3.5 font-semibold">Code</th></tr></thead>
                <tbody className="divide-y divide-[#f0f0ea]">{data.results.map((scheme) => <tr key={scheme.scheme_code} onClick={() => setSelectedCode(scheme.scheme_code)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelectedCode(scheme.scheme_code) }} className="cursor-pointer text-xs text-[#53675e] transition hover:bg-[#fbfaf4] focus:bg-[#fbfaf4]"><td className="max-w-[330px] px-5 py-3.5 font-semibold text-[#24483d]">{scheme.scheme_name}</td><td className="px-4 py-3.5">{scheme.fund_house || '—'}</td><td className="max-w-[230px] px-4 py-3.5">{scheme.category_name || '—'}</td><td className="px-4 py-3.5">{humanize(scheme.asset_class)}</td><td className="px-4 py-3.5">{humanize(scheme.plan_type)}</td><td className="px-4 py-3.5">{humanize(scheme.option_type)}</td><td className="px-4 py-3.5 font-mono text-[11px]">{scheme.scheme_code}</td></tr>)}</tbody>
              </table></div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ecece5] px-4 py-3 text-xs text-[#78857d]"><span>{data.count.toLocaleString()} schemes · Page {pageNumber} of {pageCount}</span><div className="flex gap-2"><button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => Math.max(1, page - 1))} className="inline-flex items-center gap-1 rounded-md border border-[#e1e2d8] px-3 py-2 font-medium text-[#315b4d] disabled:opacity-40"><ChevronLeft size={14} />Previous</button><button type="button" disabled={pageNumber >= pageCount} onClick={() => setPageNumber((page) => Math.min(pageCount, page + 1))} className="inline-flex items-center gap-1 rounded-md border border-[#e1e2d8] px-3 py-2 font-medium text-[#315b4d] disabled:opacity-40">Next<ChevronRight size={14} /></button></div></div>
            </>}
    </section>

    {selectedCode && <div className="fixed inset-0 z-50 flex justify-end bg-[#10251f]/35" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedCode(null) }}>
      <aside role="dialog" aria-modal="true" aria-labelledby="scheme-detail-heading" className="h-full w-full max-w-lg overflow-y-auto bg-[#fffef9] p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8b773d]">AMFI scheme details</p><h2 id="scheme-detail-heading" className="mt-2 font-serif text-xl font-bold text-[#18382f]">{detail?.scheme_name ?? 'Scheme details'}</h2></div><button type="button" onClick={() => setSelectedCode(null)} aria-label="Close scheme details" className="rounded-lg p-2 text-[#65776f] hover:bg-[#f2f0e6]"><X size={18} /></button></div>
        {detailLoading ? <div className="flex items-center gap-2 py-10 text-sm text-[#718078]"><LoaderCircle size={16} className="animate-spin" />Loading details…</div>
          : detailError ? <div className="py-6"><p role="alert" className="text-sm text-[#9c4d37]">{detailError}</p><button onClick={() => setDetailReloadKey((key) => key + 1)} className="mt-3 text-xs font-semibold text-[#315b4d]">Retry</button></div>
            : detail && <><p className="mt-2 font-mono text-xs text-[#7b877f]">Scheme code {detail.scheme_code}</p><dl className="mt-6 divide-y divide-[#e9e8df] rounded-xl border border-[#e7e5dc] bg-white px-4">{[
              ['Fund house', detail.fund_house], ['Category', detail.category_name], ['Asset class', humanize(detail.asset_class)], ['Plan', humanize(detail.plan_type)], ['Option', humanize(detail.option_type)],
            ].map(([label, value]) => <div key={label} className="flex justify-between gap-5 py-3"><dt className="text-xs text-[#829087]">{label}</dt><dd className="text-right text-xs font-semibold text-[#315b4d]">{value || 'Not available'}</dd></div>)}</dl><h3 className="mt-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8b773d]">Available ISINs</h3><dl className="mt-2 divide-y divide-[#e9e8df] rounded-xl border border-[#e7e5dc] bg-white px-4">{[['Growth', detail.isin_growth], ['IDCW payout', detail.isin_div_payout], ['IDCW reinvestment', detail.isin_div_reinvestment]].map(([label, value]) => <div key={label} className="flex justify-between gap-5 py-3"><dt className="text-xs text-[#829087]">{label}</dt><dd className="font-mono text-right text-[11px] text-[#315b4d]">{value || 'Not available'}</dd></div>)}</dl><p className="mt-6 rounded-lg bg-[#f4f2e9] p-3 text-xs leading-5 text-[#718078]">Historical NAV integration is a future milestone. This catalogue contains scheme metadata only.</p></>}
      </aside>
    </div>}
  </div>
}
