import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, Eye, FileText, Inbox, Loader2, Package, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'
import {
  AMOUNT_ORDERS,
  PAYMENT_METHODS,
  PERIODS,
  REPORT_MODULES,
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
import { Confirm } from '@/components/Confirm'
import { archiveReport, createReport, deleteReport, defaultReportTitle, restoreReport } from '@/lib/reportsWrite'

/*
  التقارير والأرشيف (_ReportsArchiveHubPage في التطبيق): التقارير المنجزة
  وملفات الأرشيف (reports_archive_records_v1)، وكل واحد يُبنى عند فتحه من
  البيانات الحالية بمعاييره المحفوظة. «إنشاء تقرير» يحفظه في التقارير، و«البحث
  في الأرشيف» يحفظ النتيجة في ملفات الأرشيف، ثم تُفتح المعاينة. ومن كل بطاقة:
  أرشفة التقرير (بسبب اختياري) أو استعادته، والحذف.
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

/** فلتر التقرير (_openReportFilter) بأقسامه المشتركة، وفي آخره العنوان وكلمة البحث (وسبب الأرشفة). */
function NewReport({
  archive,
  busy,
  error,
  onClose,
  onCreate,
}: {
  archive: boolean
  busy: boolean
  error: string
  onClose: () => void
  onCreate: (filter: ReportFilter, title: string, reason: string) => void
}) {
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
  const [reason, setReason] = useState('')

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
    onCreate({ module, values, query: query.trim() }, title.trim(), reason.trim())
  }

  return (
    <Sheet open onClose={busy ? () => {} : onClose}>
      <div className="flex items-center gap-3">
        <IconBadge icon={archive ? Search : FileText} color="#0A5A50" size={44} />
        <div>
          <p className="text-[17px] font-extrabold text-title">{t(archive ? 'البحث في الأرشيف' : 'إنشاء تقرير')}</p>
          <p className="text-[11px] text-muted">
            {t(archive ? 'تُحفظ النتيجة في ملفات الأرشيف ثم تُفتح معاينتها.' : 'يُحفظ في التقارير المنجزة ثم تُفتح معاينته للطباعة والحفظ PDF.')}
          </p>
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
        <p className="mt-1 text-[13px] font-extrabold text-title">{t(archive ? 'بيانات الأرشيف' : 'بيانات التقرير')}</p>
        <TextInput label={archive ? 'عنوان الأرشيف (اختياري)' : 'عنوان التقرير (اختياري)'} value={title} onChange={setTitle} />
        <TextInput label="كلمة بحث داخل البيانات (اختياري)" value={query} onChange={setQuery} />
        {archive && <TextInput label="سبب الأرشفة (اختياري)" value={reason} onChange={setReason} />}
        {error && <p className="rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="mt-2 flex h-13 items-center justify-center gap-2 rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : archive ? <Search className="size-5" /> : <FileText className="size-5" />}
          {t(archive ? 'ابحث' : 'إنشاء تقرير')}
        </button>
      </div>
    </Sheet>
  )
}

function ReportRow({
  report,
  count,
  archived,
  onOpen,
  onArchive,
  onRestore,
  onDelete,
}: {
  report: SavedReport
  count: number | null
  archived: boolean
  onOpen: () => void
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const action = 'grid size-9 place-items-center rounded-full bg-surface text-body hover:bg-line'
  return (
    <div className="card flex flex-col p-4">
    <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 text-start">
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
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <button type="button" onClick={onOpen} className="flex h-9 items-center gap-1.5 rounded-full bg-brand-soft px-3 text-[12px] font-bold text-brand hover:bg-brand-tint">
          <Eye className="size-4" />
          {t('فتح')}
        </button>
        <span className="flex-1" />
        {archived ? (
          <button type="button" onClick={onRestore} className={action} title={t('استعادة')} aria-label={t('استعادة')}>
            <RotateCcw className="size-4" />
          </button>
        ) : (
          <button type="button" onClick={onArchive} className={action} title={t('أرشفة التقرير')} aria-label={t('أرشفة التقرير')}>
            <Archive className="size-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="grid size-9 place-items-center rounded-full bg-danger-soft text-danger hover:bg-danger/15"
          title={t(archived ? 'حذف نهائي' : 'حذف')}
          aria-label={t(archived ? 'حذف نهائي' : 'حذف')}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  )
}

/** سبب الأرشفة — يظهر لاحقًا في بطاقة العنصر المؤرشف («تخطٍّ» يؤرشف بلا سبب). */
function ArchiveReason({ busy, error, onDone }: { busy: boolean; error: string; onDone: (reason: string) => void }) {
  const { t } = useI18n()
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-deep/40 p-4" onClick={busy ? undefined : () => onDone('')}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl">
        <p className="text-[17px] font-extrabold text-title">{t('سبب الأرشفة')}</p>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && onDone(reason.trim())}
          placeholder={t('مثال: انتهت الفترة / للحفظ المرجعي')}
          aria-label={t('سبب الأرشفة')}
          className="mt-3 h-11 w-full rounded-field bg-field px-3 text-[13px] text-title outline-none ring-1 ring-line focus:ring-2 focus:ring-gold"
        />
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDone(reason.trim())}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('حفظ')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDone('')}
            className="h-11 flex-1 rounded-field bg-surface text-[14px] font-bold text-body hover:bg-line disabled:opacity-60"
          >
            {t('تخطٍّ')}
          </button>
        </div>
      </div>
    </div>
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [archiving, setArchiving] = useState<SavedReport | null>(null)
  const [deleting, setDeleting] = useState<SavedReport | null>(null)
  const qc = useQueryClient()

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

  /** يُنفَّذ التغيير ثم تُحدَّث القائمة من السحابة. */
  async function run(change: () => Promise<unknown>, done: string) {
    setBusy(true)
    setError('')
    try {
      await change()
      await qc.invalidateQueries({ queryKey: ['store'] })
      setNotice(done)
      return true
    } catch (err) {
      setError(String((err as Error).message ?? err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function create(filter: ReportFilter, typed: string, reason: string) {
    const archive = tab === 'archived'
    let id = ''
    const ok = await run(async () => {
      id = await createReport(filter, { title: typed, archive, reason, createdBy: settings.name })
    }, archive ? 'حُفظت نتيجة البحث في ملفات الأرشيف' : 'تم إنشاء التقرير')
    if (!ok) return
    setCreating(false)
    const now = new Date(Number(id) / 1000)
    setPreview(
      documentFor(
        {
          id,
          title: typed || defaultReportTitle(filter, archive),
          type: filter.module,
          subject: '',
          mode: archive ? 'أرشيف' : 'تقرير',
          createdBy: settings.name,
          createdAt: now,
          filter,
          legacy: false,
          archivedAt: archive ? now : null,
          archiveReason: archive ? reason : '',
        },
        items,
        settings.name,
      ),
    )
  }

  return (
    <div>
      <PageHeader icon={FileText} color="#0A5A50" title="التقارير / الأرشيف" subtitle="اختر القسم وفلتره ثم «إنشاء تقرير» لتحصل على ملف PDF جاهز للمشاركة والطباعة." />

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={tab === 'recent'} label="التقارير" icon={FileText} count={recent.length} onClick={() => setTab('recent')} />
        <Chip active={tab === 'archived'} label="ملفات الأرشيف" icon={Package} count={archived.length} onClick={() => setTab('archived')} />
        <button
          type="button"
          onClick={() => {
            setError('')
            setCreating(true)
          }}
          disabled={loading}
          className="ms-auto flex h-11 items-center gap-2 rounded-inner bg-brand px-4 text-[13px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {tab === 'recent' ? <Plus className="size-4" /> : <Search className="size-4" />}
          {t(tab === 'recent' ? 'إنشاء تقرير' : 'البحث في الأرشيف')}
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
      {error && !creating && !archiving && !deleting && (
        <p className="mt-4 rounded-inner bg-danger-soft px-4 py-3 text-[12px] font-bold text-danger">{t(error)}</p>
      )}

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
            <ReportRow
              key={r.id}
              report={r}
              archived={tab === 'archived'}
              count={counts.get(r.id) ?? null}
              onOpen={() => open(r)}
              onArchive={() => {
                setError('')
                setArchiving(r)
              }}
              onRestore={() => run(() => restoreReport(r.id), 'تمت استعادة التقرير من الأرشيف')}
              onDelete={() => {
                setError('')
                setDeleting(r)
              }}
            />
          ))}
        </div>
      )}
      <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">{t('التقارير وملفات الأرشيف تُحفظ في حسابك وتظهر في التطبيق، وتُبنى عند فتحها من بياناتك الحالية بمعاييرها المحفوظة.')}</p>

      {creating && <NewReport archive={tab === 'archived'} busy={busy} error={error} onClose={() => setCreating(false)} onCreate={create} />}
      {archiving && (
        <ArchiveReason
          busy={busy}
          error={error}
          onDone={async (reason) => {
            if (await run(() => archiveReport(archiving.id, reason), 'تم نقل التقرير إلى الأرشيف')) setArchiving(null)
          }}
        />
      )}
      <Confirm
        open={!!deleting}
        title="حذف التقرير"
        message={`${t('سيُحذف')} "${deleting?.title ?? ''}" ${t('نهائيًا. هل تريد المتابعة؟')}`}
        confirmLabel="حذف"
        danger
        busy={busy}
        error={error}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting && (await run(() => deleteReport(deleting.id), 'تم حذف التقرير'))) setDeleting(null)
        }}
      />
      <ReportPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
