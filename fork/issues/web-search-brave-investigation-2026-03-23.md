# OpenClaw `web_search` + Brave provider 排查摘要

日期：2026-03-23
环境：OpenClaw 本地网关实例（hippostation）

## 问题标题

`web_search` 在已配置 Brave provider 的情况下返回 `fetch failed`，但配置文件已成功写入，网关服务也处于正常运行状态。

## 背景

用户已通过以下命令配置 Web 搜索：

```bash
openclaw configure --section web
```

配置目标是 Brave Search。

随后在 OpenClaw 会话中直接调用内置 `web_search` 工具进行测试，结果失败。

## 现象概述

### 已确认配置写入成功

检查 `~/.openclaw/openclaw.json` 后确认存在如下配置：

```json
"tools": {
  "web": {
    "search": {
      "enabled": true,
      "provider": "brave"
    },
    "fetch": {
      "enabled": true
    }
  }
}
```

说明：

- Web 搜索已启用
- provider 已设置为 `brave`
- 配置写盘成功

### 网关服务正常

执行：

```bash
openclaw gateway status
```

确认：

- gateway service 运行中
- RPC probe 正常
- dashboard 可达

因此，不属于整个 OpenClaw 网关未启动的问题。

### `web_search` 调用失败

实际调用：

```text
web_search(query="OpenClaw", count=5, country="ALL", language="en", search_lang="en", ui_lang="en-US")
```

返回：

```text
fetch failed
```

并且日志中存在对应错误：

```text
[tools] web_search failed: fetch failed
```

## 复现步骤

1. 运行：

```bash
openclaw configure --section web
```

2. 确认 `~/.openclaw/openclaw.json` 中存在：

```json
"tools": {
  "web": {
    "search": {
      "enabled": true,
      "provider": "brave"
    }
  }
}
```

3. 确认服务正常：

```bash
openclaw gateway status
```

4. 在实际会话中调用 `web_search`

5. 观察结果为：

```text
fetch failed
```

6. 查看日志，存在：

```text
[tools] web_search failed: fetch failed
```

## 预期结果

在 Brave provider 已配置成功的情况下，`web_search` 应正常返回搜索结果列表，而不是统一的 `fetch failed`。

## 实际结果

- 配置文件已成功写入 `provider = brave`
- 网关服务状态正常
- 但 `web_search` 执行失败
- 错误日志只给出笼统的 `fetch failed`
- 无法从当前日志直接看出真实根因（例如配置解析、鉴权、网络、TLS、DNS、HTTP 状态码等）

## 已确认/已排除项

### 已确认

- `openclaw configure --section web` 已写入配置文件
- `tools.web.search.enabled = true`
- `tools.web.search.provider = "brave"`
- 网关服务在运行
- `web_search` 工具在当前运行环境中可调用

### 暂未能证明是根因的项

- 用户 shell 环境中的 `BRAVE_API_KEY`
  - OpenClaw 的 `web_search` 不一定直接使用 shell 环境变量
- 整体网络完全不可用
  - 因为手动直连 Brave API 时至少拿到过 HTTP 200

## 一个关键对照线索

曾使用用户单独提供的 Brave API Key，绕过 OpenClaw `web_search` 工具链，直接手动请求 Brave Search API。

结果：

- 请求可到达 Brave API
- 至少得到 HTTP 200

这说明：

- 宿主机并非完全无法访问 Brave API
- 当前问题更像是 OpenClaw 内部 `web_search` 链路自身的问题
- 但仍不能完全排除 `web_search` 所在运行时的 fetch/TLS/DNS/代理差异

## 目前最值得怀疑的原因

### 1. 配置已写入，但 `web_search` 运行时代码没有正确读取或注入配置

可能表现为：

- 文件中已有 `provider = brave`
- 但实际 provider 初始化时未读取到该配置
- 或仍要求其他缺失字段（如 token/apiKey/baseUrl）

### 2. `web_search` 内部请求层发生网络/传输错误，但错误被统一折叠成 `fetch failed`

例如：

- DNS 失败
- TLS 握手失败
- 出站代理异常
- 请求超时
- 连接被重置

### 3. Brave provider 实现存在兼容性或回归问题

例如：

- provider 名称识别逻辑与配置项不一致
- Brave endpoint/header/query 参数构造错误
- key 注入逻辑有 bug
- 当前版本中 `web_search` provider 代码路径失效

### 4. 配置热加载/缓存问题

虽然配置文件已更新，但仍可能：

- provider registry 仅在启动时构建
- 工具模块缓存旧配置
- 需要重启后才能真正生效

## 建议开发侧重点排查

### A. `openclaw configure --section web` 实际写入了哪些字段

确认：

- 是否只写了 `provider = brave`
- 是否还应写入 `apiKey` / `token` / `baseUrl`
- CLI 写入结构是否与 `web_search` 运行时代码读取路径一致

### B. `web_search` 工具初始化时从哪里读取配置

确认：

- 是否读取 `tools.web.search`
- 是否存在其他优先级更高的配置源覆盖
- 当前 agent/runtime 是否拿到的是不同配置视图

### C. Brave provider 请求构造逻辑

确认：

- endpoint 是否正确
- header 是否正确（如 `X-Subscription-Token`）
- query 参数是否符合 Brave Search API
- provider 名 `brave` 是否正确映射到实现

### D. 错误处理是否吞掉真实异常

建议排查是否存在类似：

```ts
try {
  ...
} catch (err) {
  logger.error("web_search failed: fetch failed")
}
```

如果是，建议增加更细粒度日志：

- provider 名称
- 请求目标 host / endpoint
- err.name
- err.message
- err.cause
- HTTP status（若有）
- 响应体摘要（若有）

### E. 配置热加载问题

建议验证：

- 修改配置后是否必须重启 gateway
- provider registry 是否只在启动时初始化
- 重启后问题是否仍然复现

## 一句话结论

当前问题不是“配置没写进去”，而是：

**Brave provider 配置已成功写入，但 OpenClaw 内置 `web_search` 在实际执行时失败，并且当前错误日志不足以揭示真实失败点。**

## 补充日志线索

与本问题直接相关的日志：

```text
[tools] web_search failed: fetch failed
```

此外，历史日志中还出现过与 `web_search` 可用性相关的警告，例如：

```text
tools.profile (coding) allowlist contains unknown entries (apply_patch, web_search, ...). These entries are shipped core tools but unavailable in the current runtime/provider/model/config.
```

这说明 `web_search` 在部分运行条件下存在“工具已声明但后端实际不可用”的历史信号，值得一并检查工具可用性判定逻辑。
