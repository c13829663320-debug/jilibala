/**
 * 开放世界 · 第三人称跟随相机
 * ------------------------------------------------------------------
 * - 鼠标拖拽（左键/右键）环绕玩家，滚轮缩放距离（5~20）
 * - useFrame 里根据 world.camera 的 yaw/pitch/distance 把相机摆到玩家后上方，
 *   lookAt 玩家胸口
 * - 简单防穿墙：采样玩家→相机连线，若目标相机位置落在障碍碰撞体里就拉近
 * - 触屏环视由 MobileControls 的右半屏覆盖层写入 world.camera，这里只负责读
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Collider, WorldRuntime } from './types'
import { collidesAt } from './collision'

interface CameraRigProps {
  world: WorldRuntime
  colliders: Collider[]
}

const MIN_DIST = 5
const MAX_DIST = 20
const MIN_PITCH = 0.08
const MAX_PITCH = 1.25

export default function CameraRig({ world, colliders }: CameraRigProps) {
  const { camera, gl } = useThree()
  const dragging = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })
  const tmpTarget = useRef(new THREE.Vector3())

  // ---- 鼠标拖拽环视 + 滚轮缩放（桌面端） ----
  useEffect(() => {
    const el = gl.domElement
    const onDown = (e: PointerEvent) => {
      // 只响应鼠标（触屏由 MobileControls 处理）
      if (e.pointerType !== 'mouse') return
      dragging.current = true
      lastPointer.current = { x: e.clientX, y: e.clientY }
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || e.pointerType !== 'mouse') return
      const dx = e.clientX - lastPointer.current.x
      const dy = e.clientY - lastPointer.current.y
      lastPointer.current = { x: e.clientX, y: e.clientY }
      const cam = world.camera
      cam.yaw -= dx * 0.005
      cam.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, cam.pitch + dy * 0.004))
    }
    const onUp = () => { dragging.current = false }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = world.camera
      cam.distance = Math.max(MIN_DIST, Math.min(MAX_DIST, cam.distance + e.deltaY * 0.01))
    }
    const onCtx = (e: Event) => e.preventDefault()

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onCtx)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onCtx)
    }
  }, [gl, world])

  useFrame(() => {
    const p = world.player
    const cam = world.camera

    // 目标点：玩家胸口
    tmpTarget.current.set(p.x, p.y + 1.4, p.z)

    // 期望相机位置（球坐标，绕玩家）
    const horiz = Math.cos(cam.pitch) * cam.distance
    let camX = p.x + Math.sin(cam.yaw) * horiz
    let camZ = p.z + Math.cos(cam.yaw) * horiz
    let camY = p.y + 1.4 + Math.sin(cam.pitch) * cam.distance

    // 简单防穿墙：若期望相机位置落在障碍里，逐步拉近距离
    let dist = cam.distance
    while (dist > MIN_DIST && collidesAt(camX, camZ, 0.4, colliders)) {
      dist -= 1
      const h = Math.cos(cam.pitch) * dist
      camX = p.x + Math.sin(cam.yaw) * h
      camZ = p.z + Math.cos(cam.yaw) * h
      camY = p.y + 1.4 + Math.sin(cam.pitch) * dist
    }

    camera.position.set(camX, camY, camZ)
    camera.lookAt(tmpTarget.current)
  })

  return null
}
