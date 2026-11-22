import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, ClipboardList, FileText, Loader2, MapPin, Paperclip, Pencil, Plus, Trash2, UserMinus, UserPlus, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { useStore, type Entry } from '@/lib/data'
import { errorText } from '@/lib/supabase'
import { publicName as publicNameOf } from '@/lib/requestsWrite'
import { iAmManager, withoutFnd } from '@/lib/shared'
import { FileError, uploadDeviceFile } from '@/lib/files'
import {
  DOCS_KEY_SHARED,
  DOC_BY_KEY,
  FOLLOW_KEY_SHARED,
  PLACES_KEY_SHARED,
  SHARED_FOLLOW_KINDS,
  SharedError,
  deleteSimpleEntry,
  roscaAddMember,
  roscaRemovable,
  roscaRemoveBlocked,
  roscaRemoveMember,
  roscaTurnOf,
  saveSimpleEntry,
  simpleEntries,
  toggleSimpleDone,
  type SimpleEntry,
} from '@/lib/sharedWrite'
import { Confirm } from './Confirm'
import { FileButton } from './FileButton'
import { MemberPicker } from './SharedEditor'
import { Sheet } from './ui'

/*
  من تفاصيل الالتزام المشترك في التطبيق (shared_commitments_screen.dart):
  - أعضاء تحديد الأدوار (_openRoscaMemberActions): إضافة عضو، وإلغاء عضو لم
    يسجّل دفعات ولم يستلم دوره (تُبنى الدورات بعدد الباقين).
  - «المتابعة والتخطيط» و«مستندات» و«مواقع وأماكن» (_buildSimpleListTab و
    _openSimpleEntrySheet): قوائم {kind,title,note,date,extra} داخل التفاصيل.
    المتابعة تُضاف وتُعدَّل وتُكمَّل وتُحذف؛ المستند والموقع يُضافان.
*/

const CLOSED = ['مؤرشف', 'ملغاة', 'ملغية', 'محذوف']
const input = 'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'
const fail = (e: unknown) => (e instanceof SharedError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
const toDmy = (v: string) => {
  if (!v) return ''
  const [y, m, d] = v.split('-').map((x) => parseInt(x, 10))
  return `${d}/${m}/${y}`
}
const fromDmy = (v: string) => {
  const p = v.trim().split('/')
  if (p.length !== 3) return ''
  const [d, m, y] = p.map((x) => parseInt(x, 10))
  if ([d, m, y].some(Number.isNaN)) return ''
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function useMe() {
  const { profile } = useSession()
  const store = useStore()
  const fnd = profile?.fnd_id ?? ''
  const full = String(store.data?.['settings_profile_name'] ?? '').trim() || profile?.display_name || ''
  const shown = publicNameOf(store.data, profile?.display_name ?? '')
  return { fnd, myNames: [full, shown].filter(Boolean) }
}

// ---------------- أعضاء تحديد الأدوار ----------------

export function RoscaMemberActions({ entry, onChanged }: { entry: Entry; onChanged: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const me = useMe()
  const details = entry.details ?? {}
  const [menu, setMenu] = useState(false)
  const [picking, setPicking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [ask, setAsk] = useState<{ mode: 'add' | 'remove'; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (CLOSED.includes(entry.status) || !iAmManager(details, me.fnd, me.myNames)) return null
  const shown = (n: string) => withoutFnd(n) || n
  const candidates = roscaRemovable(details)

  async function run() {
    if (!ask) return
    setBusy(true)
    setError('')
    try {
      if (ask.mode === 'add') await roscaAddMember(entry, ask.name, me.fnd, me.myNames)
      else await roscaRemoveMember(entry, ask.name, me.fnd, me.myNames)
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setAsk(null)
      onChanged(ask.mode === 'add' ? 'تمت إضافة العضو' : 'تم إلغاء العضو')
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
          <button
            type="button"
            onClick={() => {
              setMenu(false)
              setPicking(true)
            }}
            className="flex h-12 items-center gap-2 rounded-inner border border-line bg-white px-3 text-[13.5px] font-extrabold text-title hover:border-brand"
          >
            <UserPlus className="size-4 text-brand" />
            {t('إضافة عضو جديد')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false)
              setError('')
              setRemoving(true)
            }}
            className="flex h-12 items-center gap-2 rounded-inner border border-line bg-white px-3 text-[13.5px] font-extrabold text-title hover:border-danger"
          >
            <UserMinus className="size-4 text-danger" />
            {t('إلغاء عضو')}
          </button>
        </div>
      </Sheet>
      <MemberPicker
        open={picking}
        me={me.fnd}
        exclude={[]}
        onClose={() => setPicking(false)}
        onPick={(n) => {
          setPicking(false)
          setError('')
          setAsk({ mode: 'add', name: n.trim() })
        }}
      />
      <Sheet open={removing} onClose={() => setRemoving(false)}>
        <p className="text-[17px] font-extrabold text-title">{t('من تريد إلغاءه؟')}</p>
        <div className="mt-3 flex flex-col gap-1.5">
          {candidates.length === 0 && <p className="py-3 text-center text-[12px] text-muted">{t('لا يوجد عضو يمكن إلغاؤه')}</p>}
          {candidates.map((n) => {
            const blocked = roscaRemoveBlocked(details, n)
            return (
              <button
                key={n}
                type="button"
                disabled={blocked}
                onClick={() => {
                  setRemoving(false)
                  setError('')
                  setAsk({ mode: 'remove', name: n })
                }}
                className="flex items-center justify-between rounded-inner border border-line bg-white px-3 py-2.5 text-start disabled:opacity-50"
              >
                <span className="text-[13px] font-bold text-ink">{shown(n)}</span>
                <span className="text-[11px] text-muted">
                  {blocked ? t('سجّل دفعات أو استلم دوره') : `${t('الدورة رقم')}: ${roscaTurnOf(details, n) ?? '—'}`}
                </span>
              </button>
            )
          })}
        </div>
      </Sheet>
      <Confirm
        open={!!ask}
        title={ask?.mode === 'add' ? 'إضافة عضو جديد' : 'إلغاء عضو'}
        message={
          ask?.mode === 'add'
            ? `${t('هل تريد إضافة')} ${shown(ask?.name ?? '')} ${t('إلى الأعضاء؟')}`
            : `${t('هل تريد إلغاء')} ${shown(ask?.name ?? '')} ${t('من الأعضاء؟ تُبنى الدورات من جديد بعدد الأعضاء الباقين.')}`
        }
        confirmLabel="تأكيد"
        danger={ask?.mode === 'remove'}
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={() => setAsk(null)}
      />
    </>
  )
}

// ---------------- المتابعة والمستندات والمواقع ----------------

type FormState = { section: string; kind: string; at?: number; was?: SimpleEntry }

export function SharedSimpleSections({ entry, onChanged }: { entry: Entry; onChanged: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const me = useMe()
  const details = entry.details ?? {}
  const writable = !CLOSED.includes(entry.status)
  const manager = iAmManager(details, me.fnd, me.myNames)
  // «مشاهدة المستندات: المسؤول فقط»: العضو يرى ما أضافه هو فقط.
  const docsManagerOnly = String(details['مشاهدة المستندات'] ?? '').trim() === 'المسؤول فقط' && !manager
  const [form, setForm] = useState<FormState | null>(null)
  const [kindPick, setKindPick] = useState(false)
  const [viewing, setViewing] = useState<SimpleEntry | null>(null)
  const [task, setTask] = useState<{ mode: 'done' | 'delete'; at: number; e: SimpleEntry } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const sections = [
    { key: FOLLOW_KEY_SHARED, title: 'المتابعة والتخطيط', icon: ClipboardList, empty: 'لا توجد عناصر متابعة أو مهام بعد' },
    { key: DOCS_KEY_SHARED, title: 'مستندات', icon: FileText, empty: 'لا توجد مستندات بعد' },
    { key: PLACES_KEY_SHARED, title: 'مواقع وأماكن', icon: MapPin, empty: 'لا توجد مواقع أو أماكن بعد' },
  ]

  async function runTask() {
    if (!task) return
    setBusy(true)
    setError('')
    try {
      if (task.mode === 'done') await toggleSimpleDone(entry, FOLLOW_KEY_SHARED, task.at, task.e, t)
      else await deleteSimpleEntry(entry, FOLLOW_KEY_SHARED, task.at, task.e, t)
      await qc.invalidateQueries({ queryKey: ['shared'] })
      const wasDone = (task.e.extra['الحالة'] ?? '') === 'مكتملة'
      setTask(null)
      onChanged(task.mode === 'delete' ? 'تم الحذف' : wasDone ? 'تم إلغاء الاكتمال' : 'تم تحديده كمكتمل')
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {sections.map((s) => {
        const stored = simpleEntries(details, s.key)
        const rows = stored
          .map((e, at) => ({ e, at }))
          .reverse()
          .filter(({ e }) => s.key !== DOCS_KEY_SHARED || !docsManagerOnly || (e.extra[DOC_BY_KEY] ?? '') === me.fnd)
        if (!rows.length && !writable) return null
        const Icon = s.icon
        return (
          <div key={s.key} className="mt-5">
            <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
              <span className="h-4 w-1 rounded-full bg-gold" />
              {t(s.title)}
              {rows.length > 0 && <span className="rounded-full bg-surface px-2 text-[11px] text-sub">{rows.length}</span>}
              {writable && (
                <button
                  type="button"
                  aria-label={t('إضافة')}
                  onClick={() => {
                    setError('')
                    if (s.key === FOLLOW_KEY_SHARED) setKindPick(true)
                    else setForm({ section: s.key, kind: s.key === DOCS_KEY_SHARED ? 'مستند' : '' })
                  }}
                  className="ms-auto flex size-8 items-center justify-center rounded-inner bg-brand text-white hover:bg-brand-dark"
                >
                  <Plus className="size-4" />
                </button>
              )}
            </p>
            {s.key === DOCS_KEY_SHARED && docsManagerOnly && (
              <p className="mb-2 rounded-inner bg-gold-soft px-3 py-2 text-[11.5px] font-bold text-gold-dark">
                {t('مستندات هذا الالتزام يشاهدها المسؤول فقط — تظهر لك هنا المستندات التي أضفتها أنت (مثل هويتك).')}
              </p>
            )}
            <div className="flex flex-col gap-2 rounded-inner bg-surface p-2">
              {rows.length === 0 && <p className="py-3 text-center text-[12px] text-muted">{t(s.empty)}</p>}
              {rows.map(({ e, at }) => {
                const done = (e.extra['الحالة'] ?? '') === 'مكتملة'
                return (
                  <div key={at} className="card-inner flex items-center gap-2 px-3 py-2">
                    <Icon className="size-4 shrink-0 text-brand" />
                    <button type="button" onClick={() => setViewing(e)} className="min-w-0 flex-1 text-start">
                      <p dir="auto" className={`text-[13px] font-extrabold text-title ${done ? 'line-through' : ''}`}>
                        {e.title}
                      </p>
                      {done && <p className="text-[10.5px] font-bold text-brand">{t('مكتملة')}</p>}
                      <p dir="auto" className="truncate text-[11px] text-muted">
                        {t(e.kind)}
                        {e.date ? ` · ${e.date}` : ''}
                        {e.note ? ` · ${e.note}` : ''}
                      </p>
                    </button>
                    {e.extra['المرفق'] && <Paperclip className="size-4 shrink-0 text-brand" />}
                    {s.key === FOLLOW_KEY_SHARED && writable && (
                      <span className="flex shrink-0 items-center">
                        <button type="button" title={t(done ? 'إلغاء الاكتمال' : 'اكتمال')} onClick={() => (setError(''), setTask({ mode: 'done', at, e }))} className="p-1.5 text-brand">
                          {done ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                        </button>
                        <button type="button" title={t('تعديل')} onClick={() => (setError(''), setForm({ section: s.key, kind: e.kind, at, was: e }))} className="p-1.5 text-brand">
                          <Pencil className="size-4" />
                        </button>
                        <button type="button" title={t('حذف')} onClick={() => (setError(''), setTask({ mode: 'delete', at, e }))} className="p-1.5 text-danger">
                          <Trash2 className="size-4" />
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <Sheet open={kindPick} onClose={() => setKindPick(false)}>
        <p className="text-[17px] font-extrabold text-title">{t('المتابعة والتخطيط')}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {SHARED_FOLLOW_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKindPick(false)
                setForm({ section: FOLLOW_KEY_SHARED, kind: k })
              }}
              className="h-12 rounded-inner border border-line bg-white text-[13px] font-bold text-ink hover:border-brand hover:text-brand"
            >
              {t(k)}
            </button>
          ))}
        </div>
      </Sheet>

      {form && <SimpleForm entry={entry} form={form} me={me.fnd} onClose={() => setForm(null)} onDone={(m) => (setForm(null), onChanged(m))} />}

      <Sheet open={!!viewing} onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <p dir="auto" className="text-[18px] font-extrabold text-title">
              {viewing.title}
            </p>
            <div className="mt-3 flex flex-col gap-1">
              {[
                ['النوع', viewing.kind] as [string, string],
                ...(viewing.date ? [['التاريخ', viewing.date] as [string, string]] : []),
                ...Object.entries(viewing.extra).filter(([k, v]) => v.trim() && k !== 'المرفق' && k !== 'صورة المكان' && !k.startsWith('__')),
                ...(viewing.note && !Object.values(viewing.extra).includes(viewing.note) ? [['ملاحظات', viewing.note] as [string, string]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-line py-2 text-[12.5px]">
                  <span className="text-sub">{t(k)}</span>
                  <span dir="auto" className="text-end font-bold text-ink">
                    {/^https?:\/\//.test(v) ? (
                      <a href={v} target="_blank" rel="noreferrer" className="text-brand underline">
                        {v}
                      </a>
                    ) : (
                      t(v)
                    )}
                  </span>
                </div>
              ))}
            </div>
            {viewing.extra['المرفق'] && <FileButton className="mt-3" file={{ localPath: viewing.extra['المرفق'] }} label="فتح المرفق" />}
            {viewing.extra['صورة المكان'] && <FileButton className="mt-2" file={{ localPath: viewing.extra['صورة المكان'] }} label="صورة المكان" />}
          </>
        )}
      </Sheet>

      <Confirm
        open={!!task}
        title={task?.mode === 'delete' ? 'حذف' : 'تأكيد'}
        message={
          task?.mode === 'delete'
            ? `«${task?.e.title ?? ''}» — ${t('سيُحذف نهائيًا. هل تريد الحذف؟')}`
            : (task?.e.extra['الحالة'] ?? '') === 'مكتملة'
              ? `«${task?.e.title ?? ''}» — ${t('هل تريد إلغاء الاكتمال؟')}`
              : `«${task?.e.title ?? ''}» — ${t('هل تريد تحديده كمكتمل؟')}`
        }
        confirmLabel={task?.mode === 'delete' ? 'حذف' : 'تأكيد'}
        danger={task?.mode === 'delete'}
        busy={busy}
        error={error}
        onConfirm={runTask}
        onCancel={() => setTask(null)}
      />
    </>
  )
}

const LEADS = ['قبل يوم', 'قبل 12 ساعة', 'قبل ساعة', 'مخصص بالساعات', 'مخصص بالأيام']
const REPEATS = ['بدون تكرار', 'يومي', 'أسبوعي', 'شهري']
const DOC_REMINDERS = ['بدون تذكير', 'قبل أسبوع', 'قبل شهر', 'قبل شهرين']
const PLACE_CATEGORIES = ['المنزل', 'العمل', 'مطعم', 'صديق', 'عميل', 'مهم']

/** reminderLeadSplit */
function splitLead(stored: string): [string, string] {
  const s = stored.trim()
  if (!s) return ['', '']
  if (LEADS.includes(s)) return [s, '']
  const m = /قبل\s*(\d+)\s*(ساعة|ساعات|يوم|أيام)/.exec(s)
  if (!m) return ['', '']
  return [m[2].startsWith('ساع') ? 'مخصص بالساعات' : 'مخصص بالأيام', m[1]]
}
/** reminderLeadValue */
function leadValue(option: string, number: string): string {
  const n = parseInt(number.trim(), 10) || 0
  if (option === 'مخصص بالساعات') return n > 0 ? `قبل ${n} ساعة` : ''
  if (option === 'مخصص بالأيام') return n > 0 ? `قبل ${n} يوم` : ''
  return option
}

function SimpleForm({ entry, form, me, onClose, onDone }: { entry: Entry; form: FormState; me: string; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const isFollow = form.section === FOLLOW_KEY_SHARED
  const isDoc = form.section === DOCS_KEY_SHARED
  const was = form.was
  const [v, setV] = useState<Record<string, string>>(() => ({
    title: was?.title ?? '',
    desc: was?.extra['الوصف'] ?? '',
    date: was ? fromDmy(was.date) : '',
    time: was?.extra['الوقت'] ?? '',
    notes: was?.extra['ملاحظات'] ?? '',
    number: '',
    issuer: '',
    issued: '',
    expiry: '',
    reminder: '',
    link: '',
    address: '',
    category: '',
    categoryCustom: '',
  }))
  const [remind, setRemind] = useState((was?.extra['تفعيل تذكير'] ?? '') === 'نعم')
  const [lead, setLead] = useState(() => splitLead(was?.extra['وقت التذكير'] ?? ''))
  const [repeat, setRepeat] = useState(() => {
    const r = was?.extra['التكرار'] ?? ''
    return r && !REPEATS.includes(r) ? ['مخصص', r] : [r, '']
  })
  const [file, setFile] = useState(was?.extra['المرفق'] ?? '')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k: string, value: string) => setV((x) => ({ ...x, [k]: value }))
  const label = isFollow ? form.kind : isDoc ? 'مستند' : 'مواقع وأماكن'

  function build(): SimpleEntry | string {
    const val = (k: string) => (v[k] ?? '').trim()
    const clean = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, x]) => x.trim()).map(([k, x]) => [k, x.trim()]))
    if (!val('title')) return 'أكمل الحقول المطلوبة'
    if (isFollow) {
      if (!val('date')) return 'أكمل الحقول المطلوبة'
      const rep = repeat[0] === 'مخصص' ? repeat[1].trim() : repeat[0]
      return {
        kind: form.kind,
        title: val('title'),
        note: val('notes') || val('desc'),
        date: toDmy(val('date')),
        extra: clean({
          الوصف: val('desc'),
          الوقت: val('time'),
          ...(remind ? { 'تفعيل تذكير': 'نعم', التكرار: rep, 'وقت التذكير': leadValue(lead[0], lead[1]) } : {}),
          ملاحظات: val('notes'),
          المرفق: file,
        }),
      }
    }
    if (isDoc) {
      if (!val('expiry')) return 'أكمل الحقول المطلوبة'
      return {
        kind: 'مستند',
        title: val('title'),
        note: val('notes'),
        date: toDmy(val('expiry')),
        extra: clean({
          'رقم المستند': val('number'),
          'الجهة المصدرة': val('issuer'),
          'تاريخ الإصدار': toDmy(val('issued')),
          'تاريخ الانتهاء': toDmy(val('expiry')),
          تذكير: val('reminder'),
          المرفق: file,
          [DOC_BY_KEY]: me,
        }),
      }
    }
    const category = val('category') === '+ إضافة أخرى' ? val('categoryCustom') : val('category')
    if (!val('link') || !category) return 'أكمل الحقول المطلوبة'
    return {
      kind: category,
      title: val('title'),
      note: val('notes'),
      date: '',
      extra: clean({ 'الموقع أو الرابط': val('link'), العنوان: val('address'), التصنيف: category, المرفق: file }),
    }
  }

  async function save() {
    const item = build()
    if (typeof item === 'string') return
    setBusy(true)
    setError('')
    try {
      await saveSimpleEntry(entry, form.section, item, was && form.at !== undefined ? { at: form.at, was } : undefined)
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setConfirming(false)
      onDone(was ? 'تم حفظ التعديل' : isFollow ? `${t('تم حفظ')} ${t(form.kind)}` : isDoc ? 'تم حفظ المستند' : 'تم حفظ الموقع')
    } catch (e) {
      setConfirming(false)
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }

  const text = (k: string, title: string, opts: { required?: boolean; area?: boolean; hint?: string; wide?: boolean } = {}) => (
    <label className={`flex flex-col gap-1 ${opts.wide === false ? '' : 'col-span-2'}`}>
      <span className="text-[12px] font-bold text-sub">
        {t(title)}
        {opts.required && <span className="text-danger"> *</span>}
      </span>
      {opts.area ? (
        <textarea dir="auto" rows={3} value={v[k]} placeholder={opts.hint} onChange={(e) => set(k, e.target.value)} className={`${input} h-auto py-2.5`} />
      ) : (
        <input dir="auto" value={v[k]} placeholder={opts.hint} onChange={(e) => set(k, e.target.value)} className={input} />
      )}
    </label>
  )
  const dateIn = (k: string, title: string, required = false) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-sub">
        {t(title)}
        {required && <span className="text-danger"> *</span>}
      </span>
      <input type="date" value={v[k]} onChange={(e) => set(k, e.target.value)} className={input} />
    </label>
  )
  const select = (k: string, title: string, options: string[], required = false) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-sub">
        {t(title)}
        {required && <span className="text-danger"> *</span>}
      </span>
      <select value={v[k]} onChange={(e) => set(k, e.target.value)} className={input}>
        <option value="">{t('اختر')}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {t(o)}
          </option>
        ))}
      </select>
    </label>
  )

  const built = build()
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[18px] font-extrabold text-title">
        {was ? `${t('تعديل')} — ${t(label)}` : `${t('إضافة')} ${t(label)}`}
      </p>
      <p className="mt-0.5 text-[12px] text-muted">{t(isFollow ? 'متابعة وتخطيط ضمن هذا الالتزام' : isDoc ? 'وثيقة أو عقد أو ملف مهم' : 'حفظ مكان مهم وبيانات الوصول إليه')}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {isFollow && (
          <>
            {text('title', 'العنوان', { required: true })}
            {text('desc', 'الوصف', { area: true, hint: `${t('أوصف')} ${t(label)}` })}
            {dateIn('date', 'التاريخ', true)}
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-sub">{t('الوقت')}</span>
              <input type="time" value={v.time} onChange={(e) => set('time', e.target.value)} className={input} />
            </label>
            <label className="col-span-2 flex h-12 items-center justify-between rounded-field bg-field px-3">
              <span className="text-[13px] font-extrabold text-title">{t('تفعيل تذكير')}</span>
              <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} className="size-5 accent-brand" />
            </label>
            {remind && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-bold text-sub">{t('وقت التذكير')}</span>
                  <select value={lead[0]} onChange={(e) => setLead([e.target.value, lead[1]])} className={input}>
                    <option value="">{t('اختر')}</option>
                    {LEADS.map((o) => (
                      <option key={o} value={o}>
                        {t(o)}
                      </option>
                    ))}
                  </select>
                  {lead[0].startsWith('مخصص') && (
                    <input
                      inputMode="numeric"
                      dir="ltr"
                      value={lead[1]}
                      placeholder={t(lead[0] === 'مخصص بالساعات' ? 'كم ساعة قبل الموعد؟' : 'كم يومًا قبل الموعد؟')}
                      onChange={(e) => setLead([lead[0], e.target.value.replace(/[^0-9]/g, '')])}
                      className={input}
                    />
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-bold text-sub">{t('التكرار')}</span>
                  <select value={repeat[0]} onChange={(e) => setRepeat([e.target.value, repeat[1]])} className={input}>
                    <option value="">{t('اختر')}</option>
                    {[...REPEATS, 'مخصص'].map((o) => (
                      <option key={o} value={o}>
                        {t(o)}
                      </option>
                    ))}
                  </select>
                  {repeat[0] === 'مخصص' && <input dir="auto" value={repeat[1]} placeholder={t('مثال: كل 3 أيام')} onChange={(e) => setRepeat(['مخصص', e.target.value])} className={input} />}
                </label>
              </>
            )}
            {text('notes', 'ملاحظات', { area: true })}
          </>
        )}
        {isDoc && (
          <>
            {text('title', 'اسم المستند', { required: true })}
            {text('number', 'رقم المستند', { wide: false })}
            {text('issuer', 'الجهة المصدرة', { wide: false })}
            {dateIn('issued', 'تاريخ الإصدار')}
            {dateIn('expiry', 'تاريخ الانتهاء', true)}
            {select('reminder', 'تذكير', DOC_REMINDERS)}
            <span />
            {text('notes', 'ملاحظات', { area: true })}
          </>
        )}
        {!isFollow && !isDoc && (
          <>
            {text('title', 'اسم المكان', { required: true })}
            {text('link', 'الموقع أو الرابط', { required: true, hint: 'https://maps.google.com/…' })}
            {text('address', 'العنوان')}
            {select('category', 'التصنيف', [...PLACE_CATEGORIES, '+ إضافة أخرى'], true)}
            {v.category === '+ إضافة أخرى' ? text('categoryCustom', 'التصنيف — القيمة الجديدة', { required: true, wide: false }) : <span />}
            {text('notes', 'ملاحظات', { area: true })}
          </>
        )}
        <div className="col-span-2">
          {file ? (
            <span className="flex h-11 items-center justify-between gap-2 rounded-field bg-field px-3 text-[12.5px] font-bold text-ink">
              <span className="flex min-w-0 items-center gap-1.5">
                <Paperclip className="size-4 shrink-0 text-brand" />
                <span className="truncate" dir="auto">
                  {file.split(/[\\/]/).pop()}
                </span>
              </span>
              <button type="button" aria-label={t('إزالة')} onClick={() => setFile('')} className="text-danger">
                <X className="size-4" />
              </button>
            </span>
          ) : (
            <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-field border border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft">
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
              {t('إرفاق مستند')}
              <input
                type="file"
                className="hidden"
                accept="image/*,application/pdf"
                disabled={uploading}
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  setUploading(true)
                  setError('')
                  try {
                    setFile(await uploadDeviceFile(f))
                  } catch (err) {
                    setError(err instanceof FileError ? err.message : 'تعذّر رفع الملف. حاول مرة أخرى.')
                  } finally {
                    setUploading(false)
                  }
                }}
              />
            </label>
          )}
        </div>
      </div>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <button
        type="button"
        disabled={uploading}
        onClick={() => {
          const b = build()
          if (typeof b === 'string') return setError(b)
          setError('')
          setConfirming(true)
        }}
        className="mt-5 flex w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {t('حفظ')}
      </button>
      <Confirm
        open={confirming}
        title="تأكيد الحفظ"
        message={`«${typeof built === 'string' ? '' : built.title}» — ${t('هل تريد الحفظ؟')}`}
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </Sheet>
  )
}
