import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, Building2, CheckCircle2, DoorOpen, Trash2, UserRound, UsersRound, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { supabase, errorText } from '@/lib/supabase'
import { ENTRY_COLUMNS, assetUnits, useAssets, type Asset, type Entry } from '@/lib/data'
import { splitLogs } from '@/lib/vehicleWrite'
import { PERSONAL_GROUPS, personalGroup } from '@/lib/catalog'
import { AssetError } from '@/lib/assetWrite'
import {
  DELETED_AT_KEY,
  SOURCE_KEY,
  TRASH_STATUS,
  UNIT_TRASHED,
  applyTrashedUnits,
  deleteAssetForever,
  deletePersonalForever,
  rawUnitKey,
  restoreAsset,
  restorePersonal,
} from '@/lib/archiveWrite'
import { SHARED_REMOVED_KEY, SharedError, markMine, purgeSharedAlone, sharedWithOthers } from '@/lib/sharedWrite'
import { useRemovedByMe } from '@/components/SharedLifecycle'
import { Confirm } from '@/components/Confirm'
import { Empty, IconBadge, Loading, PageHeader, SectionTitle } from '@/components/ui'

/*
  سلة المهملات (trash_screen.dart): الحذف لا يمسح السجل بل يضع حالته «محذوف»
  ويحفظ حالته السابقة وتاريخ الحذف ومصدره. من هنا يُستعاد السجل إلى مكانه
  أو يُحذف نهائيًا بلا رجعة: الالتزامات الشخصية، والعقارات والأنشطة
  والمركبات، ووحدات العقارات، والالتزامات المشتركة المحذوفة من عندي.
*/

type Item =
  | { kind: 'personal'; key: string; title: string; sub: string; at: string; entry: Entry }
  | { kind: 'asset'; key: string; title: string; sub: string; at: string; asset: Asset }
  | { kind: 'unit'; key: string; title: string; sub: string; at: string; asset: Asset; unitKey: string }
  | { kind: 'shared'; key: string; title: string; sub: string; at: string; entry: Entry; purgeable: boolean }

const ICONS: Record<Item['kind'], [LucideIcon, string]> = {
  personal: [UserRound, '#0A5A50'],
  asset: [Building2, '#D9902A'],
  unit: [DoorOpen, '#CE8422'],
  shared: [UsersRound, '#2B8CB0'],
}


const sourceOfAsset = (a: Asset, meta: Record<string, string>) =>
  (meta[SOURCE_KEY] ?? '').trim() || (a.category === 'real_estate' ? 'العقارات' : a.category === 'equipment' ? 'المركبات ووسائل النقل' : 'الأنشطة التجارية')

function useTrashed() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['personal', 'trash', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [personal, assets] = await Promise.all([
        supabase.from('personal_entries').select(ENTRY_COLUMNS).eq('user_id', user!.id).eq('status', TRASH_STATUS).order('updated_at', { ascending: false }),
        supabase.from('project_assets').select('*').eq('user_id', user!.id).eq('status', TRASH_STATUS),
      ])
      if (personal.error) throw personal.error
      if (assets.error) throw assets.error
      return { personal: (personal.data ?? []) as Entry[], assets: (assets.data ?? []) as Asset[] }
    },
  })
}

export default function Trash() {
  const { t } = useI18n()
  const { profile } = useSession()
  const fnd = profile?.fnd_id ?? ''
  const qc = useQueryClient()
  const trashed = useTrashed()
  const assets = useAssets()
  const removed = useRemovedByMe()
  const [ask, setAsk] = useState<{ item: Item; restore: boolean } | null>(null)
  const [emptying, setEmptying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const flash = (m: string) => {
    setNotice(m)
    window.setTimeout(() => setNotice(''), 4000)
  }

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (const e of trashed.data?.personal ?? []) {
      const d = (e.details ?? {}) as Record<string, unknown>
      out.push({ kind: 'personal', key: `p${e.id}`, title: e.title, sub: [t('الالتزامات الشخصية'), t(PERSONAL_GROUPS.find((g) => g.key === personalGroup(e.entry_type, e.category))?.label ?? ''), t(e.entry_type)].filter(Boolean).join(' - '), at: String(d[DELETED_AT_KEY] ?? ''), entry: e })
    }
    for (const a of trashed.data?.assets ?? []) {
      const meta = splitLogs(a.logs_json).meta
      out.push({ kind: 'asset', key: `a${a.id}`, title: a.title, sub: t(sourceOfAsset(a, meta)), at: meta[DELETED_AT_KEY] ?? '', asset: a })
    }
    // وحدات محذوفة داخل عقارات قائمة (العقار المحذوف يأخذ وحداته معه).
    for (const a of assets.data ?? []) {
      assetUnits(a).forEach((u, i) => {
        if (u['status'] !== UNIT_TRASHED) return
        const extras = (u['extras'] && typeof u['extras'] === 'object' ? u['extras'] : {}) as Record<string, unknown>
        out.push({ kind: 'unit', key: `u${a.id}-${i}`, title: String(u['name'] ?? '') || t('وحدة'), sub: `${t('وحدة في')} «${a.title}»`, at: String(extras[DELETED_AT_KEY] ?? ''), asset: a, unitKey: rawUnitKey(u) })
      })
    }
    for (const e of removed.data ?? []) {
      out.push({ kind: 'shared', key: `s${e.id}`, title: e.title, sub: [t('الالتزامات المشتركة'), t(e.entry_type)].join(' - '), at: '', entry: e, purgeable: !sharedWithOthers(e.details ?? {}, fnd) })
    }
    return out
  }, [trashed.data, assets.data, removed.data, fnd, t])

  const loading = trashed.isLoading || assets.isLoading
  const refresh = () => Promise.all(['personal', 'assets', 'shared'].map((k) => qc.invalidateQueries({ queryKey: [k] })))

  async function apply(item: Item, restore: boolean) {
    if (item.kind === 'personal') return restore ? restorePersonal(item.entry) : deletePersonalForever(item.entry.id)
    if (item.kind === 'asset') return restore ? restoreAsset(item.asset.id) : deleteAssetForever(item.asset.id)
    if (item.kind === 'unit') return applyTrashedUnits(item.asset.id, [item.unitKey], restore)
    if (restore) {
      await markMine(item.entry, SHARED_REMOVED_KEY, fnd, false)
      return
    }
    return purgeSharedAlone(item.entry, fnd)
  }

  async function run() {
    if (!ask) return
    setBusy(true)
    setError('')
    try {
      await apply(ask.item, ask.restore)
      await refresh()
      const name = ask.item.title
      flash(
        ask.restore
          ? ask.item.kind === 'unit'
            ? `${t('استُعيدت')} «${name}» ${t('إلى أرشيف الوحدات')}`
            : `${t('استُعيد')} «${name}» ${t('إلى مكانه')}`
          : ask.item.kind === 'unit'
            ? `${t('حُذفت')} «${name}» ${t('نهائيًا')}`
            : `${t('حُذف')} «${name}» ${t('نهائيًا')}`,
      )
      setAsk(null)
    } catch (e) {
      setError(e instanceof AssetError || e instanceof SharedError ? e.message : `${t(ask.restore ? 'تعذّرت الاستعادة:' : 'تعذّر الحذف:')} ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** _emptyTrash: عنصر تعذّر حذفه لا يوقف البقية. */
  async function emptyAll() {
    setBusy(true)
    setError('')
    const units = new Map<string, string[]>()
    for (const item of items) {
      try {
        if (item.kind === 'unit') units.set(item.asset.id, [...(units.get(item.asset.id) ?? []), item.unitKey])
        else if (item.kind !== 'shared' || item.purgeable) await apply(item, false)
      } catch {
        // يبقى في السلة.
      }
    }
    for (const [assetId, keys] of units) await applyTrashedUnits(assetId, keys, false).catch(() => {})
    await refresh()
    setBusy(false)
    setEmptying(false)
    flash('تم إفراغ السلة')
  }

  const message = (item: Item, restore: boolean) => {
    if (restore) {
      if (item.kind === 'personal') return `${t('سيعود')} «${item.title}» ${t('إلى')} ${item.sub}. ${t('هل تريد المتابعة؟')}`
      if (item.kind === 'asset') return `${t('سيعود')} «${item.title}» ${t('إلى')} ${item.sub} ${t('بحالة «ملغي». هل تريد المتابعة؟')}`
      if (item.kind === 'unit') return `${t('ستعود')} «${item.title}» ${t('إلى أرشيف وحدات')} «${item.asset.title}». ${t('هل تريد المتابعة؟')}`
      return `${t('سيعود')} «${item.title}» ${t('إلى قائمة الالتزامات المشتركة. هل تريد المتابعة؟')}`
    }
    if (item.kind === 'asset') return `${t('سيُحذف')} «${item.title}» ${t('نهائيًا مع بياناته ولا يمكن استرجاعه بعدها. هل تريد الحذف؟')}`
    if (item.kind === 'unit') return `${t('ستُحذف')} «${item.title}» ${t('نهائيًا من')} «${item.asset.title}» ${t('ولا يمكن استرجاعها بعدها. هل تريد الحذف؟')}`
    return `${t('سيُحذف')} «${item.title}» ${t('نهائيًا ولا يمكن استرجاعه بعدها. هل تريد الحذف؟')}`
  }

  return (
    <div>
      <PageHeader icon={Trash2} color="#C4392E" title="سلة المهملات" subtitle="ما حذفته: استعادة أو حذف نهائي" />
      {notice && (
        <p className="mb-3 flex items-center gap-2 rounded-inner bg-brand-soft px-4 py-3 text-[13px] font-bold text-brand">
          <CheckCircle2 className="size-4" />
          {t(notice)}
        </p>
      )}
      <div className="flex items-end justify-between gap-2">
        <SectionTitle count={items.length}>{t('المحذوفات')}</SectionTitle>
        {items.length > 0 && (
          <button type="button" onClick={() => (setError(''), setEmptying(true))} className="mb-3 flex h-10 items-center gap-2 rounded-inner border border-danger bg-white px-3 text-[12px] font-extrabold text-danger hover:bg-danger-soft">
            <Trash2 className="size-4" />
            {t('إفراغ السلة')}
          </button>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : trashed.error ? (
        <p className="py-6 text-center text-[12.5px] text-muted">{t('تعذّر تحميل البيانات.')}</p>
      ) : items.length === 0 ? (
        <Empty icon={Trash2} text="السلة فارغة" />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {items.map((item) => {
            const [Icon, color] = ICONS[item.kind]
            const canPurge = item.kind !== 'shared' || item.purgeable
            return (
              <div key={item.key} className="card flex items-center gap-3 p-4">
                <IconBadge icon={Icon} color={color} size={44} />
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="break-words text-[14px] font-extrabold text-title">
                    {item.title}
                  </p>
                  <p dir="auto" className="text-[11.5px] font-bold" style={{ color }}>
                    {item.sub}
                  </p>
                  {item.at && (
                    <p className="text-[11px] text-muted">
                      {t('تاريخ الحذف')}: <span dir="ltr">{item.at}</span>
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => (setError(''), setAsk({ item, restore: true }))} className="flex h-10 shrink-0 items-center gap-1.5 rounded-inner border border-line bg-white px-3 text-[12px] font-extrabold text-brand hover:bg-brand-soft">
                  <ArchiveRestore className="size-4" />
                  <span className="hidden sm:inline">{t('استعادة')}</span>
                </button>
                {canPurge && (
                  <button type="button" aria-label={t('حذف نهائي')} title={t('حذف نهائي')} onClick={() => (setError(''), setAsk({ item, restore: false }))} className="grid size-10 shrink-0 place-items-center rounded-inner border border-line bg-white text-danger hover:bg-danger-soft">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      <p className="mt-5 rounded-inner bg-surface px-4 py-3 text-[12px] text-sub">{t('الالتزام المشترك مع أعضاء آخرين يُحذف من الخادم حين يحذفه كل الأعضاء.')}</p>
      <Confirm
        open={!!ask}
        title={ask?.restore ? 'استعادة' : 'حذف نهائي'}
        message={ask ? message(ask.item, ask.restore) : ''}
        confirmLabel={ask?.restore ? 'استعادة' : 'حذف نهائي'}
        danger={!ask?.restore}
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={() => setAsk(null)}
      />
      <Confirm
        open={emptying}
        title="إفراغ السلة"
        message={`${t('سيُحذف')} ${items.length} ${t('عنصرًا نهائيًا ولا يمكن استرجاعها. هل تريد المتابعة؟')}`}
        confirmLabel="إفراغ"
        danger
        busy={busy}
        error={error}
        onConfirm={emptyAll}
        onCancel={() => setEmptying(false)}
      />
    </div>
  )
}
