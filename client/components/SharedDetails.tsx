import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CheckCheck, FileText, Gift, Handshake, Paperclip, PlusCircle, Repeat, Trash2, Undo2, X } from 'lucide-react'
import { useStore, type Entry } from '@/lib/data'
import { errorText } from '@/lib/supabase'
import { publicName as publicNameOf } from '@/lib/requestsWrite'
import {
  LEDGER_TYPES,
  SharedError,
  addContribution,
  canDeleteExpense,
  deleteSharedExpense,
  addRoscaPayment,
  decideLedgerItem,
  deleteRoscaPayment,
  isLumpSum,
  joinOf,
  leaveOf,
  payoutUnpaid,
  recordSettlements,
  roscaChangeReceiver,
  roscaCycleTotal,
  roscaMarkAllPaid,
  roscaTogglePayout,
} from '@/lib/sharedWrite'
import { FileError, uploadDeviceFile } from '@/lib/files'
import { Confirm } from './Confirm'
import { Sheet } from './ui'
import { MemberDatesActions } from './SharedLifecycle'
import { RoscaMemberActions, SharedSimpleSections } from './SharedSections'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { date, money } from '@/lib/format'
import {
  POT,
  PENDING,
  acceptances,
  budget,
  contributions,
  cycleCollected,
  cycleComplete,
  cycleShareOf,
  cycleStatus,
  cycleTarget,
  expenses,
  fndIn,
  hasBudget,
  iAmManager,
  memberNets,
  memberPaid,
  paidBy,
  parseMoney,
  memberNames,
  members,
  remaining,
  roscaPlan,
  settleTransfers,
  settlements,
  total,
  totalsByCategory,
  withoutFnd,
} from '@/lib/shared'
import { startOfToday } from '@/lib/metrics'
import { FileButton } from './FileButton'
import { useRecordShare } from './RecordShare'
import { settlementDoc } from '@/lib/sharedPdf'
import { namedFile } from '@/components/DocName'

const STATUS_COLOR: Record<string, string> = {
  مكتملة: '#0A5A50',
  متأخرة: '#C4392E',
  جارية: '#CE8422',
  قادمة: '#8C9A97',
}

function Block({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
        <span className="h-4 w-1 rounded-full bg-gold" />
        {t(title)}
        {count !== undefined && <span className="rounded-full bg-surface px-2 text-[11px] text-sub">{count}</span>}
        {action && <span className="ms-auto">{action}</span>}
      </p>
      <div className="flex flex-col gap-2 rounded-inner bg-surface p-2">{children}</div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const { t } = useI18n()
  return (
    <div className="card-inner px-3 py-2">
      <p className="text-[11px] text-muted">{t(label)}</p>
      <p className="text-[15px] font-extrabold" style={{ color: color ?? '#0F1F1C' }}>
        {value}
      </p>
    </div>
  )
}

/**
 * تفاصيل الالتزام المشترك كما يعرضها التطبيق: الأعضاء ودعواتهم، والميزانية
 * والمصروفات والأرصدة والتسوية، أو دورات الجمعية. للعرض فقط.
 */
/** الكتابة في الدفتر من الموقع: المسؤول يوافق، وكل عضو يضيف ميزانية ويسجّل التسوية. */
type LedgerActions = {
  manager: boolean
  addBudget?: () => void
  settle?: () => void
  /** حذف مصروف: للمسؤول، وللعضو ما أرسله ولم يُعتمد. */
  canDelete?: (e: { status: string; submittedBy: string }) => boolean
  deleteExpense?: (id: string, label: string) => void
}

export function SharedDetails({
  details,
  entryType,
  currency,
  entry,
  onChanged,
}: {
  details: Record<string, unknown>
  entryType: string
  currency: string
  entry?: Entry
  onChanged?: (message: string) => void
}) {
  const { t } = useI18n()
  const { profile } = useSession()
  const fnd = profile?.fnd_id ?? ''
  const cur = t(String(details['العملة'] ?? '').trim() || currency)
  const list = members(details)
  const names = memberNames(details)
  const replies = acceptances(details)
  const isCircle = entryType === 'جمعية مالية' || entryType === 'جمعية'
  const shown = (name: string) => (name === POT ? t(POT) : withoutFnd(name) || name)

  // الكتابة: الموافقة على الطلبات والميزانية الإضافية (للمسؤول).
  const store = useStore()
  const qc = useQueryClient()
  const fullName = String(store.data?.['settings_profile_name'] ?? '').trim() || profile?.display_name || ''
  const shownName = publicNameOf(store.data, profile?.display_name ?? '')
  const myNames = [fullName, shownName].filter(Boolean)
  const writable = !!entry && !['مؤرشف', 'ملغاة', 'محذوف'].includes(entry.status)
  const manager = writable && iAmManager(details, fnd, myNames)
  const [deciding, setDeciding] = useState<{ kind: 'expense' | 'contribution'; id: string; label: string; approve: boolean } | null>(null)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)
  const [removingExpense, setRemovingExpense] = useState<{ id: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function runDecision() {
    if (!entry || !deciding) return
    setBusy(true)
    setError('')
    try {
      await decideLedgerItem(entry, deciding.kind, deciding.id, deciding.approve, fnd, myNames)
      await qc.invalidateQueries({ queryKey: ['shared'] })
      onChanged?.(
        deciding.kind === 'expense'
          ? deciding.approve
            ? 'تمت الموافقة على المصروف'
            : 'تم رفض المصروف'
          : deciding.approve
            ? 'تمت الموافقة على الميزانية الإضافية'
            : 'تم رفض الميزانية الإضافية',
      )
      setDeciding(null)
    } catch (e) {
      setError(e instanceof SharedError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  const actions: LedgerActions | undefined = writable
    ? {
        manager,
        addBudget: isLumpSum(details) ? () => setBudgetOpen(true) : undefined,
        settle: () => setSettleOpen(true),
        canDelete: (e) => canDeleteExpense(e, manager, myNames),
        deleteExpense: (id, label) => {
          setError('')
          setRemovingExpense({ id, label })
        },
      }
    : undefined

  return (
    <div>
      {list.length > 0 && (
        <Block
          title="الأعضاء"
          count={list.length}
          action={
            entry && isCircle ? (
              <RoscaMemberActions entry={entry} onChanged={(m) => onChanged?.(m)} />
            ) : entry && LEDGER_TYPES.includes(entryType) ? (
              <MemberDatesActions entry={entry} currency={currency} onChanged={(m) => onChanged?.(m)} />
            ) : undefined
          }
        >
          {list.map((m, i) => {
            const id = fndIn(m.name)
            const reply = id ? replies[id]?.state : ''
            const state = reply === 'accepted' ? 'قبِل' : reply === 'rejected' ? 'رفض' : reply === 'cancelled' ? 'أُلغيت الدعوة' : ''
            return (
              <div key={i} className="card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span dir="auto" className="text-[13px] font-bold text-ink">
                  {withoutFnd(m.name) || m.name}
                  {id && id === fnd ? <span className="ms-1 text-[11px] text-brand">({t('أنا')})</span> : null}
                </span>
                <span className="text-[11px] text-muted">
                  {t(m.role)}
                  {state ? ` · ${t(state)}` : ''}
                  {joinOf(details, m.name.trim()) ? ` · ${t('انضم')} ${joinOf(details, m.name.trim())}` : ''}
                  {leaveOf(details, m.name.trim()) ? ` · ${t('غادر')} ${leaveOf(details, m.name.trim())}` : ''}
                </span>
              </div>
            )
          })}
        </Block>
      )}
      {isCircle ? (
        <CircleView
          details={details}
          names={names}
          cur={cur}
          shown={shown}
          rosca={
            writable && entry
              ? { entry, manager, fnd, myNames, currency: String(details['العملة'] ?? '').trim() || currency, onChanged: (m) => onChanged?.(m) }
              : undefined
          }
        />
      ) : (
        <LedgerView
          details={details}
          names={names}
          cur={cur}
          shown={shown}
          actions={actions}
          onDecide={(kind, id, label, approve) => {
            setError('')
            setDeciding({ kind, id, label, approve })
          }}
        />
      )}
      <Confirm
        open={!!deciding}
        title={deciding?.approve ? 'موافقة' : 'رفض'}
        message={`«${deciding?.label ?? ''}» — ${t(
          deciding?.kind === 'expense'
            ? deciding?.approve
              ? 'هل تريد الموافقة على المصروف؟'
              : 'هل تريد رفض المصروف؟'
            : deciding?.approve
              ? 'هل تريد الموافقة على الميزانية الإضافية؟'
              : 'هل تريد رفض الميزانية الإضافية؟',
        )}`}
        confirmLabel={deciding?.approve ? 'موافقة' : 'رفض'}
        danger={deciding?.approve === false}
        busy={busy}
        error={error}
        onConfirm={runDecision}
        onCancel={() => setDeciding(null)}
      />
      <Confirm
        open={!!removingExpense}
        title="حذف المصروف"
        message={`«${removingExpense?.label ?? ''}» — ${t('سيُحذف وتتغيّر الأرصدة تبعًا له. هل تريد الحذف؟')}`}
        confirmLabel="حذف"
        danger
        busy={busy}
        error={error}
        onConfirm={async () => {
          if (!entry || !removingExpense) return
          setBusy(true)
          setError('')
          try {
            await deleteSharedExpense(entry, removingExpense.id, fnd, myNames)
            await qc.invalidateQueries({ queryKey: ['shared'] })
            setRemovingExpense(null)
            onChanged?.('تم حذف المصروف')
          } catch (e) {
            setError(e instanceof SharedError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
          } finally {
            setBusy(false)
          }
        }}
        onCancel={() => setRemovingExpense(null)}
      />
      {entry && <SharedSimpleSections entry={entry} onChanged={(m) => onChanged?.(m)} />}
      {entry && budgetOpen && (
        <BudgetForm
          entry={entry}
          members={names}
          cur={cur}
          shown={shown}
          fnd={fnd}
          myNames={myNames}
          publicName={shownName}
          manager={manager}
          onClose={() => setBudgetOpen(false)}
          onDone={(message) => {
            setBudgetOpen(false)
            onChanged?.(message)
          }}
        />
      )}
      {entry && settleOpen && (
        <SettleForm
          entry={entry}
          details={details}
          names={names}
          cur={cur}
          shown={shown}
          onClose={() => setSettleOpen(false)}
          onDone={(message) => {
            setSettleOpen(false)
            onChanged?.(message)
          }}
        />
      )}
    </div>
  )
}

/** زر إرفاق صورة الإيصال/الفاتورة (يُرفع عند الحفظ). */
export function ReceiptPicker({ file, onChange, label }: { file: File | null; onChange: (f: File | null) => void; label: string }) {
  const { t } = useI18n()
  return (
    <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-field border border-brand px-3 text-[13px] font-extrabold text-brand hover:bg-brand-soft">
      <Paperclip className="size-4" />
      <span className="truncate">{file ? file.name : t(label)}</span>
      {file && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onChange(null)
          }}
          aria-label={t('إزالة')}
        >
          <X className="size-4" />
        </button>
      )}
      <input
        type="file"
        className="hidden"
        accept="image/*,application/pdf"
        onChange={async (e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          const named = await namedFile(picked)
          if (named) onChange(named)
        }}
      />
    </label>
  )
}

/** «تسوية الحساب» (_openSettleUpSheet): التحويلات المقترحة، وتسجيل تحويلات الأعضاء المختارين. */
export function SettleForm({
  entry,
  details,
  names,
  cur,
  shown,
  onClose,
  onDone,
}: {
  entry: Entry
  details: Record<string, unknown>
  names: string[]
  cur: string
  shown: (n: string) => string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const transfers = settleTransfers(details, names)
  const involves = (tr: { from: string; to: string }, n: string) => tr.from === n || tr.to === n
  const involved = names.filter((n) => transfers.some((tr) => involves(tr, n)))
  const [picked, setPicked] = useState<Set<string>>(() => new Set(involved))
  const [file, setFile] = useState<File | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = transfers.filter((tr) => [...picked].some((n) => involves(tr, n)))

  async function save() {
    setBusy(true)
    setError('')
    try {
      const receipt = file ? await uploadDeviceFile(file) : ''
      const fully = await recordSettlements(entry, [...picked], transfers, receipt)
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setConfirming(false)
      onDone(fully ? 'تمت تسوية الحساب بالكامل — الحالة: مكتملة' : 'تم تسجيل التسوية')
    } catch (e) {
      setError(e instanceof SharedError || e instanceof FileError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  // مستند التسوية PDF رسميًا (_shareSettlementPdf) للتحويلات المختارة بتاريخ اليوم.
  const pdf = useRecordShare()
  const today = new Date()
  const sharePdf = () =>
    pdf.start(() => settlementDoc(entry, selected, `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`, { t, currency: cur, memberList: names }), false)

  return (
    <Sheet open onClose={onClose}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[18px] font-extrabold text-title">{t('تسوية الحساب')}</p>
        <button type="button" onClick={sharePdf} title={t('مشاركة كمستند PDF')} aria-label={t('مشاركة كمستند PDF')} className="grid size-9 place-items-center rounded-full bg-surface text-brand hover:bg-line">
          <FileText className="size-4" />
        </button>
      </div>
      {pdf.ui}
      {transfers.length === 0 ? (
        <p className="mt-4 rounded-inner bg-brand-soft px-4 py-3 text-[13px] font-bold text-brand">{t('الحساب مسوّى — لا توجد مبالغ معلّقة بين الأعضاء')}</p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2 rounded-inner bg-surface p-2">
            {transfers.map((tr, i) => (
              <div key={i} className={`card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px] ${selected.includes(tr) ? '' : 'opacity-50'}`}>
                <span dir="auto" className="text-ink">
                  <b>{shown(tr.from)}</b> {t('يدفع إلى')} <b>{shown(tr.to)}</b>
                </span>
                <span className="font-bold text-gold-dark">{money(tr.amount, cur)}</span>
              </div>
            ))}
          </div>
          <p className="mb-1.5 mt-4 text-[12px] font-extrabold text-title">{t('الأعضاء')}</p>
          <div className="flex flex-wrap gap-2">
            {involved.map((n) => {
              const on = picked.has(n)
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    const next = new Set(picked)
                    if (on) next.delete(n)
                    else next.add(n)
                    setPicked(next)
                  }}
                  className={`h-9 rounded-full px-3 text-[12px] font-bold ${on ? 'bg-brand-soft text-brand' : 'bg-field text-sub'}`}
                >
                  {on ? '✓ ' : ''}
                  {shown(n)}
                </button>
              )
            })}
          </div>
          <div className="mt-4">
            <ReceiptPicker file={file} onChange={setFile} label="إرفاق إيصال" />
          </div>
          {error && !confirming && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
          <button
            type="button"
            disabled={!selected.length}
            onClick={() => {
              setError('')
              setConfirming(true)
            }}
            className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {t('تسجيل التسوية')} ({selected.length})
          </button>
        </>
      )}
      <Confirm open={confirming} title="تأكيد" message={t('هل تريد تسجيل التسوية؟')} busy={busy} error={error} onConfirm={save} onCancel={() => setConfirming(false)} />
    </Sheet>
  )
}

/** «ميزانية إضافية» (_openContributionForm): من المسؤول معتمدة، ومن العضو بصورة الإيصال وبانتظار الموافقة. */
function BudgetForm({
  entry,
  members,
  cur,
  shown,
  fnd,
  myNames,
  publicName,
  manager,
  onClose,
  onDone,
}: {
  entry: Entry
  members: string[]
  cur: string
  shown: (n: string) => string
  fnd: string
  myNames: string[]
  publicName: string
  manager: boolean
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const now = new Date()
  const [file, setFile] = useState<File | null>(null)
  const [member, setMember] = useState(members[0] ?? '')
  const [amountText, setAmountText] = useState('')
  const [dateValue, setDateValue] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const amount = parseMoney(amountText)
  const [y, m, d] = dateValue.split('-').map((x) => parseInt(x, 10))
  const dmy = dateValue ? `${d}/${m}/${y}` : ''
  const fieldClass = 'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none focus:border-gold'

  async function save() {
    setBusy(true)
    setError('')
    try {
      const receipt = file ? await uploadDeviceFile(file) : ''
      const status = await addContribution(entry, member, amount, dmy, note, fnd, myNames, publicName, receipt)
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setConfirming(false)
      const added = `${shown(member)} ${t('أضاف')} ${money(amount, cur)} ${t('كميزانية إضافية')}`
      onDone(status === 'معتمد' ? added : `${added} — ${t('أُرسلت لموافقة المسؤول')}`)
    } catch (e) {
      setError(e instanceof SharedError || e instanceof FileError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t('ميزانية إضافية')}</p>
      <p className="mt-0.5 text-[12px] text-muted">{t('دفعة فوق المساهمة الأساسية حين لا تكفي الميزانية')}</p>
      <p className="mb-1.5 mt-4 text-[12px] font-extrabold text-title">{t('من دفع المساهمة؟ *')}</p>
      <div className="flex flex-wrap gap-2">
        {members.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setMember(n)}
            className={`h-9 rounded-full px-3 text-[12px] font-bold ${member === n ? 'bg-brand-soft text-brand' : 'bg-field text-sub'}`}
          >
            {shown(n)}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">
            {t('المبلغ')} * ({t(cur)})
          </span>
          <input dir="ltr" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('التاريخ')}</span>
          <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} className={fieldClass} />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('ملاحظة')}</span>
          <textarea rows={2} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} h-auto py-3`} />
        </label>
        <div className="col-span-2">
          <ReceiptPicker file={file} onChange={setFile} label={manager ? 'إرفاق صورة الإيصال' : 'إرفاق صورة الإيصال *'} />
        </div>
      </div>
      {error && !confirming && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        onClick={() => {
          if (amount <= 0) {
            setError('اكتب مبلغ المساهمة')
            return
          }
          if (!manager && !file) {
            setError('أرفق صورة الإيصال أو الفاتورة لإثبات المبلغ')
            return
          }
          setError('')
          setConfirming(true)
        }}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t('حفظ المساهمة')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد"
        message={`${t('هل تريد تسجيل')}: ${shown(member)} ${t('أضاف')} ${money(amount, cur)} ${t('كميزانية إضافية')}؟`}
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  )
}

function DecideButtons({ onApprove, onReject }: { onApprove: () => void; onReject: () => void }) {
  const { t } = useI18n()
  return (
    <span className="mt-1.5 flex gap-2">
      <button type="button" onClick={onApprove} className="flex h-8 items-center gap-1 rounded-inner bg-brand px-3 text-[12px] font-extrabold text-white hover:bg-brand-dark">
        <Check className="size-3.5" />
        {t('موافقة')}
      </button>
      <button type="button" onClick={onReject} className="flex h-8 items-center gap-1 rounded-inner bg-danger-soft px-3 text-[12px] font-extrabold text-danger hover:bg-danger/15">
        <X className="size-3.5" />
        {t('رفض')}
      </button>
    </span>
  )
}

type RoscaActions = { entry: Entry; manager: boolean; fnd: string; myNames: string[]; currency: string; onChanged: (message: string) => void }

type RoscaTask =
  | { kind: 'markAll'; index: number; count: number }
  | { kind: 'delete'; index: number; id: string; label: string }
  | { kind: 'cancelPayout'; index: number }
  | { kind: 'receiver'; index: number; picked: string; other: number | null; old: string }

function CircleView({
  details,
  names,
  cur,
  shown,
  rosca,
}: {
  details: Record<string, unknown>
  names: string[]
  cur: string
  shown: (n: string) => string
  rosca?: RoscaActions
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [form, setForm] = useState<{ index: number; member?: string; pickCycle: boolean } | null>(null)
  const [task, setTask] = useState<RoscaTask | null>(null)
  const [payout, setPayout] = useState<number | null>(null)
  const [receiverFor, setReceiverFor] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const plan = roscaPlan(details, names)
  if (!plan.cycles.length) return null
  const today = startOfToday()

  async function runTask() {
    if (!rosca || !task) return
    setBusy(true)
    setError('')
    try {
      if (task.kind === 'markAll') await roscaMarkAllPaid(rosca.entry, task.index)
      else if (task.kind === 'delete') await deleteRoscaPayment(rosca.entry, task.index, task.id, rosca.fnd, rosca.myNames)
      else if (task.kind === 'receiver') await roscaChangeReceiver(rosca.entry, task.index, task.picked, { me: rosca.fnd, myNames: rosca.myNames, tr: t })
      else await roscaTogglePayout(rosca.entry, task.index, { cancel: true, recordUnpaid: false, me: rosca.fnd, myNames: rosca.myNames, currency: rosca.currency, tr: t })
      await qc.invalidateQueries({ queryKey: ['shared'] })
      rosca.onChanged(task.kind === 'markAll' ? 'تم تسجيل سداد الجميع بنجاح' : task.kind === 'delete' ? 'تم حذف المساهمة بنجاح' : task.kind === 'receiver' ? 'تم تغيير الدور بنجاح' : 'تم تحديث تسليم الدورة بنجاح')
      setTask(null)
    } catch (e) {
      setError(e instanceof SharedError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  const smallButton = 'flex h-10 flex-1 items-center justify-center gap-1.5 rounded-field text-[12.5px] font-extrabold disabled:opacity-50'
  const wideButton = 'flex h-10 w-full items-center justify-center gap-1.5 rounded-field text-[12.5px] font-extrabold'
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Stat label="المساهمة على الشخص" value={money(plan.share, cur)} />
        <Stat label="تكرار المساهمة" value={t(plan.frequency)} />
        <Stat label="الدورة الجارية" value={plan.current ? `${plan.current.index} / ${plan.cycles.length}` : t('مكتملة')} />
        <Stat
          label="المستلم الحالي"
          value={plan.current ? shown(plan.current.receiver) || '—' : '—'}
        />
      </div>
      {rosca && (
        <button
          type="button"
          onClick={() => setForm({ index: plan.current?.index ?? 1, pickCycle: true })}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-field bg-brand text-[13.5px] font-extrabold text-white hover:bg-brand-dark"
        >
          <PlusCircle className="size-4" />
          {t('تسجيل مساهمة')}
        </button>
      )}
      <Block title="الدورات" count={plan.cycles.length}>
        {plan.cycles.map((c) => {
          const status = cycleStatus(plan, c, today)
          return (
            <details key={c.index} className="card-inner px-3 py-2" open={plan.current?.index === c.index}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-extrabold text-title">
                  {t('الدورة رقم')} {c.index}
                  {c.receiver ? <span className="font-bold text-sub"> — {shown(c.receiver)}</span> : null}
                </span>
                <span className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted">{c.dueDate ? date(c.dueDate) : '—'}</span>
                  <span className="rounded-full px-2 py-0.5 font-bold text-white" style={{ background: STATUS_COLOR[status] }}>
                    {t(status)}
                  </span>
                </span>
              </summary>
              <p className="mt-1 text-[11px] text-sub">
                {t('المحصّل')}: {money(cycleCollected(c), cur)} / {money(cycleTarget(c), cur)}
                {c.payoutDate ? ` · ${t('سُلّم المبلغ')}: ${c.payoutDate}` : ''}
              </p>
              {c.payments.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">
                  {c.payments.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="font-bold text-ink">{shown(p.member)}</span>
                      <span className="text-muted">{p.date}</span>
                      <span className="font-bold text-brand">{money(p.amount, cur)}</span>
                      {p.receipt && <FileButton file={{ localPath: p.receipt }} label="الإيصال" />}
                      {rosca?.manager && (
                        <button
                          type="button"
                          aria-label={t('حذف المساهمة')}
                          onClick={() => {
                            setError('')
                            setTask({ kind: 'delete', index: c.index, id: p.id, label: `${shown(p.member)} · ${money(p.amount, cur)}` })
                          }}
                          className="grid size-7 place-items-center rounded-inner text-danger hover:bg-danger-soft"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {rosca && (
                <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
                  {names.map((n) => (
                    <div key={n} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                      <span className="flex items-center gap-1.5 font-bold text-ink">
                        {shown(n)}
                        {c.receiver === n && <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-extrabold text-gold-dark">{t('صاحب الدور')}</span>}
                      </span>
                      {memberPaid(c, n) ? (
                        <span className="font-extrabold text-brand-mid">{money(paidBy(c, n), cur)}</span>
                      ) : (
                        <button type="button" onClick={() => setForm({ index: c.index, member: n, pickCycle: false })} className="h-7 rounded-inner px-2 text-[12px] font-extrabold text-brand hover:bg-brand-soft">
                          {t('تسجيل دفع')}
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="mt-1.5 flex gap-2">
                    <button type="button" onClick={() => setForm({ index: c.index, pickCycle: false })} className={`${smallButton} bg-brand text-white hover:bg-brand-dark`}>
                      <PlusCircle className="size-4" />
                      {t('تسجيل مساهمة')}
                    </button>
                    <button
                      type="button"
                      disabled={names.every((n) => memberPaid(c, n))}
                      onClick={() => {
                        setError('')
                        setTask({ kind: 'markAll', index: c.index, count: names.filter((n) => !memberPaid(c, n)).length })
                      }}
                      className={`${smallButton} border border-hairline bg-white text-title hover:bg-surface`}
                    >
                      <CheckCheck className="size-4" />
                      {t('سدّد الجميع')}
                    </button>
                  </div>
                  {rosca.manager &&
                    (c.payoutDate ? (
                      <button
                        type="button"
                        onClick={() => {
                          setError('')
                          setTask({ kind: 'cancelPayout', index: c.index })
                        }}
                        className={`${wideButton} mt-1 border border-hairline bg-white text-danger hover:bg-danger-soft`}
                      >
                        <Undo2 className="size-4" />
                        {t('إلغاء التسليم')}
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={() => setPayout(c.index)} className={`${wideButton} mt-1 bg-brand-mid text-white hover:bg-brand`}>
                          <Gift className="size-4" />
                          {t('تسليم المبلغ لصاحب الدور')}
                        </button>
                        <button type="button" onClick={() => setReceiverFor(c.index)} className={`${wideButton} border border-hairline bg-white text-title hover:bg-surface`}>
                          <Repeat className="size-4" />
                          {t('تغيير الدور')}
                        </button>
                      </>
                    ))}
                </div>
              )}
            </details>
          )
        })}
      </Block>
      {rosca && form && (
        <RoscaPaymentForm
          entry={rosca.entry}
          details={details}
          names={names}
          cur={cur}
          shown={shown}
          startIndex={form.index}
          member={form.member}
          pickCycle={form.pickCycle}
          onClose={() => setForm(null)}
          onDone={(message) => {
            setForm(null)
            rosca.onChanged(message)
          }}
        />
      )}
      {rosca && payout !== null && (
        <PayoutDialog
          rosca={rosca}
          details={details}
          index={payout}
          cur={cur}
          shown={shown}
          onClose={() => setPayout(null)}
          onDone={(message) => {
            setPayout(null)
            rosca.onChanged(message)
          }}
        />
      )}
      <Sheet open={receiverFor !== null} onClose={() => setReceiverFor(null)}>
        {receiverFor !== null && (
          <div>
            <p className="text-[17px] font-extrabold text-title">{t('تغيير الدور: اختر صاحب الدور الجديد')}</p>
            <div className="mt-3 flex flex-col gap-2">
              {names.map((n) => {
                const turn = plan.cycles.find((c) => c.receiver === n)
                const current = plan.cycles.find((c) => c.index === receiverFor)
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={current?.receiver === n}
                    onClick={() => {
                      setError('')
                      setReceiverFor(null)
                      setTask({ kind: 'receiver', index: receiverFor, picked: n, other: turn && turn.index !== receiverFor ? turn.index : null, old: current?.receiver ?? '' })
                    }}
                    className="card-inner flex items-center justify-between px-3 py-2.5 text-start text-[13px] font-bold text-ink hover:bg-line/60 disabled:opacity-50"
                  >
                    <span>{shown(n)}</span>
                    <span className="text-[11px] text-muted">
                      {t('الدورة رقم')}: {turn?.index ?? '—'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Sheet>
      <Confirm
        open={!!task}
        title={task?.kind === 'markAll' ? 'تسجيل سداد الجميع' : task?.kind === 'delete' ? 'حذف المساهمة' : task?.kind === 'receiver' ? 'تغيير الدور' : 'إلغاء التسليم'}
        message={
          task?.kind === 'markAll'
            ? `${t('سيُسجَّل')} ${task.count} ${t('عضوًا كمن سدّدوا حصتهم في الدورة')} ${task.index}.`
            : task?.kind === 'delete'
              ? `${t('سيُحذف سداد')} ${task.label} ${t('من الدورة')} ${task.index}.`
              : task?.kind === 'receiver'
                ? task.other !== null && task.old
                  ? `${shown(task.picked)} ← ${t('صاحب الدورة')} ${task.index}، ${shown(task.old)} ← ${t('صاحب الدورة')} ${task.other}`
                  : `${shown(task.picked)} ← ${t('صاحب الدورة')} ${task.index}`
                : `${t('سيُلغى تسجيل تسليم مبلغ الدورة')} ${task?.index ?? ''}.`
        }
        confirmLabel={task?.kind === 'markAll' ? 'تسجيل' : task?.kind === 'delete' ? 'حذف' : task?.kind === 'receiver' ? 'تأكيد' : 'إلغاء التسليم'}
        danger={task?.kind === 'delete' || task?.kind === 'cancelPayout'}
        busy={busy}
        error={error}
        onConfirm={runTask}
        onCancel={() => setTask(null)}
      />
    </>
  )
}

const restText = (v: number) => (v > 0 ? v.toFixed(v % 1 === 0 ? 0 : 2) : '')

/** _openRoscaPaymentForm: مساهمة عضو في دورة (يختارها عند الإضافة العامة). */
function RoscaPaymentForm({
  entry,
  details,
  names,
  cur,
  shown,
  startIndex,
  member,
  pickCycle,
  onClose,
  onDone,
}: {
  entry: Entry
  details: Record<string, unknown>
  names: string[]
  cur: string
  shown: (n: string) => string
  startIndex: number
  member?: string
  pickCycle: boolean
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const plan = roscaPlan(details, names)
  const cycleAt = (i: number) => plan.cycles.find((c) => c.index === i)
  const restOf = (i: number, n: string) => {
    const c = cycleAt(i)
    return c ? cycleShareOf(c, n) - paidBy(c, n) : plan.share
  }
  const first = cycleAt(startIndex)
  const unpaid = first ? names.filter((n) => !memberPaid(first, n)) : names
  const now = new Date()
  const [index, setIndex] = useState(startIndex)
  const [payer, setPayer] = useState(member ?? unpaid[0] ?? names[0] ?? '')
  const [amountText, setAmountText] = useState(() => restText(restOf(startIndex, member ?? unpaid[0] ?? names[0] ?? '')))
  const [dateValue, setDateValue] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const amount = parseMoney(amountText)
  const [y, m, d] = dateValue.split('-').map((x) => parseInt(x, 10))
  const dmy = dateValue ? `${d}/${m}/${y}` : `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`
  const fieldClass = 'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none focus:border-gold'
  const chip = (on: boolean) => `h-9 rounded-full px-3 text-[12px] font-bold ${on ? 'bg-brand-soft text-brand' : 'bg-field text-sub'}`
  const current = cycleAt(index)

  async function save() {
    setBusy(true)
    setError('')
    try {
      const receipt = file ? await uploadDeviceFile(file) : ''
      await addRoscaPayment(entry, index, payer, amount, dmy, note, receipt)
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setConfirming(false)
      onDone('تم تسجيل المساهمة بنجاح')
    } catch (e) {
      setError(e instanceof SharedError || e instanceof FileError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">
        {t('تسجيل مساهمة')} — {t('الدورة')} {index}
      </p>
      {pickCycle && (
        <>
          <p className="mb-1.5 mt-4 text-[12px] font-extrabold text-title">{t('لأي دورة هذا الدفع؟ *')}</p>
          <div className="flex flex-wrap gap-2">
            {plan.cycles.map((c) => (
              <button
                key={c.index}
                type="button"
                onClick={() => {
                  setIndex(c.index)
                  setAmountText(restText(restOf(c.index, payer)))
                }}
                className={chip(index === c.index)}
              >
                {t('الدورة')} {c.index}
                {c.receiver.trim() ? ` — ${shown(c.receiver)}` : ''}
                {c.payoutDate || cycleComplete(c) ? ' ✓' : ''}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="mb-1.5 mt-4 text-[12px] font-extrabold text-title">{t('من العضو؟')}</p>
      <div className="flex flex-wrap gap-2">
        {names.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              setPayer(n)
              setAmountText(restText(restOf(index, n)))
            }}
            className={chip(payer === n)}
          >
            {shown(n)}
            {current && memberPaid(current, n) ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">
            {t('المبلغ')} * ({t(cur)})
          </span>
          <input dir="ltr" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('التاريخ')}</span>
          <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} className={fieldClass} />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('ملاحظة')}</span>
          <textarea rows={2} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} h-auto py-3`} />
        </label>
        <div className="col-span-2">
          <ReceiptPicker file={file} onChange={setFile} label="إرفاق مستند" />
        </div>
      </div>
      {error && !confirming && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        onClick={() => {
          if (amount <= 0) {
            setError('اكتب مبلغ المساهمة')
            return
          }
          setError('')
          setConfirming(true)
        }}
        className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t('حفظ المساهمة')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد"
        message={`${shown(payer)} · ${money(amount, cur)} · ${t('الدورة')} ${index} — ${t('هل تريد تسجيل المساهمة؟')}`}
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  )
}

/**
  _roscaTogglePayout و _roscaPayoutUnpaidChoice: تسليم مبلغ الدورة لصاحب
  الدور. إن بقي من لم يسدّد: تسجيل مساهماتهم مع التسليم، أو التسليم مع
  بقاء ما عليهم.
*/
function PayoutDialog({
  rosca,
  details,
  index,
  cur,
  shown,
  onClose,
  onDone,
}: {
  rosca: RoscaActions
  details: Record<string, unknown>
  index: number
  cur: string
  shown: (n: string) => string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const plan = roscaPlan(details, memberNames(details))
  const cycle = plan.cycles.find((c) => c.index === index)
  let unpaid: { member: string; rest: number }[] = []
  let totalAmount = 0
  try {
    unpaid = payoutUnpaid(details, index)
    totalAmount = roscaCycleTotal(details, index)
  } catch {
    // الدورة لم تعد موجودة: يظهر الخطأ عند الحفظ.
  }
  const now = new Date()
  const noReceiver = !cycle?.receiver.trim()

  async function go(recordUnpaid: boolean) {
    setBusy(true)
    setError('')
    try {
      await roscaTogglePayout(rosca.entry, index, { cancel: false, recordUnpaid, me: rosca.fnd, myNames: rosca.myNames, currency: rosca.currency, tr: t })
      await qc.invalidateQueries({ queryKey: ['shared'] })
      onDone('تم تحديث تسليم الدورة بنجاح')
    } catch (e) {
      setError(e instanceof SharedError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  const button = 'flex h-11 w-full items-center justify-center rounded-field text-[13.5px] font-extrabold disabled:opacity-60'
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-deep/40 p-4" onClick={busy ? undefined : onClose}>
      <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-card bg-white p-5 shadow-2xl">
        <p className="text-[17px] font-extrabold text-title">{t('تسليم المبلغ')}</p>
        {noReceiver ? (
          <p className="mt-2 text-[13px] text-sub">{t('حدّد صاحب الدور أولًا')}</p>
        ) : (
          <div dir="auto" className="mt-2 text-[13px] leading-relaxed text-sub">
            <p>
              {t('سيتم تسجيل استلام')} {money(totalAmount, cur)} {t('إلى')} {shown(cycle?.receiver ?? '')}
            </p>
            <p>
              {t('الدورة رقم')}: {index}
            </p>
            <p>
              {t('تاريخ استلام المبلغ')}: {`${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`}
            </p>
            {unpaid.length > 0 && (
              <>
                <p className="mt-3 font-extrabold text-title">{t('لم تُسجَّل مساهمة هؤلاء في هذه الدورة:')}</p>
                {unpaid.map((u) => (
                  <p key={u.member}>
                    • {shown(u.member)}: {money(u.rest, cur)}
                  </p>
                ))}
              </>
            )}
          </div>
        )}
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="mt-5 flex flex-col gap-2">
          {!noReceiver &&
            (unpaid.length === 0 ? (
              <button type="button" disabled={busy} onClick={() => go(false)} className={`${button} bg-brand text-white hover:bg-brand-dark`}>
                {t('تأكيد التسليم')}
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => go(true)} className={`${button} bg-brand text-white hover:bg-brand-dark`}>
                  {t('تسجيل مساهماتهم والتسليم')}
                </button>
                <button type="button" disabled={busy} onClick={() => go(false)} className={`${button} border border-brand text-brand hover:bg-brand-soft`}>
                  {t('تسليم مع بقاء ما عليهم')}
                </button>
              </>
            ))}
          <button type="button" disabled={busy} onClick={onClose} className={`${button} bg-surface font-bold text-body hover:bg-line`}>
            {t('إلغاء')}
          </button>
        </div>
      </div>
    </div>
  )
}

function LedgerView({
  details,
  names,
  cur,
  shown,
  actions,
  onDecide,
}: {
  details: Record<string, unknown>
  names: string[]
  cur: string
  shown: (n: string) => string
  actions?: LedgerActions
  onDecide: (kind: 'expense' | 'contribution', id: string, label: string, approve: boolean) => void
}) {
  const { t } = useI18n()
  // القوائم تُعرض الأحدث أولًا (تُحفظ ملحقة بآخرها).
  const all = expenses(details)
  const contribs = contributions(details)
  const settles = settlements(details)
  if (!all.length && !contribs.length && !settles.length && !hasBudget(details)) return null
  const addBudget = actions?.addBudget
  const settle = actions?.settle
  const spent = total(details)
  const nets = memberNets(details, names)
  const transfers = settleTransfers(details, names)
  const pending = transfers.length > 0
  const byCategory = totalsByCategory(details)

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="إجمالي المصروفات" value={money(spent, cur)} />
        {hasBudget(details) && <Stat label="الميزانية" value={money(budget(details), cur)} />}
        {hasBudget(details) && (
          <Stat label="المتبقي" value={money(remaining(details), cur)} color={remaining(details) < -0.01 ? '#C4392E' : '#0A5A50'} />
        )}
      </div>
      {(addBudget || (settle && pending)) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {settle && pending && (
            <button
              type="button"
              onClick={settle}
              className="flex h-10 items-center gap-1.5 rounded-inner bg-brand px-3 text-[12px] font-extrabold text-white hover:bg-brand-dark"
            >
              <Handshake className="size-4" />
              {t('تسوية الحساب')}
            </button>
          )}
          {addBudget && (
            <button
              type="button"
              onClick={addBudget}
              className="flex h-10 items-center gap-1.5 rounded-inner border border-line bg-white px-3 text-[12px] font-extrabold text-brand hover:bg-brand-soft"
            >
              <PlusCircle className="size-4" />
              {t('ميزانية إضافية')}
            </button>
          )}
        </div>
      )}

      {byCategory.length > 0 && (
        <Block title="المصروفات حسب التصنيف">
          {byCategory.map(([cat, v]) => (
            <div key={cat} className="card-inner flex items-center justify-between px-3 py-2 text-[12px]">
              <span className="font-bold text-ink">{t(cat)}</span>
              <span className="text-sub">{money(v, cur)}</span>
            </div>
          ))}
        </Block>
      )}

      {Object.keys(nets).length > 0 && (
        <Block title="الأرصدة">
          {Object.entries(nets).map(([name, v]) => (
            <div key={name} className="card-inner flex items-center justify-between px-3 py-2 text-[12px]">
              <span dir="auto" className="font-bold text-ink">
                {shown(name)}
              </span>
              <span className="font-bold" style={{ color: v > 0.01 ? '#0A5A50' : v < -0.01 ? '#C4392E' : '#8C9A97' }}>
                {v > 0.01 ? `${t('له')} ${money(v, cur)}` : v < -0.01 ? `${t('عليه')} ${money(-v, cur)}` : t('متعادل')}
              </span>
            </div>
          ))}
        </Block>
      )}

      {transfers.length > 0 && (
        <Block title="التسوية المقترحة" count={transfers.length}>
          {transfers.map((tr, i) => (
            <div key={i} className="card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
              <span dir="auto" className="text-ink">
                <b>{shown(tr.from)}</b> {t('يدفع إلى')} <b>{shown(tr.to)}</b>
              </span>
              <span className="font-bold text-gold-dark">{money(tr.amount, cur)}</span>
            </div>
          ))}
        </Block>
      )}

      {all.length > 0 && (
        <Block title="المصروفات" count={all.length}>
          {[...all].reverse().map((e) => (
            <div key={e.id} className="card-inner px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span dir="auto" className="font-bold text-ink">
                  {e.description || t('مصروف')}
                </span>
                <span className="font-bold text-ink">{money(e.amount, cur)}</span>
              </div>
              <p className="text-[11px] text-muted">
                {t('دفع')}: {shown(e.payer)} · {e.date} · {t(e.category)} · {t(e.method)}
                {e.status !== 'معتمد' && <span className={e.status === PENDING ? 'font-bold text-gold-dark' : 'font-bold text-danger'}> · {t(e.status)}</span>}
              </p>
              {e.receipt && <FileButton className="mt-1" file={{ localPath: e.receipt }} label="الفاتورة" />}
              {actions?.manager && e.status === PENDING && (
                <DecideButtons
                  onApprove={() => onDecide('expense', e.id, e.description || t('مصروف'), true)}
                  onReject={() => onDecide('expense', e.id, e.description || t('مصروف'), false)}
                />
              )}
              {actions?.deleteExpense && actions.canDelete?.(e) && (
                <button
                  type="button"
                  onClick={() => actions.deleteExpense?.(e.id, e.description || t('مصروف'))}
                  className="mt-1 flex items-center gap-1 text-[11.5px] font-extrabold text-danger"
                >
                  <Trash2 className="size-3.5" />
                  {t('حذف المصروف')}
                </button>
              )}
            </div>
          ))}
        </Block>
      )}

      {contribs.length > 0 && (
        <Block title="المساهمات" count={contribs.length}>
          {[...contribs].reverse().map((c) => (
            <div key={c.id} className="card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
              <span className="font-bold text-ink">{shown(c.member)}</span>
              <span className="text-muted">{c.date}</span>
              <span className="font-bold text-brand">
                {money(c.amount, cur)}
                {c.status !== 'معتمد' ? ` · ${t(c.status)}` : ''}
              </span>
              {c.receipt && <FileButton file={{ localPath: c.receipt }} label="الإيصال" />}
              {actions?.manager && c.status === PENDING && (
                <span className="w-full">
                  <DecideButtons
                    onApprove={() => onDecide('contribution', c.id, `${shown(c.member)} — ${money(c.amount, cur)}`, true)}
                    onReject={() => onDecide('contribution', c.id, `${shown(c.member)} — ${money(c.amount, cur)}`, false)}
                  />
                </span>
              )}
            </div>
          ))}
        </Block>
      )}

      {settles.length > 0 && (
        <Block title="التسويات" count={settles.length}>
          {[...settles].reverse().map((s) => (
            <div key={s.id} className="card-inner flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
              <span dir="auto" className="text-ink">
                <b>{shown(s.from)}</b> {t('دفع إلى')} <b>{shown(s.to)}</b>
              </span>
              <span className="text-muted">{s.date}</span>
              <span className="font-bold text-brand">{money(s.amount, cur)}</span>
              {s.receipt && <FileButton file={{ localPath: s.receipt }} label="الإيصال" />}
            </div>
          ))}
        </Block>
      )}
    </>
  )
}
