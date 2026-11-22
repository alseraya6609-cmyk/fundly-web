import { supabase } from './supabase'
import { AssetError } from './assetWrite'
import { joinLogs, splitLogs } from './vehicleWrite'
import type { Entry } from './data'

/*
  إلغاء الأرشفة (ArchiveCenter) وسلة المهملات (TrashScreen / TrashStore):
  - الأصل المؤرشف ← «نشط» وغير مجمّد؛ الوحدة المؤرشفة ← «شاغرة» أو إلى السلة
    («محذوفة» + الحالة قبل الحذف وتاريخه ومصدره في extras).
  - المشترك المكتمل يعود إلى القائمة بإضافته إلى shared_completed_shown_v1.
  - السلة: الالتزامات الشخصية، والعقارات والأنشطة والمركبات، ووحدات العقارات:
    استعادة إلى الحالة السابقة أو حذف نهائي.
*/

export const TRASH_STATUS = 'محذوف'
export const PREV_STATUS_KEY = 'الحالة قبل الحذف'
export const DELETED_AT_KEY = 'تاريخ الحذف'
export const SOURCE_KEY = 'مصدر السجل'
const UNIT_ARCHIVED = 'مؤرشفة'
export const UNIT_TRASHED = 'محذوفة'

type Raw = Record<string, unknown>

/** TrashStore.stamp: سنة/شهر/يوم ساعة:دقيقة */
export function trashStamp() {
  const n = new Date()
  const two = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}/${two(n.getMonth() + 1)}/${two(n.getDate())} ${two(n.getHours())}:${two(n.getMinutes())}`
}

const extrasOf = (u: Raw): Record<string, string> =>
  u['extras'] && typeof u['extras'] === 'object' ? Object.fromEntries(Object.entries(u['extras'] as Raw).map(([k, v]) => [k, String(v ?? '')])) : {}

/** مفتاح الوحدة: المثبَّت (__key) أو «النوع|الاسم|الرقم». */
export function rawUnitKey(u: Raw) {
  const pinned = (extrasOf(u)['__key'] ?? '').trim()
  return pinned || `${u['type'] ?? ''}|${u['name'] ?? ''}|${u['unitNumber'] ?? ''}`
}

function decode(raw: string | null | undefined): Raw[] {
  try {
    const list = JSON.parse(String(raw ?? '') || '[]')
    return Array.isArray(list) ? list.filter((u) => u && typeof u === 'object') : []
  } catch {
    return []
  }
}

/** يعيد كتابة وحدات العقار من أحدث نسخة وبشرط عدم تغيّرها. */
async function rewriteUnits(assetId: string, change: (units: Raw[]) => Raw[] | null) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('project_assets').select('id, units_json, updated_at').eq('id', assetId).maybeSingle()
    if (error) throw error
    const fresh = data as { id: string; units_json: string | null; updated_at: string } | null
    if (!fresh) throw new AssetError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
    const next = change(decode(fresh.units_json))
    if (!next) throw new AssetError('الوحدة غير موجودة — ربما عُدّلت من التطبيق')
    const { data: saved, error: saveError } = await supabase.from('project_assets').update({ units_json: JSON.stringify(next) }).eq('id', assetId).eq('updated_at', fresh.updated_at).select('id')
    if (saveError) throw saveError
    if (saved && saved.length) return
  }
  throw new AssetError('تغيّر السجل أثناء الحفظ — أعد المحاولة')
}

function changeFirst(units: Raw[], status: string, key: string, change: (u: Raw) => Raw): Raw[] | null {
  let found = false
  const out = units.map((u) => {
    if (!found && u['status'] === status && rawUnitKey(u) === key) {
      found = true
      return change(u)
    }
    return u
  })
  return found ? out : null
}

/** إخراج وحدة مؤرشفة: تعود «شاغرة». */
export const unarchiveUnit = (assetId: string, key: string) => rewriteUnits(assetId, (units) => changeFirst(units, UNIT_ARCHIVED, key, (u) => ({ ...u, status: 'شاغرة' })))

/** وحدة مؤرشفة ← سلة المهملات. */
export const archivedUnitToTrash = (assetId: string, key: string, assetTitle: string) =>
  rewriteUnits(assetId, (units) =>
    changeFirst(units, UNIT_ARCHIVED, key, (u) => ({
      ...u,
      status: UNIT_TRASHED,
      extras: { ...extrasOf(u), [PREV_STATUS_KEY]: UNIT_ARCHIVED, [DELETED_AT_KEY]: trashStamp(), [SOURCE_KEY]: `العقارات — ${assetTitle}` },
    })),
  )

/** وحدات السلة: استعادة إلى أرشيف الوحدات (أو حالتها السابقة) أو حذف نهائي من العقار. */
export const applyTrashedUnits = (assetId: string, keys: string[], restore: boolean) =>
  rewriteUnits(assetId, (units) => {
    const out: Raw[] = []
    for (const u of units) {
      const inTrash = u['status'] === UNIT_TRASHED && keys.includes(rawUnitKey(u))
      if (!inTrash) {
        out.push(u)
        continue
      }
      if (!restore) continue
      const extras = extrasOf(u)
      const previous = (extras[PREV_STATUS_KEY] ?? '').trim()
      for (const k of [PREV_STATUS_KEY, DELETED_AT_KEY, SOURCE_KEY]) delete extras[k]
      out.push({ ...u, status: previous || UNIT_ARCHIVED, extras })
    }
    return out
  })

async function setAssetStatus(assetId: string, patch: (fresh: { logs_json: string | null }) => Record<string, unknown>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('project_assets').select('id, logs_json, updated_at').eq('id', assetId).maybeSingle()
    if (error) throw error
    const fresh = data as { id: string; logs_json: string | null; updated_at: string } | null
    if (!fresh) throw new AssetError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
    const { data: saved, error: saveError } = await supabase.from('project_assets').update(patch(fresh)).eq('id', assetId).eq('updated_at', fresh.updated_at).select('id')
    if (saveError) throw saveError
    if (saved && saved.length) return
  }
  throw new AssetError('تغيّر السجل أثناء الحفظ — أعد المحاولة')
}

/** إخراج الأصل من الأرشيف: «نشط» وغير مجمّد. */
export const unarchiveAsset = (assetId: string) => setAssetStatus(assetId, () => ({ status: 'نشط', is_frozen: false }))

/** استعادة أصل من السلة إلى حالته السابقة (أو «ملغي»)، وتُنزع مفاتيح السلة من بياناته. */
export const restoreAsset = (assetId: string) =>
  setAssetStatus(assetId, (fresh) => {
    const { meta, logs } = splitLogs(fresh.logs_json)
    const previous = (meta[PREV_STATUS_KEY] ?? '').trim()
    for (const k of [PREV_STATUS_KEY, DELETED_AT_KEY, SOURCE_KEY]) delete meta[k]
    return { status: previous || 'ملغي', logs_json: joinLogs(meta, logs) }
  })

export async function deleteAssetForever(assetId: string) {
  const { error } = await supabase.from('project_assets').delete().eq('id', assetId)
  if (error) throw error
}

/** استعادة التزام شخصي من السلة إلى حالته السابقة (أو «نشطة»). */
export async function restorePersonal(e: Entry) {
  const details = { ...((e.details ?? {}) as Record<string, unknown>) }
  const previous = String(details[PREV_STATUS_KEY] ?? '').trim()
  for (const k of [PREV_STATUS_KEY, DELETED_AT_KEY, SOURCE_KEY]) delete details[k]
  const { data, error } = await supabase.from('personal_entries').update({ status: previous || 'نشطة', details }).eq('id', e.id).select('id')
  if (error) throw error
  if (!data || !data.length) throw new AssetError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
}

export async function deletePersonalForever(id: string) {
  const { error } = await supabase.from('personal_entries').delete().eq('id', id)
  if (error) throw error
}

/** المشترك المكتمل يعود إلى قائمتي (shared_completed_shown_v1). */
export async function showCompletedShared(id: string) {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return
  const KEY = 'shared_completed_shown_v1'
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('fundly_user_store').select('value, updated_at').eq('user_id', uid).eq('key', KEY).maybeSingle()
    if (error) throw error
    const row = data as { value: string; updated_at: string } | null
    let list: string[] = []
    if (row) {
      try {
        const w = JSON.parse(row.value)
        if (w?.t !== 'l' || !Array.isArray(w.v)) throw new Error()
        list = w.v.map(String)
      } catch {
        throw new AssetError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
      }
    }
    if (list.includes(id)) return
    const value = JSON.stringify({ t: 'l', v: [...list, id] })
    const now = new Date().toISOString()
    if (row) {
      const { data: saved, error: saveError } = await supabase.from('fundly_user_store').update({ value, updated_at: now }).eq('user_id', uid).eq('key', KEY).eq('updated_at', row.updated_at).select('key')
      if (saveError) throw saveError
      if (saved && saved.length) return
    } else {
      const { error: insertError } = await supabase.from('fundly_user_store').insert({ user_id: uid, key: KEY, value, updated_at: now })
      if (!insertError) return
      if (String((insertError as { code?: string }).code) !== '23505') throw insertError
    }
  }
  throw new AssetError('تغيّر السجل أثناء الحفظ — أعد المحاولة')
}
