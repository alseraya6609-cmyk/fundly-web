import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  Building2,
  Car,
  Landmark,
  Handshake,
  FileText,
  Link2Off,
  Loader2,
  MoreVertical,
  PenLine,
  Plus,
  Printer,
  ReceiptText,
  Store,
  Trash2,
  TriangleAlert,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { jsonList, useAssets, useCurrency, useStore } from '@/lib/data'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { decodeLease, encodeLease, K, signatureStrokes, type Lease } from '@/lib/lease'
import { imageSrc } from '@/lib/settingsWrite'
import {
  CONTRACT_COLORS,
  CONTRACT_HINTS,
  CONTRACT_TILES,
  CONTRACT_TYPES,
  DATE_FIELDS,
  LEASE_ACTIVITY_CLASSES,
  LEASE_DOC_TYPES,
  LEASE_VEHICLE_FIELDS,
  MULTI_FIELDS,
  NUMBER_FIELDS,
  NUMERIC_COLUMNS,
  OPTION_FIELDS,
  RECEIPT_TILES,
  REMINDER_LABELS,
  TABLE_FIELDS,
  TEMPLATE_COLORS,
  TEMPLATE_HINTS,
  TIME_FIELDS,
  buildTemplateHtml,
  deleteDocRecord,
  editRows,
  fieldsOf,
  formatDate,
  inputsOf,
  isDraft,
  isFormal,
  isLeaseRecord,
  isRequired,
  isTemplateType,
  parseDate,
  recordText,
  saveLeaseDocument,
  saveTemplate,
  toInputDate,
  useDocRecords,
  type DocRecord,
  type LinkTarget,
} from '@/lib/templates'
import { CURRENCIES } from '@/lib/settingsWrite'
import { Confirm } from '@/components/Confirm'
import { LeaseForm } from '@/components/LeaseForm'
import { useLeasePrint } from '@/components/LeasePrint'
import { HtmlPreview } from '@/components/RecordShare'
import { TextShareSheet } from '@/components/AssetExtras'
import { Chevron, Empty, ErrorBox, Loading, PageHeader, Sheet } from '@/components/ui'

/*
  «قوالب المستندات والإيصالات» كما في التطبيق (DocumentTemplatesScreen):
  الإيصالات والفواتير، العقود والإنذارات، والنماذج المحفوظة (فتح/إكمال،
  طباعة، مشاركة، حذف). العقود الثلاثة (عقار، نشاط، مركبة) بنموذج عقد
  الإيجار نفسه، و«سند قبض» يفتح صفحة سندات القبض والرواتب.
*/

const ICONS: Record<string, LucideIcon> = {
  'إيصال أمانة': Wallet,
  'سند قبض': ReceiptText,
  'إيصال استلام وتسليم': ArrowLeftRight,
  فاتورة: ReceiptText,
  'تقرير ضريبي': Landmark,
  عقد: Handshake,
  إنذار: TriangleAlert,
  'عقد إيجار عقار': Building2,
  'عقد إيجار نشاط تجاري': Store,
  'عقد تأجير مركبة': Car,
  'عقد عام': Handshake,
}

const inputClass =
  'h-11 w-full rounded-field border border-line bg-field px-3 text-[13px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** كيانات الربط: الأفراد والجهات (بترتيبهم في التطبيق) والعقارات والأنشطة. */
function useLinkTargets(): LinkTarget[] {
  const store = useStore()
  const assets = useAssets()
  return useMemo(() => {
    const out: LinkTarget[] = []
    let index = 0
    for (const entry of jsonList(store.data?.['people_management_records_v1'])) {
      if (!entry || typeof entry !== 'object') continue
      index++
      const name = String((entry as { fullName?: unknown }).fullName ?? '').trim()
      if (name) out.push({ kind: 'شخص/جهة', label: name, id: `person:${index}:${name}` })
    }
    for (const a of assets.data ?? []) if (a.id && a.title.trim()) out.push({ kind: 'عقار/نشاط', label: a.title.trim(), id: `asset:${a.id}` })
    return out
  }, [store.data, assets.data])
}

/** ترويسة الطباعة وتوقيع صاحب الحساب وختمه. */
function usePrintContext() {
  const { t, lang, dir } = useI18n()
  const store = useStore()
  const { profile } = useSession()
  const currency = useCurrency()
  const d = store.data ?? {}
  return {
    t,
    lang,
    dir,
    origin: window.location.origin,
    currency,
    org: {
      name: str(d['settings_profile_name']) || profile?.display_name || '',
      city: str(d['settings_profile_city']),
      phone: str(d['settings_profile_phone']),
      email: str(d['settings_profile_email']),
      logo: str(d['user_logo_image_v1']) || null,
    },
    signature: signatureStrokes(d['user_signature_strokes_v1']),
    stamp: str(d['user_stamp_image_v1']),
  }
}

export default function Templates() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const store = useStore()
  const records = useDocRecords()
  const currency = useCurrency()
  const print = usePrintContext()
  const leasePrint = useLeasePrint()
  const [picking, setPicking] = useState(false)
  const [form, setForm] = useState<{ type: string; existing?: DocRecord } | null>(null)
  const [lease, setLease] = useState<{ type: string; existing?: DocRecord } | null>(null)
  const [preview, setPreview] = useState<DocRecord | null>(null)
  const [sharing, setSharing] = useState<DocRecord | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<DocRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const logo = str(store.data?.['user_logo_image_v1'])
  const list = records.data ?? []

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['document-records'] }), qc.invalidateQueries({ queryKey: ['store'] })])
  const done = async (text: string) => {
    setForm(null)
    setLease(null)
    await refresh()
    setNotice({ text, tone: 'ok' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function open(type: string, existing?: DocRecord) {
    setNotice(null)
    if (LEASE_DOC_TYPES.has(type) && (!existing || isLeaseRecord(existing))) setLease({ type, existing })
    else setForm({ type, existing })
  }

  function printRecord(r: DocRecord) {
    if (isLeaseRecord(r)) leasePrint.open({ lease: decodeLease(r.fields.__lease), title: r.doc_type, activity: r.doc_type === 'عقد إيجار نشاط تجاري' })
    else if (isTemplateType(r.doc_type)) setPreview(r)
  }

  const tile = (type: string) => {
    const color = TEMPLATE_COLORS[type] ?? '#0A5A50'
    const Icon = ICONS[type] ?? FileText
    return (
      <button
        key={type}
        type="button"
        onClick={() => (type === 'عقد' ? setPicking(true) : type === 'سند قبض' ? navigate('/salary') : open(type))}
        className="flex min-h-[132px] flex-col rounded-[16px] border border-line bg-white p-3 text-start hover:border-brand"
      >
        <span className="flex w-full items-center">
          <span className="grid size-10 place-items-center rounded-[12px]" style={{ background: `${color}1c`, color }}>
            <Icon className="size-5" />
          </span>
          <Chevron className="ms-auto size-3.5 text-muted" />
        </span>
        <span className="mt-auto pt-3 text-[13px] font-extrabold leading-tight text-title">{t(type)}</span>
        <span className="mt-1 text-[10.5px] font-semibold leading-snug text-sub">{t(TEMPLATE_HINTS[type] ?? '')}</span>
      </button>
    )
  }
  const sectionTitle = (text: string) => (
    <p className="mb-2.5 flex items-center gap-2 text-[14px] font-extrabold text-title">
      <span className="h-[17px] w-1 rounded-full bg-gold" />
      {t(text)}
    </p>
  )

  return (
    <div>
      <PageHeader icon={FileText} color="#0A5A50" title="نماذج المستندات والإيصالات" />
      {notice && <p className={cn('mb-3 rounded-inner px-4 py-3 text-[13px] font-bold', notice.tone === 'ok' ? 'bg-brand-soft text-brand' : 'bg-danger-soft text-danger')}>{t(notice.text)}</p>}
      <div className="mb-5 flex items-center gap-3.5 rounded-card bg-gradient-to-r from-[#022E2A] to-[#0E7161] p-4 rtl:bg-gradient-to-l">
        <span className="grid size-[58px] shrink-0 place-items-center rounded-[16px] bg-white p-1.5">
          {logo ? <img src={imageSrc(logo)} alt="" className="max-h-full max-w-full object-contain" /> : <FileText className="size-8 text-brand-light" />}
        </span>
        <div className="min-w-0">
          <p className="text-[16px] font-extrabold text-white">{t('نماذج جاهزة باسمك')}</p>
          <p className="mt-1 text-[11.5px] font-semibold leading-relaxed text-white/85">
            {t(logo ? 'يُطبع كل نموذج بشعارك، ومعه توقيعك وختمك إن اخترت' : 'أضف شعارك من «المزيد» ليظهر أعلى كل نموذج — ومتوفر أيضًا التوقيع والختم')}
          </p>
          {!logo && (
            <Link to="/settings/signature" className="mt-1.5 inline-block text-[12px] font-extrabold text-gold">
              {t('إضافة الشعار والتوقيع')}
            </Link>
          )}
        </div>
      </div>
      {sectionTitle('الإيصالات والفواتير')}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">{RECEIPT_TILES.map(tile)}</div>
      <div className="h-4" />
      {sectionTitle('العقود والإنذارات')}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">{CONTRACT_TILES.map(tile)}</div>

      <p className="mb-2 mt-6 text-[15px] font-extrabold text-title">{t('النماذج المحفوظة')}</p>
      {records.isLoading ? (
        <Loading />
      ) : records.error ? (
        <ErrorBox error={records.error} />
      ) : !list.length ? (
        <Empty icon={FileText} text="لا توجد نماذج محفوظة بعد" />
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((r) => {
            const Icon = ICONS[r.doc_type] ?? FileText
            const known = isTemplateType(r.doc_type)
            const expiry = (r.fields['تاريخ الانتهاء'] ?? '').trim()
            const name = (r.fields['اسم المستأجر'] || r.fields[inputsOf(r.doc_type)[0] ?? ''] || '').trim()
            return (
              <div key={r.id} className="card relative flex items-center gap-3 px-4 py-3">
                <button type="button" disabled={!known} onClick={() => open(r.doc_type, r)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                  <span className="grid size-10 shrink-0 place-items-center rounded-inner bg-brand-soft text-brand">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-extrabold text-title">
                      {t(r.doc_type)}
                      {name && <span dir="auto" className="font-bold text-sub"> — {name}</span>}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-sub">
                      {[isDraft(r) && t('مسودة'), expiry ? `${t('ينتهي:')} ${expiry}` : t('بدون تاريخ انتهاء'), (r.linked_label ?? '').trim() && `${t(r.linked_kind ?? '')}: ${r.linked_label}`].filter(Boolean).join('  •  ')}
                    </span>
                  </span>
                </button>
                <button type="button" aria-label={t('خيارات')} onClick={() => setMenu(menu === r.id ? null : r.id)} className="grid size-9 place-items-center rounded-full text-sub hover:bg-line">
                  <MoreVertical className="size-4" />
                </button>
                {menu === r.id && (
                  <div className="absolute end-3 top-12 z-20 w-44 overflow-hidden rounded-inner border border-line bg-white shadow-lg" onMouseLeave={() => setMenu(null)}>
                    {known && (
                      <button type="button" onClick={() => (setMenu(null), open(r.doc_type, r))} className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] font-bold text-ink hover:bg-surface">
                        <PenLine className="size-4" />
                        {t('فتح / إكمال')}
                      </button>
                    )}
                    {known && (
                      <button type="button" onClick={() => (setMenu(null), printRecord(r))} className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] font-bold text-ink hover:bg-surface">
                        <Printer className="size-4" />
                        {t('طباعة / حفظ PDF')}
                      </button>
                    )}
                    {!known && (
                      <button type="button" onClick={() => (setMenu(null), setSharing(r))} className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] font-bold text-ink hover:bg-surface">
                        <FileText className="size-4" />
                        {t('مشاركة')}
                      </button>
                    )}
                    <button type="button" onClick={() => (setMenu(null), setDeleting(r))} className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] font-bold text-danger hover:bg-danger-soft">
                      <Trash2 className="size-4" />
                      {t('حذف')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {picking && (
        <Sheet open onClose={() => setPicking(false)}>
          <p className="text-[16px] font-extrabold text-title">{t('اختر نوع العقد')}</p>
          <div className="mt-2 flex flex-col">
            {CONTRACT_TYPES.map((type) => {
              const Icon = ICONS[type] ?? Handshake
              const color = CONTRACT_COLORS[type] ?? '#0A5A50'
              return (
                <button key={type} type="button" onClick={() => (setPicking(false), open(type))} className="flex items-center gap-3 rounded-inner px-1 py-3 text-start hover:bg-surface">
                  <span className="grid size-10 shrink-0 place-items-center rounded-inner" style={{ background: `${color}1f`, color }}>
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-extrabold text-title">{t(type)}</span>
                    <span className="block text-[11.5px] text-sub">{t(CONTRACT_HINTS[type] ?? '')}</span>
                  </span>
                  <Chevron className="size-4 text-muted" />
                </button>
              )
            })}
          </div>
        </Sheet>
      )}

      {form && (
        <TemplateForm
          type={form.type}
          existing={form.existing}
          currency={currency}
          onClose={() => setForm(null)}
          onSaved={async (record, message, andPrint) => {
            await done(message)
            if (andPrint) setPreview(record)
          }}
        />
      )}

      {lease && (
        <LeaseForm
          propertyType=""
          activity={lease.type === 'عقد إيجار نشاط تجاري' ? { classOptions: LEASE_ACTIVITY_CLASSES } : undefined}
          vehicle={lease.type === 'عقد تأجير مركبة' ? { fields: LEASE_VEHICLE_FIELDS, values: {}, meta: {}, vehicleClass: 'مركبات برية' } : undefined}
          document={{
            title: lease.type,
            currencies: CURRENCIES.map(([, suffix]) => suffix),
            prefill: lease.existing?.fields.__lease ?? seedLease(list.filter((r) => r.doc_type === lease.type).length, currency),
            save: async (l: Lease, draft: boolean) => {
              const existing = lease.existing
              const saved = await saveLeaseDocument({
                type: lease.type,
                encoded: encodeLease(l),
                lessor: l.lessor[K.name] ?? '',
                tenant: l.tenant[K.name] ?? '',
                start: l.contract[K.startDate] ?? '',
                end: l.contract[K.endDate] ?? '',
                draft,
                existing,
              })
              // الحفظ الثاني من النموذج نفسه يحدّث السجل لا يكرره.
              setLease((x) => (x ? { ...x, existing: saved } : x))
            },
          }}
          onClose={() => setLease(null)}
          onDone={(message) => void done(message)}
        />
      )}
      {leasePrint.ui}

      {preview && <HtmlPreview title={t(preview.doc_type)} html={buildTemplateHtml(preview, print)} onClose={() => setPreview(null)} />}
      {sharing && <TextShareSheet title={sharing.doc_type} text={recordText(sharing, t)} onClose={() => setSharing(null)} />}
      <Confirm
        open={!!deleting}
        title="حذف المستند"
        message={t('سيُحذف المستند نهائيًا ولا يمكن التراجع. هل تريد الحذف؟')}
        confirmLabel="حذف"
        danger
        busy={busy}
        onConfirm={async () => {
          if (!deleting) return
          setBusy(true)
          try {
            await deleteDocRecord(deleting.id)
            await refresh()
            setNotice({ text: 'تم حذف النموذج', tone: 'ok' })
          } catch (e) {
            setNotice({ text: `${t('تعذّر حذف النموذج')} ${errorText(e)}`, tone: 'error' })
          } finally {
            setBusy(false)
            setDeleting(null)
          }
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

/** رقم العقد الجديد يلي عدد عقود هذا النوع المحفوظة، وعملته الافتراضية. */
function seedLease(count: number, currency: string) {
  const seed = decodeLease(null)
  seed.contract[K.newNo] = String(count + 1).padStart(4, '0')
  if (currency) seed.contract['العملة'] = currency
  return encodeLease(seed)
}

// ======================= نموذج القالب =======================

function TemplateForm({
  type,
  existing,
  currency,
  onClose,
  onSaved,
}: {
  type: string
  existing?: DocRecord
  currency: string
  onClose: () => void
  onSaved: (record: DocRecord, message: string, andPrint: boolean) => void
}) {
  const { t } = useI18n()
  const store = useStore()
  const targets = useLinkTargets()
  const formal = isFormal(type)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const field of inputsOf(type)) v[field] = ''
    if (!formal) {
      v['تاريخ الإصدار'] = formatDate(new Date())
      v['تاريخ الانتهاء'] = ''
    }
    v['ملاحظات'] = ''
    if (formal) {
      if ('تاريخ تحرير العقد' in v) v['تاريخ تحرير العقد'] = formatDate(new Date())
      if ('تاريخ الاستلام' in v) v['تاريخ الاستلام'] = formatDate(new Date())
    }
    if ('العملة' in v) v['العملة'] = currency
    if (existing) for (const [k, val] of Object.entries(existing.fields)) if (k in v) v[k] = val
    return v
  })
  const [reminder, setReminder] = useState(existing?.fields.reminder?.trim() || 'قبل أسبوع')
  const [withSign, setWithSign] = useState(existing?.fields.includeSignature === '1')
  const [link, setLink] = useState<LinkTarget | null>(() => (existing?.linked_id ? (targets.find((x) => x.id === existing.linked_id) ?? { kind: existing.linked_kind ?? '', label: existing.linked_label ?? '', id: existing.linked_id }) : null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const d = store.data ?? {}
  const strokes = signatureStrokes(d['user_signature_strokes_v1'])
  const stamp = str(d['user_stamp_image_v1'])
  const set = (field: string, value: string) => setValues((x) => ({ ...x, [field]: value }))

  async function save(draft: boolean, andPrint = false) {
    setBusy(true)
    setError('')
    try {
      const { record, message } = await saveTemplate({ type, values, reminder, includeSignature: withSign, link, draft, existing, t })
      onSaved(record, message, andPrint && !draft)
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith(t('أدخل')) ? e.message : `${t('تعذّر حفظ النموذج. حاول مرة أخرى.')} ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const label = (field: string) => (
    <span className="text-[12px] font-bold text-sub">
      {t(field)}
      {isRequired(type, field) && <span className="text-danger"> *</span>}
    </span>
  )
  const dateInput = (field: string, value: string, onChange: (v: string) => void) => (
    <input
      type="date"
      value={toInputDate(value)}
      onChange={(e) => {
        const dt = parseDate(e.target.value)
        onChange(dt ? formatDate(dt) : '')
      }}
      className={inputClass}
    />
  )
  const input = (field: string) => {
    if (TABLE_FIELDS[field]) return <RowsEditor key={field} field={field} value={values[field] ?? ''} onChange={(v) => set(field, v)} />
    const value = values[field] ?? ''
    let control
    if (TIME_FIELDS.has(field)) control = <input type="time" value={value} onChange={(e) => set(field, e.target.value)} className={inputClass} />
    else if (OPTION_FIELDS[field])
      control = (
        <select value={OPTION_FIELDS[field].includes(value) ? value : ''} onChange={(e) => set(field, e.target.value)} className={inputClass}>
          <option value="">—</option>
          {OPTION_FIELDS[field].map((o) => (
            <option key={o} value={o}>
              {t(o)}
            </option>
          ))}
        </select>
      )
    else if (DATE_FIELDS.has(field)) control = dateInput(field, value, (v) => set(field, v))
    else if (MULTI_FIELDS.has(field)) control = <textarea rows={3} dir="auto" value={value} onChange={(e) => set(field, e.target.value)} className={`${inputClass} h-auto py-2.5`} />
    else control = <input dir="auto" inputMode={NUMBER_FIELDS.has(field) ? 'decimal' : undefined} value={value} onChange={(e) => set(field, e.target.value)} className={inputClass} />
    return (
      <label key={field} className={cn('flex flex-col gap-1', MULTI_FIELDS.has(field) && 'sm:col-span-2')}>
        {label(field)}
        {control}
      </label>
    )
  }

  // الحقول تحت عناوين أقسامها.
  const groups: { title: string; fields: string[] }[] = []
  for (const field of fieldsOf(type)) {
    if (field.startsWith('#')) groups.push({ title: field.slice(1), fields: [] })
    else {
      if (!groups.length) groups.push({ title: '', fields: [] })
      groups[groups.length - 1].fields.push(field)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-deep/40 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" className="flex h-[96vh] w-full flex-col overflow-hidden rounded-t-card bg-page shadow-2xl sm:h-[92vh] sm:max-w-2xl sm:rounded-card">
        <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
          <p className="min-w-0 flex-1 text-[17px] font-extrabold text-title">{t(type)}</p>
          <button type="button" disabled={busy} onClick={() => save(false, true)} aria-label={t('حفظ وطباعة')} title={t('حفظ وطباعة')} className="grid size-9 place-items-center rounded-full bg-surface text-brand disabled:opacity-50">
            <Printer className="size-4" />
          </button>
          <button type="button" onClick={onClose} aria-label={t('إغلاق')} className="grid size-9 place-items-center rounded-full bg-surface text-body">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {groups.map((g, i) => (
            <div key={i} className="mb-3 rounded-card border border-line bg-white p-4">
              {g.title && <p className="mb-2.5 text-[13px] font-extrabold text-brand">{t(g.title)}</p>}
              <div className="grid gap-2.5 sm:grid-cols-2">{g.fields.map((f) => (TABLE_FIELDS[f] ? <div key={f} className="sm:col-span-2">{input(f)}</div> : input(f)))}</div>
            </div>
          ))}
          <div className="mb-3 grid gap-2.5 rounded-card border border-line bg-white p-4 sm:grid-cols-2">
            {!formal && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-bold text-sub">{t('تاريخ الإصدار')}</span>
                  {dateInput('تاريخ الإصدار', values['تاريخ الإصدار'] ?? '', (v) => set('تاريخ الإصدار', v))}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-bold text-sub">{t('تاريخ الانتهاء')}</span>
                  {dateInput('تاريخ الانتهاء', values['تاريخ الانتهاء'] ?? '', (v) => set('تاريخ الانتهاء', v))}
                </label>
              </>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-sub">{t('التذكير قبل الانتهاء')}</span>
              <select value={reminder} onChange={(e) => setReminder(e.target.value)} className={inputClass}>
                {REMINDER_LABELS.map((r) => (
                  <option key={r} value={r}>
                    {t(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[12px] font-bold text-sub">{t('ملاحظات')}</span>
              <textarea rows={3} dir="auto" value={values['ملاحظات'] ?? ''} onChange={(e) => set('ملاحظات', e.target.value)} className={`${inputClass} h-auto py-2.5`} />
            </label>
          </div>
          <div className="mb-3 rounded-card border border-line bg-white p-4">
            {strokes.length || stamp ? (
              <>
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={withSign} onChange={(e) => setWithSign(e.target.checked)} className="mt-1 size-4 accent-[#0A5A50]" />
                  <span>
                    <span className="block text-[13.5px] font-extrabold text-title">{t('إضافة توقيعي وختمي إلى النموذج')}</span>
                    <span className="block text-[11.5px] text-sub">{t('اختياري ويمكن تعطيله لكل نموذج')}</span>
                  </span>
                </label>
                {withSign && (
                  <div className="mt-2 grid h-[72px] place-items-center rounded-[12px] border border-line bg-[#F7FAF9]">
                    {strokes.length ? (
                      <svg viewBox={signatureBox(strokes)} className="h-[60px] w-full">
                        {strokes.map((s, i) => (
                          <polyline key={i} points={s.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#0F2420" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                        ))}
                      </svg>
                    ) : (
                      <img src={imageSrc(stamp)} alt="" className="max-h-[64px] object-contain" />
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3">
                <PenLine className="size-5 text-sub" />
                <span className="flex-1 text-[13px] font-bold text-title">{t('لا يوجد توقيع أو ختم محفوظ')}</span>
                <Link to="/settings/signature" className="text-[12.5px] font-extrabold text-brand">
                  {t('إضافة توقيع أو ختم')}
                </Link>
              </div>
            )}
          </div>
          <div className="mb-3 rounded-card border border-line bg-white p-4">
            {!targets.length ? (
              <div className="flex items-start gap-3">
                <Link2Off className="mt-0.5 size-5 text-sub" />
                <div>
                  <p className="text-[13px] font-bold text-title">{t('لا توجد سجلات للربط بها بعد')}</p>
                  <p className="text-[11.5px] text-sub">{t('أضف شخصًا أو عقارًا ليمكن ربط المستند به')}</p>
                </div>
              </div>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-bold text-sub">{t('ربط المستند بـ (اختياري)')}</span>
                <select value={link?.id ?? ''} onChange={(e) => setLink(targets.find((x) => x.id === e.target.value) ?? null)} className={inputClass}>
                  <option value="">{t('بدون ربط')}</option>
                  {link && !targets.some((x) => x.id === link.id) && <option value={link.id}>{`${t(link.kind)}: ${link.label}`}</option>}
                  {targets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {`${t(x.kind)}: ${x.label}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {error && <p className="mb-3 rounded-inner bg-danger-soft px-3 py-2 text-[12.5px] font-bold text-danger">{error}</p>}
        </div>
        <div className="flex gap-2 border-t border-line bg-white p-3">
          <button type="button" disabled={busy} onClick={() => save(true)} className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-field border border-brand text-[13.5px] font-extrabold text-brand disabled:opacity-60">
            <PenLine className="size-4" />
            {t('حفظ كمسودة')}
          </button>
          <button type="button" disabled={busy} onClick={() => save(false)} className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-field bg-brand text-[13.5px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('حفظ النموذج')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** إطار التوقيع على خطوطه (للمعاينة الصغيرة). */
function signatureBox(strokes: [number, number][][]) {
  const xs = strokes.flat().map((p) => p[0])
  const ys = strokes.flat().map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return `${minX - 6} ${minY - 6} ${Math.max(1, Math.max(...xs) - minX) + 12} ${Math.max(1, Math.max(...ys) - minY) + 12}`
}

/** جدول بأسطر: كل سطر بأعمدته، وزر «إضافة سطر». يُحفظ JSON في الحقل. */
function RowsEditor({ field, value, onChange }: { field: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n()
  const columns = TABLE_FIELDS[field]
  const rows = editRows(value)
  const save = (next: Record<string, string>[]) => onChange(JSON.stringify(next))
  return (
    <div className="rounded-[12px] border border-line bg-[#F6FAF9] p-2.5">
      <p className="text-[12.5px] font-extrabold text-brand">{t(field)}</p>
      {rows.map((row, r) => (
        <div key={row.__id ?? r} className="mt-2 rounded-[10px] border border-line bg-white p-2">
          <div className="flex items-center">
            <span className="text-[11.5px] font-extrabold text-muted">
              {t('سطر')} {r + 1}
            </span>
            <button type="button" aria-label={t('حذف')} onClick={() => save(rows.filter((_, i) => i !== r))} className="ms-auto grid size-8 place-items-center rounded-full text-danger hover:bg-danger-soft">
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className={cn('grid gap-2', columns.length > 1 && 'grid-cols-2')}>
            {columns.map((c) => (
              <label key={c} className="flex flex-col gap-0.5">
                <span className="text-[11px] font-bold text-sub">{t(c)}</span>
                {c.includes('تاريخ') ? (
                  <input
                    type="date"
                    value={toInputDate(row[c] ?? '')}
                    onChange={(e) => {
                      const dt = parseDate(e.target.value)
                      save(rows.map((x, i) => (i === r ? { ...x, [c]: dt ? formatDate(dt) : '' } : x)))
                    }}
                    className="h-10 w-full rounded-field border border-line bg-white px-2 text-[12.5px] font-bold text-title outline-none focus:border-gold"
                  />
                ) : (
                  <input
                    dir="auto"
                    inputMode={NUMERIC_COLUMNS.has(c) ? 'decimal' : undefined}
                    value={row[c] ?? ''}
                    onChange={(e) => save(rows.map((x, i) => (i === r ? { ...x, [c]: e.target.value } : x)))}
                    className="h-10 w-full rounded-field border border-line bg-white px-2 text-[12.5px] font-bold text-title outline-none focus:border-gold"
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
      <button type="button" onClick={() => save([...rows, { __id: String(Date.now() * 1000) }])} className="mt-2 flex items-center gap-1 text-[12.5px] font-extrabold text-brand">
        <Plus className="size-4" />
        {t('إضافة سطر')}
      </button>
    </div>
  )
}
