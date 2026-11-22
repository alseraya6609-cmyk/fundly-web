import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Archive, Ban, Building2, CheckCircle2, LayoutGrid, MoreVertical, Pencil, Plus, Snowflake, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { moduleHidden, useSession } from '@/lib/session'
import { ARCHIVED, assetMeta, assetUnits, useAssetEntries, useAssets, useCurrency, useUnitContracts, useUnitPayments, type Asset, type AssetEntry, type UnitContract, type UnitPayment } from '@/lib/data'
import { ASSET_GROUPS, MODULE_COLORS, assetGroup } from '@/lib/catalog'
import { date, matches, money } from '@/lib/format'
import { FileButton } from '@/components/FileButton'
import { Chip, Empty, ErrorBox, InfoRow, Loading, PageHeader, SearchField, SectionTitle, Sheet } from '@/components/ui'
import { EntryCard } from '@/components/EntryCard'
import { Confirm } from '@/components/Confirm'
import { AssetEntryForm } from '@/components/AssetEntryForm'
import { ASSET_GROUPS_W, AssetError, FILE_FIELD, canDeleteEntry, deleteEntry, groupOf, type AssetGroup } from '@/lib/assetWrite'
import { errorText } from '@/lib/supabase'
import { VehicleForm, VehicleTypePicker } from '@/components/VehicleForm'
import { vehicleClassOf, vehicleDraftOf, vehicleTypeOf } from '@/lib/vehicleWrite'
import { archiveAsset, cancelAsset, cancelBlockedMessage, isCancelledAsset } from '@/lib/assetStatus'
import { PropertyWizard } from '@/components/PropertyWizard'
import { AddUnitsNow, PropertyEditor } from '@/components/PropertyEditor'
import { SettleRent } from '@/components/SettleRent'
import { unitIcon } from '@/components/PropertyParts'
import { PROPERTY_TYPE_KEY, archiveUnit, decodeUnits, toggleUnitFreeze, unitHasOpenContract, unitInfoRows, unitIsLive, unitKey, type PropertyUnit } from '@/lib/propertyWrite'
import { LeaseForm, type Renewal } from '@/components/LeaseForm'
import { CancelContractFlow, UnitLeaseBox, currentContract } from '@/components/UnitLease'
import { contractClosed } from '@/lib/leaseActions'
import { ACTIVITY_TYPES } from '@/lib/lease'
import { splitLogs as splitAssetLogs } from '@/lib/vehicleWrite'

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
  const [notice, setNotice] = useState('')
  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 4000)
  }

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
  const [picking, setPicking] = useState(false)
  const [vehicle, setVehicle] = useState<{ vehicleClass: string; vehicleType: string; asset?: Asset } | null>(null)
  const canAddVehicle = groups.some((g) => g.key === 'equipment')
  const canAddProperty = groups.some((g) => g.key === 'real_estate')
  const canAddActivity = groups.some((g) => g.key === 'activity')
  const [addingActivity, setAddingActivity] = useState(false)
  const [addingProperty, setAddingProperty] = useState(false)
  const [editing, setEditing] = useState<{ asset: Asset; type?: string; focusKey?: string } | null>(null)

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
      {notice && (
        <p className="mb-3 flex items-center gap-2 rounded-inner bg-brand-soft px-4 py-3 text-[13px] font-bold text-brand">
          <CheckCircle2 className="size-4" />
          {t(notice)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2">
        <div className="min-w-[220px] flex-1">
          <SearchField value={search} onChange={setSearch} placeholder="بحث" />
        </div>
        {canAddProperty && (
          <button type="button" onClick={() => setAddingProperty(true)} className="mb-3 flex h-11 shrink-0 items-center gap-1 rounded-inner bg-brand px-3 text-[12.5px] font-extrabold text-white hover:bg-brand-dark">
            <Plus className="size-4" />
            {t('إضافة عقار')}
          </button>
        )}
        {canAddActivity && (
          <button type="button" onClick={() => setAddingActivity(true)} className="mb-3 flex h-11 shrink-0 items-center gap-1 rounded-inner bg-brand px-3 text-[12.5px] font-extrabold text-white hover:bg-brand-dark">
            <Plus className="size-4" />
            {t('إضافة نشاط')}
          </button>
        )}
        {canAddVehicle && (
          <button type="button" onClick={() => setPicking(true)} className="mb-3 flex h-11 shrink-0 items-center gap-1 rounded-inner bg-brand px-3 text-[12.5px] font-extrabold text-white hover:bg-brand-dark">
            <Plus className="size-4" />
            {t('إضافة مركبة')}
          </button>
        )}
      </div>

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
            <div className="mt-1 flex items-start justify-between gap-2">
              <h2 className="text-[20px] font-extrabold text-title">{open.title}</h2>
              <AssetMenu
                asset={open}
                onEdit={
                  isCancelledAsset(open)
                    ? undefined
                    : assetGroup(open.category) === 'equipment'
                      ? () => setVehicle({ vehicleClass: vehicleClassOf(open), vehicleType: vehicleTypeOf(open), asset: open })
                      : open.category === 'real_estate'
                        ? () => setEditing({ asset: open })
                        : undefined
                }
                onDone={(m, leave) => {
                  if (leave) setParams({})
                  flash(m)
                }}
              />
            </div>
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
            <AssetUnits asset={open} onEditUnit={(type, focusKey) => setEditing({ asset: open, type, focusKey })} onDone={flash} />
            <AssetContracts asset={open} />
            <AssetRecords asset={open} onChanged={(m) => (setParams({}), flash(m))} />
            <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">
              {t(
                assetGroup(open.category) === 'equipment'
                  ? 'عقود تأجير المركبة والتفويض من التطبيق حاليًا.'
                  : open.category === 'real_estate'
                    ? 'عقود إيجار الوحدات من التطبيق حاليًا.'
                    : 'تعديل بيانات العقار والنشاط ووحداته وعقوده من التطبيق حاليًا.',
              )}
            </p>
          </div>
        )}
      </Sheet>
      {addingActivity && (
        <LeaseForm
          propertyType=""
          activity={{ classOptions: ACTIVITY_TYPES.filter((x) => !hidden.has(`item:assets:الأنشطة التجارية:${x}`)) }}
          onClose={() => setAddingActivity(false)}
          onDone={(m) => {
            setAddingActivity(false)
            setFilter('activity')
            flash(m)
          }}
        />
      )}
      {addingProperty && (
        <PropertyWizard
          onClose={() => setAddingProperty(false)}
          onDone={(m) => {
            setAddingProperty(false)
            setFilter('real_estate')
            flash(m)
          }}
        />
      )}
      {editing && (
        <PropertyEditor
          asset={editing.asset}
          initialType={editing.type}
          focusKey={editing.focusKey}
          onClose={() => setEditing(null)}
          onDone={(m) => {
            setEditing(null)
            flash(m)
          }}
        />
      )}
      {picking && (
        <VehicleTypePicker
          onClose={() => setPicking(false)}
          onPick={(vehicleClass, vehicleType) => {
            setPicking(false)
            setVehicle({ vehicleClass, vehicleType })
          }}
        />
      )}
      {vehicle && (
        <VehicleForm
          vehicleClass={vehicle.vehicleClass}
          vehicleType={vehicle.vehicleType}
          initial={vehicle.asset ? vehicleDraftOf(vehicle.asset) : undefined}
          assetId={vehicle.asset?.id}
          onClose={() => setVehicle(null)}
          onDone={(m) => {
            setVehicle(null)
            if (vehicle.asset) setParams({})
            else setFilter('equipment')
            flash(m)
          }}
        />
      )}
    </div>
  )
}

/** قائمة الثلاث نقاط: تعديل (المركبة)، إلغاء، أرشفة — بتأكيد كما في التطبيق. */
function AssetMenu({ asset, onEdit, onDone }: { asset: Asset; onEdit?: () => void; onDone: (message: string, leave: boolean) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const contracts = useUnitContracts()
  const [menu, setMenu] = useState(false)
  const [action, setAction] = useState<'cancel' | 'archive' | null>(null)
  const [blocked, setBlocked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (asset.status === ARCHIVED) return null
  const cancelled = isCancelledAsset(asset)
  const item = (label: string, Icon: typeof Pencil, onClick: () => void, danger = false) => (
    <button
      type="button"
      onClick={() => {
        setMenu(false)
        onClick()
      }}
      className={`flex h-12 items-center gap-2 rounded-inner border border-line bg-white px-3 text-[13.5px] font-bold hover:border-brand ${danger ? 'text-danger' : 'text-ink'}`}
    >
      <Icon className="size-4" />
      {t(label)}
    </button>
  )
  return (
    <>
      <button type="button" aria-label={t('خيارات')} onClick={() => setMenu(true)} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-sub hover:text-brand">
        <MoreVertical className="size-5" />
      </button>
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <p className="text-[18px] font-extrabold text-title">{t('خيارات')}</p>
        <p className="mt-0.5 text-[12px] text-muted" dir="auto">
          {asset.title}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {onEdit && item('تعديل بيانات', Pencil, onEdit)}
          {!cancelled &&
            item(
              'إلغاء',
              Ban,
              () => {
                const why = cancelBlockedMessage(asset, contracts.data ?? [])
                if (why) setBlocked(why)
                else (setError(''), setAction('cancel'))
              },
              true,
            )}
          {item('أرشفة', Archive, () => (setError(''), setAction('archive')))}
        </div>
      </Sheet>
      <Sheet open={!!blocked} onClose={() => setBlocked('')}>
        <p className="text-[18px] font-extrabold text-title">{t('إلغاء')}</p>
        <p className="mt-3 whitespace-pre-line text-[13px] font-bold text-sub" dir="auto">
          {blocked}
        </p>
        <button type="button" onClick={() => setBlocked('')} className="mt-5 h-12 w-full rounded-field bg-brand text-[14px] font-extrabold text-white">
          {t('حسنًا')}
        </button>
      </Sheet>
      <Confirm
        open={!!action}
        title={action === 'cancel' ? 'إلغاء' : 'أرشفة'}
        message={
          action === 'cancel'
            ? `«${asset.title}» — ${t('إذا ألغيته فلن تستطيع استعادته: يصبح «ملغي» وتنتقل كل أموره (العقود والدفعات والمستندات) إلى «السجل التاريخي». هل تريد الإلغاء؟')}`
            : t('سيُنقل العنصر إلى الأرشيف ويمكن إخراجه لاحقًا. هل تريد الأرشفة؟')
        }
        confirmLabel={action === 'cancel' ? 'إلغاء العنصر' : 'تأكيد'}
        danger={action === 'cancel'}
        busy={busy}
        error={error}
        onConfirm={async () => {
          if (!action) return
          setBusy(true)
          setError('')
          try {
            if (action === 'cancel') await cancelAsset(asset, contracts.data ?? [])
            else await archiveAsset(asset)
            await qc.invalidateQueries({ queryKey: ['assets'] })
            const done = action
            setAction(null)
            onDone(done === 'cancel' ? 'تم إلغاء العنصر — يبقى في «السجل التاريخي»' : 'تمت أرشفة الأصل', true)
          } catch (e) {
            setError(e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
          } finally {
            setBusy(false)
          }
        }}
        onCancel={() => setAction(null)}
      />
    </>
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


/** سجلات الأصل مقسّمة بالنوع، مع الإضافة والتعديل والحذف كما في التطبيق. */
function AssetRecords({ asset, onChanged }: { asset: Asset; onChanged: (m: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const entries = useAssetEntries()
  const mine = (entries.data ?? []).filter((e) => e.asset_id === asset.id)
  const kinds = KINDS.filter(([k]) => mine.some((e) => e.kind === k))
  const [kind, setKind] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [form, setForm] = useState<{ group: AssetGroup; entry?: AssetEntry } | null>(null)
  const [removing, setRemoving] = useState<AssetEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = kind ?? kinds[0]?.[0] ?? null
  const writable = !['مؤرشف', 'محذوف'].includes(asset.status)
  if (entries.isLoading) return <Loading />
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-[14px] font-extrabold text-title">
          <span className="h-4 w-1 rounded-full bg-gold" />
          {t('السجلات')}
        </p>
        {writable && (
          <button type="button" onClick={() => setMenu(true)} className="flex h-9 items-center gap-1 rounded-inner bg-brand px-3 text-[12.5px] font-extrabold text-white hover:bg-brand-dark">
            <Plus className="size-4" />
            {t('إضافة')}
          </button>
        )}
      </div>
      {kinds.length > 0 && (
        <>
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
                <AssetRecord
                  key={e.id}
                  entry={e}
                  onEdit={writable && groupOf(e) ? () => setForm({ group: groupOf(e)!, entry: e }) : undefined}
                  onDelete={writable && canDeleteEntry(e) ? () => (setError(''), setRemoving(e)) : undefined}
                />
              ))}
          </div>
        </>
      )}
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <p className="text-[18px] font-extrabold text-title">{t('إضافة')}</p>
        <p className="mt-0.5 text-[12px] text-muted" dir="auto">
          {asset.title}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {ASSET_GROUPS_W.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => {
                setMenu(false)
                setForm({ group: g })
              }}
              className="flex h-12 items-center justify-center gap-1.5 rounded-inner border border-line bg-white text-[13px] font-bold text-ink hover:border-brand hover:text-brand"
            >
              <Plus className="size-4" />
              {t(g.addTitle ?? g.title)}
            </button>
          ))}
        </div>
      </Sheet>
      {form && (
        <AssetEntryForm
          assetId={asset.id}
          assetTitle={asset.title}
          group={form.group}
          entry={form.entry}
          onClose={() => setForm(null)}
          onDone={(m) => {
            setForm(null)
            onChanged(m)
          }}
        />
      )}
      <Confirm
        open={!!removing}
        title="حذف"
        message={`«${String(removing?.data?.[groupOf(removing!)?.fields[0].label ?? ''] ?? '')}» — ${t('هل تريد الحذف؟')}`}
        confirmLabel="حذف"
        danger
        busy={busy}
        error={error}
        onConfirm={async () => {
          if (!removing) return
          setBusy(true)
          setError('')
          try {
            await deleteEntry(removing)
            await qc.invalidateQueries({ queryKey: ['asset-entries'] })
            setRemoving(null)
            onChanged('تم الحذف')
          } catch (e) {
            setError(e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
          } finally {
            setBusy(false)
          }
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}

function AssetRecord({ entry, onEdit, onDelete }: { entry: AssetEntry; onEdit?: () => void; onDelete?: () => void }) {
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
      {(onEdit || onDelete) && (
        <div className="mt-2 flex gap-2">
          {onEdit && (
            <button type="button" onClick={onEdit} className="flex h-8 items-center gap-1 rounded-inner bg-brand-soft px-3 text-[12px] font-extrabold text-brand">
              <Pencil className="size-3.5" />
              {t('تعديل')}
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} className="flex h-8 items-center gap-1 rounded-inner bg-danger-soft px-3 text-[12px] font-extrabold text-danger">
              <Trash2 className="size-3.5" />
              {t('حذف')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
  وحدات العقار الحية (units_json بلا المؤرشفة والمحذوفة)، وكل وحدة تُفتح
  بتفاصيلها وأوامرها، و«إضافة وحدة» و«المرافق العامة» كما في صفحة العقار.
*/
function AssetUnits({ asset, onEditUnit, onDone }: { asset: Asset; onEditUnit: (type: string, focusKey: string) => void; onDone: (m: string) => void }) {
  const { t } = useI18n()
  const units = decodeUnits(asset.units_json).filter(unitIsLive)
  const [unit, setUnit] = useState<PropertyUnit | null>(null)
  const [adding, setAdding] = useState<'units' | 'facilities' | null>(null)
  const [leasing, setLeasing] = useState<{ unit?: PropertyUnit; existing?: UnitContract; renewal?: Renewal; multi?: { key: string; name: string }[] } | null>(null)
  const allContracts = useUnitContracts()
  const [multiError, setMultiError] = useState('')
  const property = asset.category === 'real_estate'
  const editable = property && !isCancelledAsset(asset) && asset.status !== ARCHIVED
  const annexes = Object.entries((asset.annexes ?? {}) as Record<string, unknown>).filter(([, v]) => Number(v) > 0)
  if (!units.length && !editable) return null
  const statuses = [...new Set(units.map((u) => u.status).filter(Boolean))]
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[14px] font-extrabold text-title">
          <span className="h-4 w-1 rounded-full bg-gold" />
          {t('الوحدات')}
          <span className="rounded-full bg-surface px-2 text-[11px] text-sub">{units.length}</span>
        </p>
        {editable && (
          <button type="button" onClick={() => setAdding('units')} className="flex items-center gap-1 text-[12.5px] font-extrabold text-brand">
            <Plus className="size-4" />
            {t('إضافة وحدة')}
          </button>
        )}
      </div>
      {multiError && <p className="mb-2 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(multiError)}</p>}
      {statuses.length > 1 && <p className="mb-2 text-[12px] text-sub">{statuses.map((st) => `${t(st)}: ${units.filter((u) => u.status === st).length}`).join(' · ')}</p>}
      {units.length > 0 && (
        <div className="grid grid-cols-2 gap-2 rounded-inner bg-surface p-2 sm:grid-cols-3">
          {units.slice(0, 300).map((u, i) => {
            const Icon = unitIcon(u.type)
            return (
              <button key={i} type="button" onClick={() => setUnit(u)} className="card-inner px-3 py-2 text-start hover:ring-1 hover:ring-brand">
                <p dir="auto" className="flex items-center gap-1.5 text-[13px] font-extrabold text-title">
                  <Icon className="size-3.5 shrink-0 text-brand" />
                  <span className="truncate">{u.name || u.unitNumber || t('وحدة')}</span>
                </p>
                <p className="text-[11px] text-muted">{[u.type, u.status].filter(Boolean).map((x) => t(x)).join(' · ')}</p>
              </button>
            )
          })}
        </div>
      )}
      {property && (annexes.length > 0 || editable) && (
        <>
          <div className="mt-4 mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[14px] font-extrabold text-title">
              <span className="h-4 w-1 rounded-full bg-gold" />
              {t('المرافق العامة')}
            </p>
            {editable && (
              <button type="button" onClick={() => setAdding('facilities')} className="flex items-center gap-1 text-[12.5px] font-extrabold text-brand">
                <Plus className="size-4" />
                {t('إضافة')}
              </button>
            )}
          </div>
          {annexes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {annexes.map(([k, v]) => (
                <span key={k} className="rounded-full bg-surface px-3 py-1 text-[12px] font-bold text-ink">
                  {t(k)} ({String(v)})
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted">{t('لا توجد بيانات حالياً')}</p>
          )}
        </>
      )}
      {unit && (
        <UnitSheet
          asset={asset}
          unit={unit}
          editable={editable}
          onClose={() => setUnit(null)}
          onEdit={() => {
            setUnit(null)
            onEditUnit(unit.type, unitKey(unit))
          }}
          onLease={(existing) => {
            setLeasing({ unit, existing })
            setUnit(null)
          }}
          onRenew={(_, renewal) => {
            setLeasing({ unit, renewal })
            setUnit(null)
          }}
          onMulti={
            units.length > 1
              ? () => {
                  // _openMultiUnitContractForm: الوحدات بلا عقد قائم.
                  const vacant = units.filter((u) => !(allContracts.data ?? []).some((c) => c.asset_id === asset.id && c.unit_key === unitKey(u) && !contractClosed(c)))
                  setUnit(null)
                  if (vacant.length < 2) setMultiError('يلزم وجود وحدتين شاغرتين على الأقل لإنشاء عقد متعدد الوحدات')
                  else (setMultiError(''), setLeasing({ multi: vacant.map((u) => ({ key: unitKey(u), name: u.name })) }))
                }
              : undefined
          }
          onDone={(m) => {
            setUnit(null)
            onDone(m)
          }}
        />
      )}
      {adding && <AddUnitsNow asset={asset} facilitiesOnly={adding === 'facilities'} onClose={() => setAdding(null)} onSaved={() => {}} />}
      {leasing && (
        <LeaseForm
          asset={asset}
          unit={leasing.unit}
          multi={leasing.multi}
          propertyType={splitAssetLogs(asset.logs_json).meta[PROPERTY_TYPE_KEY] ?? ''}
          existing={leasing.existing}
          renewal={leasing.renewal}
          onClose={() => setLeasing(null)}
          onDone={(m) => {
            setLeasing(null)
            onDone(m)
          }}
        />
      )}
    </div>
  )
}

/** صفحة الوحدة: بياناتها وأوامرها (تعديل، تجميد، أرشفة) — _onUnitMenuAction. */
function UnitSheet({
  asset,
  unit,
  editable,
  onClose,
  onEdit,
  onLease,
  onRenew,
  onMulti,
  onDone,
}: {
  asset: Asset
  unit: PropertyUnit
  editable: boolean
  onClose: () => void
  onEdit: () => void
  onLease: (existing?: UnitContract) => void
  onRenew: (contract: UnitContract, renewal: Renewal) => void
  onMulti?: () => void
  onDone: (m: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const contracts = useUnitContracts()
  const allPayments = useUnitPayments()
  // العقد الحالي للوحدة: أحدث عقد غير ملغى (_load).
  const contract = currentContract(contracts.data ?? [], asset, unit)
  const contractPayments = contract ? (allPayments.data ?? []).filter((p) => p.contract_id === contract.id) : []
  // أرشفة وحدة عليها عقد قائم: إلغاؤه بالتسوية أولًا ثم الأرشفة (_onUnitMenuAction).
  const [cancelFirst, setCancelFirst] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = unitKey(unit)
  const frozen = unit.status === 'مجمّدة'
  const run = async (work: () => Promise<void>, message: string) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await qc.invalidateQueries({ queryKey: ['assets'] })
      setArchiving(false)
      onDone(message)
    } catch (e) {
      setError(e instanceof AssetError ? e.message : errorText(e) || 'تعذّر الحفظ. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }
  const action = (label: string, Icon: typeof Pencil, onClick: () => void, danger = false) => (
    <button type="button" disabled={busy} onClick={onClick} className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-inner border border-line bg-white px-2 text-[12.5px] font-extrabold hover:border-brand disabled:opacity-60 ${danger ? 'text-danger' : 'text-ink'}`}>
      <Icon className="size-4" />
      {t(label)}
    </button>
  )
  return (
    <Sheet open onClose={onClose}>
      <p className="text-[12px] font-bold text-brand">
        {t(unit.type)} · <span dir="auto">{asset.title}</span>
      </p>
      <h3 dir="auto" className="mt-1 text-[19px] font-extrabold text-title">
        {unit.name || t(unit.type)}
      </h3>
      <div className="mt-3">
        <InfoRow label="الحالة" value={t(unit.status)} />
        {unitInfoRows(unit).map(([k, v]) => (
          <InfoRow key={k} label={k} value={v} />
        ))}
      </div>
      {editable && (
        <div className="mt-4 flex gap-2">
          {action('تعديل', Pencil, onEdit)}
          {action(frozen ? 'إلغاء التجميد' : 'تجميد', Snowflake, () => run(() => toggleUnitFreeze(asset.id, key), frozen ? 'أُلغي تجميد الوحدة' : 'جُمّدت الوحدة'))}
          {action('أرشفة', Archive, () => {
            setError('')
            if (contract && unitHasOpenContract(asset.id, key, contracts.data ?? [])) setCancelFirst(true)
            else setArchiving(true)
          })}
        </div>
      )}
      {error && !archiving && <p className="mt-3 rounded-inner bg-danger-soft px-3 py-2 text-[12px] font-bold text-danger">{t(error)}</p>}
      <UnitLeaseBox asset={asset} unit={unit} editable={editable} onLease={onLease} onRenew={onRenew} onMulti={onMulti} onDone={onDone} />
      {cancelFirst && contract && (
        <CancelContractFlow
          asset={asset}
          unit={unit}
          contract={contract}
          payments={contractPayments}
          confirmed
          onClose={() => setCancelFirst(false)}
          onDone={() => {
            setCancelFirst(false)
            void run(
              () => archiveUnit(asset.id, key, (contracts.data ?? []).filter((c) => c.id !== contract.id)),
              `${t('أُرشفت')} ${unit.name} — ${t('تجدها في صفحة «الأرشيف»')}`,
            )
          }}
        />
      )}
      <Confirm
        open={archiving}
        title="أرشفة"
        message={`«${unit.name}» — ${t('ستُنقل الوحدة إلى الأرشيف وتجدها في صفحة «الأرشيف». هل تريد الأرشفة؟')}`}
        busy={busy}
        error={error}
        onConfirm={() => run(() => archiveUnit(asset.id, key, contracts.data ?? []), `${t('أُرشفت')} ${unit.name} — ${t('تجدها في صفحة «الأرشيف»')}`)}
        onCancel={() => setArchiving(false)}
      />
    </Sheet>
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
  const [paying, setPaying] = useState<UnitPayment | null>(null)
  const [done, setDone] = useState('')
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
      {done && (
        <p className="mb-2 flex items-center gap-2 rounded-inner bg-brand-soft px-3 py-2 text-[12.5px] font-bold text-brand">
          <CheckCircle2 className="size-4" />
          {t(done)}
        </p>
      )}
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
                      <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                        <span className="text-muted">{date(p.due_date)}</span>
                        <span className="font-bold text-ink">{money(p.amount_due, t(currency))}</span>
                        <span className={left > 0.009 ? 'font-bold text-gold-dark' : 'font-bold text-brand'}>
                          {left > 0.009 ? `${t('المتبقي')}: ${money(left)}` : t('مسددة')}
                        </span>
                        {left > 0.009 && asset.status !== ARCHIVED && (
                          <button type="button" onClick={() => setPaying(p)} className="h-7 rounded-inner bg-brand px-2.5 text-[11.5px] font-extrabold text-white hover:bg-brand-dark">
                            {t('تسجيل السداد')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </details>
          )
        })}
      </div>
      {paying && <SettleRent payment={paying} currency={currency} onClose={() => setPaying(null)} onDone={(m) => (setPaying(null), setDone(m), window.setTimeout(() => setDone(''), 4000))} />}
    </div>
  )
}

/** «نوع السداد»: كامل بالمتبقي أو جزئي بمبلغ مستلم (الشيك كامل فقط). */
