import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const server = `http://127.0.0.1:${process.env.HQ_PORT ?? 4317}`

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4318,
    strictPort: true,
    // A half-saved file should not cover the office with an error page. Errors
    // still show in this terminal and the browser console, and the last working
    // code keeps running until the file is fixed.
    hmr: { overlay: false },
    proxy: {
      '/api': server,
      '/ws': { target: server, ws: true },
    },
  },
})
