import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { extra } from '@/i18n/extra'

/*
  الترجمة كما في التطبيق: النص العربي هو المفتاح، ويُترجم وقت العرض فقط.
  القواميس مولَّدة من قواميس التطبيق نفسها (scripts/gen-i18n.mjs)، وما ليس
  فيها من نصوص الموقع الخاصة في i18n/extra.ts.
*/

export type Lang = 'ar' | 'en' | 'fr' | 'ur' | 'zh'

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'ar', label: 'العربية' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'ur', label: 'اردو' },
  { code: 'zh', label: '中文' },
]

const RTL: Lang[] = ['ar', 'ur']
const STORAGE_KEY = 'fundly-web-lang'

const loaders: Record<Exclude<Lang, 'ar'>, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import('@/i18n/en.json'),
  fr: () => import('@/i18n/fr.json'),
  ur: () => import('@/i18n/ur.json'),
  zh: () => import('@/i18n/zh.json'),
}

type Ctx = {
  lang: Lang
  dir: 'rtl' | 'ltr'
  setLang: (lang: Lang) => void
  t: (text: string) => string
}

const I18nContext = createContext<Ctx>({
  lang: 'ar',
  dir: 'rtl',
  setLang: () => {},
  t: (text) => text,
})

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null
    if (saved && LANGS.some((l) => l.code === saved)) return saved
  } catch {
    // التخزين غير متاح (وضع خاص في بعض المتصفحات): العربية.
  }
  return 'ar'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [dict, setDict] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    if (lang === 'ar') {
      setDict({})
    } else {
      loaders[lang]()
        .then((mod) => alive && setDict(mod.default))
        .catch(() => alive && setDict({}))
    }
    const dir = RTL.includes(lang) ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    return () => {
      alive = false
    }
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // لا شيء: تبقى اللغة لهذه الجلسة فقط.
    }
  }, [])

  const t = useCallback(
    (text: string) => {
      if (lang === 'ar' || !text) return text
      return dict[text] ?? extra[lang]?.[text] ?? text
    },
    [lang, dict],
  )

  const value = useMemo<Ctx>(
    () => ({ lang, dir: RTL.includes(lang) ? 'rtl' : 'ltr', setLang, t }),
    [lang, setLang, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)
