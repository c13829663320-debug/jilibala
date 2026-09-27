import { describe, expect, it } from 'vitest'
import { matchScenePath, pathToView, SCENE_IDS, viewToPath } from './routes'

describe('pathToView', () => {
  it('根路径与 /plaza 都落到广场', () => {
    expect(pathToView('/')).toBe('plaza')
    expect(pathToView('/plaza')).toBe('plaza')
  })
  it('三大主页面路径正确解析', () => {
    expect(pathToView('/celebrities')).toBe('celebrities')
    expect(pathToView('/scenes')).toBe('scenes')
    expect(pathToView('/entry')).toBe('entry')
    expect(pathToView('/mypage')).toBe('mypage')
  })
  it('/scene/:id 解析为对应场景视图', () => {
    expect(pathToView('/scene/court')).toBe('court')
    expect(pathToView('/scene/talkshow')).toBe('talkshow')
    expect(pathToView('/scene/werewolf')).toBe('werewolf')
    expect(pathToView('/scene/bar')).toBe('bar')
    expect(pathToView('/scene/gym')).toBe('gym')
    expect(pathToView('/scene/library')).toBe('library')
  })
  it('studio 子路径解析', () => {
    expect(pathToView('/studio/avatar')).toBe('avatar')
    expect(pathToView('/studio/custom')).toBe('custom-studio')
    expect(pathToView('/studio/video')).toBe('video')
  })
  it('非法场景 id 与未知路径返回 null', () => {
    expect(pathToView('/scene/nope')).toBeNull()
    expect(pathToView('/totally/unknown')).toBeNull()
  })
})

describe('matchScenePath', () => {
  it('识别六大合法场景', () => {
    for (const id of SCENE_IDS) expect(matchScenePath(`/scene/${id}`)).toBe(id)
  })
  it('拒绝非法场景 id', () => {
    expect(matchScenePath('/scene/bedroom')).toBeNull()
    expect(matchScenePath('/plaza')).toBeNull()
  })
})

describe('viewToPath 往返', () => {
  it('可路由视图能还原成路径', () => {
    expect(viewToPath('plaza')).toBe('/plaza')
    expect(viewToPath('celebrities')).toBe('/celebrities')
    expect(viewToPath('scenes')).toBe('/scenes')
    for (const id of SCENE_IDS) expect(viewToPath(id)).toBe(`/scene/${id}`)
  })
  it('不可路由视图（onboarding/archive 等）返回 null，不污染地址栏', () => {
    expect(viewToPath('onboarding-interest')).toBeNull()
    expect(viewToPath('archive')).toBeNull()
    expect(viewToPath('multiplayer-lobby')).toBeNull()
  })
})
