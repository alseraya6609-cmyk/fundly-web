import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useSession } from './session'
import { TRASH, useAssetEntries, useAssets, useUnitContracts, useUnitPayments, type Asset, type AssetEntry, type UnitContract, type UnitPayment } from './data'

/*
  ما فوّضني أصحابه بإدارته (delegated_assets.dart + fetchDelegatedAssets):
  - fundly_my_delegated_assets: صف لكل تفويض/وحدة ← المالك والصلاحيات
    والأصل كاملًا أو وحدات بعينها.
  - fundly_delegated_asset_rows: الأصل كاملًا، أو بوحداتي المفوَّضة وحدها.
  - العقود والدفعات والسجلات بالأصل (سياسات RLS للمفوَّض).
  تظهر في صفحة الأصول وحدها، لا في ملخصاتي وتقاريري (كما في التطبيق).
  كل ما يُكتب يبقى باسم المالك (trigger fundly_keep_asset_owner) ويصله إشعار.
*/

export type DelegatedAsset = {
  assetId: string
  ownerId: string
  ownerName: string
  ownerFnd: string
  permissions: string[]
  wholeAsset: boolean
  unitRefs: string[]
  delegationIds: string[]
}

export const DELEGATED_LABEL = 'مفوَّض أنا بإدارته'

let registry: Record<string, DelegatedAsset> = {}

export const delegatedOf = (assetId: string | null | undefined): DelegatedAsset | null => (assetId ? (registry[assetId] ?? null) : null)
export const isDelegated = (assetId: string | null | undefined) => !!delegatedOf(assetId)
/** مفوَّض على وحدات بعينها: لا يقرأ العقار ولا يعدّله إلا عبر دوال الخادم. */
export const isUnitScoped = (assetId: string | null | undefined) => {
  const d = delegatedOf(assetId)
  return !!d && !d.wholeAsset
}

export const ownerOf = (d: DelegatedAsset) => d.ownerName.trim() || d.ownerFnd
export const canAdd = (d: DelegatedAsset | null) => !d || d.permissions.includes('إضافة السجلات')
export const canEdit = (d: DelegatedAsset | null) => !d || d.permissions.includes('تعديل السجلات')
export const canDelete = (d: DelegatedAsset | null) => !d || d.permissions.includes('حذف السجلات')
export const canPay = (d: DelegatedAsset | null) => !d || d.permissions.some((p) => ['إضافة السجلات', 'تعديل السجلات', 'تنفيذ المدفوعات والتحويلات'].includes(p))
/** الكتابة في الأصل نفسه (الوحدات وبياناتها): إضافة أو تعديل. */
export const canWrite = (d: DelegatedAsset | null) => !d || d.permissions.some((p) => ['إضافة السجلات', 'تعديل السجلات'].includes(p))
export const plainPermissions = (d: DelegatedAsset) => d.permissions.filter((p) => !p.startsWith('@'))

/** allowsUnit */
export function allowsUnit(d: DelegatedAsset | null, unit: { number: string; name: string; index?: number }) {
  if (!d || d.wholeAsset) return true
  const n = unit.number.trim()
  const m = unit.name.trim()
  return (!!n && d.unitRefs.includes(n)) || (!!m && d.unitRefs.includes(m)) || (unit.index !== undefined && unit.index >= 0 && d.unitRefs.includes(String(unit.index)))
}

/** DelegatedAssets.replaceFromRows */
export function replaceFromRows(rows: unknown[]): Record<string, DelegatedAsset> {
  const out: Record<string, DelegatedAsset> = {}
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = String(r['asset_id'] ?? '').trim()
    if (!id) continue
    const cur = (out[id] ??= {
      assetId: id,
      ownerId: '',
      ownerName: '',
      ownerFnd: '',
      permissions: [],
      wholeAsset: false,
      unitRefs: [],
      delegationIds: [],
    })
    cur.ownerId = String(r['owner_id'] ?? '')
    cur.ownerName = String(r['owner_name'] ?? '')
    cur.ownerFnd = String(r['owner_fnd'] ?? '')
    const did = String(r['delegation_id'] ?? '').trim()
    if (did && !cur.delegationIds.includes(did)) cur.delegationIds.push(did)
    if (Array.isArray(r['permissions'])) for (const p of r['permissions']) if (!cur.permissions.includes(String(p))) cur.permissions.push(String(p))
    const ref = r['unit_ref'] === null || r['unit_ref'] === undefined ? '' : String(r['unit_ref']).trim()
    if (!ref) cur.wholeAsset = true
    else if (!cur.unitRefs.includes(ref)) cur.unitRefs.push(ref)
  }
  registry = out
  return out
}

/** صف الأصل كما يراه المفوَّض (fundly_delegated_asset_rows). */
async function delegatedRows(): Promise<Asset[]> {
  const { data, error } = await supabase.rpc('fundly_delegated_asset_rows')
  if (error) throw error
  return (Array.isArray(data) ? (data as Asset[]) : []).filter((a) => a.status !== TRASH)
}

export async function fetchDelegatedAssets(myId: string): Promise<{ byId: Record<string, DelegatedAsset>; assets: Asset[] }> {
  const { data, error } = await supabase.rpc('fundly_my_delegated_assets')
  // قبل تشغيل ترحيل التفويض في الخادم: لا عناصر مفوَّضة.
  if (error) {
    registry = {}
    return { byId: {}, assets: [] }
  }
  const byId = replaceFromRows(Array.isArray(data) ? data : [])
  const ids = Object.keys(byId)
  if (!ids.length) return { byId, assets: [] }
  let assets: Asset[]
  try {
    assets = await delegatedRows()
  } catch {
    // قبل ترحيل «إكمال التفويض»: القراءة المباشرة.
    const res = await supabase.from('project_assets').select('*').in('id', ids).neq('user_id', myId)
    if (res.error) throw res.error
    assets = ((res.data ?? []) as Asset[]).filter((a) => a.status !== TRASH)
  }
  return { byId, assets: assets.filter((a) => ids.includes(a.id)) }
}

/** أحدث صف للأصل المفوَّض على وحدات (لا قراءة مباشرة له). */
export async function delegatedFresh<T>(assetId: string): Promise<T | null> {
  const list = await delegatedRows()
  return (list.find((a) => a.id === assetId) as unknown as T) ?? null
}

/** fundly_save_delegated_units: الخادم يستبدل وحداتي فقط ويُبقي الباقي. */
export async function saveDelegatedUnits(assetId: string, unitsJson: string) {
  const { error } = await supabase.rpc('fundly_save_delegated_units', { p_asset: assetId, p_units: unitsJson })
  if (error) throw error
}

// ---------------- الجلب للصفحة ----------------

export function useDelegatedAssets() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['assets', 'delegated', user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () => fetchDelegatedAssets(user!.id),
  })
}

function useDelegatedIds() {
  const q = useDelegatedAssets()
  return (q.data?.assets ?? []).map((a) => a.id)
}

function useDelegatedContracts() {
  const ids = useDelegatedIds()
  return useQuery({
    queryKey: ['unit-contracts', 'delegated', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('property_unit_contracts').select('*').in('asset_id', ids).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as UnitContract[]
    },
  })
}

function useDelegatedPayments() {
  const contracts = useDelegatedContracts()
  const ids = (contracts.data ?? []).map((c) => c.id)
  return useQuery({
    queryKey: ['unit-payments', 'delegated', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('property_unit_payments').select('*').in('contract_id', ids).order('due_date', { ascending: true })
      if (error) throw error
      return (data ?? []) as UnitPayment[]
    },
  })
}

function useDelegatedEntries() {
  const ids = useDelegatedIds()
  return useQuery({
    queryKey: ['asset-entries', 'delegated', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_asset_entries')
        .select('id, asset_id, kind, data, attachment_url, created_at')
        .in('asset_id', ids)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AssetEntry[]
    },
  })
}

function merge<T extends { id: string }>(mine: T[] | undefined, theirs: T[] | undefined): T[] | undefined {
  if (!mine) return mine
  if (!theirs?.length) return mine
  const seen = new Set(mine.map((x) => x.id))
  return [...mine, ...theirs.filter((x) => !seen.has(x.id))]
}

/** صفحة الأصول: أصولي + ما فُوِّضت بإدارته. */
export function usePageAssets() {
  const mine = useAssets()
  const delegated = useDelegatedAssets()
  return { ...mine, data: merge(mine.data, delegated.data?.assets) }
}
export function usePageContracts() {
  const mine = useUnitContracts()
  const delegated = useDelegatedContracts()
  return { ...mine, data: merge(mine.data, delegated.data) }
}
export function usePagePayments() {
  const mine = useUnitPayments()
  const delegated = useDelegatedPayments()
  return { ...mine, data: merge(mine.data, delegated.data) }
}
export function usePageEntries() {
  const mine = useAssetEntries()
  const delegated = useDelegatedEntries()
  return { ...mine, data: merge(mine.data, delegated.data) }
}
