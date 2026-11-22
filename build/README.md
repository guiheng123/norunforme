# 打包成单文件 exe

产物：`dist/lepao.exe`（约 96 MB，内含 Node 运行时 + 服务端 + 前端静态资源）。
双击即用，目标机器**不需要装 Node**。

## 一条命令

```bash
npm install          # 首次：装 esbuild
npm run build:exe    # 构建前端 + 打包 exe
```

只想重打包、前端没改：

```bash
npm run build:exe:fast
```

产物在 `dist/`：



```
dist/lepao.exe            单文件，双击启动 http://127.0.0.1:8787
dist/analysis/            设备注入脚本（runner.py / amap3.js / feed.sh），随包复制
dist/platform-tools/      adb.exe + 两个 DLL，随包复制（源目录里没有就跳过）
dist/README.txt           给最终用户的使用说明

dist/.lepao-sig.json      本次构建的标识信息（短码 / bundle 摘要）
```

exe 正在运行（或被杀软锁住）时 `--build-sea` 会报 `resource busy or locked`，换名输出即可：

```bash
node build/make-exe.mjs --skip-web --out dist/lepao2.exe
```

重新打包时如果 adb 正在运行（设备页开着，或上一次 exe 起的 daemon 还在），`platform-tools` 里的文件会被占用：构建会跳过这几个文件、保留旧副本并在日志里写明，不会中止。要真正更新它们，先 `adb kill-server` 再打包。

