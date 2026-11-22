import { supabase } from './supabase'
import type { Person } from './data'

/*
  الإضافة والتعديل في «الأفراد والجهات» بطريقة التطبيق
  (people_management_screen.dart ← _openContactFormSheet و_PersonItem.toMap):

  - السجلات قائمة JSON في fundly_user_store بالمفتاح
    people_management_records_v1، بصيغة التطبيق {"t":"s","v":"[...]"}.
  - الموقع يقرأ أحدث قيمة في الخادم، ويطبّق تغييره على السجل المعني فقط،
    ويكتب بشرط ألا تكون القيمة تغيّرت منذ قراءتها (updated_at). إن تغيّرت
    يعيد القراءة والتطبيق. والتطبيق يدمج ما تغيّر في السحابة سجلًا سجلًا
    (FundlyAccount._mergeItems)، وهوية السجل اسمه الكامل.
  - التعديل يطبّق الحقول التي غيّرها المستخدم فقط فوق أحدث نسخة من السجل.

  من التطبيق فقط: الوثائق ومرفقاتها وتذكيراتها، والمستحقات والدفعات،
  والتفويض، و«مستأجر» و«مؤجر» (يُنشآن من عقود العقارات).
*/

const KEY = 'people_management_records_v1'
const PENDING_NOTE = 'بانتظار استكمال البيانات'
const ARCHIVED_MARK = '[مؤرشف]'
const REMINDER_NONE = 'بلا تذكير'
export const IDENTITY_DOCS = ['الهوية', 'جواز السفر', 'الضمان الصحي']
/** _kReminderOptions */
export const DOC_REMINDERS = ['بلا تذكير', 'قبل يوم', 'قبل 3 أيام', 'قبل أسبوع', 'قبل أسبوعين', 'قبل شهر', 'مخصص']
const REMINDERS_KEY = 'app_expiry_reminders_v1'

/** وثيقة: رقم (للأفراد) أو اسم (للجهات)، وانتهاء وتذكير ومرفق (اسم الملف). */
export type DocForm = { name: string; number: string; expiry: string; reminder: string; file: string }

// _allTypeFilters (بلا «الكل» وبلا المستأجر والمؤجر: _autoOnlyTypeKeys).
export const PERSON_TYPES: { key: string; label: string; color: string }[] = [
  { key: 'person_relative', label: 'قريب', color: '0A5A50' },
  { key: 'person_friend', label: 'صديق', color: '34A894' },
  { key: 'person_employee', label: 'موظف', color: 'F2A93F' },
  { key: 'person_client', label: 'عميل', color: '0A5A50' },
  { key: 'person_supplier', label: 'مورد', color: 'CE8422' },
  { key: 'person_contractor', label: 'مقاول', color: '0E7161' },
  { key: 'person_partner', label: 'شريك', color: '34A894' },
  { key: 'person_representative', label: 'مندوب', color: '0E7161' },
  { key: 'person_consultant', label: 'استشاري', color: '0A5A50' },
  { key: 'person_other', label: 'أخرى', color: '5C6B68' },
  { key: 'entity_company', label: 'الشركات', color: '0A5A50' },
  { key: 'entity_government', label: 'جهات حكومية', color: '0A5A50' },
  { key: 'entity_bank', label: 'بنك', color: '34A894' },
  { key: 'entity_education', label: 'مؤسسات تعليمية', color: 'F2A93F' },
  { key: 'entity_health', label: 'مؤسسات صحية', color: 'D95A4E' },
  { key: 'entity_organization', label: 'منظمات', color: '0E7161' },
  { key: 'entity_other', label: 'جهات أخرى', color: '5C6B68' },
]

/** يُنشآن تلقائيًا من العقود ولا يُختاران عند الإضافة، ويبقيان لمن هو منهما. */
const AUTO_TYPES = [
  { key: 'person_tenant', label: 'مستأجر', color: 'D95A4E' },
  { key: 'person_landlord', label: 'مؤجر', color: '178F7B' },
]
const typeOf = (key: string) => [...PERSON_TYPES, ...AUTO_TYPES].find((t) => t.key === key)

export const isEntityKey = (key: string) => key.startsWith('entity_')
export const typesFor = (entity: boolean, currentKey = '') => {
  const list = PERSON_TYPES.filter((t) => isEntityKey(t.key) === entity)
  const auto = AUTO_TYPES.find((t) => t.key === currentKey)
  return auto ? [auto, ...list] : list
}

/** Color.value في Flutter: ARGB رقمًا. */
const colorValue = (hex: string) => parseInt(`FF${hex}`, 16)

const today = () => {
  const n = new Date()
  return `${n.getDate()}/${n.getMonth() + 1}/${n.getFullYear()}`
}

export type PersonForm = {
  typeKey: string
  additional: string[]
  name: string
  phone: string
  email: string
  birthday: string
  nationality: string
  address: string
  location: string
  extra: string
  notes: string
  /** وثائق الفرد الرسمية بالترتيب، أو وثائق الجهة بأسمائها. */
  docs: DocForm[]
  otherFiles: string[]
}

/** قيم النموذج من سجل (التعديل) أو فارغة (الإضافة). */
export function formOf(p?: Person, entity = false): PersonForm {
  const d = (p?.details ?? {}) as Record<string, string>
  const v = (k: string) => String(d[k] ?? '').trim()
  const isEntity = p ? isEntityKey(String(p.typeKey ?? '')) : entity
  return {
    typeKey: p ? String(p.typeKey ?? '') : '',
    additional: p ? [...(p.additionalCategoryNames ?? [])] : [],
    name: p?.fullName ?? '',
    phone: v('رقم الهاتف'),
    email: v('البريد الإلكتروني'),
    birthday: v(isEntity ? 'تاريخ التأسيس' : 'تاريخ الميلاد'),
    nationality: v('الجنسية'),
    address: v('العنوان'),
    location: v('الموقع على الخريطة'),
    extra: v('معلومات إضافية'),
    notes: p ? (p.extraNote === PENDING_NOTE ? '' : String(p.extraNote ?? '')) : '',
    docs: isEntity
      ? Object.keys(d)
          .filter((k) => k.startsWith('انتهاء '))
          .map((k) => k.slice('انتهاء '.length))
          .map((name) => ({ name, number: '', expiry: v(`انتهاء ${name}`), reminder: v(`تذكير ${name}`) || REMINDER_NONE, file: v(`مرفق ${name}`) }))
      : IDENTITY_DOCS.map((name) => ({ name, number: v(`رقم ${name}`), expiry: v(`انتهاء ${name}`), reminder: v(`تذكير ${name}`) || REMINDER_NONE, file: v(`مرفق ${name}`) })),
    otherFiles: v('مرفقات أخرى').split('|').filter((x) => x.trim()),
  }
}

/** اسم الملف من مساره (DocumentStore.fileName). */
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/** المستندات المسجّلة في قائمة السجل (createdDocuments). */
function documentsOf(f: PersonForm, entity: boolean): string[] {
  const out: string[] = []
  if (!entity) for (const d of f.docs) if (d.number.trim() || d.file) out.push(d.name)
  if (entity) for (const d of f.docs.filter((x) => x.name.trim())) out.push(d.expiry.trim() ? `${d.name.trim()} · ينتهي ${d.expiry.trim()}` : d.name.trim())
  for (const path of f.otherFiles) out.push(baseName(path))
  return out
}

/** مفاتيح الوثائق في التفاصيل. */
function docDetails(f: PersonForm, entity: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  if (!entity)
    for (const d of f.docs) {
      out[`رقم ${d.name}`] = d.number.trim()
      out[`انتهاء ${d.name}`] = d.expiry.trim()
      out[`تذكير ${d.name}`] = d.reminder || REMINDER_NONE
      out[`مرفق ${d.name}`] = d.file
    }
  else
    for (const d of f.docs.filter((x) => x.name.trim())) {
      out[`انتهاء ${d.name.trim()}`] = d.expiry.trim()
      out[`تذكير ${d.name.trim()}`] = d.reminder || REMINDER_NONE
      out[`مرفق ${d.name.trim()}`] = d.file
    }
  out['مرفقات أخرى'] = f.otherFiles.join('|')
  return out
}

/** reminderDaysFromLabel */
const reminderDays = (label: string) => ({ 'قبل يوم': 1, 'قبل 3 أيام': 3, 'قبل أسبوع': 7, 'قبل أسبوعين': 14, 'قبل شهر': 30 })[label] ?? 0

/** _registerExpiryReminder: تذكير لكل وثيقة جديدة أو تغيّر تاريخها أو تذكيرها. */
async function registerReminders(f: PersonForm, shown: PersonForm | null, personName: string) {
  const items: Record<string, unknown>[] = []
  const before = new Map((shown?.docs ?? []).map((d) => [d.name.trim(), d]))
  for (const d of f.docs) {
    const name = d.name.trim()
    if (!name) continue
    const old = before.get(name)
    if (shown && old && old.expiry.trim() === d.expiry.trim() && (old.reminder || REMINDER_NONE) === (d.reminder || REMINDER_NONE)) continue
    const p = d.expiry.trim().split('/')
    if (p.length !== 3) continue
    const [day, month, year] = p.map((x) => parseInt(x, 10))
    if ([day, month, year].some(Number.isNaN)) continue
    const days = reminderDays(d.reminder)
    if (days <= 0) continue
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000`
    const title = `${name} — ${personName}`
    items.push({ id: `person_doc_${Date.now() * 1000 + items.length}_${title}`, title, module: 'الأفراد والجهات', expiryDate: iso, remindBeforeDays: days })
  }
  if (!items.length) return
  const uid = await userId()
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('fundly_user_store').select('value, updated_at').eq('user_id', uid).eq('key', REMINDERS_KEY).maybeSingle()
    if (error) throw error
    const row = data as Row | null
    let list: string[] = []
    if (row) {
      try {
        const wrapper = JSON.parse(row.value)
        if (wrapper?.t !== 'l' || !Array.isArray(wrapper.v)) throw new Error()
        list = wrapper.v.map(String)
      } catch {
        return // شكل غير متوقع: لا يُكتب فوقه (التذكير من التطبيق).
      }
    }
    const value = JSON.stringify({ t: 'l', v: [...list, ...items.map((x) => JSON.stringify(x))] })
    const now = new Date().toISOString()
    if (row) {
      const { data: saved, error: saveError } = await supabase.from('fundly_user_store').update({ value, updated_at: now }).eq('user_id', uid).eq('key', REMINDERS_KEY).eq('updated_at', row.updated_at).select('key')
      if (saveError) throw saveError
      if (saved && saved.length) return
    } else {
      const { error: insertError } = await supabase.from('fundly_user_store').insert({ user_id: uid, key: REMINDERS_KEY, value, updated_at: now })
      if (!insertError) return
      if (String((insertError as { code?: string }).code) !== '23505') throw insertError
    }
  }
}

export const isArchived = (p: Person) => String(p.extraNote ?? '').includes(ARCHIVED_MARK)
export const isFrozen = (p: Person) => (p as Person & { isFrozen?: boolean }).isFrozen === true

export function validatePerson(f: PersonForm, creating: boolean): string | null {
  const entity = isEntityKey(f.typeKey)
  const missing = [
    !f.typeKey ? (entity ? 'نوع الجهة' : 'النوع') : '',
    !f.name.trim() ? (entity ? 'اسم الجهة' : 'الاسم') : '',
    creating && !f.phone.trim() ? 'رقم الهاتف' : '',
    creating && !f.birthday.trim() ? (entity ? 'تاريخ التأسيس' : 'تاريخ الميلاد') : '',
  ].filter(Boolean)
  if (missing.length) return `أكمل:| |${missing.join('|، |')}`
  if (entity) {
    const names = f.docs.map((d) => d.name.trim()).filter(Boolean)
    if (f.docs.some((d) => !d.name.trim() && (d.expiry || d.file))) return 'اكتب اسم الوثيقة'
    if (new Set(names).size !== names.length) return 'اسم الوثيقة مكرر'
  }
  return null
}

type Row = { value: string; updated_at: string }
type Item = Record<string, unknown>

class Conflict extends Error {}
export class PeopleError extends Error {}

async function userId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new PeopleError('انتهت الجلسة — ادخل من جديد')
  return data.user.id
}

/** قراءة أحدث قائمة، وتطبيق [change] عليها، والكتابة بشرط عدم تغيّرها. */
async function mutate(change: (list: Item[]) => Item[]): Promise<void> {
  const uid = await userId()
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.from('fundly_user_store').select('value, updated_at').eq('user_id', uid).eq('key', KEY).maybeSingle()
    if (error) throw error
    const row = data as Row | null
    let list: Item[] = []
    if (row) {
      let raw: unknown
      try {
        const wrapper = JSON.parse(row.value)
        raw = wrapper?.t === 's' ? JSON.parse(String(wrapper.v)) : undefined
      } catch {
        raw = undefined
      }
      // شكل غير متوقع: لا يُكتب فوقه أبدًا (كما يفعل التطبيق).
      if (!Array.isArray(raw)) throw new PeopleError('تعذّرت قراءة السجلات المحفوظة — عدّلها من التطبيق')
      list = raw.filter((x) => x && typeof x === 'object') as Item[]
    }
    const next = change(list.map((x) => ({ ...x })))
    const value = JSON.stringify({ t: 's', v: JSON.stringify(next) })
    const now = new Date().toISOString()
    try {
      if (row) {
        const { data: saved, error: saveError } = await supabase
          .from('fundly_user_store')
          .update({ value, updated_at: now })
          .eq('user_id', uid)
          .eq('key', KEY)
          .eq('updated_at', row.updated_at)
          .select('key')
        if (saveError) throw saveError
        if (!saved || saved.length === 0) throw new Conflict()
      } else {
        const { error: insertError } = await supabase.from('fundly_user_store').insert({ user_id: uid, key: KEY, value, updated_at: now })
        if (insertError) {
          if (String((insertError as { code?: string }).code) === '23505') throw new Conflict()
          throw insertError
        }
      }
      return
    } catch (e) {
      if (e instanceof Conflict) continue
      throw e
    }
  }
  throw new PeopleError('تغيّرت البيانات أثناء الحفظ — أعد المحاولة')
}

const nameOf = (x: Item) => String(x.fullName ?? '').trim()

export async function createPerson(f: PersonForm): Promise<void> {
  const entity = isEntityKey(f.typeKey)
  const type = PERSON_TYPES.find((t) => t.key === f.typeKey)
  if (!type) throw new PeopleError(entity ? 'اختر نوع الجهة' : 'اختر النوع')
  const name = f.name.trim()
  await mutate((list) => {
    if (list.some((x) => nameOf(x) === name)) throw new PeopleError('يوجد فرد أو جهة بهذا الاسم')
    const details: Record<string, string> = {
      'رقم الهاتف': f.phone.trim(),
      'البريد الإلكتروني': f.email.trim(),
      [entity ? 'تاريخ التأسيس' : 'تاريخ الميلاد']: f.birthday.trim(),
      الجنسية: entity ? '' : f.nationality.trim(),
      العنوان: f.address.trim(),
      'الموقع على الخريطة': f.location.trim(),
      'معلومات إضافية': f.extra.trim(),
    }
    Object.assign(details, docDetails(f, entity))
    const stamp = today()
    const person: Item = {
      fullName: name,
      nickName: entity ? 'جهة جديدة' : 'جديد',
      roleTitle: type.label,
      badge: 'جديد',
      badgeColor: colorValue(type.color),
      statusNote: entity ? 'تم إنشاء ملف الجهة' : 'تم إنشاء ملف الشخص',
      extraNote: f.notes.trim() || PENDING_NOTE,
      typeKey: type.key,
      categoryName: type.label,
      additionalCategoryNames: f.additional.filter((a) => a !== type.label),
      activityLog: [],
      dueToYou: 0,
      dueOnYou: 0,
      openTasks: 0,
      documentsCount: documentsOf(f, entity).length,
      lastUpdate: stamp,
      createdAt: stamp,
      sharedCommitments: [],
      documents: documentsOf(f, entity),
      details,
      isPinned: false,
      isFrozen: false,
    }
    return [person, ...list]
  })
  await registerReminders(f, null, name).catch(() => {})
}

/** يطبّق ما غيّره المستخدم فقط (مقارنة بما عُرض عليه) فوق أحدث نسخة. */
export async function updatePerson(original: Person, shown: PersonForm, f: PersonForm): Promise<void> {
  const entity = isEntityKey(String(original.typeKey ?? ''))
  const type = typeOf(f.typeKey)
  if (!type || isEntityKey(type.key) !== entity) throw new PeopleError(entity ? 'اختر نوع الجهة' : 'اختر النوع')
  const oldName = original.fullName.trim()
  const name = f.name.trim()
  await mutate((list) => {
    const index = list.findIndex((x) => nameOf(x) === oldName)
    if (index < 0) throw new PeopleError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
    if (name !== oldName && list.some((x, i) => i !== index && nameOf(x) === name)) throw new PeopleError('يوجد فرد أو جهة بهذا الاسم')
    const current = { ...list[index] }
    if (current.isFrozen === true) throw new PeopleError('لا يمكن التعديل لأن السجل مجمّد. ألغِ التجميد أولاً.')
    const details = { ...((current.details as Record<string, string>) ?? {}) }
    const changed = (k: keyof PersonForm) => JSON.stringify(f[k]) !== JSON.stringify(shown[k])
    const setDetail = (k: keyof PersonForm, label: string) => {
      if (changed(k)) details[label] = String(f[k]).trim()
    }
    setDetail('phone', 'رقم الهاتف')
    setDetail('email', 'البريد الإلكتروني')
    setDetail('birthday', entity ? 'تاريخ التأسيس' : 'تاريخ الميلاد')
    if (!entity) setDetail('nationality', 'الجنسية')
    setDetail('address', 'العنوان')
    setDetail('location', 'الموقع على الخريطة')
    setDetail('extra', 'معلومات إضافية')
    if (changed('name')) current.fullName = name
    if (changed('typeKey')) {
      current.typeKey = type.key
      current.roleTitle = type.label
      current.categoryName = type.label
    }
    if (changed('additional') || changed('typeKey')) current.additionalCategoryNames = f.additional.filter((a) => a !== type.label)
    // مسح الملاحظة في التعديل يمسحها فعلًا.
    if (changed('notes')) current.extraNote = f.notes.trim()
    // الوثائق: تُكتب إن تغيّرت (وثائق الجهة تُكتب من جديد لأن اسمها قد يتغيّر).
    if (changed('docs') || changed('otherFiles')) {
      if (entity) for (const k of Object.keys(details)) if (k.startsWith('انتهاء ') || k.startsWith('تذكير ') || k.startsWith('مرفق ')) delete details[k]
      Object.assign(details, docDetails(f, entity))
      const old = Array.isArray(current.documents) ? (current.documents as unknown[]).map(String) : []
      const documents = [...old, ...documentsOf(f, entity).filter((x) => !old.includes(x))]
      current.documents = documents
      current.documentsCount = documents.length
    }
    current.details = details
    current.lastUpdate = today()
    const next = [...list]
    next[index] = current
    return next
  })
  if (JSON.stringify(f.docs) !== JSON.stringify(shown.docs)) await registerReminders(f, shown, name).catch(() => {})
}

/** الأرشفة والإخراج منها (_archivePerson): علامة في الملاحظة مع التجميد.
    [archive] صريح حتى لا يعكس الموقع ما فعله التطبيق في الوقت نفسه. */
export async function setPersonArchived(person: Person, archive: boolean): Promise<void> {
  const name = person.fullName.trim()
  await mutate((list) => {
    const index = list.findIndex((x) => nameOf(x) === name)
    if (index < 0) throw new PeopleError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
    const current = { ...list[index] }
    const note = String(current.extraNote ?? '')
    const archived = note.includes(ARCHIVED_MARK)
    if (archived === archive) return list
    current.extraNote = archived ? note.split(ARCHIVED_MARK).join('').trim() : `${ARCHIVED_MARK} ${note}`.trim()
    current.isFrozen = !archived
    current.lastUpdate = today()
    const next = [...list]
    next[index] = current
    return next
  })
}

/** الحذف (_deletePerson): يُحذف من القائمة كما في التطبيق. */
export async function deletePerson(person: Person): Promise<void> {
  const name = person.fullName.trim()
  await mutate((list) => {
    const index = list.findIndex((x) => nameOf(x) === name)
    if (index < 0) throw new PeopleError('السجل غير موجود — ربما عُدّل أو حُذف من التطبيق')
    return list.filter((_, i) => i !== index)
  })
}

/** PeopleDirectoryStore.upsert: يُضاف بالاسم إن لم يوجد، وإلا تُدمج تفاصيله ويُضاف التصنيف إضافيًا. */
export async function upsertDirectoryPerson(o: { fullName: string; typeKey: string; categoryName: string; details?: Record<string, string>; roleTitle?: string; sourceNote?: string }) {
  const name = o.fullName.trim()
  if (!name) return
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()
  const d = new Date()
  const today = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  const clean = Object.fromEntries(Object.entries(o.details ?? {}).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]))
  const note = (o.sourceNote ?? '').trim()
  await mutate((list) => {
    const i = list.findIndex((x) => norm(String(x.fullName ?? '')) === norm(name))
    if (i === -1) {
      list.push({
        fullName: name,
        nickName: '',
        roleTitle: o.roleTitle ?? '',
        badge: o.categoryName,
        badgeColor: 0xff0a5a50,
        statusNote: '',
        extraNote: o.sourceNote ?? '',
        typeKey: o.typeKey,
        categoryName: o.categoryName,
        additionalCategoryNames: [],
        activityLog: note ? [`${today} · ${note}`] : [],
        dueToYou: 0,
        dueOnYou: 0,
        openTasks: 0,
        documentsCount: 0,
        lastUpdate: today,
        createdAt: today,
        sharedCommitments: [],
        documents: [],
        details: clean,
        isPinned: false,
        isFrozen: false,
      } as Item)
      return list
    }
    const row = list[i] as Record<string, unknown>
    const merged: Record<string, string> = {}
    if (row.details && typeof row.details === 'object') for (const [k, v] of Object.entries(row.details as Record<string, unknown>)) merged[k] = String(v ?? '')
    Object.assign(merged, clean)
    row.details = merged
    row.lastUpdate = today
    if (String(row.categoryName ?? '') !== o.categoryName) {
      const extras = Array.isArray(row.additionalCategoryNames) ? (row.additionalCategoryNames as unknown[]).map(String) : []
      if (!extras.includes(o.categoryName)) extras.push(o.categoryName)
      row.additionalCategoryNames = extras
    }
    if (note) {
      const log = Array.isArray(row.activityLog) ? (row.activityLog as unknown[]).map(String) : []
      log.push(`${today} · ${note}`)
      row.activityLog = log
    }
    list[i] = row as Item
    return list
  })
}
