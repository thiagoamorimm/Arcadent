import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    // Em dev o front chama /api na mesma origem; o Vite repassa para o Spring Boot.
    proxy: { '/api': 'http://localhost:8090' },
  },
})
