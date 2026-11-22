'use strict'

let TRACK = []
let START_MS = 0
const FRAME_MS = 1800

rpc.exports = {
  setTrack(t, s) {
    TRACK = t
    START_MS = s
    return TRACK.length
  },
  progress() {
    if (!TRACK.length) return -1
    const i = Math.floor((Date.now() - START_MS) / FRAME_MS)
    return Math.min(i, TRACK.length - 1)
  },
  peek(i) {
    return TRACK[i] || null
  },
}

function idx() {
  if (!TRACK.length) return -1
  const i = Math.floor((Date.now() - START_MS) / FRAME_MS)
  return Math.min(i, TRACK.length - 1)
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
}

Java.performNow(function () {
  const L = Java.use('android.location.Location')

  L.isMock.implementation = function () {
    return false
  }

  L.getLatitude.implementation = function () {
    const i = idx()
    return i < 0 ? this.getLatitude.call(this) : TRACK[i][0]
  }

  L.getLongitude.implementation = function () {
    const i = idx()
    return i < 0 ? this.getLongitude.call(this) : TRACK[i][1]
  }

  L.getSpeed.implementation = function () {
    return idx() < 0 ? this.getSpeed.call(this) : 2.9
  }

  L.getAccuracy.implementation = function () {
    return idx() < 0 ? this.getAccuracy.call(this) : 5.0
  }

  L.getTime.implementation = function () {
    return idx() < 0 ? this.getTime.call(this) : Date.now()
  }

  send({ stage: 'hooked', methods: 6 })
})
