import { useMemo, useState } from 'react'
import { FileText, Inbox, Package, Plus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'
import {
  AMOUNT_ORDERS,
  PAYMENT_METHODS,
  PERIODS,
  REPORT_MODULES,
  describeFilter,
  applyReportFilter,
  documentFor,
  emptyValues,
  periodRange,
  reportDate,
  statusesFor,
  useReportSettings,
  useSavedReports,
  useSummaryItems,
  type ReportDocument,
  type ReportFilter,
  type SavedReport,
} from '@/lib/reports'
import { Chip, Empty, ErrorBox, IconBadge, Loading, PageHeader, SearchField, SectionTitle, Sheet } from '@/components/ui'
import { ReportPreview } from '@/components/ReportPreview'

/*
  التقارير والأرشيف (_ReportsArchiveHubPage في التطبيق): التقارير المنجزة
  وملفات الأرشيف المحفوظة من التطبيق، وكل واحد يُبنى عند فتحه من البيانات
  الحالية بمعاييره المحفوظة. و«تقرير جديد» يُنشئ تقريرًا للمعاينة والطباعة
  فقط ولا يُحفظ.
*/

const LIST_FILTERS = ['الأحدث أولاً', 'آخر أسبوع', 'آخر شهر', 'مخصص']
const ASSET_MODULES = ['العقارات', 'الأنشطة التجارية', 'المركبات ووسائل النقل']

const toInput = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''
const fromInput = (s: string) => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** _applyListFilter: الأحدث أولًا، مقصورًا على الفترة المختارة. */
function applyListFilter(list: SavedReport[], filter: string, from: string, to: string) {
  const today = new Date()
  const start =
    filter === 'آخر أسبوع'
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7)
      : filter === 'آخر شهر'
        ? new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())
        : filter === 'مخصص'
          ? fromInput(from)
          : null
  const end = filter === 'مخصص' ? fromInput(to) : null
  return list
    .filter((r) => {
      const day = dayOf(r.archivedAt ?? r.createdAt)
      if (start && day < dayOf(start)) return false
      if (end && day > dayOf(end)) return false
      return true
    })
    .sort((a, b) => (b.archivedAt ?? b.createdAt).getTime() - (a.archivedAt ?? a.createdAt).getTime())
}

function Select({ label, value, options, onChange, empty }: { label: string; value: string; options: string[]; onChange: (v: string) => void; empty?: string }) {
  const { t } = useI18n()
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-sub">{t(label)}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 rounded-field border border-line bg-field px-3 text-[13px] font-bold text-title outline-none focus:border-gold"
      >
        {empty !== undefined && <option value="">{t(empty)}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {t(o)}
          </option>
        ))}
      </select>
    </label>
  )
}

function TextInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  const { t } = useI18n()
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-sub">{t(label)}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 rounded-field border border-line bg-field px-3 text-[13px] font-bold text-title outline-none focus:border-gold"
      />
    </label>
  )
}

/** فلتر التقرير (_openReportFilter) بأقسامه المشتركة، للمعاينة والطباعة فقط. */
function NewReport({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (filter: ReportFilter, title: string) => void }) {
  const { t } = useI18n()
  const [module, setModule] = useState('الكل')
  const [period, setPeriod] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [order, setOrder] = useState('')
  const [payment, setPayment] = useState('')
  const [person, setPerson] = useState('')
  const [place, setPlace] = useState('')
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')

  const allModules = module === 'الكل'
  const withPayment = module === 'الالتزامات الشخصية' || module === 'الالتزامات المشتركة'

  function pickPeriod(value: string) {
    setPeriod(value)
    if (!value || value === 'مخصص') return
    const [a, b] = periodRange(value)
    setFrom(toInput(a))
    setTo(toInput(b))
  }

  function submit() {
    const values = emptyValues()
    values.datePeriod = period || null
    values.dateFrom = fromInput(from)
    values.dateTo = fromInput(to)
    if (values.dateFrom || values.dateTo) values.datePeriod = period || 'مخصص'
    values.status = status || 'كل الحالات'
    values.amountShortcut = order || null
    values.paymentMethod = withPayment ? payment || null : null
    values.personName = allModules ? '' : person
    values.placeName = allModules ? '' : place
    onCreate({ module, values, query: query.trim() }, title.trim())
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex items-center gap-3">
        <IconBadge icon={FileText} color="#0A5A50" size={44} />
        <div>
          <p className="text-[17px] font-extrabold text-title">{t('إنشاء تقرير')}</p>
          <p className="text-[11px] text-muted">{t('يُعرض للطباعة والحفظ PDF ولا يُحفظ في الموقع.')}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <Select
          label="القسم"
          value={module}
          options={REPORT_MODULES}
          onChange={(v) => {
            setModule(v)
            if (!statusesFor(v).includes(status)) setStatus('')
          }}
        />
        <Select label="الفترة" value={period} options={PERIODS} onChange={pickPeriod} empty="الكل" />
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="من تاريخ"
            type="date"
            value={from}
            onChange={(v) => {
              setFrom(v)
              setPeriod('مخصص')
            }}
          />
          <TextInput
            label="إلى تاريخ"
            type="date"
            value={to}
            onChange={(v) => {
              setTo(v)
              setPeriod('مخصص')
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="الحالة" value={status} options={statusesFor(module)} onChange={setStatus} empty="كل الحالات" />
          <Select label="المبلغ" value={order} options={AMOUNT_ORDERS} onChange={setOrder} empty="الكل" />
        </div>
        {withPayment && <Select label="طريقة الدفع" value={payment} options={PAYMENT_METHODS} onChange={setPayment} empty="الكل" />}
        {!allModules && (
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="الشخص / الجهة" value={person} onChange={setPerson} />
            <TextInput label={ASSET_MODULES.includes(module) ? 'مواقع وأماكن' : 'المكان'} value={place} onChange={setPlace} />
          </div>
        )}
        <p className="mt-1 text-[13px] font-extrabold text-title">{t('بيانات التقرير')}</p>
        <TextInput label="عنوان التقرير (اختياري)" value={title} onChange={setTitle} />
        <TextInput label="كلمة بحث داخل البيانات (اختياري)" value={query} onChange={setQuery} />
        <button
          type="button"
          onClick={submit}
          className="mt-2 flex h-13 items-center justify-center gap-2 rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
        >
          <FileText className="size-5" />
          {t('إنشاء تقرير')}
        </button>
      </div>
    </Sheet>
  )
}

function ReportRow({ report, count, archived, onOpen }: { report: SavedReport; count: number | null; archived: boolean; onOpen: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" onClick={onOpen} className="card flex w-full items-start gap-3 p-4 text-start hover:bg-line/60">
      <IconBadge icon={archived ? Package : FileText} color="#0A5A50" size={42} />
      <div className="min-w-0 flex-1">
        <p dir="auto" className="break-words text-[14px] font-extrabold text-title">
          {report.title}
        </p>
        <p className="mt-0.5 text-[11px] font-semibold text-sub">
          {t(report.type)} • {reportDate(report.createdAt)}
        </p>
        {report.subject && (
          <p dir="auto" className="mt-0.5 text-[11px] text-muted">
            {report.filter ? report.subject : `${t('الأقسام')}: ${report.subject}`}
          </p>
        )}
        {archived && (
          <p className="mt-1 text-[11px] font-bold text-gold-dark">
            {t('تاريخ الأرشفة')}: {report.archivedAt ? reportDate(report.archivedAt) : '—'}
            {report.archiveReason ? ` · ${t('سبب الأرشفة')}: ${report.archiveReason}` : ''}
          </p>
        )}
      </div>
      {count !== null && (
        <span className="grid min-w-8 shrink-0 place-items-center rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-bold text-brand">{count}</span>
      )}
    </button>
  )
}

export default function Reports() {
  const { t } = useI18n()
  const saved = useSavedReports()
  const { loading, items } = useSummaryItems()
  const settings = useReportSettings()
  const [tab, setTab] = useState<'recent' | 'archived'>('recent')
  const [search, setSearch] = useState('')
  const [listFilter, setListFilter] = useState('الأحدث أولاً')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [creating, setCreating] = useState(false)
  const [preview, setPreview] = useState<ReportDocument | null>(null)
  const [notice, setNotice] = useState('')

  const recent = saved.data?.recent ?? []
  const archived = saved.data?.archived ?? []
  const source = tab === 'recent' ? recent : archived

  const list = useMemo(() => {
    const q = search.trim()
    return applyListFilter(source, listFilter, from, to).filter(
      (r) => !q || [r.title, r.type, r.subject, r.archiveReason, reportDate(r.createdAt)].some((f) => f.includes(q)),
    )
  }, [source, search, listFilter, from, to])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    if (!loading) for (const r of [...recent, ...archived]) if (r.filter) map.set(r.id, applyReportFilter(items, r.filter).length)
    return map
  }, [recent, archived, items, loading])

  function open(report: SavedReport) {
    if (loading) {
      setNotice('جارٍ تحميل البيانات...')
      return
    }
    if (!report.filter) {
      setNotice(
        report.legacy
          ? 'هذا التقرير أُنشئ بنسخة سابقة من التطبيق — افتحه من التطبيق أو أنشئ تقريرًا جديدًا.'
          : 'هذا التقرير أُنشئ بنسخة سابقة بلا معايير محفوظة — أنشئ تقريرًا جديدًا.',
      )
      return
    }
    setNotice('')
    setPreview(documentFor(report, items, settings.name))
  }

  function create(filter: ReportFilter, typed: string) {
    const now = new Date()
    const id = String(now.getTime() * 1000)
    setCreating(false)
    setNotice('')
    setPreview({
      title: typed || `تقرير ${filter.module === 'الكل' ? 'شامل' : filter.module}`,
      archive: false,
      reference: `RP-${id.slice(-6)}`,
      createdAt: now,
      createdBy: settings.name,
      criteria: describeFilter(filter),
      items: applyReportFilter(items, filter),
      archivedAt: null,
      archiveReason: '',
    })
  }

  return (
    <div>
      <PageHeader icon={FileText} color="#0A5A50" title="التقارير / الأرشيف" subtitle="اختر القسم وفلتره ثم «إنشاء تقرير» لتحصل على ملف PDF جاهز للمشاركة والطباعة." />

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={tab === 'recent'} label="التقارير" icon={FileText} count={recent.length} onClick={() => setTab('recent')} />
        <Chip active={tab === 'archived'} label="ملفات الأرشيف" icon={Package} count={archived.length} onClick={() => setTab('archived')} />
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={loading}
          className="ms-auto flex h-11 items-center gap-2 rounded-inner bg-brand px-4 text-[13px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          <Plus className="size-4" />
          {t('إنشاء تقرير')}
        </button>
      </div>

      <div className="mt-4">
        <SearchField value={search} onChange={setSearch} placeholder={tab === 'recent' ? 'ابحث في التقارير' : 'ابحث في الأرشيف'} />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {LIST_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setListFilter(f)}
            className={cn(
              'h-9 rounded-full border px-3 text-[12px] font-bold',
              listFilter === f ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub hover:border-hairline',
            )}
          >
            {t(f)}
          </button>
        ))}
        {listFilter === 'مخصص' && (
          <div className="flex gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-full border border-line bg-white px-3 text-[12px]" aria-label={t('من تاريخ')} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-full border border-line bg-white px-3 text-[12px]" aria-label={t('إلى تاريخ')} />
          </div>
        )}
      </div>

      {notice && <p className="mt-4 rounded-inner bg-gold-soft px-4 py-3 text-[12px] font-bold text-gold-dark">{t(notice)}</p>}

      <SectionTitle count={list.length}>{t(tab === 'recent' ? 'التقارير المنجزة' : 'ملفات الأرشيف')}</SectionTitle>
      {saved.isError ? (
        <ErrorBox error={saved.error} />
      ) : saved.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty
          icon={Inbox}
          text={source.length ? 'لا توجد تقارير تطابق البحث أو الفترة.' : tab === 'recent' ? 'لا توجد تقارير منشأة بعد.' : 'لا يوجد شيء مؤرشف في هذا القسم بعد.'}
        />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {list.map((r) => (
            <ReportRow key={r.id} report={r} archived={tab === 'archived'} count={counts.get(r.id) ?? null} onOpen={() => open(r)} />
          ))}
        </div>
      )}
      <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">{t('التقارير وملفات الأرشيف تُحفظ من التطبيق، وتُبنى هنا من بياناتك الحالية عند فتحها.')}</p>

      <NewReport open={creating} onClose={() => setCreating(false)} onCreate={create} />
      <ReportPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
