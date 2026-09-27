/**
 * 开放世界 · 统一导出
 */
export { default as PlayerController } from './PlayerController'
export { default as CameraRig } from './CameraRig'
export { default as WorldScene } from './WorldScene'
export { default as Interaction } from './Interaction'
export { default as Minimap } from './Minimap'
export { default as MobileControls, isTouchDevice } from './MobileControls'
export { default as SceneSelect } from './SceneSelect'
export { default as InteriorScene } from './interior/InteriorScene'
export { InteriorShell, buildInteriorColliders } from './interior/InteriorShell'
export { default as InteriorPlayer } from './interior/InteriorPlayer'
export { CollectibleMesh, CollectibleLayer } from './CollectibleMesh'

export * from './types'
export * from './config'
export * from './art-spec'
export * from './collectibles'
export { moveWithCollision, collidesAt } from './collision'
