import { supabase } from './supabase'

/*
  كتابة مفتاح في fundly_user_store (نسخة بيانات الجوال السحابية) بنفس شكل
  التطبيق: {"t": "s|b|i|d|l", "v": ...}. القراءة ثم الكتابة بشرط أن
  updated_at لم يتغيّر، والإدراج عند عدم وجود المفتاح (23505 = أُنشئ للتو
  من جهاز آخر فيُعاد).
*/

export type Wrapped = { t: string; v: unknown }

export class StoreError extends Error {}

/**
 * [change] تستلم القيمة الحالية (null إن لم يوجد المفتاح) وتعيد الجديدة،
 * أو undefined لعدم الكتابة. تعيد ما كُتب (أو null).
 */
export async function mutateStore(key: string, change: (current: Wrapped | null) => Wrapped | undefined): Promise<Wrapped | null> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) throw new StoreError('سجّل الدخول أولًا')
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('fundly_user_store').select('value, updated_at').eq('user_id', uid).eq('key', key).maybeSingle()
    if (error) throw error
    const row = data as { value: string; updated_at: string } | null
    let current: Wrapped | null = null
    if (row) {
      try {
        const parsed = JSON.parse(row.value)
        if (!parsed || typeof parsed !== 'object' || !('t' in parsed)) throw new Error()
        current = parsed as Wrapped
      } catch {
        throw new StoreError('تعذّرت قراءة السجل — نفّذ ذلك من التطبيق')
      }
    }
    const next = change(current)
    if (next === undefined) return null
    const value = JSON.stringify(next)
    const now = new Date().toISOString()
    if (row) {
      const { data: saved, error: saveError } = await supabase
        .from('fundly_user_store')
        .update({ value, updated_at: now })
        .eq('user_id', uid)
        .eq('key', key)
        .eq('updated_at', row.updated_at)
        .select('key')
      if (saveError) throw saveError
      if (saved && saved.length) return next
    } else {
      const { error: insertError } = await supabase.from('fundly_user_store').insert({ user_id: uid, key, value, updated_at: now })
      if (!insertError) return next
      if (String((insertError as { code?: string }).code) !== '23505') throw insertError
    }
  }
  throw new StoreError('تغيّر السجل أثناء الحفظ — أعد المحاولة')
}

/** قيم نصية (إعدادات الملف الشخصي مثلًا): تُكتب كما يكتبها التطبيق. */
export async function setStoreStrings(values: Record<string, string>) {
  for (const [key, v] of Object.entries(values)) {
    await mutateStore(key, () => ({ t: 's', v }))
  }
}
