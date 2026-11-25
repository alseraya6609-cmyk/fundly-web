import { useQuery } from '@tanstack/react-query'
import qrcode from 'qrcode-generator'
import { supabase } from './supabase'
import { useSession } from './session'
import { changeReminders, isoOf, reminderDays } from './reminders'
import { CURRENCIES } from './settingsWrite'
import { LEASE_CSS, arNum, dmy, esc, imageMime, printMoney, rateLabel, signatureSvg } from './leasePdf'
import { hijri } from './recordPrint'

/*
  «قوالب المستندات والإيصالات» (DocumentTemplatesScreen + buildTemplatePdf
  في التطبيق) على الويب: نفس الحقول والبنود والإلزامي، ونفس جدول
  document_records، ونفس تذكير الانتهاء (app_expiry_reminders_v1)، فما يُحفظ
  هنا يظهر في التطبيق والعكس.
*/

// ============================== تعريف النماذج ==============================

/** المربعات في الشاشة: «عقد» يفتح قائمة أنواع العقود. */
export const RECEIPT_TILES = ['سند قبض', 'إيصال أمانة', 'إيصال استلام وتسليم', 'فاتورة', 'تقرير ضريبي']
export const CONTRACT_TILES = ['عقد', 'إنذار']

/** أنواع العقود المحكمة — تُختار عند الضغط على «عقد». */
export const CONTRACT_TYPES = ['عقد إيجار عقار', 'عقد إيجار نشاط تجاري', 'عقد تأجير مركبة', 'عقد عام']

export const CONTRACT_HINTS: Record<string, string> = {
  'عقد إيجار عقار': 'عقار سكني أو تجاري: الأجرة والتأمين والصيانة',
  'عقد إيجار نشاط تجاري': 'محل لنشاط تجاري: الرخصة وفترة التجهيز',
  'عقد تأجير مركبة': 'تأجير مركبة: العداد والوقود والمخالفات',
  'عقد عام': 'اتفاق بين طرفين بموضوع وشروط تحددها',
}

export const CONTRACT_COLORS: Record<string, string> = {
  'عقد إيجار عقار': '#34A894',
  'عقد إيجار نشاط تجاري': '#CE8422',
  'عقد تأجير مركبة': '#0E7161',
  'عقد عام': '#46607A',
}

export const TEMPLATE_HINTS: Record<string, string> = {
  'إيصال أمانة': 'إقرار دين أو أمانة بين طرفين مع الشهود',
  'سند قبض': 'راتب شهري لموظف أو سند عام، بتوقيع المستلم',
  'إيصال استلام وتسليم': 'إثبات تسليم عنصر وحالته',
  فاتورة: 'البيان والمبلغ والرقم الضريبي',
  'تقرير ضريبي': 'الإيرادات والضريبة لفترة محددة',
  عقد: 'عقار، نشاط تجاري، مركبة، أو عقد عام',
  إنذار: 'إنذار رسمي بمهلة وإجراء مطلوب',
}

export const TEMPLATE_COLORS: Record<string, string> = {
  'إيصال أمانة': '#0E7161',
  'سند قبض': '#0A5A50',
  'إيصال استلام وتسليم': '#178F7B',
  فاتورة: '#A6691A',
  'تقرير ضريبي': '#5C6B68',
  عقد: '#0A5A50',
  إنذار: '#C4392E',
}

/** الحقول بترتيبها — ما يبدأ بـ «#» عنوان قسم لا حقل. */
export const TEMPLATE_FIELDS: Record<string, string[]> = {
  'إيصال أمانة': [
    '#بيانات المدين (المستلم)', 'اسم المدين', 'رقم هوية المدين', 'رقم جواز المدين', 'هاتف المدين', 'عنوان المدين',
    '#بيانات الدائن (صاحب المبلغ)', 'اسم الدائن', 'رقم هوية الدائن', 'رقم جواز الدائن', 'هاتف الدائن',
    '#المبلغ', 'نوع المبلغ', 'المبلغ', 'المبلغ كتابةً', 'سبب الدين', 'تاريخ الاستلام',
    '#السداد', 'تاريخ السداد', 'طريقة السداد', 'عدد الأقساط', 'قيمة القسط',
    '#الشهود', 'الشاهد الأول', 'الشاهد الثاني',
  ],
  'عقد إيجار عقار': [
    '#بيانات العقد', 'رقم العقد', 'رقم العقد المنتهي', 'نمط مدة الإيجار', 'تاريخ تحرير العقد', 'مكان تحرير العقد',
    '#الطرف الأول (المؤجر)', 'اسم المؤجر', 'رقم هوية المؤجر', 'رقم جواز المؤجر', 'جنسية المؤجر', 'تاريخ انتهاء هوية المؤجر', 'هاتف المؤجر', 'بريد المؤجر', 'عنوان المؤجر',
    '#الطرف الثاني (المستأجر)', 'اسم المستأجر', 'رقم هوية المستأجر', 'رقم جواز المستأجر', 'جنسية المستأجر', 'تاريخ انتهاء هوية المستأجر', 'هاتف المستأجر', 'بريد المستأجر', 'عنوان المستأجر',
    '#ممثل المستأجر (إن وُجد)', 'اسم ممثل المستأجر', 'صفة الممثل', 'رقم هوية الممثل', 'رقم جواز الممثل', 'رقم الوكالة', 'تاريخ انتهاء الوكالة',
    '#بيانات العقار', 'اسم العقار', 'نوع العقار', 'المدينة', 'الحي', 'عنوان العقار', 'رقم الوحدة', 'رقم صك الملكية', 'مساحة العين (م٢)', 'مكونات العين', 'الغرض من الإيجار',
    '#المدة والقيمة', 'تاريخ بداية العقد', 'تاريخ نهاية العقد', 'قيمة الإيجار السنوي', 'نسبة الضريبة %', 'طريقة الدفع', 'الدفعات',
    '#التأمين والرسوم', 'مبلغ التأمين', 'طريقة تحصيل التأمين', 'الرسوم الإدارية',
    '#الالتزامات', 'فواتير الخدمات على', 'الصيانة البسيطة على', 'الصيانة الأساسية على', 'شروط إضافية',
  ],
  'عقد إيجار نشاط تجاري': [
    '#بيانات العقد', 'رقم العقد', 'نمط مدة الإيجار', 'تاريخ تحرير العقد', 'مكان تحرير العقد',
    '#الطرف الأول (المؤجر)', 'اسم المؤجر', 'رقم هوية المؤجر', 'رقم جواز المؤجر', 'جنسية المؤجر', 'تاريخ انتهاء هوية المؤجر', 'هاتف المؤجر', 'بريد المؤجر', 'عنوان المؤجر',
    '#الطرف الثاني (المستأجر)', 'اسم المستأجر', 'رقم هوية المستأجر', 'رقم جواز المستأجر', 'جنسية المستأجر', 'هاتف المستأجر', 'بريد المستأجر',
    '#ممثل المستأجر (إن وُجد)', 'اسم ممثل المستأجر', 'صفة الممثل', 'رقم هوية الممثل', 'رقم جواز الممثل', 'رقم الوكالة', 'تاريخ انتهاء الوكالة',
    '#الرخصة والنشاط', 'الاسم التجاري', 'رقم الرخصة التجارية', 'تاريخ انتهاء الرخصة', 'نوع النشاط', 'الشكل القانوني', 'رأس المال', 'الأنشطة التجارية',
    '#بيانات المحل', 'موقع المحل', 'رقم المحل', 'المساحة (م٢)',
    '#المدة والقيمة', 'تاريخ بداية العقد', 'تاريخ نهاية العقد', 'قيمة الإيجار السنوي', 'نسبة الضريبة %', 'طريقة الدفع', 'فترة السماح للتجهيز', 'الدفعات',
    '#التأمين والرسوم', 'مبلغ التأمين', 'طريقة تحصيل التأمين', 'الرسوم الإدارية',
    '#الالتزامات', 'فواتير الخدمات على', 'الصيانة على', 'اللوحات والديكور على', 'شروط إضافية',
  ],
  'عقد تأجير مركبة': [
    '#بيانات العقد', 'رقم العقد', 'تاريخ تحرير العقد', 'مكان تحرير العقد',
    '#الطرف الأول (المؤجر)', 'اسم المؤجر', 'رقم هوية المؤجر', 'رقم جواز المؤجر', 'هاتف المؤجر', 'بريد المؤجر', 'عنوان المؤجر',
    '#الطرف الثاني (المستأجر)', 'اسم المستأجر', 'رقم هوية المستأجر', 'رقم جواز المستأجر', 'جنسية المستأجر', 'رقم رخصة القيادة', 'تاريخ انتهاء رخصة القيادة', 'هاتف المستأجر', 'بريد المستأجر',
    '#بيانات المركبة', 'المركبة', 'نوع المركبة', 'الموديل', 'رقم اللوحة', 'رقم الهيكل / الشاصي', 'سنة الصنع', 'اللون', 'قراءة العداد عند التسليم', 'مستوى الوقود عند التسليم',
    '#المدة والقيمة', 'تاريخ بداية العقد', 'من الساعة', 'تاريخ نهاية العقد', 'إلى الساعة', 'أساس التأجير', 'قيمة الإيجار', 'نسبة الضريبة %', 'الكيلومترات المسموحة', 'رسوم الكيلومتر الإضافي', 'الدفعات',
    '#السائق / القبطان (إن وُجد)', 'اسم السائق', 'رقم رخصة السائق', 'تاريخ انتهاء رخصة السائق',
    '#التأمين والرسوم', 'مبلغ التأمين', 'طريقة تحصيل التأمين', 'الرسوم الإدارية',
    '#الالتزامات', 'الوقود على', 'الصيانة الدورية على', 'التأمين على المركبة', 'شروط إضافية',
  ],
  'عقد عام': [
    '#بيانات العقد', 'تاريخ تحرير العقد',
    '#الطرف الأول', 'الطرف الأول', 'رقم هوية الطرف الأول', 'رقم جواز الطرف الأول', 'هاتف الطرف الأول',
    '#الطرف الثاني', 'الطرف الثاني', 'رقم هوية الطرف الثاني', 'رقم جواز الطرف الثاني', 'هاتف الطرف الثاني',
    '#موضوع العقد وقيمته', 'موضوع العقد', 'قيمة العقد', 'طريقة الدفع', 'تاريخ بداية العقد', 'تاريخ نهاية العقد',
    '#الالتزامات', 'التزامات الطرف الأول', 'التزامات الطرف الثاني', 'شروط إضافية',
  ],
  'إيصال استلام وتسليم': [
    '#الأطراف', 'اسم المستلم', 'رقم هوية المستلم', 'رقم جواز المستلم', 'اسم المسلّم', 'رقم هوية المسلّم', 'رقم جواز المسلّم', 'مكان التسليم', 'تاريخ التسليم',
    '#العناصر المسلّمة', 'العناصر المسلّمة',
    '#حالة الاستلام', 'حالة الاستلام',
  ],
  فاتورة: [
    '#العميل', 'اسم الجهة', 'الرقم الضريبي', 'عنوان العميل',
    '#بيانات الفاتورة', 'رقم الفاتورة', 'الرقم الضريبي للمُصدر', 'عنوان المُصدر',
    '#البنود', 'بنود الفاتورة', 'نسبة الضريبة %',
    '#الدفع', 'اسم البنك', 'الآيبان',
  ],
  'تقرير ضريبي': [
    '#الفترة والمكلّف', 'الفترة الضريبية', 'اسم المكلّف', 'الرقم الضريبي', 'تاريخ استحقاق السداد',
    '#التفصيل الشهري', 'التفصيل الشهري', 'نسبة الضريبة %',
    '#الإجمالي (إن لم يُفصَّل شهريًا)', 'الإيرادات', 'الضريبة',
  ],
  عقد: ['الطرف الأول', 'الطرف الثاني', 'موضوع العقد', 'قيمة العقد'],
  إنذار: [
    '#المرسل إليه', 'المرسل إليه', 'رقم هوية المرسل إليه', 'رقم جواز المرسل إليه', 'عنوان المرسل إليه',
    '#الموضوع', 'سبب الإنذار', 'رقم العقد المرتبط', 'نص الإنذار', 'المبلغ المطالب به',
    '#المهلة والإجراء', 'المهلة', 'تاريخ انتهاء المهلة', 'الإجراء المطلوب',
  ],
}

/** حقول جداول (أكثر من سطر): الاسم ← الأعمدة. تُحفظ JSON في الحقل نفسه. */
export const TABLE_FIELDS: Record<string, string[]> = {
  الدفعات: ['اسم الدفعة', 'القيمة', 'تاريخ الاستحقاق', 'طريقة التحصيل', 'رقم الشيك / البنك'],
  'الرسوم الإدارية': ['نوع الرسم', 'القيمة', 'تاريخ الاستحقاق', 'يتحمّلها'],
  'العناصر المسلّمة': ['العنصر', 'الوصف / الرقم التسلسلي', 'الكمية', 'الحالة'],
  'بنود الفاتورة': ['البيان', 'الكمية', 'سعر الوحدة'],
  'التفصيل الشهري': ['الشهر', 'المبيعات', 'المشتريات'],
}

export const NUMERIC_COLUMNS = new Set(['القيمة', 'الكمية', 'سعر الوحدة', 'المبيعات', 'المشتريات'])
export const TIME_FIELDS = new Set(['من الساعة', 'إلى الساعة'])

export const OPTION_FIELDS: Record<string, string[]> = {
  العملة: CURRENCIES.map(([, suffix]) => suffix),
  'نوع المبلغ': ['دين (قرض)', 'أمانة', 'سلفة'],
  'طريقة السداد': ['دفعة واحدة', 'أقساط شهرية', 'أقساط حسب الاتفاق'],
  'نوع العقار': ['شقة', 'فيلا', 'محل تجاري', 'مكتب', 'مستودع', 'أرض', 'أخرى'],
  'الغرض من الإيجار': ['سكني', 'تجاري', 'سكني وتجاري'],
  'طريقة الدفع': ['دفعة واحدة', 'دفعتان', 'أربع دفعات', 'شهريًا'],
  'فواتير الخدمات على': ['المستأجر', 'المؤجر'],
  'الصيانة البسيطة على': ['المستأجر', 'المؤجر'],
  'الصيانة الأساسية على': ['المؤجر', 'المستأجر'],
  'الصيانة على': ['المستأجر', 'المؤجر'],
  'اللوحات والديكور على': ['المستأجر', 'المؤجر'],
  'الوقود على': ['المستأجر', 'المؤجر'],
  'الصيانة الدورية على': ['المؤجر', 'المستأجر'],
  'أساس التأجير': ['بالساعات', 'يومي', 'أسبوعي', 'شهري', 'سنوي'],
  'نمط مدة الإيجار': ['يومي', 'شهري', 'سنوي', 'مخصص'],
  'طريقة تحصيل التأمين': ['نقدًا', 'تحويل بنكي', 'شيك', 'مدى'],
  'حالة الاستلام': ['سليمة بالكامل', 'بها ملاحظات', 'ناقصة'],
  'صفة الممثل': ['وكيل', 'مفوّض', 'ولي أمر', 'أخرى'],
  'الشكل القانوني': ['مؤسسة فردية', 'شركة ذات مسؤولية محدودة', 'شركة مساهمة', 'شركة تضامن', 'أخرى'],
  'مستوى الوقود عند التسليم': ['ممتلئ', 'ثلاثة أرباع', 'نصف', 'ربع'],
  'التأمين على المركبة': ['تأمين شامل', 'تأمين ضد الغير', 'بدون تأمين'],
}

export const DATE_FIELDS = new Set([
  'تاريخ الاستلام', 'تاريخ السداد', 'تاريخ تحرير العقد', 'تاريخ بداية العقد', 'تاريخ نهاية العقد', 'تاريخ انتهاء الرخصة', 'تاريخ انتهاء رخصة القيادة',
  'تاريخ انتهاء هوية المؤجر', 'تاريخ انتهاء هوية المستأجر', 'تاريخ انتهاء الوكالة', 'تاريخ انتهاء رخصة السائق', 'تاريخ التسليم', 'تاريخ استحقاق السداد', 'تاريخ انتهاء المهلة',
])

export const NUMBER_FIELDS = new Set([
  'المبلغ', 'عدد الأقساط', 'قيمة القسط', 'قيمة الإيجار السنوي', 'مبلغ التأمين', 'قيمة الإيجار', 'الكيلومترات المسموحة', 'رسوم الكيلومتر الإضافي', 'قراءة العداد عند التسليم',
  'المساحة (م٢)', 'قيمة العقد', 'سنة الصنع', 'نسبة الضريبة %', 'مساحة العين (م٢)', 'رأس المال', 'المبلغ المطالب به', 'الإيرادات', 'الضريبة',
])

export const MULTI_FIELDS = new Set(['شروط إضافية', 'موضوع العقد', 'التزامات الطرف الأول', 'التزامات الطرف الثاني', 'مكونات العين', 'الأنشطة التجارية', 'نص الإنذار'])

/** حقل الاسم الإلزامي (وعنوان التذكير) لكل نموذج — وإلا أول حقل. */
const PRIMARY_FIELD: Record<string, string> = {
  'عقد إيجار عقار': 'اسم المستأجر',
  'عقد إيجار نشاط تجاري': 'الاسم التجاري',
  'عقد تأجير مركبة': 'اسم المستأجر',
}

/** تاريخ الانتهاء (للتذكير) من حقل النموذج نفسه. */
const EXPIRY_ALIAS: Record<string, string> = {
  'إيصال أمانة': 'تاريخ السداد',
  'عقد إيجار عقار': 'تاريخ نهاية العقد',
  'عقد إيجار نشاط تجاري': 'تاريخ نهاية العقد',
  'عقد تأجير مركبة': 'تاريخ نهاية العقد',
  'عقد عام': 'تاريخ نهاية العقد',
}

const PARTIES_INTRO =
  'إنه في يوم {تاريخ تحرير العقد} بمدينة {مكان تحرير العقد} تم الاتفاق بين كلٍّ من الطرف الأول (المؤجر): {اسم المؤجر}، والطرف الثاني (المستأجر): {اسم المستأجر}، وقد أقرّ الطرفان بأهليتهما للتعاقد واتفقا على ما يلي:'

/** صيغة الإقرار في رأس المستند — {الحقل} يُستبدل بقيمته. */
const TEMPLATE_INTRO: Record<string, string> = {
  'إيصال أمانة':
    'أقرّ أنا الموقّع أدناه {اسم المدين}{@المدين}، بأنني استلمت من {اسم الدائن}{@الدائن}، مبلغًا وقدره {المبلغ} ({المبلغ كتابةً}) على سبيل {نوع المبلغ}، وذلك بتاريخ {تاريخ الاستلام}.',
  'عقد إيجار عقار': PARTIES_INTRO,
  'عقد إيجار نشاط تجاري': PARTIES_INTRO,
  'عقد تأجير مركبة': PARTIES_INTRO,
  'عقد عام': 'إنه في يوم {تاريخ تحرير العقد} تم الاتفاق بين كلٍّ من الطرف الأول: {الطرف الأول}، والطرف الثاني: {الطرف الثاني}، وقد أقرّ الطرفان بأهليتهما للتعاقد واتفقا على ما يلي:',
}

const CLAUSE_DEPOSIT = '?دفع المستأجر مبلغ تأمين قدره {مبلغ التأمين}، يُردّ إليه عند انتهاء العقد بعد خصم قيمة أي أضرار أو مستحقات قائمة.'
const CLAUSE_EXTRA = '?شروط إضافية: {شروط إضافية}'
const CLAUSE_COPIES = 'حُرِّر هذا العقد من نسختين، بيد كل طرف نسخة للعمل بموجبها.'
const CLAUSE_TERM = 'مدة العقد من {تاريخ بداية العقد} إلى {تاريخ نهاية العقد}، ولا يُجدَّد إلا باتفاق مكتوب بين الطرفين.'
const CLAUSE_RENT = 'الأجرة السنوية {قيمة الإيجار السنوي}، تُدفع {طريقة الدفع} مقدمًا في مواعيد استحقاقها، ولا يحق للمستأجر تأخيرها أو الامتناع عنها.'
const CLAUSE_BREACH = 'إذا تأخر المستأجر عن سداد الأجرة أو أخلّ بأي من التزاماته، يحق للمؤجر المطالبة بفسخ العقد وبما يستحقه وفق الأنظمة المعمول بها.'

/** البنود — ما يبدأ بـ «?» لا يظهر إلا إن امتلأت حقوله. */
const TEMPLATE_CLAUSES: Record<string, string[]> = {
  'إيصال أمانة': [
    '?سبب الدين: {سبب الدين}.',
    'أتعهد بردّ المبلغ كاملًا إلى الدائن أو من يفوّضه في موعد أقصاه {تاريخ السداد}، وطريقة السداد: {طريقة السداد}.',
    '?يُسدَّد المبلغ على {عدد الأقساط} أقساط، قيمة كل قسط {قيمة القسط}.',
    'يُعدّ هذا الإيصال سندًا بالمبلغ، ويحق للدائن عند التأخر عن السداد المطالبة به بالطرق النظامية.',
    'وهذا إقرار مني بذلك وأنا بكامل أهليتي المعتبرة شرعًا ونظامًا.',
  ],
  'عقد إيجار عقار': [
    CLAUSE_TERM,
    CLAUSE_RENT,
    CLAUSE_DEPOSIT,
    'يستعمل المستأجر العقار للغرض المتفق عليه ({الغرض من الإيجار}) فقط، ولا يحق له التأجير من الباطن أو التنازل عن العقد إلا بموافقة كتابية من المؤجر.',
    'فواتير الخدمات (الكهرباء والماء والاتصالات) على {فواتير الخدمات على}، والصيانة البسيطة على {الصيانة البسيطة على}، والصيانة الأساسية والإنشائية على {الصيانة الأساسية على}.',
    'لا يجوز للمستأجر إجراء أي تعديلات أو إنشاءات في العقار إلا بموافقة كتابية من المؤجر.',
    'يلتزم المستأجر بالمحافظة على العقار وتسليمه عند انتهاء العقد بالحالة التي استلمه بها، عدا الاستهلاك المعتاد.',
    CLAUSE_BREACH,
    CLAUSE_EXTRA,
    CLAUSE_COPIES,
  ],
  'عقد إيجار نشاط تجاري': [
    CLAUSE_TERM,
    CLAUSE_RENT,
    CLAUSE_DEPOSIT,
    '?منح المؤجر المستأجر فترة سماح للتجهيز مدتها {فترة السماح للتجهيز} لا تُحتسب فيها أجرة.',
    'يستعمل المستأجر المحل لممارسة نشاط ({نوع النشاط}) تحت الاسم التجاري ({الاسم التجاري}) فقط، ولا يحق له تغيير النشاط أو التأجير من الباطن إلا بموافقة كتابية من المؤجر.',
    'يلتزم المستأجر باستخراج التراخيص اللازمة لنشاطه وتجديدها قبل انتهائها، ويتحمّل وحده أي مخالفات أو غرامات تنشأ عن نشاطه.',
    'فواتير الخدمات على {فواتير الخدمات على}، والصيانة على {الصيانة على}، واللوحات والديكور على {اللوحات والديكور على}.',
    'عند انتهاء العقد يسلّم المستأجر المحل خاليًا من الشواغل وبالحالة التي استلمه بها، وتؤول التحسينات الثابتة للمؤجر ما لم يُتفق على غير ذلك.',
    CLAUSE_BREACH,
    CLAUSE_EXTRA,
    CLAUSE_COPIES,
  ],
  'عقد تأجير مركبة': [
    'مدة الإيجار من {تاريخ بداية العقد} إلى {تاريخ نهاية العقد}، وأجرة المركبة {قيمة الإيجار} على أساس {أساس التأجير}.',
    '?دفع المستأجر مبلغ تأمين قدره {مبلغ التأمين}، يُردّ عند إعادة المركبة سليمة بعد خصم أي مستحقات.',
    'استلم المستأجر المركبة بحالة جيدة، وقراءة العداد {قراءة العداد عند التسليم} كم، ومستوى الوقود {مستوى الوقود عند التسليم}، ويعيدها بالحالة نفسها.',
    '?الكيلومترات المسموحة {الكيلومترات المسموحة} كم، وما زاد عليها يُحتسب بواقع {رسوم الكيلومتر الإضافي} لكل كيلومتر.',
    'المستأجر مسؤول عن المخالفات المرورية والحوادث وما يترتب عليها طوال مدة الإيجار، وعليه إبلاغ المؤجر والجهات المختصة فور وقوع أي حادث.',
    'لا يحق للمستأجر السماح لغيره بقيادة المركبة، أو استعمالها في غير الغرض المعتاد، أو الخروج بها خارج الدولة إلا بموافقة كتابية من المؤجر.',
    'الوقود على {الوقود على}، والصيانة الدورية على {الصيانة الدورية على}، ونوع التأمين على المركبة: {التأمين على المركبة}.',
    'التأخر في إعادة المركبة عن الموعد المحدد يُحتسب بأجرة يوم كامل عن كل يوم تأخير أو جزء منه.',
    CLAUSE_EXTRA,
    CLAUSE_COPIES,
  ],
  'عقد عام': [
    'موضوع العقد: {موضوع العقد}',
    '?قيمة العقد {قيمة العقد}، تُدفع {طريقة الدفع}.',
    '?مدة العقد من {تاريخ بداية العقد} إلى {تاريخ نهاية العقد}.',
    '?يلتزم الطرف الأول بما يلي: {التزامات الطرف الأول}',
    '?يلتزم الطرف الثاني بما يلي: {التزامات الطرف الثاني}',
    'في حال إخلال أي طرف بالتزاماته يحق للطرف الآخر المطالبة بالتعويض وفسخ العقد وفق الأنظمة المعمول بها.',
    CLAUSE_EXTRA,
    CLAUSE_COPIES,
  ],
}

/** خانات التوقيع: (الصفة، حقل الاسم). */
const TEMPLATE_SIGNERS: Record<string, [string, string][]> = {
  'إيصال أمانة': [
    ['المدين', 'اسم المدين'],
    ['الدائن', 'اسم الدائن'],
    ['الشاهد الأول', 'الشاهد الأول'],
    ['الشاهد الثاني', 'الشاهد الثاني'],
  ],
  'عقد إيجار عقار': [
    ['الطرف الأول (المؤجر)', 'اسم المؤجر'],
    ['الطرف الثاني (المستأجر)', 'اسم المستأجر'],
  ],
  'عقد إيجار نشاط تجاري': [
    ['الطرف الأول (المؤجر)', 'اسم المؤجر'],
    ['الطرف الثاني (المستأجر)', 'اسم المستأجر'],
  ],
  'عقد تأجير مركبة': [
    ['الطرف الأول (المؤجر)', 'اسم المؤجر'],
    ['الطرف الثاني (المستأجر)', 'اسم المستأجر'],
  ],
  'عقد عام': [
    ['الطرف الأول', 'الطرف الأول'],
    ['الطرف الثاني', 'الطرف الثاني'],
  ],
}

/** خانات المبالغ: تُكتب العملة المختارة بجانبها في المستند. */
export const MONEY_FIELDS = new Set(['المبلغ', 'قيمة القسط', 'قيمة الإيجار السنوي', 'قيمة الإيجار', 'مبلغ التأمين', 'رسوم الكيلومتر الإضافي', 'رأس المال', 'قيمة العقد', 'المبلغ المطالب به'])
const CURRENCY_ANCHORS = new Set([...MONEY_FIELDS, 'بنود الفاتورة', 'التفصيل الشهري'])

/** الحقول الإلزامية لكل نموذج — حقل الاسم الأساسي إلزامي دائمًا. */
const REQUIRED_FIELDS: Record<string, string[]> = {
  'إيصال أمانة': ['اسم المدين', 'اسم الدائن', 'المبلغ', 'تاريخ الاستلام'],
  'عقد إيجار عقار': ['اسم المؤجر', 'اسم المستأجر', 'اسم العقار', 'تاريخ بداية العقد', 'تاريخ نهاية العقد', 'قيمة الإيجار السنوي'],
  'عقد إيجار نشاط تجاري': ['اسم المؤجر', 'اسم المستأجر', 'الاسم التجاري', 'تاريخ بداية العقد', 'تاريخ نهاية العقد', 'قيمة الإيجار السنوي'],
  'عقد تأجير مركبة': ['اسم المؤجر', 'اسم المستأجر', 'رقم رخصة القيادة', 'المركبة', 'رقم اللوحة', 'تاريخ بداية العقد', 'تاريخ نهاية العقد', 'قيمة الإيجار'],
  'عقد عام': ['تاريخ تحرير العقد', 'الطرف الأول', 'الطرف الثاني', 'موضوع العقد'],
  'إيصال استلام وتسليم': ['اسم المستلم', 'اسم المسلّم', 'تاريخ التسليم'],
  فاتورة: ['اسم الجهة', 'رقم الفاتورة'],
  'تقرير ضريبي': ['الفترة الضريبية', 'اسم المكلّف', 'الرقم الضريبي'],
  إنذار: ['المرسل إليه', 'سبب الإنذار', 'نص الإنذار'],
}

/** العقود الثلاثة بنموذج عقد الإيجار الأصلي (العقارات والأنشطة والمركبات). */
export const LEASE_DOC_TYPES = new Set(['عقد إيجار عقار', 'عقد إيجار نشاط تجاري', 'عقد تأجير مركبة'])

/** تصنيفات النشاط كما في «إضافة نشاط تجاري». */
export const LEASE_ACTIVITY_CLASSES = ['الخدمات', 'الأنشطة الفورية', 'زراعية', 'التكنولوجيا', 'الحرفية', 'المقاولات', 'المهنية', 'تجارة واستثمار', 'أخرى']

/** بيانات المركبة في العقد (مكان «بيانات العقار»). */
export const LEASE_VEHICLE_FIELDS = ['تصنيف المركبة', 'نوع المركبة', 'اسم المركبة', 'الموديل', 'رقم اللوحة', 'رقم الشاصي', 'تاريخ انتهاء الملكية', 'تاريخ انتهاء التأمين']

export const REMINDER_LABELS = ['في يوم الانتهاء', 'قبل يوم', 'قبل 3 أيام', 'قبل أسبوع', 'قبل أسبوعين', 'قبل شهر']
export const REMINDER_MODULE = 'النماذج والمستندات'

export const isFormal = (type: string) => type in TEMPLATE_CLAUSES
export const isTemplateType = (type: string) => type in TEMPLATE_FIELDS

/** خانات النموذج بترتيبها مع «العملة» قبل أول مبلغ. */
export function fieldsOf(type: string): string[] {
  const fields = TEMPLATE_FIELDS[type] ?? []
  const at = fields.findIndex((f) => CURRENCY_ANCHORS.has(f))
  if (at < 0 || fields.includes('العملة')) return fields
  return [...fields.slice(0, at), 'العملة', ...fields.slice(at)]
}

export const inputsOf = (type: string) => fieldsOf(type).filter((f) => !f.startsWith('#'))
export const primaryOf = (type: string) => PRIMARY_FIELD[type] ?? inputsOf(type)[0] ?? ''
export const isRequired = (type: string, field: string) => field === primaryOf(type) || (REQUIRED_FIELDS[type] ?? []).includes(field)

// ============================== التواريخ والأرقام ==============================

const two = (n: number) => String(n).padStart(2, '0')
/** _formatDate: 05/03/2026 */
export const formatDate = (d: Date) => `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`

/** يوم/شهر/سنة أو سنة-شهر-يوم ← تاريخ. */
export function parseDate(raw: string): Date | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const parts = text.split(/[/\-.T ]/).filter(Boolean)
  if (parts.length < 3) return null
  const [a, b, c] = parts.slice(0, 3).map((p) => parseInt(p, 10))
  if ([a, b, c].some(Number.isNaN)) return null
  const d = parts[0].length === 4 ? new Date(a, b - 1, c) : new Date(c, b - 1, a)
  return Number.isNaN(d.getTime()) ? null : d
}

/** «يوم/شهر/سنة» ← قيمة حقل التاريخ في المتصفح (سنة-شهر-يوم). */
export const toInputDate = (raw: string) => {
  const d = parseDate(raw)
  return d ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` : ''
}

/** _showDate: سنة-شهر-يوم ← يوم/شهر/سنة، وغيرها كما هي. */
const showDate = (raw: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? '').trim())
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (raw ?? '').trim()
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
/** printNum: رقم من نص (يقبل الأرقام العربية والفواصل). */
export function printNum(raw: string): number {
  let text = String(raw ?? '').trim()
  for (let i = 0; i < 10; i++) text = text.split(AR_DIGITS[i]).join(String(i))
  text = text.replace(/٫/g, '.').replace(/[^0-9.-]/g, '')
  const n = parseFloat(text)
  return Number.isFinite(n) ? n : 0
}

/** printRows: صفوف حقل جدول (JSON) — الفارغ لا يُعدّ. */
export function printRows(raw: string): Record<string, string>[] {
  if (!(raw ?? '').trim()) return []
  try {
    const decoded = JSON.parse(raw)
    if (!Array.isArray(decoded)) return []
    return decoded
      .filter((r) => r && typeof r === 'object')
      .map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '').trim()])))
      .filter((row) => Object.entries(row).some(([k, v]) => !k.startsWith('__') && v))
  } catch {
    return []
  }
}

/** صفوف الجدول كما تُحرَّر (مع المعرّف). */
export function editRows(raw: string): Record<string, string>[] {
  try {
    const decoded = JSON.parse(raw || '[]')
    return Array.isArray(decoded) ? decoded.filter((r) => r && typeof r === 'object').map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')]))) : []
  } catch {
    return []
  }
}

// ============================== السجلات ==============================

export type DocRecord = {
  id: string
  doc_type: string
  fields: Record<string, string>
  linked_kind: string | null
  linked_label: string | null
  linked_id: string | null
  doc_number: string | null
  issued_on: string | null
  notes: string | null
  created_at?: string
}

export type LinkTarget = { kind: string; label: string; id: string }

const normalize = (row: Record<string, unknown>): DocRecord => ({
  id: String(row.id),
  doc_type: String(row.doc_type ?? ''),
  fields: Object.fromEntries(Object.entries((row.fields as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v ?? '')])),
  linked_kind: (row.linked_kind as string) ?? null,
  linked_label: (row.linked_label as string) ?? null,
  linked_id: (row.linked_id as string) ?? null,
  doc_number: (row.doc_number as string) ?? null,
  issued_on: (row.issued_on as string) ?? null,
  notes: (row.notes as string) ?? null,
  created_at: row.created_at as string | undefined,
})

/** fetchDocuments: الأحدث أولًا. */
export function useDocRecords() {
  const { user } = useSession()
  return useQuery({
    queryKey: ['document-records', user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('document_records').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[]).map(normalize)
    },
  })
}

type Upsert = { id?: string; docType: string; fields: Record<string, string>; link?: LinkTarget | null; keepLink?: DocRecord; issuedOn: string }

/** upsertDocument: إضافة أو تحديث بالمعرّف. */
export async function upsertDocRecord(o: Upsert): Promise<DocRecord> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) throw new Error('سجّل الدخول أولًا')
  const row = {
    user_id: uid,
    doc_type: o.docType,
    fields: o.fields,
    linked_kind: o.link !== undefined ? (o.link?.kind ?? null) : (o.keepLink?.linked_kind ?? null),
    linked_label: o.link !== undefined ? (o.link?.label ?? null) : (o.keepLink?.linked_label ?? null),
    linked_id: o.link !== undefined ? (o.link?.id ?? null) : (o.keepLink?.linked_id ?? null),
    doc_number: o.keepLink?.doc_number ?? null,
    issued_on: o.issuedOn,
    notes: o.keepLink?.notes ?? null,
  }
  const q = o.id ? supabase.from('document_records').update(row).eq('id', o.id).select().single() : supabase.from('document_records').insert(row).select().single()
  const { data, error } = await q
  if (error) throw error
  return normalize(data as Record<string, unknown>)
}

/** deleteDocument، ويُحذف تذكير الانتهاء المرتبط أيضًا. */
export async function deleteDocRecord(id: string) {
  const { error } = await supabase.from('document_records').delete().eq('id', id)
  if (error) throw error
  await changeReminders([], [id]).catch(() => {})
}

/** AppRemindersStore.upsert للنموذج المحفوظ. */
export async function remindFor(id: string, title: string, expiryDisplay: string, label: string) {
  const iso = isoOf(expiryDisplay)
  if (!iso) return false
  await changeReminders([{ id, title, module: REMINDER_MODULE, expiryDate: iso, remindBeforeDays: reminderDays(label) }])
  return true
}

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/**
  _saveTemplate: المسودة تُحفظ ناقصة، وغيرها يشترط كل حقل عليه نجمة.
  يعيد رسالة النتيجة كما في التطبيق، أو يرمي برسالة النقص.
*/
export async function saveTemplate(o: {
  type: string
  values: Record<string, string>
  reminder: string
  includeSignature: boolean
  link: LinkTarget | null
  draft: boolean
  existing?: DocRecord
  t: (s: string) => string
}): Promise<{ record: DocRecord; message: string }> {
  const { type, t } = o
  if (!o.draft) {
    for (const field of inputsOf(type)) {
      if (!isRequired(type, field)) continue
      if ((o.values[field] ?? '').trim()) continue
      throw new Error(`${t('أدخل')} ${t(field)}`)
    }
  }
  const values: Record<string, string> = {}
  for (const [k, v] of Object.entries(o.values)) values[k] = (v ?? '').trim()
  values.includeSignature = o.includeSignature ? '1' : '0'
  values.reminder = o.reminder
  if (o.draft) values.__draft = '1'
  else delete values.__draft
  if (isFormal(type)) {
    values.__v = '2'
    const alias = EXPIRY_ALIAS[type]
    if (alias) values['تاريخ الانتهاء'] = values[alias] ?? ''
  }
  const record = await upsertDocRecord({ id: o.existing?.id, docType: type, fields: values, link: o.link, keepLink: o.existing, issuedOn: isoToday() })
  const reminded = !o.draft && (await remindFor(record.id, `${type}: ${values[primaryOf(type)] ?? ''}`, values['تاريخ الانتهاء'] ?? '', o.reminder).catch(() => false))
  return {
    record,
    message: o.draft ? 'حُفظت المسودة — افتحها من «النماذج المحفوظة» لإكمالها' : reminded ? 'تم حفظ النموذج وإضافة تذكير الانتهاء' : 'تم حفظ النموذج',
  }
}

/** عقد بنموذج عقد الإيجار محفوظًا مستندًا (saveAsDocument). */
export async function saveLeaseDocument(o: { type: string; encoded: string; lessor: string; tenant: string; start: string; end: string; draft: boolean; existing?: DocRecord }): Promise<DocRecord> {
  const day = (raw: string) => {
    const d = parseDate(raw)
    return d ? formatDate(d) : ''
  }
  const values: Record<string, string> = {
    __lease: o.encoded,
    __v: '3',
    'اسم المؤجر': o.lessor.trim(),
    'اسم المستأجر': o.tenant.trim(),
    'تاريخ الإصدار': day(o.start),
    'تاريخ الانتهاء': day(o.end),
    reminder: 'قبل أسبوع',
  }
  if (o.draft) values.__draft = '1'
  const record = await upsertDocRecord({ id: o.existing?.id, docType: o.type, fields: values, keepLink: o.existing, issuedOn: o.existing?.issued_on ?? isoToday() })
  if (!o.draft) await remindFor(record.id, `${o.type}: ${values['اسم المستأجر']}`, values['تاريخ الانتهاء'], 'قبل أسبوع').catch(() => false)
  return record
}

export const isLeaseRecord = (r: DocRecord) => LEASE_DOC_TYPES.has(r.doc_type) && !!(r.fields.__lease ?? '')
export const isDraft = (r: DocRecord) => r.fields.__draft === '1'

/** رقم المستند: المحفوظ، وإلا FND- وأول ثمانية من المعرّف. */
export function docNoOf(r: DocRecord) {
  if ((r.doc_number ?? '').trim()) return r.doc_number!
  const id = r.id.replace(/-/g, '')
  return id ? `FND-${id.slice(0, 8).toUpperCase()}` : ''
}

/** مشاركة نص لنوع غير معروف (ما حُفظ بنسخ قديمة). */
export function recordText(r: DocRecord, t: (s: string) => string) {
  const internal = new Set(['includeSignature', 'reminder', '__v', '__draft', '__lease'])
  const lines = [t(r.doc_type)]
  for (const [k, v] of Object.entries(r.fields)) if (!internal.has(k) && !k.startsWith('__') && v.trim()) lines.push(`${t(k)}: ${v.trim()}`)
  if ((r.linked_label ?? '').trim()) lines.push(`${t('مرتبط بـ')}: ${t(r.linked_kind ?? '')}: ${r.linked_label}`)
  return lines.join('\n')
}

// ============================== الطباعة ==============================

const TITLES: Record<string, [string, string]> = {
  'إيصال أمانة': ['إيصال أمانة', 'TRUST RECEIPT'],
  'إيصال استلام وتسليم': ['محضر استلام وتسليم', 'HANDOVER RECEIPT'],
  فاتورة: ['فاتورة', 'INVOICE'],
  'تقرير ضريبي': ['تقرير ضريبة القيمة المضافة', 'VAT REPORT'],
  'عقد إيجار عقار': ['عقد إيجار عقار', 'PROPERTY LEASE AGREEMENT'],
  'عقد إيجار نشاط تجاري': ['عقد إيجار نشاط تجاري', 'COMMERCIAL LEASE AGREEMENT'],
  'عقد تأجير مركبة': ['عقد تأجير مركبة', 'VEHICLE RENTAL AGREEMENT'],
  'عقد عام': ['عقد اتفاق', 'GENERAL AGREEMENT'],
  إنذار: ['إنذار رسمي', 'FORMAL NOTICE'],
}

const SLOT = /\{([^}]+)\}/g

export type TemplatePrintOptions = {
  t: (s: string) => string
  lang: string
  dir: 'rtl' | 'ltr'
  origin: string
  currency: string
  org: { name: string; city: string; phone: string; email: string; logo: string | null }
  signature: [number, number][][]
  stamp: string
}

/** zatcaQrPayload: TLV (البائع، الرقم الضريبي، الوقت، الإجمالي، الضريبة) Base64. */
function zatcaPayload(seller: string, vatNo: string, time: Date, total: number, vat: number) {
  const bytes: number[] = []
  const enc = new TextEncoder()
  const tag = (id: number, value: string) => {
    let b = Array.from(enc.encode(value))
    if (b.length > 255) b = b.slice(0, 255)
    bytes.push(id, b.length, ...b)
  }
  tag(1, seller)
  tag(2, vatNo)
  tag(3, time.toISOString())
  tag(4, total.toFixed(2))
  tag(5, vat.toFixed(2))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function qrSvg(data: string) {
  const qr = qrcode(0, 'M')
  qr.addData(data, 'Byte')
  qr.make()
  return qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true })
}

/** buildTemplatePdf على الويب: ورقة A4 تُطبع أو تُحفظ PDF من المتصفح. */
export function buildTemplateHtml(record: DocRecord, o: TemplatePrintOptions): string {
  const type = record.doc_type
  const f = record.fields
  const v = (key: string) => (f[key] ?? '').trim()
  const T = (s: string) => esc(o.t(s))
  const rtl = o.dir === 'rtl'
  const currency = esc(o.t(v('العملة') || o.currency))
  const rawCurrency = o.t(v('العملة') || o.currency)
  const seller = o.org.name
  const issued = parseDate(v('تاريخ تحرير العقد')) ?? parseDate(v('تاريخ الإصدار')) ?? (record.issued_on ? parseDate(record.issued_on) : null) ?? new Date()
  const withSignature = f.includeSignature === '1'
  const svg = withSignature ? signatureSvg(o.signature) : ''
  const stamp = withSignature ? o.stamp : ''
  const [baseTitle, subtitle] = TITLES[type] ?? [type, '']
  let title = baseTitle
  if (type === 'فاتورة' && v('الرقم الضريبي للمُصدر')) title = 'فاتورة ضريبية'
  const formal = isFormal(type)

  let section = 0
  const body: string[] = []
  const metaExtra: [string, string][] = []
  const sec = (heading: string, content: string, numbered = true) => {
    if (!content) return
    const num = numbered ? `<span class="num">${arNum(++section, rtl)}</span>` : ''
    body.push(`<section class="sec"><div class="sec-h">${num}<b>${T(heading)}</b><i></i></div>${content}</section>`)
  }
  const kv = (pairs: [string, string][], cols = 3) => {
    const filled = pairs.filter((p) => p[1].trim())
    if (!filled.length) return ''
    const short = filled.filter((p) => p[1].trim().length <= 48)
    const long = filled.filter((p) => p[1].trim().length > 48)
    let html = ''
    if (short.length) {
      const c = short.length < cols ? (short.length === 1 ? 2 : short.length) : cols
      html += `<div class="kv" style="grid-template-columns:repeat(${c},1fr)">${short.map(([k, val]) => `<div class="cell"><span>${T(k)}</span><b><bdi>${esc(val.trim())}</bdi></b></div>`).join('')}</div>`
    }
    for (const [k, val] of long) html += `<div class="kv-long"><span>${T(k)}</span><b>${esc(val.trim()).replace(/\n/g, '<br>')}</b></div>`
    return html
  }
  const table = (heads: string[], rows: string[][], numeric: Set<number> = new Set(), foot?: string[]) => {
    if (!rows.length) return ''
    const cls = (i: number) => (heads[i] === '#' ? ' class="idx"' : numeric.has(i) ? ' class="n"' : '')
    return `<table class="tb"><thead><tr>${heads.map((h, i) => `<th${cls(i)}>${T(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}><bdi>${esc(c)}</bdi></td>`).join('')}</tr>`)
      .join('')}</tbody>${foot ? `<tfoot><tr>${foot.map((c, i) => `<td${cls(i)}>${T(c)}</td>`).join('')}</tr></tfoot>` : ''}</table>`
  }
  const para = (text: string, lead = false) => (text.trim() ? `<p class="para${lead ? ' lead' : ''}">${esc(text.trim()).replace(/\n/g, '<br>')}</p>` : '')
  const note = (text: string) => (text.trim() ? `<div class="note">${esc(text.trim()).replace(/\n/g, '<br>')}</div>` : '')
  const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر']
  const clauses = (items: string[]) => items.map((text, i) => `<p class="clause"><b>${T('البند')} ${i < ORD.length ? T(ORD[i]) : i + 1}: </b>${esc(text)}</p>`).join('')
  const kpis = (items: [string, string, string, boolean][]) =>
    `<div class="kpis">${items.map(([label, value, sub, strong]) => `<div class="kpi${strong ? ' strong' : ''}"><span>${T(label)}</span><b>${esc(value)}</b><small>${sub}</small></div>`).join('')}</div>`
  const signatures = (signers: [string, string][], userIndex = 0, witnesses: [string, string][] = []) => {
    if (!signers.length) return ''
    const box = (label: string, name: string, mine: boolean) =>
      `<div class="sign"><div class="sign-main"><span class="lbl">${T(label)}</span><b>${esc(name)}</b><div class="sig">${mine && svg ? svg : ''}</div><i></i><small>${T('التوقيع')}</small></div><div class="stamp">${
        mine && stamp ? `<img src="data:${imageMime(stamp)};base64,${stamp}" alt="">` : `<span class="ring">${T('الختم')}</span>`
      }</div></div>`
    let html = `<div class="signs">${signers.map(([role, name], i) => box(role, name, i === userIndex)).join('')}</div>`
    const filled = witnesses.filter((w) => w[1].trim())
    if (filled.length) html += `<div class="witness">${filled.map(([role, name]) => `<div><p><span>${T(role)}: </span><b>${esc(name)}</b></p><i></i><small>${T('التوقيع')}</small></div>`).join('')}</div>`
    return html
  }
  const fill = (template: string) =>
    o.t(template).replace(SLOT, (_, key: string) => {
      if (key.startsWith('@')) {
        const party = key.slice(1)
        const parts = [v(`رقم هوية ${party}`) && `${o.t('رقم الهوية')}: ${v(`رقم هوية ${party}`)}`, v(`رقم جواز ${party}`) && `${o.t('رقم الجواز')}: ${v(`رقم جواز ${party}`)}`].filter(Boolean)
        return parts.length ? ` (${parts.join(' · ')})` : ''
      }
      const value = v(key)
      if (!value) return '..........'
      return MONEY_FIELDS.has(key) ? `${value} ${rawCurrency}` : value
    })
  const complete = (template: string) => [...template.matchAll(SLOT)].every((m) => !!v(m[1]))

  let docNo = docNoOf(record)
  let warn = false

  if (type === 'إنذار') {
    warn = true
    metaExtra.push(['رقم العقد', v('رقم العقد المرتبط')])
    const extraTo = [v('رقم هوية المرسل إليه') && `${o.t('رقم الهوية')}: ${v('رقم هوية المرسل إليه')}`, v('رقم جواز المرسل إليه') && `${o.t('رقم الجواز')}: ${v('رقم جواز المرسل إليه')}`, v('عنوان المرسل إليه')].filter(Boolean).join(' · ')
    body.push(`<div class="to"><p><span>${T('إلى السيد/')} </span><b>${esc(v('المرسل إليه'))}</b></p><small>${T('المحترم')}</small></div>`)
    if (extraTo) body.push(`<p class="muted">${esc(extraTo)}</p>`)
    if (v('سبب الإنذار')) body.push(`<div class="subject"><b class="red">${T('الموضوع:')} </b><b>${esc(v('سبب الإنذار'))}</b></div>`)
    body.push(para(o.t('السلام عليكم ورحمة الله وبركاته، وبعد:')), para(v('نص الإنذار'), true))
    const boxes: string[] = []
    const box = (label: string, value: string, sub: string) => {
      if (value) boxes.push(`<div class="wbox"><span>${T(label)}</span><b>${esc(value)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`)
    }
    box('المهلة', v('المهلة'), v('تاريخ انتهاء المهلة') ? `${o.t('تنتهي في')} ${v('تاريخ انتهاء المهلة')}` : '')
    box('الإجراء المطلوب', v('الإجراء المطلوب'), v('المبلغ المطالب به') ? `${o.t('المبلغ المطالب به')}: ${printMoney(printNum(v('المبلغ المطالب به')))} ${rawCurrency}` : '')
    if (boxes.length) body.push(`<div class="wboxes">${boxes.join('')}</div>`)
    body.push(para(o.t('وفي حال عدم الاستجابة خلال المهلة المحددة سنضطر آسفين لاتخاذ الإجراءات النظامية اللازمة دون الرجوع إليكم.')), note(v('ملاحظات')))
    body.push(signatures([['المُنذِر', seller]]), '<div style="height:40px"></div>')
  } else if (type === 'فاتورة') {
    metaExtra.push(['تاريخ الاستحقاق', v('تاريخ الانتهاء')])
    const card = (caption: string, name: string, lines: string[]) =>
      `<div class="pcard"><span>${T(caption)}</span><b>${esc(name)}</b>${lines.filter((l) => l.trim()).map((l) => `<small>${esc(l)}</small>`).join('')}</div>`
    body.push(
      `<div class="pcards">${card('من', seller, [v('الرقم الضريبي للمُصدر') && `${o.t('الرقم الضريبي')}: ${v('الرقم الضريبي للمُصدر')}`, v('عنوان المُصدر')])}${card('إلى (العميل)', v('اسم الجهة'), [
        v('الرقم الضريبي') && `${o.t('الرقم الضريبي')}: ${v('الرقم الضريبي')}`,
        v('عنوان العميل'),
      ])}</div>`,
    )
    const rate = v('نسبة الضريبة %') ? printNum(v('نسبة الضريبة %')) : 15
    let items = printRows(v('بنود الفاتورة'))
    if (!items.length && (v('البيان') || v('المبلغ'))) items = [{ البيان: v('البيان'), الكمية: '1', 'سعر الوحدة': v('المبلغ') }]
    let net = 0
    let tax = 0
    const rows = items.map((row, i) => {
      const qty = row['الكمية'] ? printNum(row['الكمية']) : 1
      const price = printNum(row['سعر الوحدة'] ?? '')
      const lineNet = qty * price
      const lineTax = (lineNet * rate) / 100
      net += lineNet
      tax += lineTax
      return [String(i + 1), row['البيان'] ?? '', qty === Math.round(qty) ? String(Math.round(qty)) : String(qty), printMoney(price), printMoney(lineTax), printMoney(lineNet + lineTax)]
    })
    body.push(`<div style="height:8px"></div>` + table(['#', 'البيان', 'الكمية', 'سعر الوحدة', `${o.t('الضريبة')} ${rateLabel(rate)}%`, 'الإجمالي'], rows, new Set([2, 3, 4, 5])))
    if (rows.length) {
      const totalRow = (label: string, value: number, grand = false) => `<div class="trow${grand ? ' grand' : ''}"><span>${T(label)}</span><b>${printMoney(value)} ${currency}</b></div>`
      const vatNo = v('الرقم الضريبي للمُصدر')
      body.push(
        `<div class="totals"><div class="tbox">${totalRow('الإجمالي قبل الضريبة', net)}${totalRow('ضريبة القيمة المضافة', tax)}${totalRow('الإجمالي المستحق', net + tax, true)}</div>${
          vatNo ? `<div class="qr">${qrSvg(zatcaPayload(seller, vatNo, issued, net + tax, tax))}</div>` : ''
        }</div>`,
      )
    }
    sec('طريقة الدفع', kv([['اسم البنك', v('اسم البنك')], ['الآيبان', v('الآيبان')]], 2), false)
    body.push(note(v('ملاحظات')), signatures([['المُصدِر', seller]]))
    if (v('رقم الفاتورة')) docNo = v('رقم الفاتورة')
  } else if (type === 'تقرير ضريبي') {
    const rate = v('نسبة الضريبة %') ? printNum(v('نسبة الضريبة %')) : 15
    const months = printRows(v('التفصيل الشهري'))
    let sales = 0
    let purchases = 0
    const rows = months.map((row) => {
      const s = printNum(row['المبيعات'] ?? '')
      const p = printNum(row['المشتريات'] ?? '')
      sales += s
      purchases += p
      return [row['الشهر'] ?? '', printMoney(s), printMoney((s * rate) / 100), printMoney(p), printMoney((p * rate) / 100), printMoney(((s - p) * rate) / 100)]
    })
    if (!months.length) sales = printNum(v('الإيرادات'))
    const outTax = months.length ? (sales * rate) / 100 : printNum(v('الضريبة'))
    const inTax = (purchases * rate) / 100
    const net = outTax - inTax
    body.push(
      kpis([
        ['إجمالي المبيعات', printMoney(sales), currency, false],
        ['ضريبة المخرجات', printMoney(outTax), currency, false],
        ['ضريبة المدخلات', printMoney(inTax), currency, false],
        ['صافي الضريبة المستحقة', printMoney(net), currency, true],
      ]),
    )
    sec('التفصيل الشهري', table(['الشهر', 'المبيعات', 'ضريبة المخرجات', 'المشتريات', 'ضريبة المدخلات', 'الصافي'], rows, new Set([1, 2, 3, 4, 5]), ['الإجمالي', printMoney(sales), printMoney(outTax), printMoney(purchases), printMoney(inTax), printMoney(net)]))
    sec(
      'بيانات المكلّف',
      kv([
        ['الاسم', v('اسم المكلّف') || seller],
        ['الرقم الضريبي', v('الرقم الضريبي')],
        ['الفترة الضريبية', v('الفترة الضريبية')],
        ['نسبة الضريبة', `${rateLabel(rate)}%`],
        ['تاريخ استحقاق السداد', v('تاريخ استحقاق السداد')],
      ]),
    )
    body.push(note(`${o.t('هذا التقرير للمتابعة الداخلية من بيانات التطبيق، ولا يغني عن الإقرار الرسمي لدى الجهة المختصة.')}${v('ملاحظات') ? `\n${v('ملاحظات')}` : ''}`))
    body.push(signatures([['أعدّه', seller], ['اعتمده', '']]))
    metaExtra.push(['الفترة', v('الفترة الضريبية')])
  } else {
    // العام: الإقرار، الأقسام بجداولها، البنود، التوقيعات.
    const consumed = new Set(['تاريخ الإصدار', 'ملاحظات', 'includeSignature', 'reminder'])
    if (type === 'إيصال أمانة' && v('المبلغ')) {
      body.push(`<div class="amount"><div><span>${T('المبلغ')}</span><b>${printMoney(printNum(v('المبلغ')))} ${currency}</b></div><p>${esc(v('المبلغ كتابةً'))}</p></div>`)
      consumed.add('المبلغ')
      consumed.add('المبلغ كتابةً')
    }
    if (v('مكان تحرير العقد')) metaExtra.push(['مكان التحرير', v('مكان تحرير العقد')])
    const intro = TEMPLATE_INTRO[type]
    if (intro) body.push(para(fill(intro), true))
    // الحقول الطويلة التي تذكرها البنود لا تتكرر في الأقسام.
    const inClauses = new Set<string>()
    for (const clause of TEMPLATE_CLAUSES[type] ?? []) for (const m of clause.matchAll(SLOT)) inClauses.add(m[1])
    const signerSpec = TEMPLATE_SIGNERS[type] ?? []
    const witnessKeys = new Set(signerSpec.filter(([role]) => role.startsWith('الشاهد')).map(([, key]) => key))
    const sections: [string, string[]][] = []
    let heading = 'البيانات'
    let keys: string[] = []
    for (const field of fieldsOf(type)) {
      if (field.startsWith('#')) {
        if (keys.length) sections.push([heading, keys])
        heading = field.slice(1)
        keys = []
        continue
      }
      if (witnessKeys.has(field)) continue
      if (formal && MULTI_FIELDS.has(field) && inClauses.has(field)) continue
      keys.push(field)
    }
    if (keys.length) sections.push([heading, keys])
    if (!formal) sections.push(['التواريخ', ['تاريخ الإصدار', 'تاريخ الانتهاء']])
    for (const [head, list] of sections) {
      const pairs: [string, string][] = []
      const tables: string[] = []
      for (const key of list) {
        if (consumed.has(key) || key === 'العملة') continue
        const columns = TABLE_FIELDS[key]
        if (columns) {
          tables.push(tableFor(key, columns, v(key)))
          continue
        }
        pairs.push([key, MONEY_FIELDS.has(key) && v(key) ? `${v(key)} ${rawCurrency}` : showDate(v(key))])
      }
      // محضر الاستلام القديم: عنصر واحد بلا جدول.
      if (type === 'إيصال استلام وتسليم' && list.includes('العناصر المسلّمة') && !printRows(v('العناصر المسلّمة')).length && v('العنصر')) tables.push(table(['#', 'العنصر', 'الحالة'], [['1', v('العنصر'), v('حالته')]]))
      sec(head, kv(pairs) + tables.join(''))
    }
    const clauseList = (TEMPLATE_CLAUSES[type] ?? []).flatMap((c) => (!c.startsWith('?') ? [fill(c)] : complete(c.slice(1)) ? [fill(c.slice(1))] : []))
    sec('البنود', clauses(clauseList))
    if ((record.linked_label ?? '').trim()) body.push(note(`${o.t('مرتبط بـ')}: ${o.t(record.linked_kind ?? '')}: ${record.linked_label}`))
    body.push(note(v('ملاحظات')))
    const signers: [string, string][] = signerSpec.filter(([role]) => !role.startsWith('الشاهد')).map(([role, key]) => [role, v(key)])
    const witnesses: [string, string][] = signerSpec.filter(([role]) => role.startsWith('الشاهد')).map(([role, key]) => [role, v(key)])
    body.push(signatures(signers.length ? signers : [['المُصدِر', seller]], type === 'إيصال أمانة' ? 1 : 0, witnesses))
    if (type.startsWith('عقد')) body.push(`<p class="signed-note box">${T('حُرّر هذا العقد من نسختين، بيد كل طرف نسخة للعمل بموجبها.')}</p>`)
    if (v('رقم العقد')) docNo = v('رقم العقد')
  }

  function tableFor(key: string, columns: string[], raw: string) {
    const rows = printRows(raw)
    if (!rows.length) return ''
    const rate = printNum(f['نسبة الضريبة %'] ?? '')
    if (key === 'الدفعات' || key === 'الرسوم الإدارية') {
      const withTax = key === 'الدفعات' && rate > 0
      let total = 0
      let totalTax = 0
      const out = rows.map((row, i) => {
        const amount = printNum(row['القيمة'] ?? '')
        const tax = withTax ? (amount * rate) / 100 : 0
        total += amount
        totalTax += tax
        return [String(i + 1), ...columns.map((c) => (c === 'القيمة' ? printMoney(amount) : showDate(row[c] ?? ''))), ...(withTax ? [printMoney(tax), printMoney(amount + tax)] : [])]
      })
      const heads = ['#', ...columns, ...(withTax ? ['الضريبة', 'الإجمالي'] : [])]
      const amountIndex = columns.indexOf('القيمة') + 1
      const foot = heads.map(() => '')
      foot[1] = 'الإجمالي'
      if (amountIndex > 0) foot[amountIndex] = printMoney(total)
      if (withTax) {
        foot[heads.length - 2] = printMoney(totalTax)
        foot[heads.length - 1] = printMoney(total + totalTax)
      }
      return table(heads, out, new Set([amountIndex, ...(withTax ? [heads.length - 2, heads.length - 1] : [])]), foot)
    }
    return table(['#', ...columns], rows.map((row, i) => [String(i + 1), ...columns.map((c) => showDate(row[c] ?? ''))]))
  }

  // ---------- الترويسة ----------
  const meta: [string, string][] = [
    ['رقم المستند', docNo || '—'],
    ['التاريخ', `${dmy(issued)} ${o.t('م')}`],
    ...(hijri(issued) ? ([['الموافق', `${hijri(issued)} ${o.t('هـ')}`]] as [string, string][]) : []),
    ...metaExtra.filter((m) => m[1].trim()),
  ]
  const orgLines = [[o.org.city, o.org.phone].filter((x) => x.trim()).join(' · '), o.org.email].filter((x) => x.trim())
  const logo = o.org.logo ? `<img class="org-logo" src="data:${imageMime(o.org.logo)};base64,${o.org.logo}" alt="">` : ''
  const header =
    `<header class="lh">${logo}<div class="org"><b>${esc(o.org.name)}</b>${orgLines.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` +
    `<div class="meta">${meta.map(([k, val], i) => `<div class="${i % 2 ? '' : 'alt'}"><span>${T(k)}</span><b><bdi>${esc(val)}</bdi></b></div>`).join('')}</div></header>` +
    `<div class="rule"></div><h1>${T(title)}</h1><p class="sub" dir="ltr">${esc(subtitle)}</p>`
  const font = (file: string, weight: number) => `@font-face{font-family:'LeaseCairo';font-weight:${weight};src:url(${o.origin}/fonts/${file}) format('woff2');}`
  return [
    `<!DOCTYPE html><html lang="${o.lang}" dir="${o.dir}"><head><meta charset="utf-8"><title>${esc(o.t(title))}</title><style>`,
    font('Cairo-Regular.woff2', 400),
    font('Cairo-SemiBold.woff2', 600),
    font('Cairo-Bold.woff2', 700),
    font('Cairo-ExtraBold.woff2', 800),
    LEASE_CSS,
    TEMPLATE_CSS,
    warn ? WARN_CSS : '',
    '</style></head><body>',
    o.org.logo ? `<div class="wm"><img src="data:${imageMime(o.org.logo)};base64,${o.org.logo}" alt=""></div>` : '',
    '<div class="topbar"><i></i></div>',
    header,
    ...body,
    `<footer class="foot">${T('صادر إلكترونيًا عبر تطبيق Fundly')} · ${dmy(new Date())} — ${T('أي كشط أو تعديل يدوي يُبطل هذا المستند')}</footer>`,
    '</body></html>',
  ].join('')
}

const TEMPLATE_CSS = `
.para{font-size:11px;text-align:justify;margin:4px 0 6px;}
.para.lead{font-size:11.5px;}
.muted{font-size:9.5px;color:#5C6B68;}
.clause{text-align:justify;}
.witness{display:flex;gap:16px;margin-top:10px;break-inside:avoid;}
.witness>div{flex:1;}
.witness p{font-size:10px;}
.witness p span{color:#5C6B68;}
.witness i{display:block;height:1px;background:#7B918C;margin-top:18px;}
.witness small{font-size:9px;color:#7B918C;}
.signed-note.box{border:1px solid #C9A24A;border-radius:6px;padding:6px;}
.amount{display:flex;align-items:center;gap:12px;margin-bottom:6px;padding:8px 12px;background:#FFFBF1;border:1.5px solid #C9A24A;border-radius:9px;}
.amount span{display:block;font-size:9.5px;color:#9A8040;}
.amount b{display:block;font-size:20px;font-weight:800;color:#0F2420;white-space:nowrap;}
.amount p{flex:1;font-size:10px;color:#5C6B68;text-align:end;}
.pcards{display:flex;gap:8px;}
.pcard{flex:1;display:flex;flex-direction:column;padding:8px;border:1px solid #D6E2E0;border-radius:8px;}
.pcard span{font-size:9px;font-weight:700;color:#9A8040;}
.pcard b{font-size:12.5px;font-weight:800;color:#0F2420;}
.pcard small{font-size:10px;color:#5C6B68;}
.totals{display:flex;gap:10px;align-items:flex-start;margin-top:8px;break-inside:avoid;}
.tbox{flex:1;border:1px solid #D6E2E0;border-radius:6px;overflow:hidden;}
.trow{display:flex;justify-content:space-between;padding:5px 8px;border-bottom:1px solid #E6EEEC;font-size:10.5px;}
.trow b{font-weight:800;white-space:nowrap;}
.trow.grand{background:#0A5A50;color:#fff;border-bottom:none;font-size:12px;}
.qr{width:86px;height:86px;flex:none;}
.qr svg{width:86px;height:86px;}
.to{display:flex;align-items:center;gap:8px;}
.to p{flex:1;font-size:12px;}
.to p span{color:#5C6B68;}
.to small{font-size:11px;color:#5C6B68;}
.subject{margin:8px 0;padding:6px 10px;background:#FBF1EF;border-inline-start:3px solid #C4392E;font-size:11.5px;}
.subject .red{color:#C4392E;}
.wboxes{display:flex;gap:8px;margin:6px 0;}
.wbox{flex:1;display:flex;flex-direction:column;padding:8px;background:#FFF8F7;border:1px solid #E9B7B1;border-radius:8px;}
.wbox span{font-size:9.5px;color:#8E2A22;}
.wbox b{font-size:14px;font-weight:800;}
.wbox small{font-size:9.5px;color:#5C6B68;}
`

/** الإنذار: اللون الأحمر بدل الأخضر في الرأس. */
const WARN_CSS = `
.topbar,.rule{background:#C4392E;}
.sec-h .num{background:#C4392E;}
.sec-h b{color:#C4392E;}
`
