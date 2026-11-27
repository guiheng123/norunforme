import fs from 'node:fs'
import path from 'node:path'
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
import { fileURLToPath } from 'node:url'
import * as sea from 'node:sea'

export const IS_SEA = (() => {
  try {
    return Boolean(sea.isSea?.())
  } catch {
    return false
  }
})()

const ASSETS = (() => {
  if (!IS_SEA) return new Set()
  try {
    return new Set(sea.getAssetKeys())
  } catch {
    return new Set()
  }
})()

export function codeRoot () {
  if (IS_SEA) return path.dirname(process.execPath)
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    if (dir) return path.resolve(dir, '..', '..')
  } catch {
  }
  return path.dirname(process.execPath)
}

export function dataRoot () {
  if (process.env.LP_ROOT) return path.resolve(process.env.LP_ROOT)
  if (IS_SEA) return path.dirname(process.execPath)
  return codeRoot()
}

export function hasAsset (rel) {
  return ASSETS.has(rel.replace(/\\/g, '/'))
}

export function readAsset (rel) {
  const key = rel.replace(/\\/g, '/')
  if (ASSETS.has(key)) {
    try {
      return Buffer.from(sea.getAsset(key))
    } catch {
    }
  }
  try {
    return fs.readFileSync(path.join(dataRoot(), key))
  } catch {
    return null
  }
}

export function assetKeysUnder (prefix) {
  const p = prefix.replace(/\\/g, '/')
  return [...ASSETS].filter((k) => k.startsWith(p))
}

export function materializeAsset (rel, dir) {
  const key = rel.replace(/\\/g, '/')
  const target = path.join(dir, key)
  if (fs.existsSync(target)) return target
  const buf = readAsset(key)
  if (!buf) return null
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, buf)
    return target
  } catch {
    return null
  }
}

export function runtimeDir () {
  return path.join(dataRoot(), 'data', 'runtime')
}
