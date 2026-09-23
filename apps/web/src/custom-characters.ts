// 自定义人物统一前端类型与 API 映射
// 前后端共用名人数据在 @balabala/shared；本文件把「预置名人」与「用户自定义人物」
// 统一成同一个 UiCharacter 视图类型，供人物馆 / 合议庭 / 酒吧 / 广场 / 化身选择复用。

import { CELEBRITIES, type Celebrity } from '@balabala/shared'

/** 统一视图人物：预置名人与自定义人物共用 */
export type UiCharacter = {
  id: string
  name: string
  title: string
  intro: string
  tags: string[]
  greeting: string
  /** 完整 URL，可直接 <img src> */
  portrait: string
  /** 完整 URL，可直接 GLTFLoader */
  model?: string
  /** 预置名人有领域/年代；自定义人物没有 */
  field?: string
  era?: string
  isCustom: boolean
  visibility?: 'private' | 'public'
  /** StepFun 官方预置音色 id（M13 第五轮） */
  voice?: string
  /** 自定义人物所属用户，用于判断是否 owner */
  userId?: string
}

/** 后端 /api/custom-characters 列表返回的原始记录（不含 persona） */
export type CustomCharacterApi = {
  id: string
  userId: string
  name: string
  title: string
  intro: string
  tags: string[]
  greeting: string
  modelPath?: string
  portraitPath?: string
  voice?: string
  visibility: 'private' | 'public'
  createdAt: string
  updatedAt: string
}

/**
 * 把后端存储路径转成可直接访问的资源 URL。
 * modelPath 形如 custom-characters/<id>/model.glb
 * portraitPath 形如 custom-characters/<id>/portrait.jpg
 */
export const assetUrl = (id: string, path: string): string => {
  const f = path.split('/').pop()
  return f ? `/api/custom-characters/assets/${id}/${f}` : ''
}

/** 预置名人 → UiCharacter */
export function celebrityToUi(c: Celebrity): UiCharacter {
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    intro: c.intro,
    tags: c.tags,
    greeting: c.greeting,
    portrait: c.portrait,
    model: c.model,
    field: c.field,
    era: c.era,
    isCustom: false,
    voice: c.voice,
  }
}

/** 自定义人物 API 记录 → UiCharacter */
export function customToUi(c: CustomCharacterApi): UiCharacter {
  return {
    id: c.id,
    userId: c.userId,
    name: c.name,
    title: c.title,
    intro: c.intro,
    tags: Array.isArray(c.tags) ? c.tags : [],
    greeting: c.greeting ?? '你好',
    portrait: c.portraitPath ? assetUrl(c.id, c.portraitPath) : '',
    model: c.modelPath ? assetUrl(c.id, c.modelPath) : undefined,
    isCustom: true,
    visibility: c.visibility,
    voice: c.voice,
  }
}

/** 预置名人全量列表 */
export function celebrityListToUi(): UiCharacter[] {
  return CELEBRITIES.map(celebrityToUi)
}

/** 拉取「我的人物」（仅当前用户的自定义人物） */
export async function fetchMyCharacters(userId: string): Promise<UiCharacter[]> {
  try {
    const r = await fetch(`/api/custom-characters/mine?userId=${encodeURIComponent(userId)}`)
    if (!r.ok) return []
    const d = (await r.json()) as { characters?: CustomCharacterApi[] }
    return (d.characters ?? []).map(customToUi)
  } catch {
    return []
  }
}

/** 拉取「广场人物」（仅公开的自定义人物） */
export async function fetchPublicCharacters(): Promise<UiCharacter[]> {
  try {
    const r = await fetch('/api/custom-characters/public')
    if (!r.ok) return []
    const d = (await r.json()) as { characters?: CustomCharacterApi[] }
    return (d.characters ?? []).map(customToUi)
  } catch {
    return []
  }
}
