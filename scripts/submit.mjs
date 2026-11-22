import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
import { submitRun } from './lib/submit-core.mjs'
import { STEPS, STEP_ORDER } from './lib/protocol.mjs'
import { installExitShim } from './lib/exit.mjs'

installExitShim()

const argv = process.argv.slice(2)
const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d
}
const has = (n) => argv.includes('--' + n)

const runDir = String(arg('run', 'out/run-latest'))
const dryRun = has('dry-run') || has('probe')
const probeOnly = has('probe')

if (!existsSync(join(runDir, 'run.json'))) {
  console.error(`缺少 ${runDir}/run.json，先跑 node scripts/sim-run.mjs`)
  process.exit(1)
}

const runInfo = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'))
const track = JSON.parse(readFileSync(join(runDir, 'track.json'), 'utf8'))
const meta = runInfo.meta
const points = Array.isArray(track) ? track : track.points
const session = JSON.parse(readFileSync('creds.json', 'utf8'))
const zoneId = String(arg('zone', meta.zoneId ?? '') ?? '')

const hits = (meta.checkpoints ?? [])
  .filter((c) => c.hit)
  .map((c) => ({
    id: c.id ?? c.point_id,
    time: Number(c.time ?? meta.startTime + Math.round((c.atSec ?? 0))),
  }))

const skipAuthProbe = probeOnly
const stepNum = runInfo.sensors?.steps?.total ?? 0

console.log('=== 提交模拟跑步 ===\n')
console.log(`轨迹目录 ：${runDir}`)
console.log(
  `距离/用时：${meta.distanceKm} km / ${meta.duration}s（配速 ${Math.floor(
    meta.duration / 60 / meta.distanceKm,
  )}'${String(Math.round(meta.duration / meta.distanceKm) % 60).padStart(2, '0')}"）`,
)
console.log(`轨迹点   ：${points.length} 个`)
console.log(`打卡命中 ：${hits.length}/${(meta.checkpoints ?? []).length}`)
console.log(`步数     ：${stepNum}`)

console.log('\n--- 链路 ---')
for (const k of STEP_ORDER) {
  const s = STEPS[k]
  const ep = s.local ? '(本地动作)' : s.candidates[0]
  console.log(`  ${String(s.order).padStart(2)} ${k.padEnd(8)} ${ep.padEnd(26)} ostype=${s.channel}${s.required ? '  [必需]' : ''}`)
}
console.log('')

if (skipAuthProbe) {
  console.log('probe 模式：跳过鉴权与提交，只列出链路。')
  process.exit(0)
}

const res = await submitRun({
  session,
  points,
  meta,
  stepNum,
  zoneId,
  hits,
  dryRun,
  onLog: ({ step, label, state, detail }) => {
    const mark =
      state === 'ok' ? '✅' : state === 'fail' ? '❌' : state === 'authfail' ? '🔒' : state === 'miss' ? '·' : '·'
    console.log(`  ${mark} [${step}] ${label} — ${state}${detail ? `：${detail}` : ''}`)
  },
})

if (dryRun) {
  writeFileSync(join(runDir, 'submit-dry.json'), JSON.stringify(res, null, 2))
  console.log(`\n[dry-run] 已写出 ${runDir}/submit-dry.json（${res.steps?.length ?? 0} 个请求体）`)
  process.exit(0)
}

writeFileSync(join(runDir, 'submit-result.json'), JSON.stringify(res, null, 2))
console.log(`\n结果：${res.ok ? '✅ 提交成功' : `❌ 失败（code=${res.code} reason=${res.reason ?? '-'}）`}`)
if (res.hint) console.log(`提示：${res.hint}`)
process.exit(res.ok ? 0 : res.code ?? 5)
