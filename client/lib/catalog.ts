import {
  Briefcase,
  Building2,
  Car,
  FileText,
  Gift,
  KeyRound,
  ListChecks,
  MapPin,
  Plane,
  Store,
  Users,
  UsersRound,
  Wallet,
  Handshake,
  type LucideIcon,
} from 'lucide-react'

/*
  التصنيفات والمسميات كما في التطبيق حرفيًا، حتى تطابق الترجمة والقيم
  المخزّنة. المصدر مذكور فوق كل جدول.
*/

// personal_commitments_screen.dart ← _entryTypeCategorySlug
export const PERSONAL_SLUG: Record<string, string> = {
  'المصروفات الشخصية': 'financial',
  مصروف: 'financial',
  إيراد: 'financial',
  'تحويل مالي': 'financial',
  'دين / قرض / سلفة': 'financial',
  قسط: 'financial',
  غرامة: 'financial',
  مستند: 'document',
  مهمة: 'organization',
  موعد: 'organization',
  عادة: 'organization',
  ملاحظات: 'organization',
  متابعة: 'organization',
  'تسجيل / تخطيط': 'organization',
  تجديد: 'organization',
  تفويض: 'organization',
  تذكير: 'organization',
  أدوية: 'medical_accounts',
  'كلمات سر': 'medical_accounts',
  'أدوية وبياناتها': 'medical_accounts',
  حسابات: 'medical_accounts',
  'الحسابات والبيانات': 'medical_accounts',
  'كلمات السر': 'medical_accounts',
  الإيميلات: 'medical_accounts',
  'الحسابات البنكية': 'medical_accounts',
  مناسبة: 'lifestyle',
  اشتراك: 'lifestyle',
  اشتراكات: 'lifestyle',
  هدية: 'lifestyle',
  عطاء: 'lifestyle',
  جمعية: 'lifestyle',
  'مواقع وأماكن': 'location',
  'عهدة مالية': 'custody',
}

// personal_commitments_screen.dart ← _categorySlugFilterLabel
export const PERSONAL_GROUPS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'financial', label: 'مالية', icon: Wallet },
  { key: 'document', label: 'مستند', icon: FileText },
  { key: 'organization', label: 'المتابعة والتخطيط', icon: ListChecks },
  { key: 'medical_accounts', label: 'أدوية وبيانات وكلمات سر', icon: KeyRound },
  { key: 'lifestyle', label: 'نمط الحياة', icon: Gift },
  { key: 'location', label: 'مواقع وأماكن', icon: MapPin },
  { key: 'custody', label: 'عهدة مالية', icon: Briefcase },
]

export function personalGroup(entryType: string, dbCategory?: string): string {
  const slug = PERSONAL_SLUG[(entryType ?? '').trim()]
  if (slug) return slug
  if (dbCategory === 'financial') return 'financial'
  return 'organization'
}

/** أنواع مالية تدخل في الملخص: الدخل والمصروف والديون. */
export const INCOME_TYPES = ['إيراد']
export const EXPENSE_TYPES = ['المصروفات الشخصية', 'مصروف', 'قسط', 'غرامة']
export const DEBT_TYPES = ['دين / قرض / سلفة']

// shared_entries.entry_type — «جمعية مالية» تُعرض «تحديد أدوار» كما في التطبيق.
export const SHARED_GROUPS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'مشاركات مشتركة', label: 'مشاركات مشتركة', icon: UsersRound },
  { key: 'الرحلة / السفر', label: 'الرحلة / السفر', icon: Plane },
  { key: 'جمعية مالية', label: 'تحديد أدوار', icon: Handshake },
  { key: 'اللقاءات', label: 'اللقاءات', icon: Users },
]

export function sharedLabel(entryType: string): string {
  return SHARED_GROUPS.find((g) => g.key === entryType)?.label ?? entryType
}

// projects_activities_screen.dart ← _fromDatabaseCategory و _categoryColor
export const ASSET_GROUPS: { key: string; label: string; icon: LucideIcon; color: string }[] = [
  { key: 'real_estate', label: 'العقارات', icon: Building2, color: '#0A5A50' },
  { key: 'activity', label: 'الأنشطة التجارية', icon: Store, color: '#CE8422' },
  { key: 'equipment', label: 'المركبات ووسائل النقل', icon: Car, color: '#0E7161' },
  { key: 'other', label: 'أخرى', icon: Building2, color: '#0E7161' },
]

export function assetGroup(dbCategory: string): string {
  if (dbCategory === 'business' || dbCategory === 'activity') return 'activity'
  if (dbCategory === 'equipment') return 'equipment'
  if (dbCategory === 'real_estate' || dbCategory === 'project') return 'real_estate'
  return 'other'
}

// app_settings.dart ← currencies: القيمة المحفوظة ← اللاحقة القصيرة.
export const CURRENCIES: Record<string, string> = {
  'جنيه سوداني (SDG)': 'جنيه سوداني',
  'جنيه مصري (EGP)': 'جنيه مصري',
  'درهم إماراتي (AED)': 'درهم',
  'دولار أمريكي (USD)': 'دولار',
  'دينار أردني (JOD)': 'دينار أردني',
  'دينار بحريني (BHD)': 'دينار بحريني',
  'دينار كويتي (KWD)': 'دينار',
  'روبية باكستانية (PKR)': 'روبية باكستانية',
  'روبية هندية (INR)': 'روبية هندية',
  'ريال سعودي (SAR)': 'ريال',
  'ريال عماني (OMR)': 'ريال عماني',
  'ريال قطري (QAR)': 'ريال قطري',
  'ليرة سورية (SYP)': 'ليرة سورية',
  'ليرة لبنانية (LBP)': 'ليرة لبنانية',
  'يوان صيني (CNY)': 'يوان صيني',
  'يورو (EUR)': 'يورو',
}

/** ألوان وحدات الرئيسية (main.dart). */
export const MODULE_COLORS = {
  personal: '#0A5A50',
  shared: '#2B8CB0',
  people: '#6B6FC7',
  assets: '#D9902A',
} as const
