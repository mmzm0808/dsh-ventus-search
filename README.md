# dsh-ventus-search

Ventus 搜索插件：为 DSH 的 web 能力缝（ctx.web）注册两个 provider：

- **搜索 provider**（id `ventus-search`）：Bing / 360（so.com）/ Bilibili 三引擎并发抓取，评分、去重、单域名限额、跳转链接解码、整体超时兜底、LRU 缓存。
- **抓取 provider**（id `ventus-fetch`）：URL 校验 + 广告/追踪域名黑名单 + 类 Readability 正文抽取 + 镜像域名回退。

外加一张 Ventus 系列设置卡（`ventus.settings.item` slot）：总开关（PATCH 状态路由）与三引擎健康状态轮询。

## 安装

```bash
dsh plugin --profile web add ./path/to/dsh-ventus-search
```

或任意支持 bundle patch 的 profile。安装后重启目标 profile。插件通过 `cordis.patch.yml` 插入一行：

```yaml
- insert:
    - id: dsh-ventus-search
      name: dsh-ventus-search
```

## 配置（schemastery，全部有默认值）

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
| fetch.mirrorDomains | {} | 主站失败时按 host 尝试的镜像域名表，如 {"example.com": ["mirror.example.com"]} |

## 状态路由

- `GET /api/ventus-search/state` → `{ enabled, engines: { bing, so360, bilibili }, updatedAt }`（`Cache-Control: no-store`）
- `PATCH /api/ventus-search/state`，body `{ "enabled": boolean }` → 写状态文件并返回新状态

路由仅接受回环来源（127.0.0.1/localhost + 同源）。

## 实现要点

- 引擎抓取：fetch + AbortSignal（外部 signal 与内部超时合并），桌面 UA，正则解析 HTML/JSON，实体反转义。
- 评分 = 标题命中词数 ×3 + 摘要命中词数 ×2 − 排名位置权重；URL 规范化去重（小写 host、去 utm_*/spm/from/search 等 tracking 参数），Bing/360 跳转包装 URL（a1%3a%2f%2f、/ck/a?...u=）解码后再参与去重与展示。
- 兜底：任一引擎有结果即返回；整体超时返回部分结果；gracefulDegradation 关闭且全失败时抛 WEB_PROVIDER_ERROR。
- 抓取：http/https 校验（否则 WEB_INVALID_URL）、黑名单 host 或子域命中抛 WEB_FETCH_BLOCKED、非 2xx 返回状态码 + 空 body、正文超 200KB 截断并置 truncated。
- 每个引擎的成功/失败实时写回状态文件（ok/fail/untested）。

## 开发

```bash
pnpm typecheck    # tsc --noEmit（需要先按 scripts/build.sh 建 node_modules junction）
pnpm build        # scripts/build.sh：link junction + tsc 编译 host
pnpm build:client # tsdown 产出 lib/client.js（不清理 host lib）
```

## 生命周期

host 路由与 provider 注册全部挂在 ctx.effect 下，卸载即清理；client 设置卡的轮询定时器与监听随 fiber dispose 清理。
