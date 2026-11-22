import { useMemo, useState } from 'react'
import {
  Building2,
  Car,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
  StickyNote,
  Store,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { moduleHidden, useSession } from '@/lib/session'
import { DOC_MODULES, daysLeft, hasFile, isExpired, isExpiringSoon, needsFollowup, parseDate, useDocuments, type AppDocument, type GeneralDoc } from '@/lib/documents'
import { date, matches } from '@/lib/format'
import { Chevron, Chip, Empty, IconBadge, Loading, PageHeader, SearchField, SectionTitle } from '@/components/ui'
import { FileButton } from '@/components/FileButton'

const MODULE_LOOK: Record<string, { icon: LucideIcon; color: string; label: string; page: string }> = {
  'الالتزامات الشخصية': { icon: UserRound, color: '#0A5A50', label: 'أنا', page: 'personal' },
  'الالتزامات المشتركة': { icon: UsersRound, color: '#2B8CB0', label: 'الالتزامات المشتركة', page: 'shared' },
  'الأفراد والجهات': { icon: Users, color: '#6B6FC7', label: 'الأفراد والجهات', page: 'people' },
  العقارات: { icon: Building2, color: '#D9902A', label: 'العقارات', page: 'assets' },
  'الأنشطة التجارية': { icon: Store, color: '#CE8422', label: 'الأنشطة التجارية', page: 'assets' },
  'المركبات ووسائل النقل': { icon: Car, color: '#0E7161', label: 'المركبات ووسائل النقل', page: 'assets' },
}

/** حالة المستند بلون التطبيق: منتهٍ بالأحمر، قريب بالبرتقالي. */
function ExpiryBadge({ doc }: { doc: AppDocument }) {
  const { t } = useI18n()
  if (!doc.expiry) return null
  const left = daysLeft(doc.expiry) ?? 0
  if (isExpired(doc))
    return <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger">{t('منتهي')}</span>
  if (isExpiringSoon(doc))
    return (
      <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-bold text-gold-dark">
        {left === 0 ? t('ينتهي اليوم') : `${t('ينتهي خلال')} ${left} ${t('يوم')}`}
      </span>
    )
  return <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand">{t('ساري')}</span>
}

export default function Documents() {
  const { t } = useI18n()
  const { hidden } = useSession()
  const { loading, docs, general } = useDocuments()
  const [module, setModule] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyFollowup, setOnlyFollowup] = useState(false)
  const [folder, setFolder] = useState<string | null>(null)

  const visibleModules = DOC_MODULES.filter((m) => !moduleHidden(hidden, MODULE_LOOK[m].page))
  const visibleDocs = docs.filter((d) => visibleModules.includes(d.module as (typeof DOC_MODULES)[number]))
  const followups = visibleDocs.filter(needsFollowup).length

  const list = useMemo(
    () =>
      visibleDocs
        .filter((d) => (!module || d.module === module) && (!onlyFollowup || needsFollowup(d)))
        .filter((d) => matches(search, d.title, d.owner, d.group, d.number, d.section))
        .sort((a, b) => (a.expiry?.getTime() ?? Infinity) - (b.expiry?.getTime() ?? Infinity)),
    [visibleDocs, module, onlyFollowup, search],
  )

  const sections = useMemo(() => {
    const map = new Map<string, AppDocument[]>()
    for (const d of list) {
      const key = module ? d.section : d.module
      map.set(key, [...(map.get(key) ?? []), d])
    }
    return [...map.entries()]
  }, [list, module])

  const browsing = !module && !search.trim() && !onlyFollowup

  return (
    <div>
      <PageHeader icon={FileText} color="#0A5A50" title="المستندات" subtitle="كل المستندات منظّمة ومرتّبة حسب القسم" back={false} />

      {browsing && (
        <div className="relative mb-4 overflow-hidden rounded-card bg-brand px-5 py-5 text-white">
          <div className="absolute -end-10 -top-10 size-32 rounded-full bg-white/5" />
          <div className="relative flex items-center gap-3">
            <FolderOpen className="size-9 shrink-0" />
            <div>
              <p className="text-[18px] font-extrabold">{t('كل مستنداتك في مكان واحد')}</p>
              <p className="text-[12px] text-white/75">{t('كل المستندات منظّمة ومرتّبة حسب القسم')}</p>
            </div>
          </div>
        </div>
      )}

      <SearchField value={search} onChange={setSearch} placeholder="بحث" />

      <div className="mt-4 flex flex-wrap gap-2">
        <Chip active={!onlyFollowup} label="الكل" icon={LayoutGrid} count={visibleDocs.length} onClick={() => setOnlyFollowup(false)} />
        <Chip active={onlyFollowup} label="مستندات تحتاج متابعة" icon={FileText} count={followups} onClick={() => setOnlyFollowup(true)} />
      </div>

      {loading ? (
        <Loading />
      ) : browsing ? (
        <>
          <SectionTitle>{t('الأقسام')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visibleModules.map((m) => {
              const look = MODULE_LOOK[m]
              const n = visibleDocs.filter((d) => d.module === m).length
              const late = visibleDocs.filter((d) => d.module === m && needsFollowup(d)).length
              return (
                <button key={m} type="button" onClick={() => setModule(m)} className="card flex items-center gap-3 p-4 text-start hover:bg-line/70">
                  <IconBadge icon={look.icon} color={look.color} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-extrabold leading-snug text-title">{t(look.label)}</p>
                    <p className="text-[11px] text-muted">
                      {n} {t('مستند')}
                      {late ? <span className="ms-1 font-bold text-gold-dark">· {late} {t('تحتاج متابعة')}</span> : null}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
          <GeneralDocs items={general} folder={folder} setFolder={setFolder} />
        </>
      ) : (
        <>
          {module && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setModule(null)} className="text-[13px] font-bold text-brand underline">
                {t('كل الأقسام')}
              </button>
              <Chevron className="size-4" />
              <span className="text-[13px] font-extrabold text-title">{t(MODULE_LOOK[module].label)}</span>
            </div>
          )}
          {sections.length === 0 ? (
            <div className="mt-6">
              <Empty icon={FileText} text={search ? 'لا توجد نتائج مطابقة' : 'لا توجد مستندات'} />
            </div>
          ) : (
            sections.map(([section, items]) => (
              <div key={section}>
                <SectionTitle count={items.length}>{t(module ? section : MODULE_LOOK[section]?.label ?? section)}</SectionTitle>
                <div className="grid gap-2 lg:grid-cols-2">
                  {items.map((d) => (
                    <DocCard key={d.key} doc={d} />
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}

function DocCard({ doc }: { doc: AppDocument }) {
  const { t } = useI18n()
  const look = MODULE_LOOK[doc.module]
  return (
    <div className="card flex items-start gap-3 p-4">
      <IconBadge icon={FileText} color={look?.color ?? '#0A5A50'} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p dir="auto" className="break-words text-[14px] font-extrabold text-title">
            {doc.title}
          </p>
          <ExpiryBadge doc={doc} />
        </div>
        <p className="mt-0.5 text-[12px] font-bold" style={{ color: look?.color }}>
          {t(doc.group)}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted">
          {doc.owner && <span dir="auto">{doc.owner}</span>}
          {doc.number && (
            <span>
              {t('الرقم')}: <span className="ltr">{doc.number}</span>
            </span>
          )}
          {doc.expiry && (
            <span>
              {t('تاريخ الانتهاء')}: {date(doc.expiry)}
            </span>
          )}
        </div>
        {hasFile(doc) && <FileButton className="mt-2" file={{ bucket: doc.bucket, path: doc.path, localPath: doc.localPath }} />}
      </div>
    </div>
  )
}

/** «عام»: مجلدات وملفات وملاحظات أضافها المستخدم في التطبيق. */
function GeneralDocs({ items, folder, setFolder }: { items: GeneralDoc[]; folder: string | null; setFolder: (id: string | null) => void }) {
  const { t } = useI18n()
  const current = items.filter((i) => (i.parentId ?? null) === folder)
  const folderName = items.find((i) => i.id === folder)?.name
  const parent = items.find((i) => i.id === folder)?.parentId ?? null
  if (!items.length) return null
  return (
    <>
      <SectionTitle>{t('عام')}</SectionTitle>
      {folder && (
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={() => setFolder(parent)} className="text-[13px] font-bold text-brand underline">
            {t('رجوع')}
          </button>
          <Chevron className="size-4" />
          <span className="text-[13px] font-extrabold text-title">{t(folderName ?? '')}</span>
        </div>
      )}
      {current.length === 0 ? (
        <Empty icon={Folder} text="المجلد فارغ" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {current.map((item) => {
            const isFolder = item.type === 'folder'
            const isNote = item.type === 'note'
            const Icon = isFolder ? Folder : isNote ? StickyNote : item.type === 'image' ? FileImage : FileText
            const count = isFolder ? items.filter((i) => i.parentId === item.id).length : 0
            const expiry = parseDate(item.expiry)
            return (
              <div
                key={item.id}
                role={isFolder ? 'button' : undefined}
                onClick={isFolder ? () => setFolder(item.id) : undefined}
                className="card flex flex-col items-center gap-2 p-4 text-center hover:bg-line/70"
              >
                <Icon className="size-9" style={{ color: isFolder ? '#F2A93F' : '#0A5A50' }} fill={isFolder ? '#F2A93F33' : 'none'} />
                <p dir="auto" className="break-words text-[13px] font-extrabold text-title">
                  {t(item.name)}
                </p>
                {isFolder && <p className="text-[11px] text-muted">{count} {t('عنصر')}</p>}
                {isNote && item.data && (
                  <p dir="auto" className="line-clamp-3 text-[11px] text-sub">
                    {noteText(item.data)}
                  </p>
                )}
                {expiry && <p className="text-[11px] text-muted">{t('تاريخ الانتهاء')}: {date(expiry)}</p>}
                {!isFolder && !isNote && item.path && <FileButton file={{ localPath: item.path }} label="فتح" />}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function noteText(data: string): string {
  try {
    const parsed = JSON.parse(data)
    if (parsed && typeof parsed === 'object') return String(parsed.text ?? parsed.body ?? parsed.content ?? '')
  } catch {
    // نص عادي.
  }
  return data
}
