import { useState } from 'react'
import { ReceiptText } from 'lucide-react'
import { cn, money } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import type { UnitContract, UnitPayment } from '@/lib/data'
import { payExtra } from '@/lib/assetWrite'
import { PAY } from '@/lib/lease'
import { payNameOf } from '@/lib/leaseActions'
import { TextShareSheet } from './AssetExtras'
import { Sheet } from './ui'

/*
  «سند قبض» في الوحدة كما في التطبيق (_shareReceiptVoucher → openRentReceiptForm):
  تظهر الدفعات كلها بحالاتها، ويُختار منها المسدد لإصدار سنده، ثم فورم السند
  (رقمه وتاريخه والمستلم منه والمبلغ والبيان وطريقة التحصيل) بمعاينة ومشاركة.
  و«مطالبة مالية» (_shareFinancialClaim): المستحق والمسدد والمتبقي على العقد.
*/

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const slashDate = (iso: string) => (iso ? `${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}` : 'غير محدد')

/** rentPaymentStatusLabel */
export function payStatusLabel(p: UnitPayment): string {
  if (p.status === 'paid') return 'مدفوعة'
  if (p.status === 'late') return 'متأخرة'
  const today = isoOf(new Date())
  const due = p.due_date ? p.due_date.slice(0, 10) : null
  const past = !!due && due < today
  if (p.status === 'partial') return past && Number(p.amount_due) - Number(p.amount_paid) > 0.009 ? 'متأخرة' : 'مدفوعة جزئيًا'
  if (due) {
    if (past) return 'متأخرة'
    const week = new Date()
    week.setDate(week.getDate() + 7)
    if (due > isoOf(week)) return 'قادمة'
  }
  return 'مستحقة'
}

/** rentPaymentStatusColor */
const STATUS_COLOR: Record<string, string> = { مدفوعة: '#0E7161', 'مدفوعة جزئيًا': '#178F7B', متأخرة: '#C4392E', قادمة: '#5C6B68' }

/** _shareFinancialClaim */
export function financialClaimText(assetTitle: string, unitName: string, contract: UnitContract, payments: UnitPayment[], t: (s: string) => string) {
  const due = payments.reduce((s, p) => s + (Number(p.amount_due) || 0), 0)
  const paid = payments.reduce((s, p) => s + (Number(p.amount_paid) || 0), 0)
  return [
    t('مطالبة مالية'),
    `${t('العقار')}: ${assetTitle}`,
    `${t('الوحدة')}: ${unitName}`,
    `${t('المستأجر')}: ${contract.tenant_name || '—'}`,
    `${t('الإيجار السنوي')}: ${(Number(contract.annual_rent) || 0).toFixed(0)}`,
    `${t('إجمالي المستحق')}: ${due.toFixed(0)}`,
    `${t('إجمالي المسدد')}: ${paid.toFixed(0)}`,
    `${t('المتبقي')}: ${(due - paid).toFixed(0)}`,
  ].join('\n')
}

/** قائمة الدفعات لاختيار المسدد منها. */
export function ReceiptPicker({ payments, currency, onClose, onPick }: { payments: UnitPayment[]; currency: string; onClose: () => void; onPick: (p: UnitPayment) => void }) {
  const { t } = useI18n()
  const anyPaid = payments.some((p) => Number(p.amount_paid) > 0)
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t('سند قبض')}</p>
      <p className={cn('mt-1 text-[12px] font-bold', anyPaid ? 'text-sub' : 'text-danger')}>{t(anyPaid ? 'اختر دفعة مسددة لإصدار سند القبض' : 'لا توجد دفعات مسددة بعد — يصدر سند القبض للدفعة بعد سدادها')}</p>
      <div className="mt-3 flex flex-col gap-2">
        {payments.map((p) => {
          const paid = Number(p.amount_paid) > 0
          const label = payStatusLabel(p)
          const kind = (payExtra(p.notes)[PAY.kind] ?? '').trim()
          return (
            <button
              key={p.id}
              type="button"
              disabled={!paid}
              onClick={() => onPick(p)}
              className={cn('flex items-center gap-2 rounded-inner border border-line bg-white p-3 text-start', paid ? 'hover:border-brand' : 'cursor-not-allowed opacity-55')}
            >
              <div className="min-w-0 flex-1">
                <p dir="auto" className="text-[13px] font-extrabold text-title">
                  {t(payNameOf(p))}
                </p>
                <p className="mt-0.5 text-[11px] font-bold text-sub">
                  {[kind && t(kind), `${t('المستحق')}: ${money(p.amount_due, currency)}`, `${t('المسدد')}: ${money(p.amount_paid, currency)}`, p.due_date ? slashDate(p.due_date.slice(0, 10)) : ''].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="text-[11px] font-extrabold" style={{ color: STATUS_COLOR[label] ?? '#A6691A' }}>
                {t(label)}
              </span>
              {paid && <ReceiptText className="size-4 text-brand" />}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

/** openRentReceiptForm: بيانات السند جاهزة للتعديل ثم المعاينة والمشاركة. */
export function ReceiptForm({ payment, contract, assetTitle, unitName, currency, onClose }: { payment: UnitPayment; contract: UnitContract; assetTitle: string; unitName: string; currency: string; onClose: () => void }) {
  const { t } = useI18n()
  const extra = payExtra(payment.notes)
  const received = Number(payment.amount_paid) > 0 ? Number(payment.amount_paid) : Number(payment.amount_due) || 0
  const [no, setNo] = useState(payment.reference_no ?? '')
  const [date, setDate] = useState(payment.paid_at ? payment.paid_at.slice(0, 10) : isoOf(new Date()))
  const [from, setFrom] = useState(contract.tenant_name ?? '')
  const [amount, setAmount] = useState(received.toFixed(2))
  const [about, setAbout] = useState(`${t(payNameOf(payment))} — ${unitName}`)
  const methods = ['كاش', 'شيك', 'تحويل بنكي', 'بطاقة']
  const [method, setMethod] = useState(extra[PAY.method] && methods.includes(extra[PAY.method]) ? extra[PAY.method] : 'كاش')
  const [cheque, setCheque] = useState(extra[PAY.cheque] ?? payment.reference_no ?? '')
  const [beneficiary, setBeneficiary] = useState(extra['المستفيد'] ?? '')
  const [note, setNote] = useState('')
  const [sharing, setSharing] = useState(false)
  const text = [
    t('سند قبض'),
    no.trim() ? `${t('رقم السند')}: ${no.trim()}` : '',
    `${t('التاريخ')}: ${slashDate(date)}`,
    `${t('استلمنا من')}: ${from.trim()}`,
    `${t('مبلغًا وقدره')}: ${amount.trim()} ${t(currency)}`,
    `${t('وذلك عن')}: ${about.trim()}`,
    `${t('العقار')}: ${assetTitle}`,
    `${t('طريقة التحصيل')}: ${t(method)}${cheque.trim() ? ` — ${t('شيك رقم')} ${cheque.trim()}` : ''}`,
    beneficiary.trim() ? `${t('المستفيد')}: ${beneficiary.trim()}` : '',
    note.trim() ? `${t('ملاحظات')}: ${note.trim()}` : '',
    '',
    `${t('توقيع المستلم')}: ..............................`,
  ]
    .filter((l, i, all) => l !== '' || i === all.length - 2)
    .join('\n')
  const field = (label: string, value: string, set: (v: string) => void, opts: { numeric?: boolean; area?: boolean } = {}) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-sub">{t(label)}</span>
      {opts.area ? (
        <textarea rows={2} dir="auto" value={value} onChange={(e) => set(e.target.value)} className={`${inputClass} h-auto py-3`} />
      ) : (
        <input dir="auto" inputMode={opts.numeric ? 'decimal' : undefined} value={value} onChange={(e) => set(e.target.value)} className={inputClass} />
      )}
    </label>
  )
  if (sharing) return <TextShareSheet title="سند قبض" text={text} onClose={() => setSharing(false)} />
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t('سند قبض')}</p>
      <div className="mt-3 flex flex-col gap-2.5">
        {field('رقم السند', no, setNo)}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('تاريخ السند')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </label>
        {field('استلمنا من (المستأجر)', from, setFrom)}
        {field('المبلغ المستلم', amount, setAmount, { numeric: true })}
        {field('وذلك عن', about, setAbout, { area: true })}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('طريقة التحصيل')}</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {t(m)}
              </option>
            ))}
          </select>
        </label>
        {field('رقم الشيك (إن وُجد)', cheque, setCheque)}
        {field('المستفيد', beneficiary, setBeneficiary)}
        {field('ملاحظات', note, setNote, { area: true })}
      </div>
      <div className="mt-4 rounded-inner border border-line bg-surface p-3">
        <p className="text-[12px] font-extrabold text-title">{t('معاينة السند')}</p>
        <pre dir="auto" className="mt-2 whitespace-pre-wrap font-[inherit] text-[12px] leading-[1.8] text-ink">
          {text}
        </pre>
      </div>
      <button type="button" onClick={() => setSharing(true)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
        {t('إرسال / مشاركة')}
      </button>
    </Sheet>
  )
}
