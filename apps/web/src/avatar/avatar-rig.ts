// ===== 程序化 Avatar Rig =====
// 与具体 GLB 模型解耦：自动探测 group 内的 blendshape / skeleton，
// 都没有时退化为在 group 下创建程序化占位节点（头/下颌/手臂）。
// 广场现有胶囊 avatar 走程序化路径即可被姿势驱动。
import * as THREE from 'three'
import type { AvatarExpression } from '@balabala/shared'

/** rig 能力模式 */
export type RigMode = 'blendshape' | 'skeleton' | 'procedural'

export interface AvatarRig {
  /** 根节点（avatar 的 group） */
  group: THREE.Group
  /** 探测到的能力 */
  mode: RigMode
  /** blendshape 名 → morphTargetIndex（blendshape 模式） */
  blendshapes: Map<string, number>
  /** 探测到的骨骼/命名节点：语义名 → Object3D */
  bones: Map<string, THREE.Object3D>
  /** 程序化占位节点（procedural 模式） */
  head?: THREE.Object3D
  jaw?: THREE.Object3D
  armL?: THREE.Object3D
  armR?: THREE.Object3D
  body?: THREE.Object3D
  /** 程序化眉/眼/手节点（缺失时自动创建），供表情/眨眼/手势驱动 */
  browL?: THREE.Object3D
  browR?: THREE.Object3D
  eyeL?: THREE.Object3D
  eyeR?: THREE.Object3D
  handL?: THREE.Object3D
  handR?: THREE.Object3D
}

/** 常见 blendshape 名（大小写不敏感匹配） */
const BLENDSHAPE_ALIASES: Record<string, string[]> = {
  jawOpen: ['jawopen', 'jaw_open', 'mouthopen', 'mouth_open'],
  mouthOpen: ['mouthopen', 'mouth_open', 'jawopen'],
  eyeBlinkLeft: ['eyeblinkleft', 'eye_blink_left', 'blinkleft'],
  eyeBlinkRight: ['eyeblinkright', 'eye_blink_right', 'blinkright'],
  browUpLeft: ['browupleft', 'brow_up_left', 'browinnerupleft'],
  browUpRight: ['browupright', 'brow_up_right', 'browinnerupright'],
}

/** 常见骨骼/节点名（小写匹配） */
const BONE_ALIASES: Record<string, string[]> = {
  head: ['head', 'headnode', 'bip01_head'],
  jaw: ['jaw', 'chinjaw', 'lowerjaw'],
  armL: ['armleft', 'arml', 'leftarm', 'shoulderl', 'upperarm_l', 'upperarmleft'],
  armR: ['armright', 'armr', 'rightarm', 'shoulderr', 'upperarm_r', 'upperarmright'],
  body: ['body', 'spine', 'hips', 'torso'],
}

function findByAliases<T extends { name: string }>(list: T[], aliases: string[]): T | undefined {
  const lower = aliases.map((a) => a.toLowerCase())
  return list.find((item) => lower.includes(item.name.toLowerCase()))
}

/**
 * 在 group 内自动探测 rig 能力：
 * 1. 若有 mesh.morphTargetDictionary → blendshape 模式
 * 2. 若有 skeleton 骨骼 → skeleton 模式
 * 3. 否则在 group 下创建程序化占位节点
 */
export function createRig(group: THREE.Group): AvatarRig {
  const rig: AvatarRig = {
    group,
    mode: 'procedural',
    blendshapes: new Map(),
    bones: new Map(),
  }

  // 1) 探测 blendshape
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
      const dict = mesh.morphTargetDictionary as Record<string, number>
      for (const [semantic, aliases] of Object.entries(BLENDSHAPE_ALIASES)) {
        if (rig.blendshapes.has(semantic)) continue
        for (const alias of aliases) {
          const idx = dict[alias] ?? dict[Object.keys(dict).find((k) => k.toLowerCase() === alias) ?? '']
          if (idx !== undefined && idx >= 0) {
            rig.blendshapes.set(semantic, idx)
            break
          }
        }
      }
      // 记录承载 mesh，便于写 influences
      if (rig.blendshapes.size > 0) {
        ;(rig as unknown as { _blendMesh: THREE.Mesh })._blendMesh = mesh
      }
    }
  })

  // 2) 探测骨骼 / 命名节点
  const named: THREE.Object3D[] = []
  group.traverse((child) => named.push(child))
  for (const [semantic, aliases] of Object.entries(BONE_ALIASES)) {
    const found = findByAliases(named, aliases)
    if (found) rig.bones.set(semantic, found)
  }

  if (rig.blendshapes.size > 0) {
    rig.mode = 'blendshape'
  } else if (rig.bones.size > 0) {
    rig.mode = 'skeleton'
  }

  // 3) 程序化占位节点：缺失的关键部位自动创建
  if (!rig.bones.has('head')) {
    let head = group.getObjectByName('__rig_head')
    if (!head) {
      head = new THREE.Object3D()
      head.name = '__rig_head'
      head.position.set(0, 1.0, 0)
      group.add(head)
    }
    rig.head = head
    rig.bones.set('head', head)
  } else {
    rig.head = rig.bones.get('head')
  }
  if (!rig.bones.has('jaw')) {
    const jaw = new THREE.Object3D()
    jaw.name = '__rig_jaw'
    jaw.position.set(0, 1.05, 0.1)
    rig.head!.add(jaw)
    rig.jaw = jaw
  } else {
    rig.jaw = rig.bones.get('jaw')
  }
  if (!rig.bones.has('armL')) {
    const armL = new THREE.Object3D()
    armL.name = '__rig_armL'
    armL.position.set(-0.3, 0.9, 0)
    group.add(armL)
    rig.armL = armL
  } else {
    rig.armL = rig.bones.get('armL')
  }
  if (!rig.bones.has('armR')) {
    const armR = new THREE.Object3D()
    armR.name = '__rig_armR'
    armR.position.set(0.3, 0.9, 0)
    group.add(armR)
    rig.armR = armR
  } else {
    rig.armR = rig.bones.get('armR')
  }
  rig.body = rig.bones.get('body') ?? group

  // 4) 程序化眉/眼/手节点：缺失即建（procedural 与 skeleton 模式都补，便于表情/眨眼/手势）
  if (rig.head) {
    if (!rig.head.getObjectByName('__rig_browL')) {
      const browL = new THREE.Object3D()
      browL.name = '__rig_browL'
      browL.position.set(-0.08, 0.12, 0.18)
      browL.userData.baseY = browL.position.y
      rig.head.add(browL)
      rig.browL = browL
    }
    if (!rig.head.getObjectByName('__rig_browR')) {
      const browR = new THREE.Object3D()
      browR.name = '__rig_browR'
      browR.position.set(0.08, 0.12, 0.18)
      browR.userData.baseY = browR.position.y
      rig.head.add(browR)
      rig.browR = browR
    }
    if (!rig.head.getObjectByName('__rig_eyeL')) {
      const eyeL = new THREE.Object3D()
      eyeL.name = '__rig_eyeL'
      eyeL.position.set(-0.08, 0.02, 0.2)
      rig.head.add(eyeL)
      rig.eyeL = eyeL
    }
    if (!rig.head.getObjectByName('__rig_eyeR')) {
      const eyeR = new THREE.Object3D()
      eyeR.name = '__rig_eyeR'
      eyeR.position.set(0.08, 0.02, 0.2)
      rig.head.add(eyeR)
      rig.eyeR = eyeR
    }
  }
  if (rig.armL && !rig.armL.getObjectByName('__rig_handL')) {
    const handL = new THREE.Object3D()
    handL.name = '__rig_handL'
    handL.position.set(0, -0.35, 0)
    rig.armL.add(handL)
    rig.handL = handL
  }
  if (rig.armR && !rig.armR.getObjectByName('__rig_handR')) {
    const handR = new THREE.Object3D()
    handR.name = '__rig_handR'
    handR.position.set(0, -0.35, 0)
    rig.armR.add(handR)
    rig.handR = handR
  }

  return rig
}

/** 把 jawOpen（0~1）写到 blendshape（若可用） */
function setBlendShape(rig: AvatarRig, semantic: string, value: number) {
  const mesh = (rig as unknown as { _blendMesh?: THREE.Mesh })._blendMesh
  const idx = rig.blendshapes.get(semantic)
  if (mesh && mesh.morphTargetInfluences && idx !== undefined) {
    mesh.morphTargetInfluences[idx] = Math.min(1, Math.max(0, value))
  }
}

/**
 * 将姿势参数应用到 rig。
 * pose 中没有的 key 不动；由调用方每帧传入完整姿势表。
 */
export function applyPose(rig: AvatarRig, pose: Record<string, number>): void {
  const { head, jaw, armL, armR, body } = rig

  // —— 口型（blendshape 优先，否则下颌旋转）——
  if (pose.jawOpen !== undefined) {
    setMouthOpen(rig, pose.jawOpen)
  }

  // —— 头部姿态 ——
  if (head) {
    if (pose.headTilt !== undefined) head.rotation.x = pose.headTilt
    if (pose.headTurn !== undefined) head.rotation.y = pose.headTurn
    if (pose.headRoll !== undefined) head.rotation.z = pose.headRoll
  }

  // —— 下颌（程序化）——
  if (jaw && rig.mode === 'procedural') {
    // jawOpen 已由 setMouthOpen 处理 blendshape；这里程序化时再补一次旋转
  }

  // —— 手臂 ——
  if (armL) {
    // armRaise 抬起（绕 z 轴外展），armSwing 前后摆（绕 x 轴），armTwist 扭转（绕 y 轴）
    if (pose.armRaiseL !== undefined) armL.rotation.z = pose.armRaiseL * -Math.PI * 0.7
    if (pose.armSwingL !== undefined) armL.rotation.x = pose.armSwingL
    if (pose.armTwistL !== undefined) armL.rotation.y = pose.armTwistL
  }
  if (armR) {
    if (pose.armRaiseR !== undefined) armR.rotation.z = pose.armRaiseR * Math.PI * 0.7
    if (pose.armSwingR !== undefined) armR.rotation.x = pose.armSwingR
    if (pose.armTwistR !== undefined) armR.rotation.y = pose.armTwistR
  }

  // —— 手（程序化握拳/手腕）——
  if (rig.handL && pose.handGripL !== undefined) {
    rig.handL.rotation.x = pose.handGripL * 1.2 // 握拳时屈腕
  }
  if (rig.handR && pose.handGripR !== undefined) {
    rig.handR.rotation.x = pose.handGripR * 1.2
  }
  if (rig.handL && pose.handPitchL !== undefined) rig.handL.rotation.z = pose.handPitchL
  if (rig.handR && pose.handPitchR !== undefined) rig.handR.rotation.z = -pose.handPitchR

  // —— 眉：blendshape 优先；否则程序化上下平移 ——
  if (pose.browRaise !== undefined) {
    setBlendShape(rig, 'browUpLeft', pose.browRaise)
    setBlendShape(rig, 'browUpRight', pose.browRaise)
    if (rig.browL && rig.browR) {
      const baseL = (rig.browL.userData.baseY as number) ?? rig.browL.position.y
      const baseR = (rig.browR.userData.baseY as number) ?? rig.browR.position.y
      const d = pose.browRaise * 0.06
      rig.browL.position.y = baseL + d
      rig.browR.position.y = baseR + d
    }
  }

  // —— 眼：眨眼（程序化缩放 y）；blendshape 眨眼写 eyeBlink ——
  if (pose.eyeOpen !== undefined) {
    const open = Math.min(1.4, Math.max(0, pose.eyeOpen))
    if (rig.eyeL) rig.eyeL.scale.y = open
    if (rig.eyeR) rig.eyeR.scale.y = open
    // 1 - open 作为眨眼权重写到 blendshape（open=1 时权重 0）
    const blink = Math.min(1, Math.max(0, 1 - open))
    if (rig.blendshapes.has('eyeBlinkLeft')) setBlendShape(rig, 'eyeBlinkLeft', blink)
    if (rig.blendshapes.has('eyeBlinkRight')) setBlendShape(rig, 'eyeBlinkRight', blink)
  }

  // —— 身体 ——
  if (body) {
    if (pose.bodyLean !== undefined) body.rotation.x = pose.bodyLean * 0.4
    if (pose.bounce !== undefined && body !== rig.group) {
      body.position.y = pose.bounce
    }
  }
}

/**
 * 统一口型接口：0~1 的张嘴度。
 * 有 blendshape 写 jawOpen/mouthOpen；否则旋转程序化下颌。
 */
export function setMouthOpen(rig: AvatarRig, value: number): void {
  const v = Math.min(1, Math.max(0, value))
  if (rig.blendshapes.has('jawOpen')) setBlendShape(rig, 'jawOpen', v)
  if (rig.blendshapes.has('mouthOpen')) setBlendShape(rig, 'mouthOpen', v)
  if (rig.mode === 'procedural' && rig.jaw) {
    // 下颌绕 x 轴向下张开
    rig.jaw.rotation.x = v * 0.6
  }
}

/**
 * 表情映射：中性/笑/惊讶/生气 → 眉/眼/嘴参数，再写回 rig。
 */
export function setExpression(rig: AvatarRig, expression: AvatarExpression): void {
  switch (expression) {
    case 'happy':
      setBlendShape(rig, 'browUpLeft', 0.2)
      setBlendShape(rig, 'browUpRight', 0.2)
      if (rig.mode === 'procedural' && rig.head) {
        rig.head.rotation.z = 0.03
      }
      break
    case 'surprised':
      setBlendShape(rig, 'browUpLeft', 1)
      setBlendShape(rig, 'browUpRight', 1)
      break
    case 'angry':
      setBlendShape(rig, 'browUpLeft', 0)
      setBlendShape(rig, 'browUpRight', 0)
      if (rig.mode === 'procedural' && rig.head) {
        rig.head.rotation.z = -0.05
      }
      break
    case 'neutral':
    default:
      setBlendShape(rig, 'browUpLeft', 0)
      setBlendShape(rig, 'browUpRight', 0)
      break
  }
}
