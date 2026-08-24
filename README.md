# 🔍 dsh-ventus-search
> 🧩 **一键整合安装：[dsh-ventus-plugins](https://github.com/mmzm0808/dsh-ventus-plugins)** —— 本插件已并入整合包，也可按本仓库方式单独安装。



**Ventus 搜索 · DeepSeek Harness 多引擎搜索与正文抓取插件** —— 注册进 `ctx.web` 的搜索 / 抓取双 provider：Bing、360、Bilibili 三引擎并发搜索，命中评分、URL 去重、跳转链接解码、整体超时兜底、LRU 缓存；正文抓取带广告域名黑名单、类 Readability 抽取与镜像回退。附 Ventus 系列设置卡：总开关、每引擎开关、健康状态与**一键测试搜索**。

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="version" src="https://img.shields.io/badge/version-v0.1.0-blueviolet">
  <img alt="runtime" src="https://img.shields.io/badge/runtime-dsh%20web-4d6bfe">
  <img alt="engines" src="https://img.shields.io/badge/engines-bing%20%7C%20360%20%7C%20bilibili-4d6bfe">
</p>

## ✨ 特性

| 分类 | 说明 |
|---|---|
| 🔍 多引擎搜索 | Bing（中文/英文/新闻自动识别）、360（双入口冗余）、Bilibili 官方 API，按 `maxConcurrency` 并发调度 |
| ⭐ 结果质量 | 标题命中 ×3 + 摘要命中 ×2 − 排名权重评分；URL 规范化去重；单域名限额；Bing/360 跳转包装解码 |
| 🛡️ 绝不失败 | 单引擎失败隔离（不影响其他引擎）；备用查询重试；整体超时到点返回部分结果；`gracefulDegradation` 兜底返回空结果而非抛错 |
| ⚡ 高效 | 查询级 LRU 缓存（TTL 300s）；429/5xx/超时自动重试；全程响应 AbortSignal |
| 📄 正文抓取 | 广告/追踪域名黑名单（含子域）、类 Readability 正文抽取、镜像域名回退、体积上限 |
| 🎛️ 设置卡 | Ventus 系列设置卡：总开关、**每引擎独立开关**、健康状态（状态点 + 上次成功/失败信息）、**测试搜索按钮**（真实搜索并展示结果） |
| 🔐 安全 | 状态路由 loopback-only + no-store；状态文件原子写入（临时文件 + fsync + rename） |

## 🚀 安装

### Git 安装

```sh
dsh plugin --profile web add github:mmzm0808/dsh-ventus-search
```

### 本地开发安装

```sh
dsh plugin --profile web add "<本仓库本地绝对路径>"
```

- 仓库已提交完整 `lib/` 构建产物，安装**无需执行构建脚本**（pnpm ≥10 的 allowBuilds 门禁不影响本插件）
- 安装后**重启 dsh**（新 bundle 层在启动时加载）
- DSH 插件开发使用 **pnpm**；GitHub 分发不要求发布 npm

安装后 profile 的 `cordis.patch.yml` 会插入一行：

```yaml
- insert:
    - id: dsh-ventus-search
      name: dsh-ventus-search
```

## 📖 使用

1. **设置卡**：设置 → Ventus 插件 → **Ventus 搜索**
2. **总开关**：关闭后搜索与抓取 provider 立即不可用（`available()` 返回 false）
3. **引擎开关**：可单独启用/禁用 Bing / 360 / Bilibili（无需改配置）
4. **测试搜索**：在输入框输入关键词（默认 "DeepSeek Harness 最新动态"），点「测试搜索」→ 展示耗时、来源数与结果列表（标题可点击、摘要、URL）
5. **健康状态**：每引擎显示状态圆点（绿=正常 / 红=失败 / 灰=未测）+ 最近成功时间 / 失败原因

## ⚙️ 配置（schemastery，全部有默认值）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| enabled | true | 总开关（持久化到状态文件，可被设置卡改写） |
| stateFilePath | ~/.dsh/plugins/ventus-search/state.json | 状态文件路径，~ 运行时展开为 homedir |
| engines.bing | true | 启用 Bing |
| engines.so360 | true | 启用 360 搜索 |
| engines.bilibili | true | 启用 Bilibili |
| engines.bilibiliCookie | '' | Bilibili 搜索请求的 Cookie（空则用内置默认 buvid3） |
| maxResults | 8 | 返回来源数上限（seam 还会再截断） |
| maxDomainResults | 2 | 单域名最多保留的结果数 |
| requestTimeoutMs | 8000 | 单引擎单次请求超时 |
| overallTimeoutMs | 15000 | 整次搜索整体超时，到点返回已有部分结果 |
| maxConcurrency | 4 | 引擎并发数 |
| retryCount | 1 | 429/5xx/超时重试次数 |
| gracefulDegradation | true | 全部引擎失败时返回空结果而非抛错 |
| cache.enabled | true | 查询级 LRU 缓存（容量 100，TTL 300s） |
| fetch.enabled | true | 抓取 provider 开关 |
| fetch.blockedDomains | 见默认 | 广告/追踪域名黑名单（doubleclick.net 等） |
| fetch.mirrorDomains | {} | 主站失败时按 host 尝试的镜像域名表 |

引擎实际启用 = 配置 `engines.<id>`（硬默认）AND 状态文件 `engines.<id>.enabled`（运行时覆盖）。

## 🗂️ 数据与安全

- 状态文件：`~/.dsh/plugins/ventus-search/state.json`（原子写入 + fsync）；引擎状态含 `enabled / health / lastOkAt / lastError`，旧版扁平字符串格式自动迁移
- API（**loopback-only**，仅本机可访问，`Cache-Control: no-store`）：
  - `GET /api/ventus-search/state` — 当前状态
  - `PATCH /api/ventus-search/state` — body `{ "enabled"?: boolean, "engines"?: { "bing"?: boolean, "so360"?: boolean, "bilibili"?: boolean } }`
  - `POST /api/ventus-search/test` — body `{ "query": string }`（≤200 字符）→ 真实搜索并返回 `{ ok, durationMs, sources, engines }`

## 🛠️ 开发

```sh
pnpm typecheck    # tsc --noEmit（需要先按 scripts/build.sh 建 node_modules junction）
pnpm build        # scripts/build.sh：link junction + tsc 编译 host
pnpm build:client # tsdown 产出 lib/client.js（不清理 host lib）
```

- host 路由与 provider 注册全部挂在 `ctx.effect` 下，卸载即清理
- client 设置卡的轮询/测试请求随 fiber dispose 清理（AbortController）

## 🐋 Ventus 系列插件

| 插件 | 说明 | 仓库 |
|---|---|---|
| 🐳 dsh-ventus-whale | 蓝色大肥鱼 · DeepSeek 虎鲸 3D 桌宠 | [GitHub](https://github.com/mmzm0808/dsh-ventus-whale) |
| 📊 dsh-deepseek-usage | DeepSeek API 用量监测（悬浮球 + 面板） | [GitHub](https://github.com/mmzm0808/dsh-deepseek-usage) |
| 🔍 dsh-ventus-search | 多引擎搜索与正文抓取（Bing / 360 / Bilibili） | [GitHub](https://github.com/mmzm0808/dsh-ventus-search) |

## 📄 许可证

MIT License · Copyright (c) 2026 Ventus
