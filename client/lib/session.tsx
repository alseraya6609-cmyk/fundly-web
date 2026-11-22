import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, errorText } from './supabase'

/*
  الدخول وبوابات الحساب، بنفس منطق التطبيق ولوحة التحكم:
  - الدخول بالبريد أو الهاتف أو الرقم التعريفي FND (fundly_login_email).
  - حساب لوحة التحكم لا يدخل (fundly_is_admin_account).
  - الصيانة من لوحة التحكم (fundly_app_config)، والمختبرون يتجاوزونها.
  - تجميد/إيقاف/إخراج من كل الأجهزة (fundly_my_account_status).
  - الموافقة على إصدار السياسة الحالي (fundly_policy_accepted / accept).
  - الأقسام التي أخفتها الإدارة (fundly_hidden_for_me).
*/

export const WEB_VERSION = '1.0.0'

export type Profile = { fnd_id: string; display_name: string; phone: string }

export type AppConfig = {
  maintenance: boolean
  maintenance_message: string
  tester: boolean
  policy_version: string
  policy_note: string
  ios_url: string
  android_url: string
}

export type AccountState = { frozen: boolean; suspended: boolean; reason: string; suspended_until?: string }

type Ctx = {
  ready: boolean
  user: User | null
  profile: Profile | null
  config: AppConfig | null
  account: AccountState | null
  policyAccepted: boolean
  hidden: Set<string>
  signIn: (identifier: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  acceptPolicy: () => Promise<void>
  refresh: () => Promise<void>
}

const SessionContext = createContext<Ctx | null>(null)

export class SignInError extends Error {}

function methodOf(input: string): 'email' | 'id' | 'phone' {
  const text = input.trim().toUpperCase()
  if (text.includes('@')) return 'email'
  if (text.startsWith('FND')) return 'id'
  return 'phone'
}

async function emailFor(input: string): Promise<string> {
  const method = methodOf(input)
  if (method === 'email') return input.trim().toLowerCase()
  const { data, error } = await supabase.rpc('fundly_login_email', { p_identifier: input.trim() })
  if (error) throw new SignInError(errorText(error))
  const email = String(data ?? '').trim()
  if (!email) {
    throw new SignInError(
      method === 'id'
        ? 'لا يوجد حساب بهذا الرقم التعريفي'
        : 'لا يوجد حساب بهذا الرقم — أضف رقمك في البيانات الشخصية بعد الدخول بالبريد',
    )
  }
  return email
}

async function loadConfig(): Promise<AppConfig | null> {
  const { data, error } = await supabase.rpc('fundly_app_config')
  if (error || !data || typeof data !== 'object') return null
  const c = data as Record<string, unknown>
  const text = (k: string) => String(c[k] ?? '').trim()
  return {
    maintenance: c.maintenance === true && c.tester !== true,
    maintenance_message: text('maintenance_message'),
    tester: c.tester === true,
    policy_version: text('policy_version'),
    policy_note: text('policy_note'),
    ios_url: text('ios_url'),
    android_url: text('android_url'),
  }
}

async function loadAccount(user: User): Promise<{ state: AccountState; forcedOut: boolean } | null> {
  const { data, error } = await supabase.rpc('fundly_my_account_status')
  if (error || !data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  const signOutAt = r.signout_at ? new Date(String(r.signout_at)) : null
  const signedInAt = user.last_sign_in_at ? new Date(user.last_sign_in_at) : null
  return {
    state: {
      frozen: r.frozen === true,
      suspended: r.suspended === true,
      reason: String(r.reason ?? '').trim(),
      suspended_until: r.suspended_until ? String(r.suspended_until) : undefined,
    },
    forcedOut: !!signOutAt && !!signedInAt && signOutAt > signedInAt,
  }
}

async function loadHidden(): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('fundly_hidden_for_me')
  if (error || !Array.isArray(data)) return new Set()
  return new Set(
    data.map((row: unknown) =>
      row && typeof row === 'object' ? String(Object.values(row as object)[0]) : String(row),
    ),
  )
}

async function loadProfile(user: User): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('fnd_id, display_name, phone')
    .eq('id', user.id)
    .maybeSingle()
  return (data as Profile) ?? null
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [account, setAccount] = useState<AccountState | null>(null)
  const [policyAccepted, setPolicyAccepted] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const load = useCallback(async (current: User | null) => {
    const cfg = await loadConfig()
    setConfig(cfg)
    if (!current) {
      setProfile(null)
      setAccount(null)
      setPolicyAccepted(true)
      setHidden(new Set())
      return
    }
    const [acc, prof, hid] = await Promise.all([loadAccount(current), loadProfile(current), loadHidden()])
    if (acc?.forcedOut) {
      // أخرجته الإدارة من كل أجهزته: الدخول من جديد يجعل آخر دخول أحدث.
      await supabase.auth.signOut()
      setUser(null)
      return
    }
    setAccount(acc?.state ?? { frozen: false, suspended: false, reason: '' })
    setProfile(prof)
    setHidden(hid)
    const version = cfg?.policy_version ?? ''
    if (!version) {
      setPolicyAccepted(true)
    } else {
      const { data, error } = await supabase.rpc('fundly_policy_accepted', { p_version: version })
      // بلا اتصال أو قبل تشغيل ملف SQL: لا يُمنع شيء، مثل التطبيق.
      setPolicyAccepted(error ? true : data === true)
    }
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      const current = data.session?.user ?? null
      if (!alive) return
      setUser(current)
      await load(current).catch(() => {})
      if (alive) setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') setUser(null)
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') setUser(session?.user ?? null)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [load])

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const input = identifier.trim()
      const method = methodOf(input)
      if (!input) {
        throw new SignInError(
          method === 'phone' ? 'أدخل البريد الإلكتروني أو الرقم التعريفي أو رقم الهاتف' : 'أدخل البريد الإلكتروني',
        )
      }
      if (!password) throw new SignInError('أدخل كلمة المرور')
      const email = await emailFor(input)
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new SignInError(errorText(error))
      const { data: admin } = await supabase.rpc('fundly_is_admin_account')
      if (admin === true) {
        await supabase.auth.signOut()
        throw new SignInError('هذا الحساب مخصص للوحة التحكم ولا يُستخدم في التطبيق')
      }
      setUser(data.user)
      await load(data.user)
    },
    [load],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setAccount(null)
  }, [])

  const acceptPolicy = useCallback(async () => {
    const version = config?.policy_version ?? ''
    if (!version) return
    const { error } = await supabase.rpc('fundly_accept_policy', {
      p_version: version,
      p_platform: 'web',
      p_app_version: `web ${WEB_VERSION}`,
    })
    if (error) throw new Error(errorText(error))
    setPolicyAccepted(true)
  }, [config])

  const refresh = useCallback(() => load(user), [load, user])

  const value = useMemo<Ctx>(
    () => ({ ready, user, profile, config, account, policyAccepted, hidden, signIn, signOut, acceptPolicy, refresh }),
    [ready, user, profile, config, account, policyAccepted, hidden, signIn, signOut, acceptPolicy, refresh],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession خارج SessionProvider')
  return ctx
}

/** مثل AdminVisibility.moduleHidden في التطبيق. */
export function moduleHidden(hidden: Set<string>, page: string) {
  return hidden.has(`module:${page}`)
}
