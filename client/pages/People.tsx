import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Archive, Building, CheckCircle2, LayoutGrid, Pencil, Plus, ReceiptText, ShieldCheck, Trash2, UserRound, Users } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/lib/i18n'
import { moduleHidden, useSession } from '@/lib/session'
import { useCurrency, usePeople, usePersonal, type Person } from '@/lib/data'
import { MODULE_COLORS } from '@/lib/catalog'
import { date, matches, money } from '@/lib/format'
import { Chevron, Chip, Empty, ErrorBox, IconBadge, InfoRow, Loading, PageHeader, SearchField, SectionTitle, Sheet } from '@/components/ui'
import { EntryCard } from '@/components/EntryCard'
import { FileButton } from '@/components/FileButton'
import { PersonEditor } from '@/components/PersonEditor'
import { PersonalEditor } from '@/components/PersonalEditor'
import { linkedAdds, recordLinkedTo, type LinkedAdd } from '@/lib/personalWrite'
import { Confirm } from '@/components/Confirm'
import { PeopleError, deletePerson, isFrozen, setPersonArchived } from '@/lib/peopleWrite'
import { errorText } from '@/lib/supabase'

// people_directory_store.dart: الجهة نوعها يبدأ بـ entity_.
const isEntity = (p: Person) => String(p.typeKey ?? '').startsWith('entity_')
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export default function People() {
  const { t } = useI18n()
  const { hidden, profile } = useSession()
  const people = usePeople()
  const personal = usePersonal()
  const currency = useCurrency()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<'all' | 'people' | 'entities'>('all')
  const [search, setSearch] = useState('')
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Person | null>(null)
  const [action, setAction] = useState<'archive' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  // «+» في تفاصيل الفرد: بند في «أنا» مربوط به (الفرد المرتبط).
  const [addMenu, setAddMenu] = useState(false)
  const [linkedAdd, setLinkedAdd] = useState<LinkedAdd | null>(null)
  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 4000)
  }

  // فئتا «الأفراد» و«الجهات» المخفيتان (من الإدارة أو «تخصيص الصفحات») لا تظهر ولا سجلاتها.
  const peopleOff = hidden.has('category:people:الأفراد')
  const entitiesOff = hidden.has('category:people:الجهات')
  const shownPerson = (p: Person) => (isEntity(p) ? !entitiesOff : !peopleOff)
  const all = people.data ?? []
  const list = useMemo(
    () =>
      all
        .map((p, index) => ({ p, index }))
        .filter(
          ({ p }) =>
            shownPerson(p) &&
            (filter === 'all' || (filter === 'entities') === isEntity(p)) &&
            matches(search, p.fullName, p.nickName, p.roleTitle, p.categoryName),
        )
        .sort((a, b) => Number(!!b.p.isPinned) - Number(!!a.p.isPinned)),
    [all, filter, search, peopleOff, entitiesOff],
  )
  const openIndex = params.get('open')
  const open = openIndex !== null ? all[Number(openIndex)] : undefined

  async function runAction() {
    if (!open || !action) return
    setBusy(true)
    setActionError('')
    try {
      if (action === 'archive') await setPersonArchived(open, true)
      else await deletePerson(open)
      await qc.invalidateQueries({ queryKey: ['store'] })
      setAction(null)
      setParams({})
      flash(action === 'archive' ? 'تمت أرشفة الشخص' : 'تم حذف السجل')
    } catch (e) {
      setActionError(e instanceof PeopleError ? e.message : errorText(e) || 'تعذّر حفظ التعديل. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  if (moduleHidden(hidden, 'people')) {
    return (
      <>
        <PageHeader icon={Users} color={MODULE_COLORS.people} title="الأفراد والجهات" />
        <Empty icon={Users} text="غير متاح حاليًا" />
      </>
    )
  }

  return (
    <div>
      <PageHeader icon={Users} color={MODULE_COLORS.people} title="الأفراد والجهات" subtitle="سجل الأفراد والجهات ومستنداتهم والتزاماتهم" />

      {/* «أنا» داخل الأفراد والجهات كما في التطبيق */}
      {!moduleHidden(hidden, 'personal') && (
        <Link to="/me" className="card mb-4 flex items-center gap-3 p-4 hover:bg-line/70">
          <IconBadge icon={UserRound} color={MODULE_COLORS.personal} size={48} solid />
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-extrabold text-title">{t('أنا')}</p>
            <p className="text-[12px] text-sub">
              {t('صاحب الحساب')}
              {profile?.fnd_id ? (
                <>
                  {' · '}
                  <span className="ltr">{profile.fnd_id}</span>
                </>
              ) : null}
            </p>
          </div>
          <span className="rounded-full bg-brand-soft px-3 py-1 text-[13px] font-extrabold text-brand">{personal.data?.length ?? '…'}</span>
          <Chevron />
        </Link>
      )}

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
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-14 shrink-0 items-center gap-2 rounded-field bg-brand px-4 text-[14px] font-extrabold text-white hover:bg-brand-dark"
        >
          <Plus className="size-5" />
          <span className="hidden sm:inline">{t('إضافة')}</span>
        </button>
      </div>

      <SectionTitle>{t('الفئات')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Chip active={filter === 'all'} label="الكل" icon={LayoutGrid} count={all.filter(shownPerson).length} onClick={() => setFilter('all')} />
        {!peopleOff && <Chip active={filter === 'people'} label="الأفراد" icon={UserRound} count={all.filter((p) => !isEntity(p)).length} onClick={() => setFilter('people')} />}
        {!entitiesOff && <Chip active={filter === 'entities'} label="الجهات" icon={Building} count={all.filter(isEntity).length} onClick={() => setFilter('entities')} />}
      </div>

      <SectionTitle count={list.length}>{t('الأفراد والجهات')}</SectionTitle>
      {people.isLoading ? (
        <Loading />
      ) : people.error ? (
        <ErrorBox error={people.error} />
      ) : list.length === 0 ? (
        <Empty icon={Users} text={search ? 'لا توجد نتائج مطابقة' : 'لا توجد بيانات حالياً'} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {list.map(({ p, index }) => (
            <EntryCard
              key={index}
              icon={isEntity(p) ? Building : UserRound}
              color={MODULE_COLORS.people}
              title={p.fullName}
              type={t(p.roleTitle || p.categoryName || '')}
              badge={p.badge || undefined}
              amount={num(p.dueToYou) > 0 ? `${t('مستحق لك')}: ${money(p.dueToYou, t(currency))}` : undefined}
              meta={num(p.dueOnYou) > 0 ? `${t('مستحق عليك')}: ${money(p.dueOnYou, t(currency))}` : undefined}
              onClick={() => setParams({ open: String(index) })}
            />
          ))}
        </div>
      )}

      <Sheet open={!!open} onClose={() => setParams({})}>
        {open && (
          <div>
            <p className="text-[12px] font-bold" style={{ color: MODULE_COLORS.people }}>
              {t(isEntity(open) ? 'جهة' : 'فرد')}
              {open.categoryName ? ` · ${t(open.categoryName)}` : ''}
            </p>
            <h2 className="mt-1 text-[20px] font-extrabold text-title">{open.fullName}</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => (isFrozen(open) ? flash('لا يمكن التعديل لأن السجل مجمّد. ألغِ التجميد أولاً.') : setEditing(open))}
                className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-brand text-[13px] font-extrabold text-white hover:bg-brand-dark"
              >
                <Pencil className="size-4" />
                {t('تعديل')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionError('')
                  setAction('archive')
                }}
                className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-surface text-[13px] font-extrabold text-body hover:bg-line"
              >
                <Archive className="size-4" />
                {t('أرشفة')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionError('')
                  setAction('delete')
                }}
                className="flex h-11 items-center justify-center gap-1.5 rounded-inner bg-danger-soft text-[13px] font-extrabold text-danger hover:bg-danger/15"
              >
                <Trash2 className="size-4" />
                {t('حذف')}
              </button>
            </div>
            <div className="mt-4">
              <InfoRow label="اللقب" value={open.nickName} />
              <InfoRow label="الصفة" value={open.roleTitle ? t(open.roleTitle) : ''} />
              <InfoRow label="مستحق لك" value={num(open.dueToYou) > 0 ? money(open.dueToYou, t(currency)) : ''} />
              <InfoRow label="مستحق عليك" value={num(open.dueOnYou) > 0 ? money(open.dueOnYou, t(currency)) : ''} />
              <InfoRow label="مهام مفتوحة" value={num(open.openTasks) > 0 ? String(open.openTasks) : ''} />
              <InfoRow label="المستندات" value={num(open.documentsCount) > 0 ? String(open.documentsCount) : ''} />
              {Object.entries(open.details ?? {})
                .filter(([k, v]) => String(v ?? '').trim() !== '' && !k.startsWith('مرفق ') && k !== 'مرفقات أخرى' && !(k.startsWith('تذكير ') && v === 'بلا تذكير'))
                .slice(0, 30)
                .map(([k, v]) => (
                  <InfoRow key={k} label={k} value={String(v)} ltr={/^[\d+\s()-]+$/.test(String(v))} />
                ))}
              {(() => {
                // مرفقات الوثائق و«مرفقات أخرى»: ملفات التطبيق بأسمائها.
                const d = open.details ?? {}
                const files = [
                  ...Object.entries(d)
                    .filter(([k, v]) => k.startsWith('مرفق ') && String(v ?? '').trim())
                    .map(([k, v]) => [k.slice('مرفق '.length), String(v)] as const),
                  ...String(d['مرفقات أخرى'] ?? '')
                    .split('|')
                    .filter((x) => x.trim())
                    .map((x) => [t('مرفقات أخرى'), x] as const),
                ]
                return files.length ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {files.map(([label, path], i) => (
                      <FileButton key={i} file={{ localPath: path }} label={label} />
                    ))}
                  </div>
                ) : null
              })()}
              <InfoRow label="ملاحظة" value={open.statusNote} />
              <InfoRow label="آخر تحديث" value={date(open.lastUpdate)} />
            </div>
            {(() => {
              const linked = (personal.data ?? []).filter((e) => recordLinkedTo(e, open))
              return (
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[14px] font-extrabold text-title">
                      {t('البنود المرتبطة')} {linked.length > 0 && <span className="text-muted">({linked.length})</span>}
                    </p>
                    {!isFrozen(open) && (
                      <button type="button" onClick={() => setAddMenu(true)} className="flex h-9 items-center gap-1 rounded-inner bg-brand px-3 text-[12.5px] font-extrabold text-white hover:bg-brand-dark">
                        <Plus className="size-4" />
                        {t('إضافة')}
                      </button>
                    )}
                  </div>
                  {linked.length === 0 ? (
                    <p className="rounded-inner bg-surface px-3 py-2 text-[12px] text-muted">{t('لا توجد بنود مرتبطة بعد.')}</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {linked.map((e) => (
                        <Link key={e.id} to={`/me?open=${e.id}`} className="card-inner flex items-center justify-between gap-2 px-3 py-2 text-[12.5px] hover:bg-line/60">
                          <span className="min-w-0">
                            <span className="block truncate font-extrabold text-ink" dir="auto">
                              {e.title}
                            </span>
                            <span className="text-[11px] text-muted">
                              {t(e.entry_type)}
                              {e.due_date ? ` · ${date(e.due_date)}` : ''}
                            </span>
                          </span>
                          {num(e.amount) > 0 && <span className="shrink-0 font-bold text-brand">{money(e.amount, t(currency))}</span>}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}
            {!String(open.typeKey ?? '').startsWith('entity_') && (
              <Link
                to={`/salary?${new URLSearchParams({ ...(String(open.details?.['الرقم التعريفي'] ?? '').trim() ? { fnd: String(open.details?.['الرقم التعريفي']).trim() } : {}), name: open.fullName.trim() }).toString()}`}
                className="mt-4 flex h-11 items-center justify-center gap-1.5 rounded-inner border border-brand text-[13px] font-extrabold text-brand hover:bg-brand-soft"
              >
                <ReceiptText className="size-4" />
                {t('سندات القبض والرواتب')}
              </Link>
            )}
            <Link
              to={`/delegations?new=${encodeURIComponent(open.fullName.trim())}`}
              className="mt-2 flex h-11 items-center justify-center gap-1.5 rounded-inner border border-line text-[13px] font-extrabold text-ink hover:bg-surface"
            >
              <ShieldCheck className="size-4" />
              {t('تفويض آخرين')}
            </Link>

            <Confirm
              open={!!action}
              title={action === 'archive' ? 'أرشفة' : 'حذف الشخص'}
              message={
                action === 'archive'
                  ? `«${open.fullName}» — ${t('سيُنقل إلى الأرشيف ويمكنك إخراجه لاحقًا. هل تريد الأرشفة؟')}`
                  : `${t('هل تريد حذف')} «${open.fullName}»؟ ${t('الحذف نهائي ولا يمكن التراجع عنه.')}`
              }
              confirmLabel={action === 'archive' ? 'أرشفة' : 'حذف'}
              danger={action === 'delete'}
              busy={busy}
              error={actionError}
              onConfirm={runAction}
              onCancel={() => setAction(null)}
            />
          </div>
        )}
      </Sheet>
      <Sheet open={addMenu && !!open} onClose={() => setAddMenu(false)}>
        {open && (
          <div>
            <p className="text-[18px] font-extrabold text-title">
              {t('إضافة')} — {open.fullName}
            </p>
            <div className="mt-4 flex flex-col gap-4">
              {linkedAdds(open).map((g) => (
                <div key={g.group}>
                  <p className="text-[13px] font-extrabold text-title">{t(g.group)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {g.items.map((x) => (
                      <button
                        key={x.label}
                        type="button"
                        onClick={() => {
                          setAddMenu(false)
                          setLinkedAdd(x)
                        }}
                        className="flex h-10 items-center gap-1.5 rounded-inner border border-line bg-white px-3 text-[13px] font-bold text-ink hover:border-brand hover:text-brand"
                      >
                        <Plus className="size-4" />
                        {x.label.split(' — ').map((part) => t(part)).join(' — ')}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">
              {t('العهدة المالية تُسجَّل من «الالتزامات الشخصية» ← «عهدة مالية»، وعند إسنادها لهذا الشخص برقمه التعريفي تظهر هنا تلقائيًا.')}
            </p>
          </div>
        )}
      </Sheet>
      <PersonalEditor
        open={!!linkedAdd}
        startType={linkedAdd?.type}
        prefill={linkedAdd?.prefill}
        link={linkedAdd?.link}
        onClose={() => setLinkedAdd(null)}
        onSaved={(message) => {
          setLinkedAdd(null)
          flash(message)
        }}
      />
      <PersonEditor
        open={adding || !!editing}
        person={editing ?? undefined}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
        onSaved={(message) => {
          setAdding(false)
          setEditing(null)
          setParams({})
          flash(message)
        }}
      />
    </div>
  )
}
