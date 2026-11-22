import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, CheckCircle2, ClipboardList, LayoutGrid, Pencil, Plus, Receipt, Trash2, UserRound, UsersRound, type LucideIcon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/lib/i18n'
import { moduleHidden, useSession } from '@/lib/session'
import { currencyOf, custodyRole, useCommitmentExtras, useCurrency, usePersonal, useShared, type Entry } from '@/lib/data'
import { MODULE_COLORS, PERSONAL_GROUPS, personalGroup, SHARED_GROUPS, sharedLabel } from '@/lib/catalog'
import { date, matches, money } from '@/lib/format'
import { Chip, Empty, ErrorBox, InfoRow, Loading, PageHeader, SearchField, SectionTitle, Sheet } from '@/components/ui'
import { EntryCard } from '@/components/EntryCard'
import { FileButton } from '@/components/FileButton'
import { SharedDetails } from '@/components/SharedDetails'
import { PersonalEditor } from '@/components/PersonalEditor'
import { Confirm } from '@/components/Confirm'
import { archiveEntry, canEdit, trashEntry } from '@/lib/personalWrite'
import { LEDGER_TYPES, SharedError, setSharedArchived } from '@/lib/sharedWrite'
import { ExpenseForm } from '@/components/ExpenseForm'
import { errorText } from '@/lib/supabase'

type Group = { key: string; label: string; icon: LucideIcon }

/** صفحة «أنا» — الالتزامات الشخصية (personal_entries). */
export function Personal() {
  const q = usePersonal()
  return (
    <EntriesPage
      page="personal"
      icon={UserRound}
      color={MODULE_COLORS.personal}
      title="أنا — صاحب الحساب"
      subtitle="صفحة الالتزامات الشخصية"
      query={q}
      groups={PERSONAL_GROUPS}
      groupOf={(e) => personalGroup(e.entry_type, e.category)}
      typeLabel={(e) => e.entry_type}
      adminTitle={(g) => g.label}
    />
  )
}

/** الالتزامات المشتركة (shared_entries). */
export function Shared() {
  const q = useShared()
  return (
    <EntriesPage
      page="shared"
      icon={UsersRound}
      color={MODULE_COLORS.shared}
      title="الالتزامات المشتركة"
      subtitle="إدارة ومتابعة الالتزامات المالية مع الآخرين"
      query={q}
      groups={SHARED_GROUPS}
      groupOf={(e) => e.entry_type}
      typeLabel={(e) => sharedLabel(e.entry_type)}
      adminTitle={(g) => g.key}
    />
  )
}

function EntriesPage({
  page,
  icon,
  color,
  title,
  subtitle,
  query,
  groups,
  groupOf,
  typeLabel,
  adminTitle,
}: {
  page: string
  icon: LucideIcon
  color: string
  title: string
  subtitle: string
  query: ReturnType<typeof usePersonal>
  groups: Group[]
  groupOf: (e: Entry) => string
  typeLabel: (e: Entry) => string
  /** اسم الفئة كما في لوحة التحكم (VISIBILITY_PAGES). */
  adminTitle: (g: Group) => string
}) {
  const { t } = useI18n()
  const { hidden, profile, user } = useSession()
  const fnd = profile?.fnd_id ?? ''
  // سجل لم أنشئه: التزام مشترك دُعيت إليه، أو عهدة/دين أُسند إليّ.
  const badgeOf = (e: Entry) => {
    if (page === 'shared') {
      const creator = String(e.details?.['معرف المنشئ'] ?? '').trim()
      return creator && fnd && creator !== fnd ? 'مشترك معك' : undefined
    }
    return custodyRole(e.details, fnd).role === 'holder' ? 'مسندة إليك' : undefined
  }
  const currency = useCurrency()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  // الإضافة والتعديل في «أنا» فقط (المشتركة من التطبيق حاليًا).
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [expenseFor, setExpenseFor] = useState<Entry | null>(null)
  const [notice, setNotice] = useState('')
  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 4000)
  }

  // الفئات التي أخفتها الإدارة من لوحة التحكم لا تظهر (category:page:الفئة).
  const visibleGroups = groups.filter((g) => !hidden.has(`category:${page}:${adminTitle(g)}`))
  const all = (query.data ?? []).filter((e) => visibleGroups.some((g) => g.key === groupOf(e)) || !groups.some((g) => g.key === groupOf(e)))
  const list = useMemo(
    () =>
      all.filter(
        (e) => (filter === 'all' || groupOf(e) === filter) && matches(search, e.title, e.entry_type, typeLabel(e)),
      ),
    [all, filter, search, groupOf, typeLabel],
  )
  const open = all.find((e) => e.id === params.get('open'))

  if (moduleHidden(hidden, page)) {
    return (
      <>
        <PageHeader icon={icon} color={color} title={title} subtitle={subtitle} />
        <Empty icon={icon} text="غير متاح حاليًا" />
      </>
    )
  }

  return (
    <div>
      <PageHeader icon={icon} color={color} title={title} subtitle={subtitle} />
      {notice && (
        <p className="mb-3 flex items-center gap-2 rounded-inner bg-brand-soft px-4 py-3 text-[13px] font-bold text-brand">
          <CheckCircle2 className="size-4" />
          {t(notice)}
        </p>
      )}
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <SearchField value={search} onChange={setSearch} placeholder="بحث" />
        </div>
        {page === 'personal' && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-14 shrink-0 items-center gap-2 rounded-field bg-brand px-4 text-[14px] font-extrabold text-white hover:bg-brand-dark"
          >
            <Plus className="size-5" />
            <span className="hidden sm:inline">{t('إضافة')}</span>
          </button>
        )}
      </div>

      <SectionTitle>{t('الفئات')}</SectionTitle>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <Chip active={filter === 'all'} label="الكل" icon={LayoutGrid} count={all.length} onClick={() => setFilter('all')} />
        {visibleGroups.map((g) => {
          const n = all.filter((e) => groupOf(e) === g.key).length
          if (!n) return null
          return <Chip key={g.key} active={filter === g.key} label={g.label} icon={g.icon} count={n} onClick={() => setFilter(g.key)} />
        })}
      </div>

      <SectionTitle count={list.length}>{t('جميع الالتزامات')}</SectionTitle>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : list.length === 0 ? (
        <Empty icon={ClipboardList} text={search ? 'لا توجد نتائج مطابقة' : 'لا توجد بيانات حالياً'} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {list.map((e) => {
            const group = groups.find((g) => g.key === groupOf(e))
            return (
              <EntryCard
                key={e.id}
                icon={group?.icon ?? ClipboardList}
                color={color}
                title={e.title}
                type={t(typeLabel(e))}
                amount={Number(e.amount) > 0 ? `${t('المبلغ')}: ${money(e.amount, t(currencyOf(e.details, currency)))}` : undefined}
                meta={e.due_date ? `${t('التاريخ')}: ${date(e.due_date)}` : undefined}
                badge={badgeOf(e)}
                onClick={() => setParams({ open: e.id })}
              />
            )
          })}
        </div>
      )}

      <Sheet open={!!open} onClose={() => setParams({})}>
        {open && (
          <EntryDetails
            entry={open}
            color={color}
            typeLabel={typeLabel(open)}
            currency={currency}
            page={page}
            editable={page === 'personal' && canEdit(open, user?.id)}
            onEdit={() => setEditing(open)}
            onAddExpense={() => setExpenseFor(open)}
            onChanged={(message) => {
              setParams({})
              flash(message)
            }}
          />
        )}
      </Sheet>
      {expenseFor && (
        <ExpenseForm
          open
          entry={expenseFor}
          currency={currencyOf(expenseFor.details, currency)}
          onClose={() => setExpenseFor(null)}
          onDone={(message) => {
            setExpenseFor(null)
            flash(message)
          }}
        />
      )}
      {page === 'personal' && (
        <PersonalEditor
          open={adding || !!editing}
          entry={editing ?? undefined}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSaved={(message) => {
            setAdding(false)
            setEditing(null)
            flash(message)
          }}
        />
      )}
    </div>
  )
}

// قيم لا تُعرض في الموقع حتى لو حفظها التطبيق (كلمات السر والرموز).
const SENSITIVE = /(كلمة|كلمات|سر|رمز|pin|pass|password|secret|otp|cvv)/i

// سجلات محفوظة داخل الالتزام نفسه (قوائم JSON في details) — تُعرض جداول.
const LOGS = [
  'سجل دفعات الالتزام',
  'سجل صرفيات العهدة',
  'سجل المصروفات المشتركة',
  'سجل المساهمات',
  'سجل التسويات',
  'مستندات',
  'مرفقات إضافية',
]
// مفاتيح داخلية يحفظها التطبيق للمزامنة والمشاركة ولا يعرضها.
const INTERNAL = /^(_|معرف المنشئ|قبول الأعضاء|وقت دعوة الأعضاء|مؤرشف عند|محذوف عند|سجل تاريخي عند|تقسيم الأعضاء|تواريخ الأعضاء|عهدة_)/

// مفاتيح ملفات داخل السجلات: تُعرض زر فتح بدل النص.
const FILE_KEYS = new Set(['مرفق الفاتورة', 'receipt', 'path', 'المرفق'])

function parseRows(v: unknown): Record<string, unknown>[] {
  let list: unknown = v
  if (typeof v === 'string') {
    try {
      list = JSON.parse(v)
    } catch {
      return []
    }
  }
  return Array.isArray(list) ? (list.filter((r) => r && typeof r === 'object') as Record<string, unknown>[]) : []
}

/** ملف مستند الالتزام المشترك داخل حقل extra (المرفق). */
function extraFile(extra: unknown): string {
  let map: unknown = extra
  if (typeof extra === 'string') {
    try {
      map = JSON.parse(extra)
    } catch {
      return ''
    }
  }
  return map && typeof map === 'object' ? String((map as Record<string, unknown>)['المرفق'] ?? '').trim() : ''
}

function EntryDetails({
  entry,
  color,
  typeLabel,
  currency,
  page,
  editable = false,
  onEdit,
  onAddExpense,
  onChanged,
}: {
  entry: Entry
  color: string
  typeLabel: string
  currency: string
  page: string
  editable?: boolean
  onEdit?: () => void
  onAddExpense?: () => void
  onChanged?: (message: string) => void
}) {
  const { t } = useI18n()
  const { profile } = useSession()
  const qc = useQueryClient()
  const [action, setAction] = useState<'archive' | 'delete' | 'shared-archive' | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  async function runAction() {
    if (!action) return
    setBusy(true)
    setActionError('')
    try {
      if (action === 'shared-archive') {
        await setSharedArchived(entry, profile?.fnd_id ?? '', true)
        await qc.invalidateQueries({ queryKey: ['shared'] })
        setAction(null)
        onChanged?.('تمت أرشفة الالتزام بنجاح')
        return
      }
      if (action === 'archive') await archiveEntry(entry)
      else await trashEntry(entry)
      await qc.invalidateQueries({ queryKey: ['personal'] })
      setAction(null)
      onChanged?.(action === 'archive' ? 'تمت أرشفة الالتزام بنجاح' : 'نُقل الالتزام إلى سلة المحذوفات')
    } catch (e) {
      setActionError(e instanceof SharedError ? e.message : errorText(e) || 'تعذّر الحفظ. تحقّق من الإنترنت ثم حاول مجددًا.')
    } finally {
      setBusy(false)
    }
  }
  const extrasQ = useCommitmentExtras(page === 'personal' ? entry.id : undefined)
  const bucket = page === 'personal' ? 'personal-entry-attachments' : 'shared-entry-attachments'
  const fields = Object.entries(entry.details ?? {})
    .filter(([key, value]) => /[\u0600-\u06FF]/.test(key) && !LOGS.includes(key) && !INTERNAL.test(key) && ['string', 'number'].includes(typeof value))
    .filter(([, value]) => String(value).trim() !== '' && !/^[[{]/.test(String(value).trim()))
    .slice(0, 40)
  // دفتر المشتركة (المصروفات والمساهمات والتسويات) يُعرض في SharedDetails.
  const ledgerKeys = page === 'shared' ? ['سجل المصروفات المشتركة', 'سجل المساهمات', 'سجل التسويات'] : []
  const logs = LOGS.filter((key) => !ledgerKeys.includes(key))
    .map((key) => [key, parseRows(entry.details?.[key])] as const)
    .filter(([, rows]) => rows.length > 0)
  const x = extrasQ.data

  return (
    <div>
      <p className="text-[12px] font-bold" style={{ color }}>
        {t(typeLabel)}
      </p>
      <h2 dir="auto" className="mt-1 text-[20px] font-extrabold text-title">
        {entry.title}
      </h2>
      {entry.attachment_url && <FileButton className="mt-3" file={{ bucket, path: entry.attachment_url }} label="فتح المرفق" />}
      {editable && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button type="button" onClick={onEdit} className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-brand text-[13px] font-extrabold text-white hover:bg-brand-dark">
            <Pencil className="size-4" />
            {t('تعديل')}
          </button>
          <button type="button" onClick={() => setAction('archive')} className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-surface text-[13px] font-extrabold text-body hover:bg-line">
            <Archive className="size-4" />
            {t('أرشفة')}
          </button>
          <button type="button" onClick={() => setAction('delete')} className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-danger-soft text-[13px] font-extrabold text-danger hover:bg-danger/15">
            <Trash2 className="size-4" />
            {t('حذف')}
          </button>
        </div>
      )}
      {page === 'shared' && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {LEDGER_TYPES.includes(entry.entry_type) && !['مؤرشف', 'ملغاة', 'محذوف'].includes(entry.status) ? (
            <button
              type="button"
              onClick={onAddExpense}
              className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-brand text-[13px] font-extrabold text-white hover:bg-brand-dark"
            >
              <Receipt className="size-4" />
              {t('مصروف جديد')}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => {
              setActionError('')
              setAction('shared-archive')
            }}
            className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-surface text-[13px] font-extrabold text-body hover:bg-line"
          >
            <Archive className="size-4" />
            {t('أرشفة')}
          </button>
        </div>
      )}
      <Confirm
        open={!!action}
        title={action === 'delete' ? 'حذف الالتزام' : 'أرشفة الالتزام'}
        message={`«${entry.title}» — ${t(
          action === 'shared-archive'
            ? 'يُؤرشف عندك وحدك ويبقى عند بقية الأعضاء، ويصلهم إشعار. هل تريد الأرشفة؟'
            : action === 'archive'
              ? 'سيُنقل إلى الأرشيف ويمكنك إخراجه لاحقًا. هل تريد الأرشفة؟'
              : 'سيُنقل إلى سلة المهملات، ويمكنك استعادته منها أو حذفه نهائيًا من التطبيق. هل تريد المتابعة؟',
        )}`}
        confirmLabel={action === 'delete' ? 'حذف' : 'أرشفة'}
        danger={action === 'delete'}
        busy={busy}
        error={actionError}
        onConfirm={runAction}
        onCancel={() => {
          setAction(null)
          setActionError('')
        }}
      />
      <div className="mt-4">
        {Number(entry.amount) > 0 && <InfoRow label="المبلغ" value={money(entry.amount, t(currencyOf(entry.details, currency)))} />}
        <InfoRow label="التاريخ" value={date(entry.due_date)} />
        <InfoRow label="الحالة" value={t(entry.status)} />
        {fields.map(([key, value]) => (
          <InfoRow key={key} label={key} value={SENSITIVE.test(key) ? t('مخفية في الموقع') : String(value)} />
        ))}
        <InfoRow label="تاريخ الإضافة" value={date(entry.created_at)} />
        <InfoRow label="آخر تحديث" value={date(entry.updated_at)} />
      </div>

      {page === 'shared' && <SharedDetails details={entry.details ?? {}} entryType={entry.entry_type} currency={currency} entry={entry} onChanged={onChanged} />}

      {logs.map(([key, rows]) => (
        <DetailBlock key={key} title={key} count={rows.length}>
          {rows.slice(0, 50).map((row, i) => (
            <div key={i} className="card-inner px-3 py-2">
              {extraFile(row.extra) && <FileButton className="my-1" file={{ localPath: extraFile(row.extra) }} />}
              {Object.entries(row)
                .filter(([k, v]) => !k.startsWith('_') && k !== 'extra' && v !== null && v !== '' && typeof v !== 'object')
                .map(([k, v]) =>
                  FILE_KEYS.has(k) ? (
                    <FileButton
                      key={k}
                      className="my-1"
                      file={key === 'مرفقات إضافية' || k === 'مرفق الفاتورة' ? { bucket, path: String(v) } : { localPath: String(v) }}
                    />
                  ) : (
                    <p key={k} className="text-[12px] leading-relaxed">
                      <span className="text-muted">{t(k)}: </span>
                      <span dir="auto" className="font-semibold text-ink">
                        {SENSITIVE.test(k) ? t('مخفية في الموقع') : String(v)}
                      </span>
                    </p>
                  ),
                )}
            </div>
          ))}
        </DetailBlock>
      ))}

      {x && x.payments.length > 0 && (
        <DetailBlock title="الدفعات" count={x.payments.length}>
          {x.payments.map((p) => (
            <div key={p.id} className="card-inner flex flex-wrap justify-between gap-2 px-3 py-2 text-[12px]">
              <span className="font-bold text-ink">{money(p.amount, t(currencyOf(entry.details, currency)))}</span>
              <span className="text-muted">
                {date(p.payment_date)}
                {p.payment_method ? ` · ${t(p.payment_method)}` : ''}
              </span>
              {p.notes && <span className="w-full text-sub">{p.notes}</span>}
            </div>
          ))}
        </DetailBlock>
      )}
      {x && x.appointments.length > 0 && (
        <DetailBlock title="المواعيد" count={x.appointments.length}>
          {x.appointments.map((a) => (
            <div key={a.id} className="card-inner px-3 py-2 text-[12px]">
              <p className="font-bold text-ink">{a.title}</p>
              <p className="text-muted">
                {t(a.appointment_type)} · {date(a.appointment_date)}
                {a.appointment_time ? ` · ${a.appointment_time.slice(0, 5)}` : ''} · {t(a.status)}
              </p>
            </div>
          ))}
        </DetailBlock>
      )}
      {x && x.notes.length > 0 && (
        <DetailBlock title="الملاحظات" count={x.notes.length}>
          {x.notes.map((n) => (
            <div key={n.id} className="card-inner px-3 py-2 text-[12px]">
              <p className="font-bold text-ink">{n.title}</p>
              <p className="whitespace-pre-line text-sub">{n.content}</p>
              <p className="mt-1 text-[11px] text-muted">{date(n.created_at)}</p>
            </div>
          ))}
        </DetailBlock>
      )}
      {x && x.people.length > 0 && (
        <DetailBlock title="الأشخاص" count={x.people.length}>
          {x.people.map((p) => (
            <div key={p.id} className="card-inner px-3 py-2 text-[12px]">
              <p className="font-bold text-ink">{p.person_name}</p>
              <p className="text-muted">
                {p.role_or_relationship ? t(p.role_or_relationship) : ''}
                {p.phone_number ? <span className="ltr ms-2 inline-block">{p.phone_number}</span> : null}
              </p>
            </div>
          ))}
        </DetailBlock>
      )}

      <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">
        {t(
          page === 'personal'
            ? editable
              ? 'التعديل هنا يحفظ في حسابك ويظهر في التطبيق. الدفعات والسجلات الخاصة بالالتزام من التطبيق.'
              : 'هذا النوع يُعدَّل من التطبيق حاليًا.'
            : entry.entry_type === 'جمعية مالية' || entry.entry_type === 'جمعية'
              ? 'المساهمات وتسليم الدورات تُسجَّل هنا، وإنشاء الالتزام وتعديله وحذفه من التطبيق حاليًا.'
              : 'المصروفات والميزانية والتسوية والموافقات هنا، وإنشاء الالتزام وتعديله وحذفه من التطبيق حاليًا.',
        )}
      </p>
    </div>
  )
}

function DetailBlock({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
        <span className="h-4 w-1 rounded-full bg-gold" />
        {t(title)}
        <span className="rounded-full bg-surface px-2 text-[11px] text-sub">{count}</span>
      </p>
      <div className="flex flex-col gap-2 rounded-inner bg-surface p-2">{children}</div>
    </div>
  )
}
