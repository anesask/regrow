import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // link previews need an absolute image URL; without VITE_PUBLIC_URL it falls back to a relative path
  const publicUrl = (loadEnv(mode, process.cwd(), 'VITE_').VITE_PUBLIC_URL ?? '').replace(/\/$/, '')
  return {
    plugins: [react(), { name: 'public-url', transformIndexHtml: (html: string) => html.replaceAll('__PUBLIC_URL__', publicUrl) }],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:8000' },
    },
  }
})
