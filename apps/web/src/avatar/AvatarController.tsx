// ===== AvatarController：统一化身控制器 =====
// 将 rig + 程序化表情 + 手势 + 注视 + 动画状态机整合为一个 R3F 组件，
// 每帧驱动。接受 props：expression / gesture / gazeTarget / animationState。
// 用法：<AvatarController ...><group>...命名节点 head/jaw/armL/armR...</group></AvatarController>
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createRig, applyPose, type AvatarRig } from './avatar-rig'
import { getPose, type AnimState } from './animation-state-machine'
import { expressionToPose, legacyExpressionToProcedural, type ProceduralExpression } from './procedural-expressions'
import { getGesturePose, type GestureType } from './gesture-system'
import { createGazeTracker, gazeAnglesTo, type GazePoint } from './gaze-system'

export interface AvatarControllerProps {
  /** 程序化表情（富表情枚举） */
  expression?: ProceduralExpression
  /** 旧 AvatarExpression 兼容传入（二者择一，expression 优先） */
  legacyExpression?: string
  /** 当前手势 */
  gesture?: GestureType
  /** 注视目标世界坐标（不传则随机扫视 + 眨眼） */
  gazeTarget?: GazePoint | null
  /** 动画状态（idle/talking/walking/running/...） */
  animationState?: AnimState
  /** 子节点：带命名 head/jaw/armL/armR 的程序化或模型化身 */
  children?: ReactNode
}

export function AvatarController({
  expression,
  legacyExpression,
  gesture = 'none',
  gazeTarget = null,
  animationState = 'idle',
  children,
}: AvatarControllerProps) {
  const rootRef = useRef<THREE.Group>(null)
  const rigRef = useRef<AvatarRig | null>(null)
  const animStartRef = useRef(0)
  const gestureStartRef = useRef(0)
  const lastStateRef = useRef<AnimState>(animationState)
  const lastGestureRef = useRef<GestureType>(gesture)
  const gazeRef = useRef(createGazeTracker())

  useLayoutEffect(() => {
    if (rootRef.current) rigRef.current = createRig(rootRef.current)
  }, [])

  useFrame(({ clock }) => {
    const root = rootRef.current
    const rig = rigRef.current
    if (!root || !rig) return
    const now = clock.elapsedTime * 1000

    // 状态/手势变化时重置各自的进入计时
    if (animationState !== lastStateRef.current) {
      lastStateRef.current = animationState
      animStartRef.current = now
    }
    if (gesture !== lastGestureRef.current) {
      lastGestureRef.current = gesture
      gestureStartRef.current = now
    }

    // 1) 状态机姿势
    const pose = getPose(animationState, now - animStartRef.current)

    // 2) 手势叠加（非 none 时覆盖手臂/手）
    if (gesture !== 'none') {
      const g = getGesturePose(gesture, now - gestureStartRef.current)
      Object.assign(pose, g)
    }

    // 3) 表情融合
    const expr: ProceduralExpression = expression ?? legacyExpressionToProcedural(legacyExpression)
    const ep = expressionToPose(expr)
    pose.browRaise = Math.max(pose.browRaise ?? 0, ep.browRaise ?? 0)
    pose.eyeOpen = (pose.eyeOpen ?? 1) * (ep.eyeOpen ?? 1)
    pose.jawOpen = Math.max(pose.jawOpen ?? 0, ep.jawOpen ?? 0)
    pose.headTilt = (pose.headTilt ?? 0) + (ep.headTilt ?? 0)
    pose.headRoll = (pose.headRoll ?? 0) + (ep.headRoll ?? 0)

    // 4) 注视：user 目标优先，否则随机扫视 + 眨眼
    const tracker = gazeRef.current
    tracker.setTarget('user', gazeTarget)
    tracker.setOrigin({ x: root.position.x, z: root.position.z }, root.rotation.y)
    const gz = tracker.update(now)
    const angles = gazeAnglesTo(gz.point, { x: root.position.x, z: root.position.z }, root.rotation.y)
    // 注视偏航叠加到转头（小幅，避免过冲）
    pose.headTurn = (pose.headTurn ?? 0) + THREE.MathUtils.clamp(angles.yaw, -0.6, 0.6)
    pose.eyeOpen = (pose.eyeOpen ?? 1) * gz.eyeOpen

    // 5) 写回 rig
    applyPose(rig, pose)
  })

  return <group ref={rootRef}>{children}</group>
}
