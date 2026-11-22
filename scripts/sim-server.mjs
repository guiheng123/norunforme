import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createSimHandler } from './lib/sim-service.mjs'
import { installExitShim } from './lib/exit.mjs'

installExitShim()

const args = process.argv.slice(2)
const arg = (n, d) => {
  const i = args.indexOf('--' + n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
const port = Number(arg('port', 8791))
const cwd = fileURLToPath(new URL('..', import.meta.url))
process.chdir(cwd)

const handler = createSimHandler({
  credsFile: 'creds.json',
  sessionFile: 'session.json',
  protocolCache: 'protocol-cache.json',
  outRoot: 'out',
})

const server = http.createServer(async (req, res) => {
  const handled = await handler(req, res)
  if (!handled) {
    res.writeHead(404, { 'Content-Type': 'text/plain;charset=utf-8' })
    res.end('not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`模拟服务已启动：http://127.0.0.1:${port}/sim/health`)
  console.log(`工作目录：${cwd}`)
})
