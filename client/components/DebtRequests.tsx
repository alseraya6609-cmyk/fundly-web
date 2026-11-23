import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, HandCoins, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { money } from '@/lib/format'
import { DEBT_PENDING, DEBT_REJECTED, EntryError, debtOtherParty, debtRequestsOf, decideDebtPayment, iAmDebtCreditor, type Me } from '@/lib/personalWrite'
import type { Entry } from '@/lib/data'
import { errorText } from '@/lib/supabase'
import { FileButton } from './FileButton'
import { Confirm } from './Confirm'

/*
  سداد الدين بموافقة الدائن (_debtRequestRows): عند الدائن «أرسل فلان إليك
  مبلغ…» بالتاريخ والساعة والتفاصيل مع «موافق» و«رفض»، وعند المدين حالة ما
  أرسله. الموافقة تضيفه إلى الدفعات وتخصمه من الدين.
*/

export function DebtRequests({ entry, me, currency, onChanged }: { entry: Entry; me: Me; currency: string; onChanged: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const details = entry.details ?? {}
  const rows = debtRequestsOf(details)
  const [deciding, setDeciding] = useState<{ row: Record<string, string>; approve: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!rows.length) return null
  const creditor = iAmDebtCreditor(details, me.fnd)
  const other = debtOtherParty(details, me.fnd)
  const pending = rows.filter((r) => r['الحالة'] === DEBT_PENDING)
  const shown = [...pending, ...rows.filter((r) => r['الحالة'] !== DEBT_PENDING)]

  async function decide() {
    if (!deciding) return
    setBusy(true)
    setError('')
    try {
      await decideDebtPayment(entry, deciding.row.id, deciding.approve, me)
      await qc.invalidateQueries({ queryKey: ['personal'] })
      const ok = deciding.approve
      setDeciding(null)
      onChanged(ok ? 'تمت الموافقة وخُصم المبلغ من الدين' : 'رُفض السداد ولم يُخصم من الدين')
    } catch (e) {
      setError(e instanceof EntryError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5">
      <p className="mb-2 text-[14px] font-extrabold text-title">
        {pending.length ? `${t(creditor ? 'سداد بانتظار موافقتك' : 'سداد بانتظار الموافقة')} (${pending.length})` : t('طلبات السداد')}
      </p>
      <div className="flex flex-col gap-2">
        {shown.map((r) => {
          const state = r['الحالة'] ?? ''
          const isPending = state === DEBT_PENDING
          const tone = state === DEBT_REJECTED ? 'border-danger/30 bg-danger-soft/40' : isPending ? 'border-gold/40 bg-gold-soft/50' : 'border-brand/25 bg-brand-soft/60'
          const amount = money(parseFloat(r['المبلغ']) || 0, t(r['العملة'] || currency))
          const decided = r['تاريخ ووقت الاعتماد'] || r['تاريخ ووقت الرفض'] || ''
          return (
            <div key={r.id} className={`rounded-inner border px-3 py-2.5 ${tone}`}>
              <div className="flex items-start gap-2">
                <HandCoins className="mt-0.5 size-4 shrink-0 text-brand" />
                <p dir="auto" className="min-w-0 flex-1 text-[13px] font-extrabold text-title">
                  {creditor ? `${t('أرسل')} ${r['الدافع'] ?? ''} ${t('إليك مبلغ')} ${amount}` : `${t('أرسلت إلى')} ${other} ${t('مبلغ')} ${amount}`}
                </p>
                <span className="shrink-0 text-[11px] font-extrabold text-gold-dark">{t(isPending && creditor ? 'بانتظار موافقتك' : state)}</span>
              </div>
              <p className="mt-1 text-[11.5px] text-sub">
                {[`${r['التاريخ'] ?? ''} ${r['وقت التسجيل'] ?? ''}`.trim(), (r['ملاحظات'] ?? '').trim(), !isPending && decided ? `${t(state)}: ${decided}` : ''].filter(Boolean).join(' · ')}
              </p>
              {r['مرفق الفاتورة'] && <FileButton className="mt-2" file={{ bucket: 'personal-entry-attachments', path: r['مرفق الفاتورة'] }} label="عرض الفاتورة" />}
              {isPending && creditor && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => (setError(''), setDeciding({ row: r, approve: true }))} className="flex h-10 items-center justify-center gap-1.5 rounded-inner bg-brand text-[13px] font-extrabold text-white hover:bg-brand-dark">
                    <Check className="size-4" />
                    {t('موافق')}
                  </button>
                  <button type="button" onClick={() => (setError(''), setDeciding({ row: r, approve: false }))} className="flex h-10 items-center justify-center gap-1.5 rounded-inner bg-danger-soft text-[13px] font-extrabold text-danger hover:bg-danger/15">
                    <X className="size-4" />
                    {t('رفض')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <Confirm
        open={!!deciding}
        title={deciding?.approve ? 'الموافقة على السداد' : 'رفض السداد'}
        message={
          deciding
            ? deciding.approve
              ? `${t('سيُخصم')} ${money(parseFloat(deciding.row['المبلغ']) || 0, t(deciding.row['العملة'] || currency))} ${t('من الدين ويُسجَّل في الدفعات باسم')} ${deciding.row['الدافع'] ?? ''}.`
              : `${t('لن يُخصم هذا المبلغ، ويصل')} ${deciding.row['الدافع'] ?? ''} ${t('أنك رفضته.')}`
            : ''
        }
        confirmLabel={deciding?.approve ? 'موافق' : 'رفض'}
        danger={deciding?.approve === false}
        busy={busy}
        error={error}
        onConfirm={decide}
        onCancel={() => setDeciding(null)}
      />
    </div>
  )
}
