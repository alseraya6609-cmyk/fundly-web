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
const IDENTITY_DOCS = ['الهوية', 'جواز السفر', 'الضمان الصحي']

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
  return missing.length ? `أكمل:| |${missing.join('|، |')}` : null
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
    if (!entity) {
      for (const doc of IDENTITY_DOCS) {
        details[`رقم ${doc}`] = ''
        details[`انتهاء ${doc}`] = ''
        details[`تذكير ${doc}`] = REMINDER_NONE
        details[`مرفق ${doc}`] = ''
      }
    }
    details['مرفقات أخرى'] = ''
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
      documentsCount: 0,
      lastUpdate: stamp,
      createdAt: stamp,
      sharedCommitments: [],
      documents: [],
      details,
      isPinned: false,
      isFrozen: false,
    }
    return [person, ...list]
  })
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
    current.details = details
    current.lastUpdate = today()
    const next = [...list]
    next[index] = current
    return next
  })
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
