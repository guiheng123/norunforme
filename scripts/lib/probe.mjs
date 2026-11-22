import { readFileSync } from 'node:fs'
import { makeClient } from './track-analysis.mjs'

const S = JSON.parse(readFileSync(new URL('../../creds.json', import.meta.url), 'utf8'))
export const call = makeClient(S)

export async function probe(mod, extra = {}, show = 200) {
  try {
    const r = await call(mod, extra)
    const d = JSON.stringify(r.data) ?? 'undefined'
    console.log(
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
      `${String(r.status).padStart(4)} | ${mod.padEnd(32)} | ${String(r.info ?? '').slice(0, 60)} | ${
        d
      }`,
    )
    return r
  } catch (e) {
    console.log(` ERR | ${mod.padEnd(32)} | ${e.message}`)
    return null
  }
}
