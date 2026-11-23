import { useMemo } from 'react'
import { useSession } from './session'
import { answerOf, isActive, isEnded, isIncoming, mainScopeOf, ownerNameOf, subScopesOf, targetsOf, useDelegations, fndOf, type Delegation } from './delegations'
import type { Asset } from './data'

/*
  تفويضاتي على العقارات والأنشطة والمركبات — مثل OutgoingDelegations و
  _loadOutgoingDelegations في التطبيق: وسم «فوّضت غيري بإدارته» على العنصر
  ووحداته عندي، ومعه «بانتظار القبول» حتى يقبله صاحب الرقم.
  وما وصلني ولم أقبله بعد (pendingIncoming) يظهر في صفحة الأصول حتى أقبله.
*/

const ASSET_SCOPES = new Set(['كل الأقسام', 'العقارات والأنشطة والمركبات'])
const RECEIVED_MARKER = 'dir:received'

/** DelegationTargets.subOfCategory */
const SUB_OF_CATEGORY: Record<string, string> = {
  real_estate: 'العقارات',
  business: 'الأنشطة التجارية',
  activity: 'الأنشطة التجارية',
  equipment: 'المركبات ووسائل النقل',
}

export type Outgoing = { delegateName: string; wholeAsset: boolean; unitRefs: Set<string>; pending: boolean }

export const OUTGOING_LABEL = 'فوّضت غيري بإدارته'
export const OUTGOING_PENDING_LABEL = 'فوّضت غيري بإدارته — بانتظار القبول'

/** خريطة: معرّف الأصل ← تفويضاتي عليه. */
export function useOutgoingDelegations(assets: Asset[] | undefined, isDelegatedToMe: (id: string) => boolean) {
  const { user } = useSession()
  const uid = user?.id ?? ''
  const q = useDelegations()
  return useMemo(() => {
    const map = new Map<string, Outgoing[]>()
    const add = (id: string, o: Outgoing) => map.set(id, [...(map.get(id) ?? []), o])
    for (const d of q.data ?? []) {
      if (isIncoming(d, uid) || (d.delegate_ref ?? '').startsWith(RECEIVED_MARKER)) continue
      if (!isActive(d)) continue
      const answer = answerOf(d.permissions)
      if (answer && answer !== 'accepted' && answer !== 'pending') continue
      const main = mainScopeOf(d.scope)
      if (!ASSET_SCOPES.has(main)) continue
      const name = d.delegate_name.trim() || fndOf(d.permissions)
      const pending = answer === 'pending'
      const targets = targetsOf(d.permissions)
      if (targets.length) {
        const units = new Map<string, Set<string>>()
        for (const t of targets) {
          if (t.kind === 'asset') add(t.id, { delegateName: name, wholeAsset: true, unitRefs: new Set(), pending })
          else if (t.kind === 'unit') {
            const cut = t.id.indexOf('#')
            if (cut <= 0) continue
            const id = t.id.slice(0, cut)
            units.set(id, new Set([...(units.get(id) ?? []), t.id.slice(cut + 1)]))
          }
        }
        units.forEach((refs, id) => add(id, { delegateName: name, wholeAsset: false, unitRefs: refs, pending }))
        continue
      }
      // القسم كاملًا أو فئة منه: كل عناصري في تلك الفئة.
      const subs = subScopesOf(d.scope)
      for (const a of assets ?? []) {
        if (isDelegatedToMe(a.id)) continue
        if (main === 'كل الأقسام' || !subs.length || subs.includes(SUB_OF_CATEGORY[a.category] ?? '')) {
          add(a.id, { delegateName: name, wholeAsset: true, unitRefs: new Set(), pending })
        }
      }
    }
    return map
  }, [q.data, uid, assets, isDelegatedToMe])
}

/** _delegationBadgeOf (جهة المالك). */
export function outgoingBadge(list: Outgoing[] | undefined): string | null {
  if (!list?.length) return null
  return list.every((o) => o.pending) ? OUTGOING_PENDING_LABEL : OUTGOING_LABEL
}

/** OutgoingDelegations.noteOf: «فوّضت غيري بإدارته — زين (بانتظار قبوله)». */
export function outgoingNote(list: Outgoing[] | undefined, t: (s: string) => string): string {
  if (!list?.length) return ''
  const shown = (o: Outgoing) => (o.pending ? `${o.delegateName} (${t('بانتظار قبوله')})` : o.delegateName)
  const whole = [...new Set(list.filter((o) => o.wholeAsset).map(shown))]
  const units = [...new Set(list.filter((o) => !o.wholeAsset).map(shown))]
  return [
    whole.length ? `${t('فوّضت غيري بإدارته')} — ${whole.join('، ')}` : '',
    units.length ? `${t('فوّضت غيري بإدارة وحدات منه')} — ${units.join('، ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** OutgoingDelegation.allowsUnit */
function allowsUnit(o: Outgoing, number: string, name: string, index: number) {
  if (o.wholeAsset) return true
  if (number.trim()) return o.unitRefs.has(number.trim())
  if (name.trim()) return o.unitRefs.has(name.trim())
  return index >= 0 && o.unitRefs.has(String(index))
}

/** وسم الوحدة: فُوِّضت بعينها (لا العقار كاملًا). */
export function unitOutgoingBadge(list: Outgoing[] | undefined, number: string, name: string, index: number): string | null {
  const own = (list ?? []).filter((o) => !o.wholeAsset && allowsUnit(o, number, name, index))
  if (!own.length) return null
  return own.every((o) => o.pending) ? OUTGOING_PENDING_LABEL : OUTGOING_LABEL
}

/** ما وصلني على العقارات والأنشطة والمركبات ولم أردّ عليه بعد. */
export function usePendingIncoming(): Delegation[] {
  const { user } = useSession()
  const uid = user?.id ?? ''
  const q = useDelegations()
  return useMemo(
    () =>
      (q.data ?? []).filter(
        (d) =>
          isIncoming(d, uid) &&
          !isEnded(d) &&
          !(d.delegate_ref ?? '').startsWith(RECEIVED_MARKER) &&
          ['', 'pending'].includes(answerOf(d.permissions)) &&
          ASSET_SCOPES.has(mainScopeOf(d.scope)),
      ),
    [q.data, uid],
  )
}

/** على ماذا التفويض: أسماء العناصر، وإلا الفئات أو القسم. */
export function incomingTargetsText(d: Delegation, t: (s: string) => string): string {
  const labels = targetsOf(d.permissions)
    .filter((x) => x.kind === 'asset' || x.kind === 'unit')
    .map((x) => `«${x.label}»`)
  if (labels.length) return labels.join('، ')
  const subs = subScopesOf(d.scope)
  return subs.length ? subs.map(t).join('، ') : t(mainScopeOf(d.scope))
}

export const incomingOwnerName = (d: Delegation) => ownerNameOf(d.permissions)
