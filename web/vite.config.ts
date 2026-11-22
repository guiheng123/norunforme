import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

import { NOTICE_REPO_PIN, noticeDigests, readSeal } from '../server/lib/notice-seal.mjs'

// 构建时给每个产物盖一枚轻量标记：可见的一行版权，加一段不可见的标识字符。
const SIG_OWNER = 'guiheng123'
const SIG_REPO = 'https://github.com/guiheng123/norunforme'
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
const SIG_SHORT = '985d6fde59b65883'
const SIG_DIGEST = '985d6fde59b65883cb55be25dbad62354818d2298335d268d8f976b97efc37ac'

const B0 = '\u200b'
const B1 = '\u200c'
const SEP = '\u200d'
const OPEN = '\u2060'
const CLOSE = '\u2063'

function encodeMarks (text: string): string {
  const bytes = new TextEncoder().encode(text)
  let out = OPEN
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) out += (byte >> i) & 1 ? B1 : B0
    out += SEP
  }
  return out + CLOSE
}

const MARK_FULL = encodeMarks(`sig/1|${SIG_SHORT}|${SIG_REPO}`)
const BANNER = `/*! lepao | ${SIG_OWNER} | ${SIG_REPO} | ${SIG_SHORT} | ${SIG_DIGEST}\n * ${MARK_FULL}\n */\n`

function buildMark (): Plugin {
  return {
    name: 'lepao-build-mark',
    enforce: 'post',
    transformIndexHtml (html) {
      return html.replace(/<\/head>/i, `<!--${MARK_FULL}--></head>`)
    },
    generateBundle (_options, bundle) {
      for (const [file, out] of Object.entries(bundle)) {
        if (out.type === 'chunk') out.code = BANNER + out.code
        else if (file.endsWith('.css')) out.source = BANNER + String(out.source)
      }
    },
  }
}

function noticeLock (): Plugin {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  return {
    name: 'lepao-notice-lock',
    apply: 'build',
    buildStart () {
      const d = noticeDigests(root)
      const seal = readSeal(root)
      const bad =
        d.missing.length > 0 ||
        d.broken ||
        !seal.present ||
        !seal.hasFallback ||
        seal.text !== d.text ||
        seal.view !== d.view ||
        seal.guard !== d.guard ||
        seal.hold !== d.hold ||
        d.repo !== NOTICE_REPO_PIN ||
        d.items < 10
      if (bad) this.error('[build] E-N1 资源与封存记录不一致')
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = process.env.LP_API_TARGET || env.LP_API_TARGET || 'http://127.0.0.1:8787'
  const devHost = process.env.LP_DEV_HOST || env.LP_DEV_HOST || '127.0.0.1'
  const devPort = Number(process.env.LP_DEV_PORT || env.LP_DEV_PORT || 5273)

  return {
    plugins: [vue(), buildMark(), noticeLock()],
    server: {
      host: devHost,
      port: devPort,
      strictPort: false,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              if (err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
                console.error(
                  `\n[proxy] 连不上后端 ${apiTarget}\n` +
                    `        1) 后端是否已启动：node server/index.mjs --port 8787\n` +
                    `        2) 后端是否只监听了 127.0.0.1：非本机访问要加 --host 0.0.0.0\n` +
                    `        3) 后端在别的机器：设置 LP_API_TARGET=http://<ip>:8787 后再 npm run dev\n`,
                )
              }
            })
          },
        },
        '/oss': {
          target: 'https://data.lptiyu.com',
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/oss/, ''),
        },
      },
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 900,
    },
  }
})
