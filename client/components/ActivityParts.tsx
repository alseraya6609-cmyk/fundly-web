import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, GitBranch, Pencil, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/supabase'
import { AssetError } from '@/lib/assetWrite'
import type { Asset } from '@/lib/data'
import { EMPLOYEE_KEYS, employeesOf, saveActivityBasics, saveEmployees, type Employee } from '@/lib/activityWrite'
import { Sheet } from './ui'
import { Confirm } from './Confirm'

/*
  النشاط التجاري في التطبيق (projects_activities_screen.dart):
  - «تعديل البيانات»: الاسم والموقع والمدير والوصف.
  - «الفروع»: الفرع نشاط مستقل مربوط بالرئيسي ('branch:<id>')، يظهر داخله.
  - «الموظفون»: employees_json (الاسم، الوظيفة، الجوال، تاريخ التعيين،
    الجنسية، المستندات) — إضافة وتعديل وحذف.
*/

const input =
  'h-11 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

function Title({ children, count, onAdd, addLabel }: { children: string; count?: number; onAdd?: () => void; addLabel?: string }) {
  const { t } = useI18n()
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-[14px] font-extrabold text-title">
        <span className="h-4 w-1 rounded-full bg-gold" />
        {t(children)}
        {count !== undefined && <span className="rounded-full bg-surface px-2 text-[11px] text-sub">{count}</span>}
      </p>
      {onAdd && (
        <button type="button" onClick={onAdd} className="flex items-center gap-1 text-[12.5px] font-extrabold text-brand">
          <Plus className="size-4" />
          {t(addLabel ?? 'إضافة')}
        </button>
      )}
    </div>
  )
}

const fail = (e: unknown) => (e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')

/** «تعديل البيانات» للنشاط. */
export function ActivityEditSheet({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [v, setV] = useState({ title: asset.title, location: asset.location_or_type ?? '', owner: asset.owner ?? '', description: asset.description ?? '' })
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }))
  const row = (k: keyof typeof v, label: string, area = false) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-sub">{t(label)}</span>
      {area ? (
        <textarea dir="auto" rows={3} value={v[k]} onChange={(e) => set(k, e.target.value)} className={`${input} h-auto min-h-20 py-2.5`} />
      ) : (
        <input dir="auto" value={v[k]} onChange={(e) => set(k, e.target.value)} className={input} />
      )}
    </label>
  )
  async function save() {
    setBusy(true)
    setError('')
    try {
      await saveActivityBasics(asset.id, v)
      await qc.invalidateQueries({ queryKey: ['assets'] })
      setConfirming(false)
      onDone('تم حفظ التعديل بنجاح')
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t('تعديل البيانات')}</p>
      <div className="mt-4 flex flex-col gap-3">
        {row('title', 'اسم النشاط التجاري')}
        {row('location', 'الموقع/النوع')}
        {row('owner', 'المالك')}
        {row('description', 'الوصف العام', true)}
      </div>
      <button type="button" onClick={() => (setError(''), setConfirming(true))} className="mt-5 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
        {t('حفظ التعديل')}
      </button>
      <Confirm open={confirming} title="تأكيد التعديل" message={t('هل تريد حفظ التعديل؟')} busy={busy} error={error} onConfirm={save} onCancel={() => setConfirming(false)} />
    </Sheet>
  )
}

/** «الفروع» للنشاط الرئيسي. */
export function ActivityBranches({ branches, editable, onOpen, onAdd }: { branches: Asset[]; editable: boolean; onOpen: (id: string) => void; onAdd: () => void }) {
  const { t } = useI18n()
  return (
    <div className="mt-5">
      <Title count={branches.length} onAdd={editable ? onAdd : undefined} addLabel="إضافة فرع">
        الفروع
      </Title>
      {branches.length === 0 ? (
        <p className="rounded-inner bg-surface px-3 py-3 text-[12px] text-muted">{t('لا توجد فروع بعد — اضغط + المقابل لعنوان «الفروع» لإضافة فرع.')}</p>
      ) : (
        <div className="flex flex-col gap-2 rounded-inner bg-surface p-2">
          {branches.map((b) => (
            <button key={b.id} type="button" onClick={() => onOpen(b.id)} className="card-inner flex items-center gap-2 px-3 py-2.5 text-start hover:ring-1 hover:ring-brand">
              <GitBranch className="size-4 shrink-0 text-brand" />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-[13px] font-extrabold text-title">
                  {b.title}
                </span>
                <span className="block text-[11px] text-muted">{[t(b.sub_type), b.location_or_type, t(b.status)].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const EMPLOYEE_LABELS: Record<string, string> = {
  الاسم: 'اسم الموظف',
  الوظيفة: 'الوظيفة',
  الجنسية: 'الجنسية',
  الجوال: 'رقم الهاتف',
  'تاريخ التعيين': 'تاريخ التعيين',
  المستندات: 'المستندات (إقامة، عقد عمل، شهادات...)',
}

function toInput(dmy: string) {
  const p = dmy.split('/').map((x) => parseInt(x, 10))
  if (p.length !== 3 || p.some(Number.isNaN)) return ''
  return `${p[2]}-${String(p[1]).padStart(2, '0')}-${String(p[0]).padStart(2, '0')}`
}
function fromInput(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10))
  return `${d}/${m}/${y}`
}

function EmployeeForm({ assetId, existing, index, onClose, onDone }: { assetId: string; existing?: Employee; index?: number; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [v, setV] = useState<Employee>(() => Object.fromEntries(EMPLOYEE_KEYS.map((k) => [k, existing?.[k] ?? ''])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = existing !== undefined && index !== undefined
  const field = (k: string, extra?: { type?: string; area?: boolean }) => (
    <label className={`flex flex-col gap-1 ${k === 'الاسم' || k === 'المستندات' ? 'col-span-2' : ''}`}>
      <span className="text-[12px] font-bold text-sub">
        {t(EMPLOYEE_LABELS[k])}
        {k === 'الاسم' && <span className="text-danger"> *</span>}
      </span>
      {extra?.area ? (
        <textarea dir="auto" rows={2} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} className={`${input} h-auto min-h-16 py-2.5`} />
      ) : extra?.type === 'date' ? (
        <input type="date" value={toInput(v[k])} onChange={(e) => setV((x) => ({ ...x, [k]: fromInput(e.target.value) }))} className={input} />
      ) : (
        <input dir={extra?.type === 'tel' ? 'ltr' : 'auto'} inputMode={extra?.type === 'tel' ? 'tel' : undefined} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} className={input} />
      )}
    </label>
  )
  async function save() {
    const name = v['الاسم'].trim()
    if (!name) {
      setError('اسم الموظف مطلوب')
      return
    }
    setBusy(true)
    setError('')
    const data = Object.fromEntries(EMPLOYEE_KEYS.map((k) => [k, (v[k] ?? '').trim()]))
    try {
      await saveEmployees(
        assetId,
        (list) => {
          const next = [...list]
          if (editing && index! < next.length) next[index!] = data
          else next.push(data)
          return next
        },
        editing ? `تم تعديل بيانات الموظف: ${name}` : `تمت إضافة موظف: ${name}`,
      )
      await qc.invalidateQueries({ queryKey: ['assets'] })
      onDone(editing ? 'تم حفظ التعديل بنجاح' : 'تمت إضافة الموظف')
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t(editing ? 'تعديل بيانات الموظف' : 'إضافة موظف')}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {field('الاسم')}
        {field('الوظيفة')}
        {field('الجنسية')}
        {field('الجوال', { type: 'tel' })}
        {field('تاريخ التعيين', { type: 'date' })}
        {field('المستندات', { area: true })}
      </div>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button type="button" disabled={busy} onClick={save} className="mt-5 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
        {t(busy ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديلات' : '+ إضافة')}
      </button>
    </Sheet>
  )
}

/** «الموظفون» في النشاط أو الفرع. */
export function ActivityEmployees({ asset, editable, canRemove, onDone }: { asset: Asset; editable: boolean; canRemove: boolean; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const list = employeesOf(asset)
  const [form, setForm] = useState<{ existing?: Employee; index?: number } | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function remove() {
    if (removing === null) return
    const target = list[removing]
    setBusy(true)
    setError('')
    try {
      // يُحذف بمطابقة بياناته لا بموضعه فقط، كي لا يُحذف غيره إن تغيّرت القائمة.
      await saveEmployees(
        asset.id,
        (current) => {
          const at = current.findIndex((e) => EMPLOYEE_KEYS.every((k) => (e[k] ?? '') === (target[k] ?? '')))
          return at < 0 ? current : current.filter((_, i) => i !== at)
        },
        '',
      )
      await qc.invalidateQueries({ queryKey: ['assets'] })
      setRemoving(null)
      onDone('تم الحذف')
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-5">
      <Title count={list.length} onAdd={editable ? () => setForm({}) : undefined} addLabel="إضافة موظف">
        الموظفون
      </Title>
      {list.length === 0 ? (
        <p className="rounded-inner bg-surface px-3 py-3 text-[12px] text-muted">{t('لا يوجد موظفون بعد — اضغط + المقابل لعنوان القسم لإضافة موظف.')}</p>
      ) : (
        <div className="flex flex-col gap-2 rounded-inner bg-surface p-2">
          {list.map((e, i) => (
            <div key={i} className="card-inner flex items-center gap-2 px-3 py-2.5">
              <BadgeCheck className="size-4 shrink-0 text-brand" />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-[13px] font-extrabold text-title">
                  {e['الاسم'] || '—'}
                </span>
                <span dir="auto" className="block text-[11px] text-muted">
                  {[e['الوظيفة'], e['الجنسية'], e['الجوال'], e['تاريخ التعيين'] && `${t('تاريخ التعيين')}: ${e['تاريخ التعيين']}`].filter(Boolean).join(' · ')}
                </span>
                {e['المستندات'] && (
                  <span dir="auto" className="block text-[11px] text-sub">
                    {e['المستندات']}
                  </span>
                )}
              </span>
              {editable && (
                <button type="button" aria-label={t('تعديل')} onClick={() => setForm({ existing: e, index: i })} className="grid size-8 place-items-center rounded-full text-sub hover:bg-line hover:text-brand">
                  <Pencil className="size-4" />
                </button>
              )}
              {editable && canRemove && (
                <button type="button" aria-label={t('حذف')} onClick={() => (setError(''), setRemoving(i))} className="grid size-8 place-items-center rounded-full text-danger hover:bg-danger-soft">
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {form && (
        <EmployeeForm
          assetId={asset.id}
          existing={form.existing}
          index={form.index}
          onClose={() => setForm(null)}
          onDone={(m) => {
            setForm(null)
            onDone(m)
          }}
        />
      )}
      <Confirm
        open={removing !== null}
        title="حذف الموظف"
        message={`«${removing !== null ? (list[removing]?.['الاسم'] ?? '') : ''}» — ${t('هل تريد الحذف؟')}`}
        confirmLabel="حذف"
        danger
        busy={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
