import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api':       'http://localhost:3001',
      '/state':     'http://localhost:3001',
      '/tasks':     'http://localhost:3001',
      '/templates': 'http://localhost:3001',
      '/chat':      'http://localhost:3001',
      '/skills':    'http://localhost:3001',
      '/stats':     'http://localhost:3001',
      '/shop':      'http://localhost:3001',
      '/snapshots': 'http://localhost:3001',
      '/calendar':  'http://localhost:3001',
      '/config':    'http://localhost:3001',
      '/notifications': 'http://localhost:3001',
      '/leisure':      'http://localhost:3001',
    }
  },
  build: { outDir: 'dist' }
})