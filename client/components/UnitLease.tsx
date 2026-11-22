import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Loader2, Pencil, Plus, RefreshCw, XCircle } from 'lucide-react'
import { cn, money } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { useCurrency, useUnitContracts, useUnitPayments, type Asset, type UnitContract, type UnitPayment } from '@/lib/data'
import { errorText } from '@/lib/supabase'
import { AssetError, payExtra } from '@/lib/assetWrite'
import { setUnitStatus, unitKey, type PropertyUnit } from '@/lib/propertyWrite'
import { contractNumber, maintBlocksLease, pretty, PAY } from '@/lib/lease'
import {
  EXTEND_PRESETS,
  PAY_KINDS,
  cancelContract,
  cancelSummary,
  contractEnded,
  customExtend,
  dueTotals,
  extFmt,
  extendContract,
  extendPlan,
  payNameOf,
  renewalRange,
  savePayment,
  type ExtendBy,
} from '@/lib/leaseActions'
import type { Renewal } from './LeaseForm'
import { Confirm } from './Confirm'
import { SettleRent } from './SettleRent'
import { InfoRow, Sheet } from './ui'

/*
  «إدارة الإيجار» في صفحة الوحدة: العقد الحالي، ومدته وإجراءاته (تمديد قبل
  الانتهاء، تجديد بعده، إلغاء بالتسوية)، والدفعات الإيجارية والإدارية
  والتأمين في صندوق واحد (المستحقة، المتأخرة، القادمة، المستلمة)، وسداد كل
  بند، وإضافة دفعة أو تعديلها يدويًا.
*/

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'

const CONTRACT_STATUS: Record<string, string> = { active: 'نشط', expired: 'منتهي', pending: 'مسودة', late: 'متأخر', ended: 'منتهي', cancelled: 'ملغى' }

/** العقد الحالي للوحدة: أحدث عقد غير ملغى (_load). */
export function currentContract(contracts: UnitContract[], asset: Asset, unit: PropertyUnit) {
  return contracts.find((c) => c.asset_id === asset.id && c.unit_key === unitKey(unit) && c.status !== 'cancelled')
}

export function UnitLeaseBox({
  asset,
  unit,
  editable,
  onLease,
  onRenew,
  onMulti,
  onDone,
}: {
  asset: Asset
  unit: PropertyUnit
  editable: boolean
  onLease: (existing?: UnitContract) => void
  onRenew: (contract: UnitContract, renewal: Renewal) => void
  /** عقار بأكثر من وحدة: «نوع العقد» (لهذه الوحدة أو متعدد الوحدات). */
  onMulti?: () => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const currency = useCurrency()
  const contracts = useUnitContracts()
  const allPayments = useUnitPayments()
  const contract = currentContract(contracts.data ?? [], asset, unit)
  const payments = contract ? (allPayments.data ?? []).filter((p) => p.contract_id === contract.id) : []
  const [error, setError] = useState('')
  const [extending, setExtending] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [paying, setPaying] = useState<UnitPayment | null>(null)
  const [editingPay, setEditingPay] = useState<{ existing: UnitPayment | null } | null>(null)
  const [notice, setNotice] = useState('')
  const [choosing, setChoosing] = useState(false)
  const flash = (m: string) => {
    setNotice(m)
    window.setTimeout(() => setNotice(''), 4000)
  }
  const blocked = () => maintBlocksLease(unit.extras)
  const blockedMessage = 'الوحدة تحت صيانة تمنع التأجير — سجّل «انتهاء الصيانة» من قسم الصيانة أولًا.'
  const refresh = () => Promise.all(['assets', 'unit-contracts', 'unit-payments'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  const tile = (label: string, value: number, sub: string) => (
    <div className="rounded-inner bg-surface px-3 py-2">
      <p className="text-[11px] font-bold text-muted">{t(label)}</p>
      <p className="text-[14px] font-extrabold text-title">{money(value, t(currency))}</p>
      <p className="text-[10.5px] text-sub">{sub}</p>
    </div>
  )
  const ended = contract ? contractEnded(contract) : false
  const totals = dueTotals(payments)

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[14px] font-extrabold text-title">
          <span className="h-4 w-1 rounded-full bg-gold" />
          {t('إدارة الإيجار')}
        </p>
        {editable && !contract && (
          <button type="button" onClick={() => (setError(''), blocked() ? setError(blockedMessage) : onMulti ? setChoosing(true) : onLease())} className="flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-[12px] font-extrabold text-white">
            <Plus className="size-4" />
            {t('تأجير الوحدة')}
          </button>
        )}
      </div>
      {notice && <p className="mb-2 rounded-inner bg-brand-soft px-3 py-2 text-[12.5px] font-bold text-brand">{t(notice)}</p>}
      {error && <p className="mb-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      {!contract ? (
        <p className="rounded-inner bg-surface px-3 py-3 text-[12.5px] text-sub">{t(editable ? 'اضغط + لبدء عملية التأجير وإنشاء عقد.' : 'لا توجد بيانات حالياً')}</p>
      ) : (
        <>
          <div className="rounded-inner border border-line p-3">
            <InfoRow label="رقم العقد" value={contractNumber(contract)} />
            <InfoRow label="المستأجر" value={contract.tenant_name} />
            <InfoRow label="قيمة العقد" value={Number(contract.annual_rent) > 0 ? money(contract.annual_rent, t(currency)) : ''} />
            <InfoRow label="الحالة" value={t(CONTRACT_STATUS[contract.status] ?? contract.status)} />
            {contract.status === 'pending' && editable && (
              <button type="button" onClick={() => onLease(contract)} className="mt-2 w-full rounded-inner bg-gold/15 px-3 py-2.5 text-start text-[12px] font-bold leading-relaxed text-gold-dark">
                {t('هذا العقد محفوظ كمسودة لنقص بعض بياناته — اضغط هنا لإكماله وتأكيد حفظه.')}
              </button>
            )}
            {editable && (
              <button type="button" onClick={() => onLease(contract)} className="mt-2 h-11 w-full rounded-field bg-brand text-[13px] font-extrabold text-white hover:bg-brand-dark">
                {t('العقد كامل')}
              </button>
            )}
          </div>

          <div className="mt-3 rounded-inner border border-line p-3">
            <p className="mb-2 text-[13px] font-extrabold text-title">{t('مدة العقد')}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-inner bg-surface px-3 py-2">
                <p className="text-[11px] font-bold text-muted">{t('بداية العقد')}</p>
                <p className="text-[13.5px] font-extrabold text-title">{contract.start_date ? pretty(contract.start_date) : '—'}</p>
              </div>
              <div className="rounded-inner bg-surface px-3 py-2">
                <p className="text-[11px] font-bold text-muted">{t('نهاية العقد')}</p>
                <p className="text-[13.5px] font-extrabold text-title">{contract.end_date ? pretty(contract.end_date) : '—'}</p>
              </div>
            </div>
            {ended && contract.status !== 'cancelled' && <p className="mt-2 rounded-inner bg-gold/10 px-3 py-2 text-[11.5px] font-bold text-gold-dark">{t('انتهت مدة العقد — يُرجى إلغاء العقد لتصبح الوحدة شاغرة، أو تجديده.')}</p>}
            {editable && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {ended ? (
                  <ActionTile icon={RefreshCw} label="تجديد العقد" onClick={() => (setError(''), blocked() ? setError(blockedMessage) : setRenewing(true))} />
                ) : (
                  <ActionTile icon={CalendarClock} label="تمديد العقد" onClick={() => (setError(''), setExtending(true))} />
                )}
                <ActionTile icon={XCircle} label="إلغاء العقد" danger onClick={() => (setError(''), setCancelling(true))} />
              </div>
            )}
          </div>

          <DuesBox payments={payments} editable={editable} open={contract.status !== 'cancelled'} canAdd onPay={setPaying} onEdit={(p) => setEditingPay({ existing: p })} />
        </>
      )}

      {choosing && (
        <Sheet open onClose={() => setChoosing(false)}>
          <p className="text-[17px] font-extrabold text-title">{t('نوع العقد')}</p>
          <div className="mt-3 flex flex-col gap-2">
            <button type="button" onClick={() => (setChoosing(false), onLease())} className="rounded-inner border border-line px-4 py-3 text-start hover:border-brand">
              <p className="text-[14px] font-extrabold text-title">{t('عقد إيجار لهذه الوحدة')}</p>
              <p className="text-[11.5px] text-sub">{t('بيانات العقد والعقار والمؤجر والمستأجر والدفعات')}</p>
            </button>
            <button type="button" onClick={() => (setChoosing(false), onMulti?.())} className="rounded-inner border border-line px-4 py-3 text-start hover:border-brand">
              <p className="text-[14px] font-extrabold text-title">{t('عقد متعدد الوحدات')}</p>
              <p className="text-[11.5px] text-sub">{t('عقد واحد يشمل هذه الوحدة ووحدات أخرى من العقار')}</p>
            </button>
          </div>
        </Sheet>
      )}
      {extending && contract && (
        <ExtendFlow
          contract={contract}
          onClose={() => setExtending(false)}
          onDone={async (end) => {
            setExtending(false)
            await setUnitStatus(asset.id, unitKey(unit), 'مؤجرة').catch(() => {})
            await refresh()
            flash(`${t('مُدِّد العقد حتى')} ${pretty(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`)}`)
          }}
        />
      )}
      {renewing && contract && (
        <MonthsSheet
          title="تجديد العقد"
          hint={`${t('يبدأ العقد الجديد من')} ${pretty(isoOf(renewalRange(contract, 12).start))} ${t('بالمدة المختارة، ثم تُفتح صفحة العقد كاملًا لمراجعتها قبل التجديد.')}`}
          confirmLabel="متابعة"
          onClose={() => setRenewing(false)}
          onPick={(months) => {
            setRenewing(false)
            const { start, end } = renewalRange(contract, months)
            onRenew(contract, { notes: contract.notes, start, end, oldNo: contractNumber(contract) })
          }}
        />
      )}
      {cancelling && contract && (
        <CancelContractFlow
          asset={asset}
          unit={unit}
          contract={contract}
          payments={payments}
          onClose={() => setCancelling(false)}
          onDone={(m) => {
            setCancelling(false)
            onDone(m)
          }}
        />
      )}
      {paying && (
        <SettleRent
          payment={paying}
          currency={currency}
          onClose={() => setPaying(null)}
          onDone={(m) => {
            setPaying(null)
            flash(m)
          }}
        />
      )}
      {editingPay && contract && (
        <PaymentForm
          contractId={contract.id}
          existing={editingPay.existing}
          onClose={() => setEditingPay(null)}
          onDone={async () => {
            setEditingPay(null)
            await refresh()
            flash('تم الحفظ')
          }}
        />
      )}
    </div>
  )
}

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function ActionTile({ icon: Icon, label, danger = false, onClick }: { icon: typeof Plus; label: string; danger?: boolean; onClick: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" onClick={onClick} className={cn('flex flex-col items-center justify-center gap-1 rounded-inner border border-line bg-white px-2 py-3 text-[12.5px] font-extrabold hover:border-brand', danger ? 'text-danger' : 'text-brand')}>
      <Icon className="size-5" />
      {t(label)}
    </button>
  )
}

/** _pickContractMonths: 6 أشهر / سنة / سنتان. */
const RENEW_MONTHS: [string, number][] = [
  ['6 أشهر', 6],
  ['سنة', 12],
  ['سنتان', 24],
]

export function MonthsSheet({ title, hint, confirmLabel, options = RENEW_MONTHS, onClose, onPick }: { title: string; hint: string; confirmLabel: string; options?: [string, number][]; onClose: () => void; onPick: (months: number) => void }) {
  const { t } = useI18n()
  const [months, setMonths] = useState(12)
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t(title)}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-sub">{hint}</p>
      <div className={cn('mt-4 grid gap-2', options.length > 3 ? 'grid-cols-5' : 'grid-cols-3')}>
        {options.map(([label, n]) => (
          <button key={n} type="button" onClick={() => setMonths(n)} className={cn('h-11 rounded-field border text-[13px] font-extrabold', months === n ? 'border-brand bg-brand text-white' : 'border-line bg-field text-title')}>
            {t(label)}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => onPick(months)} className="mt-4 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
        {t(confirmLabel)}
      </button>
    </Sheet>
  )
}

/** _pickExtension ← _confirmExtension ← _extendContract */
export function ExtendFlow({ contract, onClose, onDone }: { contract: UnitContract; onClose: () => void; onDone: (end: Date) => void }) {
  const { t } = useI18n()
  const [custom, setCustom] = useState<'h' | 'd' | 'm' | null>(null)
  const [count, setCount] = useState('')
  const [by, setBy] = useState<ExtendBy | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (by) {
    const plan = extendPlan(contract, by)
    return (
      <Confirm
        open
        title="تأكيد تمديد العقد"
        message={`${t('سيُمدَّد العقد مدة')} ${t(by.label)} ${t('إضافية على المدة السابقة.')}\n\n${t('كان من:')} ${extFmt(plan.start, plan.withTime)} ${t('إلى')} ${extFmt(plan.from, plan.withTime)}\n${t('ليصبح من:')} ${extFmt(plan.start, plan.withTime)} ${t('إلى')} ${extFmt(plan.newEnd, plan.withTime)}`}
        confirmLabel="تأكيد التمديد"
        busy={busy}
        error={error}
        onCancel={onClose}
        onConfirm={async () => {
          setBusy(true)
          setError('')
          try {
            onDone(await extendContract(contract, by))
          } catch (e) {
            setError(e instanceof AssetError ? e.message : `${t('تعذر تمديد العقد')}: ${errorText(e)}`)
          } finally {
            setBusy(false)
          }
        }}
      />
    )
  }
  const unitLabel = custom === 'h' ? 'ساعة' : custom === 'd' ? 'يوم' : 'شهر'
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t('تمديد العقد')}</p>
      {custom ? (
        <div className="mt-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">
              {t('عدد')} {t(unitLabel)}
            </span>
            <input inputMode="numeric" autoFocus value={count} placeholder={t('مثال: 5')} onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ''))} className={inputClass} />
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setCustom(null)} className="h-12 flex-1 rounded-field border border-line text-[13.5px] font-extrabold text-ink">
              {t('رجوع')}
            </button>
            <button type="button" disabled={!(parseInt(count, 10) > 0)} onClick={() => setBy(customExtend(custom, parseInt(count, 10)))} className="h-12 flex-1 rounded-field bg-brand text-[13.5px] font-extrabold text-white disabled:opacity-50">
              {t('متابعة')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col divide-y divide-line">
          {EXTEND_PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => setBy(p)} className="py-3 text-start text-[13.5px] font-bold text-title hover:text-brand">
              {t(p.label)}
            </button>
          ))}
          {(
            [
              ['h', 'مخصص بالساعات'],
              ['d', 'مخصص بالأيام'],
              ['m', 'مخصص بالأشهر'],
            ] as ['h' | 'd' | 'm', string][]
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => (setCount(''), setCustom(k))} className="py-3 text-start text-[13.5px] font-bold text-sub hover:text-brand">
              {t(label)}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}

/**
  _cancelContract: «لك / عليك» ثم ملاحظات التسوية، أو «إلغاء بدون تسوية»،
  ثم التأكيد (إلا من الأرشفة). يصبح العقد ملغى والوحدة شاغرة.
*/
export function CancelContractFlow({
  asset,
  unit,
  contract,
  payments,
  confirmed = false,
  onClose,
  onDone,
}: {
  asset: Asset
  unit: PropertyUnit
  contract: UnitContract
  payments: UnitPayment[]
  confirmed?: boolean
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const currency = useCurrency()
  const contracts = useUnitContracts()
  const sum = cancelSummary(contract, payments, unit.extras)
  const [notes, setNotes] = useState('')
  const [settledMoney, setSettledMoney] = useState(false)
  const [choice, setChoice] = useState<{ without: boolean } | null>(null)
  const [needNotes, setNeedNotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const m = (v: number) => money(v, t(currency))

  async function run(without: boolean) {
    setBusy(true)
    setError('')
    try {
      await cancelContract(contract, { notes: notes.trim(), settledMoney: without ? false : settledMoney, withoutSettlement: without }, contracts.data ?? [])
      await setUnitStatus(asset.id, unitKey(unit), 'شاغرة').catch(() => {})
      await Promise.all(['assets', 'unit-contracts', 'unit-payments'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      onDone(without ? 'أُلغي العقد بدون تسوية وأصبحت الوحدة شاغرة — المستحقات في «السجل التاريخي» للمتابعة' : 'أُلغي العقد وأصبحت الوحدة شاغرة')
    } catch (e) {
      setError(`${t('تعذر إلغاء العقد:')} ${errorText(e)}`)
      setChoice(null)
    } finally {
      setBusy(false)
    }
  }

  const pick = (without: boolean) => {
    if (confirmed) void run(without)
    else setChoice({ without })
  }

  if (choice) {
    return (
      <Confirm
        open
        title="إلغاء العقد"
        message={`${t('سيصبح العقد «ملغي» وتتحول الوحدة إلى شاغرة. هل تريد المتابعة؟')}\n\n${t('العقد الملغى لا يُحذف: ينتقل إلى «السجل التاريخي» وتبقى مستحقاته غير المسوّاة للمتابعة.')}`}
        confirmLabel="إلغاء العقد"
        danger
        busy={busy}
        error={error}
        onCancel={() => setChoice(null)}
        onConfirm={() => run(choice.without)}
      />
    )
  }

  return (
    <Sheet open onClose={() => (busy ? undefined : onClose())}>
      <p className="text-[17px] font-extrabold text-title">{t('إلغاء العقد — التسوية')}</p>
      <p className="mt-3 text-[13px] font-extrabold text-brand">{t('لك')}</p>
      <p className="text-[12.5px] text-ink">• {sum.owed > 0 ? `${t('على المستأجر مبلغ:')} ${m(sum.owed)}` : t('لا مبالغ مستحقة على المستأجر.')}</p>
      <p className="mt-2 text-[13px] font-extrabold text-danger">{t('عليك')}</p>
      <p className="text-[12.5px] text-ink">
        • {sum.deposit > 0 ? `${t('ردّ التأمين للمستأجر:')} ${m(sum.deposit)}` : sum.depositRecorded > 0 ? `${t('تأمين مسجّل في العقد:')} ${m(sum.depositRecorded)} — ${t('بلا تاريخ تحصيل، ردّه للمستأجر إن كان دفعه.')}` : t('لا يوجد تأمين مستلم.')}
      </p>
      <p className="text-[12.5px] text-ink">• {sum.cheques.length ? `${t('إرجاع الشيكات')} (${sum.cheques.length}): ${sum.cheques.join('، ')}` : t('لا توجد شيكات لإرجاعها.')}</p>
      {sum.owed > 0 && (
        <label className="mt-3 flex items-center gap-2 text-[12.5px] font-bold text-ink">
          <input type="checkbox" checked={settledMoney} onChange={(e) => setSettledMoney(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
          {t('حُصّلت المبالغ أو تمت تسويتها (بلا متابعة بعدها)')}
        </label>
      )}
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[12px] font-bold text-sub">{t('ملاحظات التسوية')}</span>
        <textarea dir="auto" rows={3} value={notes} placeholder={t('اكتب ما تم الاتفاق عليه في التسوية')} onChange={(e) => (setNotes(e.target.value), setNeedNotes(false))} className={cn(inputClass, 'h-auto min-h-20 py-2.5')} />
      </label>
      <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
        {t(sum.owed > 0 ? 'إن لم تتم التسوية (مثل قضية لدى المحكمة) اختر «إلغاء بدون تسوية»: يُلغى العقد وتبقى المستحقات في «السجل التاريخي» بعلامة حمراء للمتابعة.' : 'يرجى الإلغاء بعد عمل التسوية.')}
      </p>
      {needNotes && <p className="mt-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t('اكتب ملاحظات التسوية أولًا — ماذا تم الاتفاق عليه.')}</p>}
      {error && <p className="mt-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="h-12 flex-1 rounded-field border border-line text-[13px] font-extrabold text-ink">
          {t('رجوع')}
        </button>
        {sum.owed > 0 && (
          <button type="button" disabled={busy} onClick={() => pick(true)} className="h-12 flex-1 rounded-field border border-danger text-[13px] font-extrabold text-danger">
            {t('إلغاء بدون تسوية')}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => (notes.trim() ? pick(false) : setNeedNotes(true))}
          className="flex h-12 flex-1 items-center justify-center gap-1 rounded-field bg-danger text-[13px] font-extrabold text-white disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t('تم عمل تسوية')}
        </button>
      </div>
    </Sheet>
  )
}

/** _openPaymentForm: نوع البند واسمه وتاريخه والمستحق والمسدد والمرجع. */
function PaymentForm({ contractId, existing, onClose, onDone }: { contractId: string; existing: UnitPayment | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const extra = payExtra(existing?.notes ?? null)
  const [kind, setKind] = useState(extra[PAY.kind] || PAY.rent)
  const [name, setName] = useState(extra[PAY.name] ?? '')
  const [dueDate, setDueDate] = useState(existing?.due_date ? existing.due_date.slice(0, 10) : isoOf(new Date()))
  const [due, setDue] = useState(existing && Number(existing.amount_due) ? Number(existing.amount_due).toFixed(2) : '')
  const [paid, setPaid] = useState(existing && Number(existing.amount_paid) ? Number(existing.amount_paid).toFixed(2) : '')
  const [ref, setRef] = useState(existing?.reference_no ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const field = (label: string, value: string, set: (v: string) => void, numeric = false) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-sub">{t(label)}</span>
      <input dir="auto" inputMode={numeric ? 'decimal' : undefined} value={value} onChange={(e) => set(e.target.value)} className={inputClass} />
    </label>
  )
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t(existing ? 'تعديل الدفعة' : 'إضافة دفعة')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {PAY_KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-full border px-3 py-1.5 text-[12.5px] font-extrabold', kind === k ? 'border-brand bg-brand text-white' : 'border-line text-ink')}>
            {t(k)}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        {field('اسم البند (مثال: دفعة مارس، رسوم التسجيل)', name, setName)}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('تاريخ الاستحقاق')}</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </label>
        {field('المبلغ المستحق', due, setDue, true)}
        {field('المبلغ المسدد', paid, setPaid, true)}
        {field('رقم المرجع / السند', ref, setRef)}
      </div>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await savePayment(contractId, existing, { kind, name, dueDate, due, paid, ref })
            onDone()
          } catch (e) {
            setError(e instanceof AssetError ? e.message : `${t('تعذّر حفظ الدفعة:')} ${errorText(e)}`)
          } finally {
            setBusy(false)
          }
        }}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t(existing ? 'حفظ التعديل' : 'حفظ الدفعة')}
      </button>
    </Sheet>
  )
}

/** صندوق الدفعات الإيجارية والإدارية والتأمين (_duesSummaryBody / _sharedDuesBox). */
export function DuesBox({ payments, editable, open, canAdd, onPay, onEdit }: { payments: UnitPayment[]; editable: boolean; open: boolean; canAdd: boolean; onPay: (p: UnitPayment) => void; onEdit?: (p: UnitPayment | null) => void }) {
  const { t } = useI18n()
  const currency = useCurrency()
  const totals = dueTotals(payments)
  const tile = (label: string, value: number, sub: string) => (
    <div className="rounded-inner bg-surface px-3 py-2">
      <p className="text-[11px] font-bold text-muted">{t(label)}</p>
      <p className="text-[14px] font-extrabold text-title">{money(value, t(currency))}</p>
      <p className="text-[10.5px] text-sub">{sub}</p>
    </div>
  )
  return (
    <div className="mt-3 rounded-inner border border-line p-3">
      <p className="mb-2 text-[13px] font-extrabold text-title">{t('الدفعات الإيجارية + الدفعات الإدارية + التأمين')}</p>
      {payments.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-sub">{t(canAdd ? 'لا توجد دفعات بعد — تُولَّد من دفعات عقد الإيجار ورسومه وتأمينه عند حفظه، أو أضفها يدويًا.' : 'لا توجد دفعات بعد.')}</p>
      ) : (
        <>
          <p className="mb-2 flex items-center justify-between rounded-inner bg-brand-soft px-3 py-2 text-[12.5px] font-extrabold text-brand">
            <span>
              {t('إجمالي الدفعات')} {money(totals.grand, t(currency))}
            </span>
            <span className="rounded-full bg-white px-2 text-[11px] text-sub">{payments.length}</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {tile('الدفعات المستحقة', totals.dueToday, `${totals.dueTodayCount} ${t('بند')}`)}
            {tile('الدفعات المتأخرة', totals.overdue, `${totals.overdueCount} ${t('بند')}`)}
            {tile('الدفعات القادمة', totals.upcoming, `${totals.upcomingCount} ${t('بند')}`)}
            {tile('الدفعات المستلمة', totals.received, `${totals.receivedCount} ${t('بند')}`)}
          </div>
          <p className="mt-2 text-[12px] font-bold text-sub">{totals.nextDue ? `${t('أقرب استحقاق:')} ${pretty(totals.nextDue)}` : t('أقرب استحقاق: لا يوجد')}</p>
          <div className="mt-2 flex flex-col divide-y divide-line">
            {payments.map((p) => {
              const left = (Number(p.amount_due) || 0) - (Number(p.amount_paid) || 0)
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-[12px]">
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="font-extrabold text-title">
                      {t(payNameOf(p))}
                    </p>
                    <p className="text-[11px] text-muted">
                      {p.due_date ? pretty(p.due_date) : t('بلا تاريخ')} · {money(p.amount_due, t(currency))}
                    </p>
                  </div>
                  <span className={cn('font-bold', left > 0.009 ? 'text-gold-dark' : 'text-brand')}>{left > 0.009 ? `${t('المتبقي')}: ${money(left)}` : t('مسددة')}</span>
                  {editable && left > 0.009 && open && (
                    <button type="button" onClick={() => onPay(p)} className="h-7 rounded-inner bg-brand px-2.5 text-[11.5px] font-extrabold text-white hover:bg-brand-dark">
                      {t('تسجيل السداد')}
                    </button>
                  )}
                  {editable && onEdit && (
                    <button type="button" aria-label={t('تعديل')} onClick={() => onEdit(p)} className="text-brand">
                      <Pencil className="size-4" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
      {editable && canAdd && open && onEdit && (
        <button type="button" onClick={() => onEdit(null)} className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-field border border-dashed border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft">
          <Plus className="size-4" />
          {t('إضافة دفعة')}
        </button>
      )}
    </div>
  )
}
