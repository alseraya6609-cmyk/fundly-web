import { supabase } from './supabase'
import type { Asset, UnitContract } from './data'
import { AssetError } from './assetWrite'
import { joinLogs, splitLogs } from './vehicleWrite'

/*
  قائمة الثلاث نقاط في تفاصيل الأصل (_onTopMenuAction):
  - «إلغاء»: يصير «ملغي» مع «تاريخ الإلغاء»، ويبقى في «السجل التاريخي» ولا
    يُحذف (العقارات والأنشطة والمركبات). يُمنع ما دام عليه عقد إيجار ساري
    (_cancelBlockedMessage).
  - «أرشفة»: «مؤرشف» مجمّدًا مع «تاريخ الأرشفة».
*/

export const isCancelledAsset = (a: Asset) => (a.status ?? '').includes('ملغ')

const closed = (c: UnitContract) => ['expired', 'ended', 'cancelled'].includes(c.status)

/** _cancelBlockedMessage */
export function cancelBlockedMessage(asset: Asset, contracts: UnitContract[]): string | null {
  if (isCancelledAsset(asset)) return null
  const live = contracts.filter((c) => c.asset_id === asset.id && !closed(c) && c.status !== 'pending')
  if (!live.length) return null
  const tenants = [...new Set(live.map((c) => (c.tenant_name ?? '').trim()).filter(Boolean))]
  const where = asset.category === 'equipment' ? '«إدارة التأجير»' : asset.category === 'business' ? '«إدارة النشاط»' : '«إدارة الإيجار» في الوحدة'
  return (
    `لا يمكن إلغاء «${asset.title}» الآن: عليه عقد إيجار ساري${tenants.length ? ` (المستأجر: ${tenants.join('، ')})` : ''}.\n` +
    `قم بتسوية عقد الإيجار الساري وإلغائه أولًا من ${where}، ثم ألغِ.`
  )
}

const isoToday = () => {
  const d = new Date()
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function patchAsset(assetId: string, build: (meta: Record<string, string>) => { meta: Record<string, string>; columns: Record<string, unknown> }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('project_assets').select('id, logs_json, updated_at').eq('id', assetId).maybeSingle()
    if (error) throw error
    const fresh = data as { id: string; logs_json: string | null; updated_at: string } | null
    if (!fresh) throw new AssetError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
    const { meta, logs } = splitLogs(fresh.logs_json)
    const next = build({ ...meta })
    const { data: saved, error: saveError } = await supabase
      .from('project_assets')
      .update({ ...next.columns, logs_json: joinLogs(next.meta, logs) })
      .eq('id', assetId)
      .eq('updated_at', fresh.updated_at)
      .select('id')
    if (saveError) throw saveError
    if (saved && saved.length) return
  }
  throw new AssetError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

export async function cancelAsset(asset: Asset, contracts: UnitContract[]) {
  const blocked = cancelBlockedMessage(asset, contracts)
  if (blocked) throw new AssetError(blocked)
  if (isCancelledAsset(asset)) throw new AssetError(`«${asset.title}» ملغى ولا يُحذف — تجده في «السجل التاريخي»`)
  const now = new Date()
  await patchAsset(asset.id, (meta) => ({
    meta: { ...meta, 'تاريخ الإلغاء': `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}` },
    columns: { status: 'ملغي', needs_attention: false },
  }))
}

export async function archiveAsset(asset: Asset) {
  await patchAsset(asset.id, (meta) => ({
    meta: { ...meta, 'تاريخ الأرشفة': isoToday() },
    columns: { status: 'مؤرشف', needs_attention: false, is_frozen: true },
  }))
}
