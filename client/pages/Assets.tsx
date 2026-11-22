import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, LayoutGrid } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { moduleHidden, useSession } from '@/lib/session'
import { ARCHIVED, assetMeta, assetUnits, useAssetEntries, useAssets, useCurrency, useUnitContracts, useUnitPayments, type Asset, type AssetEntry } from '@/lib/data'
import { ASSET_GROUPS, MODULE_COLORS, assetGroup } from '@/lib/catalog'
import { date, matches, money } from '@/lib/format'
import { FileButton } from '@/components/FileButton'
import { Chip, Empty, ErrorBox, InfoRow, Loading, PageHeader, SearchField, SectionTitle, Sheet } from '@/components/ui'
import { EntryCard } from '@/components/EntryCard'

// أسماء الفئات في لوحة التحكم (VISIBILITY_PAGES ← assets).
const ADMIN_TITLE: Record<string, string> = {
  real_estate: 'العقارات',
  activity: 'الأنشطة التجارية',
  equipment: 'المركبات ووسائل النقل',
}

export default function Assets() {
  const { t } = useI18n()
  const { hidden } = useSession()
  const assets = useAssets()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const groups = ASSET_GROUPS.filter((g) => !ADMIN_TITLE[g.key] || !hidden.has(`category:assets:${ADMIN_TITLE[g.key]}`))
  // المؤرشف مكانه الأرشيف.
  const all = (assets.data ?? []).filter((a) => a.status !== ARCHIVED && groups.some((g) => g.key === assetGroup(a.category)))
  const list = useMemo(
    () =>
      all.filter(
        (a) =>
          (filter === 'all' || assetGroup(a.category) === filter) &&
          matches(search, a.title, a.sub_type, a.location_or_type, a.owner, a.tenant),
      ),
    [all, filter, search],
  )
  const open = all.find((a) => a.id === params.get('open'))

  if (moduleHidden(hidden, 'assets')) {
    return (
      <>
        <PageHeader icon={Building2} color={MODULE_COLORS.assets} title="العقارات / الأنشطة التجارية / المركبات ووسائل النقل" />
        <Empty icon={Building2} text="غير متاح حاليًا" />
      </>
    )
  }

  return (
    <div>
      <PageHeader
        icon={Building2}
        color={MODULE_COLORS.assets}
        title="العقارات / الأنشطة التجارية / المركبات ووسائل النقل"
        subtitle="إدارة ومتابعة كل ما يتعلق بالأصول والاستثمار"
      />
      <SearchField value={search} onChange={setSearch} placeholder="بحث" />

      <SectionTitle>{t('الفئات')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Chip active={filter === 'all'} label="الكل" icon={LayoutGrid} count={all.length} onClick={() => setFilter('all')} />
        {groups.map((g) => {
          const n = all.filter((a) => assetGroup(a.category) === g.key).length
          if (!n) return null
          return <Chip key={g.key} active={filter === g.key} label={g.label} icon={g.icon} count={n} onClick={() => setFilter(g.key)} />
        })}
      </div>

      <SectionTitle count={list.length}>{t('العناصر')}</SectionTitle>
      {assets.isLoading ? (
        <Loading />
      ) : assets.error ? (
        <ErrorBox error={assets.error} />
      ) : list.length === 0 ? (
        <Empty icon={Building2} text={search ? 'لا توجد نتائج مطابقة' : 'لا توجد بيانات حالياً'} />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {list.map((a) => {
            const group = ASSET_GROUPS.find((g) => g.key === assetGroup(a.category))
            return (
              <EntryCard
                key={a.id}
                icon={group?.icon ?? Building2}
                color={group?.color ?? MODULE_COLORS.assets}
                title={a.title}
                type={[t(a.sub_type), a.location_or_type].filter(Boolean).join(' · ')}
                badge={a.status ? a.status : undefined}
                meta={a.end_date ? `${t('تاريخ الانتهاء')}: ${date(a.end_date)}` : undefined}
                onClick={() => setParams({ open: a.id })}
              />
            )
          })}
        </div>
      )}

      <Sheet open={!!open} onClose={() => setParams({})}>
        {open && (
          <div>
            <p className="text-[12px] font-bold" style={{ color: ASSET_GROUPS.find((g) => g.key === assetGroup(open.category))?.color }}>
              {t(ASSET_GROUPS.find((g) => g.key === assetGroup(open.category))?.label ?? '')}
            </p>
            <h2 className="mt-1 text-[20px] font-extrabold text-title">{open.title}</h2>
            <div className="mt-4">
              <InfoRow label="النوع" value={t(open.sub_type)} />
              <InfoRow label="الموقع" value={open.location_or_type} />
              <InfoRow label="الحالة" value={t(open.status)} />
              <InfoRow label="المالك" value={open.owner} />
              <InfoRow label="المستأجر" value={open.tenant} />
              <InfoRow label="قيمة الإيجار" value={open.rent_value} />
              <InfoRow label="المبلغ" value={open.amount_label} />
              <InfoRow label="تاريخ الانتهاء" value={date(open.end_date)} />
              <InfoRow label="ملاحظة المتابعة" value={open.followup_note} />
              <InfoRow label="تاريخ الإضافة" value={date(open.created_at)} />
              {Object.entries(assetMeta(open))
                .filter(([k, v]) => v && !/[\\/]/.test(v) && !SENSITIVE.test(k))
                .slice(0, 30)
                .map(([k, v]) => (
                  <InfoRow key={k} label={k} value={v} />
                ))}
            </div>
            <AssetUnits asset={open} />
            <AssetContracts asset={open} />
            <AssetRecords asset={open} />
            <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">
              {t('التعديل والإضافة من التطبيق حاليًا. الموقع للعرض في هذه المرحلة.')}
            </p>
          </div>
        )}
      </Sheet>
    </div>
  )
}

const SENSITIVE = /(كلمة|كلمات|سر|رمز|pin|pass|password|secret)/i

// أنواع سجلات الأصل (ProjectAssetsRepository.kind*).
const KINDS: [string, string][] = [
  ['contract', 'العقود'],
  ['rental', 'دفعات الإيجار'],
  ['maintenance', 'الصيانة'],
  ['expense', 'المصروفات'],
  ['revenue', 'الإيرادات'],
  ['document', 'المستندات'],
]

const FILE_FIELD = 'الملف المرفق'

/** سجلات الأصل مقسّمة بالنوع، للعرض فقط. */
function AssetRecords({ asset }: { asset: Asset }) {
  const { t } = useI18n()
  const entries = useAssetEntries()
  const mine = (entries.data ?? []).filter((e) => e.asset_id === asset.id)
  const kinds = KINDS.filter(([k]) => mine.some((e) => e.kind === k))
  const [kind, setKind] = useState<string | null>(null)
  const active = kind ?? kinds[0]?.[0] ?? null
  if (entries.isLoading) return <Loading />
  if (!kinds.length) return null
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
        <span className="h-4 w-1 rounded-full bg-gold" />
        {t('السجلات')}
      </p>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {kinds.map(([k, label]) => (
          <Chip key={k} active={active === k} label={label} count={mine.filter((e) => e.kind === k).length} onClick={() => setKind(k)} />
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-inner bg-surface p-2">
        {mine
          .filter((e) => e.kind === active)
          .slice(0, 60)
          .map((e) => (
            <AssetRecord key={e.id} entry={e} />
          ))}
      </div>
    </div>
  )
}

function AssetRecord({ entry }: { entry: AssetEntry }) {
  const { t } = useI18n()
  const data = entry.data ?? {}
  const pairs = Object.entries(data).filter(
    ([k, v]) => !k.startsWith('_') && !k.startsWith('##') && k !== FILE_FIELD && v !== null && v !== '' && typeof v !== 'object',
  )
  const file = String(data[FILE_FIELD] ?? '').trim()
  return (
    <div className="card-inner px-3 py-2">
      {pairs.slice(0, 16).map(([k, v]) => (
        <p key={k} className="text-[12px] leading-relaxed">
          <span className="text-muted">{t(k)}: </span>
          <span dir="auto" className="font-semibold text-ink">
            {SENSITIVE.test(k) ? t('مخفية في الموقع') : String(v)}
          </span>
        </p>
      ))}
      {!pairs.length && <p className="text-[12px] text-muted">{date(entry.created_at)}</p>}
      {file && <FileButton className="mt-1" file={{ localPath: file }} />}
    </div>
  )
}

/** وحدات الأصل (units_json) — بلا المحذوفة. */
function AssetUnits({ asset }: { asset: Asset }) {
  const { t } = useI18n()
  const units = assetUnits(asset).filter((u) => u['status'] !== 'محذوفة')
  if (!units.length) return null
  const statuses = [...new Set(units.map((u) => String(u['status'] ?? '')).filter(Boolean))]
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
        <span className="h-4 w-1 rounded-full bg-gold" />
        {t('الوحدات')}
        <span className="rounded-full bg-surface px-2 text-[11px] text-sub">{units.length}</span>
      </p>
      {statuses.length > 1 && (
        <p className="mb-2 text-[12px] text-sub">
          {statuses.map((st) => `${t(st)}: ${units.filter((u) => u['status'] === st).length}`).join(' · ')}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 rounded-inner bg-surface p-2 sm:grid-cols-3">
        {units.slice(0, 120).map((u, i) => (
          <div key={i} className="card-inner px-3 py-2">
            <p dir="auto" className="text-[13px] font-extrabold text-title">
              {String(u['name'] ?? u['unitNumber'] ?? t('وحدة'))}
            </p>
            <p className="text-[11px] text-muted">
              {[u['type'], u['status']].filter(Boolean).map((x) => t(String(x))).join(' · ')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

const CONTRACT_STATUS: Record<string, string> = {
  active: 'نشط',
  expired: 'منتهي',
  pending: 'مسودة',
  late: 'متأخر',
  ended: 'منتهي',
  cancelled: 'ملغى',
}

/** عقود وحدات الأصل ودفعاتها (property_unit_contracts / property_unit_payments). */
function AssetContracts({ asset }: { asset: Asset }) {
  const { t } = useI18n()
  const currency = useCurrency()
  const contracts = useUnitContracts()
  const payments = useUnitPayments()
  const mine = (contracts.data ?? []).filter((c) => c.asset_id === asset.id)
  if (!mine.length) return null
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-title">
        <span className="h-4 w-1 rounded-full bg-gold" />
        {t('عقود الإيجار')}
        <span className="rounded-full bg-surface px-2 text-[11px] text-sub">{mine.length}</span>
      </p>
      <div className="flex flex-col gap-2 rounded-inner bg-surface p-2">
        {mine.map((c) => {
          const pays = (payments.data ?? []).filter((p) => p.contract_id === c.id)
          const due = pays.reduce((s, p) => s + Number(p.amount_due || 0), 0)
          const paid = pays.reduce((s, p) => s + Number(p.amount_paid || 0), 0)
          return (
            <details key={c.id} className="card-inner px-3 py-2">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center gap-2">
                  <p dir="auto" className="text-[13px] font-extrabold text-title">
                    {c.unit_name || c.unit_key}
                    {c.tenant_name ? ` — ${c.tenant_name}` : ''}
                  </p>
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand">{t(CONTRACT_STATUS[c.status] ?? c.status)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted">
                  {date(c.start_date)} — {date(c.end_date)} · {t('الإيجار السنوي')}: {money(c.annual_rent, t(currency))} · {t(c.payment_cycle)}
                </p>
                {pays.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-sub">
                    {t('المدفوع')}: {money(paid, t(currency))} · {t('المتبقي')}: {money(Math.max(0, due - paid), t(currency))}
                  </p>
                )}
              </summary>
              {pays.length > 0 && (
                <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
                  {pays.map((p) => {
                    const left = Number(p.amount_due || 0) - Number(p.amount_paid || 0)
                    return (
                      <div key={p.id} className="flex flex-wrap justify-between gap-2 text-[12px]">
                        <span className="text-muted">{date(p.due_date)}</span>
                        <span className="font-bold text-ink">{money(p.amount_due, t(currency))}</span>
                        <span className={left > 0.009 ? 'font-bold text-gold-dark' : 'font-bold text-brand'}>
                          {left > 0.009 ? `${t('المتبقي')}: ${money(left)}` : t('مسددة')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </details>
          )
        })}
      </div>
    </div>
  )
}
