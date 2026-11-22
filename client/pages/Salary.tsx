import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, CheckCircle2, Loader2, PenLine, Plus, Printer, ReceiptText, Search, Trash2, Pencil, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { useCurrency, usePeople, useStore } from '@/lib/data'
import { CURRENCIES } from '@/lib/catalog'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { publicName } from '@/lib/requestsWrite'
import { isValidFnd, nameForFnd, normalizeFnd } from '@/lib/personalWrite'
import {
  APPROVED,
  KIND_GENERAL,
  KIND_SALARY,
  MONTHS,
  PARTIES_EMPLOYER,
  PARTIES_HANDOVER,
  PENDING,
  REJECTED,
  SIGN_HERE,
  SIGN_REMOTE,
  SalaryError,
  dayOf,
  decodeStrokes,
  deleteReceipt,
  encodeStrokes,
  isSalary,
  monthOf,
  payeeLabel,
  payerLabel,
  periodLabel,
  periodOf,
  plainNum,
  receiptNo,
  respondReceipt,
  saveReceipt,
  signHereLabel,
  syncOwnerExpenses,
  titleOf,
  useSalaryReceipts,
  yearOf,
  type Draft,
  type Receipt,
} from '@/lib/salary'
import { Chip, Empty, ErrorBox, Loading, PageHeader, Sheet } from '@/components/ui'
import { Confirm } from '@/components/Confirm'
import { SignaturePad, SignatureView } from '@/components/SignaturePad'

const input = 'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'
const STATUS_TONE: Record<string, string> = { [APPROVED]: 'bg-brand-soft text-brand', [REJECTED]: 'bg-danger-soft text-danger', [PENDING]: 'bg-gold-soft text-gold-dark' }
const moneyOf = (v: number, currency: string, t: (s: string) => string) => `${plainNum(v)} ${t(currency)}`.trim()
const stampOf = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** سندات القبض والرواتب: ما أصدرته، وما وصلني للاعتماد والتوقيع. */
export default function Salary() {
  const { t } = useI18n()
  const q = useSalaryReceipts()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<0 | 1>(0)
  const [year, setYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState<{ existing?: Receipt } | null>(null)
  const [notice, setNotice] = useState('')
  const [printing, setPrinting] = useState<Receipt | null>(null)
  const employeeFnd = params.get('fnd') ?? ''
  const employeeName = params.get('name') ?? ''
  const forEmployee = !!(employeeFnd || employeeName)
  const flash = (m: string) => {
    setNotice(m)
    window.setTimeout(() => setNotice(''), 4000)
  }

  // المرفوض: مصروفه «ملغاة»، والمعتمد «مكتملة» (_cancelRejectedExpenses).
  const synced = useRef(false)
  useEffect(() => {
    if (!q.data || synced.current) return
    synced.current = true
    syncOwnerExpenses(q.data.mine).catch(() => {})
  }, [q.data])

  // يُفتح السند المطلوب (من الطلبات) في تبويبه وسنته.
  const openId = params.get('open') ?? ''
  const all = useMemo(() => [...(q.data?.mine ?? []), ...(q.data?.toMe ?? [])], [q.data])
  const open = all.find((r) => r.id === openId) ?? null
  const asOwner = !!open && (q.data?.mine ?? []).some((r) => r.id === open.id)
  useEffect(() => {
    if (!open) return
    setTab(asOwner ? 0 : 1)
    const y = yearOf(open)
    if (y) setYear(y)
  }, [open, asOwner])

  const source = useMemo(() => {
    const list = (tab === 0 ? q.data?.mine : q.data?.toMe) ?? []
    if (!forEmployee) return list
    return list.filter((r) => (employeeFnd ? r.employee_fnd === employeeFnd : r.employee_name.trim() === employeeName.trim()))
  }, [q.data, tab, forEmployee, employeeFnd, employeeName])
  const years = useMemo(() => [...new Set([new Date().getFullYear(), ...source.map(yearOf).filter((y): y is number => !!y)])].sort((a, b) => b - a), [source])
  const shown = source.filter((r) => yearOf(r) === year)

  return (
    <div>
      <PageHeader icon={ReceiptText} color="#0A5A50" title="سندات القبض والرواتب" subtitle={forEmployee ? employeeName || employeeFnd : 'ما أصدرته، وما وصلك للاعتماد والتوقيع'} />
      {notice && (
        <p className="mb-3 flex items-center gap-2 rounded-inner bg-brand-soft px-4 py-3 text-[13px] font-bold text-brand">
          <CheckCircle2 className="size-4" />
          {t(notice)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={tab === 0} label="سنداتي" count={q.data?.mine.length} onClick={() => setTab(0)} />
        {!forEmployee && <Chip active={tab === 1} label="وصلتني" count={q.data?.toMe.length} onClick={() => setTab(1)} />}
        <button type="button" onClick={() => setForm({})} className="ms-auto flex h-11 items-center gap-1.5 rounded-inner bg-brand px-4 text-[13px] font-extrabold text-white hover:bg-brand-dark">
          <Plus className="size-4" />
          {t('سند جديد')}
        </button>
      </div>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
        {years.map((y) => (
          <button key={y} type="button" onClick={() => setYear(y)} className={cn('h-9 shrink-0 rounded-full px-4 text-[13px] font-extrabold', y === year ? 'bg-gold text-white' : 'bg-surface text-sub')}>
            {y}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : shown.length === 0 ? (
          <Empty icon={ReceiptText} text={tab === 0 ? 'لا توجد سندات في هذه السنة' : 'لم يصلك سند في هذه السنة'} />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {shown.map((r) => (
              <button key={r.id} type="button" onClick={() => setParams({ ...Object.fromEntries(params), open: r.id })} className="card flex items-center gap-3 p-4 text-start hover:bg-line/60">
                <span className="grid size-11 shrink-0 place-items-center rounded-inner bg-brand-soft text-brand">
                  <ReceiptText className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-extrabold text-title">{titleOf(r, t)}</span>
                  <span dir="auto" className="block truncate text-[12px] text-sub">
                    {tab === 0 ? r.employee_name : r.owner_name} · {r.receipt_date}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="text-[13px] font-extrabold text-ink">{moneyOf(r.paid, r.currency, t)}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-extrabold', STATUS_TONE[r.status] ?? 'bg-surface text-sub')}>{t(r.status)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!open} onClose={() => setParams(Object.fromEntries([...params].filter(([k]) => k !== 'open')))}>
        {open && (
          <ReceiptDetails
            r={open}
            asOwner={asOwner}
            onEdit={() => setForm({ existing: open })}
            onPrint={() => setPrinting(open)}
            onDone={(m) => {
              setParams(Object.fromEntries([...params].filter(([k]) => k !== 'open')))
              flash(m)
            }}
          />
        )}
      </Sheet>
      {form && (
        <ReceiptForm
          existing={form.existing}
          presetFnd={employeeFnd}
          presetName={employeeName}
          others={q.data?.mine ?? []}
          onClose={() => setForm(null)}
          onDone={(m) => {
            setForm(null)
            setParams(Object.fromEntries([...params].filter(([k]) => k !== 'open')))
            flash(m)
          }}
        />
      )}
      {printing && <ReceiptPrint r={printing} onClose={() => setPrinting(null)} />}
    </div>
  )
}

// ---------------- تفاصيل السند ----------------

function ReceiptDetails({ r, asOwner, onEdit, onPrint, onDone }: { r: Receipt; asOwner: boolean; onEdit: () => void; onPrint: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [step, setStep] = useState<'sign' | 'reject' | 'delete' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const money = (v: number) => moneyOf(v, r.currency, t)
  const breakdown: [string, string, boolean][] = isSalary(r)
    ? [
        ['الراتب الأساسي', money(r.basic), false],
        ...(r.allowances > 0 ? [['العلاوات', money(r.allowances), false] as [string, string, boolean]] : []),
        ...(r.overtime > 0 ? [['العمل الإضافي', money(r.overtime), false] as [string, string, boolean]] : []),
        ...(r.loan > 0 ? [['السلفة', `− ${money(r.loan)}`, false] as [string, string, boolean]] : []),
        ...(r.deductions > 0 ? [['الخصومات', `− ${money(r.deductions)}`, false] as [string, string, boolean]] : []),
        ['المجموع', money(r.total), true],
      ]
    : [['البيان', r.description || '—', false]]
  const info: [string, string][] = [
    ['رقم السند', receiptNo(r)],
    ['التاريخ', r.receipt_date],
    ['طريقة التوقيع', t(r.sign_mode === SIGN_HERE ? signHereLabel(r) : 'أُرسل للاعتماد والتوقيع')],
    ...(r.signed_at ? [[r.status === REJECTED ? 'وقت الرفض' : 'وقت التوقيع', stampOf(r.signed_at)] as [string, string]] : []),
    ...(r.notes ? [['ملاحظات', r.notes] as [string, string]] : []),
    ...(r.status === REJECTED && r.reject_reason ? [['سبب الرفض', r.reject_reason] as [string, string]] : []),
  ]
  const strokes = decodeStrokes(r.signature)

  async function answer(accept: boolean, signature = '') {
    setBusy(true)
    setError('')
    try {
      const message = await respondReceipt(r, accept, signature, reason.trim(), t)
      if (message) {
        setError(message)
        return
      }
      await qc.invalidateQueries({ queryKey: ['salary'] })
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setStep(null)
      onDone(accept ? 'تمت الموافقة والتوقيع' : 'تم رفض السند')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="rounded-card bg-gradient-to-br from-brand-deep to-brand p-4 text-white">
        <div className="flex items-center gap-2">
          <ReceiptText className="size-5" />
          <p className="flex-1 text-[13px] font-extrabold">{t(isSalary(r) ? 'سند قبض راتب' : 'سند قبض')}</p>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-extrabold">{t(r.status)}</span>
        </div>
        <p className="mt-2 text-[18px] font-extrabold">{titleOf(r, t)}</p>
        <p className="mt-2 text-[11.5px] opacity-80">{t('المبلغ المدفوع')}</p>
        <p className="text-[24px] font-extrabold">{money(r.paid)}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(
          [
            [payerLabel(r), r.owner_name, ''],
            [payeeLabel(r), r.employee_name, r.employee_fnd],
          ] as const
        ).map(([label, name, fnd]) => (
          <div key={label} className="rounded-inner bg-surface px-3 py-2">
            <p className="text-[11px] text-muted">{t(label)}</p>
            <p dir="auto" className="text-[13.5px] font-extrabold text-title">
              {name || '—'}
            </p>
            {fnd && <p className="ltr text-[11px] font-bold text-gold-dark">{fnd}</p>}
          </div>
        ))}
      </div>
      <div className="card-inner mt-3 px-3 py-2">
        <p className="mb-1 text-[13px] font-extrabold text-title">{t(isSalary(r) ? 'تفاصيل الراتب' : 'تفاصيل السند')}</p>
        {breakdown.map(([k, v, bold]) => (
          <div key={k} className="flex justify-between gap-3 border-t border-line py-2 text-[12.5px] first:border-t-0">
            <span className={bold ? 'font-extrabold text-title' : 'text-muted'}>{t(k)}</span>
            <span dir="auto" className="font-bold text-ink">
              {v}
            </span>
          </div>
        ))}
      </div>
      <div className="card-inner mt-3 px-3 py-2">
        {info.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-1.5 text-[12.5px]">
            <span className="text-muted">{t(k)}</span>
            <span dir="auto" className="text-end font-bold text-ink">
              {v}
            </span>
          </div>
        ))}
      </div>
      {strokes.length > 0 && (
        <div className="card-inner mt-3 flex items-center gap-3 px-3 py-2">
          <SignatureView strokes={strokes} className="size-24 rounded-inner border border-line bg-white" />
          <div>
            <p className="text-[11px] text-muted">{t('توقيع المستلم')}</p>
            <p dir="auto" className="text-[13px] font-extrabold text-title">
              {r.employee_name}
            </p>
            {r.signed_at && <p className="text-[11px] text-sub">{stampOf(r.signed_at)}</p>}
          </div>
        </div>
      )}
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}

      {!asOwner && r.status === PENDING && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => (setError(''), setStep('sign'))} className="flex h-12 items-center justify-center gap-1.5 rounded-field bg-brand text-[13.5px] font-extrabold text-white">
            <PenLine className="size-4" />
            {t('موافقة وتوقيع')}
          </button>
          <button
            type="button"
            onClick={() => {
              setError('')
              setReason('')
              setStep('reject')
            }}
            className="flex h-12 items-center justify-center gap-1.5 rounded-field border border-danger text-[13.5px] font-extrabold text-danger"
          >
            <X className="size-4" />
            {t('رفض')}
          </button>
        </div>
      )}
      <button type="button" onClick={onPrint} className="mt-2 flex h-12 w-full items-center justify-center gap-1.5 rounded-field bg-brand-deep text-[13.5px] font-extrabold text-white">
        <Printer className="size-4" />
        {t('طباعة / حفظ PDF')}
      </button>
      {asOwner && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {r.status !== APPROVED ? (
            <button type="button" onClick={onEdit} className="flex h-12 items-center justify-center gap-1.5 rounded-field border border-brand text-[13.5px] font-extrabold text-brand">
              <Pencil className="size-4" />
              {t(r.status === REJECTED ? 'تعديل وإعادة الإرسال' : 'تعديل')}
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={() => (setError(''), setStep('delete'))} className="flex h-12 items-center justify-center gap-1.5 rounded-field border border-danger text-[13.5px] font-extrabold text-danger">
            <Trash2 className="size-4" />
            {t('حذف')}
          </button>
        </div>
      )}

      <SignaturePad
        open={step === 'sign'}
        title={t('التوقيع للموافقة')}
        subtitle={`${t('توقيعك يعني أنك استلمت')} ${money(r.paid)} — ${titleOf(r, t)}`}
        onClose={() => setStep(null)}
        onDone={(st) => answer(true, encodeStrokes(st))}
      />
      <Sheet open={step === 'reject'} onClose={() => !busy && setStep(null)}>
        <p className="text-[18px] font-extrabold text-title">{t('رفض السند')}</p>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('سبب الرفض (اختياري)')}</span>
          <textarea dir="auto" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={`${input} h-auto py-2.5`} />
        </label>
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <button type="button" disabled={busy} onClick={() => answer(false)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-field bg-danger text-[14px] font-extrabold text-white disabled:opacity-60">
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t('رفض')}
        </button>
      </Sheet>
      <Confirm
        open={step === 'delete'}
        title="حذف السند"
        message={`«${titleOf(r, t)}» — ${t('سيُحذف ومصروفه من الالتزامات الشخصية. هل تريد الحذف؟')}`}
        confirmLabel="حذف"
        danger
        busy={busy}
        error={error}
        onConfirm={async () => {
          setBusy(true)
          setError('')
          try {
            await deleteReceipt(r)
            await qc.invalidateQueries({ queryKey: ['salary'] })
            await qc.invalidateQueries({ queryKey: ['personal'] })
            setStep(null)
            onDone('تم حذف السند')
          } catch (e) {
            setError(errorText(e) || 'تعذّر الحذف. حاول مرة أخرى.')
          } finally {
            setBusy(false)
          }
        }}
        onCancel={() => setStep(null)}
      />
    </div>
  )
}

// ---------------- نموذج السند ----------------

function ReceiptForm({
  existing,
  presetFnd,
  presetName,
  others,
  onClose,
  onDone,
}: {
  existing?: Receipt
  presetFnd: string
  presetName: string
  others: Receipt[]
  onClose: () => void
  onDone: (m: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { profile } = useSession()
  const store = useStore()
  const people = usePeople()
  const defaultCurrency = useCurrency()
  const me = profile?.fnd_id ?? ''
  const nOf = (v: number) => (v === 0 ? '' : plainNum(v))
  const now = new Date()
  const [kind, setKind] = useState(existing?.kind ?? KIND_SALARY)
  const [parties, setParties] = useState(existing?.parties ?? PARTIES_EMPLOYER)
  const [fnd, setFnd] = useState(existing?.employee_fnd ?? presetFnd)
  const [name, setName] = useState(existing?.employee_name ?? presetName)
  const [v, setV] = useState(() => {
    const base = { basic: nOf(existing?.basic ?? 0), allowances: nOf(existing?.allowances ?? 0), overtime: nOf(existing?.overtime ?? 0), loan: nOf(existing?.loan ?? 0), deductions: nOf(existing?.deductions ?? 0), paid: nOf(existing?.paid ?? 0) }
    // راتب الموظف السابق يُقترح للسند الجديد.
    if (!existing && presetFnd) {
      const prev = others.find((r) => isSalary(r) && r.employee_fnd === presetFnd)
      if (prev) {
        base.basic = nOf(prev.basic)
        base.allowances = nOf(prev.allowances)
        const total = prev.basic + prev.allowances
        if (!base.paid && total > 0) base.paid = plainNum(total)
      }
    }
    return base
  })
  const [paidTouched, setPaidTouched] = useState(!!existing)
  const [description, setDescription] = useState(existing?.description ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [year, setYear] = useState(existing ? (yearOf(existing) ?? now.getFullYear()) : now.getFullYear())
  const [month, setMonth] = useState(existing ? (monthOf(existing) ?? now.getMonth() + 1) : now.getMonth() + 1)
  const [day, setDay] = useState(() => {
    const p = (existing?.receipt_date ?? '').split('/')
    const d = p.length === 3 ? new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10)) : now
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [signMode, setSignMode] = useState(existing?.sign_mode ?? SIGN_HERE)
  const [currency, setCurrency] = useState((existing?.currency ?? '').trim() || defaultCurrency)
  // العملة الافتراضية تصل بعد تحميل الإعدادات.
  useEffect(() => {
    if (!currency && defaultCurrency) setCurrency(defaultCurrency)
  }, [currency, defaultCurrency])
  const [owner, setOwner] = useState<string | null>(null)
  const [checked, setChecked] = useState('')
  const [looking, setLooking] = useState(false)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [dupAsk, setDupAsk] = useState(false)
  const [signing, setSigning] = useState(false)
  const [busy, setBusy] = useState(false)
  const salary = kind === KIND_SALARY
  const employeeWords = salary && parties !== PARTIES_HANDOVER
  const num = (x: string) => parseFloat(x.trim().replace(/,/g, '')) || 0
  const total = Math.max(0, num(v.basic) + num(v.allowances) + num(v.overtime) - num(v.loan) - num(v.deductions))
  const setNum = (k: keyof typeof v, value: string) =>
    setV((x) => {
      const next = { ...x, [k]: value }
      if (k !== 'paid' && !paidTouched) {
        const tot = Math.max(0, num(next.basic) + num(next.allowances) + num(next.overtime) - num(next.loan) - num(next.deductions))
        next.paid = tot === 0 ? '' : plainNum(tot)
      }
      return next
    })

  // صاحب الرقم التعريفي (_lookup).
  useEffect(() => {
    const id = normalizeFnd(fnd)
    if (!isValidFnd(id)) {
      setChecked('')
      setOwner(null)
      return
    }
    if (id === checked) return
    let alive = true
    setLooking(true)
    nameForFnd(id).then((n) => {
      if (!alive) return
      setLooking(false)
      setChecked(id)
      setOwner(n || null)
      if (n && !salary && !name.trim()) setName(n)
    })
    return () => {
      alive = false
    }
  }, [fnd]) // eslint-disable-line react-hooks/exhaustive-deps

  const dmy = () => {
    const [y, m, d] = day.split('-').map((x) => parseInt(x, 10))
    return { y, m, d, text: `${d}/${m}/${y}` }
  }

  function check(): string | null {
    const id = normalizeFnd(fnd)
    const hasFnd = !!id
    const remote = signMode === SIGN_REMOTE
    const finalName = salary ? name.trim().replace(/\s+/g, ' ') : name.trim() || (owner ?? '').trim()
    const parts = finalName.split(/\s+/).filter(Boolean).length
    if (remote && !hasFnd) return 'الإرسال للاعتماد والتوقيع يحتاج الرقم التعريفي للمستلم'
    if (hasFnd && !isValidFnd(id)) return 'الرقم التعريفي بصيغة FND-XXXX-XXXX'
    if (hasFnd && id === me) return 'لا يمكن إصدار سند لنفسك'
    if (remote && (checked !== id || owner === null)) return looking ? 'انتظر حتى يظهر صاحب الرقم التعريفي' : 'لم يُعثر على صاحب هذا الرقم — تأكد منه'
    if (!finalName) return employeeWords ? 'اكتب اسم الموظف الحقيقي' : 'اكتب اسم المستلم'
    if (salary && parts < 2) return employeeWords ? 'اكتب اسم الموظف الحقيقي من اسمين على الأقل' : 'اكتب اسم المستلم من اسمين على الأقل'
    if (!salary && !description.trim()) return 'اكتب بيان السند'
    if (num(v.paid) <= 0) return 'أدخل المبلغ المدفوع'
    return null
  }

  function submit() {
    const problem = check()
    if (problem) return setError(problem)
    setError('')
    const id = normalizeFnd(fnd)
    const finalName = salary ? name.trim().replace(/\s+/g, ' ') : name.trim() || (owner ?? '').trim()
    const period = salary ? periodOf(year, month) : periodOf(dmy().y, dmy().m)
    const dup =
      salary &&
      others.some((r) => isSalary(r) && r.id !== existing?.id && (id ? r.employee_fnd === id : r.employee_name === finalName) && r.period === period && r.status !== REJECTED)
    if (dup) return setDupAsk(true)
    proceed()
  }

  function proceed() {
    setDupAsk(false)
    if (signMode === SIGN_HERE) setSigning(true)
    else save('')
  }

  async function save(signature: string) {
    setBusy(true)
    setError('')
    const id = normalizeFnd(fnd)
    const finalName = salary ? name.trim().replace(/\s+/g, ' ') : name.trim() || (owner ?? '').trim()
    const paid = num(v.paid)
    const draft: Draft = {
      id: existing?.id,
      kind,
      employee_fnd: id,
      employee_name: finalName,
      owner_name: publicName(store.data, profile?.display_name ?? ''),
      period: salary ? periodOf(year, month) : periodOf(dmy().y, dmy().m),
      receipt_date: dmy().text,
      basic: salary ? num(v.basic) : 0,
      allowances: salary ? num(v.allowances) : 0,
      overtime: salary ? num(v.overtime) : 0,
      loan: salary ? num(v.loan) : 0,
      deductions: salary ? num(v.deductions) : 0,
      total: salary ? total : paid,
      paid,
      currency,
      description: salary ? '' : description.trim(),
      notes: notes.trim(),
      sign_mode: signMode,
      status: signature ? APPROVED : PENDING,
      signature,
      signed_at: signature ? new Date().toISOString() : null,
      reject_reason: '',
      expense_id: existing?.expense_id ?? '',
      parties,
    }
    try {
      await saveReceipt(draft, t, employeeWords)
      await qc.invalidateQueries({ queryKey: ['salary'] })
      await qc.invalidateQueries({ queryKey: ['personal'] })
      await qc.invalidateQueries({ queryKey: ['store'] })
      setSigning(false)
      onDone(signMode === SIGN_REMOTE ? `${t('أُرسل السند إلى')} ${finalName} ${t('للاعتماد والتوقيع')}` : 'تم حفظ السند الموقّع')
    } catch (e) {
      setSigning(false)
      setError(e instanceof SalaryError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  const choice = (active: boolean) => cn('h-11 rounded-inner border text-[13px] font-extrabold', active ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub')
  const field = (label: string, value: string, onChange: (x: string) => void, opts: { numeric?: boolean; wide?: boolean; required?: boolean } = {}) => (
    <label className={cn('flex flex-col gap-1', opts.wide && 'col-span-2')}>
      <span className="text-[12px] font-bold text-sub">
        {t(label)}
        {opts.required && <span className="text-danger"> *</span>}
      </span>
      <input dir={opts.numeric ? 'ltr' : 'auto'} inputMode={opts.numeric ? 'decimal' : undefined} value={value} onChange={(e) => onChange(e.target.value)} className={input} />
    </label>
  )
  const currencies = [...new Set([currency, ...Object.values(CURRENCIES)].filter(Boolean))]
  const peopleList = (people.data ?? [])
    .filter((p) => p.fullName?.trim() && p.fullName.trim() !== 'أنا')
    .sort((a, b) => (a.typeKey === 'person_employee' ? -1 : 0) - (b.typeKey === 'person_employee' ? -1 : 0))
    .filter((p) => !search.trim() || p.fullName.includes(search.trim()) || String(p.categoryName ?? '').includes(search.trim()))
  const finalPreviewName = salary ? name.trim() : name.trim() || (owner ?? '').trim()

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t(existing ? 'تعديل السند' : 'سند جديد')}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setKind(KIND_SALARY)} className={choice(salary)}>
          {t('سند قبض راتب')}
        </button>
        <button type="button" onClick={() => setKind(KIND_GENERAL)} className={choice(!salary)}>
          {t('سند قبض')}
        </button>
        <button type="button" onClick={() => setParties(PARTIES_EMPLOYER)} className={choice(parties === PARTIES_EMPLOYER)}>
          {t('صاحب العمل والموظف')}
        </button>
        <button type="button" onClick={() => setParties(PARTIES_HANDOVER)} className={choice(parties === PARTIES_HANDOVER)}>
          {t('المسلّم والمستلم')}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('الرقم التعريفي للمستلم')}</span>
          <div className="flex gap-2">
            <input dir="ltr" value={fnd} placeholder="FND-XXXX-XXXX" onChange={(e) => setFnd(e.target.value)} className={input} />
            <button type="button" onClick={() => setPicking(true)} className="h-12 shrink-0 rounded-field border border-brand px-3 text-[12.5px] font-extrabold text-brand">
              {t('من الأفراد')}
            </button>
          </div>
          {looking && <span className="text-[11.5px] text-muted">{t('جارٍ البحث…')}</span>}
          {!looking && owner && (
            <span className="flex items-center gap-1 text-[11.5px] font-bold text-brand">
              <BadgeCheck className="size-3.5" />
              {owner}
            </span>
          )}
          {!looking && checked && owner === null && <span className="text-[11.5px] font-bold text-danger">{t('لا يوجد حساب بهذا الرقم')}</span>}
        </label>
        {field(employeeWords ? 'اسم الموظف' : 'اسم المستلم', name, setName, { wide: true, required: true })}
        {salary ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-sub">{t('الشهر')}</span>
              <select value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))} className={input}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {t(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-sub">{t('السنة')}</span>
              <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className={input}>
                {Array.from({ length: now.getFullYear() + 3 - 2015 }, (_, i) => 2015 + i)
                  .reverse()
                  .map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
              </select>
            </label>
            {field('الراتب الأساسي', v.basic, (x) => setNum('basic', x), { numeric: true })}
            {field('العلاوات', v.allowances, (x) => setNum('allowances', x), { numeric: true })}
            {field('العمل الإضافي', v.overtime, (x) => setNum('overtime', x), { numeric: true })}
            {field('السلفة', v.loan, (x) => setNum('loan', x), { numeric: true })}
            {field('الخصومات', v.deductions, (x) => setNum('deductions', x), { numeric: true })}
            <div className="flex flex-col justify-end">
              <p className="rounded-field bg-surface px-3 py-3 text-[13px] font-extrabold text-title">
                {t('المجموع')}: {plainNum(total)}
              </p>
            </div>
          </>
        ) : (
          field('البيان', description, setDescription, { wide: true, required: true })
        )}
        {field('المبلغ المدفوع', v.paid, (x) => {
          setPaidTouched(true)
          setNum('paid', x)
        }, { numeric: true, required: true })}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('العملة')}</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={input}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('تاريخ السند')}</span>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className={input} />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('ملاحظات')}</span>
          <textarea dir="auto" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${input} h-auto py-2.5`} />
        </label>
        <p className="col-span-2 text-[12px] font-bold text-sub">{t('طريقة التوقيع')}</p>
        <button type="button" onClick={() => setSignMode(SIGN_HERE)} className={choice(signMode === SIGN_HERE)}>
          {t(signHereLabel({ parties }))}
        </button>
        <button type="button" onClick={() => setSignMode(SIGN_REMOTE)} className={choice(signMode === SIGN_REMOTE)}>
          {t('إرسال للاعتماد والتوقيع')}
        </button>
      </div>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button type="button" disabled={busy} onClick={submit} className="mt-5 flex w-full items-center justify-center gap-2 rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60">
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t(signMode === SIGN_HERE ? 'توقيع المستلم وحفظ' : 'إرسال للاعتماد والتوقيع')}
      </button>

      <Confirm
        open={dupAsk}
        title="راتب مسجَّل"
        message={`${t('يوجد سند راتب لـ')} ${finalPreviewName} ${t('عن')} ${t(MONTHS[month - 1])} ${year}. ${t('هل تريد إضافة سند آخر للشهر نفسه؟')}`}
        confirmLabel="متابعة"
        onConfirm={proceed}
        onCancel={() => setDupAsk(false)}
      />
      <SignaturePad
        open={signing}
        title={`${t('توقيع')} ${finalPreviewName}`}
        subtitle={`${t('يوقّع المستلم بإصبعه على هذا الجهاز تأكيدًا لاستلام')} ${moneyOf(num(v.paid), currency, t)}`}
        onClose={() => !busy && setSigning(false)}
        onDone={(st) => save(encodeStrokes(st))}
      />
      <Sheet open={picking} onClose={() => setPicking(false)}>
        <p className="text-[17px] font-extrabold text-title">{t('اختر من الأفراد والجهات')}</p>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" />
          <input dir="auto" value={search} placeholder={t('ابحث بالاسم أو التصنيف')} onChange={(e) => setSearch(e.target.value)} className={cn(input, 'ps-9')} />
        </div>
        <div className="mt-2 flex max-h-80 flex-col gap-1 overflow-y-auto">
          {peopleList.length === 0 && <p className="py-3 text-center text-[12px] text-muted">{t('لا يوجد أفراد بعد في «الأفراد والجهات»')}</p>}
          {peopleList.map((p) => {
            const id = String(p.details?.['الرقم التعريفي'] ?? '').trim()
            return (
              <button
                key={p.fullName}
                type="button"
                onClick={() => {
                  setName(p.fullName.trim())
                  setFnd(id)
                  setPicking(false)
                }}
                className="flex flex-col rounded-inner px-3 py-2 text-start hover:bg-line/60"
              >
                <span className="text-[13px] font-bold text-ink">{p.fullName}</span>
                <span className="text-[11px] text-muted">
                  {t(String(p.categoryName ?? ''))}
                  {id ? ` · ${id}` : ''}
                </span>
              </button>
            )
          })}
        </div>
      </Sheet>
    </Sheet>
  )
}

// ---------------- الطباعة ----------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function ReceiptPrint({ r, onClose }: { r: Receipt; onClose: () => void }) {
  const { t, dir, lang } = useI18n()
  const frame = useRef<HTMLIFrameElement>(null)
  const money = (v: number) => esc(moneyOf(v, r.currency, t))
  const rows = isSalary(r)
    ? [
        ['الراتب الأساسي', money(r.basic)],
        ...(r.allowances > 0 ? [['العلاوات', money(r.allowances)]] : []),
        ...(r.overtime > 0 ? [['العمل الإضافي', money(r.overtime)]] : []),
        ...(r.loan > 0 ? [['السلفة', `- ${money(r.loan)}`]] : []),
        ...(r.deductions > 0 ? [['الخصومات', `- ${money(r.deductions)}`]] : []),
        ['المجموع', money(r.total)],
      ]
    : [['البيان', esc(r.description || '—')]]
  const strokes = decodeStrokes(r.signature)
  const sig = strokes
    .map((st) => (st.length === 1 ? `<circle cx="${st[0][0]}" cy="${st[0][1]}" r="0.006" fill="#0F1F1C"/>` : `<polyline points="${st.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="#0F1F1C" stroke-width="0.012" stroke-linecap="round" stroke-linejoin="round"/>`))
    .join('')
  const color = r.status === APPROVED ? '#178F7B' : r.status === REJECTED ? '#C4392E' : '#A6691A'
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(t('سند قبض'))} ${receiptNo(r)}</title>
<style>@page{size:A4;margin:14mm}body{font-family:Cairo,Tahoma,Arial,sans-serif;color:#0F1F1C;margin:0}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0A5A50;padding-bottom:10px}
h1{margin:0;font-size:24px;color:#0A5A50}.sub{font-size:10px;letter-spacing:2px;color:#5C6B68}
.pill{border:1.5px solid ${color};color:${color};border-radius:20px;padding:3px 12px;font-weight:800;font-size:12px}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.cell{background:#F2F6F5;border-radius:8px;padding:8px 10px}
.cell b{display:block;font-size:13px}.cell span{font-size:10px;color:#5C6B68}
.paid{background:#0A5A50;color:#fff;border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;font-size:13px}
.paid b{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:14px}td{padding:8px 4px;border-bottom:1px solid #E4EAE8;font-size:13px}
td:last-child{text-align:end;font-weight:700}.box{margin-top:14px;font-size:12px}.box span{color:#5C6B68;font-size:10.5px}
.sign{display:flex;gap:14px;align-items:center;margin-top:18px;border:1px solid #E4EAE8;border-radius:10px;padding:10px}
.sign svg{width:120px;height:120px;border:1px solid #E4EAE8;border-radius:8px}.foot{margin-top:24px;font-size:9px;color:#8C9A97;display:flex;justify-content:space-between}</style></head>
<body><div class="top"><div><h1>${esc(t(isSalary(r) ? 'سند قبض راتب' : 'سند قبض'))}</h1><div class="sub">${isSalary(r) ? 'SALARY RECEIPT' : 'PAYMENT RECEIPT'}</div></div><span class="pill">${esc(t(r.status))}</span></div>
<div class="meta"><div class="cell"><span>${esc(t('رقم السند'))}</span><b>${receiptNo(r)}</b></div><div class="cell"><span>${esc(t('التاريخ'))}</span><b>${esc(r.receipt_date)}</b></div>${
    isSalary(r) ? `<div class="cell"><span>${esc(t('الشهر'))}</span><b>${esc(periodLabel(r, t))}</b></div>` : '<div></div>'
  }
<div class="cell"><span>${esc(t(payerLabel(r)))}</span><b>${esc(r.owner_name || '—')}</b></div><div class="cell"><span>${esc(t(payeeLabel(r)))}</span><b>${esc(r.employee_name || '—')}</b>${r.employee_fnd ? `<span dir="ltr">${esc(r.employee_fnd)}</span>` : ''}</div></div>
<div class="paid"><span>${esc(t('المبلغ المدفوع'))}</span><b>${money(r.paid)}</b></div>
<div style="margin-top:14px;font-weight:800">${esc(t(isSalary(r) ? 'تفاصيل الراتب' : 'تفاصيل السند'))}</div>
<table>${rows.map(([k, val]) => `<tr><td>${esc(t(k))}</td><td>${val}</td></tr>`).join('')}</table>
${r.notes.trim() ? `<div class="box"><span>${esc(t('ملاحظات'))}</span><div>${esc(r.notes.trim())}</div></div>` : ''}
${r.status === REJECTED && r.reject_reason.trim() ? `<div class="box"><span style="color:#C4392E">${esc(t('سبب الرفض'))}</span><div>${esc(r.reject_reason.trim())}</div></div>` : ''}
<div class="sign">${sig ? `<svg viewBox="0 0 1 1">${sig}</svg>` : ''}<div><span style="font-size:10.5px;color:#5C6B68">${esc(t('توقيع المستلم'))}</span><div style="font-weight:800">${esc(r.employee_name)}</div>${
    r.signed_at ? `<div style="font-size:10.5px">${esc(t('وقت التوقيع'))}: ${esc(stampOf(r.signed_at))}</div>` : ''
  }<div style="font-size:10.5px;margin-top:4px">${esc(t('طريقة التوقيع'))}: ${esc(t(r.sign_mode === SIGN_HERE ? signHereLabel(r) : 'أُرسل للاعتماد والتوقيع'))}</div></div></div>
<div class="foot"><span>${esc(t('صدر بتاريخ'))} ${esc(dayOf(new Date()))}</span><span>Fundly</span></div></body></html>`
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-page" role="dialog" aria-modal="true">
      <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
        <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full bg-surface" aria-label={t('إغلاق')}>
          <X className="size-5" />
        </button>
        <p className="flex-1 text-[15px] font-extrabold text-title">{titleOf(r, t)}</p>
        <button
          type="button"
          onClick={() => {
            const win = frame.current?.contentWindow
            win?.focus()
            win?.print()
          }}
          className="flex h-10 items-center gap-1.5 rounded-inner bg-brand px-4 text-[13px] font-extrabold text-white"
        >
          <Printer className="size-4" />
          {t('طباعة / حفظ PDF')}
        </button>
      </div>
      <iframe ref={frame} title="receipt" srcDoc={html} className="w-full flex-1 bg-white" />
    </div>
  )
}

// للاستعمال في صفحات أخرى (رابط سجل الرواتب لموظف).
export const salaryLink = (fnd: string, name: string) => `/salary?${new URLSearchParams({ ...(fnd ? { fnd } : {}), ...(name ? { name } : {}) }).toString()}`
