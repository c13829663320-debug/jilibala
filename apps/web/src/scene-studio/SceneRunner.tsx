// ===== SceneRunner：自包含 3D 运行时 =====
// 数据驱动：根据 SceneBlueprint 渲染地形 / 撒点 / 结构 / NPC / 玩家控制器。
// 不依赖 Plaza3D / court 模块。纯函数（terrain.ts / gameplay.ts）可独立单测。

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Text, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type {
  SceneBlueprint,
  SceneNpc,
  SceneScatter,
  SceneStructure,
  SceneTerrain,
} from '@balabala/shared'
import { terrainHeight, checkCollision, resolveSpawnHeight } from './terrain'
import {
  createGameplayState,
  collectItem,
  checkReach,
  advanceQuest,
  isCompleted,
  type GameplayState,
} from './gameplay'
import './scene-runner.css'

export interface SceneRunnerProps {
  blueprint: SceneBlueprint
  npcResources?: Record<string, { name: string; modelUrl: string; voice: string; portrait: string }>
  assetUrls?: Record<string, string>
  editable?: boolean
  onNpcInteract?: (npc: SceneNpc) => void
  onGameplayEvent?: (event: { type: string; payload?: unknown }) => void
  onPlacementChange?: (
    kind: 'npc' | 'structure',
    id: string,
    position: [number, number, number],
  ) => void
}

// ---------- 主题色 ----------
const THEME_BG: Record<string, string> = {
  forest: '#0e1a12',
  desert: '#1a1408',
  snow: '#0f1418',
  beach: '#0a1418',
  mountain: '#101218',
  plains: '#0e160c',
  cave: '#0a0a0e',
  city: '#0c0e14',
}
const THEME_FOG: Record<string, string> = {
  forest: '#1a2a1e',
  desert: '#2a2010',
  snow: '#1a2228',
  beach: '#10222a',
  mountain: '#181c24',
  plains: '#1a2418',
  cave: '#14141c',
  city: '#141820',
}

// ---------- 地形网格 ----------
function TerrainMesh({ terrain }: { terrain: SceneTerrain }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const SEG = 128
  const size = terrain.size

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(size, size, SEG, SEG)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    const low = new THREE.Color('#c2a878') // 沙 / 水线
    const mid = new THREE.Color('#4a7a3a') // 草
    const high = new THREE.Color('#8a8a8a') // 岩
    const snow = new THREE.Color('#f0f0f0') // 雪
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const h = terrainHeight(x, z, terrain.heightSeed, size, terrain.params)
      pos.setY(i, h)
      const t = (h + 3) / 8 // 归一化到 ~0..1
      let c: THREE.Color
      if (t < 0.25) c = low.clone().lerp(mid, t / 0.25)
      else if (t < 0.6) c = mid.clone().lerp(high, (t - 0.25) / 0.35)
      else c = high.clone().lerp(snow, Math.min(1, (t - 0.6) / 0.4))
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    return geo
  }, [terrain, size])

  useLayoutEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  return (
    <mesh ref={meshRef} geometry={geometry} receiveShadow castShadow={false}>
      <meshStandardMaterial vertexColors roughness={1} metalness={0} />
    </mesh>
  )
}

// ---------- 水面 ----------
function Water({ level, size }: { level: number; size: number }) {
  if (level <= -1) return null
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, level, 0]}>
      <planeGeometry args={[size * 1.5, size * 1.5, 1, 1]} />
      <meshStandardMaterial color="#2a6a8a" transparent opacity={0.6} roughness={0.2} metalness={0.3} />
    </mesh>
  )
}

// ---------- 撒点层（InstancedMesh） ----------
type ScatterItem = { kind: SceneScatter['kind']; x: number; y: number; z: number; s: number; rot: number }

function buildScatterItems(
  scatter: SceneScatter[],
  terrain: SceneTerrain,
): ScatterItem[] {
  const items: ScatterItem[] = []
  const half = terrain.size / 2
  let seed = terrain.heightSeed + 7
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (const cfg of scatter) {
    for (let i = 0; i < cfg.count; i++) {
      let x = 0
      let z = 0
      if (cfg.zones && cfg.zones.length > 0) {
        const zone = cfg.zones[Math.floor(rand() * cfg.zones.length)]
        const [xMin, zMin, xMax, zMax] = zone
        x = xMin + rand() * (xMax - xMin)
        z = zMin + rand() * (zMax - zMin)
      } else {
        x = (rand() - 0.5) * terrain.size
        z = (rand() - 0.5) * terrain.size
      }
      if (Math.abs(x) > half - 2 || Math.abs(z) > half - 2) continue
      const y = terrainHeight(x, z, terrain.heightSeed, terrain.size, terrain.params)
      items.push({
        kind: cfg.kind,
        x,
        y,
        z,
        s: 0.7 + rand() * 0.6,
        rot: rand() * Math.PI * 2,
      })
    }
  }
  return items
}

function ScatterLayer({ scatter, terrain }: { scatter: SceneScatter[]; terrain: SceneTerrain }) {
  const items = useMemo(() => buildScatterItems(scatter, terrain), [scatter, terrain])
  const groups = useMemo(() => {
    const map = new Map<SceneScatter['kind'], ScatterItem[]>()
    for (const it of items) {
      const arr = map.get(it.kind) ?? []
      arr.push(it)
      map.set(it.kind, arr)
    }
    return [...map.entries()]
  }, [items])

  return (
    <group>
      {groups.map(([kind, list]) => (
        <ScatterInstances key={kind} kind={kind} items={list} />
      ))}
    </group>
  )
}

function ScatterInstances({ kind, items }: { kind: SceneScatter['kind']; items: ScatterItem[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z)
      dummy.rotation.set(0, it.rot, 0)
      dummy.scale.setScalar(it.s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [items, dummy])

  if (items.length === 0) return null

  // 不同种类用不同几何体
  switch (kind) {
    case 'tree':
      return (
        <group>
          <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
            <cylinderGeometry args={[0.12, 0.18, 1.2, 6]} />
            <meshStandardMaterial color="#5a3a1a" />
          </instancedMesh>
          <instancedMesh args={[undefined, undefined, items.length]} castShadow>
            <coneGeometry args={[0.8, 1.8, 7]} />
            <meshStandardMaterial color="#2a5a2a" />
          </instancedMesh>
        </group>
      )
    case 'rock':
      return (
        <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
          <dodecahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial color="#7a7a7a" roughness={0.9} />
        </instancedMesh>
      )
    case 'grass':
      return (
        <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
          <planeGeometry args={[0.3, 0.6]} />
          <meshStandardMaterial color="#4a8a3a" side={THREE.DoubleSide} />
        </instancedMesh>
      )
    case 'flower':
      return (
        <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
          <sphereGeometry args={[0.08, 6, 6]} />
          <meshStandardMaterial color="#d06a9a" />
        </instancedMesh>
      )
    case 'bush':
      return (
        <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow>
          <sphereGeometry args={[0.4, 8, 8]} />
          <meshStandardMaterial color="#3a6a2a" />
        </instancedMesh>
      )
    case 'cactus':
      return (
        <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow>
          <cylinderGeometry args={[0.2, 0.25, 1.5, 6]} />
          <meshStandardMaterial color="#3a7a4a" />
        </instancedMesh>
      )
    case 'mushroom':
      return (
        <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
          <sphereGeometry args={[0.25, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#b84a3a" />
        </instancedMesh>
      )
    case 'crystal':
      return (
        <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow>
          <octahedronGeometry args={[0.35, 0]} />
          <meshStandardMaterial color="#6ad0d0" emissive="#2a8a8a" emissiveIntensity={0.4} />
        </instancedMesh>
      )
    default:
      return null
  }
}

// ---------- 结构层 ----------
function StructurePlaceholder({ structure }: { structure: SceneStructure }) {
  return (
    <group position={structure.position} rotation={structure.rotation} scale={structure.scale}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#8a7a5a" />
      </mesh>
      <Billboard position={[0, 0.8, 0]}>
        <Text fontSize={0.18} color="#fff" anchorX="center" anchorY="bottom">
          {structure.label || structure.kind}
        </Text>
      </Billboard>
    </group>
  )
}

function StructureModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  useLayoutEffect(() => {
    scene.traverse((child) => {
      const m = child as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
  }, [scene])
  return <primitive object={scene} />
}

function StructuresLayer({
  structures,
  assetUrls,
  editable,
  onSelect,
  selectedId,
}: {
  structures: SceneStructure[]
  assetUrls?: Record<string, string>
  editable?: boolean
  onSelect?: (kind: 'structure', id: string, e: ThreeEvent<MouseEvent>) => void
  selectedId?: string | null
}) {
  return (
    <group>
      {structures.map((s) => {
        const url = assetUrls?.[s.id] || s.assetUrl
        const selected = selectedId === s.id
        return (
          <group
            key={s.id}
            onClick={(e) => {
              if (editable && onSelect) {
                e.stopPropagation()
                onSelect('structure', s.id, e)
              }
            }}
          >
            {url ? (
              <Suspense fallback={null}>
                <group position={s.position} rotation={s.rotation} scale={s.scale}>
                  <StructureModel url={url} />
                </group>
              </Suspense>
            ) : (
              <StructurePlaceholder structure={s} />
            )}
            {selected && (
              <mesh position={s.position}>
                <boxGeometry args={[1.2, 1.2, 1.2]} />
                <meshBasicMaterial color="#FFD600" wireframe transparent opacity={0.6} />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

// ---------- NPC 层 ----------
function NpcModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  useLayoutEffect(() => {
    scene.traverse((child) => {
      const m = child as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
  }, [scene])
  return <primitive object={scene} />
}

function NpcLayer({
  npcs,
  npcResources,
  editable,
  onSelect,
  onNpcInteract,
  selectedId,
}: {
  npcs: SceneNpc[]
  npcResources?: Record<string, { name: string; modelUrl: string; voice: string; portrait: string }>
  editable?: boolean
  onSelect?: (kind: 'npc', id: string, e: ThreeEvent<MouseEvent>) => void
  onNpcInteract?: (npc: SceneNpc) => void
  selectedId?: string | null
}) {
  return (
    <group>
      {npcs.map((npc) => {
        const res = npcResources?.[npc.characterId]
        const url = res?.modelUrl
        const label = res?.name || npc.label
        const selected = selectedId === npc.id
        return (
          <group
            key={npc.id}
            position={npc.position}
            rotation={npc.rotation}
            onClick={(e) => {
              e.stopPropagation()
              if (editable && onSelect) {
                onSelect('npc', npc.id, e)
              } else if (onNpcInteract) {
                onNpcInteract(npc)
              }
            }}
          >
            {url ? (
              <Suspense fallback={null}>
                <NpcModel url={url} />
              </Suspense>
            ) : (
              <mesh castShadow>
                <capsuleGeometry args={[0.3, 0.8, 4, 8]} />
                <meshStandardMaterial color="#4fb3a5" />
              </mesh>
            )}
            <Billboard position={[0, 1.6, 0]}>
              <Text fontSize={0.2} color="#FFD600" anchorX="center" anchorY="bottom" outlineWidth={0.01} outlineColor="#000">
                {label}
              </Text>
            </Billboard>
            {selected && (
              <mesh>
                <torusGeometry args={[0.5, 0.03, 8, 24]} />
                <meshBasicMaterial color="#FFD600" />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

// ---------- 玩家控制器 ----------
const PLAYER_RADIUS = 0.5
const PLAYER_SPEED = 5

type PlayerControllerProps = {
  blueprint: SceneBlueprint
  onGameplayEvent?: (e: { type: string; payload?: unknown }) => void
  gameplayState: GameplayState
  setGameplayState: (s: GameplayState) => void
}

function PlayerController({
  blueprint,
  onGameplayEvent,
  gameplayState,
  setGameplayState,
}: PlayerControllerProps) {
  const groupRef = useRef<THREE.Group>(null)
  const { camera, gl } = useThree()
  const keys = useRef<Record<string, boolean>>({})
  const yaw = useRef(0)
  const pitch = useRef(0.35)
  const dragging = useRef(false)
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const stateRef = useRef(gameplayState)
  stateRef.current = gameplayState

  const spawnY = useMemo(() => resolveSpawnHeight(blueprint), [blueprint])
  const spawn: [number, number, number] = [
    blueprint.spawnPoint[0],
    spawnY,
    blueprint.spawnPoint[2],
  ]

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    const el = gl.domElement
    const onDown = (e: PointerEvent) => {
      dragging.current = true
      lastPointer.current = { x: e.clientX, y: e.clientY }
    }
    const onUp = () => {
      dragging.current = false
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - lastPointer.current.x
      const dy = e.clientY - lastPointer.current.y
      lastPointer.current = { x: e.clientX, y: e.clientY }
      yaw.current -= dx * 0.005
      pitch.current = Math.max(0.05, Math.min(1.2, pitch.current + dy * 0.005))
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointermove', onMove)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointermove', onMove)
    }
  }, [gl])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const dt = Math.min(delta, 0.05)

    // 移动方向（基于 yaw）
    const fwd = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current))
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current))
    const move = new THREE.Vector3()
    if (keys.current['w'] || keys.current['arrowup']) move.add(fwd)
    if (keys.current['s'] || keys.current['arrowdown']) move.sub(fwd)
    if (keys.current['d'] || keys.current['arrowright']) move.add(right)
    if (keys.current['a'] || keys.current['arrowleft']) move.sub(right)
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(PLAYER_SPEED * dt)
      const cur = group.position
      const nx = cur.x + move.x
      const nz = cur.z + move.z
      const newPos: [number, number, number] = [nx, cur.y, nz]
      const collides = checkCollision(newPos, PLAYER_RADIUS, blueprint.structures, blueprint.bounds)
      if (!collides) {
        group.position.x = nx
        group.position.z = nz
      }
    }

    // 地面吸附
    const groundY = terrainHeight(
      group.position.x,
      group.position.z,
      blueprint.terrain.heightSeed,
      blueprint.terrain.size,
      blueprint.terrain.params,
    )
    group.position.y = groundY + 1.0

    // 相机跟随
    const camDist = 8
    const cp = new THREE.Vector3(
      group.position.x + Math.sin(yaw.current) * Math.cos(pitch.current) * camDist,
      group.position.y + Math.sin(pitch.current) * camDist + 2,
      group.position.z + Math.cos(yaw.current) * Math.cos(pitch.current) * camDist,
    )
    camera.position.lerp(cp, 0.15)
    camera.lookAt(group.position.x, group.position.y + 0.5, group.position.z)

    // reach 玩法检测
    const st = stateRef.current
    if (st.template === 'reach' && !st.completed && blueprint.gameplay.config.goalPosition) {
      const goal = blueprint.gameplay.config.goalPosition
      const next = checkReach(st, [group.position.x, group.position.y, group.position.z], goal)
      if (next !== st) {
        setGameplayState(next)
        onGameplayEvent?.({ type: 'reach', payload: { reached: true } })
      }
    }
  })

  return (
    <group ref={groupRef} position={spawn}>
      <mesh castShadow>
        <capsuleGeometry args={[0.3, 0.8, 4, 8]} />
        <meshStandardMaterial color="#FFD600" />
      </mesh>
    </group>
  )
}

// ---------- 编辑模式拖拽 ----------
function EditDragger({
  blueprint,
  editable,
  onPlacementChange,
  selected,
  setSelected,
}: {
  blueprint: SceneBlueprint
  editable?: boolean
  onPlacementChange?: (kind: 'npc' | 'structure', id: string, pos: [number, number, number]) => void
  selected: { kind: 'npc' | 'structure'; id: string } | null
  setSelected: (s: { kind: 'npc' | 'structure'; id: string } | null) => void
}) {
  const { gl, camera, raycaster } = useThree()
  const dragging = useRef(false)
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])

  useEffect(() => {
    if (!editable) return
    const el = gl.domElement
    const onDown = (e: PointerEvent) => {
      if (!selected) return
      const ndc = new THREE.Vector2(
        (e.clientX / el.clientWidth) * 2 - 1,
        -(e.clientY / el.clientHeight) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const hit = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(plane, hit)) {
        dragging.current = true
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !selected) return
      const ndc = new THREE.Vector2(
        (e.clientX / el.clientWidth) * 2 - 1,
        -(e.clientY / el.clientHeight) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const hit = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(plane, hit)) {
        const y = terrainHeight(
          hit.x,
          hit.z,
          blueprint.terrain.heightSeed,
          blueprint.terrain.size,
          blueprint.terrain.params,
        )
        onPlacementChange?.(selected.kind, selected.id, [hit.x, y, hit.z])
      }
    }
    const onUp = () => {
      dragging.current = false
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [editable, selected, gl, camera, raycaster, plane, blueprint, onPlacementChange])

  useEffect(() => {
    if (!editable) setSelected(null)
  }, [editable, setSelected])

  return null
}

// ---------- HUD ----------
function objectiveText(blueprint: SceneBlueprint, state: GameplayState): string {
  const cfg = blueprint.gameplay.config
  if (cfg.objective) return cfg.objective
  switch (state.template) {
    case 'collect':
      return `收集物品 ${state.collected.size}/${state.collectTargets.length}`
    case 'reach':
      return state.reached ? '已到达目标！' : '前往目标点'
    case 'quest':
      return `任务步骤 ${state.questStep + 1}/${state.questTotal}`
    case 'explore':
    default:
      return '自由探索'
  }
}

// ---------- 主组件 ----------
export default function SceneRunner({
  blueprint,
  npcResources,
  assetUrls,
  editable,
  onNpcInteract,
  onGameplayEvent,
  onPlacementChange,
}: SceneRunnerProps) {
  const [gameplayState, setGameplayState] = useState<GameplayState>(() =>
    createGameplayState(blueprint),
  )
  const [interactedNpc, setInteractedNpc] = useState<SceneNpc | null>(null)
  const [selected, setSelected] = useState<{ kind: 'npc' | 'structure'; id: string } | null>(null)

  // blueprint 变化时重置状态
  useEffect(() => {
    setGameplayState(createGameplayState(blueprint))
    setInteractedNpc(null)
  }, [blueprint])

  const completed = isCompleted(gameplayState)
  const bgColor = THEME_BG[blueprint.terrain.theme] ?? '#0a0a0a'
  const fogColor = THEME_FOG[blueprint.terrain.theme] ?? '#1a1a1a'

  const handleNpcInteract = useCallback(
    (npc: SceneNpc) => {
      setInteractedNpc(npc)
      onNpcInteract?.(npc)
    },
    [onNpcInteract],
  )

  const handleSelect = useCallback(
    (kind: 'npc' | 'structure', id: string) => {
      setSelected({ kind, id })
    },
    [],
  )

  // 暴露 collectItem / advanceQuest 给外部（通过 onGameplayEvent 的反向通道不现实，
  // 这里在 HUD 里放调试按钮，真机由 Studio 层驱动）
  const debugAdvanceQuest = useCallback(() => {
    setGameplayState((s) => advanceQuest(s))
  }, [])

  const debugCollect = useCallback(
    (itemId: string) => {
      setGameplayState((s) => collectItem(s, itemId))
    },
    [],
  )

  return (
    <div className="scene-runner-root" style={{ background: bgColor }}>
      <Canvas
        shadows
        camera={{ position: [0, 8, 12], fov: 60 }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={[bgColor]} />
        <fog attach="fog" args={[fogColor, 30, 80]} />
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[20, 30, 10]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <TerrainMesh terrain={blueprint.terrain} />
        <Water level={blueprint.terrain.waterLevel} size={blueprint.terrain.size} />
        <ScatterLayer scatter={blueprint.scatter} terrain={blueprint.terrain} />
        <StructuresLayer
          structures={blueprint.structures}
          assetUrls={assetUrls}
          editable={editable}
          onSelect={(kind, id) => handleSelect(kind, id)}
          selectedId={selected?.kind === 'structure' ? selected.id : null}
        />
        <NpcLayer
          npcs={blueprint.npcs}
          npcResources={npcResources}
          editable={editable}
          onSelect={(kind, id) => handleSelect(kind, id)}
          onNpcInteract={handleNpcInteract}
          selectedId={selected?.kind === 'npc' ? selected.id : null}
        />
        <PlayerController
          blueprint={blueprint}
          onGameplayEvent={onGameplayEvent}
          gameplayState={gameplayState}
          setGameplayState={setGameplayState}
        />
        <EditDragger
          blueprint={blueprint}
          editable={editable}
          onPlacementChange={onPlacementChange}
          selected={selected}
          setSelected={setSelected}
        />
      </Canvas>

      {/* HUD：左上目标面板 */}
      <div className="scene-runner-hud">
        <div className="scene-runner-hud-title">
          {objectiveText(blueprint, gameplayState)}
        </div>
        {gameplayState.template === 'collect' && (
          <div className="scene-runner-hud-progress">
            收集进度：{gameplayState.collected.size} / {gameplayState.collectTargets.length}
          </div>
        )}
        {gameplayState.template === 'quest' && (
          <div className="scene-runner-hud-progress">
            步骤：{gameplayState.questStep + 1} / {gameplayState.questTotal}
          </div>
        )}
        {editable && (
          <div className="scene-runner-hud-edit">
            编辑模式：点击 NPC/结构选中，拖拽移动
          </div>
        )}
      </div>

      {/* 调试按钮（Studio 层可通过直接调用内部状态机替代） */}
      {gameplayState.template === 'quest' && !completed && (
        <button className="scene-runner-debug" onClick={debugAdvanceQuest}>
          推进任务（调试）
        </button>
      )}
      {gameplayState.template === 'collect' &&
        gameplayState.collectTargets.map((id) =>
          gameplayState.collected.has(id) ? null : (
            <button key={id} className="scene-runner-debug" onClick={() => debugCollect(id)}>
              收集 {id}（调试）
            </button>
          ),
        )}

      {/* 对话框 */}
      {interactedNpc && (
        <div className="scene-runner-dialog" onClick={() => setInteractedNpc(null)}>
          <div className="scene-runner-dialog-name">
            {npcResources?.[interactedNpc.characterId]?.name || interactedNpc.label}
          </div>
          <div className="scene-runner-dialog-text">对话中…</div>
        </div>
      )}

      {/* 胜利遮罩 */}
      {completed && (
        <div className="scene-runner-win">
          <div className="scene-runner-win-title">场景完成！</div>
          <div className="scene-runner-win-sub">你已达成全部目标</div>
        </div>
      )}
    </div>
  )
}
