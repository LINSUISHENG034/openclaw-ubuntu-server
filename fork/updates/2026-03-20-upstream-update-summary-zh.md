# Upstream 更新摘要（2026-03-20）

## 对比范围

- 基准：本地 `HEAD..upstream/main`
- 同步前状态：本地分支相对 upstream 落后 859 个提交、领先 163 个提交
- 改动规模：2631 个文件变更，约 +173,288 / -64,866
- 时间窗口：主要提交集中在 2026-03-17 到 2026-03-20
- upstream 最新提交：`dc86b6d72a docs(azure): replace ARM template deployment with pure az CLI commands (#50700)`

## 核心变化

### 1. 文档与安装体系大幅重整

- `Install`、`Get Started`、`CLI`、`Tools`、`Providers` 等文档导航被重新梳理，层级更扁平，分组更清晰。
- 大量安装与部署页面改写为 Mintlify `Steps` 结构，覆盖 Docker、Podman、Ansible、Bun、Nix、Fly、Hetzner、GCP、Azure、Oracle、DigitalOcean、Raspberry Pi 等场景。
- FAQ 改为更易读的 accordion 形式，多个页面修复了锚点、标题和 frontmatter 问题。

### 2. Azure 与部署文档更新明显

- 最新上游将 Azure 部署说明从 ARM 模板流程切换为纯 `az CLI` 命令流程。
- Azure VM、容器路径、自定义 provider endpoint、onboarding 兼容性等配套说明也同步补强。
- 组织级部署新增 delegate architecture 指南。

### 3. 插件化边界与运行时继续收紧

- 插件 SDK、插件加载器、bundle/MCP 路径、runtime facade、interactive callback state 等持续重构和加固。
- CLI 新增按版本更新插件的能力。
- 插件加载失败、alias 作用域、warmup side effects、strict bootstrap 等问题被集中修复。

### 4. 新能力与能力补强

- 新增内置 Tavily Web Search 插件，提供搜索与抽取能力。
- Gateway 新增 `talk speak` RPC，并增加内存内 TTS 合成能力。
- 增加小米 MiMo V2 Pro / V2 Omni 模型，并切换到 OpenAI completions API。
- Android 新增 `sms.search` 支持。

### 5. 通道与扩展层更新密集

- Matrix 是本轮最活跃模块之一：
  - 新增 `allowBots`
  - 限制私网 homeserver 访问
  - 补强 thread binding、credential/runtime/export、encryption、shutdown 等路径
- Discord 修复原生命令同步需要重启的问题，并加强 DM 组件 allowlist 鉴权。
- Telegram 修复 named-account DM topic session key、pairing/session/forum routing 与 reply formatting 稳定性问题。

### 6. Android 与语音链路增强

- Android 增加 `play` 与 third-party release flavor，Play 构建隐藏受限能力。
- Android Talk 播放/合成进一步经由 gateway 处理，并修复 provider/state 保持问题。
- App 打开时自动连接 gateway，诊断信息可复制，tab 切换 CPU 抖动下降。

### 7. Gateway、会话与稳定性修复

- 修复过期生命周期事件导致的 seq-gap 广播问题。
- WebSocket 握手超时从 3 秒提高到 10 秒。
- 会话 compaction 后会截断 JSONL，避免文件无限增长。
- `status`/启动路径减少不必要的 plugin warmup，交互配对与设备配对元数据处理更稳。

### 8. 测试与 CI 占比很高

- 大量提交在处理 unit-fast OOM、内存热点、worker 隔离、loader 回归、bundle 路径与测试稳定性。
- Android、插件、runtime、hooks、pre-commit 等验证面都有补强。
- 这一轮 upstream 不只是加功能，也在集中收口插件化后的稳定性问题。

## 本地同步建议

- 继续优先使用 `git merge upstream/main`，不要对当前这种大分叉状态轻易改用 rebase。
- 合并后优先跑 `fork/scripts/update-local-openclaw.sh`，并额外用 `openclaw gateway status --deep --require-rpc` 做最终健康探测。
- 重点关注：
  - `fork/scripts/update-local-openclaw.sh` 中的本地回归测试门禁是否仍匹配 upstream 文件路径
  - 插件 SDK facade 路径变化后，本地测试 mock 是否仍覆盖真实运行时入口
  - 若 gateway 重启后首轮深探测失败，先检查日志与 warm-up，再判断是否为真实故障
