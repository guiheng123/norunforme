import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const arg = (n, d) => {
  const i = args.indexOf('--' + n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const PORT = Number(arg('port', 8888))
const dir = fileURLToPath(new URL('../../.tmp/mitm/', import.meta.url))
const key = readFileSync(dir + 'srv.key')
const cert = readFileSync(dir + 'srv.crt')
const FLOW = dir + 'flows.jsonl'

const INTERCEPT = /(^|\.)lptiyu\.com$/i

const ctx = tls.createSecureContext({ key, cert })
const log = (o) => appendFileSync(FLOW, JSON.stringify({ ts: Date.now(), ...o }) + '\n')

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('mitm up\n')
})

server.on('connect', (req, clientSocket, head) => {
  const [host, portStr] = req.url.split(':')
  const port = Number(portStr || 443)

  if (!INTERCEPT.test(host)) {
    const upstream = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head?.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on('error', () => clientSocket.destroy())
    clientSocket.on('error', () => upstream.destroy())
    return
  }

  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  const tlsSocket = new tls.TLSSocket(clientSocket, { isServer: true, secureContext: ctx })

  let buf = Buffer.alloc(0)
  let busy = false

  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk])
    if (!busy) pump()
  }

  async function pump() {
    while (true) {
      const idx = buf.indexOf('\r\n\r\n')
      if (idx < 0) return
      const headText = buf.subarray(0, idx).toString('latin1')
      const lines = headText.split('\r\n')
      const [method, path] = lines[0].split(' ')
      const headers = {}
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':')
        if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim()
      }
      const len = Number(headers['content-length'] ?? 0)
      if (buf.length < idx + 4 + len) return
      const body = buf.subarray(idx + 4, idx + 4 + len)
      buf = buf.subarray(idx + 4 + len)

      busy = true
      try {
        await forward(host, port, method, path, headers, body)
      } catch (e) {
        log({ host, method, path, error: e.message })
        tlsSocket.destroy()
        return
      }
      busy = false
    }
  }

  function forward(host, port, method, path, headers, body) {
    return new Promise((resolve, reject) => {
      const fwdHeaders = { ...headers, host }
      delete fwdHeaders['proxy-connection']
      delete fwdHeaders['accept-encoding']

      const req = https.request(
        { host, port, method, path, headers: fwdHeaders, servername: host, rejectUnauthorized: false },
        (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const resBody = Buffer.concat(chunks)
            const head =
              `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n` +
              Object.entries(res.headers)
                .filter(([k]) => !['transfer-encoding', 'connection', 'content-length'].includes(k))
                .map(([k, v]) => `${k}: ${v}`)
                .join('\r\n') +
              `\r\ncontent-length: ${resBody.length}\r\n\r\n`
            try {
              tlsSocket.write(head)
              tlsSocket.write(resBody)
            } catch {
            }

            const ct = String(res.headers['content-type'] ?? '')
            const text = resBody.toString('utf8')
            let payload = text.slice(0, 2000)
            try {
              const j = JSON.parse(text)
              payload = { status: j.status, info: j.info, is_encrypt: j.is_encrypt, dataPreview: typeof j.data === 'string' ? j.data.slice(0, 80) : j.data }
            } catch {
            }
            log({
              host,
              method,
              path,
              reqBody: body.toString('utf8').slice(0, 4000),
              status: res.statusCode,
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
              res: payload,
            })
            console.log(`${method} https://${host}${path} → ${res.statusCode} ${typeof payload === 'object' ? payload.status ?? '' : ''}`)
            resolve()
          })
        },
      )
      req.on('error', reject)
      if (body.length) req.write(body)
      req.end()
    })
  }

  tlsSocket.on('data', onData)
  tlsSocket.on('error', () => {})
  if (head?.length) onData(head)
})

server.listen(PORT, '0.0.0.0', () => console.log(`mitm listening 0.0.0.0:${PORT} → ${FLOW}`))
