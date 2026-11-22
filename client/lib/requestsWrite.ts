import { supabase } from './supabase'
import { date } from './format'
import type { InboxItem, Store } from './data'

/*
  الرد على الطلبات كما في التطبيق (lib/data/requests_data.dart ← RequestsData):
  - دعوة التزام مشترك: «قبول الأعضاء»[رقمي] = {name, state, at} بعد التحقق من
    أن الدعوة لم يُرد عليها ولم تنتهِ مهلتها (24 ساعة).
  - عهدة أو دين أُسند إليّ: حالة الإسناد «مقبولة» أو «مرفوضة» وتاريخ الرد.
  - تفويض وصلني: علامة @accept:accepted أو @accept:rejected في الصلاحيات.
  ثم يُعلَّم الطلب «مقروءًا». والخادم يرسل الرد إلى المرسل بنفسه
  (fundly_share_row و fundly_inbox_action) ويُبقي مالك السجل كما هو.

  الموقع يكتب التفاصيل وحدها (لا مالك السجل ولا بقية الأعمدة)، على أحدث نسخة
  في الخادم، وبشرط ألا تكون تغيّرت منذ قراءتها.

  سند قبض الراتب يحتاج توقيعًا: من التطبيق.
*/

const ACCEPT_KEY = 'قبول الأعضاء'
const INVITE_AT_KEY = 'وقت دعوة الأعضاء'
const CREATOR_KEY = 'معرف المنشئ'
const INVITE_HOURS = 24
const ID_IN_NAME = /\((FND-[A-Z2-9]{4}-[A-Z2-9]{4})\)/g

/** ردود تعني أن الطلب لم يعد ينتظر ردًا (RequestsData.closedMessages). */
export const CLOSED = new Set(['سبق أن رددت على هذه الدعوة', 'لم يعد هذا الطلب قائمًا', 'انتهت صلاحية الدعوة (24 ساعة) — اطلب من المنشئ إعادتها'])

export const INFO_ACTIONS = new Set(['accepted', 'rejected', 'activity', 'announcement', 'admin_message', 'support', 'archived', 'removed'])

/** يُرد عليه من الموقع؟ */
export function canRespond(item: InboxItem): boolean {
  if (INFO_ACTIONS.has(item.action ?? 'invite')) return false
  return ['shared_entries', 'personal_entries', 'delegations'].includes(item.source)
}
export const isInfo = (item: InboxItem) => INFO_ACTIONS.has(item.action ?? 'invite')

const pad2 = (n: number) => String(n).padStart(2, '0')
function stampNow() {
  const n = new Date()
  return `${n.getDate()}/${n.getMonth() + 1}/${n.getFullYear()} ${pad2(n.getHours())}:${pad2(n.getMinutes())}`
}

// ---------------- الاسم الظاهر للآخرين (AppSettings.publicName) ----------------

const parts = (v: string) => v.trim().split(/\s+/).filter(Boolean)

export function publicName(store: Store | undefined, fallback = ''): string {
  const s = (k: string) => String(store?.[k] ?? '').trim()
  const full = s('settings_profile_name') || fallback
  const givenRaw = s('settings_profile_given_name')
  const given = givenRaw || (parts(full).length >= 2 ? parts(full).slice(0, -1).join(' ') : parts(full).join(' '))
  const family = givenRaw ? s('settings_profile_family_name') : parts(full).length >= 2 ? parts(full).slice(-1)[0] : ''
  const mode = s('settings_shared_name_mode') === 'الاسم الأول فقط' ? 'الاسم الأول' : s('settings_shared_name_mode')
  const p = parts(given || full)
  const first = p.length ? p[0] : full
  if (mode === 'الاسم الأول') return first
  if (mode === 'الاسم الأول والقبيلة') return [first, family].filter(Boolean).join(' ')
  if (mode === 'اسم مستعار' && s('settings_shared_nickname')) return s('settings_shared_nickname')
  return full
}

// ---------------- أدوات ----------------

const asStrings = (d: Record<string, unknown> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)]))

function jsonMap(raw: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

type Row = { id: string; details: Record<string, unknown>; created_at: string; updated_at: string }

async function fresh(table: string, id: string): Promise<Row | null> {
  const { data, error } = await supabase.from(table).select('id, details, created_at, updated_at').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Row | null) ?? null
}

class Conflict extends Error {}

/** يكتب التفاصيل بشرط ألا يكون السجل تغيّر منذ قراءته. */
async function writeDetails(table: string, row: Row, details: Record<string, unknown>) {
  const { data, error } = await supabase.from(table).update({ details }).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Conflict()
}

/** SharedMemberState.stampInvites: كل رقم عضو بلا وقت دعوة يُسجَّل وقته الآن (كما يفعل التطبيق عند كل حفظ). */
function stampInvites(details: Record<string, string>): Record<string, string> {
  const raw = details['الأعضاء'] ?? ''
  if (!raw) return details
  const creator = (details[CREATOR_KEY] ?? '').trim()
  const ids = new Set([...raw.matchAll(ID_IN_NAME)].map((m) => m[1]).filter((id) => id !== creator))
  if (!ids.size) return details
  const times = Object.fromEntries(Object.entries(jsonMap(details[INVITE_AT_KEY])).map(([k, v]) => [k, String(v)]))
  let changed = false
  const now = new Date().toISOString()
  for (const id of ids) {
    if (!(id in times)) {
      times[id] = now
      changed = true
    }
  }
  return changed ? { ...details, [INVITE_AT_KEY]: JSON.stringify(times) } : details
}

async function respondShared(item: InboxItem, accept: boolean, me: string, name: string): Promise<string | null> {
  const row = await fresh('shared_entries', item.record_id)
  if (!row) return 'لم يعد هذا الطلب قائمًا'
  const details = asStrings(row.details)
  const map = jsonMap(details[ACCEPT_KEY]) as Record<string, unknown>
  if (me in map) return 'سبق أن رددت على هذه الدعوة'
  const sentRaw = String(jsonMap(details[INVITE_AT_KEY])[me] ?? '')
  const sent = new Date(sentRaw || row.created_at)
  if (!Number.isNaN(sent.getTime()) && Date.now() - sent.getTime() >= INVITE_HOURS * 3_600_000)
    return 'انتهت صلاحية الدعوة (24 ساعة) — اطلب من المنشئ إعادتها'
  map[me] = { name, state: accept ? 'accepted' : 'rejected', at: stampNow() }
  const next = stampInvites({ ...details, [ACCEPT_KEY]: JSON.stringify(map) })
  // ما لم يتغيّر يُكتب بقيمته الأصلية كما هي.
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(next)) out[k] = k in row.details && details[k] === v ? row.details[k] : v
  await writeDetails('shared_entries', row, out)
  return null
}

async function respondCustody(item: InboxItem, accept: boolean, me: string, name: string): Promise<string | null> {
  const row = await fresh('personal_entries', item.record_id)
  if (!row) return 'لم يعد هذا الطلب قائمًا'
  const details = asStrings(row.details)
  const state = (details['عهدة_حالة_الإسناد'] ?? '').trim()
  const holder = (details['عهدة_مسندة_إلى'] ?? '').trim()
  if (state !== 'بانتظار القبول' || holder !== me) return 'لم يعد هذا الطلب قائمًا'
  const out: Record<string, unknown> = { ...row.details }
  out['عهدة_حالة_الإسناد'] = accept ? 'مقبولة' : 'مرفوضة'
  if (accept && name.trim()) out['عهدة_المسند_إليه_الاسم'] = name.trim()
  out['عهدة_تاريخ_الرد'] = stampNow()
  await writeDetails('personal_entries', row, out)
  return null
}

async function respondDelegation(item: InboxItem, accept: boolean): Promise<string | null> {
  const { data, error } = await supabase.from('delegations').select('id, permissions').eq('id', item.record_id).maybeSingle()
  if (error) throw error
  if (!data) return 'لم يعد هذا الطلب قائمًا'
  const permissions = [...((data.permissions as string[] | null) ?? []).filter((p) => !String(p).startsWith('@accept:')), `@accept:${accept ? 'accepted' : 'rejected'}`]
  const { error: saveError } = await supabase.from('delegations').update({ permissions }).eq('id', item.record_id)
  if (saveError) throw saveError
  return null
}

export async function markSeen(ids: string[]) {
  if (!ids.length) return
  await supabase.from('fundly_inbox').update({ status: 'seen', seen_at: new Date().toISOString() }).in('id', ids)
}

/** قبول الطلب أو رفضه. null عند النجاح، أو رسالة السبب. */
export async function respond(item: InboxItem, accept: boolean, me: string, name: string): Promise<string | null> {
  if (!me) return 'تعذّر الحفظ. تحقّق من الاتصال وحاول مرة أخرى.'
  let result: string | null = null
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        if (item.source === 'shared_entries') result = await respondShared(item, accept, me, name)
        else if (item.source === 'personal_entries') result = await respondCustody(item, accept, me, name)
        else if (item.source === 'delegations') result = await respondDelegation(item, accept)
        else return 'افتح القسم للرد على هذا الطلب'
        break
      } catch (e) {
        if (e instanceof Conflict && attempt < 3) continue
        throw e
      }
    }
  } catch {
    return 'تعذّر الحفظ. تحقّق من الاتصال وحاول مرة أخرى.'
  }
  if (result === null || CLOSED.has(result)) await markSeen([item.id]).catch(() => {})
  return result
}

/** تفاصيل الطلب للعرض قبل الرد (RequestsData.details). */
export async function requestDetails(item: InboxItem): Promise<[string, string][]> {
  const rows: [string, string][] = []
  if (!['shared_entries', 'personal_entries'].includes(item.source)) return rows
  try {
    const { data } = await supabase.from(item.source).select('amount, due_date, details').eq('id', item.record_id).maybeSingle()
    if (!data) return rows
    if (Number(data.amount)) rows.push(['المبلغ', String(Math.round(Number(data.amount)))])
    if (data.due_date) rows.push(['التاريخ', date(data.due_date)])
    for (const [k, raw] of Object.entries(asStrings(data.details as Record<string, unknown>))) {
      const key = k.trim()
      const value = raw.trim()
      if (!key || !value || key.startsWith('عهدة_') || key.startsWith('_')) continue
      // مفاتيح داخلية للمزامنة والمشاركة لا تُعرض في الموقع.
      if (/^(معرف المنشئ|قبول الأعضاء|وقت دعوة الأعضاء|مؤرشف عند|محذوف عند|سجل تاريخي عند)$/.test(key)) continue
      if (value.startsWith('[') || value.startsWith('{') || value.length > 160) continue
      if (/(كلمة|كلمات|سر|رمز|pin|pass|password|secret|otp|cvv)/i.test(key)) continue
      if (rows.some((r) => r[0] === key)) continue
      rows.push([key, value])
    }
  } catch {
    // بلا اتصال: بيانات الطلب وحدها.
  }
  return rows
}
