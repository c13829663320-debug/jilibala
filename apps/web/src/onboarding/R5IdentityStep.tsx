import { useState } from 'react'
import { useIdentity } from '../identity'

export type R5IdentityStepProps = {
  /** 确认昵称后继续。 */
  onDone: (nickname: string) => void
  /** 跳过本步。 */
  onSkip: () => void
}

/**
 * R5 引导步骤 2 · 身份（精简为一步）。
 * 复用 identity.tsx 的 useIdentity：老用户已有昵称则预填，新用户可现场起名。
 * 只问昵称一步，不再让选 3D 化身（零门槛）。
 */
export default function R5IdentityStep({ onDone, onSkip }: R5IdentityStepProps) {
  const { user } = useIdentity()
  const [nickname, setNickname] = useState(user?.nickname?.trim() || '')

  const submit = () => onDone(nickname.trim() || '我')

  return (
    <section className="r5ob" aria-label="起个昵称">
      <div className="r5ob__kicker">WHO ARE YOU</div>
      <h2 className="r5ob__title">怎么称呼<em>你？</em></h2>
      <p className="r5ob__sub">一个昵称就够，化身进入广场后随时能换。</p>

      <div className="r5ob__form">
        <input
          className="r5ob__input"
          value={nickname}
          maxLength={12}
          placeholder="给自己起个名字…"
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          aria-label="昵称"
        />
        <div className="r5ob__actions">
          <button type="button" className="r5ob__cta" onClick={submit}>就叫这个 →</button>
          <button type="button" className="r5ob__skip" onClick={onSkip}>跳过</button>
        </div>
      </div>
    </section>
  )
}
