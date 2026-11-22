import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, FileSpreadsheet, Maximize2, Plus, ReceiptText, RefreshCw, XCircle } from 'lucide-react'
import { cn, money } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { useCurrency, type Asset, type UnitContract, type UnitPayment } from '@/lib/data'
import { usePageContracts, usePageEntries, usePagePayments } from '@/lib/delegatedAssets'
import { contractClosed, contractEnded, isLeaseContract } from '@/lib/leaseActions'
import { decodeLease, emptyLease, encodeLease, parseDay, pretty, type Row } from '@/lib/lease'
import { EQ, VEHICLE_LAND, VEHICLE_MARINE, VEHICLE_UNIT_KEY, splitLogs } from '@/lib/vehicleWrite'
import type { Renewal, VehicleMode } from './LeaseForm'
import { ActionTile, CancelContractFlow, DuesBox, ExtendFlow, PaymentForm } from './UnitLease'
import { SettleRent } from './SettleRent'
import { useLeasePrint } from './LeasePrint'
import { TextShareSheet, vehicleDocumentText } from './AssetExtras'

/*
  «إدارة التأجير» للمركبة (_equipmentRentalSection في projects_activities_screen.dart):
  العقد الجاري = أحدث عقد (بتاريخ البداية) غير منتهٍ على «equipment»؛ حالته،
  و«العقد كامل»، ومدة العقد والمستأجر وقيمته، وتمديد قبل الانتهاء أو تجديد
  بعده، وإلغاء بالتسوية (يُنهى العقد والمركبة شاغرة)، والدفعات وإضافة دفعة.
  عقد التأجير بنموذج عقد العقار نفسه: بيانات المركبة مكان العقار.
*/

const OPERATOR_KEYS = { name: 'اسم المشغل', nationality: 'جنسية المشغل' }

/** _equipContracts: الأحدث بتاريخ البداية أولًا. */
export function vehicleContracts(all: UnitContract[], assetId: string) {
  return all
    .filter((c) => c.asset_id === assetId && c.unit_key === VEHICLE_UNIT_KEY)
    .sort((a, b) => {
      if (!a.start_date && !b.start_date) return 0
      if (!a.start_date) return 1
      if (!b.start_date) return -1
      return b.start_date.localeCompare(a.start_date)
    })
}

/** _equipContract: العقد الجاري (غير المنتهي). */
export const currentVehicleContract = (all: UnitContract[], assetId: string) => vehicleContracts(all, assetId).find((c) => c.status !== 'expired') ?? null

/** _vehicleLeaseFields: بيانات المركبة في العقد. */
export function vehicleLeaseMode(asset: Asset, template?: string): VehicleMode {
  const meta = splitLogs(asset.logs_json).meta
  const m = (key: string) => (meta[key] ?? '').trim()
  const vehicleClass = meta[EQ.vehicleClass] || VEHICLE_LAND
  const marine = vehicleClass === VEHICLE_MARINE
  const type = m(EQ.vehicleType)
  const rows: [string, string][] = [
    ['تصنيف المركبة', vehicleClass],
    ['نوع المركبة', type || asset.sub_type],
    ['اسم المركبة', asset.title],
    ['الموديل', m(EQ.model)],
    marine ? ['رقم التسجيل البحري', m(EQ.registration)] : ['رقم اللوحة', m(EQ.plate)],
    [marine ? 'رقم الهيكل (HIN)' : 'رقم الشاصي', String(asset.serial_number ?? '')],
    ...(marine ? ([['المرسى / الميناء', m(EQ.marina)], ['السعة', m(EQ.capacity)]] as [string, string][]) : []),
    ['تاريخ انتهاء الملكية', m(EQ.ownershipEnd)],
    ['تاريخ انتهاء التأمين', m(EQ.insuranceEnd)],
  ]
  return { fields: rows.map((r) => r[0]), values: Object.fromEntries(rows), meta, vehicleClass, template }
}

/** عقد جديد: شروط التأجير المسجّلة على المركبة تُنقل إليه. */
export function vehicleTermsTemplate(asset: Asset): string | undefined {
  const meta = splitLogs(asset.logs_json).meta
  const party = (v: string | undefined) => ((v ?? '').trim() === 'على المالك' ? 'على المؤجر' : (v ?? '').trim())
  const terms: Row = {
    'موقع التأجير': (meta[EQ.projectLocation] ?? '').trim(),
    'الصيانة على': party(meta['الصيانة على']),
    'الوقود على': party(meta['الوقود على']),
    'نقل المركبة على': party(meta['نقل المعدة على']),
    'رقم التواصل': (meta[EQ.contactPhone] ?? '').trim(),
    'شروط التأجير': (meta['ملاحظات شروط التأجير'] ?? '').trim(),
  }
  for (const k of Object.keys(terms)) if (!terms[k]) delete terms[k]
  if (!Object.keys(terms).length) return undefined
  const seed = emptyLease()
  Object.assign(seed.contract, terms)
  return encodeLease(seed)
}

/** _openEquipContractForm(renewFrom): من اليوم التالي لنهاية السابق وبمدته. */
export function vehicleRenewal(c: UnitContract): Renewal {
  const oldStart = parseDay(c.start_date)
  const oldEnd = parseDay(c.end_date)
  const now = new Date()
  const from = oldEnd ? new Date(oldEnd.getFullYear(), oldEnd.getMonth(), oldEnd.getDate() + 1) : new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const span = oldStart && oldEnd ? Math.round((oldEnd.getTime() - oldStart.getTime()) / 86400000) : 0
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate() + span)
  return { notes: c.notes, start: from, end, oldNo: (decodeLease(c.notes).contract['رقم العقد الجديد'] ?? '').trim(), expireId: c.id }
}

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function VehicleLeaseBox({
  asset,
  editable,
  canAdd,
  onLease,
  onRenew,
  onDone,
}: {
  asset: Asset
  editable: boolean
  canAdd: boolean
  onLease: (existing?: UnitContract) => void
  onRenew: (contract: UnitContract, renewal: Renewal) => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const currency = useCurrency()
  const contracts = usePageContracts()
  const allPayments = usePagePayments()
  const entries = usePageEntries()
  const leasePrint = useLeasePrint()
  const all = vehicleContracts(contracts.data ?? [], asset.id)
  const contract = all.find((c) => c.status !== 'expired') ?? null
  const payments = contract ? (allPayments.data ?? []).filter((p) => p.contract_id === contract.id) : []
  const [error, setError] = useState('')
  const [extending, setExtending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [paying, setPaying] = useState<UnitPayment | null>(null)
  const [editingPay, setEditingPay] = useState<{ existing: UnitPayment | null } | null>(null)
  const [notice, setNotice] = useState('')
  const [doc, setDoc] = useState<{ title: string; text: string } | null>(null)
  const flash = (m: string) => {
    setNotice(m)
    window.setTimeout(() => setNotice(''), 4000)
  }
  // _hasBlockingMaintenance
  const blocked = (entries.data ?? []).some((e) => e.asset_id === asset.id && e.kind === 'maintenance' && String(e.data['حالة الصيانة'] ?? '') === 'تحت الصيانة' && String(e.data['أثر الصيانة على الإيجار'] ?? '') === 'تمنع التأجير')
  const blockedMessage = 'المركبة تحت صيانة تمنع التأجير — سجّل «انتهاء الصيانة» من قسم الصيانة أولًا.'
  const refresh = () => Promise.all(['assets', 'unit-contracts', 'unit-payments'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  const meta = splitLogs(asset.logs_json).meta
  const operator = [meta[OPERATOR_KEYS.name] ?? '', meta[OPERATOR_KEYS.nationality] ?? ''].filter((v) => v.trim()).join(' · ')

  const heading = (
    <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
      <span className="h-4 w-1 rounded-full bg-gold" />
      {t('إدارة التأجير')}
    </p>
  )

  if (!contract) {
    return (
      <div className="mt-5">
        {heading}
        {error && <p className="mb-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="flex items-center gap-2 rounded-inner bg-surface px-3 py-3">
          <p className="flex-1 text-[12.5px] text-sub">
            {t(all.length ? 'المركبة شاغرة — آخر عقد منتهٍ. اضغط + لبدء عملية التأجير وإنشاء عقد.' : 'المركبة غير مؤجرة — اضغط + لبدء عملية التأجير وإنشاء عقد.')}
          </p>
          {editable && canAdd && (
            <button type="button" aria-label={t('عقد تأجير المركبة')} title={t('عقد تأجير المركبة')} onClick={() => (blocked ? setError(blockedMessage) : (setError(''), onLease()))} className="grid size-9 place-items-center rounded-full bg-brand text-white">
              <Plus className="size-5" />
            </button>
          )}
        </div>
      </div>
    )
  }

  const lease = isLeaseContract(contract)
  const closed = contractClosed(contract)
  const ended = contractEnded(contract)
  const endedByDate = ended && !closed
  const statusLabel = contract.status === 'cancelled' ? 'ملغي' : closed ? 'منتهي' : contract.status === 'pending' ? 'مسودة' : endedByDate ? 'منتهي' : 'نشط'
  const statusClass = contract.status === 'pending' ? 'bg-gold/15 text-gold-dark' : endedByDate ? 'bg-danger-soft text-danger' : closed ? 'bg-surface text-sub' : 'bg-brand-soft text-brand'
  // بعد انتهاء المدة «تجديد العقد» مكان التمديد (ممنوع مع صيانة تمنع التأجير).
  const pastEnd = !!contract.end_date && contract.end_date.slice(0, 10) < isoOf(new Date())

  return (
    <div className="mt-5">
      {heading}
      {notice && <p className="mb-2 rounded-inner bg-brand-soft px-3 py-2 text-[12.5px] font-bold text-brand">{t(notice)}</p>}
      {error && <p className="mb-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <div className="flex items-center gap-2">
        <span className={cn('rounded-full px-3 py-1 text-[12px] font-extrabold', statusClass)}>{t(statusLabel)}</span>
        <span className="flex-1" />
        {lease ? (
          <>
            <button type="button" onClick={() => leasePrint.open({ lease: decodeLease(contract.notes), title: `${t('عقد تأجير')} ${t(meta[EQ.vehicleClass] || VEHICLE_LAND)}`, assetMeta: meta })} className="rounded-inner border border-brand px-3 py-2 text-[12px] font-extrabold text-brand">
              {t('طباعة العقد')}
            </button>
            <button type="button" onClick={() => onLease(contract)} className="flex items-center gap-1.5 rounded-inner bg-brand px-3.5 py-2 text-[12px] font-extrabold text-white">
              <Maximize2 className="size-4" />
              {t('العقد كامل')}
            </button>
          </>
        ) : (
          <span className="text-[11.5px] font-bold text-muted">{t('عقد بالنموذج القديم — تعديله من التطبيق')}</span>
        )}
      </div>
      {leasePrint.ui}

      <div className="mt-3 rounded-inner border border-line p-3">
        <p className="mb-2 text-[13px] font-extrabold text-title">{t('مدة العقد')}</p>
        {endedByDate && <p className="mb-2 rounded-inner bg-gold/10 px-3 py-2 text-[11.5px] font-bold text-gold-dark">{t('انتهت مدة العقد — يُرجى إلغاء العقد لتصبح المركبة شاغرة، أو تجديده.')}</p>}
        <div className="grid grid-cols-2 gap-2">
          {[
            ['بداية العقد', contract.start_date ? pretty(contract.start_date) : '—'],
            ['نهاية العقد', contract.end_date ? pretty(contract.end_date) : '—'],
            ['المستأجر', contract.tenant_name || '—'],
            ['قيمة العقد', money(Number(contract.annual_rent) || 0, t(currency))],
          ].map(([label, value]) => (
            <div key={label} className="rounded-inner bg-surface px-3 py-2">
              <p className="text-[11px] font-bold text-muted">{t(label)}</p>
              <p dir="auto" className="text-[13.5px] font-extrabold text-title">
                {value}
              </p>
            </div>
          ))}
        </div>
        {editable && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {pastEnd ? (
              <ActionTile icon={RefreshCw} label="تجديد العقد" onClick={() => (blocked ? setError(blockedMessage) : (setError(''), onRenew(contract, vehicleRenewal(contract))))} />
            ) : (
              <ActionTile icon={CalendarClock} label="تمديد العقد" onClick={() => (setError(''), setExtending(true))} />
            )}
            <ActionTile icon={XCircle} label="إلغاء العقد" danger onClick={() => (setError(''), setCancelling(true))} />
          </div>
        )}
      </div>

      <DuesBox payments={payments} editable={editable} open={contract.status !== 'cancelled'} canAdd={canAdd} onPay={setPaying} onEdit={(p) => setEditingPay({ existing: p })} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        {([
          [true, 'سند قبض', ReceiptText],
          [false, 'مطالبة مالية', FileSpreadsheet],
        ] as const).map(([receipt, label, Icon]) => (
          <ActionTile
            key={label}
            icon={Icon}
            label={label}
            onClick={() => {
              const text = vehicleDocumentText(asset, contract, payments, receipt, t(currency), t)
              if (!text) return setError(receipt ? 'لا توجد مبالغ مسددة بعد' : 'لا توجد مبالغ مستحقة')
              setError('')
              setDoc({ title: label, text })
            }}
          />
        ))}
      </div>
      {doc && <TextShareSheet title={doc.title} text={doc.text} onClose={() => setDoc(null)} />}

      {operator && (
        <div className="mt-3 rounded-inner bg-surface px-3 py-2">
          <p className="text-[11px] font-bold text-muted">{t(meta[EQ.vehicleClass] === VEHICLE_MARINE ? 'القبطان والرخصة البحرية' : 'السائق / المشغّل')}</p>
          <p dir="auto" className="text-[13px] font-extrabold text-title">
            {operator}
          </p>
        </div>
      )}

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
      {cancelling && (
        <CancelContractFlow
          asset={asset}
          vehicle
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
      {editingPay && (
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
