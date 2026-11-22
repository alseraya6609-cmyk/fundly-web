import { supabase } from './supabase'

/*
  تسجيل جلسة الموقع في لوحة التحكم (صفحة «التثبيت والأجهزة») بالدالة نفسها
  التي يستدعيها التطبيق (FundlyDevice.ping ← fundly_device_ping):
  - رقم ثابت لهذا المتصفح (24 خانة سداسية) يُحفظ في المتصفح نفسه.
  - المنصة «web» والإصدار «web <إصدار الموقع>»، فلا يختلط بإصدارات التطبيق.
  - لا يُعاد الإرسال قبل 30 دقيقة إلا إن تغيّر الحساب، كالتطبيق.
  - بلا لغة ولا دولة: التطبيق لا يرسلهما حتى تُذكرا في سياسة الخصوصية
    (AppSettings.extendedDiagnostics = false).
  أي خطأ يُتجاهل ولا يؤخر شيئًا.
*/

const ID_KEY = 'fundly-web-install-id'
const LAST_KEY = 'fundly-web-last-ping'
const USER_KEY = 'fundly-web-last-ping-user'
const GAP_MS = 30 * 60 * 1000

let busy = false

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // التخزين غير متاح (وضع خاص): يُرسل الرقم لهذه الجلسة فقط.
  }
}

function installId(): string {
  let id = read(ID_KEY)
  if (!/^[0-9a-f]{8,64}$/.test(id)) {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    write(ID_KEY, id)
  }
  return id
}

export async function pingDevice(userId: string, version: string): Promise<void> {
  if (busy || !userId) return
  busy = true
  try {
    const last = Date.parse(read(LAST_KEY))
    if (read(USER_KEY) === userId && Number.isFinite(last) && Date.now() - last < GAP_MS) return
    const { error } = await supabase.rpc('fundly_device_ping', {
      p_install_id: installId(),
      p_platform: 'web',
      p_app_version: `web ${version}`,
    })
    if (error) return
    write(LAST_KEY, new Date().toISOString())
    write(USER_KEY, userId)
  } catch {
    // بلا اتصال: يُعاد عند الرجوع للموقع.
  } finally {
    busy = false
  }
}
