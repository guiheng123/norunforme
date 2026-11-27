"""
前置：
  1. 设备已 root（adb root）
  2. frida-server 已推到设备并在 27042 监听
     - 架构按 ro.product.cpu.abi 选（x86_64 设备用 x86_64 版，别用 arm64）
     - frida 版本必须 ≤16.x（17 移除了 Java bridge）
  3. adb forward tcp:27042 tcp:27042

用法：
  node scripts/sim-run.mjs --out out/sim-896762
  python scripts/frida/run-gps.py out/sim-896762/track.json
"""

import json
import sys
import time
# 

try:
    import frida
except ImportError:
    raise SystemExit('缺少 frida：pip install "frida<17"')

TRACK_FILE = sys.argv[1] if len(sys.argv) > 1 else 'out/sim-896762/track.json'
AGENT = 'scripts/frida/gps-inject.js'
TARGET = 'com.lptiyu.tanke'

# 
# 
def log(*a):
    print(*a, flush=True)

# 
with open(TRACK_FILE, encoding='utf-8') as f:
    raw = json.load(f)
pts = raw if isinstance(raw, list) else raw.get('points', [])
track = [[float(p['a']), float(p['o'])] for p in pts]
log(f'[i] 轨迹 {len(track)} 点  首={track[0]}  末={track[-1]}')
# 
# ⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣

dev = frida.get_remote_device()
pid = next((p.pid for p in dev.enumerate_processes() if p.name == TARGET), None)
if pid is None:
# 
    raise SystemExit(f'[!] {TARGET} 未运行，请先打开 App')
# 

log(f'[i] attach pid={pid}')
session = dev.attach(pid)
# 
with open(AGENT, encoding='utf-8') as f:
    script = session.create_script(f.read())

def on_msg(m, d):
    p = m.get('payload')
    if isinstance(p, dict):
        log('[js]', p)
# 
    elif m.get('type') == 'error':
        log('[js-err]', m.get('description'))

# 
script.on('message', on_msg)
script.load()

start_ms = int(time.time() * 1000)
n = script.exports_sync.set_track(track, start_ms)
log(f'[i] 注入 {n} 点，起始时刻 {start_ms}')
log('[i] HOOK-READY —— 现在去手机上点「开始」，跑够后点「结束」')
# 

# 
# 
last = -1
try:
    while True:
        time.sleep(3)
        i = script.exports_sync.progress()
        if i >= 0 and i != last:
            last = i
# 
            p = script.exports_sync.peek(i)
# 
            log(f'  帧 {i}/{n}  →  {p[0]:.6f},{p[1]:.6f}')
# 
except KeyboardInterrupt:
# 
    log('\n[i] 退出（hook 失效，坐标恢复系统值）')
    session.detach()
