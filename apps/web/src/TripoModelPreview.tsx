import { Component, Suspense, useMemo, type ErrorInfo, type ReactNode } from 'react'
import { SafeCanvas } from './SafeCanvas'
import { ContactShadows, Environment, Html, OrbitControls, useGLTF } from '@react-three/drei'
import { Box3, Vector3 } from 'three'

type Props = { url: string; className?: string; label?: string }

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const box = new Box3().setFromObject(clone)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.001)
    const scale = 2.2 / maxSize
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
    return clone
  }, [scene])
  return <primitive object={normalized} castShadow receiveShadow />
}

function Loading() {
  return <Html center className="tripo-model-preview__loading">加载 3D 模型…</Html>
}

class PreviewErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a failed remote asset from taking down the whole room. Details stay
    // in the console for development without exposing a CDN URL in the UI.
    console.warn('Tripo GLB preview failed', error, info.componentStack)
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export default function TripoModelPreview({ url, className = '', label = '模型预览' }: Props) {
  if (!url) return null
  return <div className={`tripo-model-preview ${className}`} aria-label={label}>
    <PreviewErrorBoundary fallback={<div className="tripo-model-preview__fallback">模型暂时无法预览<br /><small>可以打开链接下载 GLB</small></div>}>
      <SafeCanvas shadows dpr={[1, 1.6]} camera={{ position: [2.8, 1.8, 3.2], fov: 34 }}>
        <color attach="background" args={['#111027']} />
        <ambientLight intensity={1.5} color="#d7c7ff" />
        <directionalLight position={[3, 5, 4]} intensity={3.2} color="#fff2db" castShadow />
        <pointLight position={[-2, 2, 1]} intensity={3} color="#8fe5d5" />
        <Suspense fallback={<Loading />}><Model url={url} /></Suspense>
        <ContactShadows position={[0, -0.01, 0]} opacity={0.55} scale={4} blur={2.2} far={3.5} />
        <Environment preset="studio" />
        <OrbitControls enablePan={false} minDistance={1.8} maxDistance={5.5} minPolarAngle={0.45} maxPolarAngle={Math.PI / 2} autoRotate autoRotateSpeed={1.2} />
      </SafeCanvas>
    </PreviewErrorBoundary>
  </div>
}
