import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, MinusCircle, PlusCircle, RotateCcw, Snowflake, Handshake, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/supabase'
import { money } from '@/lib/format'
import type { Entry } from '@/lib/data'
import { EntryError, type Me } from '@/lib/personalWrite'
import {
  addSpend,
  custodyActions,
  custodyRemaining,
  custodySpent,
  decideSpend,
  pendingSpends,
  reopenCustody,
  settleCustody,
  toggleFreeze,
  topUp,
  validateSpend,
  type SettleMode,
} from '@/lib/custodyWrite'
import { ReceiptPicker } from './SharedDetails'
import { Confirm } from './Confirm'
import { Sheet } from './ui'

/*
  «إدارة العهدة» في تفاصيل العهدة المالية كما في التطبيق
  (_openCustodyManagementSheet): الرصيد والمصروف، والصرف للمسند إليه، وإضافة
  مبلغ واعتماد المصروفات والتسوية والتجميد وإعادة الفتح لصاحبها.
*/

const fieldClass = 'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none focus:border-gold'
const errMsg = (e: unknown, fallback: string) => (e instanceof EntryError ? e.message : errorText(e) || fallback)
const toDmy = (v: string) => {
  if (!v) return ''
  const [y, m, d] = v.split('-').map((x) => parseInt(x, 10))
  return `${d}/${m}/${y}`
}
const isoToday = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
const clock = () => {
  const n = new Date()
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
}

/** نافذة التسوية: الملاحظة إلزامية ثم أحد الخيارين. */
export function SettleDialog({
  title,
  intro,
  noteLabel,
  options,
  busy,
  error,
  onPick,
  onCancel,
}: {
  title: string
  intro: string
  noteLabel: string
  options: { mode: SettleMode | 'ok'; label: string; danger?: boolean }[]
  busy: boolean
  error: string
  onPick: (mode: SettleMode | 'ok', note: string) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-deep/40 p-4" onClick={busy ? undefined : onCancel}>
      <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl">
        <p className="text-[17px] font-extrabold text-title">{t(title)}</p>
        <p dir="auto" className="mt-2 text-[13px] leading-relaxed text-sub">
          {intro}
        </p>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t(noteLabel)}</span>
          <textarea rows={3} dir="auto" value={note} placeholder={t('مثال: استلمت المتبقي نقدًا')} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} h-auto py-3`} />
        </label>
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="mt-5 flex flex-col gap-2">
          {options.map((o) => (
            <button
              key={o.mode}
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => onPick(o.mode, note)}
              className={`flex h-11 items-center justify-center rounded-field text-[14px] font-extrabold text-white disabled:opacity-50 ${o.danger ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-dark'}`}
            >
              {t(o.label)}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={onCancel} className="h-11 rounded-field bg-surface text-[14px] font-bold text-body hover:bg-line">
            {t('رجوع')}
          </button>
        </div>
      </div>
    </div>
  )
}

function SpendForm({ entry, currency, me, onClose, onDone }: { entry: Entry; currency: string; me: Me; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [dateValue, setDateValue] = useState(isoToday())
  const [time, setTime] = useState(clock())
  const [invoice, setInvoice] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = () => ({ amount, purpose, date: toDmy(dateValue), time, invoice })
  const total = Math.round(Number(entry.amount) || 0)

  async function save() {
    setBusy(true)
    setError('')
    try {
      const message = await addSpend(entry, input(), me, currency)
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setConfirming(false)
      onDone(message)
    } catch (e) {
      setError(errMsg(e, 'تعذّر الحفظ. حاول مرة أخرى.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t('تسجيل صرف من العهدة')}</p>
      <p className="mt-0.5 text-[12px] text-muted">
        {t('الرصيد المتبقي حاليًا')}: {money(custodyRemaining(entry), t(currency))} {t('من أصل')} {money(total, t(currency))}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">
            {t('مبلغ الصرف')} ({t(currency)})
          </span>
          <input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldClass} />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('الغرض من الصرف')}</span>
          <input dir="auto" value={purpose} onChange={(e) => setPurpose(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('تاريخ الصرف')}</span>
          <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('ساعة الصرف')}</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={fieldClass} />
        </label>
        <div className="col-span-2">
          <ReceiptPicker file={invoice} onChange={setInvoice} label="إرفاق فاتورة الصرف (اختياري)" />
        </div>
      </div>
      {error && !confirming && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        onClick={() => {
          const problem = validateSpend(input())
          setError(problem ?? '')
          if (!problem) setConfirming(true)
        }}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t('حفظ عملية الصرف')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد"
        message={`${money(parseFloat(amount) || 0, t(currency))} · ${purpose} — ${t('هل تريد حفظ عملية الصرف؟')}`}
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  )
}

function TopUpForm({ entry, currency, me, onClose, onDone }: { entry: Entry; currency: string; me: Me; onClose: () => void; onDone: (m: string) => void }) {
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
      const added = await topUp(entry, amount, note, me)
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setConfirming(false)
      onDone(`${t('تم الحفظ — أُضيف')} ${added} ${t(currency)} ${t('إلى العهدة')}`)
    } catch (e) {
      setError(errMsg(e, 'تعذّر الحفظ. حاول مرة أخرى.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t('إضافة مبلغ للعهدة')}</p>
      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">
            {t('المبلغ المضاف')} ({t(currency)})
          </span>
          <input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('سبب الإضافة (اختياري)')}</span>
          <input dir="auto" value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
        </label>
      </div>
      {error && !confirming && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        onClick={() => {
          if (!(parseFloat(amount) > 0)) {
            setError('أدخل مبلغًا صحيحًا أكبر من صفر')
            return
          }
          setError('')
          setConfirming(true)
        }}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t('إضافة المبلغ')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد"
        message={`${t('المبلغ المضاف')}: ${money(parseFloat(amount) || 0, t(currency))} — ${t('هل تريد إضافة المبلغ؟')}`}
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  )
}

type Task = { kind: 'decide'; index: number; row: Record<string, string>; approve: boolean } | { kind: 'freeze' } | { kind: 'reopen' }

export function CustodyPanel({ entry, currency, me, onChanged }: { entry: Entry; currency: string; me: Me; onChanged: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const d = entry.details ?? {}
  const a = custodyActions(entry, me.fnd)
  const [form, setForm] = useState<'spend' | 'topup' | 'settle' | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = Math.round(Number(entry.amount) || 0)
  const spent = custodySpent(d)
  const pending = pendingSpends(d)

  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setTask(null)
      setForm(null)
      onChanged(message)
    } catch (e) {
      setError(errMsg(e, 'تعذّر الحفظ. حاول مرة أخرى.'))
    } finally {
      setBusy(false)
    }
  }

  const btn = 'flex h-11 items-center justify-center gap-1.5 rounded-inner text-[13px] font-extrabold'
  return (
    <div className="mt-5">
      <p className="mb-2 text-[14px] font-extrabold text-title">{t('إدارة العهدة')}</p>
      <div className="grid grid-cols-3 gap-2">
        {[
          ['قيمة العهدة', total],
          ['المصروف', spent],
          ['المتبقي', total - spent],
        ].map(([label, value]) => (
          <div key={label as string} className="card-inner px-3 py-2">
            <p className="text-[11px] text-muted">{t(label as string)}</p>
            <p className="text-[14px] font-extrabold text-title">{money(value, t(currency))}</p>
          </div>
        ))}
      </div>
      {pending.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[12.5px] font-extrabold text-gold-dark">
            {t('بانتظار الاعتماد')}: {pending.length}
          </p>
          {[...pending].reverse().map(([row, index]) => (
            <div key={index} className="card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
              <span className="font-bold text-ink">
                {money(parseFloat(row['المبلغ']) || 0, t(currency))} · {row['الغرض']}
              </span>
              <span className="text-muted">
                {row['التاريخ']} {row['بواسطة'] ? `· ${row['بواسطة']}` : ''}
              </span>
              {a.decide && (
                <span className="flex gap-2">
                  <button type="button" onClick={() => (setError(''), setTask({ kind: 'decide', index, row, approve: true }))} className="flex h-8 items-center gap-1 rounded-inner bg-brand px-3 text-[12px] font-extrabold text-white">
                    <Check className="size-3.5" />
                    {t('اعتماد')}
                  </button>
                  <button type="button" onClick={() => (setError(''), setTask({ kind: 'decide', index, row, approve: false }))} className="flex h-8 items-center gap-1 rounded-inner bg-danger-soft px-3 text-[12px] font-extrabold text-danger">
                    <X className="size-3.5" />
                    {t('رفض')}
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {a.spend && (
          <button type="button" onClick={() => setForm('spend')} className={`${btn} bg-brand text-white hover:bg-brand-dark`}>
            <MinusCircle className="size-4" />
            {t('صرف من العهدة')}
          </button>
        )}
        {a.topUp && (
          <button type="button" onClick={() => setForm('topup')} className={`${btn} border border-brand text-brand hover:bg-brand-soft`}>
            <PlusCircle className="size-4" />
            {t('إضافة مبلغ')}
          </button>
        )}
        {a.settle && (
          <button type="button" onClick={() => (setError(''), setForm('settle'))} className={`${btn} bg-brand-mid text-white hover:bg-brand`}>
            <Handshake className="size-4" />
            {t('تسوية العهدة')}
          </button>
        )}
        {a.freeze && (
          <button type="button" onClick={() => (setError(''), setTask({ kind: 'freeze' }))} className={`${btn} bg-surface text-body hover:bg-line`}>
            <Snowflake className="size-4" />
            {t(a.frozen ? 'إلغاء التجميد' : 'تجميد العهدة')}
          </button>
        )}
        {a.reopen && (
          <button type="button" onClick={() => (setError(''), setTask({ kind: 'reopen' }))} className={`${btn} bg-surface text-body hover:bg-line`}>
            <RotateCcw className="size-4" />
            {t('إعادة فتح العهدة')}
          </button>
        )}
      </div>
      {form === 'spend' && <SpendForm entry={entry} currency={currency} me={me} onClose={() => setForm(null)} onDone={(m) => (setForm(null), onChanged(m))} />}
      {form === 'topup' && <TopUpForm entry={entry} currency={currency} me={me} onClose={() => setForm(null)} onDone={(m) => (setForm(null), onChanged(m))} />}
      {form === 'settle' && (
        <SettleDialog
          title="تسوية العهدة"
          intro={t('ستُغلق العهدة ولا يُصرف منها بعد ذلك. اكتب ما تم في التسوية (مثل: استلمت المتبقي نقدًا)، ثم اختر إبقاءها أو أرشفتها.')}
          noteLabel="ملاحظة التسوية — ماذا تم؟ *"
          options={[
            { mode: 'keep', label: 'تسوية وإبقاؤها' },
            { mode: 'archive', label: 'تسوية وأرشفة' },
          ]}
          busy={busy}
          error={error}
          onPick={(mode, note) =>
            run(
              () => settleCustody(entry, note, mode as SettleMode, false, me.fnd),
              mode === 'archive' ? 'تمت تسوية العهدة ونُقلت إلى الأرشيف' : 'تمت تسوية العهدة — تبقى ظاهرة بحالة «تمت التسوية»',
            )
          }
          onCancel={() => setForm(null)}
        />
      )}
      <Confirm
        open={!!task}
        title={task?.kind === 'decide' ? (task.approve ? 'اعتماد' : 'رفض') : task?.kind === 'freeze' ? (a.frozen ? 'إلغاء التجميد' : 'تجميد العهدة') : 'إعادة فتح العهدة'}
        message={
          task?.kind === 'decide'
            ? `${money(parseFloat(task.row['المبلغ']) || 0, t(currency))} · ${task.row['الغرض'] ?? ''}`
            : task?.kind === 'freeze'
              ? t(a.frozen ? 'ستعود العهدة نشطة ويُصرف منها من جديد. هل تريد المتابعة؟' : 'سيتوقف الصرف من العهدة والإضافة عليها حتى تُلغي التجميد، وتبقى بياناتها وسجلها كما هي. هل تريد المتابعة؟')
              : `${t('ستعود العهدة نشطة، ويُصرف منها من جديد من المتبقي')}: ${money(custodyRemaining(entry), t(currency))}. ${t('هل تريد المتابعة؟')}`
        }
        confirmLabel={task?.kind === 'decide' ? (task.approve ? 'اعتماد' : 'رفض') : task?.kind === 'freeze' ? (a.frozen ? 'إلغاء التجميد' : 'تجميد') : 'إعادة الفتح'}
        danger={task?.kind === 'decide' && !task.approve}
        busy={busy}
        error={error}
        onConfirm={() => {
          if (!task) return
          if (task.kind === 'decide')
            run(() => decideSpend(entry, task.index, task.row, task.approve, me.fnd), task.approve ? 'اعتُمد المصروف وخُصم من العهدة' : 'رُفض المصروف ولم يُخصم من العهدة')
          else if (task.kind === 'freeze') run(() => toggleFreeze(entry, me.fnd), a.frozen ? 'أُلغي التجميد — العهدة نشطة' : 'جُمّدت العهدة')
          else run(() => reopenCustody(entry, me.fnd), 'أُعيد فتح العهدة — يمكن الصرف من المتبقي')
        }}
        onCancel={() => setTask(null)}
      />
    </div>
  )
}
