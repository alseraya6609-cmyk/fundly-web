import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, CheckCircle2, Eye, History, LogOut, MoreVertical, Pin, Plus, ShieldCheck, Undo2, UserCheck, UserPlus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { usePeople, useStore } from '@/lib/data'
import { cn } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { isValidFnd, nameForFnd, normalizeFnd } from '@/lib/personalWrite'
import {
  DURATIONS,
  EXTRAS,
  FULL_LEVEL,
  LEVELS,
  LEVEL_EXTRAS,
  NEEDS_APPROVAL,
  ORDERED,
  RECEIVED,
  SCOPES,
  SUB_SCOPES,
  answerOf,
  composeScope,
  coreOf,
  delegatedRecords,
  deleteDelegation,
  editDelegatedEntry,
  encodeTarget,
  endOf,
  fmtDay,
  fndOf,
  isEnded,
  isIncoming,
  isReceived,
  isActive,
  isExpiringSoon,
  isScheduled,
  levelOf,
  limitOf,
  loadTargets,
  logOf,
  mainScopeOf,
  ownerAction,
  ownerNameOf,
  plainPermissions,
  saveDelegation,
  setAnswer,
  startOf,
  statusOf,
  subScopesOf,
  supportsTargets,
  targetKey,
  targetsOf,
  trashDelegatedEntry,
  useDelegations,
  withLog,
  type DelegatedRow,
  type Delegation,
  type Target,
} from '@/lib/delegations'
import { Chip, Empty, ErrorBox, Loading, PageHeader, Sheet } from '@/components/ui'
import { Confirm } from '@/components/Confirm'

const input = 'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'
const TONE = { ok: 'bg-brand-soft text-brand', warn: 'bg-gold-soft text-gold-dark', bad: 'bg-danger-soft text-danger', muted: 'bg-surface text-sub', info: 'bg-brand-soft text-brand-mid' }
const FILTERS = [
  ['all', 'الكل'],
  ['active', 'النشطة'],
  ['expiring', 'قريبة الانتهاء'],
  ['paused', 'الموقوفة'],
  ['ended', 'المنتهية'],
] as const
const fail = (e: unknown, fallback = 'تعذّر حفظ التفويض. حاول مرة أخرى.') => errorText(e) || fallback
const fromInput = (v: string) => {
  const [y, m, d] = v.split('-').map((x) => parseInt(x, 10))
  return new Date(y, m - 1, d)
}
const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function periodSummary(d: Delegation, t: (s: string) => string) {
  if (isEnded(d)) return `${t('منتهي في')} ${fmtDay(endOf(d))}`
  if (isScheduled(d)) return `${t('يبدأ في')} ${fmtDay(startOf(d))}`
  const days = Math.floor((endOf(d).getTime() - Date.now()) / 86400000) + 1
  return `${t('متبقي')} ${days} ${t('يوم')}`
}

/** التفويضات: ما منحتُه، وما مُنح لي. */
export default function Delegations() {
  const { t } = useI18n()
  const { user } = useSession()
  const uid = user?.id ?? ''
  const q = useDelegations()
  const qc = useQueryClient()
  const [direction, setDirection] = useState<'granted' | 'received'>('granted')
  const [filter, setFilter] = useState<string>('all')
  const [params, setParams] = useSearchParams()
  // «تفويض» من تفاصيل فرد: النموذج مفتوح باسمه (presetDelegate).
  const [form, setForm] = useState<{ existing?: Delegation; preset?: string } | null>(() => (params.get('new') ? { preset: params.get('new') ?? '' } : null))
  const [viewing, setViewing] = useState<Delegation | null>(null)
  const [incoming, setIncoming] = useState<Delegation | null>(null)
  const [menu, setMenu] = useState<Delegation | null>(null)
  const [ask, setAsk] = useState<{ d: Delegation; action: 'toggle' | 'extend' | 'revoke' | 'delete' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const flash = (m: string) => {
    setNotice(m)
    window.setTimeout(() => setNotice(''), 4000)
  }

  // من صفحة الأصول: «فوّضك فلان… بانتظار قبولك» يفتح التفويض الوارد مباشرة.
  useEffect(() => {
    const id = params.get('incoming')
    if (!id || !q.data) return
    const d = q.data.find((x) => x.id === id)
    if (d) {
      setDirection('received')
      setIncoming(d)
    }
    setParams({}, { replace: true })
  }, [params, q.data, setParams])

  const all = q.data ?? []
  const source = all.filter((d) => (direction === 'received' ? isReceived(d, uid) : !isReceived(d, uid)))
  const counts: Record<string, number> = {
    all: source.length,
    active: source.filter((d) => isActive(d) && !isExpiringSoon(d)).length,
    expiring: source.filter(isExpiringSoon).length,
    paused: source.filter((d) => d.is_paused && !isEnded(d)).length,
    ended: source.filter(isEnded).length,
  }
  const shown = source.filter((d) =>
    filter === 'active' ? isActive(d) && !isExpiringSoon(d) : filter === 'expiring' ? isExpiringSoon(d) : filter === 'ended' ? isEnded(d) : filter === 'paused' ? d.is_paused && !isEnded(d) : true,
  )

  async function run() {
    if (!ask) return
    setBusy(true)
    setError('')
    try {
      if (ask.action === 'delete') await deleteDelegation(ask.d.id)
      else await ownerAction(ask.d, ask.action)
      await qc.invalidateQueries({ queryKey: ['delegations'] })
      const done = { toggle: ask.d.is_paused ? 'تم تفعيل التفويض' : 'تم إيقاف التفويض', extend: 'تم تمديد التفويض شهرًا', revoke: 'تم إلغاء التفويض فورًا', delete: 'تم حذف التفويض بنجاح' }[ask.action]
      setAsk(null)
      flash(done)
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader icon={ShieldCheck} color="#0A5A50" title="التفويضات" subtitle="امنح وصولًا محددًا ولمدة واضحة. يمكنك إيقاف التفويض في أي وقت." />
      {notice && (
        <p className="mb-3 flex items-center gap-2 rounded-inner bg-brand-soft px-4 py-3 text-[13px] font-bold text-brand">
          <CheckCircle2 className="size-4" />
          {t(notice)}
        </p>
      )}
      <button type="button" onClick={() => setForm({})} className="flex h-12 w-full items-center justify-center gap-2 rounded-field bg-brand text-[14px] font-extrabold text-white hover:bg-brand-dark">
        <Plus className="size-5" />
        {t('إنشاء تفويض جديد')}
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(
          [
            ['granted', 'فوّضتُ أشخاصًا', UserPlus, all.filter((d) => !isReceived(d, uid)).length],
            ['received', 'أشخاص فوّضوني', UserCheck, all.filter((d) => isReceived(d, uid)).length],
          ] as const
        ).map(([key, label, Icon, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setDirection(key)
              setFilter('all')
            }}
            className={cn('flex h-14 items-center justify-center gap-2 rounded-inner border text-[13.5px] font-extrabold', direction === key ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub')}
          >
            <Icon className="size-5" />
            {t(label)}
            <span className="rounded-full bg-white px-2 text-[11px]">{count}</span>
          </button>
        ))}
      </div>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map(([key, label]) => (
          <Chip key={key} active={filter === key} label={label} count={counts[key]} onClick={() => setFilter(key)} />
        ))}
      </div>

      <div className="mt-3">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : shown.length === 0 ? (
          <Empty icon={ShieldCheck} text="لا توجد تفويضات" />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {shown.map((d) => {
              const st = statusOf(d, uid)
              const inc = isIncoming(d, uid)
              const owner = ownerNameOf(d.permissions)
              const count = targetsOf(d.permissions).length
              return (
                <div key={d.id} className="card flex items-start gap-3 p-4">
                  <button type="button" onClick={() => (inc ? setIncoming(d) : setViewing(d))} className="min-w-0 flex-1 text-start">
                    <p dir="auto" className="text-[14.5px] font-extrabold text-title">
                      {inc && owner ? owner : d.delegate_name}
                    </p>
                    <p className="mt-0.5 text-[11.5px] font-bold text-sub">
                      {t(d.scope)}
                      {count ? ` • ${count} ${t('عنصر محدد')}` : ''}
                    </p>
                    <p className="mt-1 text-[11.5px] text-muted">
                      {fmtDay(startOf(d))} — {fmtDay(endOf(d))} · {periodSummary(d, t)}
                    </p>
                    <span className={cn('mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-extrabold', TONE[st.tone])}>
                      {st.label === 'بانتظار القبول' ? `${t('بانتظار قبول')} ${d.delegate_name}` : t(st.label)}
                    </span>
                  </button>
                  <button type="button" aria-label={t('خيارات التفويض')} onClick={() => (inc ? setIncoming(d) : setMenu(d))} className="grid size-9 place-items-center rounded-full bg-surface text-sub">
                    <MoreVertical className="size-5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Sheet open={!!menu} onClose={() => setMenu(null)}>
        {menu && (
          <div className="flex flex-col gap-2">
            <p className="text-[17px] font-extrabold text-title">{t('خيارات التفويض')}</p>
            {(
              [
                ['view', 'عرض التفاصيل'],
                ['edit', 'تعديل التفويض'],
                ['toggle', menu.is_paused ? 'إعادة التفعيل' : 'إيقاف مؤقت'],
                ['extend', 'تمديد شهر'],
                statusOf(menu, uid).label !== 'منتهي' ? ['revoke', 'إلغاء فوري'] : ['delete', 'حذف التفويض'],
              ] as [string, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  const d = menu
                  setMenu(null)
                  setError('')
                  if (key === 'view') setViewing(d)
                  else if (key === 'edit') setForm({ existing: d })
                  else setAsk({ d, action: key as 'toggle' | 'extend' | 'revoke' | 'delete' })
                }}
                className={cn('h-12 rounded-inner border border-line bg-white px-3 text-start text-[13.5px] font-bold', key === 'revoke' || key === 'delete' ? 'text-danger' : 'text-ink')}
              >
                {t(label)}
              </button>
            ))}
          </div>
        )}
      </Sheet>
      <Confirm
        open={!!ask}
        title={ask ? { toggle: ask.d.is_paused ? 'إعادة تفعيل التفويض' : 'إيقاف التفويض مؤقتًا', extend: 'تمديد التفويض شهرًا', revoke: 'إلغاء التفويض فورًا', delete: 'حذف التفويض' }[ask.action] : ''}
        message={
          ask?.action === 'delete'
            ? t('سيُحذف التفويض نهائيًا ولا يمكن التراجع. هل تريد الحذف؟')
            : ask?.action === 'revoke'
              ? `«${ask.d.delegate_name}» — ${t('سينتهي التفويض اليوم ويُنقل إلى المنتهية مع بقاء سجله. هل تريد الإلغاء؟')}`
              : ask?.action === 'extend'
                ? t('ستُضاف 30 يومًا إلى تاريخ نهاية التفويض.')
                : t('هل تريد تنفيذ هذا الإجراء على التفويض؟')
        }
        confirmLabel={ask?.action === 'delete' ? 'حذف' : ask?.action === 'revoke' ? 'إلغاء التفويض' : 'تأكيد'}
        danger={ask?.action === 'delete' || ask?.action === 'revoke'}
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={() => setAsk(null)}
      />
      <Sheet open={!!viewing} onClose={() => setViewing(null)}>
        {viewing && <DelegationDetails d={viewing} />}
      </Sheet>
      {incoming && (
        <IncomingSheet
          d={incoming}
          onClose={() => setIncoming(null)}
          onDone={(m) => {
            setIncoming(null)
            flash(m)
          }}
        />
      )}
      {form && (
        <DelegationForm
          existing={form.existing}
          preset={form.preset}
          direction={direction}
          onClose={() => {
            setForm(null)
            if (params.get('new')) setParams({})
          }}
          onDone={(m, dir) => {
            setForm(null)
            if (params.get('new')) setParams({})
            setDirection(dir)
            setFilter('all')
            flash(m)
          }}
        />
      )}
    </div>
  )
}

// ---------------- التفاصيل (للمالك) ----------------

function Row({ label, value }: { label: string; value: string }) {
  const { t } = useI18n()
  return (
    <div className="flex justify-between gap-3 border-b border-line py-2 text-[12.5px]">
      <span className="shrink-0 text-muted">{t(label)}</span>
      <span dir="auto" className="text-end font-bold text-ink">
        {value || '—'}
      </span>
    </div>
  )
}

function DelegationDetails({ d }: { d: Delegation }) {
  const { t } = useI18n()
  const { user } = useSession()
  const perms = plainPermissions(d.permissions).filter((p) => p !== NEEDS_APPROVAL)
  const limit = limitOf(d.permissions)
  const log = logOf(d.permissions)
  const two = (n: number) => String(n).padStart(2, '0')
  return (
    <div>
      <p className="text-[18px] font-extrabold text-title">{d.delegate_name}</p>
      {fndOf(d.permissions) && <p className="ltr text-[12px] font-bold text-gold-dark">{fndOf(d.permissions)}</p>}
      <div className="mt-3">
        <Row label="الحالة" value={t(statusOf(d, user?.id ?? '').label)} />
        <Row label="النطاق" value={t(mainScopeOf(d.scope))} />
        {subScopesOf(d.scope).length > 0 && <Row label="الأقسام الفرعية" value={subScopesOf(d.scope).map(t).join('، ')} />}
        <Row label="المستوى" value={t(levelOf(plainPermissions(d.permissions)))} />
        <Row label="الصلاحيات" value={perms.map(t).join('، ')} />
        <Row label="موافقة المالك" value={t(d.permissions.includes(NEEDS_APPROVAL) ? 'ما يُدخله يحتاج موافقة المالك' : 'لا يحتاج موافقة')} />
        <Row label="المدة" value={`${fmtDay(startOf(d))} — ${fmtDay(endOf(d))}`} />
        {limit !== null && <Row label="سقف المبلغ للعملية الواحدة" value={String(limit)} />}
        {(d.notes ?? '').trim() && <Row label="الغرض من التفويض" value={d.notes!.trim()} />}
      </div>
      {targetsOf(d.permissions).length > 0 && (
        <>
          <p className="mt-4 text-[13px] font-extrabold text-title">{t('العناصر المحددة')}</p>
          {targetsOf(d.permissions).map((x) => (
            <p key={targetKey(x)} className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink">
              <Pin className="size-3.5 text-brand" />
              {x.label} — {t(x.sub)}
            </p>
          ))}
        </>
      )}
      <p className="mt-4 text-[13px] font-extrabold text-title">{t('سجل التفويض')}</p>
      {log.length === 0 ? (
        <p className="mt-1 text-[12px] text-muted">{t('لا توجد أحداث مسجلة بعد')}</p>
      ) : (
        log.map(([at, what], i) => (
          <p key={i} className="mt-1 flex items-start gap-1.5 text-[12px] text-ink">
            <History className="mt-0.5 size-3.5 shrink-0 text-brand" />
            <span dir="auto">
              {t(what)} — {two(at.getDate())}/{two(at.getMonth() + 1)}/{at.getFullYear()} {two(at.getHours())}:{two(at.getMinutes())}
            </span>
          </p>
        ))
      )}
    </div>
  )
}

// ---------------- تفويض وصلني ----------------

function IncomingSheet({ d, onClose, onDone }: { d: Delegation; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [ask, setAsk] = useState<'accepted' | 'rejected' | 'withdrawn' | 'rejoin' | null>(null)
  const [viewing, setViewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owner = ownerNameOf(d.permissions)
  const answer = answerOf(d.permissions)
  const perms = plainPermissions(d.permissions).filter((p) => p !== NEEDS_APPROVAL)
  const limit = limitOf(d.permissions)
  const canView = answer === 'accepted' && isActive(d) && d.permissions.includes('عرض البيانات')
  const status = statusOf(d, '')

  async function run() {
    if (!ask) return
    setBusy(true)
    setError('')
    try {
      await setAnswer(d.id, ask === 'rejoin' ? 'accepted' : ask)
      await qc.invalidateQueries({ queryKey: ['delegations'] })
      setAsk(null)
      onDone({ accepted: 'تم قبول التفويض', rejected: 'تم رفض التفويض', withdrawn: 'تم إلغاء التفويض من عندك', rejoin: 'عدتَ للتفويض' }[ask])
    } catch (e) {
      setError(ask === 'rejoin' ? 'تعذّرت العودة — ربما أنهى صاحبه التفويض.' : fail(e, 'تعذّر إرسال الرد. حاول مرة أخرى.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-inner bg-brand-soft text-brand">
          <ShieldCheck className="size-5" />
        </span>
        <div className="flex-1">
          <p className="text-[17px] font-extrabold text-title">{t('تفويض وصلك')}</p>
          <p className="text-[12.5px] text-sub">
            {t('من')}: {owner || '—'}
          </p>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-extrabold', TONE[status.tone])}>{t(status.label)}</span>
      </div>
      <div className="mt-4">
        <Row label="النطاق" value={t(mainScopeOf(d.scope))} />
        {subScopesOf(d.scope).length > 0 && <Row label="الأقسام الفرعية" value={subScopesOf(d.scope).map(t).join('، ')} />}
        {targetsOf(d.permissions).length > 0 && <Row label="عناصر محددة" value={targetsOf(d.permissions).map((x) => x.label).join('، ')} />}
        <Row label="الصلاحيات" value={perms.map(t).join('، ')} />
        {limit !== null && <Row label="سقف المبلغ" value={String(limit)} />}
        <Row label="موافقة المالك" value={t(d.permissions.includes(NEEDS_APPROVAL) ? 'ما تُدخله يحتاج موافقة المالك' : 'لا يحتاج موافقة')} />
        <Row label="المدة" value={`${fmtDay(startOf(d))} — ${fmtDay(endOf(d))}`} />
        {(d.notes ?? '').trim() && <Row label="الغرض" value={d.notes!.trim()} />}
      </div>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <div className="mt-4 flex flex-col gap-2">
        {answer !== 'accepted' && answer !== 'rejected' && answer !== 'withdrawn' && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => (setError(''), setAsk('rejected'))} className="h-12 rounded-field border border-danger text-[14px] font-extrabold text-danger">
              {t('رفض')}
            </button>
            <button type="button" onClick={() => (setError(''), setAsk('accepted'))} className="h-12 rounded-field bg-brand text-[14px] font-extrabold text-white">
              {t('قبول')}
            </button>
          </div>
        )}
        {answer === 'withdrawn' && !isEnded(d) && (
          <button type="button" onClick={() => (setError(''), setAsk('rejoin'))} className="flex h-12 items-center justify-center gap-1.5 rounded-field border border-brand text-[14px] font-extrabold text-brand">
            <Undo2 className="size-4" />
            {t('العودة للتفويض')}
          </button>
        )}
        {answer === 'withdrawn' && isEnded(d) && <p className="text-center text-[12px] text-muted">{t('انتهى التفويض — لا يمكن العودة إليه.')}</p>}
        {canView && (
          <button type="button" onClick={() => setViewing(true)} className="flex h-12 items-center justify-center gap-1.5 rounded-field bg-brand text-[14px] font-extrabold text-white">
            <Eye className="size-4" />
            {t('عرض البيانات المفوَّضة')}
          </button>
        )}
        {answer === 'accepted' && !canView && <p className="text-center text-[12px] text-muted">{t('عرض البيانات متاح أثناء مدة التفويض وما دام غير موقوف.')}</p>}
        {answer === 'accepted' && !isEnded(d) && (
          <button type="button" onClick={() => (setError(''), setAsk('withdrawn'))} className="flex h-11 items-center justify-center gap-1.5 rounded-field border border-line text-[13px] font-extrabold text-danger">
            <LogOut className="size-4" />
            {t('إلغاء التفويض من عندي')}
          </button>
        )}
      </div>
      <Confirm
        open={!!ask}
        title={ask === 'accepted' ? 'قبول التفويض' : ask === 'rejected' ? 'رفض التفويض' : ask === 'rejoin' ? 'العودة للتفويض' : 'إلغاء التفويض'}
        message={t(
          ask === 'accepted'
            ? 'بقبولك تستطيع الاطلاع على البيانات المفوَّضة خلال مدة التفويض، ويصل للمالك إشعار بقبولك. هل تريد المتابعة؟'
            : ask === 'rejected'
              ? 'سيصل للمالك إشعار برفضك. هل تريد المتابعة؟'
              : ask === 'rejoin'
                ? 'ستعود لإدارة ما فُوِّضتَ به بنفس الصلاحيات والمدة، ويصل لصاحبه إشعار بعودتك. هل تريد المتابعة؟'
                : 'ستتوقف عن إدارة ما فُوِّضتَ به فورًا، ويصل لصاحبه إشعار بإلغائك للتفويض. تستطيع العودة إليه ما دام صاحبه لم يُنهِه. هل تريد المتابعة؟',
        )}
        confirmLabel={ask === 'accepted' ? 'قبول' : ask === 'rejected' ? 'رفض' : ask === 'rejoin' ? 'عودة' : 'إلغاء التفويض'}
        danger={ask === 'rejected' || ask === 'withdrawn'}
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={() => setAsk(null)}
      />
      {viewing && <DelegatedData d={d} onClose={() => setViewing(false)} />}
    </Sheet>
  )
}

const SOURCE_LABEL: Record<string, string> = {
  personal_entries: 'الالتزامات الشخصية',
  shared_entries: 'الالتزامات المشتركة',
  project_assets: 'العقارات والأنشطة والمركبات',
  people: 'الأفراد والجهات',
}

/** البيانات المفوَّضة (fundly_delegated_records) وإدارتها بالصلاحيات. */
function DelegatedData({ d, onClose }: { d: Delegation; onClose: () => void }) {
  const { t } = useI18n()
  const rows = useQuery({ queryKey: ['delegated-records', d.id], queryFn: () => delegatedRecords(d.id) })
  const [open, setOpen] = useState<DelegatedRow | null>(null)
  const [notice, setNotice] = useState('')
  const perms = d.permissions
  const canEdit = perms.includes('تعديل السجلات')
  const canAct = canEdit || perms.includes('إضافة السجلات') || perms.includes('تنفيذ المدفوعات والتحويلات')
  const canDelete = perms.includes('حذف السجلات')
  const manages = canAct || canDelete
  const owner = ownerNameOf(perms)
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t('البيانات المفوَّضة')}</p>
      {owner && <p className="text-[12.5px] text-sub">{owner}</p>}
      <p className="mt-3 rounded-inner bg-surface px-3 py-2 text-[12px] text-sub">
        {t(manages ? 'اضغط على السجل لإدارته حسب صلاحياتك — وكل ما تفعله يصل إشعاره للمالك. العقارات والأنشطة والمركبات المفوَّضة تديرها من صفحة «الأصول».' : 'للاطلاع فقط — تظهر هنا سجلات المالك في نطاق التفويض وأثناء مدته.')}
      </p>
      {notice && <p className="mt-2 rounded-inner bg-brand-soft px-3 py-2 text-[12px] font-bold text-brand">{t(notice)}</p>}
      <div className="mt-3 flex flex-col gap-2">
        {rows.isLoading ? (
          <Loading />
        ) : rows.error ? (
          <p className="py-6 text-center text-[12.5px] text-muted">{t('تعذّر تحميل البيانات.')}</p>
        ) : (rows.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-muted">{t('لا توجد سجلات في نطاق هذا التفويض.')}</p>
        ) : (
          (rows.data ?? []).map((r) => {
            const clickable = manages && (r.source === 'personal_entries' || r.source === 'shared_entries')
            return (
              <button key={`${r.source}-${r.id}`} type="button" disabled={!clickable} onClick={() => setOpen(r)} className="card-inner flex items-center justify-between gap-3 px-3 py-2.5 text-start disabled:cursor-default">
                <span className="min-w-0">
                  <span dir="auto" className="block truncate text-[13.5px] font-extrabold text-title">
                    {r.title.trim() || t(r.kind)}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {[t(SOURCE_LABEL[r.source] ?? r.source), t(r.kind), t(r.status), r.due].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {r.amount !== 0 && <span className="shrink-0 text-[12.5px] font-extrabold text-ink">{Math.round(r.amount)}</span>}
              </button>
            )
          })
        )}
      </div>
      {open && (
        <DelegatedEntry
          delegationId={d.id}
          row={open}
          canEdit={canEdit}
          canAct={canAct}
          canDelete={canDelete}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null)
            rows.refetch()
            setNotice(`${t('تم الحفظ وإشعار')} ${owner} ${t('بما قمت به')}`)
          }}
        />
      )}
    </Sheet>
  )
}

function DelegatedEntry({ delegationId, row, canEdit, canAct, canDelete, onClose, onDone }: { delegationId: string; row: DelegatedRow; canEdit: boolean; canAct: boolean; canDelete: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const statuses = ['نشطة', 'مكتملة', 'تمت التسوية', 'ملغاة']
  const [title, setTitle] = useState(row.title)
  const [amount, setAmount] = useState(row.amount ? String(row.amount % 1 === 0 ? Math.round(row.amount) : row.amount) : '')
  const [due, setDue] = useState(row.due.slice(0, 10))
  const [status, setStatus] = useState(row.status)
  const [note, setNote] = useState('')
  const [ask, setAsk] = useState<'save' | 'trash' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run() {
    setBusy(true)
    setError('')
    try {
      if (ask === 'trash') await trashDelegatedEntry(delegationId, row.source, row.id)
      else
        await editDelegatedEntry({
          delegationId,
          source: row.source,
          id: row.id,
          title: canEdit ? title.trim() : null,
          amount: canEdit ? parseFloat(amount.replace(/,/g, '')) || null : null,
          due: canEdit ? due || null : null,
          status,
          note: note.trim(),
        })
      setAsk(null)
      onDone()
    } catch {
      setError(ask === 'trash' ? 'تعذّر النقل — قد تكون الصلاحية أو مدة التفويض انتهت.' : 'تعذّر الحفظ — قد تكون الصلاحية أو مدة التفويض انتهت.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[13px] font-extrabold text-[#6A4C93]">
        {t('مفوَّض')} — {t(row.kind)}
      </p>
      {canEdit ? (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('العنوان')}</span>
            <input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('المبلغ')}</span>
            <input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('تاريخ الاستحقاق')}</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
          </label>
        </div>
      ) : (
        <p dir="auto" className="mt-3 text-[16px] font-extrabold text-title">
          {row.title}
        </p>
      )}
      {canAct && (
        <>
          <p className="mt-4 text-[12px] font-bold text-sub">{t('الحالة')}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {[...statuses, ...(status && !statuses.includes(status) ? [status] : [])].map((s) => (
              <button key={s} type="button" onClick={() => setStatus(s)} className={cn('h-9 rounded-full border px-3 text-[12px] font-bold', status === s ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub')}>
                {t(s)}
              </button>
            ))}
          </div>
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-[12px] font-bold text-sub">{t('ملاحظة للمالك')}</span>
            <textarea dir="auto" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={`${input} h-auto py-2.5`} />
          </label>
          <button type="button" onClick={() => (setError(''), setAsk('save'))} className="mt-4 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white">
            {t('حفظ')}
          </button>
        </>
      )}
      {canDelete && (
        <button type="button" onClick={() => (setError(''), setAsk('trash'))} className="mt-2 h-12 w-full rounded-field border border-danger text-[14px] font-extrabold text-danger">
          {t('نقل إلى سلة المالك')}
        </button>
      )}
      <Confirm
        open={!!ask}
        title={ask === 'trash' ? 'نقل إلى سلة المالك' : 'حفظ التغيير'}
        message={t(ask === 'trash' ? 'سيُنقل السجل إلى سلة المهملات عند المالك (يستطيع استعادته)، ويصله إشعار بذلك. هل تريد المتابعة؟' : 'سيُحفظ التغيير في سجل المالك ويصله إشعار به. هل تريد المتابعة؟')}
        confirmLabel={ask === 'trash' ? 'نقل' : 'تأكيد'}
        danger={ask === 'trash'}
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={() => setAsk(null)}
      />
    </Sheet>
  )
}

// ---------------- إنشاء التفويض وتعديله ----------------

function DelegationForm({ existing, preset, direction, onClose, onDone }: { existing?: Delegation; preset?: string; direction: 'granted' | 'received'; onClose: () => void; onDone: (m: string, dir: 'granted' | 'received') => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { user, profile } = useSession()
  const uid = user?.id ?? ''
  const me = profile?.fnd_id ?? ''
  const store = useStore()
  const people = usePeople()
  const [received, setReceived] = useState(existing ? isReceived(existing, uid) : direction === 'received')
  const [name, setName] = useState(existing?.delegate_name ?? preset ?? '')
  const [fnd, setFnd] = useState(existing ? fndOf(existing.permissions) : '')
  // الرقم التعريفي للمفوَّض من «الأفراد والجهات» إن كان مسجلًا.
  useEffect(() => {
    if (existing || !preset || fnd) return
    const p = (people.data ?? []).find((x) => x.fullName?.trim() === preset.trim())
    const id = String(p?.details?.['الرقم التعريفي'] ?? '').trim()
    if (id) setFnd(id)
  }, [people.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const [owner, setOwner] = useState<string | null>(null)
  const [checked, setChecked] = useState('')
  const [looking, setLooking] = useState(false)
  const [picking, setPicking] = useState(false)
  const [main, setMain] = useState(mainScopeOf(existing?.scope ?? null))
  const [subs, setSubs] = useState<string[]>(existing ? subScopesOf(existing.scope) : [])
  const [perms, setPerms] = useState<Set<string>>(() => {
    const initial = new Set(existing ? plainPermissions(existing.permissions) : ['عرض البيانات'])
    return applyLevel(initial, levelOf([...initial]))
  })
  const [targets, setTargets] = useState<Target[]>(() => (existing ? targetsOf(existing.permissions) : []))
  const [targetsFor, setTargetsFor] = useState<string | null>(null)
  const [limit, setLimit] = useState(() => {
    const l = existing ? limitOf(existing.permissions) : null
    return l === null ? '' : String(l)
  })
  const [start, setStart] = useState(toInput(existing ? startOf(existing) : new Date()))
  const [end, setEnd] = useState(toInput(existing ? endOf(existing) : new Date(Date.now() + 365 * 86400000)))
  const [durationPreset, setDurationPreset] = useState('مخصص')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const level = levelOf([...perms])

  function applyLevel(current: Set<string>, lvl: string): Set<string> {
    const approval = current.has(NEEDS_APPROVAL)
    const allowed = LEVEL_EXTRAS[lvl] ?? []
    const kept = lvl === FULL_LEVEL ? EXTRAS : [...current].filter((p) => allowed.includes(p))
    const next = new Set([...coreOf(lvl), ...kept])
    if (approval) next.add(NEEDS_APPROVAL)
    return next
  }

  // صاحب الرقم التعريفي يُعرض تحته.
  useEffect(() => {
    const id = normalizeFnd(fnd)
    if (!isValidFnd(id)) {
      setChecked('')
      setOwner(null)
      return
    }
    if (id === checked) return
    let alive = true
    setLooking(true)
    nameForFnd(id).then((n) => {
      if (!alive) return
      setLooking(false)
      setChecked(id)
      setOwner(n || null)
    })
    return () => {
      alive = false
    }
  }, [fnd]) // eslint-disable-line react-hooks/exhaustive-deps

  const previousAnswer = existing ? answerOf(existing.permissions) : ''
  const answerLabel = existing && fndOf(existing.permissions) === normalizeFnd(fnd) ? previousAnswer : ''

  function check(): string | null {
    if (!name.trim()) return 'أدخل اسم الشخص أو الجهة المفوضة.'
    if (perms.size === 0) return 'اختر صلاحية واحدة على الأقل.'
    if (!(fromInput(end) > fromInput(start))) return 'يجب أن يكون تاريخ النهاية بعد تاريخ البداية.'
    const id = normalizeFnd(fnd)
    if (!received && !id) return 'أدخل الرقم التعريفي للمفوَّض — التفويض يصل ويُقبل بالرقم التعريفي فقط.'
    if (!received && !isValidFnd(id)) return 'الرقم التعريفي بصيغة FND-XXXX-XXXX'
    if (!received && id === me) return 'لا يمكن تفويض نفسك'
    return null
  }

  async function save() {
    setBusy(true)
    setError('')
    const id = normalizeFnd(fnd)
    const scope = composeScope(main, subs)
    const startDate = fromInput(start)
    const endDate = fromInput(end)
    const fullName = String(store.data?.['settings_profile_name'] ?? '').trim() || profile?.display_name || ''
    const idMeta = !received && isValidFnd(id) ? [`@fnd:${id}`, `@ownername:${fullName}`, `@accept:${existing && fndOf(existing.permissions) === id && previousAnswer ? previousAnswer : 'pending'}`] : []
    const limitN = parseInt(limit.trim(), 10)
    const event = (() => {
      if (!existing) return 'إنشاء التفويض'
      const before = new Set(plainPermissions(existing.permissions))
      const after = new Set([...perms].filter((p) => !p.startsWith('@')))
      const added = [...after].filter((p) => !before.has(p))
      const removed = [...before].filter((p) => !after.has(p))
      const oldTargets = new Set(existing.permissions.filter((p) => p.startsWith('@target:')))
      const newTargets = new Set(targets.filter((x) => subs.includes(x.sub)).map(encodeTarget))
      const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
      const parts = [
        added.length ? `أُضيفت صلاحية: ${added.join('، ')}` : '',
        removed.length ? `أُزيلت صلاحية: ${removed.join('، ')}` : '',
        !sameDay(startOf(existing), startDate) || !sameDay(endOf(existing), endDate) ? `المدة: ${fmtDay(startDate)} - ${fmtDay(endDate)}` : '',
        existing.scope !== scope ? `النطاق: ${scope}` : '',
        oldTargets.size !== newTargets.size || ![...newTargets].every((x) => oldTargets.has(x)) ? 'تغيّرت العناصر المفوَّض بها' : '',
        existing.delegate_name.trim() !== name.trim() ? `المفوَّض: ${name.trim()}` : '',
      ].filter(Boolean)
      return parts.length ? `تعديل التفويض — ${parts.join(' · ')}` : 'تعديل التفويض'
    })()
    const permissions = withLog(
      [
        ...perms,
        ...(existing?.permissions.filter((p) => p.startsWith('@log:')) ?? []),
        ...targets.filter((x) => subs.includes(x.sub)).map(encodeTarget),
        ...idMeta,
        ...(perms.has('تنفيذ المدفوعات والتحويلات') && limitN > 0 ? [`@limit:${limitN}`] : []),
      ],
      event,
    )
    try {
      await saveDelegation({
        id: existing?.id,
        delegate_name: name.trim(),
        delegate_ref: received ? RECEIVED : existing && isReceived(existing, uid) ? null : (existing?.delegate_ref ?? null),
        scope,
        permissions,
        start: startDate,
        end: endDate,
        is_paused: existing?.is_paused ?? false,
        notes: notes.trim() || null,
      })
      await qc.invalidateQueries({ queryKey: ['delegations'] })
      setConfirming(false)
      onDone(existing ? 'تم حفظ التعديل' : 'تمت إضافة التفويض', received ? 'received' : 'granted')
    } catch (e) {
      setConfirming(false)
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (p: string) =>
    setPerms((x) => {
      const next = new Set(x)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      // اختيار أي صلاحية يعني ضمنًا «عرض البيانات».
      if ([...next].some((q) => q !== NEEDS_APPROVAL)) next.add('عرض البيانات')
      return next
    })
  const peopleList = (people.data ?? []).filter((p) => p.fullName?.trim() && p.fullName.trim() !== 'أنا')
  const section = (n: string) => <p className="mt-5 mb-2 text-[14px] font-extrabold text-title">{t(n)}</p>

  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">{t(existing ? 'تعديل التفويض' : 'إنشاء تفويض')}</p>
      <p className="mt-0.5 text-[12px] text-muted">{t('امنح وصولًا محددًا ولمدة واضحة. يمكنك إيقاف التفويض في أي وقت.')}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(
          [
            [false, 'تفويض منحتُه'],
            [true, 'تفويض مُنح لي'],
          ] as const
        ).map(([value, label]) => (
          <button key={label} type="button" onClick={() => setReceived(value)} className={cn('h-11 rounded-inner border text-[13px] font-extrabold', received === value ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub')}>
            {t(label)}
          </button>
        ))}
      </div>

      {section('1. الشخص أو الجهة المفوضة')}
      <div className="flex gap-2">
        <input dir="auto" value={name} placeholder={t('الاسم')} onChange={(e) => setName(e.target.value)} className={input} />
        <button type="button" onClick={() => setPicking(true)} className="h-12 shrink-0 rounded-field border border-brand px-3 text-[12.5px] font-extrabold text-brand">
          {t('جلب من الأفراد')}
        </button>
      </div>
      {!received && (
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('الرقم التعريفي للمفوَّض (إلزامي — به يصله التفويض)')}</span>
          <input dir="ltr" value={fnd} placeholder="FND-XXXX-XXXX" onChange={(e) => setFnd(e.target.value)} className={input} />
          {looking && <span className="text-[11.5px] text-muted">{t('جارٍ التحقق من صاحب الرقم...')}</span>}
          {!looking && owner && (
            <span className="flex items-center gap-1 text-[11.5px] font-bold text-brand">
              <BadgeCheck className="size-3.5" />
              {t('الرقم التعريفي يخص')} {owner} — {t('تأكد أنه المفوَّض الصحيح')}
            </span>
          )}
          {!looking && checked && owner === null && <span className="text-[11.5px] font-bold text-danger">{t('لم يُعثر على صاحب هذا الرقم — تأكد منه')}</span>}
          {answerLabel && (
            <span className="text-[11.5px] font-bold text-sub">
              {t(answerLabel === 'accepted' ? 'قبِل المفوَّض هذا التفويض' : answerLabel === 'rejected' ? 'رفض المفوَّض هذا التفويض' : 'بانتظار قبول المفوَّض')}
            </span>
          )}
        </label>
      )}

      {section('2. نطاق التفويض')}
      <select
        value={main}
        onChange={(e) => {
          setMain(e.target.value)
          setSubs([])
          setTargets([])
        }}
        className={input}
      >
        {SCOPES.map((s) => (
          <option key={s} value={s}>
            {t(s)}
          </option>
        ))}
      </select>
      {(SUB_SCOPES[main] ?? []).length > 0 && (
        <>
          <p className="mt-2 text-[11.5px] text-muted">{t('أقسام فرعية داخل النطاق (اتركها فارغة = النطاق كاملًا)')}</p>
          <div className="mt-1 flex flex-col gap-1.5">
            {(SUB_SCOPES[main] ?? []).map((s) => {
              const on = subs.includes(s)
              const count = targets.filter((x) => x.sub === s).length
              return (
                <div key={s} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSubs((x) => (on ? x.filter((y) => y !== s) : [...x, s]))
                      if (on) setTargets((x) => x.filter((y) => y.sub !== s))
                    }}
                    className={cn('h-10 flex-1 rounded-inner border px-3 text-start text-[12.5px] font-bold', on ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub')}
                  >
                    {t(s)}
                  </button>
                  {on && supportsTargets(main, s) && (
                    <button type="button" onClick={() => setTargetsFor(s)} className="h-10 shrink-0 rounded-inner border border-line bg-white px-3 text-[11.5px] font-extrabold text-brand">
                      {count ? `${count} ${t('عنصر محدد')}` : t('عناصر محددة')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {section('3. الصلاحيات')}
      <select value={level} onChange={(e) => setPerms((x) => applyLevel(x, e.target.value))} className={input}>
        {Object.keys(LEVELS).map((l) => (
          <option key={l} value={l}>
            {t(l)}
          </option>
        ))}
      </select>
      <p className="mt-2 text-[11.5px] text-muted">
        {t('الإجراءات')}: {t('تتحدد حسب')} «{t(level)}» — {t('الرمادي غير مسموح به في هذا المستوى.')}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ORDERED.map((p) => (
          <span key={p} className={cn('rounded-full px-3 py-1.5 text-[11.5px] font-bold', perms.has(p) ? 'bg-brand text-white' : 'bg-surface text-muted')}>
            {t(p)}
          </span>
        ))}
        {EXTRAS.map((p) => {
          const allowed = (LEVEL_EXTRAS[level] ?? []).includes(p)
          return (
            <button
              key={p}
              type="button"
              disabled={!allowed || level === FULL_LEVEL}
              onClick={() => toggle(p)}
              className={cn('rounded-full border px-3 py-1.5 text-[11.5px] font-bold disabled:opacity-40', perms.has(p) ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub')}
            >
              {t(p)}
            </button>
          )
        })}
      </div>
      {perms.has('تنفيذ المدفوعات والتحويلات') && (
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('سقف المبلغ للعملية الواحدة (اختياري)')}</span>
          <input dir="ltr" inputMode="numeric" value={limit} placeholder={t('اتركه فارغًا بلا سقف')} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ''))} className={input} />
        </label>
      )}
      <label className="mt-3 flex items-start gap-3 rounded-inner bg-field px-3 py-3">
        <input type="checkbox" checked={perms.has(NEEDS_APPROVAL)} onChange={() => toggle(NEEDS_APPROVAL)} className="mt-1 size-5 accent-brand" />
        <span>
          <span className="block text-[13px] font-extrabold text-title">{t('يتطلب موافقة المالك')}</span>
          <span className="block text-[11.5px] text-sub">
            {t(perms.has(NEEDS_APPROVAL) ? 'ما يدخله المفوَّض يُرسل للمالك ولا يُعتمد إلا بعد موافقته.' : 'المفوَّض يكتب ويعتمد مباشرة بلا موافقة المالك.')}
          </span>
        </span>
      </label>

      {section('4. مدة التفويض')}
      <div className="flex flex-wrap gap-1.5">
        {DURATIONS.map(([label, days]) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setDurationPreset(label)
              if (days > 0) {
                const s = fromInput(start)
                setEnd(toInput(new Date(s.getFullYear(), s.getMonth(), s.getDate() + days)))
              }
            }}
            className={cn('h-9 rounded-full border px-3 text-[12px] font-bold', durationPreset === label ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-sub')}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('تاريخ البداية')}</span>
          <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-sub">{t('تاريخ النهاية')}</span>
          <input type="date" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} className={input} />
        </label>
      </div>

      {section('5. الغرض من التفويض')}
      <textarea dir="auto" rows={2} value={notes} placeholder={t('مثال: متابعة تحصيل الإيجار أثناء سفري (اختياري)')} onChange={(e) => setNotes(e.target.value)} className={`${input} h-auto py-2.5`} />

      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        onClick={() => {
          const problem = check()
          if (problem) return setError(problem)
          setError('')
          setConfirming(true)
        }}
        className="mt-5 flex w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark"
      >
        {t(existing ? 'حفظ التعديل' : 'حفظ التفويض')}
      </button>
      <Confirm
        open={confirming}
        title={existing ? 'حفظ التعديل' : 'حفظ التفويض'}
        message={`«${name.trim()}» — ${t(existing ? 'هل تريد حفظ تعديل هذا التفويض؟' : 'هل تريد حفظ هذا التفويض؟')}`}
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
      <Sheet open={picking} onClose={() => setPicking(false)}>
        <p className="text-[17px] font-extrabold text-title">{t('جلب من الأفراد')}</p>
        <div className="mt-3 flex max-h-96 flex-col gap-1 overflow-y-auto">
          {peopleList.length === 0 && <p className="py-3 text-center text-[12px] text-muted">{t('لا يوجد أفراد بعد في «الأفراد والجهات»')}</p>}
          {peopleList.map((p) => {
            const id = String(p.details?.['الرقم التعريفي'] ?? '').trim()
            return (
              <button
                key={p.fullName}
                type="button"
                onClick={() => {
                  setName(p.fullName.trim())
                  if (id) setFnd(id)
                  setPicking(false)
                }}
                className="flex flex-col rounded-inner px-3 py-2 text-start hover:bg-line/60"
              >
                <span className="text-[13px] font-bold text-ink">{p.fullName}</span>
                <span className="text-[11px] text-muted">
                  {t(String(p.categoryName ?? ''))}
                  {id ? ` · ${id}` : ''}
                </span>
              </button>
            )
          })}
        </div>
      </Sheet>
      {targetsFor && (
        <TargetsPicker
          main={main}
          sub={targetsFor}
          uid={uid}
          selected={targets.filter((x) => x.sub === targetsFor)}
          onClose={() => setTargetsFor(null)}
          onDone={(picked) => {
            setTargets((x) => [...x.filter((y) => y.sub !== targetsFor), ...picked])
            setTargetsFor(null)
          }}
        />
      )}
    </Sheet>
  )
}

/** اختيار عناصر بعينها داخل القسم الفرعي (عهدة، رحلة، فرد، عقار، وحدة...). */
function TargetsPicker({ main, sub, uid, selected, onClose, onDone }: { main: string; sub: string; uid: string; selected: Target[]; onClose: () => void; onDone: (picked: Target[]) => void }) {
  const { t } = useI18n()
  const q = useQuery({ queryKey: ['delegation-targets', main, sub, uid], queryFn: () => loadTargets(main, sub, uid) })
  const [picked, setPicked] = useState<Map<string, Target>>(() => new Map(selected.map((x) => [targetKey(x), x])))
  const [search, setSearch] = useState('')
  const list = useMemo(() => (q.data ?? []).filter((x) => !search.trim() || x.label.includes(search.trim()) || (x.subtitle ?? '').includes(search.trim())), [q.data, search])
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">
        {t('عناصر محددة')} — {t(sub)}
      </p>
      <p className="mt-0.5 text-[11.5px] text-muted">{t('اتركها فارغة ليشمل التفويض القسم كاملًا.')}</p>
      <input dir="auto" value={search} placeholder={t('بحث')} onChange={(e) => setSearch(e.target.value)} className={cn(input, 'mt-3')} />
      <div className="mt-2 flex max-h-96 flex-col gap-1 overflow-y-auto">
        {q.isLoading ? (
          <Loading />
        ) : list.length === 0 ? (
          <p className="py-3 text-center text-[12px] text-muted">{t('لا توجد عناصر')}</p>
        ) : (
          list.map((x) => {
            const on = picked.has(targetKey(x))
            return (
              <label key={targetKey(x)} className={cn('flex cursor-pointer items-start gap-3 rounded-inner px-3 py-2', on ? 'bg-brand-soft' : 'hover:bg-line/60', x.kind === 'unit' && 'ms-5')}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setPicked((m) => {
                      const next = new Map(m)
                      if (next.has(targetKey(x))) next.delete(targetKey(x))
                      else next.set(targetKey(x), { sub: x.sub, kind: x.kind, id: x.id, label: x.label })
                      return next
                    })
                  }
                  className="mt-1 size-4 accent-brand"
                />
                <span>
                  <span dir="auto" className="block text-[13px] font-bold text-ink">
                    {x.label}
                  </span>
                  {x.subtitle && <span className="block text-[11px] text-muted">{x.subtitle}</span>}
                </span>
              </label>
            )
          })
        )}
      </div>
      <button type="button" onClick={() => onDone([...picked.values()])} className="mt-4 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white">
        {t('اعتماد')} ({picked.size})
      </button>
    </Sheet>
  )
}

