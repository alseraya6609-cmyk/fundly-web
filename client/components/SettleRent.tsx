import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/lib/i18n'
import type { UnitPayment } from '@/lib/data'
import { date, money } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { AssetError, isCheque, settlePayment } from '@/lib/assetWrite'
import { Sheet } from './ui'

/** سداد دفعة عقد: كامل أو جزئي (الشيك كامل فقط) — rent_payments_view.dart ← _settle. */
export function SettleRent({ payment, currency, onClose, onDone }: { payment: UnitPayment; currency: string; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const remaining = Number(payment.amount_due) - Number(payment.amount_paid)
  const cheque = isCheque(payment)
  const [mode, setMode] = useState<'full' | 'partial' | null>(cheque ? 'full' : null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setBusy(true)
    setError('')
    try {
      const settled = await settlePayment(payment, mode === 'partial' ? amount : null)
      await qc.invalidateQueries({ queryKey: ['unit-payments'] })
      onDone(settled ? 'تم تسجيل السداد الكامل' : 'تم تسجيل سداد جزئي')
    } catch (e) {
      setError(e instanceof AssetError ? e.message : errorText(e) || 'تعذر تسجيل السداد')
    } finally {
      setBusy(false)
    }
  }
  const option = (on: boolean) => `rounded-inner border px-3 py-2.5 text-start ${on ? 'border-brand bg-brand-soft' : 'border-line bg-white'}`
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t('نوع السداد')}</p>
      <p className="mt-0.5 text-[12px] text-muted">
        {date(payment.due_date)} · {t('المتبقي')}: {money(remaining, t(currency))}
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <button type="button" onClick={() => setMode('full')} className={option(mode === 'full')}>
          <p className="text-[13.5px] font-extrabold text-title">{t('سداد كامل')}</p>
          <p className="text-[11.5px] text-sub">
            {t('المتبقي')}: {money(remaining, t(currency))}
          </p>
        </button>
        {!cheque && (
          <button type="button" onClick={() => setMode('partial')} className={option(mode === 'partial')}>
            <p className="text-[13.5px] font-extrabold text-title">{t('سداد جزئي')}</p>
            <p className="text-[11.5px] text-sub">{t('تبقى الدفعة مفتوحة بالمبلغ المتبقي')}</p>
          </button>
        )}
        {mode === 'partial' && (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('المبلغ المستلم')}</span>
            <input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none focus:border-gold" />
          </label>
        )}
      </div>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        disabled={!mode || busy || (mode === 'partial' && !(parseFloat(amount) > 0))}
        onClick={save}
        className="mt-5 flex w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {t('تسجيل السداد')}
      </button>
    </Sheet>
  )
}
