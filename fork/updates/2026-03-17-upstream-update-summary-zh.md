# Upstream 更新摘要（2026-03-17）

## 对比范围

- 基准：本地 `HEAD..upstream/main`
- 同步前状态：本地分支相对 upstream 落后 597 个提交、领先 160 个提交
- 改动规模：2334 个文件变更，约 +104,185 / -61,110
- 时间窗口：主要提交集中在 2026-03-15 到 2026-03-17

## 核心变化

### 1. 插件化重构继续推进（主线）

- 大量 provider/channel 的运行时、鉴权、配置、onboarding/setup 逻辑继续向 `extensions/*` 与插件边界迁移。
- Plugin SDK 的导出边界与私有桥接被进一步收紧，减少跨层耦合。
- 与插件相关的 contract 测试、注册表测试、发现/加载测试持续扩展。

### 2. Setup Wizard 与多通道接入统一

- 多个通道的 setup surface 和 adapter 被拆分、懒加载并统一到 setup wizard 流程。
- 涉及 WhatsApp、IRC、Tlon、Google Chat、MSTeams、Feishu、Discord、Slack、Signal、iMessage、Nostr 等。
- setup 路径循环依赖与重型导入被显著清理。

### 3. 启动性能与内存路径优化

- 大量引入 `lazy-load` / `defer`：
  - 通道 runtime
  - setup surface
  - status/security/audit 相关路径
- Gateway 启动路径支持延后加载通道插件（按配置与阶段分流）。
- `status` JSON/深度探测路径被瘦身，CLI 启动内存回归加入 CI 守护。

### 4. 能力扩展

- 新增/增强插件能力：
  - web search 运行时能力
  - media understanding / image generation / speech provider 注册
  - TTS 语音元数据增强与 Microsoft voice 列表
- 交互消息能力统一：
  - Telegram / Discord / Slack 的 shared interactive payload 渲染与分发链路逐步统一
- 新增或完善：
  - Telegram topic-edit
  - Synology Chat setup
  - OpenShell sandbox（本地/远程）
  - Firecrawl onboarding 搜索插件

### 5. 稳定性与兼容性修复

- Node.js 25 相关兼容修复（gaxios / node-fetch 路径）。
- Windows 侧 `schtasks` 兼容修复与 smoke 稳定化。
- localStorage 作用域隔离修复（避免跨部署冲突）。
- 多项 rebase fallout、类型漂移、构建回归与插件加载路径问题修复。

### 6. 安全与加固

- SecretRef 读路径与诊断路径进一步收紧。
- Feishu webhook 签名比对、macOS canvas 路径逃逸、exec approval socket auth 等安全相关修复。
- 子代理 SIGUSR1 orphan 恢复链路增强（重试与恢复流程）。

### 7. 文档与测试体系

- docs/plugins、setup 文案、openshell 文档持续更新，含 zh-CN 同步。
- CI 增加 changed-extension lane、global contract lane，并修复 full gate 稳定性。

## 同步建议

- 本次 upstream 变更量大且架构迁移明显，建议继续以“合并 upstream/main + 强验证脚本 + 网关深探测”的流程同步。
- 合并后重点关注：
  - `fork/scripts/update-local-openclaw.sh` 中硬编码测试路径是否继续匹配 upstream 迁移
  - Gateway 启动后首次深探测时序（避免 warm-up 期误判）
  - 插件发现/加载与 setup wizard 相关本地补丁是否仍保持有效
