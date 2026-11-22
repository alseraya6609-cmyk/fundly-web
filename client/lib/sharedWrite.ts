import { supabase } from './supabase'
import type { Entry } from './data'

/*
  أرشفة الالتزام المشترك وإخراجه من الأرشيف كما في التطبيق
  (shared_commitments_screen.dart ← _archiveCommitment و SharedMemberState):
  - فيه أعضاء آخرون بأرقامهم: الأرشفة عندي وحدي — رقمي في «مؤرشف عند»،
    ويصل الأعضاء إشعار من الخادم.
  - بلا أعضاء آخرين: حالة الالتزام نفسه «مؤرشف» أو «نشطة».
  الكتابة على أحدث نسخة في الخادم، للتفاصيل أو الحالة وحدها، وبشرط ألا يكون
  السجل تغيّر منذ قراءته.

  الحذف والمغادرة والإلغاء (التسوية والسجل التاريخي وسبب الحذف) من التطبيق.
*/

const ARCHIVED_KEY = 'مؤرشف عند'
const ACCEPT_KEY = 'قبول الأعضاء'
const ID = /FND-[A-Z2-9]{4}-[A-Z2-9]{4}/g
const ARCHIVED = 'مؤرشف'
const ACTIVE = 'نشطة'

const asStrings = (d: Record<string, unknown> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)]))

function idsIn(details: Record<string, string>, key: string): Set<string> {
  try {
    const list = JSON.parse(details[key] || '[]')
    return new Set(Array.isArray(list) ? list.map((v) => String(v).trim()).filter(Boolean) : [])
  } catch {
    return new Set()
  }
}

/** SharedMemberState.participants: كل الأرقام في التفاصيل بلا من رفض أو أُلغيت دعوته. */
function participants(details: Record<string, string>): Set<string> {
  const rejected = new Set<string>()
  try {
    const map = JSON.parse(details[ACCEPT_KEY] || '{}')
    if (map && typeof map === 'object')
      for (const [k, v] of Object.entries(map as Record<string, { state?: string }>))
        if (v && (v.state === 'rejected' || v.state === 'cancelled')) rejected.add(k)
  } catch {
    // تالف: لا أحد مستبعد.
  }
  const out = new Set<string>()
  for (const value of Object.values(details)) for (const m of value.matchAll(ID)) out.add(m[0])
  for (const r of rejected) out.delete(r)
  return out
}

export const archivedForMe = (e: Entry, me: string) => !!me && idsIn(asStrings(e.details), ARCHIVED_KEY).has(me)

type Row = { id: string; status: string; details: Record<string, unknown>; updated_at: string }
class Conflict extends Error {}
export class SharedError extends Error {}

/** archive=true أرشفة، false إخراج. */
export async function setSharedArchived(entry: Entry, me: string, archive: boolean): Promise<void> {
  if (!me) throw new SharedError('تعذر تنفيذ العملية. حاول مرة أخرى.')
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('shared_entries').select('id, status, details, updated_at').eq('id', entry.id).maybeSingle()
    if (error) throw error
    if (!data) throw new SharedError('لم يعد هذا الالتزام موجودًا')
    const row = data as Row
    const details = asStrings(row.details)
    const mine = idsIn(details, ARCHIVED_KEY).has(me)
    let patch: Record<string, unknown> | null = null
    if (mine || (row.status !== ARCHIVED && [...participants(details)].some((id) => id !== me))) {
      // عندي وحدي: رقمي في «مؤرشف عند» (SharedMemberState.withMine — مرتّبة).
      if (mine === archive) return
      const set = idsIn(details, ARCHIVED_KEY)
      if (archive) set.add(me)
      else set.delete(me)
      patch = { details: { ...row.details, [ARCHIVED_KEY]: JSON.stringify([...set].sort()) } }
    } else {
      const archivedNow = row.status === ARCHIVED
      if (archivedNow === archive) return
      patch = { status: archive ? ARCHIVED : ACTIVE }
    }
    try {
      const { data: saved, error: saveError } = await supabase.from('shared_entries').update(patch).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
      if (saveError) throw saveError
      if (!saved || saved.length === 0) throw new Conflict()
      return
    } catch (e) {
      if (e instanceof Conflict) continue
      throw e
    }
  }
  throw new SharedError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}
