/**
 * amap3：同 amap2，但索引**循环**（跑到轨迹末尾后从头继续），
 * 这样跑得越久里程越大，配速不会被"跑到终点后时间空转"拖慢。
 */
'use strict'
let TRACK = []
let START_MS = 0
const FRAME_MS = 1800
const out = { loader: false, amap: false, err: null }

rpc.exports = {
  setTrack (t, s) { TRACK = t; START_MS = s; return TRACK.length },
  status () { const i = idx(); return { ...out, track: TRACK.length, idx: i } },
}

function idx () {
  if (!TRACK.length || !START_MS) return -1
  const n = TRACK.length
  const i = Math.floor((Date.now() - START_MS) / FRAME_MS)
  return ((i % n) + n) % n
}

function grab () {
  let found = null
  const V = Java.use('android.view.View')
  const orig = V.onLayout.overload('boolean', 'int', 'int', 'int', 'int')
  orig.implementation = function (a, b, c, d, e) {
    if (!found) {
      try {
        const cl = this.getClass().getClassLoader()
        if (cl && String(cl).indexOf('BootClassLoader') < 0) {
          try { cl.loadClass('com.lptiyu.tanke.activities.main.MainActivity'); found = cl } catch (err) {}
        }
      } catch (err) {}
    }
    return orig.call(this, a, b, c, d, e)
  }
  return () => found
}

Java.performNow(function () {
  const wait = grab()
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  let n = 0
  const t = setInterval(function () {
    const cl = wait()
    n++
    if (!cl && n < 120) return
    clearInterval(t)
    if (!cl) { send({ stage: 'no-loader' }); return }
    out.loader = true
    Java.classFactory.loader = cl
    try {
      const AL = Java.use('com.amap.api.location.AMapLocation')
      AL.getLatitude.implementation = function () {
        try { const i = idx(); if (i >= 0) return TRACK[i][0] } catch (e) {}
        return this.getLatitude()
      }
      AL.getLongitude.implementation = function () {
        try { const i = idx(); if (i >= 0) return TRACK[i][1] } catch (e) {}
        return this.getLongitude()
      }
      AL.getSpeed.implementation = function () {
        try { if (idx() >= 0) return 3.1 } catch (e) {}
        return this.getSpeed()
      }
      out.amap = true
      send({ stage: 'amap-loop-hooked' })
    } catch (e) { out.err = String(e).slice(0, 160); send({ stage: 'amap-err', msg: out.err }) }
  }, 500)
})
