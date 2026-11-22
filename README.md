# 步道乐跑 · Web 控制台

> **项目地址：<https://github.com/guiheng123/norunforme>** · 作者 **guiheng123**
> 授权：源码可见，**禁止倒卖 / RESALE PROHIBITED**（[LICENSE](LICENSE)）。

自托管的「步道乐跑」第三方 Web 客户端：账号会话、跑区规则、轨迹解密回放、手绘路径模拟跑步、协议提交链路与可选的设备注入，全部收敛到一个网页里。

- **后端**：单个 Node 进程、零三方运行时依赖，同时提供 `/api/*` 与 `web/dist` 静态站点，默认只监听 `127.0.0.1:8787`。
- **前端**：Vue 3 + TypeScript + Vite + Leaflet，构建产物由后端直接托管，开发时由 Vite 代理 `/api`。
- **设备（可选）**：adb + frida，用于从真机取登录态、在真机上播放轨迹；不接设备时整条链路纯协议运行。
- **打包（可选）**：Node SEA，把前后端压成一个单文件 exe，详见 [build/README.md](build/README.md)。

⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍​‌‌‌‌‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​​‍​‌‌‌​‌​​‍​‌‌‌​​​​‍​‌‌‌​​‌‌‍​​‌‌‌​‌​‍​​‌​‌‌‌‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌​‌​​‌‍​‌‌‌​‌​​‍​‌‌​‌​​​‍​‌‌‌​‌​‌‍​‌‌​​​‌​‍​​‌​‌‌‌​‍​‌‌​​​‌‌‍​‌‌​‌‌‌‌‍​‌‌​‌‌​‌‍​​‌​‌‌‌‌‍​‌‌​​‌‌‌‍​‌‌‌​‌​‌‍​‌‌​‌​​‌‍​‌‌​‌​​​‍​‌‌​​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌‌‍​​‌‌​​​‌‍​​‌‌​​‌​‍​​‌‌​​‌‌‍​​‌​‌‌‌‌‍​‌‌​‌‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌‌​‌​‌‍​‌‌​‌‌‌​‍​‌‌​​‌‌​‍​‌‌​‌‌‌‌‍​‌‌‌​​‌​‍​‌‌​‌‌​‌‍​‌‌​​‌​‌‍⁣

```
┌──────────────┐   /api/*   ┌──────────────────────────────┐   HTTPS   ┌───────────────────┐
│ Web 控制台   │ ─────────► │ server/  (Node, 127.0.0.1)   │ ────────► │ api2.lptiyu.com   │
│ Vue3 + Vite  │ ◄───────── │ 会话 / 跑区 / 模拟 / 提交     │ ◄──────── │ OSS data.lptiyu.com│
└──────────────┘    JSON    └──────────────────────────────┘           └───────────────────┘
                                        │ 可选：adb + frida
                                        ▼
                                Android 上的乐跑 App
```

## 快速开始

源码模式需要 Node 22 以上（`server/lib/paths.mjs` 用了 `node:sea`）；单文件打包走 `node --build-sea`，在 Node 26 上验证过。

```bash
npm install                            # 根目录只装打包用的 esbuild
npm --prefix web install
npm --prefix web run build             # 前端产物 → web/dist
node server/index.mjs --port 8787      # → http://127.0.0.1:8787
```

等价快捷方式：`npm start` / `npm run api`；`npm run api:lan` 监听 `0.0.0.0` 并打印局域网地址。

开发模式（前端热更新，`/api` 由 Vite 代理到后端，默认 `http://127.0.0.1:5273`）：

```bash
node server/index.mjs --port 8787      # 终端 A
npm run web                            # 终端 B
```

`start` / `api` / `web` / `build` 之前都会先跑 `tools/preflight.mjs`（`postinstall` 也会跑一次）。工作区与封存记录不一致时会中止并打印校验码，看到码先去核对，不要跳过。

## 页面

左侧导航固定五项，登录页独立：

| 页面 | 路由 | 能力 |
|---|---|---|
| 概览 | `/` | 有效次数 / 有效公里 / 本周次数 / 打卡点数，最近 8 条记录，当前跑区与规则 |
| 跑步记录 | `/records` | 学期切换、分页、有效与无效汇总 |
| 记录详情 | `/records/:id` | OSS 轨迹下载 → AES 解密 → Leaflet 按速度着色、速度曲线、7 项数据诊断 |
| 模拟跑步 | `/simulate` | 手绘路径、参数、轨迹预览、统计与达标判定、提交弹窗（逐步链路） |
| 设备控制台 | `/device` | adb 设备与连接、frida 状态与起停、注入任务进度、本地授权桥探活 |
| 设置 | `/settings` | 设备指纹、接口地址、外观、使用须知开关、清除本机会话 |
| 登录 | `/login` | 手工粘贴凭据、adb 设备连接与同步、演示账号入口 |

## 登录与会话

网页端 `POST /api/session` 会真的调一次上游做校验：**token 与 uid 必填**，`school_id`（未知填 0）、学号（可留空）与三项设备指纹一起上报；`school_id` / 学号 / 昵称缺了会由 `WpIndex/index` 补全。会话落在 `data/session.json`（服务端）与浏览器 `localStorage`（前端）。

### 三项设备指纹

| 字段 | 说明 |
|---|---|
| `mobileModel` | 设备型号，与 App 实际发出的 UA 一致 |
| `mobileDeviceId` | App 真正发出去的设备 UUID（`00000000-xxxx-…` 形态）。4.3.3 起留空会得到上游 `0 系统错误`；`android_id` 不是它 |
| `mobileOsVersion` | 系统版本号，如 `15` |

服务端按 `token + uid + 三项指纹` 定位会话，缺任何一项直接 `NO_FINGERPRINT`；指纹不对则大概率是 `101`。不确定真机发出的值，先跑 `node scripts/adb-doctor.mjs` 自检环境与候选值。

### 如何获取指纹和token

| 方式 | 命令 / 说明 |
|---|---|
| 设备采集 | `node scripts/login-sync.mjs --probe` 先看设备通不通；`node scripts/login-sync.mjs` 采集并写 `creds.json` / `data/session.json`，加 `--verify` 才真的发一次请求校验。App 里用微信/QQ 登录过一次即可，需要 root |
| 直读 MMKV | `node scripts/sync-device.mjs`（`--dry` 只读），从 App 的 MMKV 取 token，并找出实际使用的设备 UUID |
| 抓包导入 | `node scripts/import-har.mjs <文件>.har --save`：一次导入 token 与三项指纹 |
| 抓包落盘 | `node scripts/compare-request.mjs --file captured.txt --save`：写 `creds.json` 与根目录 `session.json`（给 CLI 用；网页端读的是 `data/session.json`） |
| 网页同步 | 登录页连上 adb 设备后点同步 → `GET /api/session/sync`；`?live=1`（或 POST）会真的发一次校验 |
| 手工 | 登录页直接粘贴 |

会话是单点的：手机 App 重新登录或刷新 token 后，旧 token 立刻失效（`102`），重新同步一次即可。设置页的「清除本机会话」会调 `DELETE /api/session`（服务端会话 + 设备侧运行残留），并清空浏览器里 `lepao.*` 的存储。

## 跑区与打卡点

跑区不是全局唯一的。`/api/zone` 与 `/api/track/preview` 按下面的顺序解析当前账号的跑区：

1. `Run2/beforeRunV260` 返回的 `run_zone_id`（服务端按当前账号算出来的，最可靠）
2. 会话里已存的 `zone_id` / `run_zone_id`
3. `Run/GetAllZone` 里按 `school_id` / `school_name` 匹配到的跑区

每个候选都会真调一次 `Run/GetZonePoints`，`point_list` 非空才采用；全空时回退 `beforeRunV260` 的 `run_line_info.point_list`。首次解析成功会把 `zone_id` 写回 `data/session.json`（`server/lib/zone.mjs`）。三者都为空时接口返回 `NO_ZONE_POINTS` 并带上归因，而不是给一张没有打卡点的地图。

## 模拟跑步

中间地图上依次点落点画路线（至少 2 个），右侧参数面板调完点「生成轨迹」。

| 参数 | 范围 | 默认 | 作用 |
|---|---|---|---|
| 目标里程 | 1.5 ~ 10 km | 3.0 | 低于规则下限直接判无效 |
| 目标配速 | 3′00″ ~ 9′00″/km（180 ~ 540 s） | 5′30″ | 速度基准 |
| 判定半径 | 10 ~ 80 m | 25 | 轨迹离打卡点多近算命中（随 `meta` 一起提交） |
| GPS 噪声 | 0 ~ 45 % | 8 | 抖动幅度；0 也不是零噪声（路线曲率本身有约 2.5%） |
| 随机种子 | 任意整数 | 留空 | 同一种子 + 同一路线完全可复现 |
| 开始时间 | 现在 / 指定时刻 | 现在 | 「现在」= 以当前时刻为锚倒推；手填则按你填的时刻起跑 |

生成结果包含：轨迹点（`a/o/s`）、每个打卡点的命中与最近距离、12 项统计（距离 / 用时 / 配速 / 点数 / 速度 / 噪声 / 里程偏差 / 打卡命中 / 诊断通过 / 预估步数等）、7 项诊断（最高速度、平均速度、配速、GPS 噪声、采样点数、里程、时长）、达标判定、折返圈数 `loops`、播放时长，以及开跑/停表时刻——**停表 = 开跑 + 用时 + 115 s 余量**。本地只算时刻，是否符合有效时段由服务端判定。

## 提交链路

`POST /api/submit` 需要 ≥ 10 个轨迹点，创建后台任务后由 `GET /api/submit/:id` 拉日志。每一步都单独记状态，失败就停在那一步：

| 步骤 | 接口 | 作用 |
|---|---|---|
| auth | `User/User` | 鉴权；版本门禁（「版本过低」）也在这步暴露 |
| zone | `Run2/beforeRunV260` | 拉跑区与判定规则；失败时沿用缓存规则 |
| distance | —— | 去噪后里程预检，低于规则下限就不发请求（省配额） |
| timing | —— | 算开跑/停表；仅记录，不做本地拦截 |
| time | `Run/getTimestampV278` | 时间校准 + 拿会话串 `str`（`stopRunV278` 的 `lpd3` 来源） |
| loc | `Run/setRunLocationRecord` | 途经点上报（默认 6 次，末次带打卡 id）；缺 `lp54` 时该步标记为跳过 |
| oss | `report/getOssSts` + `PUT` | 轨迹 AES-128-CBC 加密成 base64 后上传 OSS |
| stop | `Run/stopRunV278` | 结算；`record_status=1` 才算有效次数，否则给出 `record_failed_reason` |

除链路本身，还有几个硬拦：计划打卡点离轨迹最近距离 > 15 m 会在结算前中止（否则必判「打卡点异常」）；`100 上传数据失败`、`101`、`102`、`0 系统错误` 都会把原因写进该步的 detail。配额、时段、里程合格线最终都由服务端说了算。

## 设备模式（adb + frida）

设备页负责：adb 设备枚举与 `host:5555` 连接、frida-server 探测（`/data/local/tmp/f16` 或 `frida-server`，27042 端口 + `adb forward`）与起停、注入任务进度轮询、本地授权桥探活。

`POST /api/device/run` 在 frida 可用时按约 1.8 s/点真实播放，让 App 自己采样提交；frida 不可用时降级为系统定位 provider，日志里会写明降级原因。



授权桥是可选的：`npm run bridge`（= `node scripts/login-sync.mjs --serve`）监听 `127.0.0.1:8790`，提供 `GET /health`、`POST /auth/start`、`GET /auth/status`。设备页只显示它的探活结果；网页登录页当前直接走服务端 `/api/session/sync`，不经过该桥。

## 演示账号

- 登录页常驻「演示账号」按键（免登录），下面并列两所学校：**南山校区（305）** / **学院路校区（412）**，各有独立的跑区编号、规则与 5 个打卡点。「账号信息」是折叠项，展开显示 token / uid / 学号 / 学校 ID，并可「填入表单」。
- token 以 `demo-token` 开头，前端识别后所有 `/api/*` 由 `web/src/api/mock.ts` 就地应答，不发任何网络请求，也不写 `data/session.json`；没有内置的接口会抛 `DEMO_UNSUPPORTED`。
- 概览 / 记录详情 / 模拟跑步顶部有「演示学校」切换条，切校后跑区、地图定位与打卡点一起换，模拟轨迹也围绕该校中心生成。
- 演示覆盖概览、记录、跑区、模拟跑步、提交与设备状态；其余页面要真实数据就用真会话登录。

## 设置

| 卡片 | 内容 |
|---|---|
| 设备指纹 | `mobileModel` / `mobileDeviceId` / `mobileOsVersion`，随请求上报；改这里等于换一台设备 |
| 接口地址 | 留空 = 同源 `/api`；填一段前缀（如 `http://<IP>:8787`）则请求拼成 `<前缀>/api/…`，改完立即对新请求生效 |
| 外观 | 浅色 |
| 使用须知 | 关闭/恢复启动提示；「使用须知不再提醒」需要读满 10 秒才可点 |
| 会话 | 显示登录状态，可清除本机会话与服务端凭据 |

## HTTP 接口

所有响应统一是 `{"ok":true,"data":…}` 或 `{"ok":false,"error":{"code","message","hint"}}`，并带 `X-Trace` 头。

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 进程存活与版本（不探测上游） |
| `GET /api/meta` | 版本与短标识 |
| `GET /api/session` | 当前会话与资料（会向上游校验一次） |
| `POST /api/session` | 提交 token + 指纹，校验通过后落盘 |
| `DELETE /api/session` | 清除会话与设备侧运行残留 |
| `GET /api/session/health` | 会话有效性，归因到版本门禁 / `101` / `102` / 缺指纹 |
| `GET/POST /api/session/sync` | 从 adb 设备采集会话（`live=1` 或 POST 真校验；`uid`、`serial` 可选） |
| `GET /api/terms` | 学期列表 |
| `GET /api/records?term_id=&page=` | 记录分页与汇总 |
| `GET /api/records/:id?year_num=` | 记录详情 + OSS 轨迹解密 + 统计与诊断 |
| `GET /api/zone` | 跑区、规则与打卡点 |
| `POST /api/track/preview` | 手绘路径 → 轨迹、统计、判定与时刻 |
| `POST /api/submit` | 创建提交任务 |
| `GET /api/submit/:id` | 提交链路日志与判定 |
| `GET /api/device/status` | adb / frida / App 前台 / 授权桥状态 |
| `POST /api/device/connect` | `adb connect host[:5555]` |
| `GET /api/device/devices` | 设备列表与 adb 解析结果 |
| `POST /api/device/frida/start` / `stop` | frida-server 起停与 27042 端口转发 |
| `POST /api/device/probe` | 强制探测一次 frida |
| `POST /api/device/run` / `GET /api/device/run/:id` / `POST /api/device/run/:id/stop` | 设备侧注入任务 |

常用错误码：`NO_SESSION`、`NO_FINGERPRINT`、`VERSION_TOO_LOW`、`AUTH_FAILED`、`AUTH_KICKED`、`NEED_UID`、`SYNC_FAILED`、`NO_DEVICE`、`NO_PATH`、`NO_ZONE_POINTS`、`BAD_REQUEST`、`ADB_CONNECT_FAILED`、`FRIDA_START_FAILED`、`UPSTREAM`、`NOT_FOUND`、`INTERNAL`。

## 环境变量

| 变量 | 作用 |
|---|---|
| `LP_PORT` / `LP_HOST` | 监听端口与地址，等价于 `--port` / `--host` |
| `LP_ROOT` | 运行时数据根目录（默认仓库根；exe 模式默认 exe 同级） |
| `LP_CORS` | 允许的跨域来源，逗号分隔，默认关闭 |
| `LP_VERSION_NAME` / `LP_VERSION` | 覆盖请求里的 `version_name`（默认 `4.3.3`）/ `version`（默认 `233`） |
| `LP_ADB` | `adb.exe` 路径，或 platform-tools 目录 |
| `LP_ADB_DEVICE` | 默认设备 serial（也可在登录页选） |
| `LP_PYTHON` | `python.exe` 路径，frida 注入才需要 |
| `LP_BRIDGE_PORT` | 设备页探活授权桥的端口，默认 `8790` |
| `LP_API_TARGET` / `LP_DEV_HOST` / `LP_DEV_PORT` | 开发模式下 Vite 代理目标与端口 |

## npm 脚本

| 脚本 | 用途 |
|---|---|
| `npm start` / `npm run api` | 启动后端（8787） |
| `npm run api:lan` | 监听 `0.0.0.0`，局域网可访问 |
| `npm run web` / `npm run build` | 前端开发服务器 / 构建 |
| `npm run build:exe` / `npm run build:exe:fast` | 构建前端并打包单文件 exe / 跳过前端只重打包 |
| `npm run sync` / `npm run bridge` | 设备登录态采集 / 起本地授权桥（8790） |
| `npm run check:adb` | adb 环境自检 |
| `npm run check:mojibake` | 全仓编码巡检（需要 python） |
| `npm run preflight` | 构建前自检，不一致就中止 |
| `npm run sig:verify` | 核对源码与封存记录 |
| `npm run notice:seal` / `npm run notice:diff` | 重新封存使用须知 / 只看文本漂移 |

## 目录结构（主要文件）

```
server/
  index.mjs              HTTP 服务：/api/* + 静态站点（SPA 回退）
  lib/lp-client.mjs      协议客户端（双通道、签名、AES、token 刷新）
  lib/oss.mjs            阿里云 OSS 上传（STS + V1 签名）
  lib/sim.mjs            统计 / 诊断 / 判定
  lib/pathsim.mjs        路线规划、速度包络、GPS 抖动、打卡点编织
  lib/runtrack.mjs       轨迹文件构建
  lib/timing.mjs         开跑 / 停表时刻
  lib/submit.mjs         提交任务（逐步链路）
  lib/zone.mjs           跑区解析（多候选 + 打卡点确认）
  lib/session.mjs        会话持久化（data/session.json）
  lib/device.mjs         设备桥（adb + frida）
  lib/paths.mjs          源码模式 / SEA 单文件的路径解析
  lib/attest.mjs         内容标识与封存记录计算
  lib/attest-seal.mjs    封存记录常量
  lib/notice-seal.mjs    使用须知封存（摘要与常量）
web/
  src/pages/             概览 / 记录 / 记录详情 / 模拟 / 设备 / 设置 / 登录
  src/components/        布局、地图、速度曲线、诊断、UI 组件
  src/api/               http、类型、演示数据
  src/lib/               演示账号、格式化、使用须知、网络层
  src/lib/notice.canonical.json   使用须知的唯一文本源
scripts/
  login-sync.mjs         设备登录态采集 / 校验 / 授权桥
  sync-device.mjs        直读 MMKV 取 token 与设备 UUID
  import-har.mjs         HAR 导入 token + 三项指纹
  compare-request.mjs    抓包落盘比对
  adb-doctor.mjs         adb 环境与指纹自检
  fetch-checkpoints.mjs  跑区打卡点获取
  plan-route.mjs         打卡点 → 覆盖路线
  analyze-run.mjs        真实记录分析
  sim-run.mjs            模拟跑步生成
  submit.mjs             CLI 提交
  verify-*.mjs           离线 / 在线自检
  lib/                   协议、adb、MMKV、凭证扫描、路线、轨迹、提交核心
  frida/                 frida 注入脚本（GPS、token 抓取）
tools/
  capture-stop.mjs       从抓包流水里解出 stopRunV278 明文参数
  preflight.mjs          构建前自检
  attest.mjs             封存记录：embed / verify / scan / stamp
  notice.mjs             使用须知封存与漂移比对
build/make-exe.mjs       Node SEA 单文件打包
docs/                    协议、逆向、提交、使用四份长文档（本地，不入库）
data/                    运行时数据（session.json、device/），不入库
.local/                  作者的本地逆向脚本与笔记，不入库
```


## 构建与自检

| 命令 | 作用 |
|---|---|
| `npm run preflight` | 构建前自检（NPM 的 pre 钩子与 `postinstall` 自动跑） |
| `npm run sig:verify` | 核对源码与封存记录，异常返回 2 |
| `npm run notice:seal` | 改完使用须知文本后重新封存 |
| `npm run notice:diff` | 只比对使用须知漂移 |
| `node tools/attest.mjs scan <dir>` | 扫任意目录里的标识，命中即归因 |
| `node build/make-exe.mjs --skip-web --out dist/lepao2.exe` | exe 被占用时换名输出 |

使用须知是三件套联动的：文本源 `web/src/lib/notice.canonical.json`、界面 `web/src/components/NoticeModal.vue`、DOM 兜底 `web/src/lib/notice-guard.ts`；`npm run notice:seal` 会把摘要与文本副本封存进 `web/src/lib/notice-fallback.ts`。改完文本不重新封存，`preflight` 与前端构建都会中止。

