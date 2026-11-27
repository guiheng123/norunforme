# 脚本工具集


协议层、分析层、模拟层的全部脚本。Node 原生 ESM，无需构建。

| 脚本 | 作用 | 联网 |
|---|---|---|
| `login-sync.mjs` | **从手机 App 同步登录态（App 内微信/QQ 登录后免抓包）** | 是 |
| `probeDevice`（`--probe`） | 设备 / root / 目录可读性诊断 | 是 |
| `verify-protocol.mjs` | 签名 / AES / 连通性自检 | 是 |
| `verify-e2e.mjs` | 7 个只读接口 + 轨迹解密 | 是 |
| `verify-login.mjs` | 登录态采集器离线自测（22 项） | 否 |
| `fetch-checkpoints.mjs` | **自动获取跑区打卡点** | 是 |
| `plan-route.mjs` | 打卡点 → 覆盖路线（最近邻 + 2-opt） | 是 |
| `analyze-run.mjs` | 真实记录的配速/抖动/真实性诊断 | 是 |
| `sim-run.mjs` | **模拟跑步生成（抖动 + 统一传感器 + 指定路线）** | 否 |
| `calibrate.mjs` | 生成器参数标定（模拟 vs 真实分布） | 否 |
| `verify-sim.mjs` | 模拟轨迹验收 37 项 | 否 |
| `submit.mjs` | 提交一条模拟跑步（OSS + stopRun） | 是 |
| `sim-server.mjs` | 独立模拟服务（127.0.0.1:8791，生产用） | 是 |


核心库：`lib/track-analysis.mjs`（分析/诊断）、`lib/gen.mjs`（生成）、
`lib/route.mjs`（路线）、`lib/trackfile.mjs`（AES + 签名）、`lib/protocol.mjs`（端点画像）、
`lib/geo.mjs`（地理 + 随机源）、`lib/exit.mjs`（退出码垫片）、
`lib/adb.mjs`（adb 封装）、`lib/creds-scan.mjs`（MMKV/XML/日志凭证提取）、
`lib/auth.mjs`（采集 + 在线校验）、`lib/local-server.mjs`（本地授权桥 handler）。

> 登录链路详见 [`../docs/USAGE.md`](../docs/USAGE.md) 第 4 节；模拟/提交部分见
> [`../docs/USAGE.md`](../docs/USAGE.md) 第 6、7 节与 [`../docs/SUBMIT.md`](../docs/SUBMIT.md)。

---


## 0. 登录态同步（微信 / QQ）

```bash
node scripts/login-sync.mjs --probe     # 先看设备通不通
node scripts/login-sync.mjs             # 采集 + 校验 + 写 creds.json / session.json
node scripts/login-sync.mjs --serve     # 起本地授权桥（Web 登录页调用，127.0.0.1:8790）
node scripts/verify-login.mjs           # 离线自测
```

手机 App 里用微信/QQ 登录一次，脚本从 `/data/data/com.lptiyu.tanke`（MMKV / SharedPreferences）、
外部存储、logcat 里捞 32 位 token 候选，逐个调 `User/myZone` 校验，
通过后用 `WpIndex/index` 补全 `school_id` / `student_num`。

**手机需要 root 才能全自动**（App `allowBackup=false`、360 加固不可重打包，
`run-as` / `adb backup` 都用不上）。没有 root 时先 `--probe` 看 logcat 与外部存储有没有收获。


---


## 1. 打卡点自动获取

```bash
node scripts/fetch-checkpoints.mjs
node scripts/fetch-checkpoints.mjs --terms 4 --max-records 60 --merge route-plan.json
```
⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣



跑区接口优先（7 个候选名），拿不到就用历史记录 `Run/recordDetailV270` 的 `point_list`
聚合——它只返回**本次命中**的点，所以要扫多个学期/多条记录才完整。25 m 内合并为同一物理点。

输出 `checkpoints.json`。

---

## 2. 路线规划



```bash
node scripts/plan-route.mjs
node scripts/plan-route.mjs --target 2.5
node scripts/plan-route.mjs --start 31.0457,112.1935
```

最近邻构造 → 2-opt 去折返 → 闭合成回路。实测 11 个打卡点：开放路线 1.49 km，闭合回路 2.16 km。

---

## 3. 真实记录分析

```bash

node scripts/analyze-run.mjs          # 最近一次
node scripts/analyze-run.mjs --all    # 全部
node scripts/analyze-run.mjs --id 681664

```

**GPS 噪声修正**：直接累加逐点距离会把 1.67 km 算成 2.68 km（+60%），
5 点滑动平均后回到 1.67 km。`gpsNoisePct` 记录的就是原始/平滑偏差比，真实跑步 7%~42%。

**真实性诊断 7 项**：最高速度 < 12 m/s、最大加速度 < 10 m/s²、速度标准差 > 0.1、
速度自相关 > 0.2、GPS 噪声 2%~60%、配速 3'~9'，以及仅作参考的步幅比
（`step_num` 实测并非真实步数：1.67 km 只记 134 步）。

10 条真实记录全部 100 分，说明阈值与真实数据吻合——这组阈值正是 `verify-sim.mjs` 的验收标准。


---



## 4. 模拟跑步生成

```bash

node scripts/sim-run.mjs --target 2.2 --pace 5:20 --seed 7
node scripts/sim-run.mjs --route plan.gpx --target 3
node scripts/sim-run.mjs --via "31.0457,112.1935;31.0464,112.1925"
node scripts/sim-run.mjs --checkpoints none --target 1.0

```

一次生成：明文轨迹、加密 base64、`meta` + 统一传感器、路线回执、GPX、自包含预览页。
同 `--seed` 完全可复现。参数与抖动模型见 [`../docs/USAGE.md`](../docs/USAGE.md) 第 6 节。

---


## 5. 参数标定与验收

```bash
node scripts/calibrate.mjs '{}' 12 300 2.0     # 参数集 / 样本数 / 配速 / 目标km
node scripts/verify-sim.mjs --runs 20
```

`calibrate.mjs` 把模拟均值与 `run-analysis.json` 的真实均值并列打印，改参数立刻看到偏移；
`verify-sim.mjs` 是硬验收：格式 7 项、加密往返 5 项、诊断 20 条全 100 分、
统计分布 9 项、打卡覆盖 3 项、传感器自洽 6 项、时间轴 5 项，共 **37 项**。

---


## 6. 提交

```bash
node scripts/submit.mjs --run out/run-7 --dry-run
node scripts/submit.mjs --run out/run-7
```

先 `User/myZone` 自检，再 `beforeRunV260` → `startRunV270` → OSS 凭证 → 上传 → `stopRunV270`。
端点名按候选表试探并缓存到 `protocol-cache.json`；上传兼容三种 OSS 凭证形态。
token 被手机端顶掉时返回 `102`，脚本会明确报出而不是盲发（当前 `creds.json` 即处于此状态）。

### 设备指纹回归

```bash
node scripts/verify-fingerprint.mjs   # 19 项，全离线（假上游按 PROTOCOL §12 回码）
```

覆盖：空串本地拦下（0 请求）、真值 → 1、别的 UUID → 101、`0 系统错误` 早停、
href 候选优先且带实测耗时、提交侧空串不首发。改 `lp-client.mjs` / `auth.mjs` /
`submit.mjs` 的指纹逻辑后必须先跑这个。

`node scripts/sync-device.mjs --dry` 的第 1 候选现在是 **WebView hrefstr**——
App 真正发出去的 `mobileDeviceId` 只以裸字符串存在 `app_webview_*/Default/Local Storage/leveldb/*`
（MMKV 里没有这个键），全目录频次排序会把真值埋在噪声后面。

---

## 输出文件

| 文件 | 内容 |
|---|---|
| `checkpoints.json` | 打卡点聚合结果（id / 坐标 / 命中次数） |
| `route-plan.json` | 规划路线 + 圈数建议 |
| `run-analysis.json` | 每条真实记录的完整分析、诊断、轨迹点 |
| `out/run-*/` | 模拟轨迹全套产物 |
| `protocol-cache.json` | 已确认可用的端点名 |
