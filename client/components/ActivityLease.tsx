import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Maximize2, Plus, Printer, RefreshCw, X, XCircle } from 'lucide-react'
import { cn, money } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { useCurrency, type Asset, type UnitContract, type UnitPayment } from '@/lib/data'
import { usePageContracts, usePageEntries, usePagePayments } from '@/lib/delegatedAssets'
import { errorText, supabase } from '@/lib/supabase'
import { splitLogs } from '@/lib/vehicleWrite'
import { ACTIVITY_UNIT_KEY, activityLicenseFromMeta } from '@/lib/activityWrite'
import { ACTIVITY_TYPES, K, contractNumber, decodeLease, emptyLease, encodeLease, pretty, shareText } from '@/lib/lease'
import { contractClosed, contractEnded } from '@/lib/leaseActions'
import { printText, type Renewal } from './LeaseForm'
import { useLeasePrint } from './LeasePrint'
import { Confirm } from './Confirm'
import { SettleRent } from './SettleRent'
import { ActionTile, DuesBox, ExtendFlow, MonthsSheet } from './UnitLease'

/*
  «إدارة النشاط» (projects_activities_screen.dart ← _activityLeasePanel):
  عقد إيجار النشاط (آخر عقد غير ملغى بتاريخ البداية)، حالته و«العقد كامل»
  (النص وجدول الدفعات مع الطباعة)، مدة العقد: تمديد قبل الانتهاء أو تجديد
  بعده (1/3/6/12/24 شهرًا من نهاية السابق، والسابق يصبح منتهيًا)، وإلغاء
  بتأكيد، ثم صندوق الدفعات وسدادها (بلا «إضافة دفعة»: النشاط مستأجر).
*/

const MONTHS: [string, number][] = [
  ['1 شهر', 1],
  ['3 شهر', 3],
  ['6 شهر', 6],
  ['سنة', 12],
  ['سنتان', 24],
]

/** _activityContract */
export function activityContract(contracts: UnitContract[], assetId: string) {
  let best: UnitContract | undefined
  for (const c of contracts) {
    if (c.asset_id !== assetId || c.unit_key !== ACTIVITY_UNIT_KEY || c.status === 'cancelled') continue
    if (!best) {
      best = c
      continue
    }
    if (c.start_date && (!best.start_date || c.start_date > best.start_date)) best = c
  }
  return best
}

/** عقد جديد للنشاط: بيانات الرخصة من بيانات النشاط، والمستأجر اسمه. */
export function activityPrefill(asset: Asset) {
  const meta = splitLogs(asset.logs_json).meta
  const lease = emptyLease()
  lease.license = activityLicenseFromMeta(meta, asset.title, asset.sub_type)
  lease.tenant[K.name] = asset.title
  const place = (asset.location_or_type ?? '').trim()
  if (!(lease.license[K.activityLocation] ?? '') && place && place !== 'غير محدد') lease.license[K.activityLocation] = place
  return encodeLease(lease)
}

/** _addBranch: رخصة الفرع تبدأ ببيانات النشاط الرئيسي، وموقع الفرع يُكتب له. */
export function branchPrefill(parent: Asset) {
  const lease = emptyLease()
  lease.license = activityLicenseFromMeta(splitLogs(parent.logs_json).meta, parent.title, parent.sub_type)
  delete lease.license[K.activityLocation]
  return encodeLease(lease)
}

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function ActivityLeaseBox({
  asset,
  editable,
  onLease,
  onRenew,
  onDone,
}: {
  asset: Asset
  editable: boolean
  onLease: () => void
  onRenew: (contract: UnitContract, renewal: Renewal) => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const currency = useCurrency()
  const contracts = usePageContracts()
  const allPayments = usePagePayments()
  const entries = usePageEntries()
  const contract = activityContract(contracts.data ?? [], asset.id)
  const payments = contract ? (allPayments.data ?? []).filter((p) => p.contract_id === contract.id) : []
  const [error, setError] = useState('')
  const [extending, setExtending] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [full, setFull] = useState(false)
  const [paying, setPaying] = useState<UnitPayment | null>(null)
  const [notice, setNotice] = useState('')
  const flash = (m: string) => {
    setNotice(m)
    window.setTimeout(() => setNotice(''), 4000)
  }
  // _hasBlockingMaintenance: صيانة النشاط «تحت الصيانة» و«تمنع التأجير».
  const blocked = (entries.data ?? []).some((e) => e.asset_id === asset.id && e.kind === 'maintenance' && String(e.data['حالة الصيانة'] ?? '') === 'تحت الصيانة' && String(e.data['أثر الصيانة على الإيجار'] ?? '') === 'تمنع التأجير')
  const blockedMessage = 'النشاط تحت صيانة تمنع التأجير — سجّل «انتهاء الصيانة» من قسم الصيانة أولًا.'
  const refresh = () => Promise.all(['assets', 'unit-contracts', 'unit-payments'].map((k) => qc.invalidateQueries({ queryKey: [k] })))

  if (!contract) {
    return (
      <div className="mt-5">
        <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
          <span className="h-4 w-1 rounded-full bg-gold" />
          {t('إدارة النشاط')}
        </p>
        {error && <p className="mb-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="flex items-center gap-2 rounded-inner bg-surface px-3 py-3">
          <p className="flex-1 text-[12.5px] text-sub">{t('لا يوجد عقد إيجار بعد — اضغط + لإضافته.')}</p>
          {editable && (
            <button type="button" aria-label={t('إضافة عقد الإيجار')} title={t('إضافة عقد الإيجار')} onClick={() => (blocked ? setError(blockedMessage) : (setError(''), onLease()))} className="grid size-9 place-items-center rounded-full bg-brand text-white">
              <Plus className="size-5" />
            </button>
          )}
        </div>
      </div>
    )
  }

  const closed = contractClosed(contract)
  const ended = contractEnded(contract)
  const endedByDate = ended && !closed
  const statusLabel = contract.status === 'cancelled' ? 'ملغي' : closed ? 'منتهي' : contract.status === 'pending' ? 'مسودة' : endedByDate ? 'منتهي' : 'نشط'
  const statusClass = contract.status === 'pending' ? 'bg-gold/15 text-gold-dark' : endedByDate ? 'bg-danger-soft text-danger' : closed ? 'bg-surface text-sub' : 'bg-brand-soft text-brand'

  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
        <span className="h-4 w-1 rounded-full bg-gold" />
        {t('إدارة النشاط')}
      </p>
      {notice && <p className="mb-2 rounded-inner bg-brand-soft px-3 py-2 text-[12.5px] font-bold text-brand">{t(notice)}</p>}
      {error && <p className="mb-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <div className="flex items-center gap-2">
        <span className={cn('rounded-full px-3 py-1 text-[12px] font-extrabold', statusClass)}>{t(statusLabel)}</span>
        <span className="flex-1" />
        <button type="button" onClick={() => setFull(true)} className="flex items-center gap-1.5 rounded-inner bg-brand px-3.5 py-2 text-[12px] font-extrabold text-white">
          <Maximize2 className="size-4" />
          {t('العقد كامل')}
        </button>
      </div>

      <div className="mt-3 rounded-inner border border-line p-3">
        <p className="mb-2 text-[13px] font-extrabold text-title">{t('مدة العقد')}</p>
        {endedByDate && <p className="mb-2 rounded-inner bg-gold/10 px-3 py-2 text-[11.5px] font-bold text-gold-dark">{t('انتهت مدة العقد — يُرجى إلغاء العقد أو تجديده.')}</p>}
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
        {editable && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {ended ? (
              <ActionTile icon={RefreshCw} label="تجديد العقد" onClick={() => (blocked ? setError(blockedMessage) : (setError(''), setRenewing(true)))} />
            ) : (
              <ActionTile icon={CalendarClock} label="تمديد العقد" onClick={() => (setError(''), setExtending(true))} />
            )}
            <ActionTile icon={XCircle} label="إلغاء العقد" danger onClick={() => (setError(''), setCancelling(true))} />
          </div>
        )}
      </div>

      <DuesBox payments={payments} editable={editable} open={contract.status !== 'cancelled'} canAdd={false} onPay={setPaying} />

      {extending && (
        <ExtendFlow
          contract={contract}
          onClose={() => setExtending(false)}
          onDone={async (end) => {
            setExtending(false)
            await refresh()
            flash(`${t('مُدِّد العقد حتى')} ${pretty(isoOf(end))}`)
          }}
        />
      )}
      {renewing && (
        <MonthsSheet
          title="تجديد العقد"
          hint=""
          confirmLabel="متابعة"
          options={MONTHS}
          onClose={() => setRenewing(false)}
          onPick={(months) => {
            setRenewing(false)
            // _renewActivityLease: من نهاية السابق إن لم تمضِ، وإلا من اليوم.
            const now = new Date()
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            const oldEnd = contract.end_date ? new Date(Number(contract.end_date.slice(0, 4)), Number(contract.end_date.slice(5, 7)) - 1, Number(contract.end_date.slice(8, 10))) : null
            const start = oldEnd && !(oldEnd.getTime() < today.getTime()) ? oldEnd : today
            const end = new Date(start.getFullYear(), start.getMonth() + months, start.getDate())
            onRenew(contract, { notes: contract.notes, start, end, oldNo: contractNumber(contract), expireId: contract.id })
          }}
        />
      )}
      <Confirm
        open={cancelling}
        title="إلغاء العقد"
        message={t('سيصبح عقد إيجار النشاط «ملغي». هل تريد المتابعة؟')}
        confirmLabel="إلغاء العقد"
        danger
        busy={busy}
        error={error}
        onCancel={() => setCancelling(false)}
        onConfirm={async () => {
          setBusy(true)
          setError('')
          try {
            const { error: e } = await supabase.from('property_unit_contracts').update({ status: 'cancelled' }).eq('id', contract.id)
            if (e) throw e
            await refresh()
            setCancelling(false)
            onDone('أُلغي العقد')
          } catch (e) {
            setError(`${t('تعذر إلغاء العقد')}: ${errorText(e)}`)
          } finally {
            setBusy(false)
          }
        }}
      />
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
      {full && <ActivityContractSheet asset={asset} contract={contract} payments={payments} currency={currency} onClose={() => setFull(false)} />}
    </div>
  )
}

/** _openActivityContractSheet: النص كاملًا مع جدول الدفعات، والطباعة. */
function ActivityContractSheet({ asset, contract, payments, currency, onClose }: { asset: Asset; contract: UnitContract; payments: UnitPayment[]; currency: string; onClose: () => void }) {
  const { t } = useI18n()
  const lease = decodeLease(contract.notes)
  const m = (v: number) => money(v, currency)
  const fmtPay = (d: string | null) => (d ? `${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}` : 'غير محدد')
  const statusOf = (p: UnitPayment) => {
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
  const lines = [
    'عقد إيجار النشاط التجاري',
    `النشاط: ${asset.title}`,
    `رقم العقد: ${contractNumber(contract)}`,
    `المستأجر: ${contract.tenant_name ?? '—'}`,
    `الفترة: ${contract.start_date ? pretty(contract.start_date) : '—'} - ${contract.end_date ? pretty(contract.end_date) : '—'}`,
    '',
  ]
  const isEmpty = !Object.keys(lease.contract).length && !Object.keys(lease.property).length && !Object.keys(lease.lessor).length && !Object.keys(lease.tenant).length && !lease.payments.length
  let text = lines.join('\n') + '\n'
  if (!isEmpty) text += shareText(lease) + '\n'
  if (payments.length) {
    let due = 0
    let paid = 0
    const rows = payments.map((p, i) => {
      due += Number(p.amount_due) || 0
      paid += Number(p.amount_paid) || 0
      return `${i + 1}) استحقاق ${fmtPay(p.due_date)} — مستحق ${m(Number(p.amount_due))} — مسدد ${m(Number(p.amount_paid))} — ${statusOf(p)}`
    })
    text += ['', 'جدول الدفعات:', ...rows, '', `إجمالي المستحق: ${m(due)}`, `إجمالي المسدد: ${m(paid)}`, `المتبقي: ${m(due - paid)}`].join('\n') + '\n'
  }
  // «طباعة / مشاركة»: نموذج العقد المعتمد (printOrShareLeaseContract)، والعقد القديم بلا بيانات نصًّا.
  const leasePrint = useLeasePrint()
  const print = () => (isEmpty ? printText(`عقد-${asset.title}`, text) : leasePrint.open({ lease, title: 'عقد إيجار النشاط التجاري', activity: true, assetId: asset.id }))
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-brand-deep/40 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="flex h-[88vh] w-full flex-col overflow-hidden rounded-t-card bg-white shadow-2xl sm:max-w-2xl sm:rounded-card">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-[16px] font-extrabold text-title">{t('العقد كامل')}</p>
          <button type="button" onClick={onClose} aria-label={t('إغلاق')} className="grid size-9 place-items-center rounded-full bg-surface text-body">
            <X className="size-4" />
          </button>
        </div>
        <pre dir="auto" className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap p-4 font-[inherit] text-[12.5px] leading-[1.9] text-ink">
          {text}
        </pre>
        <div className="border-t border-line px-4 py-3">
          <button type="button" onClick={print} className="flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
            <Printer className="size-4" />
            {t('طباعة / مشاركة')}
          </button>
        </div>
      </div>
      {leasePrint.ui}
    </div>
  )
}

export const ACTIVITY_CLASS_OPTIONS = ACTIVITY_TYPES
