import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  SIG_SCHEMA, SIG_OWNER, SIG_REPO, SIG_ALLOW, SIG_DIGEST, SIG_SHORT, SIG_TOKEN,
  MARK_FULL, encodeMarks,
} from '../server/lib/attest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = path.join(ROOT, 'build')
const WORK = path.join(BUILD, '.work')
const OUT = path.join(ROOT, 'dist')
const WEB_DIST = path.join(ROOT, 'web', 'dist')

const args = process.argv.slice(2)
const has = (f) => args.includes('--' + f)
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }

// --out 允许换名输出：exe 正在运行时 dist/lepao.exe 会被占用，用这个绕开
const EXE = path.resolve(ROOT, arg('out', 'dist/lepao.exe'))
const EXE_NAME = path.basename(EXE)

const log = (m) => console.log(`[build] ${m}`)
const die = (m) => { console.error(`[build] 失败：${m}`); process.exit(1) }
const WIN = process.platform === 'win32'

// banner 与可执行文件附带的标识信息
const SIG_BANNER = [
  `/*! lepao | ${SIG_OWNER} | ${SIG_REPO} | ${SIG_SHORT} | ${SIG_DIGEST}`,
  ` *  ${encodeMarks(MARK_FULL)}`,
  ' */',
  '',
].join('\n')
const SIG_MAGIC = Buffer.from('\n\u0000LP-SIG\u0000', 'latin1')
const SIG_END = Buffer.from('\n\u0000LP-SIG-END\u0000', 'latin1')
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// PE 加载器不会读文件尾这段，运行不受影响；排查来源时可以捞出来
function stampExe (exe, bundle) {
  const payload = {
    schema: SIG_SCHEMA,
    project: 'lepao',
    owner: SIG_OWNER,
    repo: SIG_REPO,
    allow: SIG_ALLOW,
    digest: SIG_DIGEST,
    short: SIG_SHORT,
    token: SIG_TOKEN,
    bundleSha256: sha256(fs.readFileSync(bundle)),
    exeBytes: fs.statSync(exe).size,
    builtAt: new Date().toISOString(),
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  fs.appendFileSync(exe, Buffer.concat([
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍​‌‌‌‌‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​​‍​‌‌‌​‌​​‍​‌‌‌​​​​‍​‌‌‌​​‌‌‍​​‌‌‌​‌​‍​​‌​‌‌‌‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌​‌​​‌‍​‌‌‌​‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​‌‍​‌‌​​​‌​‍​​‌​‌‌‌​‍​‌‌​​​‌‌‍​‌‌​‌‌‌‌‍​‌‌​‌‌​‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌‌​‌​‌‍​‌‌​‌​​‌‍​‌‌​‌​​​‍​‌‌​​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌‌‍​​‌‌​​​‌‍​​‌‌​​‌​‍​​‌‌​​‌‌‍​​‌​‌‌‌‌‍​‌‌​‌‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌‌​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌​‌‌​‌‍​‌‌​​‌​‌‍⁣
    SIG_MAGIC,
    body,
    Buffer.from('\n', 'utf8'),
    Buffer.from(encodeMarks(MARK_FULL), 'utf8'),
    SIG_END,
  ]))
  const tail = fs.readFileSync(exe)
  if (tail.indexOf(SIG_MAGIC) < 0 || tail.indexOf(payload.bundleSha256) < 0) die('附加标识写入失败')
  fs.writeFileSync(path.join(path.dirname(exe), '.lepao-sig.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8')
  log(`已写附加标识（${SIG_SHORT}）`)
  return payload
}

function run (cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, { cwd: ROOT, stdio: 'inherit', ...opts })
}

function runNodeTool (name, argv, cwd = ROOT) {
  if (WIN) {
    return execFileSync(`${name} ${argv.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`, {
      cwd, stdio: 'inherit', shell: true,
    })
  }
  return execFileSync(name, argv, { cwd, stdio: 'inherit' })
}

function esbuildBin () {
  const exe = path.join(ROOT, 'node_modules', '@esbuild', `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`, 'esbuild.exe')
  if (fs.existsSync(exe)) return exe
  const alt = path.join(ROOT, 'node_modules', '.bin', WIN ? 'esbuild.cmd' : 'esbuild')
  if (fs.existsSync(alt)) return alt
  die('找不到 esbuild，先执行：npm i -D esbuild')
}

if (!has('skip-web')) {
  log('构建前端 web/dist …')
  if (!fs.existsSync(path.join(ROOT, 'web', 'node_modules'))) {
    log('安装前端依赖 …')
    runNodeTool('npm', ['install', '--loglevel=error'], path.join(ROOT, 'web'))
  }
  runNodeTool('npm', ['run', 'build'], path.join(ROOT, 'web'))
}
if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) die('web/dist/index.html 不存在，先构建前端')

fs.mkdirSync(WORK, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

const bundle = path.join(WORK, 'server.cjs')
log('esbuild 打包服务端 → 单 CJS …')
run(esbuildBin(), [
  'server/index.mjs',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node20',
  '--packages=bundle',
  '--outfile=' + bundle,
  '--log-level=warning',
  '--banner:js=' + SIG_BANNER,
])

function walk (dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, base, acc)
    else if (e.isFile()) acc.push(full)
  }
  return acc
}

const files = walk(WEB_DIST)
if (!files.length) die('web/dist 为空')
const assets = {}
for (const f of files) {
  assets['web/dist/' + path.relative(WEB_DIST, f).replace(/\\/g, '/')] = f
}
log(`内嵌静态资源 ${Object.keys(assets).length} 个（${(files.reduce((a, f) => a + fs.statSync(f).size, 0) / 1024).toFixed(0)} KB）`)

const seaConfig = {
  main: bundle,
  output: EXE,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
}
const cfgPath = path.join(WORK, 'sea-config.json')
fs.writeFileSync(cfgPath, JSON.stringify(seaConfig, null, 2))

log('node --build-sea 生成单文件 exe …')
try {
  run(process.execPath, ['--build-sea=' + cfgPath])
} catch (e) {
  const msg = String(e?.stderr || e?.message || e)
  if (/busy or locked|EBUSY|EPERM/i.test(msg)) {
    die(`目标 exe 被占用（${EXE_NAME} 正在运行或被杀软锁定）：\n         1) 关掉正在跑的 ${EXE_NAME} 再重试；\n         2) 或换名输出：node build/make-exe.mjs --skip-web --out dist/lepao2.exe`)
  }
  die('node --build-sea 失败：' + msg.split('\n').slice(0, 3).join(' '))
}

if (!fs.existsSync(EXE)) die('未生成 ' + EXE)
const mb = (fs.statSync(EXE).size / 1024 / 1024).toFixed(1)
log(`完成：${path.relative(ROOT, EXE).replace(/\\/g, '/')}  ${mb} MB`)

// 附加标识（PE 加载器忽略，排查来源时可读）
stampExe(EXE, bundle)

const outDir = path.dirname(EXE)

// 设备控制台在 exe 里按 exe 同级的 analysis/ 与 platform-tools/ 找依赖，打包时一起带上
const COMPANIONS = [
  'analysis/frida/runner.py',
  'analysis/frida/amap3.js',
  'analysis/feed.sh',
]
const ADB_FILES = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll']

function copyCompanions (dir) {
  const copied = []
  const missing = []
  const locked = []
  const put = (src, dst, label) => {
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
      copied.push(label)
    } catch (e) {
      // adb 正在跑（daemon 或设备页）时目标文件被占用：保留现有文件，不中止构建
      if (e?.code === 'EBUSY' || e?.code === 'EPERM' || e?.code === 'EACCES') {
        if (!fs.existsSync(dst)) throw e
        locked.push(label)
        return
      }
      throw e
    }
  }

  for (const rel of COMPANIONS) {
    const src = path.join(ROOT, rel)
    if (!fs.existsSync(src)) { missing.push(rel); continue }
    put(src, path.join(dir, rel), rel)
  }
  if (missing.length) die('缺少设备注入依赖：' + missing.join('、'))

  const adbDir = path.join(ROOT, 'tools', 'platform-tools')
  let adb = 0
  for (const name of ADB_FILES) {
    const src = path.join(adbDir, name)
    if (!fs.existsSync(src)) continue
    put(src, path.join(dir, 'platform-tools', name), 'platform-tools/' + name)
    adb += 1
  }
  if (!adb) log('未找到 tools/platform-tools/adb.exe，exe 不带 adb（可设 LP_ADB 指向外部 adb）')
  log(`随包复制 ${copied.length} 个文件（设备控制台依赖）`)
  if (locked.length) log(`跳过 ${locked.length} 个被占用的文件（先关掉正在运行的 adb / exe 再重打包即可更新）：${locked.join('、')}`)
}

copyCompanions(outDir)

fs.writeFileSync(path.join(outDir, 'README.txt'), [
  '步道乐跑 · 单文件客户端',
  '',
  `项目地址：${SIG_REPO}`,
  `作者：${SIG_OWNER}   ·   ${SIG_ALLOW}`,
  `版本标识：${SIG_SHORT}`,

  '',
  `双击 ${EXE_NAME} 即可，默认 http://127.0.0.1:8787`,
  '',
  '常用参数：',
  `  ${EXE_NAME} --port 9000          换端口`,
  `  ${EXE_NAME} --host 0.0.0.0       允许局域网访问`,
  '',
  '环境变量：',
  '  LP_PORT      端口',
  '  LP_HOST      监听地址',
  '  LP_ROOT      数据目录（默认 exe 同级）',
  '  LP_ADB       adb.exe 路径（默认用同目录 platform-tools）',
  '  LP_PYTHON    python.exe 路径（frida 注入才需要）',
  '',
  '设备控制台：',
  '  analysis/         frida 注入脚本，已随包，勿删',
  '  platform-tools/   adb，已随包（不可用时设 LP_ADB 指向外部 adb）',
  '  frida 注入还需要本机 python + frida：pip install frida',
  '',
  '登录态存在 exe 同级的 data/session.json，整个文件夹拷走即带走登录。',
  '',
  '授权：源码可见，禁止倒卖 / RESALE PROHIBITED。',
  '本项目源码可见，禁止倒卖；请保留出处与作者信息。',
  '',
  encodeMarks(MARK_FULL),
  '',
].join('\r\n'), 'utf8')

log('写出 README.txt')
