#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通用 runner：注入轨迹 + 加载指定 agent，日志写文件"""
import json, os, sys, time, frida

HERE = os.path.dirname(os.path.abspath(__file__))
PID = int(sys.argv[1])
AGENT = sys.argv[2]
TRACK = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, 'track.json')
SECONDS = float(sys.argv[4]) if len(sys.argv) > 4 else 1800
LOG = sys.argv[5] if len(sys.argv) > 5 else os.path.join(HERE, 'agent.log')

with open(TRACK, encoding='utf-8') as f:
    raw = json.load(f)
pts = raw if isinstance(raw, list) else raw.get('points', [])
track = [[float(p['a']), float(p['o'])] for p in pts]

logf = open(LOG, 'a', encoding='utf-8')
def log(*a):
    line = ' '.join(str(x) for x in a)
    print(line, flush=True)
    logf.write(line + '\n'); logf.flush()

dev = frida.get_remote_device()
session = dev.attach(PID)
with open(AGENT, encoding='utf-8') as f:
    script = session.create_script(f.read())

def on_msg(m, d):
    if m.get('type') == 'send':
        log('[js]', json.dumps(m.get('payload'), ensure_ascii=False)[:4000])
    elif m.get('type') == 'error':
        log('[err]', m.get('description'))

script.on('message', on_msg)
script.load()
start_ms = int(time.time() * 1000)
n = script.exports_sync.set_track(track, start_ms)
log(f'[i] pid={PID} agent={AGENT} track={n} start={start_ms}')
t0 = time.time()
while time.time() - t0 < SECONDS:
    time.sleep(10)
    try:
        log('[i] status', json.dumps(script.exports_sync.status()))
    except Exception as e:
        log('[!]', e); break
