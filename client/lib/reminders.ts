import { supabase } from './supabase'

/*
  تذكيرات الانتهاء (AppRemindersStore في التطبيق): مفتاح app_expiry_reminders_v1
  في بيانات المستخدم، قائمة نصوص JSON لكل تذكير {id, title, module,
  expiryDate, remindBeforeDays}. التطبيق يقرؤها بعد المزامنة وينبّه بها.
*/

const KEY = 'app_expiry_reminders_v1'

export type Reminder = { id: string; title: string; module: string; expiryDate: string; remindBeforeDays: number }

/** reminderDaysFromLabel */
export const reminderDays = (label: string) => ({ 'قبل يوم': 1, 'قبل 3 أيام': 3, 'قبل أسبوع': 7, 'قبل أسبوعين': 14, 'قبل شهر': 30 })[label] ?? 0

/** يوم/شهر/سنة ← تاريخ ISO محلي كما يحفظه Dart (toIso8601String). */
export function isoOf(display: string): string | null {
  const p = display.trim().split('/')
  if (p.length !== 3) return null
  const [d, m, y] = p.map((x) => parseInt(x, 10))
  if ([d, m, y].some(Number.isNaN)) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000`
}

/** AppRemindersStore.upsert / remove: بالمعرّف، على أحدث نسخة وبشرط عدم تغيّرها. */
export async function changeReminders(upserts: Reminder[], removeIds: string[] = []) {
  if (!upserts.length && !removeIds.length) return
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('fundly_user_store').select('value, updated_at').eq('user_id', uid).eq('key', KEY).maybeSingle()
    if (error) throw error
    const row = data as { value: string; updated_at: string } | null
    let list: string[] = []
    if (row) {
      try {
        const wrapper = JSON.parse(row.value)
        if (wrapper?.t !== 'l' || !Array.isArray(wrapper.v)) return
        list = wrapper.v.map(String)
      } catch {
        return // شكل غير متوقع: لا يُكتب فوقه.
      }
    }
    const idOf = (s: string) => {
      try {
        return String(JSON.parse(s)?.id ?? '')
      } catch {
        return ''
      }
    }
    // المعدَّل يبقى في مكانه، والجديد في الآخر (كما يفعل upsert).
    const next = list
      .map((s) => {
        const id = idOf(s)
        const u = upserts.find((r) => r.id === id)
        return u ? JSON.stringify(u) : removeIds.includes(id) ? null : s
      })
      .filter((s): s is string => s !== null)
    for (const u of upserts) if (!list.some((s) => idOf(s) === u.id)) next.push(JSON.stringify(u))
    const value = JSON.stringify({ t: 'l', v: next })
    const now = new Date().toISOString()
    if (row) {
      const { data: saved, error: saveError } = await supabase.from('fundly_user_store').update({ value, updated_at: now }).eq('user_id', uid).eq('key', KEY).eq('updated_at', row.updated_at).select('key')
      if (saveError) throw saveError
      if (saved && saved.length) return
    } else {
      if (!upserts.length) return
      const { error: insertError } = await supabase.from('fundly_user_store').insert({ user_id: uid, key: KEY, value, updated_at: now })
      if (!insertError) return
      if (String((insertError as { code?: string }).code) !== '23505') throw insertError
    }
  }
}
