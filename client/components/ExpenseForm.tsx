import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { useStore, type Entry } from '@/lib/data'
import { POT, hasBudget, iAmManager, memberNames, remaining, withoutFnd } from '@/lib/shared'
import { publicName as publicNameOf } from '@/lib/requestsWrite'
import { EXPENSE_CATEGORIES, EXPENSE_METHODS, SharedError, activeOn, addSharedExpense, myMemberName, needsApproval, parseMoney } from '@/lib/sharedWrite'
import { Sheet } from './ui'
import { Confirm } from './Confirm'

/*
  «مصروف جديد» في الالتزام المشترك — نموذج التطبيق (_InlineExpenseForm):
  الاسم، الفئة، من دفع، المبلغ وعملته وسعر الصرف، طريقة التقسيم، التاريخ،
  والمشاركون ونصيب كل منهم لحظيًا.
*/

const CURRENCIES = ['جنيه سوداني', 'جنيه مصري', 'درهم', 'دولار', 'دينار أردني', 'دينار بحريني', 'دينار', 'روبية باكستانية', 'روبية هندية', 'ريال', 'ريال عماني', 'ريال قطري', 'ليرة سورية', 'ليرة لبنانية', 'يوان صيني', 'يورو']

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

const fmt = (v: number) => v.toFixed(Math.abs(v) % 1 === 0 ? 0 : 2)
const dmy = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
function toInput(v: string) {
  const p = v.split('/').map((x) => parseInt(x, 10))
  return p.length === 3 && !p.some(Number.isNaN) ? `${p[2]}-${String(p[1]).padStart(2, '0')}-${String(p[0]).padStart(2, '0')}` : ''
}
function fromInput(v: string) {
  const [y, m, d] = v.split('-').map((x) => parseInt(x, 10))
  return v ? `${d}/${m}/${y}` : ''
}

function Body({ entry, currency, onDone }: { entry: Entry; currency: string; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const { profile } = useSession()
  const store = useStore()
  const qc = useQueryClient()
  const details = entry.details ?? {}
  const me = profile?.fnd_id ?? ''
  const fullName = String(store.data?.['settings_profile_name'] ?? '').trim() || profile?.display_name || ''
  const shownName = publicNameOf(store.data, profile?.display_name ?? '')
  const myNames = [fullName, shownName].filter(Boolean)
  const members = memberNames(details)
  const budget = hasBudget(details)
  const payers = [...(budget ? [POT] : []), ...members]
  const manager = iAmManager(details, me, myNames)
  const mine = myMemberName(details, me, myNames)
  const initialPayer = manager && budget ? POT : mine && payers.includes(mine) ? mine : payers[0] ?? ''

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [sub, setSub] = useState('')
  const [payer, setPayer] = useState(initialPayer)
  const [amountText, setAmountText] = useState('')
  const [cur, setCur] = useState(currency)
  const [rateText, setRateText] = useState('')
  const [method, setMethod] = useState('بالتساوي')
  const [date, setDate] = useState(dmy(new Date()))
  const [included, setIncluded] = useState<Set<string>>(() => new Set(members.filter((m) => activeOn(details, m, new Date()))))
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')

  const amount = parseMoney(amountText)
  const foreign = cur !== currency
  const rate = foreign ? parseMoney(rateText) : 1
  const list = members.filter((m) => included.has(m))
  const input = (n: string) => parseMoney(inputs[n] ?? '')

  const moneyFor = (n: string) => {
    if (!included.has(n)) return 0
    if (method === 'بالنسبة') return (amount * input(n)) / 100
    if (method === 'بالمبلغ المحدد') return input(n)
    if (method === 'بالحصص') {
      const total = list.reduce((s, x) => s + input(x), 0)
      return total <= 0 ? 0 : (amount * input(n)) / total
    }
    return list.length ? amount / list.length : 0
  }

  // _splitStatus
  const split = useMemo<[string, boolean]>(() => {
    if (!list.length) return [t('اختر مشاركًا واحدًا على الأقل'), false]
    const sum = list.reduce((s, n) => s + input(n), 0)
    if (method === 'بالنسبة') {
      const ok = Math.abs(sum - 100) < 0.1
      return [ok ? `${t('مجموع النِّسب')} 100% ✓` : `${t('مجموع النِّسب')} ${fmt(sum)}% — ${t('يجب أن يكون 100%')}`, ok]
    }
    if (method === 'بالمبلغ المحدد') {
      const ok = amount > 0 && Math.abs(sum - amount) < 0.01
      return [ok ? `${t('المبالغ تساوي إجمالي المصروف')} ✓` : `${t('مجموع المبالغ')} ${fmt(sum)} / ${fmt(amount)} ${t(cur)}`, ok]
    }
    if (method === 'بالحصص') {
      const ok = list.every((n) => input(n) > 0)
      return [ok ? `${t('مجموع الحصص')} ${fmt(sum)}` : t('اكتب عدد الحصص لكل مشارك'), ok]
    }
    return [`${t('نصيب كل مشارك')} ${fmt(amount / list.length)} ${t(cur)}`, true]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.join('|'), method, amount, inputs, cur, t])

  function changeMethod(next: string) {
    setMethod(next)
    const out: Record<string, string> = {}
    for (const n of members) {
      if (next === 'بالنسبة') out[n] = included.has(n) && list.length ? fmt(100 / list.length) : ''
      else if (next === 'بالحصص') out[n] = included.has(n) ? '1' : ''
      else out[n] = ''
    }
    setInputs(out)
  }

  function pickDate(value: string) {
    const v = fromInput(value)
    setDate(v)
    const [d, m, y] = v.split('/').map((x) => parseInt(x, 10))
    if (v) setIncluded(new Set(members.filter((n) => activeOn(details, n, new Date(y, m - 1, d)))))
  }

  function ask() {
    const problem = !name.trim()
      ? 'اكتب اسم المصروف'
      : !category
        ? 'اختر فئة المصروف'
        : amount <= 0
          ? 'اكتب مبلغ المصروف'
          : !payer
            ? 'اختر من دفع المصروف'
            : !split[1]
              ? split[0]
              : foreign && rate <= 0
                ? 'اكتب سعر الصرف'
                : payer === POT && (foreign ? amount * rate : amount) > remaining(details) + 0.01
                  ? `${t('المتبقي في الميزانية')} ${fmt(remaining(details))} ${t(currency)} — ${t('اختر من دفع الفرق أو أضف ميزانية إضافية')}`
                  : ''
    setError(problem)
    if (!problem) {
      setSaveError('')
      setConfirming(true)
    }
  }

  async function save() {
    setBusy(true)
    setSaveError('')
    try {
      const status = await addSharedExpense(
        entry,
        {
          description: name,
          category,
          subcategory: sub,
          amount,
          currency: foreign ? cur : '',
          rate,
          payer,
          date,
          participants: list,
          method,
          shares: Object.fromEntries(list.map((n) => [n, input(n)])),
        },
        me,
        myNames,
        shownName,
        currency,
      )
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setConfirming(false)
      onDone(status === 'معتمد' ? 'تمت إضافة المصروف بنجاح' : 'أُرسل المصروف لموافقة المسؤول')
    } catch (e) {
      setSaveError(e instanceof SharedError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-[18px] font-extrabold text-title">{t('مصروف جديد')}</p>
      <p dir="auto" className="mt-0.5 text-[12px] text-muted">
        {entry.title}
        {!manager && needsApproval(details) ? ` · ${t('يُرسل لموافقة المسؤول')}` : ''}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('اسم المصروف')} *</span>
          <input dir="auto" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('فئة المصروف')} *</span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setSub('')
            }}
            className={inputClass}
          >
            <option value="">{t('اختر')}</option>
            {Object.keys(EXPENSE_CATEGORIES).map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('التصنيف الفرعي')}</span>
          <select value={sub} onChange={(e) => setSub(e.target.value)} disabled={!EXPENSE_CATEGORIES[category]?.length} className={cn(inputClass, 'disabled:opacity-50')}>
            <option value="">{t('بدون')}</option>
            {(EXPENSE_CATEGORIES[category] ?? []).map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('من دفع المصروف')}</span>
          <select value={payer} onChange={(e) => setPayer(e.target.value)} className={inputClass}>
            {payers.map((p) => (
              <option key={p} value={p}>
                {p === POT ? t(POT) : withoutFnd(p) || p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('المبلغ')}</span>
          <input dir="ltr" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('عملة المصروف')}</span>
          <select value={cur} onChange={(e) => setCur(e.target.value)} className={inputClass}>
            {[currency, ...CURRENCIES.filter((c) => c !== currency)].map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </label>
        {foreign && (
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">
              1 {t(cur)} = ? {t(currency)}
            </span>
            <input dir="ltr" inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} className={inputClass} />
            <span className="text-[11px] text-muted">
              {rate > 0 ? `${t('يعادل')} ${fmt(amount * rate)} ${t(currency)}` : t('اكتب سعر الصرف ليُحسب ما يعادله بعملة الالتزام')}
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('التقسيم')}</span>
          <select value={method} onChange={(e) => changeMethod(e.target.value)} className={inputClass}>
            {EXPENSE_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('التاريخ')}</span>
          <input type="date" value={toInput(date)} onChange={(e) => pickDate(e.target.value)} className={inputClass} />
        </label>
        <div className="col-span-2">
          <p className="mb-1.5 text-[12px] font-bold text-sub">
            {t('المشاركون')} ({list.length} / {members.length})
          </p>
          <div className="flex flex-col gap-1.5 rounded-inner bg-surface p-2">
            {members.map((n) => (
              <div key={n} className="flex items-center gap-2 rounded-inner bg-white px-3 py-2">
                <input
                  type="checkbox"
                  checked={included.has(n)}
                  onChange={(e) => {
                    const next = new Set(included)
                    if (e.target.checked) next.add(n)
                    else next.delete(n)
                    setIncluded(next)
                  }}
                  className="size-4 accent-[#0A5A50]"
                />
                <span dir="auto" className="min-w-0 flex-1 text-[13px] font-bold text-ink">
                  {withoutFnd(n) || n}
                  <span className="block text-[11px] font-semibold text-muted">
                    {t('نصيبه')} {fmt(moneyFor(n))} {t(cur)}
                  </span>
                </span>
                {method !== 'بالتساوي' && included.has(n) && (
                  <input
                    dir="ltr"
                    inputMode="decimal"
                    value={inputs[n] ?? ''}
                    onChange={(e) => setInputs((x) => ({ ...x, [n]: e.target.value }))}
                    placeholder={method === 'بالنسبة' ? '%' : method === 'بالحصص' ? t('الحصص') : t('المبلغ')}
                    className="h-9 w-24 rounded-inner border border-line bg-field px-2 text-[13px] font-bold outline-none focus:border-gold"
                  />
                )}
              </div>
            ))}
          </div>
          <p className={cn('mt-1.5 text-[12px] font-bold', split[1] ? 'text-brand' : 'text-gold-dark')}>{split[0]}</p>
        </div>
      </div>
      <p className="mt-3 rounded-inner bg-surface px-3 py-2 text-[11px] text-sub">{t('الفاتورة أو الإيصال يُرفق من التطبيق.')}</p>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        onClick={ask}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t('حفظ المصروف')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد الحفظ"
        message={`${t('هل تريد حفظ المصروف')} «${name.trim()}»؟`}
        busy={busy}
        error={saveError}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

export function ExpenseForm({ open, entry, currency, onClose, onDone }: { open: boolean; entry: Entry; currency: string; onClose: () => void; onDone: (message: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose}>
      {open && <Body entry={entry} currency={currency} onDone={onDone} />}
    </Sheet>
  )
}
