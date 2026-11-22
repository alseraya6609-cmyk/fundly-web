import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Paperclip, Plus, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { useCurrency, type Entry } from '@/lib/data'
import { PERSONAL_GROUPS } from '@/lib/catalog'
import {
  ADD_MENU,
  ADD_OTHER,
  APP_ONLY_TYPES,
  CUSTOM,
  FORMS,
  LEAD_DAYS,
  LEAD_HOURS,
  createEntry,
  initialValues,
  isVisible,
  optionsOf,
  subcategoriesFor,
  updateEntry,
  validate,
  type EntryForm,
  type FormField,
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

function FormBody({ form, entry, onDone }: { form: EntryForm; entry?: Entry; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const currency = useCurrency()
  const qc = useQueryClient()
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

  function ask() {
    const problem = validate(form, values, custom)
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
      if (entry) await updateEntry(entry, form, values, custom, currency, file)
      else await createEntry(form, values, custom, currency, file)
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
        {fields.map((field) => (
          <FieldInput key={field.label} form={form} field={field} values={values} custom={custom} set={set} setCustom={setCustom} />
        ))}
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
