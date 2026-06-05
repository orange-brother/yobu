import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

function loadLocalEnvValue(name: string): string {
  if (process.env[name]) {
    return process.env[name] ?? ''
  }

  const envPath = resolve('.env')
  if (!existsSync(envPath)) {
    return ''
  }

  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find(item => item.trim().startsWith(`${name}=`))
  if (!line) {
    return ''
  }

  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
}

export default defineConfig(() => {
  const googleClientId = loadLocalEnvValue('YOBU_GOOGLE_CLIENT_ID')
  const googleClientSecret = loadLocalEnvValue('YOBU_GOOGLE_CLIENT_SECRET')

  return {
    main: {
      define: {
        'process.env.YOBU_GOOGLE_CLIENT_ID': JSON.stringify(googleClientId),
        'process.env.YOBU_GOOGLE_CLIENT_SECRET': JSON.stringify(googleClientSecret),
      },
      plugins: [externalizeDepsPlugin()],
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
    },
    renderer: {
      root: resolve('src/renderer'),
      plugins: [vue()],
      build: {
        rollupOptions: {
          input: resolve('src/renderer/index.html'),
        },
      },
    },
  }
})
