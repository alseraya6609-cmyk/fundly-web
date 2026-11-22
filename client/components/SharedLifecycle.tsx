import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, History, Loader2, LogOut, PlaneTakeoff, Trash2, Undo2, UserPlus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { ENTRY_COLUMNS, useStore, type Entry } from '@/lib/data'
import { supabase, errorText } from '@/lib/supabase'
import { publicName as publicNameOf } from '@/lib/requestsWrite'
import { iAmManager, memberNames, withoutFnd } from '@/lib/shared'
import { money } from '@/lib/format'
import {
  CANCEL_REASON_KEY,
  HISTORY_KEY,
  SharedError,
  archivedForMe,
  cancelSharedForAll,
  hasUnsettled,
  isCancelledShared,
  isLumpSum,
  leaveBlocking,
  leaveCandidates,
  managerNameOf,
  markMine,
  myAccountOpen,
  myMemberName,
  purgeIfRemovedByAll,
  rawBalanceOf,
  recordMemberJoin,
  recordMemberLeave,
  removedForMe,
  setSharedArchived,
  sharedWithOthers,
} from '@/lib/sharedWrite'
import { Confirm } from './Confirm'
import { SettleForm } from './SharedDetails'
import { MemberPicker } from './SharedEditor'
import { Sheet } from './ui'

/*
  دورة حياة الالتزام المشترك كما في التطبيق (shared_commitments_screen.dart):
  _deleteFlow و_leaveCommitment و_approveCancelledDelete و_moveToHistoryInstead
  و_blockUnsettled و_archiveCommitment، وشريطا «الإلغاء» و«السجل التاريخي»،
  و«سجل تاريخي» و«المحذوفة عندي» أسفل القائمة، وانضمام عضو ومغادرته بتاريخ.
*/

const REMOVED_KEY = 'محذوف عند'
const CLOSED = ['مؤرشف', 'ملغاة', 'ملغية', 'محذوف']

/** هويتي في الالتزام: رقمي، وأسمائي، والاسم الظاهر للآخرين. */
function useMe() {
  const { profile } = useSession()
  const store = useStore()
  const fnd = profile?.fnd_id ?? ''
  const full = String(store.data?.['settings_profile_name'] ?? '').trim() || profile?.display_name || ''
  const shown = publicNameOf(store.data, profile?.display_name ?? '')
  return { fnd, myNames: [full, shown].filter(Boolean), shown }
}

const fail = (e: unknown, fallback = 'تعذّر الحفظ. حاول مرة أخرى.') => (e instanceof SharedError ? e.message : errorText(e) || fallback)

type Step = 'history' | 'reason' | 'leave' | 'approve' | 'block' | 'archive' | null

/** أزرار «أرشفة» و«حذف / مغادرة المشاركة» مع نوافذها. */
export function SharedActions({ entry, currency, onChanged }: { entry: Entry; currency: string; onChanged: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const me = useMe()
  const details = entry.details ?? {}
  const manager = iAmManager(details, me.fnd, me.myNames)
  const cancelled = isCancelledShared(entry)
  const circle = entry.entry_type === 'جمعية مالية' || entry.entry_type === 'جمعية'
  const mineArchived = archivedForMe(entry, me.fnd)
  const shared = sharedWithOthers(details, me.fnd)
  const [step, setStep] = useState<Step>(null)
  const [reason, setReason] = useState('')
  const [settling, setSettling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setStep(null)
      onChanged(message)
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }

  /** _deleteFlow */
  function startDelete() {
    setError('')
    if (cancelled && !manager) return setStep(hasUnsettled(entry) ? 'history' : 'approve')
    if (!manager) return setStep(myAccountOpen(entry, myMemberName(details, me.fnd, me.myNames)) ? 'history' : 'leave')
    if (hasUnsettled(entry)) return setStep('history')
    setReason('')
    setStep('reason')
  }

  /** المسؤول لا يؤرشف قبل التسوية (_blockUnsettled). */
  function startArchive() {
    setError('')
    if (!mineArchived && manager && hasUnsettled(entry)) return setStep('block')
    setStep('archive')
  }

  const title = entry.title
  const archiveMessage = mineArchived
    ? `${t('سيعود')} «${title}» ${t('إلى قائمتك النشطة. هل تريد المتابعة؟')}`
    : shared
      ? `«${title}» — ${t('يُؤرشف عندك وحدك ويبقى عند بقية الأعضاء، ويصلهم إشعار. هل تريد الأرشفة؟')}`
      : `«${title}» — ${t('سيختفي من الالتزامات المشتركة وتجده في «الأرشيف»، ويمكنك إخراجه لاحقًا. هل تريد الأرشفة؟')}`

  return (
    <>
      <button
        type="button"
        onClick={startArchive}
        className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-surface text-[13px] font-extrabold text-body hover:bg-line"
      >
        <Archive className="size-4" />
        {t(mineArchived ? 'إلغاء الأرشفة' : 'أرشفة')}
      </button>
      <button
        type="button"
        onClick={startDelete}
        className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-danger-soft text-[13px] font-extrabold text-danger hover:bg-danger/15"
      >
        {manager || cancelled ? <Trash2 className="size-4" /> : <LogOut className="size-4" />}
        {t(manager || cancelled ? 'حذف' : 'مغادرة المشاركة')}
      </button>

      {/* لم تتم التسوية: لا يُمسح — ينتقل للسجل التاريخي أو يُسوّى الآن. */}
      <Sheet open={step === 'history'} onClose={() => !busy && setStep(null)}>
        <p className="flex items-center gap-2 text-[18px] font-extrabold text-title">
          <History className="size-5 text-gold-dark" />
          {t('لم تتم تسوية الحساب')}
        </p>
        <p dir="auto" className="mt-3 text-[13px] leading-relaxed text-sub">
          ⚠️ {t('ما لم تتم تسويته لا يُمسح')}. {t('سينتقل')} «{title}» {t('إلى «السجل التاريخي» للمتابعة لاحقًا، حفظًا لحقوق الأعضاء')}.
        </p>
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(async () => void (await markMine(entry, HISTORY_KEY, me.fnd, true)), 'نُقل الالتزام إلى «السجل التاريخي» — تجده أسفل قائمة الالتزامات المشتركة')}
            className="flex h-12 items-center justify-center gap-2 rounded-field bg-gold-dark text-[14px] font-extrabold text-white disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('نقله للسجل التاريخي')}
          </button>
          {!circle && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep(null)
                setSettling(true)
              }}
              className="h-12 rounded-field border border-brand text-[14px] font-extrabold text-brand"
            >
              {t('تسوية الحساب')}
            </button>
          )}
        </div>
      </Sheet>

      {/* المسؤول: الحذف بسبب، ونصيحة الأرشفة. */}
      <Sheet open={step === 'reason'} onClose={() => !busy && setStep(null)}>
        <p className="text-[18px] font-extrabold text-title">{t('حذف الالتزام')}</p>
        <p className="mt-3 rounded-inner bg-gold-soft px-3 py-2.5 text-center text-[12px] font-extrabold text-gold-dark">
          ⚠️ {t('أرشف لكي تحافظ على تقاريرك، الحذف يفقدك المعلومات')}
        </p>
        <p dir="auto" className="mt-3 text-center text-[13px] leading-relaxed text-sub">
          «{title}» —{' '}
          {t(
            shared
              ? 'سيُلغى عند بقية الأعضاء ويصلهم إشعار، ويُحذف نهائيًا بعد موافقتهم جميعًا.'
              : 'سينتقل إلى «المحذوفة عندي»، ويمكنك استعادته منها.',
          )}
        </p>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('سبب الحذف *')}</span>
          <textarea
            dir="auto"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-field border border-line bg-field px-3 py-2.5 text-[13.5px] font-bold text-title outline-none focus:border-gold"
          />
        </label>
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => setSharedArchived(entry, me.fnd, true), 'تمت أرشفة الالتزام بنجاح')}
            className="flex h-12 items-center justify-center gap-1.5 rounded-field border border-line text-[14px] font-extrabold text-ink"
          >
            <Archive className="size-4" />
            {t('أرشفة')}
          </button>
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() =>
              run(
                async () => {
                  if (shared) await cancelSharedForAll(entry, me.fnd, myMemberName(details, me.fnd, me.myNames) ?? me.shown, reason, t)
                  else await markMine(entry, REMOVED_KEY, me.fnd, true)
                },
                shared ? 'أُلغي الالتزام عند الأعضاء، ويُحذف نهائيًا بعد موافقتهم' : 'نُقل الالتزام إلى «المحذوفة عندي»',
              )
            }
            className="flex h-12 items-center justify-center gap-1.5 rounded-field bg-danger text-[14px] font-extrabold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t('حذف')}
          </button>
        </div>
      </Sheet>

      <Confirm
        open={step === 'leave'}
        title="مغادرة المشاركة"
        message={`${t('هل تريد مغادرة')} «${title}»؟ ${t('يصل المسؤول وبقية الأعضاء إشعار، ويبقى سجلك عندهم.')}`}
        confirmLabel="مغادرة"
        danger
        busy={busy}
        error={error}
        onConfirm={() => run(async () => void (await markMine(entry, REMOVED_KEY, me.fnd, true)), 'غادرت الالتزام')}
        onCancel={() => setStep(null)}
      />
      <Confirm
        open={step === 'approve'}
        title="موافق على الحذف"
        message={`«${title}» — ${t('سيُحذف من عندك. الأرشفة تحافظ عليه في تقاريرك.')}`}
        confirmLabel="موافق"
        danger
        busy={busy}
        error={error}
        onConfirm={() => run(async () => void (await markMine(entry, REMOVED_KEY, me.fnd, true)), 'تم حذف الالتزام من عندك')}
        onCancel={() => setStep(null)}
      />
      <Confirm
        open={step === 'archive'}
        title={mineArchived ? 'إلغاء الأرشفة' : 'أرشفة الالتزام'}
        message={archiveMessage}
        confirmLabel="تأكيد"
        busy={busy}
        error={error}
        onConfirm={() => run(() => setSharedArchived(entry, me.fnd, !mineArchived), mineArchived ? 'تم إخراج الالتزام من الأرشيف' : 'تمت أرشفة الالتزام بنجاح')}
        onCancel={() => setStep(null)}
      />

      {/* لا أرشفة قبل التسوية للمسؤول. */}
      <Sheet open={step === 'block'} onClose={() => setStep(null)}>
        <p className="text-[18px] font-extrabold text-title">
          {t('لا يمكن')} {t('الأرشفة')} {t('قبل تسوية الحساب')}
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-sub">
          {t(circle ? 'دورات تحديد الأدوار بدأت ولم تكتمل وتُسلَّم كلها بعد.' : 'توجد مبالغ معلّقة بين الأعضاء أو في الميزانية المشتركة. سوِّ الحساب أولًا ثم احذف أو أرشف.')}
        </p>
        {!circle && (
          <button
            type="button"
            onClick={() => {
              setStep(null)
              setSettling(true)
            }}
            className="mt-5 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white"
          >
            {t('تسوية الحساب')}
          </button>
        )}
      </Sheet>

      {settling && (
        <SettleForm
          entry={entry}
          details={details}
          names={memberNames(details)}
          cur={t(String(details['العملة'] ?? '').trim() || currency)}
          shown={(n) => (n === 'الميزانية المشتركة' ? t(n) : withoutFnd(n) || n)}
          onClose={() => setSettling(false)}
          onDone={(m) => {
            setSettling(false)
            onChanged(m)
          }}
        />
      )}
    </>
  )
}

/** شريط الملغى (سببه وقرار العضو) وشريط «في السجل التاريخي». */
export function SharedBanners({ entry, onChanged }: { entry: Entry; onChanged: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const me = useMe()
  const details = entry.details ?? {}
  const manager = iAmManager(details, me.fnd, me.myNames)
  const [step, setStep] = useState<'approve' | 'history' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reason = String(details[CANCEL_REASON_KEY] ?? '').trim()
  const inHistory = !!me.fnd && String(details[HISTORY_KEY] ?? '').includes(me.fnd)

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setStep(null)
      onChanged(message)
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {isCancelledShared(entry) && (
        <div className="mt-3 rounded-inner border border-danger/35 bg-danger-soft px-3 py-2.5">
          <p className="text-[13px] font-extrabold text-danger">{t('ألغى المسؤول هذا الالتزام')}</p>
          {reason && (
            <p dir="auto" className="mt-1 text-[12px] font-bold text-title">
              {t('السبب')}: {reason}
            </p>
          )}
          {!manager && (
            <>
              <p className="mt-1 text-[11px] text-muted">{t('وافق على حذفه، أو أرشفه عندك لتحافظ عليه في تقاريرك.')}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setStep(hasUnsettled(entry) ? 'history' : 'approve')
                  }}
                  className="h-10 rounded-inner bg-danger text-[12.5px] font-extrabold text-white"
                >
                  {t('موافق على الحذف')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => setSharedArchived(entry, me.fnd, true), 'تمت أرشفة الالتزام بنجاح')}
                  className="flex h-10 items-center justify-center gap-1 rounded-inner border border-line bg-white text-[12.5px] font-extrabold text-ink"
                >
                  <Archive className="size-4" />
                  {t('أرشفة عندي')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {inHistory && (
        <div className="mt-3 flex items-center gap-2 rounded-inner bg-gold-soft px-3 py-2">
          <History className="size-4 shrink-0 text-gold-dark" />
          <p className="flex-1 text-[12px] font-extrabold text-gold-dark">{t('في السجل التاريخي — لم تتم التسوية')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => markMine(entry, HISTORY_KEY, me.fnd, false), 'أُعيد الالتزام إلى القائمة')}
            className="text-[11.5px] font-extrabold text-gold-dark underline"
          >
            {t('إعادة للقائمة')}
          </button>
        </div>
      )}
      <Confirm
        open={step === 'approve'}
        title="موافق على الحذف"
        message={`«${entry.title}» — ${t('سيُحذف من عندك. الأرشفة تحافظ عليه في تقاريرك.')}`}
        confirmLabel="موافق"
        danger
        busy={busy}
        error={error}
        onConfirm={() => run(() => markMine(entry, REMOVED_KEY, me.fnd, true), 'تم حذف الالتزام من عندك')}
        onCancel={() => setStep(null)}
      />
      <Confirm
        open={step === 'history'}
        title="لم تتم تسوية الحساب"
        message={`⚠️ ${t('ما لم تتم تسويته لا يُمسح')}. ${t('سينتقل')} «${entry.title}» ${t('إلى «السجل التاريخي» للمتابعة لاحقًا، حفظًا لحقوق الأعضاء')}.`}
        confirmLabel="نقله للسجل التاريخي"
        busy={busy}
        error={error}
        onConfirm={() => run(() => markMine(entry, HISTORY_KEY, me.fnd, true), 'نُقل الالتزام إلى «السجل التاريخي» — تجده أسفل قائمة الالتزامات المشتركة')}
        onCancel={() => setStep(null)}
      />
    </>
  )
}

/** المحذوفة عندي ولا تزال عند بقية الأعضاء (fetchRemovedByMe)، وما حذفه الجميع يُحذف من الخادم. */
export function useRemovedByMe() {
  const { user, profile } = useSession()
  const fnd = profile?.fnd_id ?? ''
  return useQuery({
    queryKey: ['shared', 'removed', user?.id, fnd],
    enabled: !!user && !!fnd,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('shared_entries').select(ENTRY_COLUMNS).order('created_at', { ascending: false })
      if (error) throw error
      const mine = ((data ?? []) as Entry[]).filter((e) => e.status !== 'محذوف' && removedForMe(e, fnd))
      const kept: Entry[] = []
      for (const e of mine) if (!(await purgeIfRemovedByAll(e).catch(() => false))) kept.push(e)
      return kept
    },
  })
}

/** «سجل تاريخي» و«المحذوفة عندي» أسفل قائمة المشتركة. */
export function SharedListFooter({ history, onOpen, onChanged }: { history: Entry[]; onOpen: (id: string) => void; onChanged: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const me = useMe()
  const removed = useRemovedByMe()
  const [sheet, setSheet] = useState<'history' | 'removed' | null>(null)
  const [restoring, setRestoring] = useState<Entry | null>(null)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const removedList = removed.data ?? []

  async function setHistory(e: Entry) {
    setBusyId(e.id)
    setError('')
    try {
      await markMine(e, HISTORY_KEY, me.fnd, false)
      await qc.invalidateQueries({ queryKey: ['shared'] })
    } catch (err) {
      setError(fail(err))
    } finally {
      setBusyId('')
    }
  }

  if (!history.length && !removedList.length) return null
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      {history.length > 0 && (
        <button type="button" onClick={() => setSheet('history')} className="flex h-9 items-center gap-1.5 rounded-full bg-gold-soft px-3 text-[12.5px] font-extrabold text-gold-dark">
          <History className="size-4" />
          {t('سجل تاريخي')} ({history.length})
        </button>
      )}
      {removedList.length > 0 && (
        <button type="button" onClick={() => setSheet('removed')} className="flex h-9 items-center gap-1.5 rounded-full bg-surface px-3 text-[12.5px] font-extrabold text-sub">
          <Trash2 className="size-4" />
          {t('المحذوفة عندي')} ({removedList.length})
        </button>
      )}
      <Sheet open={sheet === 'history'} onClose={() => setSheet(null)}>
        <p className="text-[18px] font-extrabold text-title">{t('سجل تاريخي')}</p>
        <p className="mt-0.5 text-[12px] text-muted">{t('ما حُذف ولم تتم تسويته — يُفتح لمتابعته وتسويته، أو يُعاد إلى القائمة.')}</p>
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <div className="mt-4 flex flex-col gap-2">
          {history.length === 0 && <p className="py-3 text-center text-[12px] text-muted">{t('لا توجد عناصر')}</p>}
          {history.map((e) => (
            <div key={e.id} className="rounded-inner bg-surface p-3">
              <p dir="auto" className="text-[13.5px] font-extrabold text-title">
                {e.title} · {t(e.entry_type)}
              </p>
              <p className="text-[11px] font-bold text-gold-dark">{t('لم تتم التسوية')}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSheet(null)
                    onOpen(e.id)
                  }}
                  className="h-10 rounded-inner bg-brand text-[12.5px] font-extrabold text-white"
                >
                  {t('فتح')}
                </button>
                <button type="button" disabled={busyId === e.id} onClick={() => setHistory(e)} className="flex h-10 items-center justify-center gap-1 rounded-inner border border-line bg-white text-[12.5px] font-extrabold text-ink">
                  {busyId === e.id ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
                  {t('إعادة للقائمة')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Sheet>
      <Sheet open={sheet === 'removed'} onClose={() => setSheet(null)}>
        <p className="text-[18px] font-extrabold text-title">{t('المحذوفة عندي')}</p>
        <p className="mt-0.5 text-[12px] text-muted">{t('ما حذفته من عندك ولا يزال عند بقية الأعضاء.')}</p>
        <div className="mt-4 flex flex-col gap-2">
          {removedList.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 rounded-inner bg-surface p-3">
              <p dir="auto" className="min-w-0 text-[13.5px] font-extrabold text-title">
                {e.title} <span className="text-[11.5px] font-bold text-muted">· {t(e.entry_type)}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setRestoring(e)
                }}
                className="flex h-9 shrink-0 items-center gap-1 rounded-inner bg-brand px-3 text-[12px] font-extrabold text-white"
              >
                <Undo2 className="size-4" />
                {t('استعادة')}
              </button>
            </div>
          ))}
        </div>
      </Sheet>
      <Confirm
        open={!!restoring}
        title="استعادة"
        message={`«${restoring?.title ?? ''}» — ${t('سيعود إلى قائمتك. هل تريد المتابعة؟')}`}
        confirmLabel="استعادة"
        busy={!!busyId}
        error={error}
        onConfirm={async () => {
          if (!restoring) return
          setBusyId(restoring.id)
          setError('')
          try {
            const ok = await markMine(restoring, REMOVED_KEY, me.fnd, false)
            await qc.invalidateQueries({ queryKey: ['shared'] })
            setRestoring(null)
            setSheet(null)
            onChanged(ok ? 'تمت استعادة الالتزام بنجاح' : 'لم يعد هذا الالتزام موجودًا')
          } catch (err) {
            setError(fail(err, 'تعذّر الحفظ. تحقّق من الاتصال وحاول مرة أخرى.'))
          } finally {
            setBusyId('')
          }
        }}
        onCancel={() => setRestoring(null)}
      />
    </div>
  )
}

/** + في الأعضاء (الرحلة والمشاركة، للمسؤول): انضمام عضو جديد أو مغادرة عضو بتاريخ. */
export function MemberDatesActions({ entry, currency, onChanged }: { entry: Entry; currency: string; onChanged: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const me = useMe()
  const details = entry.details ?? {}
  const [menu, setMenu] = useState(false)
  const [mode, setMode] = useState<'join' | 'leave' | null>(null)
  const [picking, setPicking] = useState(false)
  const [name, setName] = useState('')
  const [day, setDay] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [settle, setSettle] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!iAmManager(details, me.fnd, me.myNames) || CLOSED.includes(entry.status)) return null
  const cur = t(String(details['العملة'] ?? '').trim() || currency)
  const manager = managerNameOf(details)
  const candidates = leaveCandidates(details)
  const pickedDay = () => {
    const [y, m, d] = day.split('-').map((x) => parseInt(x, 10))
    return new Date(y, m - 1, d)
  }
  const net = mode === 'leave' && name ? rawBalanceOf(details, name) : 0
  const due = Math.abs(net) > 0.01
  const owes = net < -0.01
  const lump = isLumpSum(details)
  const blocking = mode === 'leave' && name && day ? leaveBlocking(details, name, pickedDay()) : 0
  const shown = (n: string) => withoutFnd(n) || n

  function open(next: 'join' | 'leave') {
    setMenu(false)
    setError('')
    setName('')
    setSettle(true)
    setMode(next)
    if (next === 'join') setPicking(true)
  }

  async function save() {
    if (!mode || !name || !day) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'join') await recordMemberJoin(entry, name, pickedDay())
      else await recordMemberLeave(entry, name, pickedDay(), due && settle, t)
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setMode(null)
      onChanged(mode === 'join' ? 'سُجّل انضمام العضو' : due && settle ? 'سُجّلت مغادرة العضو وتسويته' : 'سُجّلت مغادرة العضو')
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setMenu(true)} className="flex h-8 items-center gap-1 rounded-inner bg-brand px-2.5 text-[12px] font-extrabold text-white hover:bg-brand-dark">
        <UserPlus className="size-4" />
        {t('الأعضاء')}
      </button>
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <p className="text-[17px] font-extrabold text-title">{t('الأعضاء')}</p>
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" onClick={() => open('join')} className="rounded-inner border border-line bg-white px-3 py-2.5 text-start hover:border-brand">
            <p className="flex items-center gap-2 text-[13.5px] font-extrabold text-title">
              <UserPlus className="size-4 text-brand" />
              {t('انضمام عضو جديد')}
            </p>
            <p className="text-[11px] text-sub">{t('يُضاف من تاريخ انضمامه، ولا تُحسب عليه المصروفات قبله')}</p>
          </button>
          <button
            type="button"
            disabled={!candidates.length}
            onClick={() => open('leave')}
            className="rounded-inner border border-line bg-white px-3 py-2.5 text-start hover:border-brand disabled:opacity-50"
          >
            <p className="flex items-center gap-2 text-[13.5px] font-extrabold text-title">
              <PlaneTakeoff className="size-4 text-brand" />
              {t('مغادرة عضو')}
            </p>
            <p className="text-[11px] text-sub">{t(candidates.length ? 'تختار من الأعضاء الحاليين من سيغادر وتاريخ مغادرته' : 'لا يوجد عضو يمكن تسجيل مغادرته')}</p>
          </button>
        </div>
      </Sheet>
      <MemberPicker
        open={picking}
        me={me.fnd}
        exclude={[]}
        onClose={() => {
          setPicking(false)
          if (!name) setMode(null)
        }}
        onPick={(n) => {
          setName(n.trim())
          setPicking(false)
        }}
      />
      <Sheet open={!!mode && !picking} onClose={() => !busy && setMode(null)}>
        <p className="text-[17px] font-extrabold text-title">{t(mode === 'join' ? 'انضمام عضو جديد' : 'مغادرة عضو')}</p>
        {mode === 'leave' && (
          <div className="mt-3 flex flex-col gap-1.5">
            <p className="text-[12px] font-bold text-sub">{t('من غادر؟')}</p>
            {candidates.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setName(c)}
                className={`h-11 rounded-inner border px-3 text-start text-[13px] font-bold ${name === c ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-ink'}`}
              >
                {shown(c)}
              </button>
            ))}
          </div>
        )}
        {mode === 'join' && name && (
          <p dir="auto" className="mt-3 rounded-inner bg-surface px-3 py-2 text-[13px] font-bold text-ink">
            {shown(name)}
          </p>
        )}
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t(mode === 'join' ? 'تاريخ الانضمام' : 'تاريخ المغادرة')}</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none focus:border-gold" />
        </label>
        {mode === 'leave' && name && blocking > 0 && (
          <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">
            {t('مصروفات تشمله بعد تاريخ المغادرة أو بانتظار الموافقة')}: {blocking} — {t('عدّلها أولًا')}
          </p>
        )}
        {mode === 'leave' && name && due && blocking === 0 && (
          <div className="mt-3 rounded-inner bg-gold-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
            <p dir="auto">
              {t(owes ? 'عليه' : 'له')} {money(Math.abs(net), cur)} —{' '}
              {lump
                ? t(owes ? 'يدفعها للميزانية المشتركة' : 'تُرد له من الميزانية المشتركة وتنقص من المتبقي')
                : `${t(owes ? 'يدفعها للمسؤول' : 'يدفعها له المسؤول')} (${shown(manager)})`}{' '}
              {t('وتُغلق حسابه في الرحلة')}.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSettle(false)} className={`h-10 rounded-inner border text-[12.5px] font-extrabold ${!settle ? 'border-brand bg-white text-brand' : 'border-line bg-white text-sub'}`}>
                {t('المغادرة فقط')}
              </button>
              <button type="button" onClick={() => setSettle(true)} className={`h-10 rounded-inner border text-[12.5px] font-extrabold ${settle ? 'border-brand bg-white text-brand' : 'border-line bg-white text-sub'}`}>
                {t('المغادرة مع التسوية')}
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
        <button
          type="button"
          disabled={busy || !name || !day || blocking > 0}
          onClick={save}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t(mode === 'join' ? 'تسجيل الانضمام' : 'تسجيل المغادرة')}
        </button>
      </Sheet>
    </>
  )
}
