// 订阅玩家档案变化：进入个人页 / 结算上报后自动刷新。
import { useCallback, useEffect, useState } from 'react'
import { ensureProfile, loadProfile, type PlayerProfile } from './playerProfile'
import { useIdentity } from '../identity'

const EVENT = 'balabala:game-reported'

/**
 * 读取当前玩家档案并订阅更新。身份就绪后会 ensure 一份本地档案，
 * 之后每次场景结算上报（submitGameResult）派发事件时自动重载。
 */
export function usePlayerProfile() {
  const { user } = useIdentity()
  const [profile, setProfile] = useState<PlayerProfile | null>(() => loadProfile())

  const refresh = useCallback(() => setProfile(loadProfile()), [])

  useEffect(() => {
    if (!user) return
    // 用线上身份的昵称/化身兜底一份本地档案（不覆盖已存在的战绩）。
    const p = ensureProfile(user.nickname, user.avatarType)
    setProfile(p)
  }, [user?.userId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onChange = () => refresh()
    window.addEventListener(EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [refresh])

  return profile
}
