/* مولَّد من التطبيق (personal_commitments_screen.dart ← _financialEntryForms
   وجداول التصنيفات) بالسكربت scripts/gen-forms.py، لا يُعدَّل يدويًا. */

export type FieldKind = 'text' | 'number' | 'date' | 'time' | 'multiline' | 'secret' | 'select' | 'toggle' | 'header'
export type FormField = {
  label: string
  kind: FieldKind
  required?: boolean
  isPrimary?: boolean
  isTitle?: boolean
  isAmount?: boolean
  allowCustom?: boolean
  half?: boolean
  hidden?: boolean
  options?: string[]
  hint?: string
  display?: string
}
export type EntryForm = { label: string; subtitle: string; fields: FormField[] }

export const FORMS: Record<string, EntryForm> = {
  "المصروفات الشخصية": {
    "label": "المصروفات الشخصية",
    "subtitle": "تسجيل المصروف وتصنيفه وتفاصيل الدفع",
    "fields": [
      {
        "label": "المبلغ",
        "kind": "number",
        "required": true,
        "isPrimary": true,
        "isAmount": true
      },
      {
        "label": "التصنيف الرئيسي",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "طعام ومشروبات",
          "مواصلات",
          "إيجار",
          "دفع فواتير",
          "صحة",
          "تعليم",
          "تسوق",
          "مغسلة وكوي (مصبغة)",
          "ترفيه",
          "سفر",
          "سيارة",
          "غرامات (عام)",
          "رسوم بنكية",
          "سداد قروض",
          "سداد أقساط",
          "خدمات حكومية",
          "مصروفات أخرى"
        ]
      },
      {
        "label": "التصنيف الفرعي",
        "kind": "select",
        "isPrimary": true,
        "allowCustom": true
      },
      {
        "label": "التاريخ",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "الوقت",
        "kind": "time",
        "isPrimary": true,
        "half": true
      },
      {
        "label": "العنوان",
        "kind": "text",
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "الملاحظات",
        "kind": "multiline",
        "isPrimary": true
      },
      {
        "label": "تفعيل عملية متكررة",
        "kind": "toggle"
      },
      {
        "label": "التكرار",
        "kind": "select",
        "half": true,
        "options": [
          "يومي",
          "أسبوعي",
          "شهري",
          "سنوي"
        ]
      },
      {
        "label": "اليوم",
        "kind": "select",
        "allowCustom": true,
        "half": true,
        "options": [
          "نفس يوم العملية",
          "السبت",
          "الأحد",
          "الاثنين",
          "الثلاثاء",
          "الأربعاء",
          "الخميس",
          "الجمعة",
          "أول الشهر",
          "منتصف الشهر",
          "آخر الشهر"
        ]
      },
      {
        "label": "جهة الصرف",
        "kind": "text",
        "half": true
      },
      {
        "label": "طريقة الدفع",
        "kind": "select",
        "allowCustom": true,
        "half": true,
        "options": [
          "نقداً",
          "بطاقة بنكية",
          "تحويل بنكي",
          "محفظة إلكترونية"
        ]
      },
      {
        "label": "الموقع الجغرافي",
        "kind": "text",
        "hidden": true
      }
    ]
  },
  "إيراد": {
    "label": "إيراد",
    "subtitle": "دخل مالي مع تصنيف رئيسي وفرعي",
    "fields": [
      {
        "label": "المبلغ",
        "kind": "number",
        "required": true,
        "isPrimary": true,
        "isAmount": true
      },
      {
        "label": "التصنيف الرئيسي",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "الراتب/معاش",
          "تعويض واسترجاع مصروف",
          "كاش باك"
        ]
      },
      {
        "label": "التصنيف الفرعي",
        "kind": "select",
        "isPrimary": true,
        "allowCustom": true
      },
      {
        "label": "التاريخ",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "الوقت",
        "kind": "time",
        "isPrimary": true,
        "half": true
      },
      {
        "label": "العنوان",
        "kind": "text",
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "الملاحظات",
        "kind": "multiline",
        "isPrimary": true
      },
      {
        "label": "تفعيل عملية متكررة",
        "kind": "toggle"
      },
      {
        "label": "التكرار",
        "kind": "select",
        "half": true,
        "options": [
          "يومي",
          "أسبوعي",
          "شهري",
          "سنوي"
        ]
      },
      {
        "label": "اليوم",
        "kind": "select",
        "allowCustom": true,
        "half": true,
        "options": [
          "نفس يوم العملية",
          "السبت",
          "الأحد",
          "الاثنين",
          "الثلاثاء",
          "الأربعاء",
          "الخميس",
          "الجمعة",
          "أول الشهر",
          "منتصف الشهر",
          "آخر الشهر"
        ]
      },
      {
        "label": "جهة الصرف",
        "kind": "text",
        "half": true
      },
      {
        "label": "طريقة الدفع",
        "kind": "select",
        "allowCustom": true,
        "half": true,
        "options": [
          "نقداً",
          "بطاقة بنكية",
          "تحويل بنكي",
          "محفظة إلكترونية"
        ]
      },
      {
        "label": "الموقع الجغرافي",
        "kind": "text",
        "hidden": true
      }
    ]
  },
  "تحويل مالي": {
    "label": "تحويل مالي",
    "subtitle": "تحويل مبلغ من حساب أو جهة إلى أخرى",
    "fields": [
      {
        "label": "المبلغ",
        "kind": "number",
        "required": true,
        "isPrimary": true,
        "isAmount": true
      },
      {
        "label": "تحويل من",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true,
        "half": true,
        "hint": "مثال: حسابي البنكي"
      },
      {
        "label": "تحويل إلى",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "half": true,
        "hint": "مثال: حساب التوفير"
      },
      {
        "label": "التاريخ",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "الوقت",
        "kind": "time",
        "isPrimary": true,
        "half": true
      },
      {
        "label": "الملاحظات",
        "kind": "multiline",
        "isPrimary": true
      },
      {
        "label": "تفعيل عملية متكررة",
        "kind": "toggle"
      },
      {
        "label": "التكرار",
        "kind": "select",
        "half": true,
        "options": [
          "يومي",
          "أسبوعي",
          "شهري",
          "سنوي"
        ]
      },
      {
        "label": "اليوم",
        "kind": "select",
        "allowCustom": true,
        "half": true,
        "options": [
          "نفس يوم العملية",
          "السبت",
          "الأحد",
          "الاثنين",
          "الثلاثاء",
          "الأربعاء",
          "الخميس",
          "الجمعة",
          "أول الشهر",
          "منتصف الشهر",
          "آخر الشهر"
        ]
      },
      {
        "label": "رقم الإيصال",
        "kind": "text"
      },
      {
        "label": "اسم البنك",
        "kind": "text",
        "half": true
      },
      {
        "label": "طريقة الدفع",
        "kind": "select",
        "allowCustom": true,
        "half": true,
        "options": [
          "نقداً",
          "بطاقة بنكية",
          "تحويل بنكي",
          "محفظة إلكترونية"
        ]
      }
    ]
  },
  "غرامة": {
    "label": "غرامة",
    "subtitle": "غرامة أو مخالفة مالية",
    "fields": [
      {
        "label": "مبلغ الغرامة",
        "kind": "number",
        "required": true,
        "isPrimary": true,
        "isAmount": true
      },
      {
        "label": "التصنيف الرئيسي",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "غرامات"
        ]
      },
      {
        "label": "التصنيف الفرعي",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "isTitle": true,
        "allowCustom": true
      },
      {
        "label": "الجهة",
        "kind": "text",
        "isPrimary": true
      },
      {
        "label": "تاريخ الغرامة",
        "kind": "date",
        "required": true,
        "isPrimary": true
      },
      {
        "label": "الملاحظات",
        "kind": "multiline",
        "isPrimary": true
      },
      {
        "label": "رقم المخالفة",
        "kind": "text"
      }
    ]
  },
  "مستند": {
    "label": "مستند",
    "subtitle": "وثيقة أو عقد أو ملف مهم",
    "fields": [
      {
        "label": "اسم المستند",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "نوع المستند",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "هوية",
          "جواز سفر",
          "اقامة وتأشيرة",
          "رخصة قيادة",
          "ملكية سيارة",
          "تأمين سيارة",
          "تأمين صحي",
          "مستند دراسي",
          "مستند سفر",
          "مستند بنكي",
          "تقرير طبي",
          "تصاريح",
          "ضمانات",
          "فواتير",
          "ايصالات"
        ]
      },
      {
        "label": "رقم المستند",
        "kind": "text",
        "isPrimary": true
      },
      {
        "label": "الجهة المصدرة",
        "kind": "text",
        "isPrimary": true
      },
      {
        "label": "تاريخ الإصدار",
        "kind": "date",
        "isPrimary": true
      },
      {
        "label": "تاريخ الانتهاء",
        "kind": "date",
        "required": true,
        "isPrimary": true
      },
      {
        "label": "تذكير",
        "kind": "select",
        "isPrimary": true,
        "options": [
          "بدون تذكير",
          "قبل أسبوع",
          "قبل شهر",
          "قبل شهرين"
        ],
        "hint": "تذكير قبل تاريخ الانتهاء"
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "مهمة": {
    "label": "مهمة",
    "subtitle": "متابعة وتخطيط مهمة شخصية",
    "fields": [
      {
        "label": "العنوان",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "الوصف",
        "kind": "multiline",
        "isPrimary": true,
        "hint": "#auto"
      },
      {
        "label": "التاريخ",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "الوقت",
        "kind": "time",
        "isPrimary": true,
        "half": true
      },
      {
        "label": "تفعيل تذكير",
        "kind": "toggle",
        "isPrimary": true
      },
      {
        "label": "وقت التذكير",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "قبل يوم",
          "قبل 12 ساعة",
          "قبل ساعة",
          "مخصص بالساعات",
          "مخصص بالأيام"
        ]
      },
      {
        "label": "التكرار",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "بدون تكرار",
          "يومي",
          "أسبوعي",
          "شهري",
          "مخصص"
        ]
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "موعد": {
    "label": "موعد",
    "subtitle": "موعد شخصي مع تكرار وتذكيرات",
    "fields": [
      {
        "label": "العنوان",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "الوصف",
        "kind": "multiline",
        "isPrimary": true,
        "hint": "#auto"
      },
      {
        "label": "التاريخ",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "الوقت",
        "kind": "time",
        "isPrimary": true,
        "half": true
      },
      {
        "label": "تفعيل تذكير",
        "kind": "toggle",
        "isPrimary": true
      },
      {
        "label": "وقت التذكير",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "قبل يوم",
          "قبل 12 ساعة",
          "قبل ساعة",
          "مخصص بالساعات",
          "مخصص بالأيام"
        ]
      },
      {
        "label": "التكرار",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "بدون تكرار",
          "يومي",
          "أسبوعي",
          "شهري",
          "مخصص"
        ]
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "عادة": {
    "label": "عادة",
    "subtitle": "عادة متكررة للمتابعة اليومية أو الأسبوعية",
    "fields": [
      {
        "label": "العنوان",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "الوصف",
        "kind": "multiline",
        "isPrimary": true,
        "hint": "#auto"
      },
      {
        "label": "التاريخ",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "الوقت",
        "kind": "time",
        "isPrimary": true,
        "half": true
      },
      {
        "label": "تفعيل تذكير",
        "kind": "toggle",
        "isPrimary": true
      },
      {
        "label": "وقت التذكير",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "قبل يوم",
          "قبل 12 ساعة",
          "قبل ساعة",
          "مخصص بالساعات",
          "مخصص بالأيام"
        ]
      },
      {
        "label": "التكرار",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "بدون تكرار",
          "يومي",
          "أسبوعي",
          "شهري",
          "مخصص"
        ]
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "تذكير": {
    "label": "تذكير",
    "subtitle": "تذكير بموعد أو التزام",
    "fields": [
      {
        "label": "العنوان",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "الوصف",
        "kind": "multiline",
        "isPrimary": true,
        "hint": "#auto"
      },
      {
        "label": "التاريخ",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "الوقت",
        "kind": "time",
        "isPrimary": true,
        "half": true
      },
      {
        "label": "تفعيل تذكير",
        "kind": "toggle",
        "isPrimary": true
      },
      {
        "label": "وقت التذكير",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "قبل يوم",
          "قبل 12 ساعة",
          "قبل ساعة",
          "مخصص بالساعات",
          "مخصص بالأيام"
        ]
      },
      {
        "label": "التكرار",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "بدون تكرار",
          "يومي",
          "أسبوعي",
          "شهري",
          "مخصص"
        ]
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "ملاحظات": {
    "label": "ملاحظات",
    "subtitle": "ملاحظة أو فكرة تحتاج متابعة",
    "fields": [
      {
        "label": "العنوان",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "الوصف",
        "kind": "multiline",
        "isPrimary": true,
        "hint": "#auto"
      },
      {
        "label": "التاريخ",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "الوقت",
        "kind": "time",
        "isPrimary": true,
        "half": true
      },
      {
        "label": "تفعيل تذكير",
        "kind": "toggle",
        "isPrimary": true
      },
      {
        "label": "وقت التذكير",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "قبل يوم",
          "قبل 12 ساعة",
          "قبل ساعة",
          "مخصص بالساعات",
          "مخصص بالأيام"
        ]
      },
      {
        "label": "التكرار",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "بدون تكرار",
          "يومي",
          "أسبوعي",
          "شهري",
          "مخصص"
        ]
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "كلمات سر": {
    "label": "كلمات سر",
    "subtitle": "حفظ بيانات الحسابات وكلمات السر",
    "fields": [
      {
        "label": "اسم الحساب",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "نوع الحساب",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "إيميلات",
          "حسابات بنكية",
          "تطبيقات"
        ]
      },
      {
        "label": "اسم المستخدم",
        "kind": "text",
        "required": true,
        "isPrimary": true
      },
      {
        "label": "كلمة السر",
        "kind": "secret",
        "required": true,
        "isPrimary": true
      },
      {
        "label": "الرابط",
        "kind": "text",
        "isPrimary": true
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "مناسبة": {
    "label": "مناسبة",
    "subtitle": "تسجيل مناسبة وما يرتبط بها",
    "fields": [
      {
        "label": "النوع",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "عيد ميلاد",
          "ذكرى زواج / خطوبة",
          "تخرج",
          "وظيفة جديدة",
          "مناسبة عائلية",
          "مناسبة دينية"
        ]
      },
      {
        "label": "العنوان",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "تاريخ المناسبة",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "تذكيرات",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "بدون تذكير",
          "قبل يوم",
          "قبل أسبوع",
          "قبل أسبوعين",
          "مخصص"
        ]
      },
      {
        "label": "رقم الهاتف",
        "kind": "text",
        "isPrimary": true
      },
      {
        "label": "تكرار",
        "kind": "select",
        "allowCustom": true,
        "options": [
          "بدون تكرار",
          "سنوي",
          "شهري",
          "أسبوعي"
        ]
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "اشتراك": {
    "label": "اشتراك",
    "subtitle": "اشتراك دوري أو خدمة متكررة",
    "fields": [
      {
        "label": "الاسم",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "النوع",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "قنوات تلفزيونية",
          "الهاتف والإنترنت",
          "التطبيقات",
          "خصومات"
        ]
      },
      {
        "label": "المبلغ",
        "kind": "number",
        "required": true,
        "isPrimary": true,
        "isAmount": true
      },
      {
        "label": "التكرار",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "شهري",
          "ربع سنوي",
          "نصف سنوي",
          "سنوي",
          "شهر أختاره"
        ]
      },
      {
        "label": "تاريخ الاستحقاق",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "تذكيرات",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "بدون تذكير",
          "قبل يوم",
          "قبل أسبوع",
          "قبل أسبوعين",
          "مخصص"
        ]
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "هدية": {
    "label": "هدية",
    "subtitle": "هدية مرتبطة بمناسبة",
    "fields": [
      {
        "label": "النوع",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "عيد ميلاد",
          "ذكرى زواج / خطوبة",
          "تخرج",
          "وظيفة جديدة",
          "مناسبة عائلية",
          "مناسبة دينية"
        ]
      },
      {
        "label": "العنوان",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "أهمية المناسبة",
        "kind": "select",
        "isPrimary": true,
        "options": [
          "عادية",
          "مهمة",
          "مهمة جداً"
        ]
      },
      {
        "label": "تاريخ المناسبة",
        "kind": "date",
        "required": true,
        "isPrimary": true,
        "half": true
      },
      {
        "label": "تذكيرات",
        "kind": "select",
        "isPrimary": true,
        "half": true,
        "options": [
          "بدون تذكير",
          "قبل يوم",
          "قبل أسبوع",
          "قبل أسبوعين",
          "مخصص"
        ]
      },
      {
        "label": "رقم الهاتف",
        "kind": "text",
        "isPrimary": true
      },
      {
        "label": "تكرار",
        "kind": "select",
        "allowCustom": true,
        "options": [
          "بدون تكرار",
          "سنوي",
          "شهري",
          "أسبوعي"
        ]
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  },
  "مواقع وأماكن": {
    "label": "مواقع وأماكن",
    "subtitle": "حفظ مكان مهم وبيانات الوصول إليه",
    "fields": [
      {
        "label": "اسم المكان",
        "kind": "text",
        "required": true,
        "isPrimary": true,
        "isTitle": true
      },
      {
        "label": "الموقع أو الرابط",
        "kind": "text",
        "required": true,
        "isPrimary": true
      },
      {
        "label": "العنوان",
        "kind": "text",
        "isPrimary": true
      },
      {
        "label": "التصنيف",
        "kind": "select",
        "required": true,
        "isPrimary": true,
        "allowCustom": true,
        "options": [
          "المنزل",
          "العمل",
          "مطعم",
          "صديق",
          "عميل",
          "مهم"
        ]
      },
      {
        "label": "الموقع الجغرافي",
        "kind": "text",
        "hidden": true
      },
      {
        "label": "ملاحظات",
        "kind": "multiline"
      }
    ]
  }
}

export const EXPENSE_SUBCATEGORIES: Record<string, string[]> = {
  "طعام ومشروبات": [
    "بقالة وسوبرماركت",
    "مطاعم وكوفيهات",
    "توصيل وطلبات",
    "لحوم ودواجن",
    "خضروات وفواكه",
    "مخبوزات ومعجنات"
  ],
  "مواصلات": [
    "تطبيقات توصيل",
    "نقل عام وتاكسي"
  ],
  "إيجار": [],
  "دفع فواتير": [
    "إنترنت واتصالات",
    "تأمينات",
    "رسوم دراسية"
  ],
  "صحة": [
    "أدوية وصيدلية",
    "أطباء وأشعة",
    "تحاليل وفحوصات"
  ],
  "تعليم": [
    "مصروفات مدرسية",
    "دروس خصوصية",
    "دورات تدريبية",
    "كتب ومراجع"
  ],
  "تسوق": [
    "ملابس",
    "مستلزمات منزلية",
    "تسوق إلكتروني",
    "إلكترونيات",
    "عناية وجمال"
  ],
  "مغسلة وكوي (مصبغة)": [
    "عادي",
    "مستعجل"
  ],
  "ترفيه": [
    "رياضة وجيم",
    "ألعاب",
    "سينما"
  ],
  "سفر": [
    "فنادق وإقامة",
    "تذاكر ورسوم سفر"
  ],
  "سيارة": [
    "وقود",
    "مواقف ورسوم طرق",
    "صيانة وإصلاح",
    "قطع غيار",
    "إكسسوارات سيارات",
    "غسيل وتلميع",
    "مخالفات"
  ],
  "غرامات (عام)": [],
  "رسوم بنكية": [],
  "سداد قروض": [],
  "سداد أقساط": [],
  "خدمات حكومية": [],
  "مصروفات أخرى": []
}

export const INCOME_SUBCATEGORIES: Record<string, string[]> = {
  "الراتب/معاش": [
    "الراتب",
    "عمولات",
    "عمل إضافي"
  ],
  "تعويض واسترجاع مصروف": [],
  "كاش باك": []
}

export const FINE_SUBCATEGORIES: Record<string, string[]> = {
  "غرامات": [
    "مرور",
    "حكومية",
    "مالية",
    "تعاقدية",
    "خدمات"
  ]
}
