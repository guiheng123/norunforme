'use strict'

const HEX32 = /^[0-9A-Fa-f]{32}$/
const INTERESTING_KEY = /token|uid|user|device|school|student/i

function interesting(v) {
  if (typeof v !== 'string' || v.length < 8) return false
  if (HEX32.test(v)) return true
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  if (v.length > 24 && !/\s/.test(v)) return true
  return false
}

function out(tag, key, value) {
  console.log(`[${tag}] ${key} = ${value}`)
}

Java.perform(function () {
  console.log('[*] lepao-token.js 已注入')

  try {
    const MMKV = Java.use('com.tencent.mmkv.MMKV')

    const dec = MMKV.decodeString.overload('java.lang.String', 'java.lang.String')
    dec.implementation = function (key, def) {
      const r = dec.call(this, key, def)
      if (interesting(r) || INTERESTING_KEY.test(String(key))) out('MMKV.decode', key, r)
      return r
    }

    const enc = MMKV.encodeString.overload('java.lang.String', 'java.lang.String')
    enc.implementation = function (key, val) {
      if (interesting(val) || INTERESTING_KEY.test(String(key))) out('MMKV.encode', key, val)
      return enc.call(this, key, val)
    }
  } catch (e) {
    console.log('[!] MMKV hook 失败：' + e)
  }

  try {
    const Impl = Java.use('android.app.SharedPreferencesImpl')
    Impl.getString.implementation = function (k, d) {
      const r = Impl.getString.call(this, k, d)
      if (interesting(r) || INTERESTING_KEY.test(String(k))) out('SP.get', k, r)
      return r
    }
  } catch (e) {
    console.log('[!] SharedPreferences hook 失败：' + e)
  }

  try {
    const Cursor = Java.use('android.database.AbstractCursor')
    const gs = Cursor.getString.overload('int')
    gs.implementation = function (i) {
      const r = gs.call(this, i)
      if (interesting(r)) {
        let name = ''
        try {
          name = this.getColumnName(i)
        } catch (e) {
        }
        out('Cursor.getString', name || '#' + i, r)
      }
      return r
    }
  } catch (e) {
    console.log('[!] Cursor hook 失败：' + e)
  }

  try {
    const B = Java.use('okhttp3.Request$Builder')
    B.build.implementation = function () {
      const req = this.build()
      try {
        const url = req.url().toString()
        if (/lptiyu|api\.php/i.test(url)) {
          console.log(`[HTTP] ${req.method()} ${url}`)
          const h = req.headers().toString()
          if (h.trim()) console.log('[HTTP] headers: ' + h.replace(/\n/g, ' | '))
        }
      } catch (e) {
      }
      return req
    }
  } catch (e) {
    console.log('[!] OkHttp hook 失败（可能用了别的网络库）：' + e)
  }

  try {
    const Buf = Java.use('okio.Buffer')
    const wu = Buf.writeUtf8.overload('java.lang.String')
    wu.implementation = function (s) {
      if (interesting(s)) out('okio.writeUtf8', 'body', s.slice(0, 400))
      return wu.call(this, s)
    }
  } catch (e) {
    console.log('[!] okio hook 失败：' + e)
  }

  console.log('[*] hook 就绪，去 App 里点一次登录 / 进首页触发请求')
})
