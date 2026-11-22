import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Building, UserRound } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import type { Person } from '@/lib/data'
import { PeopleError, createPerson, formOf, isEntityKey, typesFor, updatePerson, validatePerson, type PersonForm } from '@/lib/peopleWrite'
import { Sheet } from './ui'
import { Confirm } from './Confirm'

/*
  نموذج الفرد والجهة كما في التطبيق (_openContactFormSheet): النوع أولًا،
  ثم الاسم والهاتف والبريد والجنسية (للأفراد) وتاريخ الميلاد أو التأسيس
  والعنوان والموقع والتصنيفات الإضافية والملاحظات والمعلومات الإضافية.
  الوثائق ومرفقاتها من التطبيق.
*/

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

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

function Field({ label, required, children, wide = true }: { label: string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n()
  return (
    <label className={cn('flex flex-col gap-1', wide && 'col-span-2')}>
      <span className="text-[12px] font-bold text-sub">
        {t(label)}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  )
}

function Body({ person, entity, onDone }: { person?: Person; entity: boolean; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const shown = useMemo(() => formOf(person, entity), [person, entity])
  const [f, setF] = useState<PersonForm>(shown)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const set = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const types = typesFor(entity, shown.typeKey)
  const typeLabel = types.find((x) => x.key === f.typeKey)?.label ?? ''

  function ask() {
    const problem = validatePerson(f, !person)
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
      if (person) await updatePerson(person, shown, f)
      else await createPerson(f)
      await qc.invalidateQueries({ queryKey: ['store'] })
      setConfirming(false)
      onDone(person ? 'تم تحديث بيانات الشخص' : 'تم الحفظ بنجاح')
    } catch (e) {
      setSaveError(e instanceof PeopleError ? e.message : errorText(e) || 'تعذّر حفظ التعديل. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  const name = f.name.trim()
  return (
    <div>
      <p className="text-[18px] font-extrabold text-title">
        {t(person ? (entity ? 'تعديل بيانات جهة' : 'تعديل بيانات فرد') : entity ? 'إضافة جهة' : 'إضافة فرد')}
        {typeLabel ? ` · ${t(typeLabel)}` : ''}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label={entity ? 'نوع الجهة' : 'النوع'} required>
          <select
            value={f.typeKey}
            onChange={(e) => {
              const key = e.target.value
              const label = types.find((x) => x.key === key)?.label
              setF((x) => ({ ...x, typeKey: key, additional: x.additional.filter((a) => a !== label) }))
            }}
            className={inputClass}
          >
            <option value="">{t('اختر')}</option>
            {types.map((x) => (
              <option key={x.key} value={x.key}>
                {t(x.label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={entity ? 'اسم الجهة' : 'الاسم'} required>
          <input dir="auto" value={f.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="رقم الهاتف" required={!person} wide={false}>
          <input dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} />
        </Field>
        <Field label="البريد الإلكتروني" wide={false}>
          <input dir="ltr" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />
        </Field>
        {!entity && (
          <Field label="الجنسية" wide={false}>
            <input dir="auto" value={f.nationality} onChange={(e) => set('nationality', e.target.value)} className={inputClass} />
          </Field>
        )}
        <Field label={entity ? 'تاريخ التأسيس' : 'تاريخ الميلاد'} required={!person} wide={entity}>
          <input type="date" value={toInputDate(f.birthday)} onChange={(e) => set('birthday', fromInputDate(e.target.value))} className={inputClass} />
        </Field>
        <Field label="العنوان">
          <input dir="auto" value={f.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />
        </Field>
        <Field label="موقعك ومكانك">
          <input dir="auto" value={f.location} onChange={(e) => set('location', e.target.value)} className={inputClass} />
        </Field>
        <div className="col-span-2">
          <p className="mb-1.5 text-[12px] font-bold text-sub">{t('تصنيفات إضافية (اختياري)')}</p>
          <div className="flex flex-wrap gap-2">
            {types
              .filter((x) => x.key !== f.typeKey)
              .map((x) => {
                const on = f.additional.includes(x.label)
                return (
                  <button
                    key={x.key}
                    type="button"
                    onClick={() => set('additional', on ? f.additional.filter((a) => a !== x.label) : [...f.additional, x.label])}
                    className={cn(
                      'h-9 rounded-full border px-3 text-[12px] font-bold',
                      on ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub hover:border-hairline',
                    )}
                  >
                    {t(x.label)}
                  </button>
                )
              })}
          </div>
        </div>
        <Field label="ملاحظات">
          <textarea rows={2} dir="auto" value={f.notes} onChange={(e) => set('notes', e.target.value)} className={cn(inputClass, 'h-auto py-3')} />
        </Field>
        <Field label="معلومات إضافية">
          <textarea rows={2} dir="auto" value={f.extra} onChange={(e) => set('extra', e.target.value)} className={cn(inputClass, 'h-auto py-3')} />
        </Field>
      </div>
      <p className="mt-3 rounded-inner bg-surface px-3 py-2 text-[11px] text-sub">{t('الوثائق ومرفقاتها وتذكيراتها تُضاف من التطبيق.')}</p>
      {error && (
        <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">
          {error
            .split('|')
            .map((part) => t(part))
            .join('')}
        </p>
      )}
      <button
        type="button"
        onClick={ask}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t('حفظ')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد الحفظ"
        message={`«${name}» — ${t(person ? 'هل تريد حفظ التعديل؟' : 'هل تريد حفظ البيانات؟')}`}
        confirmLabel="حفظ"
        busy={busy}
        error={saveError}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

/** إضافة: اختيار فرد أو جهة ثم النموذج. تعديل: النموذج مباشرة. */
export function PersonEditor({ open, person, onClose, onSaved }: { open: boolean; person?: Person; onClose: () => void; onSaved: (message: string) => void }) {
  const { t } = useI18n()
  const [entity, setEntity] = useState<boolean | null>(null)
  useEffect(() => {
    if (open) setEntity(person ? isEntityKey(String(person.typeKey ?? '')) : null)
  }, [open, person])
  return (
    <Sheet open={open} onClose={onClose}>
      {entity === null ? (
        <div>
          <p className="text-[18px] font-extrabold text-title">{t('إضافة فرد / جهة')}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[
              { value: false, label: 'إضافة فرد', icon: UserRound },
              { value: true, label: 'إضافة جهة', icon: Building },
            ].map((x) => (
              <button
                key={x.label}
                type="button"
                onClick={() => setEntity(x.value)}
                className="card flex flex-col items-center gap-2 px-3 py-6 text-[14px] font-extrabold text-ink hover:bg-line/70"
              >
                <x.icon className="size-7 text-brand" />
                {t(x.label)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Body key={`${entity}-${person?.fullName ?? 'new'}`} person={person} entity={entity} onDone={onSaved} />
      )}
    </Sheet>
  )
}
