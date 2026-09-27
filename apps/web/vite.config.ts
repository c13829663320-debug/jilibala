import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const apiPort = process.env.PORT || '8787';
const webPort = Number(process.env.WEB_PORT) || 5173;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'brand/balabala-logo.jpg',
        'icons/icon-192.jpg',
        'icons/icon-512.jpg',
        'icons/maskable-192.jpg',
        'icons/maskable-512.jpg',
      ],
      manifest: {
        name: '叽里呱啦 · BalaBala',
        short_name: '叽里呱啦',
        description: '趣味社交法庭 · 在广场上和名人、朋友一起开庭、辩论、聊天。',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'zh-CN',
        orientation: 'any',
        categories: ['entertainment', 'social', 'games'],
        icons: [
          {
            src: 'icons/icon-192.jpg',
            sizes: '192x192',
            type: 'image/jpeg',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'any',
          },
          {
            src: 'icons/maskable-192.jpg',
            sizes: '192x192',
            type: 'image/jpeg',
            purpose: 'maskable',
          },
          {
            src: 'icons/maskable-512.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 只 precache 构建产物（html/js/css）+ includeAssets 中的小图。
        // public 下的 .glb 大模型不进 precache（默认 globPatterns 不含 .glb）。
        globPatterns: ['**/*.{html,js,css,ico,jpg,png,svg,woff,woff2}'],
        globIgnores: ['**/*.glb', '**/models/**', '**/promo/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // 导航请求离线兜底：仅当导航失败且无缓存 HTML 时回退到离线页。
        navigateFallback: '/offline.html',
        // 排除 API / 模型 / 静态资源路径，避免它们被错误回退到离线页。
        navigateFallbackDenylist: [/^\/api\//, /^\/models\//, /^\/brand\//, /^\/icons\//, /^\/portraits\//, /^\/videos\//, /^\/skills\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // R5: 核心首屏世界模型（广场地面/通用化身）——StaleWhileRevalidate，
            // 二次访问离线可用；条目数/时长封顶，避免磁盘膨胀。
            urlPattern: ({ url }) =>
              url.pathname === '/models/world/plaza.glb' ||
              url.pathname === '/models/world/avatar.glb' ||
              url.pathname === '/models/world/plaza-texture.jpg',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'core-world-models',
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
          {
            // 其余 3D 模型（100+ 名人 GLB）：永不缓存，每次走网络
            // （数量大、体积大，避免占用磁盘 + 版本更新及时生效）
            urlPattern: ({ request, url }) =>
              url.pathname.endsWith('.glb') || url.pathname.startsWith('/models/'),
            handler: 'NetworkOnly',
          },
          {
            // 品牌 logo：网络优先，改版后立即生效
            urlPattern: ({ url }) => url.pathname.startsWith('/brand/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'brand-assets',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // 图片（名人头像、logo）：StaleWhileRevalidate
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
          {
            // 字体：缓存优先
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // JS / CSS / HTML：NetworkFirst（保证能拿到新版本）
            urlPattern: ({ request }) =>
              request.destination === 'script' ||
              request.destination === 'style' ||
              request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'static-resources',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: webPort,
    proxy: {
      // The API exposes its liveness route at /health (no /api prefix); alias it
      // so the frontend can probe it through the same /api origin.
      '/api/health': { target: `http://localhost:${apiPort}`, rewrite: () => '/health' },
      '/api': { target: `http://localhost:${apiPort}`, ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // R5: three.js 全家桶单独成 chunk，首屏非 3D 页不加载
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
          // R5: React 运行时 + 图标库单独成 chunk，长期缓存
          'react-vendor': ['react', 'react-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
