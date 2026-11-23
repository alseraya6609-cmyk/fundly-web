import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, BadgeCheck, ChevronLeft, ChevronRight, Crown, Paperclip, Plus, Search, UserPlus, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn, money } from '@/lib/format'
import { errorText } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { useCurrency, usePeople, useStore, type Entry } from '@/lib/data'
import { sharedLabel } from '@/lib/catalog'
import { publicName } from '@/lib/requestsWrite'
import { isValidFnd, nameForFnd, normalizeFnd } from '@/lib/personalWrite'
import { parseMoney, withoutFnd } from '@/lib/shared'
import {
  APPROVAL_KEY,
  BUDGET_ALERT_KEY,
  BUDGET_ALERT_OPTIONS,
  COLLECT_HINTS,
  COLLECT_KEY,
  INDIVIDUAL,
  LUMP_SUM,
  SHARED_FORMS,
  SharedFormError,
  createShared,
  initialShared,
  orderedPeople,
  peopleOf,
  updateShared,
  validateShared,
  type SharedField,
  type SharedFormDef,
  type SharedValues,
} from '@/lib/sharedForm'
import { Confirm } from './Confirm'
import { FndCopy, fndIn } from './FndCopy'
import { Sheet } from './ui'
import { namedFile } from '@/components/DocName'

/*
  نموذج الالتزام المشترك (_openSharedEntryForm): الأنواع الثلاثة بحقولها،
  والمسؤول والأعضاء من «الأفراد» أو اسم جديد أو بالرقم التعريفي (يُدعى
  صاحبه)، وطريقة تحصيل المبلغ ومساهمة كل عضو، وترتيب الاستلام في الجمعية.
*/

const inputClass =
  'h-12 w-full rounded-field border border-line bg-field px-3 text-[13.5px] font-bold text-title outline-none placeholder:font-semibold placeholder:text-muted focus:border-gold'
const toInputDate = (value: string) => {
  const p = value.split('/')
  if (p.length !== 3) return ''
  const [d, m, y] = p.map((x) => parseInt(x, 10))
  if ([d, m, y].some(Number.isNaN)) return ''
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const fromInputDate = (value: string) => {
  if (!value) return ''
  const [y, m, d] = value.split('-').map((x) => parseInt(x, 10))
  return `${d}/${m}/${y}`
}
const shown = (n: string) => withoutFnd(n) || n

/**
  _pickSharedPerson: بالرقم التعريفي، أو من الأفراد، أو اسم جديد.
  رقمي أنا: الزر «إضافة» — يضيفني إن لم أكن في القائمة ([meEntry])، وإلا
  رسالة أني مضاف (والمدير يُضاف مرة واحدة). ومن في القائمة لا يُضاف ثانية.
*/
export function MemberPicker({
  open,
  me,
  exclude,
  meEntry,
  managerWord = 'مسؤولًا',
  onPick,
  onClose,
}: {
  open: boolean
  me: string
  exclude: string[]
  meEntry?: string
  managerWord?: string
  onPick: (name: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const people = usePeople()
  const [fnd, setFnd] = useState('')
  const [found, setFound] = useState('')
  const [looking, setLooking] = useState(false)
  const [search, setSearch] = useState('')
  const [stress, setStress] = useState('')
  useEffect(() => {
    if (!open) {
      setFnd('')
      setFound('')
      setSearch('')
      setStress('')
    }
  }, [open])
  useEffect(() => setStress(''), [fnd])
  useEffect(() => {
    const id = normalizeFnd(fnd)
    setFound('')
    if (!isValidFnd(id) || id === me) return
    let alive = true
    setLooking(true)
    nameForFnd(id).then((name) => {
      if (!alive) return
      setLooking(false)
      setFound(name)
    })
    return () => {
      alive = false
    }
  }, [fnd, me])
  const names = (people.data ?? []).map((p) => p.fullName.trim()).filter((n) => n && n !== 'أنا')
  const q = search.trim()
  const list = names.filter((n) => n.includes(q) && !exclude.includes(n))
  const id = normalizeFnd(fnd)
  const isSelf = isValidFnd(id) && !!me && id === me
  const isMine = (e: string) => (!!meEntry && e.trim() === meEntry.trim()) || (!!me && fndIn(e) === me)
  const selfIn = exclude.some(isMine)
  const canAddSelf = isSelf && !selfIn && !!meEntry
  const selfNote = !isSelf
    ? ''
    : canAddSelf
      ? t('هذا رقمك التعريفي — اضغط «إضافة» لإضافة نفسك')
      : selfIn && exclude.length && isMine(exclude[0])
        ? `${t('هذا رقمك التعريفي — أنت مُضاف تلقائيًا')} ${t(managerWord)}${t('، ويُضاف كل شخص مرة واحدة فقط.')}`
        : selfIn
          ? t('هذا رقمك التعريفي — أنت مُضاف في القائمة، ويُضاف كل شخص مرة واحدة فقط.')
          : t('هذا رقمك التعريفي — اكتب رقم الشخص الآخر')
  const foundDup = !!found && exclude.some((e) => fndIn(e) === id)
  return (
    <Sheet open={open} onClose={onClose}>
      <p className="text-[17px] font-extrabold text-title">{t('اختيار شخص')}</p>
      <div className="mt-3 rounded-inner bg-field p-3">
        <p className="mb-1 text-[12px] font-bold text-sub">{t('الرقم التعريفي')}</p>
        <input dir="ltr" value={fnd} placeholder="FND-XXXX-XXXX" onChange={(e) => setFnd(e.target.value)} className={cn(inputClass, 'bg-white')} />
        {isSelf && (
          <>
            <p className={cn('mt-2 rounded-inner px-3 py-2 text-[12px] font-bold leading-relaxed', stress ? 'bg-danger-soft text-danger' : 'bg-gold-soft text-gold-dark')}>{selfNote}</p>
            <button
              type="button"
              onClick={() => (canAddSelf ? onPick(meEntry!) : setStress(selfNote))}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-field bg-brand text-[13px] font-extrabold text-white hover:bg-brand-dark"
            >
              <Plus className="size-4" />
              {t('إضافة')}
            </button>
          </>
        )}
        {isValidFnd(id) && !isSelf && !looking && !found && <p className="mt-1 text-[11.5px] text-muted">{t('لا يوجد حساب بهذا الرقم')}</p>}
        {found && !isSelf && (
          <>
            {foundDup && stress && <p className="mt-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{stress}</p>}
            <button
              type="button"
              onClick={() => (foundDup ? setStress(`${t('مُضاف مسبقًا في القائمة')}: ${found}`) : onPick(`${found} (${id})`))}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-field bg-brand text-[13px] font-extrabold text-white hover:bg-brand-dark"
            >
              <BadgeCheck className="size-4" />
              {found} ({id})
            </button>
          </>
        )}
      </div>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" />
        <input dir="auto" value={search} placeholder={t('ابحث في الأفراد')} onChange={(e) => setSearch(e.target.value)} className={cn(inputClass, 'ps-9')} />
      </div>
      <div className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto">
        {q && !names.includes(q) && !exclude.includes(q) && (
          <button type="button" onClick={() => onPick(q)} className="flex h-11 items-center gap-2 rounded-inner px-3 text-start text-[13px] font-bold text-brand hover:bg-brand-soft">
            <Plus className="size-4" />
            {t('إضافة')} «{q}» {t('كاسم جديد')}
          </button>
        )}
        {list.length === 0 && !q && <p className="py-3 text-center text-[12px] text-muted">{t('لا يوجد أفراد محفوظون بعد')}</p>}
        {list.map((n) => (
          <button key={n} type="button" onClick={() => onPick(n)} className="flex h-11 items-center rounded-inner px-3 text-start text-[13px] font-bold text-ink hover:bg-line/60">
            {n}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

function Label({ field, children, wide }: { field: SharedField; children: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n()
  return (
    <label className={cn('flex flex-col gap-1', (wide || !field.half) && 'col-span-2')}>
      <span className="text-[12px] font-bold text-sub">
        {t(field.label)}
        {field.required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  )
}

function Body({ form, entry, onDone }: { form: SharedFormDef; entry?: Entry; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { profile } = useSession()
  const store = useStore()
  const currency = useCurrency()
  const fnd = profile?.fnd_id ?? ''
  const shownName = publicName(store.data, profile?.display_name ?? '')
  const fullName = String(store.data?.['settings_profile_name'] ?? '').trim() || profile?.display_name || ''
  const meEntry = fnd ? (shownName ? `${shownName} (${fnd})` : fnd) : shownName
  const start = useMemo(() => initialShared(form, entry, meEntry, currency), [form, entry, meEntry, currency])
  const [v, setV] = useState<SharedValues>(start)
  const [file, setFile] = useState<File | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const isRosca = form.fields.some((f) => f.kind === 'roscaInfo')
  const lump = v.select[COLLECT_KEY] === LUMP_SUM
  const people = isRosca ? orderedPeople(v) : peopleOf(v)
  const update = (patch: Partial<SharedValues>) => setV((x) => ({ ...x, ...patch }))
  const setText = (k: string, val: string) => setV((x) => ({ ...x, text: { ...x.text, [k]: val } }))
  const setSelect = (k: string, val: string) => setV((x) => ({ ...x, select: { ...x.select, [k]: val } }))

  function addPerson(name: string) {
    setPicking(false)
    setV((x) => {
      if (name === x.manager || x.members.includes(name)) return x
      // أول من يُضاف (بلا مسؤول) هو المسؤول.
      const order = x.order.length ? x.order : peopleOf(x)
      if (!x.manager) return { ...x, manager: name, order: [...order, name] }
      return { ...x, members: [...x.members, name], order: [...order, name] }
    })
  }
  function removePerson(name: string) {
    setV((x) => {
      const shares = { ...x.shares }
      delete shares[name]
      return { ...x, members: x.members.filter((m) => m !== name), order: x.order.filter((m) => m !== name), shares }
    })
  }
  function makeManager(name: string) {
    setV((x) => ({ ...x, manager: name, members: [...x.members.filter((m) => m !== name), ...(x.manager ? [x.manager] : [])] }))
  }
  function move(name: string, dir: -1 | 1) {
    setV((x) => {
      const list = orderedPeople(x)
      const i = list.indexOf(name)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return x
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...x, order: list }
    })
  }

  function ask() {
    const problem = validateShared(form, v)
    setError(problem ?? '')
    if (!problem) {
      setSaveError('')
      setConfirming(true)
    }
  }
  async function save() {
    setBusy(true)
    setSaveError('')
    try {
      if (entry) await updateShared(entry, form, v, fnd, [fullName, shownName].filter(Boolean), currency, file)
      else await createShared(form, v, fnd, currency, file)
      await qc.invalidateQueries({ queryKey: ['shared'] })
      setConfirming(false)
      onDone(entry ? 'تم حفظ التعديل بنجاح' : 'تم الحفظ بنجاح')
    } catch (e) {
      setSaveError(e instanceof SharedFormError ? e.message : errorText(e) || 'تعذّر الحفظ. تحقّق من الإنترنت ثم حاول مجددًا.')
    } finally {
      setBusy(false)
    }
  }

  const total = parseMoney(v.text['إجمالي المساهمة'] ?? '')
  const tr = (msg: string) =>
    msg
      .split('|')
      .map((p) => t(p))
      .join('')

  function field(f: SharedField) {
    if (f.hidden || f.kind === 'person' || f.kind === 'order') return null
    if (f.kind === 'text' || f.kind === 'number')
      return (
        <Label key={f.label} field={f}>
          <input
            dir={f.kind === 'number' ? 'ltr' : 'auto'}
            inputMode={f.kind === 'number' ? 'decimal' : undefined}
            value={v.text[f.label] ?? ''}
            placeholder={f.hint ? t(f.hint) : undefined}
            onChange={(e) => setText(f.label, e.target.value)}
            className={inputClass}
          />
        </Label>
      )
    if (f.kind === 'multiline')
      return (
        <Label key={f.label} field={f}>
          <textarea rows={3} dir="auto" value={v.text[f.label] ?? ''} onChange={(e) => setText(f.label, e.target.value)} className={cn(inputClass, 'h-auto py-3')} />
        </Label>
      )
    if (f.kind === 'date')
      return (
        <Label key={f.label} field={f}>
          <input type="date" value={toInputDate(v.text[f.label] ?? '')} onChange={(e) => setText(f.label, fromInputDate(e.target.value))} className={inputClass} />
        </Label>
      )
    if (f.kind === 'select')
      return (
        <Label key={f.label} field={f}>
          <select value={v.select[f.label] ?? ''} onChange={(e) => setSelect(f.label, e.target.value)} className={inputClass}>
            <option value="">{t('اختر')}</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {t(o)}
              </option>
            ))}
          </select>
        </Label>
      )
    if (f.kind === 'roscaInfo')
      return (
        <div key={f.label} className="col-span-2 rounded-inner bg-brand-soft px-3 py-2 text-[12.5px] font-bold text-brand">
          {t('المساهمة على الشخص')}: {people.length && total > 0 ? money(total / people.length, t(v.select['العملة'] || currency)) : '—'} · {t('عدد الدورات')}: {people.length}
          {/* الجمعية: المستلم في كل دورة يأخذ إجمالي المساهمة كاملًا. */}
          {people.length > 0 && total > 0 && (
            <p className="mt-0.5 text-[11.5px] font-bold text-sub">
              {t('يستلم كل عضو')} {money(total, t(v.select['العملة'] || currency))} {t('كاملًا في دوره')}
            </p>
          )}
        </div>
      )
    if (f.kind === 'collect')
      return (
        <div key={f.label} className="col-span-2 flex flex-col gap-2">
          <span className="text-[12px] font-bold text-sub">
            {t(f.label)}
            <span className="text-danger"> *</span>
          </span>
          <div className="grid grid-cols-2 gap-2">
            {[LUMP_SUM, INDIVIDUAL].map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setSelect(f.label, o)}
                className={cn('rounded-inner border px-3 py-2 text-start', v.select[f.label] === o ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-hairline')}
              >
                <p className="text-[13px] font-extrabold text-title">{t(o)}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-sub">{t(COLLECT_HINTS[o])}</p>
              </button>
            ))}
          </div>
          {lump && (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-bold text-sub">{t(APPROVAL_KEY)}</span>
                <select value={v.approval} onChange={(e) => update({ approval: e.target.value })} className={inputClass}>
                  <option value="نعم">{t('نعم')}</option>
                  <option value="لا">{t('لا')}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-bold text-sub">{t(BUDGET_ALERT_KEY)}</span>
                <select value={v.budgetAlert} onChange={(e) => update({ budgetAlert: e.target.value })} className={inputClass}>
                  {BUDGET_ALERT_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {t(o)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )
    if (f.kind === 'team' || f.kind === 'people') {
      const needsCollect = f.kind === 'team' && !v.select[COLLECT_KEY]
      const needsTotal = isRosca && total <= 0
      const sum = people.reduce((s, n) => s + parseMoney(v.shares[n] ?? ''), 0)
      return (
        <div key={f.label} className="col-span-2 flex flex-col gap-2">
          <span className="text-[12px] font-bold text-sub">
            {t(f.kind === 'team' ? f.label : 'المسؤول / الأعضاء')} ({people.length})<span className="text-danger"> *</span>
          </span>
          {isRosca && <p className="text-[11.5px] text-muted">{t('ترتيب الاستلام — الأول يستلم أولًا')}</p>}
          {people.map((n, i) => (
            <div key={n} className="flex flex-wrap items-center gap-2 rounded-inner bg-field px-3 py-2">
              {isRosca && <span className="grid size-6 place-items-center rounded-full bg-white text-[11px] font-extrabold text-brand">{i + 1}</span>}
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink" dir="auto">
                {shown(n)}
                {n === v.manager && <span className="ms-1.5 rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-extrabold text-gold-dark">{t('المسؤول')}</span>}
              </span>
              {fndIn(n) && <FndCopy fnd={fndIn(n)} />}
              {f.kind === 'team' && lump && (
                <input
                  dir="ltr"
                  inputMode="decimal"
                  aria-label={`${t('المساهمة')} ${shown(n)}`}
                  value={v.shares[n] ?? ''}
                  placeholder={t('المساهمة')}
                  onChange={(e) => setV((x) => ({ ...x, shares: { ...x.shares, [n]: e.target.value } }))}
                  className={cn(inputClass, 'h-9 w-28 bg-white')}
                />
              )}
              {isRosca && (
                <>
                  <button type="button" aria-label={t('أعلى')} disabled={i === 0} onClick={() => move(n, -1)} className="grid size-8 place-items-center rounded-inner text-sub hover:bg-white disabled:opacity-30">
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label={t('أسفل')} disabled={i === people.length - 1} onClick={() => move(n, 1)} className="grid size-8 place-items-center rounded-inner text-sub hover:bg-white disabled:opacity-30">
                    <ArrowDown className="size-4" />
                  </button>
                </>
              )}
              {n !== v.manager && (
                <>
                  <button type="button" aria-label={t('اجعله المسؤول')} title={t('اجعله المسؤول')} onClick={() => makeManager(n)} className="grid size-8 place-items-center rounded-inner text-gold-dark hover:bg-white">
                    <Crown className="size-4" />
                  </button>
                  <button type="button" aria-label={t('إزالة')} onClick={() => removePerson(n)} className="grid size-8 place-items-center rounded-inner text-danger hover:bg-white">
                    <X className="size-4" />
                  </button>
                </>
              )}
            </div>
          ))}
          {f.kind === 'team' && lump && (
            <div className="flex items-center justify-between rounded-inner bg-brand-soft px-3 py-2 text-[12.5px] font-extrabold text-brand">
              <span>{t('إجمالي المساهمة')}</span>
              <span>{money(sum, t(currency))}</span>
              {people.length > 0 && (
                <input
                  dir="ltr"
                  inputMode="decimal"
                  placeholder={t('نفس المبلغ للجميع')}
                  aria-label={t('نفس المبلغ للجميع')}
                  onChange={(e) => {
                    const each = parseMoney(e.target.value)
                    if (each > 0) setV((x) => ({ ...x, shares: Object.fromEntries(people.map((n) => [n, String(e.target.value).trim()])) }))
                  }}
                  className="h-8 w-32 rounded-inner border border-line bg-white px-2 text-[12px] font-bold text-title outline-none"
                />
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              if (needsCollect) return setError('اختر طريقة تحصيل المبلغ أولًا')
              if (needsTotal) return setError('أدخل إجمالي المساهمة أولًا')
              setError('')
              setPicking(true)
            }}
            className="flex h-11 items-center justify-center gap-2 rounded-inner border border-dashed border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft"
          >
            <UserPlus className="size-4" />
            {t(v.manager ? 'إضافة عضو — من الأفراد أو بالرقم التعريفي' : 'اختر المسؤول أولًا — من الأفراد أو بالرقم التعريفي')}
          </button>
        </div>
      )
    }
    if (f.kind === 'attachment')
      return (
        <label key={f.label} className="col-span-2 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-field border border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft">
          <Paperclip className="size-4" />
          <span className="truncate">{file ? file.name : t(entry?.attachment_url ? 'استبدال المرفق' : 'إرفاق مستند')}</span>
          {file && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                setFile(null)
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
              if (named) setFile(named)
            }}
          />
        </label>
      )
    return null
  }

  return (
    <div>
      <p className="text-[18px] font-extrabold text-title">
        {entry ? `${t('تعديل')} ${t(sharedLabel(form.label))}` : `${t('إضافة')} ${t(sharedLabel(form.label))}`}
      </p>
      <p className="mt-0.5 text-[12px] text-muted">{t(form.subtitle)}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">{form.fields.map(field)}</div>
      <p className="mt-3 rounded-inner bg-surface px-3 py-2 text-[11px] text-sub">{t('من له رقم تعريفي يصله طلب الانضمام، والمدة 24 ساعة للرد.')}</p>
      {error && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{tr(error)}</p>}
      <button type="button" onClick={ask} className="mt-5 flex h-13 w-full items-center justify-center rounded-field bg-brand py-3.5 text-[15px] font-extrabold text-white hover:bg-brand-dark">
        {t(entry ? 'حفظ التعديل' : 'حفظ')}
      </button>
      <MemberPicker
        open={picking}
        me={fnd}
        exclude={people}
        meEntry={meEntry}
        managerWord={/رحلة/.test(form.label) ? 'مديرًا للرحلة' : 'مسؤولًا'}
        onPick={addPerson}
        onClose={() => setPicking(false)}
      />
      <Confirm
        open={confirming}
        title={entry ? 'تأكيد التعديل' : 'تأكيد الحفظ'}
        message={`«${(v.text[form.fields.find((x) => x.isTitle)!.label] ?? '').trim()}» — ${t(entry ? 'هل تريد حفظ التعديل؟' : 'هل تريد حفظ البيانات؟')}`}
        busy={busy}
        error={saveError ? tr(saveError) : ''}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

/** إضافة: اختيار النوع ثم النموذج. تعديل: نموذج السجل مباشرة. */
export function SharedEditor({ open, entry, onClose, onSaved }: { open: boolean; entry?: Entry; onClose: () => void; onSaved: (message: string) => void }) {
  const { t, dir } = useI18n()
  const [type, setType] = useState<string | null>(null)
  useEffect(() => {
    if (open) setType(entry ? entry.entry_type : null)
  }, [open, entry])
  const form = type ? SHARED_FORMS[type] : null
  const Back = dir === 'rtl' ? ChevronRight : ChevronLeft
  return (
    <Sheet open={open} onClose={onClose}>
      {form ? (
        <>
          {!entry && (
            <button type="button" onClick={() => setType(null)} className="mb-2 flex items-center gap-1 text-[12px] font-bold text-brand">
              <Back className="size-4" />
              {t('اختر نوعًا آخر')}
            </button>
          )}
          <Body key={`${type}-${entry?.id ?? 'new'}`} form={form} entry={entry} onDone={onSaved} />
        </>
      ) : (
        <div>
          <p className="text-[18px] font-extrabold text-title">{t('إضافة التزام مشترك')}</p>
          <div className="mt-4 flex flex-col gap-2">
            {Object.values(SHARED_FORMS).map((f) => (
              <button key={f.label} type="button" onClick={() => setType(f.label)} className="card flex flex-col items-start gap-0.5 px-4 py-3 text-start hover:bg-line/70">
                <span className="text-[14px] font-extrabold text-ink">{t(sharedLabel(f.label))}</span>
                <span className="text-[11.5px] text-muted">{t(f.subtitle)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  )
}
