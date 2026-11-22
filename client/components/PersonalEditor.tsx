import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, CalendarDays, ChevronLeft, ChevronRight, Paperclip, Plus, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { useCurrency, useStore, type Entry } from '@/lib/data'
import { publicName } from '@/lib/requestsWrite'
import { PERSONAL_GROUPS } from '@/lib/catalog'
import {
  ADD_MENU,
  ADD_OTHER,
  APP_ONLY_TYPES,
  CUSTODY_APPROVAL_LABEL,
  CUSTODY_APPROVAL_NONE,
  CUSTODY_APPROVAL_REQUIRED,
  CUSTODY_ID_LABEL,
  CUSTOM,
  DEBT_ID_LABEL,
  FORMS,
  LEAD_DAYS,
  LEAD_HOURS,
  addMonthsClamped,
  createEntry,
  initialValues,
  installmentCount,
  isValidFnd,
  isVisible,
  nameForFnd,
  normalizeFnd,
  optionsOf,
  parseDmy,
  savedInstallments,
  splitEqually,
  subcategoriesFor,
  updateEntry,
  validate,
  type EntryForm,
  type FormField,
  type Installment,
  type Values,
} from '@/lib/personalWrite'
import { Sheet } from './ui'
import { Confirm } from './Confirm'

/*
  إضافة وتعديل في «أنا» — نموذج التطبيق نفسه (_openFinancialEntryForm):
  الحقول وترتيبها وخياراتها، وإظهار التكرار والتذكير حسب مفاتيحهما،
  والتصنيف الرئيسي مع الفرعي، و«+ إضافة أخرى» و«مخصص» بخانة لكتابة القيمة.
*/

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

/** يوم/شهر/سنة ← سنة-شهر-يوم لحقل التاريخ في المتصفح. */
function toInputDate(value: string) {
  const p = value.split('/')
  if (p.length !== 3) return ''
  const [d, m, y] = p.map((x) => parseInt(x, 10))
  if ([d, m, y].some(Number.isNaN)) return ''
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function fromInputDate(value: string) {
  if (!value) return ''
  const [y, m, d] = value.split('-').map((x) => parseInt(x, 10))
  return `${d}/${m}/${y}`
}

function Label({ field, children }: { field: FormField; children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <label className={cn('flex flex-col gap-1', !field.half && 'col-span-2')}>
      <span className="text-[12px] font-bold text-sub">
        {t(field.display || field.label)}
        {field.required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  )
}

function FieldInput({
  form,
  field,
  values,
  custom,
  set,
  setCustom,
}: {
  form: EntryForm
  field: FormField
  values: Values
  custom: Values
  set: (label: string, value: string) => void
  setCustom: (label: string, value: string) => void
}) {
  const { t } = useI18n()
  const value = values[field.label] ?? ''

  if (field.kind === 'toggle') {
    const on = value === 'نعم'
    return (
      <div className="col-span-2 flex h-12 items-center justify-between gap-3 rounded-field bg-field px-3">
        <span className="text-[13px] font-extrabold text-ink">{t(field.label)}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => {
            set(field.label, on ? '' : 'نعم')
            // كالتطبيق: إيقاف المفتاح يمسح التكرار.
            if (on && 'التكرار' in values) set('التكرار', '')
          }}
          className={cn('relative h-7 w-12 rounded-full transition-colors', on ? 'bg-brand-mid' : 'bg-hairline')}
        >
          <span className={cn('absolute top-1 size-5 rounded-full bg-white shadow transition-all', on ? 'start-6' : 'start-1')} />
        </button>
      </div>
    )
  }

  if (field.label === 'التصنيف الرئيسي') {
    const options = field.options ?? []
    const mainCustom = !!value && !options.includes(value)
    const typing = mainCustom || value === ADD_OTHER
    const sub = values['التصنيف الفرعي'] ?? ''
    const subs = subcategoriesFor(form.label, value)
    const subCustom = !!sub && !subs.includes(sub)
    return (
      <>
        <Label field={field}>
          <select
            value={typing ? ADD_OTHER : value}
            onChange={(e) => {
              set(field.label, e.target.value === ADD_OTHER ? ADD_OTHER : e.target.value)
              set('التصنيف الفرعي', '')
            }}
            className={inputClass}
          >
            <option value="">{t('اختر')}</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {t(o)}
              </option>
            ))}
            {field.allowCustom && <option value={ADD_OTHER}>{t(ADD_OTHER)}</option>}
          </select>
          {typing && (
            <input
              className={cn(inputClass, 'mt-2')}
              value={value === ADD_OTHER ? '' : value}
              placeholder={t('التصنيف — القيمة الجديدة')}
              onChange={(e) => set(field.label, e.target.value || ADD_OTHER)}
            />
          )}
        </Label>
        {value && value !== ADD_OTHER && (
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">
              {t('التصنيف الفرعي')}
              {form.label === 'غرامة' && <span className="text-danger"> *</span>}
            </span>
            <select
              value={subCustom || sub === ADD_OTHER ? ADD_OTHER : sub}
              onChange={(e) => set('التصنيف الفرعي', e.target.value)}
              className={inputClass}
            >
              <option value="">{t('بدون')}</option>
              {subs.map((o) => (
                <option key={o} value={o}>
                  {t(o)}
                </option>
              ))}
              {field.allowCustom && <option value={ADD_OTHER}>{t(ADD_OTHER)}</option>}
            </select>
            {(subCustom || sub === ADD_OTHER) && (
              <input
                className={cn(inputClass, 'mt-2')}
                value={sub === ADD_OTHER ? '' : sub}
                placeholder={t('التصنيف — القيمة الجديدة')}
                onChange={(e) => set('التصنيف الفرعي', e.target.value || ADD_OTHER)}
              />
            )}
          </label>
        )}
      </>
    )
  }

  if (field.kind === 'select') {
    const options = optionsOf(field)
    const needsCustom = [ADD_OTHER, CUSTOM, LEAD_HOURS, LEAD_DAYS].includes(value)
    const reminder = ['تذكيرات', 'تذكير', 'التذكيرات'].includes(field.label)
    const placeholder =
      value === LEAD_HOURS ? 'كم ساعة قبل الموعد؟' : reminder || value === LEAD_DAYS ? 'كم يومًا قبل الموعد؟' : `${t(field.label)} — ${t('القيمة الجديدة')}`
    return (
      <Label field={field}>
        <select value={options.includes(value) ? value : ''} onChange={(e) => set(field.label, e.target.value)} className={inputClass}>
          <option value="">{field.hint ? t(field.hint) : t('اختر')}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {t(o)}
            </option>
          ))}
        </select>
        {needsCustom && (
          <input
            className={cn(inputClass, 'mt-2')}
            inputMode={reminder || field.label === 'وقت التذكير' ? 'numeric' : undefined}
            value={custom[field.label] ?? ''}
            placeholder={t(placeholder)}
            onChange={(e) => setCustom(field.label, e.target.value)}
          />
        )}
      </Label>
    )
  }

  if (field.kind === 'multiline') {
    return (
      <Label field={field}>
        <textarea
          rows={3}
          value={value}
          placeholder={field.hint && field.hint !== '#auto' ? t(field.hint) : undefined}
          onChange={(e) => set(field.label, e.target.value)}
          className={cn(inputClass, 'h-auto py-3')}
        />
      </Label>
    )
  }

  if (field.kind === 'date') {
    return (
      <Label field={field}>
        <input type="date" value={toInputDate(value)} onChange={(e) => set(field.label, fromInputDate(e.target.value))} className={inputClass} />
      </Label>
    )
  }

  if (field.kind === 'time') {
    return (
      <Label field={field}>
        <input type="time" value={value} onChange={(e) => set(field.label, e.target.value)} className={inputClass} />
      </Label>
    )
  }

  return (
    <Label field={field}>
      <input
        type={field.kind === 'secret' ? 'password' : 'text'}
        autoComplete={field.kind === 'secret' ? 'new-password' : 'off'}
        inputMode={field.kind === 'number' ? 'decimal' : undefined}
        dir={field.kind === 'number' || field.kind === 'secret' ? 'ltr' : 'auto'}
        value={value}
        placeholder={field.hint ? t(field.hint) : undefined}
        onChange={(e) => set(field.label, e.target.value)}
        className={inputClass}
      />
    </Label>
  )
}

/** «سيظهر اسمك للآخرين…» (fndNameHint). */
function FndHint({ name }: { name: string }) {
  const { t } = useI18n()
  return (
    <span className="text-[11px] leading-relaxed text-muted">
      {t('سيظهر اسمك للآخرين حسب إعدادات ملفك الشخصي')}: «{name}»
    </span>
  )
}

/** يجلب اسم صاحب الرقم التعريفي إن كان صحيحًا (fundly_name_by_fnd). */
function useFndName(raw: string, me: string, onName: (name: string) => void) {
  const [found, setFound] = useState('')
  const latest = useRef(onName)
  latest.current = onName
  // عند فتح التعديل لا يُستبدل الاسم المحفوظ؛ يُجلب عند تغيير الرقم فقط.
  const initial = useRef(raw)
  useEffect(() => {
    const id = normalizeFnd(raw)
    setFound('')
    if (!isValidFnd(id) || id === me) return
    let alive = true
    nameForFnd(id).then((name) => {
      if (!alive || !name) return
      setFound(name)
      if (raw !== initial.current) latest.current(name)
    })
    return () => {
      alive = false
    }
  }, [raw, me])
  return found
}

/** الدين: الرقم التعريفي للطرف الثاني (اختياري) يجلب اسمه إلى «اسم الجهة». */
function DebtIdField({ field, values, set, me }: { field: FormField; values: Values; set: (l: string, v: string) => void; me: { fnd: string; name: string } }) {
  const { t } = useI18n()
  const value = values[field.label] ?? ''
  useFndName(value, me.fnd, (name) => {
    if ((values['اسم الجهة'] ?? '').trim() !== name) set('اسم الجهة', name)
  })
  return (
    <Label field={field}>
      <input dir="ltr" value={value} placeholder={field.hint ? t(field.hint) : undefined} onChange={(e) => set(field.label, e.target.value)} className={inputClass} />
      <FndHint name={me.name} />
    </Label>
  )
}

/** العهدة: المستلم برقمه التعريفي واسمه، واعتماد المصروفات (التطبيق: اسم المستلم). */
function CustodyRecipient({ values, set, me }: { values: Values; set: (l: string, v: string) => void; me: { fnd: string; name: string } }) {
  const { t } = useI18n()
  const id = values[CUSTODY_ID_LABEL] ?? ''
  const found = useFndName(id, me.fnd, (name) => set('اسم المستلم', name))
  const approval = (values[CUSTODY_APPROVAL_LABEL] ?? '') === CUSTODY_APPROVAL_REQUIRED
  return (
    <div className="col-span-2 flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-bold text-sub">
          {t('المستلم (الرقم التعريفي)')}
          <span className="text-danger"> *</span>
        </span>
        <input dir="ltr" value={id} placeholder="FND-XXXX-XXXX" onChange={(e) => set(CUSTODY_ID_LABEL, e.target.value)} className={inputClass} />
        <FndHint name={me.name} />
      </label>
      {found ? (
        <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-brand-mid">
          <BadgeCheck className="size-4" />
          {t('المستلم')}: {found}
        </p>
      ) : (
        isValidFnd(normalizeFnd(id)) && (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">
              {t('اسم المستلم')}
              <span className="text-danger"> *</span>
            </span>
            <input dir="auto" value={values['اسم المستلم'] ?? ''} placeholder={t('رقم جديد — اكتب اسمه مرة واحدة')} onChange={(e) => set('اسم المستلم', e.target.value)} className={inputClass} />
          </label>
        )
      )}
      <p className="text-[11px] leading-relaxed text-muted">
        {t('يُربط المستلم بالعهدة المالية برقمه التعريفي ويصله طلب قبول. يظهر اسمه فقط — لا يُشارك رقم هاتفه ولا عنوانه إلا بموافقته.')}
      </p>
      <div className={cn('flex items-center gap-3 rounded-inner border px-3 py-2', approval ? 'border-brand-mid bg-brand-soft' : 'border-hairline bg-white')}>
        <div className="flex-1">
          <p className="text-[12.5px] font-extrabold text-title">{t('يحتاج المصروف موافقة صاحب العهدة لاعتماده')}</p>
          <p className="text-[11px] leading-relaxed text-sub">
            {t(approval ? 'كل مصروف يرسله المستلم يصلك لتعتمده أو ترفضه، ولا يُخصم من العهدة قبل اعتماده.' : 'مصروفات المستلم تُخصم من العهدة مباشرة بلا موافقة.')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={approval}
          onClick={() => set(CUSTODY_APPROVAL_LABEL, approval ? CUSTODY_APPROVAL_NONE : CUSTODY_APPROVAL_REQUIRED)}
          className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', approval ? 'bg-brand-mid' : 'bg-hairline')}
        >
          <span className={cn('absolute top-1 size-5 rounded-full bg-white shadow transition-all', approval ? 'start-6' : 'start-1')} />
        </button>
      </div>
    </div>
  )
}

/** القسط: التقسيم بالتساوي ثم خانة لكل قسط بتاريخه ومبلغه. */
function InstallmentsTable({
  rows,
  equalSplit,
  unit,
  onToggle,
  onChange,
}: {
  rows: Installment[]
  equalSplit: boolean
  unit: string
  onToggle: (on: boolean) => void
  onChange: (rows: Installment[], manualAmount: boolean) => void
}) {
  const { t } = useI18n()
  if (!rows.length) return null
  function setDate(i: number, value: string) {
    const next = rows.map((r) => ({ ...r }))
    next[i].date = value
    const picked = parseDmy(value)
    // الخانات الفارغة بعده تُملأ شهريًا ويمكن تغيير أي منها.
    if (picked) for (let j = i + 1; j < next.length; j++) if (!next[j].date.trim()) next[j].date = dmyOf(addMonthsClamped(picked, j - i))
    onChange(next, false)
  }
  return (
    <div className="col-span-2 flex flex-col gap-2">
      <div className="flex h-12 items-center justify-between gap-3 rounded-field bg-field px-3">
        <span className="text-[13px] font-extrabold text-ink">{t('تقسيم القسط بالتساوي')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={equalSplit}
          onClick={() => onToggle(!equalSplit)}
          className={cn('relative h-7 w-12 rounded-full transition-colors', equalSplit ? 'bg-brand-mid' : 'bg-hairline')}
        >
          <span className={cn('absolute top-1 size-5 rounded-full bg-white shadow transition-all', equalSplit ? 'start-6' : 'start-1')} />
        </button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="flex h-12 w-16 shrink-0 items-center justify-center gap-1 rounded-inner bg-brand-soft text-[11.5px] font-extrabold text-brand">
            <CalendarDays className="size-3.5" />
            {t('القسط')} {i + 1}
          </span>
          <input type="date" aria-label={`${t('تاريخ القسط')} ${i + 1}`} value={toInputDate(r.date)} onChange={(e) => setDate(i, fromInputDate(e.target.value))} className={inputClass} />
          <div className="relative w-full">
            <input
              dir="ltr"
              inputMode="decimal"
              aria-label={`${t('المبلغ')} ${i + 1}`}
              value={r.amount}
              onChange={(e) => {
                const next = rows.map((x) => ({ ...x }))
                next[i].amount = e.target.value
                onChange(next, true)
              }}
              className={cn(inputClass, 'pr-14')}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-bold text-muted">{t(unit)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

const dmyOf = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`

function FormBody({ form, entry, onDone }: { form: EntryForm; entry?: Entry; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const currency = useCurrency()
  const qc = useQueryClient()
  const { profile } = useSession()
  const store = useStore()
  const me = { fnd: profile?.fnd_id ?? '', name: publicName(store.data, profile?.display_name ?? '') }
  const start = useMemo(() => initialValues(form, entry, currency), [form, entry, currency])
  const [values, setValues] = useState<Values>(start.values)
  const [custom, setCustomState] = useState<Values>(start.custom)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')

  const set = (label: string, value: string) => setValues((v) => ({ ...v, [label]: value }))
  const setCustom = (label: string, value: string) => setCustomState((v) => ({ ...v, [label]: value }))

  // القسط: الخانات بعدد الأقساط (حتى 120)، والمبالغ بالتساوي ما لم يُعدَّل أحدها.
  const isInstallment = form.label === 'قسط'
  const [instStore, setInstStore] = useState<Installment[]>(() => savedInstallments(entry, 120))
  const [equalSplit, setEqualSplit] = useState(String(entry?.details?.['تقسيم القسط بالتساوي'] ?? '') !== 'لا')
  const count = isInstallment ? installmentCount(values['عدد الأقساط'] ?? '') : 0
  const visibleRows = instStore.slice(0, count)
  const installments = equalSplit ? splitEqually(values['المبلغ الإجمالي'] ?? '', visibleRows) : visibleRows
  const extras = { me, installments: isInstallment ? installments : undefined, equalSplit }

  function ask() {
    const problem = validate(form, values, custom, { me: me.fnd, installments: extras.installments })
    setError(problem ?? '')
    if (!problem) {
      setSaveError('')
      setConfirming(true)
    }
  }

  async function save() {
    setBusy(true)
    setSaveError('')
    try {
      if (entry) await updateEntry(entry, form, values, custom, currency, file, extras)
      else await createEntry(form, values, custom, currency, file, extras)
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setConfirming(false)
      onDone(entry ? 'تم حفظ التعديل بنجاح' : 'تم الحفظ بنجاح')
    } catch (e) {
      setSaveError(errorText(e) || 'تعذّر الحفظ. تحقّق من الإنترنت ثم حاول مجددًا.')
    } finally {
      setBusy(false)
    }
  }

  const fields = form.fields.filter((f) => isVisible(f, values) || f.label === 'التصنيف الرئيسي')

  return (
    <div>
      <p className="text-[18px] font-extrabold text-title">
        {entry ? `${t('تعديل بيانات')} ${t(form.label)}` : `${t('إضافة')} ${t(form.label)}`}
      </p>
      <p className="mt-0.5 text-[12px] text-muted">{t(form.subtitle)}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {fields.map((field) =>
          form.label === 'عهدة مالية' && field.label === 'اسم المستلم' ? (
            <CustodyRecipient key={field.label} values={values} set={set} me={me} />
          ) : field.label === DEBT_ID_LABEL ? (
            <DebtIdField key={field.label} field={field} values={values} set={set} me={me} />
          ) : (
            <span key={field.label} className="contents">
              <FieldInput form={form} field={field} values={values} custom={custom} set={set} setCustom={setCustom} />
              {isInstallment && field.label === 'عدد الأقساط' && (
                <InstallmentsTable
                  rows={installments}
                  equalSplit={equalSplit}
                  unit={(values['العملة'] ?? '').trim() || currency}
                  onToggle={(on) => {
                    // إيقاف التقسيم يُبقي المبالغ الظاهرة لتعديلها.
                    if (!on) setInstStore((all) => [...installments, ...all.slice(installments.length)])
                    setEqualSplit(on)
                  }}
                  onChange={(rows, manual) => {
                    setInstStore((all) => [...rows, ...all.slice(rows.length)])
                    if (manual) setEqualSplit(false)
                  }}
                />
              )}
            </span>
          ),
        )}
        <label className="col-span-2 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-field border border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft">
          <Paperclip className="size-4" />
          <span className="truncate">{file ? file.name : t(entry?.attachment_url ? 'استبدال المرفق' : 'إرفاق مستند')}</span>
          {file && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                setFile(null)
              }}
              aria-label={t('إزالة')}
            >
              <X className="size-4" />
            </button>
          )}
          <input type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {error && (
        <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">
          {error
            .split('|')
            .map((part) => t(part))
            .join(' ')}
        </p>
      )}
      <button
        type="button"
        onClick={ask}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t(entry ? 'حفظ التعديل' : 'حفظ')}
      </button>
      <Confirm
        open={confirming}
        title={entry ? 'تأكيد التعديل' : 'تأكيد الحفظ'}
        message={t(entry ? 'هل تريد حفظ التعديل؟' : 'هل تريد حفظ البيانات؟')}
        busy={busy}
        error={saveError}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

/** إضافة: اختيار النوع ثم نموذجه. تعديل: نموذج السجل مباشرة. */
export function PersonalEditor({ open, entry, onClose, onSaved }: { open: boolean; entry?: Entry; onClose: () => void; onSaved: (message: string) => void }) {
  const { t, dir } = useI18n()
  const { hidden } = useSession()
  const [type, setType] = useState<string | null>(null)
  useEffect(() => {
    if (open) setType(entry ? entry.entry_type : null)
  }, [open, entry])
  const form = type ? FORMS[type] : null
  const Back = dir === 'rtl' ? ChevronRight : ChevronLeft
  // الفئات التي أخفتها الإدارة لا تُعرض للإضافة.
  const menu = ADD_MENU.filter((c) => {
    const label = PERSONAL_GROUPS.find((g) => g.key === c.group)?.label ?? c.title
    return !hidden.has(`category:personal:${label}`)
  })

  return (
    <Sheet open={open} onClose={onClose}>
      {form ? (
        <>
          {!entry && (
            <button type="button" onClick={() => setType(null)} className="mb-2 flex items-center gap-1 text-[12px] font-bold text-brand">
              <Back className="size-4" />
              {t('اختر نوعًا آخر')}
            </button>
          )}
          <FormBody key={`${type}-${entry?.id ?? 'new'}`} form={form} entry={entry} onDone={onSaved} />
        </>
      ) : (
        <div>
          <p className="text-[18px] font-extrabold text-title">{t('إضافة التزام')}</p>
          <div className="mt-4 flex flex-col gap-4">
            {menu.map((c) => (
              <div key={c.group}>
                <p className="text-[13px] font-extrabold text-title">{t(c.title)}</p>
                <p className="text-[11px] text-muted">{t(c.subtitle)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.types.map((tp) => (
                    <button
                      key={tp}
                      type="button"
                      onClick={() => setType(tp)}
                      className="flex h-10 items-center gap-1.5 rounded-inner border border-line bg-white px-3 text-[13px] font-bold text-ink hover:border-brand hover:text-brand"
                    >
                      <Plus className="size-4" />
                      {t(tp)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">
            {t('من التطبيق فقط حاليًا:')} {APP_ONLY_TYPES.map((x) => t(x)).join('، ')}
          </p>
        </div>
      )}
    </Sheet>
  )
}
