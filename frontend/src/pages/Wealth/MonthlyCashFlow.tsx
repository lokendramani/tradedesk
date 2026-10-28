import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Archive,
  Check,
  CircleAlert,
  CirclePlus,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import {
  cashFlowApi,
  type CashFlowCategory,
  type CashFlowEntry,
  type CashFlowProfile,
  type CashFlowSection,
} from '../../api/cashFlow'

const sections: { key: CashFlowSection; title: string; description: string; color: string; soft: string }[] = [
  { key: 'INCOME', title: 'Income', description: 'Monthly take-home and other recurring income.', color: '#2f795d', soft: '#eaf3ec' },
  { key: 'SAVINGS', title: 'Savings', description: 'Investments and other monthly saving commitments.', color: '#b1842e', soft: '#f8f1df' },
  { key: 'EXPENSES', title: 'Expenses', description: 'Recurring household and personal spending.', color: '#b96a4e', soft: '#f9eeea' },
]

const suggestedCategories: Record<CashFlowSection, string[]> = {
  INCOME: ['Salary', 'Business income', 'Rental income', 'Interest', 'Other income'],
  SAVINGS: ['Recurring investments', 'Other savings', 'Existing commitments'],
  EXPENSES: ['Household', 'Utilities', 'Insurance', 'Education', 'Travel', 'Other spending'],
}

const expenseColors = ['#2f795d', '#b1842e', '#719786', '#cf997f', '#96b7a4', '#c5aa68', '#9a7950']
const currency = (value: string | number) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0)}`

function errorText(error: unknown) {
  const data = (error as { response?: { data?: unknown } })?.response?.data
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([field, value]) => {
      const message = Array.isArray(value) ? value.join(' ') : String(value)
      return `${field === 'detail' ? '' : `${field}: `}${message}`
    }).join(' ')
  }
  return 'We could not save that change. Please try again.'
}

function categoryFieldError(error: unknown) {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data
  const value = data?.name
  if (Array.isArray(value) && value.length) return value.join(' ')
  if (typeof value === 'string') return value
  return ''
}

type EntryDraft = { section: CashFlowSection; id?: number; name: string; category: string; amount: string }
type CategoryDraft = { section: CashFlowSection; id?: number; name: string }
type ToastMessage = { type: 'success' | 'error'; message: string }

function SummaryCard({ title, amount, detail, accent = 'green', emphasis = false }: {
  title: string; amount: string; detail: string; accent?: 'green' | 'gold' | 'rose'; emphasis?: boolean
}) {
  const tones = {
    green: 'border-[#d4e5d8] bg-[#f0f7f1] text-[#1f694b]',
    gold: 'border-[#eadfbd] bg-[#fcf8eb] text-[#8d6b23]',
    rose: 'border-[#efd9cf] bg-[#fcf2ee] text-[#a4533a]',
  }
  return (
    <section className={`rounded-2xl border px-4 py-4 sm:px-5 ${emphasis ? 'shadow-[0_8px_22px_rgba(36,104,74,0.1)] ring-1 ring-[#d7e8db]' : 'shadow-[0_4px_14px_rgba(32,49,38,0.035)]'} ${tones[accent]}`}>
      <p className="text-xs font-semibold text-current/75">{title}</p>
      <p className="mt-2 font-serif text-[25px] font-bold tracking-tight sm:text-[28px]">{amount}</p>
      <p className="mt-1 text-[10px] leading-4 text-current/70">{detail}</p>
    </section>
  )
}

function CategoryDistribution({ breakdown, savingsRate }: { breakdown: CashFlowProfile['expense_breakdown']; savingsRate: string }) {
  const distribution = useMemo(() => breakdown.map((item) => ({ name: item.category_name, amount: Number(item.amount) })), [breakdown])
  const total = distribution.reduce((sum, category) => sum + category.amount, 0)

  return (
    <section className="rounded-2xl border border-[#e8e5da] bg-white p-5 shadow-[0_5px_16px_rgba(32,49,38,0.035)] sm:p-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9a7a35]">At a glance</p>
        <h2 className="mt-1 font-serif text-xl font-bold text-[#18382f]">Monthly allocation</h2>
        <p className="mt-1 text-xs text-[#78867e]">See where income is committed and what remains available.</p>
      </div>
      {total === 0 ? (
        <div className="mt-5 flex min-h-[124px] items-center justify-center rounded-xl bg-[#faf9f5] px-5 text-center text-xs leading-5 text-[#87928a]">
          Add monthly entries to see your income allocation and expense categories.
        </div>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_1.1fr] sm:items-center">
          <div className="h-[155px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distribution} dataKey="amount" nameKey="name" innerRadius={43} outerRadius={66} paddingAngle={2} stroke="none">
                  {distribution.map((item, index) => <Cell key={item.name} fill={expenseColors[index % expenseColors.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => currency(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {distribution.map((item, index) => (
              <div key={item.name} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-[#66766d]">
                  <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: expenseColors[index % expenseColors.length] }} />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-[#294638]">{currency(item.amount)} <span className="text-[10px] text-[#94a098]">{Math.round(item.amount / total * 100)}%</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4 border-t border-[#eeede7] pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#98a198]">Savings rate</p>
        <p className="mt-1 font-serif text-2xl font-bold text-[#8d6b23]">{Number(savingsRate).toFixed(2)}%</p>
        <p className="mt-0.5 text-[10px] text-[#89948d]">Monthly savings as a share of income.</p>
      </div>
    </section>
  )
}

function EntryEditor({
  draft, categories, saving, categoryError, onChange, onSave, onCancel, onCreateCategory, onManageCategories,
}: {
  draft: EntryDraft
  categories: CashFlowCategory[]
  saving: boolean
  categoryError: string
  onChange: (draft: EntryDraft) => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  onCreateCategory: (name: string) => Promise<CashFlowCategory | null>
  onManageCategories: () => void
}) {
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const activeCategories = categories.filter((category) => category.section === draft.section && !category.is_archived)
  const archivedCurrentCategory = draft.id
    ? categories.find((category) => category.id === Number(draft.category) && category.is_archived)
    : undefined
  const canUseCategory = activeCategories.length > 0 || Boolean(archivedCurrentCategory)
  const addCategoryOption = '__add_new_category__'

  const handleCategoryChange = (value: string) => {
    if (value === addCategoryOption) {
      setCreatingCategory(true)
      setNewCategoryName('')
      return
    }
    setCreatingCategory(false)
    onChange({ ...draft, category: value })
  }

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim()
    if (!name) return
    const category = await onCreateCategory(name)
    if (category) {
      onChange({ ...draft, category: String(category.id) })
      setCreatingCategory(false)
      setNewCategoryName('')
    }
  }

  return (
    <form onSubmit={onSave} className="mt-3 rounded-xl border border-[#e5e4d9] bg-[#fbfaf6] p-3.5 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[11px] font-semibold text-[#5f7067]">
          Entry name
          <input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} required maxLength={120} placeholder="e.g. Monthly salary" className="mt-1.5 w-full rounded-lg border border-[#dedfd5] bg-white px-3 py-2.5 text-sm font-normal text-[#294638] outline-none focus:border-[#739c81] focus:ring-2 focus:ring-[#739c81]/15" />
        </label>
        <label className="text-[11px] font-semibold text-[#5f7067]">
          Category
          <select value={creatingCategory ? addCategoryOption : draft.category} onChange={(event) => handleCategoryChange(event.target.value)} required disabled={saving} className="mt-1.5 w-full rounded-lg border border-[#dedfd5] bg-white px-3 py-2.5 text-sm font-normal text-[#294638] outline-none focus:border-[#739c81] disabled:bg-[#f3f2ec]">
            <option value="">Choose a category</option>
            {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            {archivedCurrentCategory && <option value={archivedCurrentCategory.id}>{archivedCurrentCategory.name} · archived</option>}
            <option value={addCategoryOption}>+ Add new category</option>
          </select>
        </label>
        <label className="text-[11px] font-semibold text-[#5f7067] sm:col-span-2">
          Monthly amount (INR)
          <div className="mt-1.5 flex items-center rounded-lg border border-[#dedfd5] bg-white px-3 focus-within:border-[#739c81] focus-within:ring-2 focus-within:ring-[#739c81]/15">
            <span className="text-sm text-[#9a7a35]">₹</span>
            <input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.amount} onChange={(event) => onChange({ ...draft, amount: event.target.value })} required placeholder="0.00" className="w-full border-0 bg-transparent px-2 py-2.5 text-sm font-normal text-[#294638] outline-none" />
          </div>
        </label>
      </div>
      {creatingCategory && (
        <div className="mt-3 rounded-lg border border-[#e4ddc5] bg-[#fffdf6] p-3">
          <label className="block text-[10px] font-semibold text-[#6d684f]" htmlFor={`new-category-${draft.section}`}>
            New {sections.find((section) => section.key === draft.section)?.title.toLowerCase()} category
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id={`new-category-${draft.section}`}
              autoFocus
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void handleCreateCategory() } }}
              maxLength={80}
              aria-invalid={Boolean(categoryError)}
              aria-describedby={categoryError ? `new-category-error-${draft.section}` : undefined}
              placeholder="e.g. Consulting income"
              className="min-w-0 flex-1 rounded-lg border border-[#dedfd5] bg-white px-3 py-2.5 text-sm font-normal text-[#294638] outline-none focus:border-[#739c81] focus:ring-2 focus:ring-[#739c81]/15"
            />
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => { setCreatingCategory(false); setNewCategoryName('') }} className="rounded-lg px-3 py-2 text-xs font-semibold text-[#718078] hover:bg-[#efeee7]">Cancel</button>
              <button type="button" onClick={() => { void handleCreateCategory() }} disabled={saving || !newCategoryName.trim()} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1d6247] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#164d38] disabled:opacity-50"><Plus size={13} /> Create &amp; select</button>
            </div>
          </div>
          {categoryError && <p id={`new-category-error-${draft.section}`} role="alert" className="mt-2 text-xs leading-5 text-[#a4533a]">{categoryError}</p>}
        </div>
      )}
      {!canUseCategory && !creatingCategory && (
        <p className="mt-2 text-xs text-[#8c7130]">Create a category in this section before adding an entry.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {!activeCategories.length ? <button type="button" onClick={() => { setCreatingCategory(true); setNewCategoryName('') }} className="text-xs font-semibold text-[#277250]">+ Add new category</button> : <span className="text-[10px] text-[#929a93]">Draft only · not saved yet</span>}
        <button type="button" onClick={onManageCategories} className="text-[10px] font-medium text-[#8d6b23] hover:underline">Manage categories</button>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg px-3 py-2 text-xs font-semibold text-[#718078] hover:bg-[#efeee7] disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving || creatingCategory || !canUseCategory} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1d6247] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#164d38] disabled:opacity-50"><Save size={13} /> Save entry</button>
        </div>
      </div>
    </form>
  )
}

function SectionPanel({
  section, entries, sectionTotal, categories, draft, categoryEditor, saving, onAddEntry, onEditEntry,
  categoryError, onDeleteEntry, onDraftChange, onSaveEntry, onCancelEntry, onManageCategories,
  onCreateCategory, onEditCategory, onArchiveCategory, onRestoreCategory, categoryDraft, onCategoryDraftChange, onSaveCategory, onCancelCategory,
}: {
  section: typeof sections[number]
  entries: CashFlowEntry[]
  sectionTotal: string
  categories: CashFlowCategory[]
  draft: EntryDraft | null
  categoryEditor: boolean
  saving: boolean
  categoryError: string
  onAddEntry: () => void
  onEditEntry: (entry: CashFlowEntry) => void
  onDeleteEntry: (entry: CashFlowEntry) => void
  onDraftChange: (draft: EntryDraft) => void
  onSaveEntry: (event: FormEvent<HTMLFormElement>) => void
  onCancelEntry: () => void
  onManageCategories: () => void
  onCreateCategory: (name: string) => Promise<CashFlowCategory | null>
  onEditCategory: (category: CashFlowCategory) => void
  onArchiveCategory: (category: CashFlowCategory) => void
  onRestoreCategory: (category: CashFlowCategory) => void
  categoryDraft: CategoryDraft | null
  onCategoryDraftChange: (draft: CategoryDraft) => void
  onSaveCategory: (event: FormEvent<HTMLFormElement>) => void
  onCancelCategory: () => void
}) {
  const activeCategories = categories.filter((category) => category.section === section.key && !category.is_archived)
  const allCategories = categories.filter((category) => category.section === section.key)
  return (
    <section className="rounded-2xl border border-[#e8e5da] bg-white p-4 shadow-[0_5px_16px_rgba(32,49,38,0.035)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: section.soft, color: section.color }}><span className="font-serif text-lg font-bold">{section.key === 'INCOME' ? '↑' : section.key === 'SAVINGS' ? '◈' : '↓'}</span></span>
          <div className="min-w-0">
            <h2 className="font-serif text-lg font-bold text-[#18382f]">{section.title}</h2>
            <p className="mt-0.5 text-[10px] leading-4 text-[#849087]">{section.description}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-[#929b94]">Monthly total</p>
          <p className="mt-0.5 font-serif text-lg font-bold text-[#294638]">{currency(sectionTotal)}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-b border-[#efeee8] pb-3">
        <p className="text-[10px] font-medium text-[#99a198]">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</p>
        <div className="flex gap-1.5">
          <button type="button" onClick={onManageCategories} className={`rounded-lg px-2.5 py-2 text-[10px] font-semibold ${categoryEditor ? 'bg-[#f5f1e4] text-[#8d6b23]' : 'text-[#738078] hover:bg-[#f5f4ee]'}`}>Categories</button>
          <button type="button" onClick={onAddEntry} className="inline-flex items-center gap-1 rounded-lg bg-[#eaf3ec] px-2.5 py-2 text-[10px] font-semibold text-[#276a4b] hover:bg-[#deecdf]"><Plus size={13} /> Add entry</button>
        </div>
      </div>

      {entries.length ? (
        <div className="divide-y divide-[#f0efe9]">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[#334f40]">{entry.name}</p>
                <p className="mt-0.5 truncate text-[10px] text-[#929a94]">{entry.category_name}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold tabular-nums text-[#304d3d]">{currency(entry.amount)}</span>
                <button type="button" onClick={() => onEditEntry(entry)} aria-label={`Edit ${entry.name}`} className="rounded-md p-1.5 text-[#85928a] hover:bg-[#edf3ed] hover:text-[#2b7050]"><Pencil size={13} /></button>
                <button type="button" onClick={() => onDeleteEntry(entry)} aria-label={`Remove ${entry.name}`} disabled={saving} className="rounded-md p-1.5 text-[#a1958e] hover:bg-[#faefeb] hover:text-[#a4533a] disabled:opacity-50"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-5 text-center">
          <p className="text-xs font-medium text-[#74837a]">No {section.title.toLowerCase()} entries yet</p>
          <p className="mt-1 text-[10px] text-[#9aa39c]">Start with a recurring amount. Nothing is prefilled.</p>
        </div>
      )}

      {draft?.section === section.key && (
        <EntryEditor
          draft={draft}
          categories={categories}
          saving={saving}
          categoryError={categoryError}
          onChange={onDraftChange}
          onSave={onSaveEntry}
          onCancel={onCancelEntry}
          onCreateCategory={(name) => onCreateCategory(name)}
          onManageCategories={onManageCategories}
        />
      )}

      {categoryEditor && (
        <div className="mt-3 rounded-xl border border-[#eae5d6] bg-[#fcfaf3] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div><p className="text-xs font-semibold text-[#445e4e]">Categories</p><p className="mt-0.5 text-[10px] text-[#89948c]">Rename or archive labels. Existing amounts stay in your totals.</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {allCategories.map((category) => (
              <div key={category.id} className={`flex items-center gap-1 rounded-full border px-2.5 py-1 ${category.is_archived ? 'border-[#e4e2da] bg-[#f3f2ed] text-[#9aa19b]' : 'border-[#dbe8dc] bg-white text-[#5e7567]'}`}>
                <span className="max-w-[130px] truncate text-[10px]">{category.name}{category.is_archived ? ' · archived' : ''}</span>
                {!category.is_archived && <button type="button" aria-label={`Rename ${category.name}`} onClick={() => onEditCategory(category)} className="rounded-full p-0.5 text-[#87948a] hover:text-[#276a4b]"><Pencil size={10} /></button>}
                {category.is_archived
                  ? <button type="button" aria-label={`Restore ${category.name}`} onClick={() => onRestoreCategory(category)} className="rounded-full p-0.5 text-[#87948a] hover:text-[#276a4b]"><RotateCcw size={10} /></button>
                  : <button type="button" aria-label={`Archive ${category.name}`} onClick={() => onArchiveCategory(category)} className="rounded-full p-0.5 text-[#a1958e] hover:text-[#a4533a]"><Archive size={10} /></button>}
              </div>
            ))}
            {!allCategories.length && <p className="text-[10px] text-[#9aa39c]">No categories added yet.</p>}
          </div>
          {categoryDraft?.section === section.key ? (
            <form onSubmit={onSaveCategory} className="mt-3 flex flex-wrap items-center gap-2">
              <input autoFocus value={categoryDraft.name} onChange={(event) => onCategoryDraftChange({ ...categoryDraft, name: event.target.value })} required maxLength={80} aria-invalid={Boolean(categoryError)} aria-describedby={categoryError ? `category-error-${section.key}` : undefined} placeholder="Category name" className="min-w-[160px] flex-1 rounded-lg border border-[#dedfd5] bg-white px-3 py-2 text-xs text-[#294638] outline-none focus:border-[#739c81]" />
              {categoryError && <p id={`category-error-${section.key}`} role="alert" className="basis-full text-xs leading-5 text-[#a4533a]">{categoryError}</p>}
              <button type="submit" disabled={saving} className="rounded-lg bg-[#1d6247] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-50">{categoryDraft.id ? 'Save name' : 'Add category'}</button>
              <button type="button" onClick={onCancelCategory} className="rounded-lg p-2 text-[#829087] hover:bg-[#f0efe8]" aria-label="Cancel category edit"><X size={14} /></button>
            </form>
          ) : (
            <form onSubmit={onSaveCategory} className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold text-[#7d8980]">Suggested:</span>
              {suggestedCategories[section.key].map((name) => (
                <button key={name} type="button" disabled={saving || activeCategories.some((category) => category.name.toLowerCase() === name.toLowerCase())} onClick={() => onCreateCategory(name)} className="rounded-full border border-[#e6e1d1] bg-white px-2.5 py-1.5 text-[10px] text-[#7b704f] hover:border-[#c7b57e] disabled:opacity-40">{name}</button>
              ))}
              <button type="button" onClick={() => onCategoryDraftChange({ section: section.key, name: '' })} className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-semibold text-[#28704e] hover:bg-[#edf4ed]"><CirclePlus size={12} /> Custom</button>
              {categoryError && <p role="alert" className="basis-full text-xs leading-5 text-[#a4533a]">{categoryError}</p>}
            </form>
          )}
        </div>
      )}
    </section>
  )
}

export default function MonthlyCashFlow() {
  const [profile, setProfile] = useState<CashFlowProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [categoryError, setCategoryError] = useState<{ section: CashFlowSection; message: string } | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null)
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null)
  const [categoryEditor, setCategoryEditor] = useState<CashFlowSection | null>(null)

  useEffect(() => {
    let current = true
    cashFlowApi.getCurrent()
      .then((data) => { if (current) setProfile(data) })
      .catch((error: unknown) => { if (current) setLoadError(errorText(error)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  const refresh = async () => {
    const data = await cashFlowApi.getCurrent()
    setProfile(data)
  }

  const perform = async (operation: () => Promise<unknown>, successMessage = 'Your current cash flow is saved.', categorySection?: CashFlowSection) => {
    setSaving(true)
    setToast(null)
    let operationCompleted = false
    try {
      await operation()
      operationCompleted = true
      if (categorySection) {
        setCategoryError((current) => current?.section === categorySection ? null : current)
      }
      await refresh()
      setToast({ type: 'success', message: successMessage })
      return true
    } catch (error) {
      if (operationCompleted) {
        setToast({ type: 'error', message: 'The change was saved, but the latest totals could not be reloaded. Refresh this page to see the updated profile.' })
        return true
      }
      const fieldError = categorySection ? categoryFieldError(error) : ''
      if (categorySection && fieldError) {
        setCategoryError({ section: categorySection, message: fieldError })
      } else {
        if (categorySection) {
          setCategoryError((current) => current?.section === categorySection ? null : current)
        }
        setToast({ type: 'error', message: errorText(error) })
      }
      return false
    } finally {
      setSaving(false)
    }
  }

  const entriesBySection = useMemo(() => {
    const grouped: Record<CashFlowSection, CashFlowEntry[]> = { INCOME: [], SAVINGS: [], EXPENSES: [] }
    profile?.entries.forEach((entry) => grouped[entry.section].push(entry))
    return grouped
  }, [profile])

  const totals = profile?.totals ?? { income: '0.00', savings: '0.00', expenses: '0.00', surplus: '0.00', savings_rate: '0.00' }
  const surplus = Number(totals.surplus)
  const negativeSurplus = surplus < 0
  const positiveSurplus = surplus > 0
  const expenseTotal = Number(totals.expenses)
  const savingsTotal = Number(totals.savings)
  const allocationBase = Math.max(Number(totals.income), expenseTotal + savingsTotal, 1)
  const allocationSavingsWidth = savingsTotal / allocationBase * 100
  const allocationExpenseWidth = expenseTotal / allocationBase * 100
  const allocationSurplusWidth = Math.max(surplus, 0) / allocationBase * 100

  const addEntry = (section: CashFlowSection) => {
    const category = profile?.categories.find((item) => item.section === section && !item.is_archived)
    setToast(null)
    setEntryDraft({ section, name: '', category: category ? String(category.id) : '', amount: '' })
  }

  const editEntry = (entry: CashFlowEntry) => setEntryDraft({
    section: entry.section, id: entry.id, name: entry.name, category: String(entry.category), amount: entry.amount,
  })

  const saveEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!entryDraft) return
    const payload = { name: entryDraft.name.trim(), category: Number(entryDraft.category), amount: entryDraft.amount }
    const ok = await perform(
      () => entryDraft.id ? cashFlowApi.updateEntry(entryDraft.id, payload) : cashFlowApi.createEntry(payload),
      entryDraft.id ? 'Entry updated and totals recalculated.' : 'Entry added and totals recalculated.',
    )
    if (ok) setEntryDraft(null)
  }

  const deleteEntry = async (entry: CashFlowEntry) => {
    if (!window.confirm(`Remove “${entry.name}” from your current monthly cash flow?`)) return
    await perform(() => cashFlowApi.deleteEntry(entry.id), 'Entry removed and totals recalculated.')
  }

  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!categoryDraft) return
    const draft = categoryDraft
    const ok = await perform(
      () => draft.id
        ? cashFlowApi.updateCategory(draft.id, { name: draft.name.trim() })
        : cashFlowApi.createCategory({ section: draft.section, name: draft.name.trim() }),
      draft.id ? 'Category renamed.' : 'Category added.',
      draft.section,
    )
    if (ok) setCategoryDraft(null)
  }

  const createSuggestedCategory = async (section: CashFlowSection, name: string) => {
    const result: { category?: CashFlowCategory } = {}
    const ok = await perform(async () => { result.category = await cashFlowApi.createCategory({ section, name }) }, 'Category added.', section)
    const createdCategory = result.category
    if (ok && createdCategory) {
      setProfile((current) => {
        if (!current || current.categories.some((category) => category.id === createdCategory.id)) return current
        return { ...current, categories: [...current.categories, createdCategory] }
      })
    }
    if (ok && createdCategory && entryDraft?.section === section) {
      setEntryDraft((current) => current ? { ...current, category: String(createdCategory.id) } : current)
    }
    return ok && createdCategory ? createdCategory : null
  }

  const setCategoryName = (category: CashFlowCategory) => setCategoryDraft({ section: category.section, id: category.id, name: category.name })

  const archiveCategory = async (category: CashFlowCategory) => {
    if (!window.confirm(`Archive “${category.name}”? Existing entries will keep their amounts and totals.`)) return
    await perform(() => cashFlowApi.updateCategory(category.id, { is_archived: true }), 'Category archived. Existing entries were preserved.', category.section)
  }

  const restoreCategory = async (category: CashFlowCategory) => {
    await perform(() => cashFlowApi.updateCategory(category.id, { is_archived: false }), 'Category restored.', category.section)
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#708076]"><LoaderCircle className="animate-spin" size={18} /> Loading your saved cash flow…</div>
  }
  if (!profile) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <CircleAlert className="mx-auto text-[#a4533a]" size={25} />
        <h1 className="mt-3 font-serif text-2xl font-bold text-[#18382f]">Could not load cash flow</h1>
        <p role="alert" className="mt-2 text-sm text-[#8a6559]">{loadError || 'Please try again.'}</p>
        <button type="button" onClick={() => { setLoading(true); setLoadError(''); cashFlowApi.getCurrent().then(setProfile).catch((error: unknown) => setLoadError(errorText(error))).finally(() => setLoading(false)) }} className="mt-5 rounded-lg bg-[#1d6247] px-4 py-2.5 text-sm font-semibold text-white">Retry</button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 xl:px-9">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8b773d]">WealthOnCruise · Financial profile</p>
          <h1 className="mt-1 font-serif text-3xl font-bold tracking-tight text-[#18382f] sm:text-[34px]">Current Monthly Cash Flow</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-5 text-[#738078]">Your current recurring baseline for financial planning. Edit it whenever your circumstances change.</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-[#dce8dd] bg-white px-3 py-1.5 text-[10px] font-medium text-[#4e7560]">
          <Check size={13} /> Saved to your account
        </div>
      </div>

      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          className={`fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-xs leading-5 shadow-[0_12px_32px_rgba(24,56,47,0.18)] sm:bottom-6 sm:right-6 ${toast.type === 'error' ? 'border-[#efd9cf] bg-[#fcf2ee] text-[#9c4d37]' : 'border-[#d4e5d8] bg-[#f0f7f1] text-[#246747]'}`}
        >
          {toast.type === 'error' ? <CircleAlert size={15} className="mt-0.5 shrink-0" /> : <Check size={15} className="mt-0.5 shrink-0" />}
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss message" className="-mr-1 -mt-1 rounded-md p-1 text-current/70 hover:bg-black/5 hover:text-current"><X size={14} /></button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Monthly Income" amount={currency(totals.income)} detail="Take-home and other income" />
        <SummaryCard title="Monthly Savings" amount={currency(totals.savings)} detail={`Savings rate · ${Number(totals.savings_rate).toFixed(2)}%`} accent="gold" />
        <SummaryCard title="Monthly Expenses" amount={currency(totals.expenses)} detail="Recurring monthly spending" accent="rose" />
        <SummaryCard title={negativeSurplus ? 'Monthly Shortfall' : 'Investable Surplus'} amount={currency(Math.abs(surplus).toFixed(2))} detail={negativeSurplus ? 'Income is below savings and expenses' : 'Available for fresh investment'} accent={negativeSurplus ? 'rose' : 'green'} emphasis />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-2xl border border-[#e8e5da] bg-white p-5 shadow-[0_5px_16px_rgba(32,49,38,0.035)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9a7a35]">Monthly baseline</p><h2 className="mt-1 font-serif text-xl font-bold text-[#18382f]">Income allocation</h2></div>
            {negativeSurplus && <span className="rounded-full bg-[#fcf0eb] px-2.5 py-1 text-[10px] font-semibold text-[#a4533a]">Shortfall {currency(Math.abs(surplus).toFixed(2))}</span>}
          </div>
          <div className="relative mt-5">
            <div className="flex h-4 overflow-hidden rounded-full bg-[#f0efe8]" role="img" aria-label={`Savings ${currency(totals.savings)}, expenses ${currency(totals.expenses)}, surplus ${currency(Math.max(surplus, 0))}`}>
              {savingsTotal > 0 && <div style={{ width: `${allocationSavingsWidth}%` }} className="h-full bg-[#d4b75f]" title={`Savings ${currency(totals.savings)}`} />}
              {expenseTotal > 0 && <div style={{ width: `${allocationExpenseWidth}%` }} className="h-full bg-[#cf8b70]" title={`Expenses ${currency(totals.expenses)}`} />}
              {positiveSurplus && <div style={{ width: `${allocationSurplusWidth}%` }} className="h-full bg-[#3c8a66]" title={`Surplus ${currency(totals.surplus)}`} />}
            </div>
            {negativeSurplus && <span aria-hidden="true" title="Income threshold" className="absolute -top-1 bottom-[-4px] z-10 w-[2px] bg-[#18382f]" style={{ left: `${Math.min(100, Number(totals.income) / allocationBase * 100)}%` }} />}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Savings', amount: totals.savings, color: '#c0a343' },
              { label: 'Expenses', amount: totals.expenses, color: '#c67e61' },
              { label: positiveSurplus ? 'Surplus left' : 'Available surplus', amount: positiveSurplus ? totals.surplus : '0.00', color: '#38815e' },
            ].map((item) => <div key={item.label} className="flex items-start gap-2"><i className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} /><div><p className="text-[10px] text-[#859188]">{item.label}</p><p className="mt-0.5 text-xs font-semibold tabular-nums text-[#355242]">{currency(item.amount)}</p></div></div>)}
          </div>
          {negativeSurplus && <p className="mt-3 text-[10px] text-[#758279]">Dark marker shows the income limit against total commitments.</p>}
          <p className={`mt-4 border-t border-[#efeee7] pt-3 text-[11px] leading-5 ${negativeSurplus ? 'text-[#a4533a]' : 'text-[#819087]'}`}>
            {negativeSurplus
              ? `Your current monthly commitments exceed income by ${currency(Math.abs(surplus).toFixed(2))}. Review savings or expenses to close the gap.`
              : 'Investable surplus is calculated as income − savings − expenses. Savings are kept separate from expenses.'}
          </p>
        </section>
        <CategoryDistribution breakdown={profile.expense_breakdown} savingsRate={totals.savings_rate} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {sections.map((section) => (
          <SectionPanel
            key={section.key}
            section={section}
            entries={entriesBySection[section.key]}
            sectionTotal={section.key === 'INCOME' ? totals.income : section.key === 'SAVINGS' ? totals.savings : totals.expenses}
            categories={profile.categories}
            draft={entryDraft}
            categoryEditor={categoryEditor === section.key}
            categoryError={categoryError?.section === section.key ? categoryError.message : ''}
            categoryDraft={categoryDraft}
            saving={saving}
            onAddEntry={() => addEntry(section.key)}
            onEditEntry={editEntry}
            onDeleteEntry={deleteEntry}
            onDraftChange={setEntryDraft}
            onSaveEntry={saveEntry}
            onCancelEntry={() => setEntryDraft(null)}
            onManageCategories={() => setCategoryEditor((current) => current === section.key ? null : section.key)}
            onCreateCategory={(name) => createSuggestedCategory(section.key, name)}
            onEditCategory={setCategoryName}
            onArchiveCategory={(category) => { void archiveCategory(category) }}
            onRestoreCategory={(category) => { void restoreCategory(category) }}
            onCategoryDraftChange={setCategoryDraft}
            onSaveCategory={saveCategory}
            onCancelCategory={() => setCategoryDraft(null)}
          />
        ))}
      </div>
      <p className="mt-4 text-center text-[10px] text-[#98a198]">This is a current recurring profile. It does not create monthly history or accounting records.</p>
    </div>
  )
}
