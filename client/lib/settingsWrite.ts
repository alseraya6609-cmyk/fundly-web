import { supabase, errorText } from './supabase'
import { FILES_BUCKET, type Store } from './data'
import { mutateStore, type Wrapped } from './storeWrite'
import { composeName, isValidNameParts } from './account'
import { publicName } from './requestsWrite'

/*
  إعدادات الحساب من الموقع، بنفس مفاتيح التطبيق في fundly_user_store فتنزل
  إليه بالمزامنة (AppSettings / HomeLayoutStore / PageCustomizationStore /
  UserSignatureStore / UserStampStore / UserLogoStore):
  - البيانات الشخصية (ProfileDataSettingsPage._save + FundlyAccount.pushProfile).
  - العملة والتقويم، ووقت التذكير الافتراضي.
  - ترتيب الرئيسية وإخفاء أقسامها، وإخفاء الفئات والعناصر في كل صفحة.
  - التوقيع والختم والشعار.
  - تغيير كلمة المرور، وحذف الحساب نهائيًا (FundlyAccount.deleteAccount).
*/

export class SettingsError extends Error {}

const s = (v: string): Wrapped => ({ t: 's', v })

/** يكتب المفاتيح التي تغيّرت قيمتها فقط. */
export async function writeStore(store: Store | undefined, values: Record<string, Wrapped>) {
  for (const [key, next] of Object.entries(values)) {
    const current = store?.[key]
    if (JSON.stringify(current) === JSON.stringify(next.v)) continue
    // مفتاح غير موجود وقيمته الجديدة فارغة: لا تغيير.
    if ((current === undefined || current === null) && next.v === '') continue
    await mutateStore(key, () => next)
  }
}

// ---------------- البيانات الشخصية ----------------

/** AppSettings.sharedNameModes بترتيبها في التطبيق. */
export const SHARED_NAME_MODES = ['الاسم الأول', 'الاسم الثلاثي', 'الاسم الأول والقبيلة', 'اسم مستعار'] as const
export const SHARED_NAME_NICK = 'اسم مستعار'

/** AppSettings.publicNameFor */
export function publicNameFor(mode: string, given: string, family: string, nickname: string): string {
  const full = composeName(given, family)
  const parts = (given.trim() || full).split(/\s+/).filter(Boolean)
  const first = parts.length ? parts[0] : full
  if (mode === 'الاسم الأول') return first
  if (mode === 'الاسم الأول والقبيلة') return [first, family.trim()].filter(Boolean).join(' ')
  if (mode === SHARED_NAME_NICK && nickname.trim()) return nickname.trim()
  return full
}

/** _parseBirthday: «17/9/1984» بالأرقام العربية أو اللاتينية، وتاريخ صحيح ليس في المستقبل. */
export function parseBirthday(raw: string): { d: number; m: number; y: number } | null {
  const text = raw.trim().replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
  const parts = text.split(/[/\-.\s]+/).filter(Boolean)
  if (parts.length !== 3) return null
  const [d, m, y] = parts.map((p) => parseInt(p, 10))
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y) || y < 1900) return null
  const date = new Date(y, m - 1, d)
  if (date.getDate() !== d || date.getMonth() !== m - 1) return null
  if (date.getTime() > Date.now()) return null
  return { d, m, y }
}

export type ProfileInput = {
  given: string
  family: string
  mode: string
  nickname: string
  email: string
  birthday: string
  phone: string
  city: string
  social: string
  /** base64 بلا بادئة، أو '' لحذف الصورة. */
  photo: string
}

/** يعيد رسالة الخطأ كما في التطبيق، أو null إن كانت البيانات صالحة. */
export function profileProblem(p: ProfileInput): string | null {
  if (!p.given.trim()) return 'أدخل الاسم أولًا'
  if (!isValidNameParts(p.given)) return 'اكتب اسمك'
  if (p.mode === SHARED_NAME_NICK && p.nickname.trim().length < 2) return 'اكتب الاسم المستعار'
  const missing = [!p.birthday.trim() && 'تاريخ الميلاد', !p.phone.trim() && 'رقم الهاتف', !p.city.trim() && 'المدينة'].filter(Boolean) as string[]
  if (missing.length) return `أكمل الحقول الإلزامية: ${missing.join('، ')}`
  const email = p.email.trim()
  if (email && !email.includes('@')) return 'صيغة البريد الإلكتروني غير صحيحة'
  if (p.birthday.trim() && !parseBirthday(p.birthday)) return 'تاريخ الميلاد غير صحيح — اكتبه يوم/شهر/سنة مثل 17/9/1984'
  return null
}

export async function saveProfile(store: Store | undefined, p: ProfileInput) {
  const problem = profileProblem(p)
  if (problem) throw new SettingsError(problem)
  const full = composeName(p.given, p.family)
  const b = parseBirthday(p.birthday)
  const mode = (SHARED_NAME_MODES as readonly string[]).includes(p.mode) ? p.mode : 'الاسم الثلاثي'
  await writeStore(store, {
    settings_profile_given_name: s(p.given.trim()),
    settings_profile_family_name: s(p.family.trim()),
    settings_shared_name_mode: s(mode),
    settings_shared_nickname: s(p.nickname.trim()),
    settings_profile_name: s(full.trim()),
    settings_profile_phone: s(p.phone.trim()),
    settings_profile_email: s(p.email.trim()),
    settings_profile_city: s(p.city.trim()),
    settings_profile_social: s(p.social.trim()),
    settings_profile_photo: s(p.photo),
    settings_profile_birthday: s(b ? `${b.d}/${b.m}/${b.y}` : ''),
  })
  // الاسم الظاهر للآخرين في الطلبات، والهاتف يُدخل به (pushProfile).
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return
  const shown = publicNameFor(mode, p.given, p.family, p.nickname).trim() || full.trim()
  await supabase.from('profiles').update({ display_name: shown, phone: p.phone.trim() }).eq('id', auth.user.id)
}

/** القيم الحالية لنموذج البيانات الشخصية (مع الأسماء القديمة بلا أجزاء). */
export function profileFrom(store: Store | undefined, fallbackName = ''): ProfileInput {
  const v = (k: string) => (typeof store?.[k] === 'string' ? (store[k] as string) : '')
  const full = v('settings_profile_name') || fallbackName
  const given = v('settings_profile_given_name')
  const mode = v('settings_shared_name_mode') === 'الاسم الأول فقط' ? 'الاسم الأول' : v('settings_shared_name_mode')
  return {
    given: given || full,
    family: given ? v('settings_profile_family_name') : '',
    mode: (SHARED_NAME_MODES as readonly string[]).includes(mode) ? mode : 'الاسم الثلاثي',
    nickname: v('settings_shared_nickname'),
    email: v('settings_profile_email'),
    birthday: v('settings_profile_birthday'),
    phone: v('settings_profile_phone'),
    city: v('settings_profile_city'),
    social: v('settings_profile_social'),
    photo: v('settings_profile_photo'),
  }
}

export { publicName }

// ---------------- اللغة والعملة والتقويم والتنبيهات ----------------

/** AppSettings.currencies: التسمية الكاملة ← اللاحقة. */
export const CURRENCIES: [string, string][] = [
  ['جنيه سوداني (SDG)', 'جنيه سوداني'],
  ['جنيه مصري (EGP)', 'جنيه مصري'],
  ['درهم إماراتي (AED)', 'درهم'],
  ['دولار أمريكي (USD)', 'دولار'],
  ['دينار أردني (JOD)', 'دينار أردني'],
  ['دينار بحريني (BHD)', 'دينار بحريني'],
  ['دينار كويتي (KWD)', 'دينار'],
  ['روبية باكستانية (PKR)', 'روبية باكستانية'],
  ['روبية هندية (INR)', 'روبية هندية'],
  ['ريال سعودي (SAR)', 'ريال'],
  ['ريال عماني (OMR)', 'ريال عماني'],
  ['ريال قطري (QAR)', 'ريال قطري'],
  ['ليرة سورية (SYP)', 'ليرة سورية'],
  ['ليرة لبنانية (LBP)', 'ليرة لبنانية'],
  ['يوان صيني (CNY)', 'يوان صيني'],
  ['يورو (EUR)', 'يورو'],
]
export const CALENDARS = ['ميلادي', 'هجري'] as const

/** AppSettings.leadTimeOptions */
export const LEAD_TIMES: [string, number][] = [
  ['في نفس اليوم', 0],
  ['قبل يوم', 1],
  ['قبل 3 أيام', 3],
  ['قبل أسبوع', 7],
  ['قبل شهر', 30],
]

export const setCurrency = (label: string) => mutateStore('settings_currency', () => s(label))
export const setCalendar = (value: string) => mutateStore('settings_calendar', () => s(value))
export const setLeadDays = (days: number) => mutateStore('settings_default_lead_time_days', () => ({ t: 'i', v: days }))
/** تنبيهات الانتهاء في هذا الموقع (في التطبيق إعداد لكل جوال). */
export const setExpiryNotices = (on: boolean) => mutateStore('settings_expiry_notifications', () => ({ t: 'b', v: on }))

// ---------------- تخصيص الصفحات ----------------

export const HOME_SECTIONS = ['people', 'shared', 'assets'] as const
export const HOME_TITLES: Record<string, string> = {
  people: 'الأفراد والجهات',
  shared: 'الالتزامات المشتركة',
  assets: 'العقارات والأنشطة والمركبات',
}

/** HomeLayoutStore._normalize */
export function normalizeOrder(order: unknown): string[] {
  const list = Array.isArray(order) ? order.map(String) : []
  const out: string[] = []
  for (const id of [...list, ...HOME_SECTIONS]) if ((HOME_SECTIONS as readonly string[]).includes(id) && !out.includes(id)) out.push(id)
  return out
}

export async function saveHomeLayout(order: string[], hidden: string[]) {
  const clean = normalizeOrder(order)
  await mutateStore('home_layout_order_v2', () => ({ t: 'l', v: clean }))
  await mutateStore('home_layout_hidden_v1', () => ({ t: 'l', v: hidden.filter((h) => (HOME_SECTIONS as readonly string[]).includes(h)) }))
}

export type PageCategory = { title: string; items: string[] }

/** PageCustomizationStore.catalog */
export const PAGE_CATALOG: Record<string, PageCategory[]> = {
  personal: [
    { title: 'مالية', items: [] },
    { title: 'مستند', items: [] },
    { title: 'المتابعة والتخطيط', items: [] },
    { title: 'أدوية وبيانات وكلمات سر', items: [] },
    { title: 'نمط الحياة', items: [] },
    { title: 'مواقع وأماكن', items: [] },
    { title: 'عهدة مالية', items: [] },
  ],
  shared: [
    { title: 'مشاركات مشتركة', items: [] },
    { title: 'الرحلة / السفر', items: [] },
    { title: 'جمعية مالية', items: [] },
  ],
  people: [
    { title: 'الأفراد', items: [] },
    { title: 'الجهات', items: [] },
  ],
  assets: [
    { title: 'العقارات', items: [] },
    { title: 'الأنشطة التجارية', items: [] },
    { title: 'المركبات ووسائل النقل', items: ['مركبات برية', 'مركبات بحرية'] },
  ],
}
export const PAGE_TITLES: Record<string, string> = {
  personal: 'الالتزامات الشخصية',
  shared: 'الالتزامات المشتركة',
  people: 'الأفراد / الجهات',
  assets: 'العقارات / الأنشطة التجارية / المركبات ووسائل النقل',
}
export const itemKey = (category: string, item: string) => `${category} › ${item}`

/** المفاتيح الصالحة فقط (PageCustomizationStore._validKey). */
export function validHidden(page: string, list: unknown): string[] {
  const all = Array.isArray(list) ? list.map(String) : []
  const ok = new Set<string>()
  for (const c of PAGE_CATALOG[page] ?? []) {
    ok.add(c.title)
    for (const i of c.items) ok.add(itemKey(c.title, i))
  }
  return all.filter((k) => ok.has(k))
}

/** يكتب القائمة كاملة كما يحفظها التطبيق، مع إبقاء المفاتيح القديمة غير المعروفة. */
export async function savePageHidden(page: string, change: (current: string[]) => string[]) {
  await mutateStore(`page_custom_hidden_v1_${page}`, (cur) => {
    const list = cur && Array.isArray(cur.v) ? (cur.v as unknown[]).map(String) : []
    return { t: 'l', v: change(list) }
  })
}

// ---------------- التوقيع والختم والشعار ----------------

/** عرض لوحة التوقيع في التطبيق تقريبًا: تُحفظ النقاط بهذا المقياس فتُعرض هناك كما رُسمت. */
export const PAD_WIDTH = 340
export const PAD_HEIGHT = 165

export type Point = [number, number]

export const saveSignature = (strokes: Point[][]) =>
  mutateStore('user_signature_strokes_v1', () => s(strokes.length ? JSON.stringify(strokes.map((st) => st.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]))) : ''))
export const saveStamp = (base64: string) => mutateStore('user_stamp_image_v1', () => s(base64))
export const saveLogo = (base64: string) => mutateStore('user_logo_image_v1', () => s(base64))

/**
 * صورة مصغّرة (حتى [maxWidth]) بصيغة base64 بلا بادئة — مثل ImagePicker
 * (maxWidth 900). الصور الشفافة (PNG) تبقى PNG حتى لا تفقد شفافيتها.
 */
export async function imageToBase64(file: File, maxWidth = 900, quality = 0.88): Promise<string> {
  if (!file.type.startsWith('image/')) throw new SettingsError('اختر صورة')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new SettingsError('تعذّر فتح الصورة'))
      el.src = url
    })
    const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new SettingsError('تعذّر فتح الصورة')
    const png = file.type === 'image/png' || file.type === 'image/webp'
    if (!png) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', quality)
    return data.slice(data.indexOf(',') + 1)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** نوع صورة base64 من أول بايتاتها — لعرضها. */
export const imageSrc = (base64: string) =>
  base64 ? `data:${base64.startsWith('iVBOR') ? 'image/png' : base64.startsWith('/9j/') ? 'image/jpeg' : 'image/png'};base64,${base64}` : ''

// ---------------- كلمة المرور وحذف الحساب ----------------

/** FundlyAccount.changePassword */
export async function changePassword(current: string, next: string) {
  const { data } = await supabase.auth.getUser()
  const email = data.user?.email
  if (!email) throw new SettingsError('سجّل الدخول أولًا')
  if (next.length < 6) throw new SettingsError('كلمة المرور قصيرة — 6 أحرف على الأقل')
  const check = await supabase.auth.signInWithPassword({ email, password: current })
  if (check.error) throw new SettingsError('كلمة المرور الحالية غير صحيحة')
  const { error } = await supabase.auth.updateUser({ password: next })
  if (error) throw new SettingsError(errorText(error))
}

/**
 * FundlyAccount.deleteAccount: فحص الإمكان أولًا، ثم ملفاته في المخزن، ثم
 * الحساب وكل سجلاته. الخروج بعدها على عاتق المستدعي.
 */
export async function deleteMyAccount() {
  const serverMessage = (error: { code?: string; message?: string }, other: string) => (error.code === 'P0001' && error.message ? error.message : other)
  const check = await supabase.rpc('fundly_delete_my_account', { p_check_only: true })
  if (check.error) throw new SettingsError(serverMessage(check.error, 'حذف الحساب غير متاح الآن — حاول لاحقًا أو راسل الدعم من «تواصل معنا»'))
  // ملفاته في المخزن (FundlyFiles.deleteAllMine): ما يفشل حذفه لا يوقف الحذف.
  try {
    const storage = supabase.storage.from(FILES_BUCKET)
    const names: string[] = []
    for (let offset = 0; names.length < 20000; ) {
      const { data, error } = await storage.list('', { limit: 100, offset })
      if (error || !data) break
      for (const o of data) if (o.id) names.push(o.name)
      if (data.length < 100) break
      offset += data.length
    }
    for (let i = 0; i < names.length; i += 100) await storage.remove(names.slice(i, i + 100)).catch(() => undefined)
  } catch {
    // يكمل بحذف الحساب.
  }
  const done = await supabase.rpc('fundly_delete_my_account', { p_check_only: false })
  if (done.error) throw new SettingsError(serverMessage(done.error, 'تعذّر حذف الحساب — حاول مرة أخرى، أو راسل الدعم من «تواصل معنا»'))
}

// ---------------- الأسئلة الشائعة ----------------

export type Faq = { question: string; answer: string }

export async function loadFaq(): Promise<Faq[]> {
  const { data, error } = await supabase.from('fundly_faq').select('question, answer, sort_order').eq('published', true).order('sort_order')
  if (error) throw error
  return ((data ?? []) as { question: string | null; answer: string | null }[]).map((r) => ({ question: r.question ?? '', answer: r.answer ?? '' }))
}
