import { createClient } from '@supabase/supabase-js'

/*
  نفس مشروع Supabase الذي يستعمله التطبيق ولوحة التحكم، وبالطريقة نفسها
  المتبعة في اللوحة: المفتاح العام (anon) مصمَّم ليكون ظاهرًا في العميل،
  والحماية الحقيقية من سياسات RLS في قاعدة البيانات. مفتاح service_role لا
  يوضع في هذا المشروع أبدًا.

  القيم أدناه احتياطية: ملف .env (أو متغيرات Netlify) يتقدّم عليها إن كانت
  قيمته سليمة.
*/
const FALLBACK_URL = 'https://pcppwpbaknxflzbqbrxj.supabase.co'
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjcHB3cGJha254Zmx6YnFicnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NDkwMDcsImV4cCI6MjEwMDAyNTAwN30.kyUladJf7EUZeVhtjJDfnEPbHPiqKx8ovyRSbBEL0Is'

function clean(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
}

function isJwtLike(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 3 && parts.every((part) => part.length > 10)
}

const envUrl = clean(import.meta.env.VITE_SUPABASE_URL)
const envKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY)

export const supabaseUrl = (/^https?:\/\/[^\s/]+/.test(envUrl) ? envUrl : FALLBACK_URL).replace(
  /\/+$/,
  '',
)
const anonKey = isJwtLike(envKey) ? envKey : FALLBACK_ANON_KEY

export const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // جلسة الموقع منفصلة عن جلسة لوحة التحكم إن فُتحا في المتصفح نفسه.
    storageKey: 'fundly-web-auth',
  },
})

/** رسالة عربية مفهومة من خطأ Supabase أو الشبكة. */
export function errorText(error: unknown): string {
  const message = String((error as { message?: string })?.message ?? error ?? '')
  const lower = message.toLowerCase()
  if (lower.includes('invalid login credentials')) return 'بيانات الدخول أو كلمة المرور غير صحيحة'
  if (lower.includes('email not confirmed')) return 'البريد غير مفعّل بعد — فعّله من التطبيق أولًا'
  if (lower.includes('failed to fetch') || lower.includes('network'))
    return 'تعذّر الاتصال بالخادم — تحقق من الإنترنت'
  if (lower.includes('too many')) return 'محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة'
  return message || 'حدث خطأ غير متوقع — حاول مرة أخرى'
}
