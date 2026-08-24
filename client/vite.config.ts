import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            // Overwrite this value so a LAN caller cannot forge a loopback origin.
            proxyRequest.setHeader(
              'x-xiangqi-proxy-client-address',
              request.socket.remoteAddress || '',
            )
          })
        },
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/gomoku-ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
