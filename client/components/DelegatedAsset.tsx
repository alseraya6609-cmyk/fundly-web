import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, UserX } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { Asset } from '@/lib/data'
import { setAnswer } from '@/lib/delegations'
import { DELEGATED_LABEL, ownerOf, plainPermissions, type DelegatedAsset } from '@/lib/delegatedAssets'
import { Confirm } from './Confirm'

/*
  «صلاحيات التفويض» (_delegationSummaryCard) لعنصر فوّضني صاحبه بإدارته:
  من فوّضني، والوحدات إن كان التفويض على وحدات، والصلاحيات مرقّمة —
  و«إلغاء التفويض» من عندي (_withdrawFromDelegation).
*/

const DELEGATED_COLOR = '#6A4C93'

export function DelegationCard({ asset, delegation, onWithdrawn }: { asset: Asset; delegation: DelegatedAsset; onWithdrawn: (message: string) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owner = ownerOf(delegation)
  const perms = plainPermissions(delegation)

  async function withdraw() {
    setBusy(true)
    setError('')
    try {
      for (const id of delegation.delegationIds) await setAnswer(id, 'withdrawn')
      await qc.invalidateQueries({ queryKey: ['assets'] })
      await qc.invalidateQueries({ queryKey: ['delegations'] })
      setAsking(false)
      onWithdrawn(`${t('تم إلغاء التفويض وإشعار')} ${owner}`)
    } catch {
      setError('تعذّر إلغاء التفويض. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-inner border px-4 py-3" style={{ borderColor: `${DELEGATED_COLOR}55`, background: `${DELEGATED_COLOR}0D` }}>
      <p className="flex items-center gap-1.5 text-[14px] font-black" style={{ color: DELEGATED_COLOR }}>
        <ShieldCheck className="size-4" />
        {t('صلاحيات التفويض')}
      </p>
      <p dir="auto" className="mt-1.5 text-[13px] font-extrabold text-title">
        {t(DELEGATED_LABEL)} — {t('من')}: {owner}
      </p>
      {!delegation.wholeAsset && delegation.unitRefs.length > 0 && (
        <p dir="auto" className="mt-1 text-[12px] text-sub">
          {t('الوحدات')}: {delegation.unitRefs.join('، ')}
        </p>
      )}
      {perms.length > 0 && (
        <ol className="mt-1.5 flex flex-col gap-0.5 text-[12px] text-sub">
          {perms.map((p, i) => (
            <li key={p}>
              {i + 1}. {t(p)}
            </li>
          ))}
        </ol>
      )}
      {delegation.delegationIds.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setError('')
            setAsking(true)
          }}
          className="mt-3 flex h-10 items-center gap-1.5 rounded-inner border border-danger px-3 text-[12.5px] font-extrabold text-danger hover:bg-danger-soft"
        >
          <UserX className="size-4" />
          {t('إلغاء التفويض')}
        </button>
      )}
      <Confirm
        open={asking}
        title="إلغاء التفويض"
        message={`${t('ستتوقف عن إدارة')} «${asset.title}» ${t('فورًا، ويصل لصاحبه إشعار بإلغائك للتفويض. تستطيع العودة إليه من «المزيد ← التفويضات ← أشخاص فوّضوني» ما دام صاحبه لم يُنهِه. هل تريد المتابعة؟')}`}
        confirmLabel="إلغاء التفويض"
        danger
        busy={busy}
        error={error}
        onConfirm={withdraw}
        onCancel={() => setAsking(false)}
      />
    </div>
  )
}
