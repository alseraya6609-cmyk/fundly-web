import { supabase } from './supabase'
import { emailFor, SignInError } from './session'
import { setStoreStrings } from './storeWrite'

/*
  إنشاء الحساب واستعادة كلمة المرور — مثل FundlyAccount في التطبيق
  (signUp / verifySignupCode / resendSignupCode / sendResetCode /
  resetWithCode) ونفس رسائل _authMessage.
*/

export class AccountError extends Error {}

const OFFLINE = 'تعذّر الاتصال بالخادم — تحقق من الإنترنت'

/** FundlyAccount._authMessage */
export function authMessage(error: unknown): string {
  const raw = String((error as { message?: string })?.message ?? error ?? '')
  const text = raw.toLowerCase()
  if (text.includes('invalid login') || text.includes('invalid credentials')) return 'بيانات الدخول أو كلمة المرور غير صحيحة'
  if (text.includes('banned')) return 'هذا الحساب موقوف من إدارة فَندلي — تواصل مع الدعم'
  if (text.includes('email not confirmed')) return 'البريد غير مفعّل بعد'
  if (text.includes('different from the old')) return 'كلمة المرور الجديدة يجب أن تختلف عن الحالية'
  if (text.includes('at least')) return 'كلمة المرور قصيرة — 6 أحرف على الأقل'
  if (text.includes('already registered') || text.includes('already exists')) return 'هذا البريد مسجّل مسبقًا — سجّل الدخول به'
  if (text.includes('security purposes')) return 'انتظر دقيقة ثم أعد إرسال الرمز'
  if (text.includes('rate limit') || text.includes('too many')) return 'محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة'
  if (text.includes('failed to fetch') || text.includes('network')) return OFFLINE
  return raw || 'حدث خطأ غير متوقع — حاول مرة أخرى'
}

/** الأرقام العربية ← لاتينية، بلا مسافات. */
const latinCode = (code: string) => code.replace(/\s/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

const nameParts = (value: string) => value.trim().split(/\s+/).filter(Boolean)

/** AppSettings.isValidNameParts: الاسم مطلوب، والقبيلة/العائلة اختيارية. */
export const isValidNameParts = (given: string) => given.trim().length >= 2

/** AppSettings.composeName: ثلاثي إن أمكن (الأول واسم الأب والقبيلة). */
export function composeName(given: string, family: string) {
  const parts = nameParts(given)
  const tribe = family.trim()
  if (!tribe) return parts.slice(0, 3).join(' ')
  return [...parts.slice(0, 2), tribe].join(' ')
}

/** a***@gmail.com */
export function maskEmail(email: string) {
  const at = email.indexOf('@')
  if (at <= 1) return email
  return `${email[0]}${'*'.repeat(Math.min(Math.max(at - 1, 1), 6))}${email.slice(at)}`
}

export type SignUpInput = { given: string; family: string; email: string; phone: string; password: string }

/**
 * يعيد true إن دخل مباشرة، وfalse إن احتاج البريد تفعيلًا بالرمز
 * (verifySignupCode). التحقق من الحقول في الواجهة قبله، كما في التطبيق.
 */
export async function signUpAccount(input: SignUpInput): Promise<boolean> {
  const name = composeName(input.given, input.family)
  const mail = input.email.trim().toLowerCase()
  if (!name.trim()) throw new AccountError('أدخل الاسم أولًا')
  if (!mail.includes('@') || !mail.includes('.')) throw new AccountError('صيغة البريد الإلكتروني غير صحيحة')
  if (input.password.length < 6) throw new AccountError('كلمة المرور قصيرة — 6 أحرف على الأقل')
  const phone = input.phone.trim()
  if (phone) {
    const { data: taken, error } = await supabase.rpc('fundly_login_email', { p_identifier: phone })
    if (error) throw new AccountError(authMessage(error))
    if (String(taken ?? '').trim()) throw new AccountError('رقم الهاتف مستخدم في حساب آخر')
  }
  const { data, error } = await supabase.auth.signUp({ email: mail, password: input.password, options: { data: { name: name.trim() } } })
  if (error) throw new AccountError(authMessage(error))
  if (!data.session) {
    // بريد مفعّل مسبقًا: لا يُرسل رمز ويعود مستخدم بلا هويات.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new AccountError('هذا البريد مسجّل مسبقًا — سجّل الدخول به')
    }
    return false
  }
  return true
}

/** تفعيل الحساب الجديد بالرمز المرسل إلى البريد (يدخل مباشرة). */
export async function verifySignupCode(email: string, code: string) {
  const token = latinCode(code)
  if (token.length < 6) throw new AccountError('أدخل الرمز المرسل إلى بريدك')
  const { data, error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'signup' })
  if (error) {
    if (authMessage(error) === OFFLINE) throw new AccountError(OFFLINE)
    throw new AccountError('الرمز غير صحيح أو انتهت صلاحيته')
  }
  if (!data.session) throw new AccountError('الرمز غير صحيح أو انتهت صلاحيته')
}

export async function resendSignupCode(email: string) {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() })
  if (error) throw new AccountError(authMessage(error))
}

/**
 * _finishSignUp: الملف الشخصي في بيانات المستخدم (كما يحفظه AppSettings)
 * وفي profiles (الاسم الظاهر والهاتف).
 */
export async function finishSignUp(input: SignUpInput) {
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) return
  const name = composeName(input.given, input.family)
  const phone = input.phone.trim()
  try {
    await setStoreStrings({
      settings_profile_name: name.trim(),
      settings_profile_phone: phone,
      settings_profile_email: input.email.trim().toLowerCase(),
      settings_profile_given_name: input.given.trim(),
      settings_profile_family_name: input.family.trim(),
    })
  } catch {
    // يُعاد من شاشة البيانات الشخصية في التطبيق.
  }
  try {
    await supabase.from('profiles').update({ display_name: name.trim(), phone }).eq('id', user.id)
  } catch {
    // يُعاد عند الحفظ التالي.
  }
}

/** نسيت كلمة المرور (1): يعيد البريد الذي أُرسل إليه الرمز. */
export async function sendResetCode(identifier: string): Promise<string> {
  const input = identifier.trim()
  if (!input) throw new AccountError('أدخل البريد أو رقم الهاتف أو الرقم التعريفي')
  let email: string
  try {
    email = await emailFor(input)
  } catch (err) {
    if (err instanceof SignInError) throw new AccountError(err.message)
    throw new AccountError(OFFLINE)
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error) throw new AccountError(authMessage(error))
  return email
}

/** نسيت كلمة المرور (2): الرمز ثم كلمة المرور الجديدة، ويدخل مباشرة. */
export async function resetWithCode(email: string, code: string, newPassword: string) {
  const token = latinCode(code)
  if (token.length < 6) throw new AccountError('أدخل الرمز المرسل إلى بريدك')
  if (newPassword.length < 6) throw new AccountError('كلمة المرور قصيرة — 6 أحرف على الأقل')
  // تحقّق الرمز في محاولة سابقة وفشل تغيير الكلمة فقط: لا يُطلب الرمز مرة ثانية.
  const { data: current } = await supabase.auth.getSession()
  const verified = current.session?.user?.email?.toLowerCase() === email.toLowerCase()
  const { error } = verified ? { error: null } : await supabase.auth.verifyOtp({ email, token, type: 'recovery' })
  if (error) {
    if (authMessage(error) === OFFLINE) throw new AccountError(OFFLINE)
    throw new AccountError('الرمز غير صحيح أو انتهت صلاحيته')
  }
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
  if (updateError) throw new AccountError(authMessage(updateError))
}
