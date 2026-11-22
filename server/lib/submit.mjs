import { randomBytes, randomUUID } from 'node:crypto'
import { LepaoClient } from './lp-client.mjs'
import { ossPut, packTrackFile, callbackHeader, RUN_RECORD_PREFIX } from './oss.mjs'
import { analyzeStats, diagnose, verdictOf } from './sim.mjs'
import { load } from './session.mjs'
import { clockOf, planTiming, resolveStart } from './timing.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class SubmitJob {
  constructor (id, payload) {
    this.id = id
    this.payload = payload || {}
    this.state = 'running'
    this.steps = []
    this.verdict = { pass: false, reasons: [] }
    this.createdAt = Date.now()
  }

  async step (name, label, fn) {
    const t0 = Date.now()
    try {
      const detail = await fn()
      this.steps.push({ step: name, label, state: 'ok', detail: String(detail ?? 'ok').slice(0, 400), ms: Date.now() - t0 })
      return true
    } catch (e) {
      this.steps.push({ step: name, label, state: 'fail', detail: String(e.message || e).slice(0, 400), ms: Date.now() - t0 })
      return false
    }
  }

  async run () {
    const s = load()
    const client = new LepaoClient(s)
    const pts = this.payload.points || []
    const cps = this.payload.checkpoints || []
    const meta = this.payload.meta || {}
    const intervalMs = meta.intervalMs || 1800

    const stats = analyzeStats(pts, intervalMs)

    const okAuth = await this.step('auth', '鉴权校验（User/User）', async () => {
      const r = await client.plain('User/User')
      if (String(r.info || '').includes('版本过低')) {
        throw new Error(`版本门禁未过（version_name=${client.s.version_name}）：${r.info}。设 LP_VERSION_NAME=4.3.3 后重启服务`)
      }
      if (r.status === 101 || r.status === 102) throw new Error(`${r.status} ${r.info}`)
      if (r.status !== 1) throw new Error(`status=${r.status} ${r.info || ''}`)
      return `uid=${s.uid} 昵称=${r.dec?.name ?? '-'}`
    })
    if (!okAuth) { this.finish(false, ['鉴权失败，token 已失效或被其它设备顶号']); return }

    let rules = meta.rules || null
    const okZone = await this.step('zone', '拉取跑区与判定规则（beforeRunV260）', async () => {
      const r = await client.keyed('Run2/beforeRunV260')
      if (r.status !== 1) {
        if (r.dec) return 'beforeRun 未通过，沿用缓存规则'
        if (String(r.status) === '0' && /系统错误/.test(String(r.info || ''))) {
          throw new Error(
            `status=0 系统错误（上游原话）。本次发出的指纹是 ${client.s.mobileModel} / ${client.s.mobileDeviceId ? client.s.mobileDeviceId.slice(0, 8) + '…' : '空'} / ${client.s.mobileOsVersion}：` +
              'key= 通道在指纹与 token 不配套时会崩成「系统错误」而不回 101/102。' +
              '4.3.3 起 mobileDeviceId 必须是 App 真实发出去的那个设备 UUID（空串必崩）。' +
              '用手机 App 抓一条 User/User，再 node scripts/import-har.mjs <文件>.har --save 同步一次即可',
          )
        }
        throw new Error(`status=${r.status} ${r.info || ''}`)
      }
      const d = r.dec || {}
      const tr = (d.time_rule_arr && d.time_rule_arr[0]) || {}
      rules = {
        zoneId: String(d.run_zone_id || ''),
        zoneName: d.run_zone_name || '',
        minDistanceKm: Number(tr.min_distance || 1.5),
        maxDistanceKm: Number(tr.max_distance || 10),
        minPaceSec: Number(tr.min_pace || 540),
        maxPaceSec: Number(tr.max_pace || 180),
        minLogNum: Number(tr.min_log_num || 2),
        pointNumOnline: Number(tr.point_num_online || 2),
        termId: String(d.term_id || ''),
      }
      return `跑区 ${d.run_zone_name} 规则 ${rules.minDistanceKm}km / ${rules.minPaceSec}s`
    })
    if (!okZone) { this.finish(false, ['跑区接口不可用']); return }

    const okDistance = await this.step('distance', '里程达标预检（去噪后口径）', async () => {
      const minKm = Number(rules?.minDistanceKm || 1.5)
      const have = Number(stats.distanceKm || 0)
      if (have < minKm) {
        const raw = Number(meta.previewKm || 0)
        const gapText = raw > 0
          ? `（预览页给的是未去噪的 ${raw.toFixed(2)} km，去噪后少了 ${(raw - have).toFixed(2)} km）`
          : ''
        throw new Error(
          `去噪后 ${have.toFixed(2)} km < 规则下限 ${minKm} km${gapText}。` +
            `把目标里程提到约 ${(minKm * 1.15).toFixed(1)} km 以上再提交`,
        )
      }
      return `${have.toFixed(2)} km ≥ ${minKm} km`
    })
    if (!okDistance) { this.finish(false, ['里程不达标，本次未提交（避免白跑一次配额）']); return }

    const nowTs = Math.floor(Date.now() / 1000)
    const usedTime = Math.max(60, Number(stats.durationSec || Math.round((pts.length - 1) * (intervalMs / 1000))))
    const start = resolveStart({ meta, usedTime, nowTs })
    const timing = planTiming({
      wantedTs: start.wantedTs,
      usedTime: start.usedTime,
      nowTs,
      mode: start.mode,
    })
    const startTs = timing.startTs
    const endTs = timing.endTs
    const startNote = timing.note
    const modeText = timing.mode === 'at'
      ? (start.legacy ? '手动时刻（旧前端无 startMode，已按时间反推）' : '手动时刻')
      : '按现在倒推'
    this.steps.push({
      step: 'timing',
      label: '开跑 / 停表时刻',
      state: 'ok',
      detail: `${clockOf(startTs)} 开跑 · ${clockOf(endTs)} 停表（用时 ${usedTime}s + 余量 ${timing.spanSlack}s）｜${modeText}｜${timing.note}`,
      ms: 0,
    })

    const pinnedIds = Array.isArray(meta.pinned) ? meta.pinned.map(String) : []
    const pinnedCps = pinnedIds.length
      ? cps.filter((c) => pinnedIds.includes(String(c.id)))
      : []
    const plannedPool = pinnedCps.length ? pinnedCps : cps.filter((c) => c.hit)
    const need = Math.max(2, Number(rules?.minLogNum || 2))
    const passAt = (lat, lng) => {
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(
          (pts[i].a - lat) * 111320,
          (pts[i].o - lng) * 111320 * Math.cos((lat * Math.PI) / 180),
        )
        if (d <= 25) return i
      }
      return -1
    }
    const candidates = plannedPool
      .filter((c) => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)))
      .map((c) => ({ c, at: passAt(Number(c.lat), Number(c.lng)) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)
    const picked = []
    const minGapFrames = Math.round(60 / (intervalMs / 1000))
    for (const x of candidates) {
      if (picked.length >= need) break
      if (picked.some((y) => Math.abs(y.at - x.at) < minGapFrames)) continue
      picked.push(x)
    }
    for (const x of candidates) {
      if (picked.length >= need) break
      if (!picked.includes(x)) picked.push(x)
    }
    const planned = (picked.length >= 2 ? picked : candidates).map((x) => x.c).slice(0, need)
    let runStr = ''
    const okTime = await this.step('time', '服务端时间校准 + 会话握手（getTimestampV278）', async () => {
      const r = await client.handshake({
        gameId: Number(rules?.zoneId || 1),
        pointIds: planned.map((c) => c.id),
      })
      if (r.status !== 1) throw new Error(`status=${r.status} ${r.info || ''}`)
      runStr = r.runStr
      if (!runStr) throw new Error('握手没拿到 str：stopRun 会判 100 上传数据失败')
      return `server=${r.serverTs} septal=${r.septal} str=${runStr} 计划打卡 ${planned.length} 点`
    })
    if (!okTime) { this.finish(false, ['会话握手失败，结算必然 100']); return }
    if (planned.length < 2) { this.finish(false, ['命中打卡点不足 2 个，先调整手绘路线']); return }

    {
      const before = this.steps.length
      await this.step('loc', '途经点上报（setRunLocationRecord）', async () => {
        const count = Math.min(Number(meta.reportCount || 6), 30)
        const stride = Math.max(1, Math.floor(pts.length / count))
        let ok = 0
        let last = ''
        for (let i = 0; i < count; i++) {
          const p = pts[Math.min(pts.length - 1, i * stride)]
          const hitIds = planned.map((c) => c.id).slice(0, 2).join(',')
          const r = await client.setLocation({
            lat: p.a, lng: p.o, gameId: Number(rules?.zoneId || 1), pointIds: i === count - 1 ? hitIds : '',
          })
          last = `${r.status} ${r.info || ''}`
          if (r.status === 1) ok++
          await sleep(350)
        }
        if (!ok) throw new Error(`全部失败：${last}`)
        return `${ok}/${count} 次上报成功（打卡收尾 ${planned.map((c) => c.id).join(',')}）`
      })
      const cur = this.steps[this.steps.length - 1]
      const hasDeviceParam = Boolean(client.s.lp54 || client.s.lpd3 || client.s.runStr)
      if (cur && cur.state === 'fail' && !hasDeviceParam && /非法请求/.test(cur.detail)) {
        this.steps[this.steps.length - 1] = {
          ...cur, state: 'skip',
          detail: '缺少 lp54（4.3.3 起设备指纹串的新名字，旧名 lpd3）：服务端对跑步类接口要求它。可在设备抓包中取得后随登录一起提交，或改用「设备模式」由 App 自己上报',
        }
      }
      void before
    }

    let ossKey = ''
    const okOss = await this.step('oss', '轨迹上传 OSS（getOssSts + PUT）', async () => {
      const r = await client.keyed('report/getOssSts')
      if (r.status !== 1 || !r.dec) throw new Error(`STS 获取失败 status=${r.status} ${r.info || ''}`)
      const sts = r.dec
      const pad = (n) => String(n).padStart(2, '0')
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
      const dEnd = new Date(endTs * 1000)
      const dayDir = `${dEnd.getFullYear()}-${pad(dEnd.getMonth() + 1)}-${pad(dEnd.getDate())}`
      const seg = String(100 + Math.floor(Math.random() * 900))
      ossKey = `${RUN_RECORD_PREFIX}/${dayDir}/${seg}/${randomUUID()}.txt`
      const body = packTrackFile(pts)
      const up = await ossPut(sts, ossKey, body, 'text/plain', callbackHeader(sts))
      if (!up.ok) throw new Error(`PUT ${up.status} ${up.body || ''}`)
      return `${(body.length / 1024).toFixed(1)} KB → ${ossKey}${up.status === 203 ? '（203 回调失败但已落盘）' : ''}`
    })
    if (!okOss) {
      this.finish(false, ['轨迹文件没传到 OSS：结算必然回 100，本次未提交'])
      return
    }

    const ptLatLng = pts.map((q) => [Number(q.a), Number(q.o)])
    const measure = (lat, lng) => {
      let best = Infinity
      for (const q of ptLatLng) {
        const dLat = (q[0] - lat) * 111320
        const dLng = (q[1] - lng) * 111320 * Math.cos((lat * Math.PI) / 180)
        const d = Math.hypot(dLat, dLng)
        if (d < best) best = d
      }
      return best
    }
    const worst = planned
      .map((c) => ({ c, d: measure(Number(c.lat), Number(c.lng)) }))
      .sort((x, y) => y.d - x.d)[0]
    if (worst && worst.d > 15) {
      throw new Error(
        `打卡点 ${worst.c.id}(${worst.c.name || ''}) 离轨迹最近 ${worst.d.toFixed(1)}m，超过 15m 会被判「打卡点异常」。` +
          ' 回到模拟页把路线织过该点后重新生成',
      )
    }

    const perKm = +(stats.distanceKm / Math.max(1, planned.length + 1)).toFixed(2)
    const pickDeclaredIndex = (startIdx, lat, lng) => {
      for (let i = Math.max(0, startIdx); i < pts.length; i++) {
        const d = Math.hypot(
          (pts[i].a - lat) * 111320,
          (pts[i].o - lng) * 111320 * Math.cos((lat * Math.PI) / 180),
        )
        if (d >= 30 && d <= 60) return i
      }
      return Math.min(pts.length - 1, startIdx + 12)
    }
    const declaredAt = planned.map((c) => {
      const hitIdx = passAt(Number(c.lat), Number(c.lng))
      return hitIdx >= 0 ? pickDeclaredIndex(hitIdx, Number(c.lat), Number(c.lng)) : 0
    })
    const segSec = [0]
    for (let i = 1; i < pts.length; i++) {
      const dm = Math.hypot(
        (pts[i].a - pts[i - 1].a) * 111320,
        (pts[i].o - pts[i - 1].o) * 111320 * Math.cos((pts[i].a * Math.PI) / 180),
      )
      const v = Math.max(0.5, Number(pts[i].s) || 3.1)
      segSec.push(segSec[i - 1] + dm / v)
    }
    const elapsedTrue = segSec[segSec.length - 1] || usedTime
    const scale = usedTime / elapsedTrue
    const absTimeOf = (idx) => {
      const t = startTs + Math.max(1, Math.round((segSec[Math.min(idx, segSec.length - 1)] || 0) * scale))
      return Math.min(endTs - 1, Math.max(startTs + 1, t))
    }
    const logData = planned.map((c, i) => {
      const idx = declaredAt[i]
      const f = pts[idx] || pts[0]
      return {
        distance: perKm,
        latitude: Number(Number(f.a).toFixed(6)),
        longtitude: Number(Number(f.o).toFixed(6)),
        point_id: Number(c.id) || 0,
        time: absTimeOf(idx),
      }
    })
    const dImg = new Date(endTs * 1000)
    const pad2 = (n) => String(n).padStart(2, '0')
    const imgDay = `${dImg.getFullYear()}-${pad2(dImg.getMonth() + 1)}-${pad2(dImg.getDate())}`
    const shotSeg = String(100 + Math.floor(Math.random() * 800))
    const fileImg = `Public/Upload/pic/run_photo_screenshotImage/${imgDay}/${shotSeg}/${randomUUID()}.png`
    const recordStr = randomBytes(16).toString('hex')

    const stopOk = await this.step('stop', '结束跑步并结算（stopRunV278）', async () => {
      const params = {
        distance: stats.distanceKm.toFixed(2),
        start_time: String(startTs),
        end_time: String(endTs),
        used_time: String(usedTime),
        game_id: String(rules?.zoneId || '1'),
        term_id: String(rules?.termId || '1'),
        step_num: '0',
        step_info: JSON.stringify({
          interval: 60,
          list: new Array(Math.max(1, Math.min(60, Math.round(usedTime / 60)))).fill(0),
        }),
        log_data: JSON.stringify(logData),
        record_file: ossKey || '',
        record_str: recordStr,
        record_img: '',
        file_img: fileImg,
        newMobileDeviceId: '',
        is_running_area_valid: '1',
        is_timeout_zfb: 0,
        error_code: '4004',
        gee_token: '',
        ip: '10.0.2.15',
        mac: '02:00:00:00:00:00',
        pass_effective_num: 0,
        pass_total: 0,
        run_check_res: '[]',
      }
      const r = await client.stopRun(params)
      if (r.status === 1) {
        const d = r.dec || {}
        const id = d.record_id || d.id || ''
        const counted = String(d.record_status ?? '1') === '1'
        const tail = counted
          ? '已计入有效次数'
          : `未计入：${d.record_failed_reason || '服务端未说明原因'}`
        this.timeInfo = {
          startTs,
          endTs,
          usedTime,
          spanSec: endTs - startTs,
          spanSlack: timing.spanSlack,
          startNote,
        }
        return `record_id=${id} ${d.distance ?? ''}km / ${d.time ?? ''}s · ${tail} · 起 ${new Date(startTs * 1000).toLocaleTimeString('zh-CN')} 止 ${new Date(endTs * 1000).toLocaleTimeString('zh-CN')}（用时 ${usedTime}s）`
      }
      if (r.status === 100) {
        const sent = [
          `file_img=${fileImg ? '有' : '空'}`,
          `record_file=${ossKey ? '有' : '空'}`,
          `log_data=${logData.length}点`,
        ].join(' / ')
        throw new Error(
          `100 上传数据失败（上游原话）：结算被服务端拒。本次已发出 ${sent}；` +
            '若字段都在，多半是会话被顶号或当日配额/时段问题，先回登录页点「从本地桥同步」验一次 token',
        )
      }
      if (r.status === 102) {
        throw new Error(`102 ${r.info || '该账号已在其他手机登录'}：token 被手机端登录顶掉了，重新登录并同步会话后再提交`)
      }
      if (r.status === 101) {
        throw new Error(`101 ${r.info || '登录信息失效'}：token 过期或设备指纹不匹配`)
      }
      throw new Error(`${r.status} ${r.info || ''}`.trim())
    })

    this.verdict = verdictOf(stats, cps, rules)
    this.finish(stopOk, stopOk ? [] : ['结算接口未通过，本次未计入有效次数'])
  }

  finish (ok, reasons) {
    this.state = ok ? 'done' : 'failed'
    if (reasons?.length) this.verdict = { pass: false, reasons }
    this.endedAt = Date.now()
  }

  toJSON () {
    return { state: this.state, steps: this.steps, verdict: this.verdict }
  }
}

export const jobs = new Map()
export function createJob (payload) {
  const id = 'sub_' + Math.random().toString(36).slice(2, 10)
  const job = new SubmitJob(id, payload)
  jobs.set(id, job)
  job.run().catch((e) => {
    job.steps.push({ step: 'internal', label: '内部错误', state: 'fail', detail: String(e.message || e), ms: 0 })
    job.finish(false, [String(e.message || e)])
  })
  return id
}
