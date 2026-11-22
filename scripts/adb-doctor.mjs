import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { adbSelfCheck, listDevices, hasRoot, deviceInfo, currentActivity, grepFiles, shellRoot, PKG, DEFAULT_ADB_CANDIDATES } from './lib/adb.mjs'

async function detectAppDeviceId (adb, serial) {
  const g = await grepFiles(`/data/data/${PKG}`, '00000000-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', { adb, serial, root: true })
  if (!g.ok || !g.files.length) return ''
  const r = await shellRoot(
    `grep -rhoaE '00000000-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' /data/data/${PKG} 2>/dev/null | grep -v '00000000-0000-0000-0000-000000000000' | sort | uniq -c | sort -rn | head -1`,
    { adb, serial, timeout: 120000 },
  )
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(r.stdout || ''))
  return m ? m[1] : ''
}

const argv = process.argv.slice(2)
const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d) : d
}
const explicit = arg('adb', undefined)

const mark = (ok) => (ok ? '✓' : '✗')
const lines = []

const sc = await adbSelfCheck(explicit)
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
lines.push(`[1] adb 可执行文件`)
lines.push(`    使用：${sc.bin}`)
lines.push(`    ${mark(sc.found && sc.ok)} 存在=${sc.found} 可执行=${sc.ok}${sc.version ? '  ' + sc.version : ''}`)
if (sc.error) lines.push(`    错误：${String(sc.error).split('\n')[0]}`)

lines.push(`\n[2] 候选路径（第一个存在的会被使用）`)
for (const c of sc.candidates) {
  const tag = c.path === 'adb' ? 'PATH 里的 adb' : c.path
  lines.push(`    ${c.exists === null ? '·' : mark(c.exists)} ${tag}`)
}

lines.push(`\n[3] 设备`)
if (!sc.found || !sc.ok) {
  lines.push(`    ✗ adb 跑不起来，后面跳过。修法二选一：`)
  lines.push(`        a) 把整个 platform-tools 目录放到 ${resolve('tools/platform-tools')}`)
  lines.push(`        b) 设环境变量 LP_ADB=<adb.exe 绝对路径>（. .\\env.ps1 可临时生效）`)
} else {
  const d = await listDevices(explicit)
  lines.push(`    ${mark(d.ok)} adb devices -l → ${d.ok ? `${d.devices.length} 台` : d.error || '失败'}`)
  for (const dev of d.devices ?? []) {
    lines.push(`      · ${dev.serial} (${dev.state}) model=${dev.model ?? '-'} product=${dev.product ?? '-'}`)
  }
  if (d.preferred) lines.push(`    本次会使用：${d.preferred}`)
  const dev = (d.devices ?? []).find((x) => x.serial === d.preferred)
  if (dev?.state === 'device') {
    const root = await hasRoot(explicit, dev.serial)
    const info = await deviceInfo({ adb: explicit, serial: dev.serial })
    const act = await currentActivity({ adb: explicit, serial: dev.serial })
    lines.push(`\n[4] 这台设备`)
    lines.push(`    root：${root ? '有（可直接读 /data/data）' : '无（只能走 logcat / 外部存储）'}`)
    const devId = await detectAppDeviceId(explicit, dev.serial)
    lines.push(`    指纹（服务端按它定位会话）：mobileModel=${info.mobileModel || '(缺)'} mobileOsVersion=${info.mobileOsVersion || '(缺)'} mobileDeviceId=${devId || "''（没找到，见下）"}`)
    lines.push(`    android_id（不是 mobileDeviceId，填它必 101）：${info.androidId || '-'}`)
    lines.push(`    乐跑 App：${act?.startsWith(PKG) ? '在前台' : act ? `不在前台（当前 ${act}）` : '无法判断'}`)
  }
}

lines.push(`\n提示：mobileDeviceId 必须是 App 实际发出的那个设备 UUID（形如 00000000-xxxx-xxxx-xxxx-xxxxxxxxxxxx），`)
lines.push(`      它写在 App 数据目录的 WebView Local Storage 里。填 android_id、旧机 UUID 会得到 101，`)
lines.push(`      留空则服务端回 \`0 系统错误\`（看起来像服务器挂了，其实是这个字段）。`)
lines.push(`      直接跑 node scripts/sync-device.mjs 会自动取到三项并写进 data/session.json。`)

console.log(lines.join('\n'))
