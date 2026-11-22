import { useMemo, useState } from 'react'
import { Archive as ArchiveIcon, ArchiveRestore, Building2, CheckCircle2, FileDown, LayoutGrid, UserRound, Users, UsersRound, type LucideIcon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { ARCHIVED, assetUnits, hasMine, personArchived, useAssets, usePeopleAll, usePersonalAll, useSharedAll, useStore, type Entry, type Person } from '@/lib/data'
import { canEdit, unarchiveEntry } from '@/lib/personalWrite'
import { PeopleError, setPersonArchived } from '@/lib/peopleWrite'
import { SharedError, setSharedArchived } from '@/lib/sharedWrite'
import { errorText } from '@/lib/supabase'
import { Confirm } from '@/components/Confirm'
import { date, matches } from '@/lib/format'
import { Chip, Empty, IconBadge, Loading, PageHeader, SearchField, SectionTitle } from '@/components/ui'
import { ReportPreview } from '@/components/ReportPreview'
import { useReportSettings, type ReportDocument, type SummaryItem } from '@/lib/reports'

/*
  الأرشيف — نفس مصادر ArchiveCenter في التطبيق (lib/data/archive_center.dart):
  الشخصية المؤرشفة، المشتركة المؤرشفة أو المكتملة، الأفراد المؤرشفون،
  ووحدات العقارات المؤرشفة. للعرض فقط؛ إلغاء الأرشفة من التطبيق.
*/

type Row = { key: string; source: string; title: string; subtitle: string; entry?: Entry; person?: Person; shared?: Entry }

const SOURCES: { key: string; icon: LucideIcon; color: string }[] = [
  { key: 'الالتزامات الشخصية', icon: UserRound, color: '#0A5A50' },
  { key: 'الالتزامات المشتركة', icon: UsersRound, color: '#2B8CB0' },
  { key: 'الأفراد والجهات', icon: Users, color: '#6B6FC7' },
  { key: 'العقارات والأنشطة', icon: Building2, color: '#D9902A' },
]

export default function Archive() {
  const { t } = useI18n()
  const { profile, user } = useSession()
  const qc = useQueryClient()
  const [restoring, setRestoring] = useState<Entry | null>(null)
  const [restoringPerson, setRestoringPerson] = useState<Person | null>(null)
  const [restoringShared, setRestoringShared] = useState<Entry | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [notice, setNotice] = useState('')
  const fnd = profile?.fnd_id ?? ''
  const personal = usePersonalAll()
  const shared = useSharedAll()
  const people = usePeopleAll()
  const assets = useAssets()
  const store = useStore()
  const [source, setSource] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<ReportDocument | null>(null)
  const settings = useReportSettings()

  const loading = personal.isLoading || shared.isLoading || people.isLoading || assets.isLoading

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const join = (...parts: unknown[]) => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(' · ')
    for (const e of personal.data ?? []) {
      if (e.status !== ARCHIVED) continue
      out.push({ key: `p${e.id}`, source: 'الالتزامات الشخصية', title: e.title, subtitle: join(t(e.entry_type), Number(e.amount) > 0 ? e.amount : '', date(e.due_date)), entry: e })
    }
    // المكتمل يبقى في الأرشيف حتى يُعرض في التطبيق ويُعاد (shared_completed_shown_v1).
    const shownRaw = store.data?.['shared_completed_shown_v1']
    const shown = new Set(Array.isArray(shownRaw) ? shownRaw.map(String) : [])
    for (const e of shared.data ?? []) {
      const archived = (e.status ?? '').includes(ARCHIVED) || hasMine(e.details, 'مؤرشف عند', fnd) || (e.status === 'مكتملة' && !shown.has(e.id))
      if (!archived) continue
      // المكتمل وحده يُعاد من التطبيق؛ المؤرشف (عندي أو حالته) يُخرج هنا.
      const restorable = (e.status ?? '').includes(ARCHIVED) || hasMine(e.details, 'مؤرشف عند', fnd)
      out.push({ key: `s${e.id}`, source: 'الالتزامات المشتركة', title: e.title, subtitle: join(t(e.entry_type), Number(e.amount) > 0 ? e.amount : '', date(e.due_date)), shared: restorable ? e : undefined })
    }
    ;(people.data ?? []).forEach((p, i) => {
      if (!personArchived(p)) return
      out.push({ key: `h${i}`, source: 'الأفراد والجهات', title: p.fullName, subtitle: join(t(p.roleTitle ?? ''), t(p.categoryName ?? '')), person: p })
    })
    for (const a of assets.data ?? []) {
      if (a.status === ARCHIVED) {
        out.push({ key: `a${a.id}`, source: 'العقارات والأنشطة', title: a.title, subtitle: join(t(a.sub_type), a.location_or_type) })
      }
      assetUnits(a).forEach((u, i) => {
        if (u['status'] !== 'مؤرشفة') return
        out.push({ key: `u${a.id}-${i}`, source: 'العقارات والأنشطة', title: String(u['name'] ?? t('وحدة')), subtitle: `${t('وحدة في')} «${a.title}»` })
      })
    }
    return out
  }, [personal.data, shared.data, people.data, assets.data, store.data, fnd, t])

  const list = rows.filter((r) => (!source || r.source === source) && matches(search, r.title, r.subtitle))

  /** _exportArchivedRecords: ملف PDF بالمؤرشفات المعروضة الآن (القسم المختار + البحث). */
  function exportList() {
    if (!list.length) return
    const now = new Date()
    const stamp = String(now.getTime())
    const query = search.trim()
    const picked = source ?? 'الكل'
    const items: SummaryItem[] = list.map((r) => ({
      scope: r.source,
      section: r.source,
      type: r.source,
      title: r.title,
      subtitle: r.subtitle,
      status: 'مؤرشف',
      amount: 0,
      date: null,
      person: '',
      payment: '',
      createdAt: null,
      searchText: '',
      followsDate: true,
      followDate: null,
      canBeOverdue: true,
    }))
    setPreview({
      title: picked === 'الكل' ? 'سجل المؤرشفات' : `سجل المؤرشفات — ${picked}`,
      archive: true,
      reference: `AR-${stamp.slice(-6)}`,
      createdAt: now,
      createdBy: settings.name,
      criteria: [['القسم', picked], ...(query ? ([['كلمة البحث', query]] as [string, string][]) : [])],
      items,
      archivedAt: null,
      archiveReason: '',
    })
  }

  return (
    <div>
      <PageHeader icon={ArchiveIcon} color="#0A5A50" title="الأرشيف" subtitle="ما أرشفته من كل الأقسام" back={false} />
      <SearchField value={search} onChange={setSearch} placeholder="بحث" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Chip active={!source} label="الكل" icon={LayoutGrid} count={rows.length} onClick={() => setSource(null)} />
        {SOURCES.map((s) => {
          const n = rows.filter((r) => r.source === s.key).length
          if (!n) return null
          return <Chip key={s.key} active={source === s.key} label={s.key} icon={s.icon} count={n} onClick={() => setSource(s.key)} />
        })}
      </div>
      {notice && (
        <p className="mt-4 flex items-center gap-2 rounded-inner bg-brand-soft px-4 py-3 text-[13px] font-bold text-brand">
          <CheckCircle2 className="size-4" />
          {t(notice)}
        </p>
      )}
      <div className="flex items-end justify-between gap-2">
        <SectionTitle count={list.length}>{t('العناصر المؤرشفة')}</SectionTitle>
        {!loading && list.length > 0 && (
          <button
            type="button"
            onClick={exportList}
            className="mb-3 flex h-10 items-center gap-2 rounded-inner border border-line bg-white px-3 text-[12px] font-extrabold text-brand hover:bg-brand-soft"
          >
            <FileDown className="size-4" />
            {t('تصدير المؤرشفات PDF')}
          </button>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={ArchiveIcon} text="لا توجد عناصر في الأرشيف" />
      ) : (
        <>
          <div className="grid gap-2 lg:grid-cols-2">
            {list.map((r) => {
              const s = SOURCES.find((x) => x.key === r.source)!
              return (
                <div key={r.key} className="card flex items-center gap-3 p-4">
                  <IconBadge icon={s.icon} color={s.color} size={44} />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="break-words text-[14px] font-extrabold text-title">
                      {r.title}
                    </p>
                    <p className="text-[12px] font-bold" style={{ color: s.color }}>
                      {t(r.source)}
                    </p>
                    {r.subtitle && (
                      <p dir="auto" className="text-[11px] text-muted">
                        {r.subtitle}
                      </p>
                    )}
                  </div>
                  {r.shared && (
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreError('')
                        setRestoringShared(r.shared!)
                      }}
                      className="flex h-10 shrink-0 items-center gap-1.5 rounded-inner border border-line bg-white px-3 text-[12px] font-extrabold text-brand hover:bg-brand-soft"
                    >
                      <ArchiveRestore className="size-4" />
                      <span className="hidden sm:inline">{t('إخراج من الأرشيف')}</span>
                    </button>
                  )}
                  {r.person && (
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreError('')
                        setRestoringPerson(r.person!)
                      }}
                      className="flex h-10 shrink-0 items-center gap-1.5 rounded-inner border border-line bg-white px-3 text-[12px] font-extrabold text-brand hover:bg-brand-soft"
                    >
                      <ArchiveRestore className="size-4" />
                      <span className="hidden sm:inline">{t('إخراج من الأرشيف')}</span>
                    </button>
                  )}
                  {r.entry && canEdit(r.entry, user?.id) && (
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreError('')
                        setRestoring(r.entry!)
                      }}
                      className="flex h-10 shrink-0 items-center gap-1.5 rounded-inner border border-line bg-white px-3 text-[12px] font-extrabold text-brand hover:bg-brand-soft"
                    >
                      <ArchiveRestore className="size-4" />
                      <span className="hidden sm:inline">{t('إخراج من الأرشيف')}</span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">{t('الإخراج من الأرشيف هنا للالتزامات والأفراد والجهات، والعقارات والمكتمل من التطبيق.')}</p>
        </>
      )}
      <ReportPreview doc={preview} onClose={() => setPreview(null)} />
      <Confirm
        open={!!restoring}
        title="إخراج من الأرشيف"
        message={`«${restoring?.title ?? ''}» — ${t('سيعود إلى الالتزامات النشطة. هل تريد المتابعة؟')}`}
        confirmLabel="إخراج من الأرشيف"
        busy={busy}
        error={restoreError}
        onConfirm={async () => {
          if (!restoring) return
          setBusy(true)
          setRestoreError('')
          try {
            await unarchiveEntry(restoring)
            await qc.invalidateQueries({ queryKey: ['personal'] })
            setRestoring(null)
            setNotice('تم إخراج الالتزام من الأرشيف بنجاح')
            window.setTimeout(() => setNotice(''), 4000)
          } catch (e) {
            setRestoreError(errorText(e) || 'تعذّر الحفظ. تحقّق من الإنترنت ثم حاول مجددًا.')
          } finally {
            setBusy(false)
          }
        }}
        onCancel={() => setRestoring(null)}
      />
      <Confirm
        open={!!restoringPerson}
        title="إخراج من الأرشيف"
        message={`«${restoringPerson?.fullName ?? ''}» — ${t('سيعود إلى الأفراد والجهات. هل تريد المتابعة؟')}`}
        confirmLabel="إخراج من الأرشيف"
        busy={busy}
        error={restoreError}
        onConfirm={async () => {
          if (!restoringPerson) return
          setBusy(true)
          setRestoreError('')
          try {
            await setPersonArchived(restoringPerson, false)
            await qc.invalidateQueries({ queryKey: ['store'] })
            setRestoringPerson(null)
            setNotice('تم إخراج الشخص من الأرشيف')
            window.setTimeout(() => setNotice(''), 4000)
          } catch (e) {
            setRestoreError(e instanceof PeopleError ? e.message : errorText(e) || 'تعذّر حفظ التعديل. حاول مرة أخرى.')
          } finally {
            setBusy(false)
          }
        }}
        onCancel={() => setRestoringPerson(null)}
      />
      <Confirm
        open={!!restoringShared}
        title="إخراج من الأرشيف"
        message={`«${restoringShared?.title ?? ''}» — ${t('سيعود إلى الالتزامات النشطة. هل تريد المتابعة؟')}`}
        confirmLabel="إخراج من الأرشيف"
        busy={busy}
        error={restoreError}
        onConfirm={async () => {
          if (!restoringShared) return
          setBusy(true)
          setRestoreError('')
          try {
            await setSharedArchived(restoringShared, fnd, false)
            await qc.invalidateQueries({ queryKey: ['shared'] })
            setRestoringShared(null)
            setNotice('تم إخراج الالتزام من الأرشيف بنجاح')
            window.setTimeout(() => setNotice(''), 4000)
          } catch (e) {
            setRestoreError(e instanceof SharedError ? e.message : errorText(e) || 'تعذر تنفيذ العملية. حاول مرة أخرى.')
          } finally {
            setBusy(false)
          }
        }}
        onCancel={() => setRestoringShared(null)}
      />
    </div>
  )
}
