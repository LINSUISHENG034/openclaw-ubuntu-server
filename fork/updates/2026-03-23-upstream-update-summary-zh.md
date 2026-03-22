# Upstream 更新摘要（2026-03-23）

## 对比范围

- 基准：本地 `HEAD..upstream/main`
- 同步前状态：本地分支相对 upstream 落后 313 个提交、领先 164 个提交
- 共同基点：`dc86b6d72a docs(azure): replace ARM template deployment with pure az CLI commands (#50700)`
- 时间窗口：主要提交集中在 2026-03-20 到 2026-03-23
- upstream 最新提交：`aa80b1eb7c feat(cli): unify hook pack installs under plugins`

## 核心变化

### 1. 插件安装与 ClawHub 流程升级

- 新增原生 `ClawHub` 安装、搜索、更新链路，`skills` 和 `plugins` 的来源管理更统一。
- `openclaw plugins install <package>` 现在会优先尝试从 `ClawHub` 安装，仅在 ClawHub 没有对应包或版本时回退到 npm。
- `openclaw hooks` 的职责收窄为查看和控制 hook；hook pack 的安装与更新统一通过 `openclaw plugins` 处理。

### 2. Plugin SDK 与插件边界继续收敛

- upstream 大量补充了 Plugin SDK 的公开文档，包括 overview、entrypoints、runtime、testing、migration、setup 等页面。
- 新增生成式 Plugin SDK API baseline，用于跟踪 SDK 公开面和文档一致性。
- 安装型插件开始强制校验最低宿主版本，manifest 缓存也按 host version 分桶，减少不兼容插件被误装的风险。

### 3. 运行时启动与单例状态被系统性重构

- 近期大量 `refactor` 和 `perf` 提交集中在 runtime singleton、listener state、registry lookup、cache dedupe、startup import trimming。
- 重点方向是减少冷启动导入、修复重复模块图带来的状态分裂、让 Discord/插件运行时状态更稳定。
- 对本地 fork 来说，这类改动需要重点关注启动路径、插件发现和 Control UI/聊天消息链路。

### 4. 安全边界进一步收紧

- `exec` 审批边界、安全命令策略和 jq safe-bin 规则被继续加固。
- workspace hook 加载策略更严格，避免本地工作区 hook 隐式覆盖受管 hook。
- Nostr 入站 DM 在解密前先执行策略检查，减少未知发送方绕过限制或触发额外加密负载的风险。

### 5. 模型与 provider 能力继续扩展

- 新增 `anthropic-vertex` provider，支持通过 GCP Vertex AI 使用 Claude。
- agent/model 侧增加 per-agent 默认 thinking、reasoning、fast 配置，并对不允许的模型覆盖回退到安全默认值。
- 其他更新还包括 GitHub Copilot 动态模型 ID、OpenAI 默认模型整理、context engine 对 `modelId`/prompt 的兼容增强。

### 6. 多频道与设备配对路径有明显行为修复

- Telegram 支持自定义 `apiRoot`，适配代理或自托管 Bot API。
- Telegram DM topic 可在首条消息后自动命名。
- Discord 修复 DM allowlist、重复投递、组件回调状态共享等问题。
- 设备配对与二维码配对链路被补强，iOS onboarding 的 QR pairing 体验更完整。

### 7. Android、iOS 与 UI 有一批可感知改进

- Android 修复了多处 Bitmap/临时文件泄漏、定位回调竞态、TalkModeManager 资源释放时序问题。
- iOS 改进二维码配对流程，并补了相关会话刷新回归测试。
- Control UI 的 usage 页面进行了较大幅度重构，样式、本地化、响应式布局和聊天视图提示都更完整。

### 8. 测试、CI 与文档投入很高

- 大量提交在强化回归测试、裁剪 import-heavy 测试启动成本、优化 vitest 线程候选和非隔离测试路径。
- CI 补了 dist 构建前置、plugin-sdk lane 水合和更多 gate 恢复修复。
- 这轮 upstream 不只是加新功能，也在集中清理插件化、运行时和测试稳定性方面的历史负担。

## 本地同步建议

- 当前 fork 仍是长期分叉状态，优先继续使用 `git merge upstream/main`，不要直接改成 rebase 主线历史。
- 合并后不要只看 `fork/scripts/update-local-openclaw.sh` 的退出码；还要补跑 `openclaw gateway status --deep --require-rpc`。
- 合并后重点检查：
  - 本地 fork 特有脚本和提示词兼容点是否被 upstream 的插件/运行时重构影响
  - `dist/extensions/*` 的元数据与实际构建产物是否一致
  - 首次重启后的网关是否只是尚未开始监听，而不是实际启动失败
