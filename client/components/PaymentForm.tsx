import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/supabase'
import { money } from '@/lib/format'
import type { Entry } from '@/lib/data'
import { EntryError, addPayment, debtOtherParty, increaseDebt, remainingOf, validatePayment, type Me } from '@/lib/personalWrite'
import { FileError } from '@/lib/files'
import { ReceiptPicker } from './SharedDetails'
import { Confirm } from './Confirm'
import { Sheet } from './ui'

/*
  «سداد / سداد جزئي» و«إضافة دفعة» و«زيادة على الدين السابق» كما في تفاصيل
  الالتزام في التطبيق (_openSubscriptionPaymentForm، _openDebtIncreaseForm).
*/

const fieldClass = 'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none focus:border-gold'
const today = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
const toDmy = (v: string) => {
  if (!v) return ''
  const [y, m, d] = v.split('-').map((x) => parseInt(x, 10))
  return `${d}/${m}/${y}`
}

export function PaymentForm({ entry, currency, me, onClose, onDone }: { entry: Entry; currency: string; me: Me; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const isDebt = entry.entry_type === 'دين / قرض / سلفة'
  const [payer, setPayer] = useState('')
  const [amount, setAmount] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [note, setNote] = useState('')
  const [invoice, setInvoice] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = () => ({ payer, amount, date: toDmy(dateValue), note, invoice })

  async function save() {
    setBusy(true)
    setError('')
    try {
      const result = await addPayment(entry, input(), me)
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setConfirming(false)
      // دين مربوط يتطلب الموافقة: أُرسل للدائن ولم يُخصم بعد.
      onDone(result === 'pending' ? `${t('أُرسلت الدفعة إلى')} ${debtOtherParty(entry.details ?? {}, me.fnd)} ${t('للموافقة — تُخصم من الدين بعد موافقته')}` : 'تم حفظ الدفعة بنجاح')
    } catch (e) {
      setError(e instanceof EntryError || e instanceof FileError ? e.message : errorText(e) || 'تعذر حفظ الدفعة. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t(isDebt ? 'سداد / سداد جزئي' : 'إضافة دفعة')}</p>
      <p className="mt-0.5 text-[12px] text-muted">
        {t('المتبقي')} {money(remainingOf(entry), t(currency))}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {!isDebt && (
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('اسم الشخص الذي دفع')}</span>
            <input dir="auto" value={payer} onChange={(e) => setPayer(e.target.value)} className={fieldClass} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">
            {t('مبلغ الدفعة')} ({t(currency)})
          </span>
          <input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('تاريخ الدفع')}</span>
          <input type="date" max={today()} min="2020-01-01" value={dateValue} onChange={(e) => setDateValue(e.target.value)} className={fieldClass} />
        </label>
        {isDebt && (
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('ملاحظات')}</span>
            <textarea rows={2} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} h-auto py-3`} />
          </label>
        )}
        <div className="col-span-2">
          <ReceiptPicker file={invoice} onChange={setInvoice} label={isDebt ? 'إضافة صورة من الفاتورة (اختياري)' : 'إضافة صورة من الفاتورة'} />
        </div>
      </div>
      {error && !confirming && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        onClick={() => {
          const problem = validatePayment(entry, input())
          setError(problem ?? '')
          if (!problem) setConfirming(true)
        }}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t('حفظ الدفعة')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد"
        message={`${money(parseFloat(amount) || 0, t(currency))} · ${toDmy(dateValue)} — ${t('هل تريد حفظ الدفعة؟')}`}
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  )
}

export function IncreaseForm({ entry, currency, me, onClose, onDone }: { entry: Entry; currency: string; me: string; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError('')
    try {
      const total = await increaseDebt(entry, amount, note, currency, me)
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setConfirming(false)
      onDone(`${t('تم حفظ الزيادة — الإجمالي الآن')} ${total} ${t(currency)}`)
    } catch (e) {
      setError(e instanceof EntryError ? e.message : errorText(e) || 'تعذر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t('زيادة على الدين السابق')}</p>
      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">
            {t('مبلغ الزيادة')} ({t(currency)})
          </span>
          <input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('سبب الزيادة')}</span>
          <input dir="auto" value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
        </label>
      </div>
      {error && !confirming && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        onClick={() => {
          const v = parseFloat(amount.trim())
          if (!/^\d+(\.\d+)?$/.test(amount.trim()) || !(v > 0)) {
            setError('أدخل مبلغ زيادة صحيحًا')
            return
          }
          setError('')
          setConfirming(true)
        }}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t('حفظ')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد"
        message={`${t('مبلغ الزيادة')}: ${money(parseFloat(amount) || 0, t(currency))} — ${t('هل تريد حفظ الزيادة؟')}`}
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  )
}
