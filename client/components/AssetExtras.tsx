import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Building, CheckCircle2, Copy, Plus, Printer, Share2, UserRound } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { money } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { AssetError } from '@/lib/assetWrite'
import { usePeopleAll, useCurrency, type Asset, type UnitContract, type UnitPayment } from '@/lib/data'
import { addAnnex } from '@/lib/activityWrite'
import { payNameOf } from '@/lib/leaseActions'
import { Sheet } from './ui'
import { PersonEditor } from './PersonEditor'
import { printText } from './LeaseForm'

/*
  أقسام صغيرة في تفاصيل الأصل (projects_activities_screen.dart):
  - «الأصول والمرافق» للنشاط و«إكسسوارات المركبات» (_addActivityAsset).
  - «الأفراد والجهات» المرتبطون بالأصل (_loadAssetPeople / _openQuickPersonSheet:
    «الأصل المرتبط» = اسم الأصل، وفلتر النوع).
  - «سند قبض» و«مطالبة مالية» لعقد تأجير المركبة (_shareEquipDocument).
*/

function Title({ text, count, onAdd, addLabel }: { text: string; count?: number; onAdd?: () => void; addLabel?: string }) {
  const { t } = useI18n()
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-[14px] font-extrabold text-title">
        <span className="h-4 w-1 rounded-full bg-gold" />
        {t(text)}
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

const input =
  'h-11 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

/** الأصول والمعدات (النشاط) أو الإكسسوارات (المركبة) في annexes. */
export function AnnexesBox({ asset, vehicle, editable, onDone }: { asset: Asset; vehicle: boolean; editable: boolean; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const list = Object.entries((asset.annexes ?? {}) as Record<string, unknown>).filter(([, v]) => Number(v) > 0)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [count, setCount] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const addTitle = vehicle ? 'إضافة إكسسوار' : 'إضافة أصل أو معدة'
  async function save() {
    if (!name.trim()) return setError('اكتب الاسم')
    setBusy(true)
    setError('')
    try {
      await addAnnex(asset.id, name, parseInt(count.trim(), 10) || 1)
      await qc.invalidateQueries({ queryKey: ['assets'] })
      setAdding(false)
      setName('')
      setCount('1')
      onDone('تم الحفظ')
    } catch (e) {
      setError(e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-5">
      <Title text={vehicle ? 'إكسسوارات المركبات' : 'الأصول والمرافق'} count={list.length} onAdd={editable ? () => (setError(''), setAdding(true)) : undefined} addLabel={addTitle} />
      {list.length === 0 ? (
        <p className="rounded-inner bg-surface px-3 py-3 text-[12px] text-muted">{t(vehicle ? 'لا توجد إكسسوارات بعد — اضغط + لإضافة إكسسوار.' : 'لا توجد أصول أو معدات مسجّلة لهذا النشاط بعد.')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[12px] font-bold text-ink">
              <CheckCircle2 className="size-3.5 text-brand" />
              <span dir="auto">{t(k)}</span>
              <span className="text-muted">
                — {t('العدد:')} {String(v)}
              </span>
            </span>
          ))}
        </div>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)}>
        <p className="text-[17px] font-extrabold text-title">{t(addTitle)}</p>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('الاسم')}</span>
            <input dir="auto" value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('العدد')}</span>
            <input dir="ltr" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ''))} className={input} />
          </label>
        </div>
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <button type="button" disabled={busy} onClick={save} className="mt-5 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
          {t(busy ? 'جارٍ الحفظ…' : 'حفظ')}
        </button>
      </Sheet>
    </div>
  )
}

export const LINKED_ASSET_KEY = 'الأصل المرتبط'

/** _assetPersonTypes */
const PERSON_TYPES: [string, string][] = [
  ['موظف', 'person_employee'],
  ['عميل', 'person_client'],
  ['مورد', 'person_supplier'],
  ['مقاول', 'person_contractor'],
  ['شريك', 'person_partner'],
  ['مندوب', 'person_representative'],
  ['استشاري', 'person_consultant'],
  ['أفراد آخرون', 'person_other'],
  ['الشركات', 'entity_company'],
  ['جهات حكومية', 'entity_government'],
  ['جهات أخرى', 'entity_other'],
]

/** «الأفراد والجهات» المضافون من الأصل نفسه («الأصل المرتبط»). */
export function AssetPeopleBox({ asset, editable, onDone }: { asset: Asset; editable: boolean; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const people = usePeopleAll()
  const [type, setType] = useState('الكل')
  const [adding, setAdding] = useState(false)
  const linked = useMemo(
    () => (people.data ?? []).filter((p) => String((p.details as Record<string, unknown> | undefined)?.[LINKED_ASSET_KEY] ?? '').trim() === asset.title.trim()),
    [people.data, asset.title],
  )
  const shown = linked.filter((p) => {
    if (type === 'الكل') return true
    if (p.categoryName === type) return true
    if (type === 'أفراد آخرون') return p.typeKey === 'person_other'
    if (type === 'جهات أخرى') return p.typeKey === 'entity_other'
    return false
  })
  const phoneOf = (p: (typeof linked)[number]) => {
    const d = (p.details ?? {}) as Record<string, unknown>
    return String(d['رقم الهاتف'] ?? '').trim() || String(d['رقم الجوال'] ?? '').trim()
  }
  return (
    <div className="mt-5">
      <Title text="الأفراد والجهات" count={linked.length} onAdd={editable ? () => setAdding(true) : undefined} addLabel="إضافة فرد أو جهة" />
      {linked.length > 0 && (
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('النوع')} className="mb-2 h-9 rounded-full border border-line bg-white px-3 text-[12px] font-bold text-ink outline-none">
          {['الكل', ...PERSON_TYPES.map((x) => x[0])].map((o) => (
            <option key={o} value={o}>
              {t(o)}
            </option>
          ))}
        </select>
      )}
      {linked.length === 0 ? (
        <p className="rounded-inner bg-surface px-3 py-3 text-[12px] text-muted">{t('لا يوجد أفراد مرتبطون بعد — كل من يُضاف هنا يُحفظ في «الأفراد والجهات» تلقائيًا.')}</p>
      ) : (
        <div className="flex flex-col gap-2 rounded-inner bg-surface p-2">
          {shown.map((p) => (
            <div key={p.fullName} className="card-inner flex items-center gap-2 px-3 py-2.5">
              {String(p.typeKey ?? '').startsWith('entity') ? <Building className="size-4 shrink-0 text-brand" /> : <UserRound className="size-4 shrink-0 text-brand" />}
              <span dir="auto" className="min-w-0 flex-1 truncate text-[13px] font-extrabold text-title">
                {t(String(p.categoryName ?? ''))} — {p.fullName}
              </span>
              <span dir="ltr" className="shrink-0 text-[12px] font-bold text-sub">
                {phoneOf(p) || t('بلا هاتف')}
              </span>
            </div>
          ))}
        </div>
      )}
      <PersonEditor
        open={adding}
        linkDetails={{ [LINKED_ASSET_KEY]: asset.title.trim() }}
        onClose={() => setAdding(false)}
        onSaved={(m) => {
          setAdding(false)
          onDone(m)
        }}
      />
    </div>
  )
}

/** _shareEquipDocument: سند قبض (المسدد) أو مطالبة مالية (المتبقي) نصًّا. */
export function vehicleDocumentText(asset: Asset, contract: UnitContract, payments: UnitPayment[], receipt: boolean, currency: string, t: (s: string) => string): string | null {
  const now = new Date()
  const d = (date: Date) => `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`
  const lines = [t(receipt ? 'سند قبض' : 'مطالبة مالية'), `${t('المركبة')}: ${asset.title}`, `${t('المستأجر')}: ${contract.tenant_name || '—'}`, `${t('التاريخ')}: ${d(now)}`, '']
  let total = 0
  for (const p of payments) {
    const due = Number(p.amount_due) || 0
    const paid = Number(p.amount_paid) || 0
    const amount = receipt ? paid : Math.max(0, due - paid)
    if (amount <= 0) continue
    total += amount
    const dueDate = p.due_date ? (() => {
      const [y, m, dd] = p.due_date.slice(0, 10).split('-').map(Number)
      return ` — ${t('استحقاق')} ${dd}/${m}/${y}`
    })() : ''
    lines.push(`- ${t(payNameOf(p))}: ${money(amount, currency)}${dueDate}`)
  }
  if (total <= 0) return null
  lines.push('', `${t(receipt ? 'إجمالي المسدد' : 'إجمالي المستحق')}: ${money(total, currency)}`)
  return lines.join('\n')
}

/** عرض نص المستند مع «مشاركة» و«نسخ» و«طباعة» (بدل Share.share في الجوال). */
export function TextShareSheet({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t(title)}</p>
      <pre dir="auto" className="mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-inner bg-surface p-3 font-[inherit] text-[13px] leading-[1.9] text-ink">
        {text}
      </pre>
      {copied && <p className="mt-2 text-[12px] font-bold text-brand">{t('تم النسخ')}</p>}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {canShare && (
          <button type="button" onClick={() => void navigator.share({ title: t(title), text }).catch(() => {})} className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-brand text-[12.5px] font-extrabold text-white">
            <Share2 className="size-4" />
            {t('مشاركة')}
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(text)
              .then(() => setCopied(true))
              .catch(() => {})
          }
          className="flex h-11 items-center justify-center gap-1.5 rounded-inner border border-brand text-[12.5px] font-extrabold text-brand"
        >
          <Copy className="size-4" />
          {t('نسخ')}
        </button>
        <button type="button" onClick={() => printText(t(title), text)} className="flex h-11 items-center justify-center gap-1.5 rounded-inner border border-brand text-[12.5px] font-extrabold text-brand">
          <Printer className="size-4" />
          {t('طباعة')}
        </button>
      </div>
    </Sheet>
  )
}

export function useCurrencyLabel() {
  const { t } = useI18n()
  return t(useCurrency())
}
