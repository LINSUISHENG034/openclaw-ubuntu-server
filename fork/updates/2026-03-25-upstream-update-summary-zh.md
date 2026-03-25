# Upstream 更新摘要（2026-03-25）

## 对比范围

- 基准：`origin/main..upstream/main`
- 同步前状态：本地分支相对 `upstream/main` 领先 168 个提交、落后 49 个提交
- 时间窗口：主要覆盖 `2026-03-22` 到 `2026-03-24`
- upstream 最新提交：`e9ac2860c1 docs: prepare 2026.3.24-beta.2 release`
- 相关版本标签：
  - `v2026.3.22`
  - `v2026.3.23`
  - `v2026.3.23-2`
  - `v2026.3.24-beta.1`
  - `v2026.3.24-beta.2`

## 核心变化

### 1. 2026.3.22 是一轮较大的基础升级

- 插件安装默认改为优先走 `ClawHub`，只有找不到包或版本时才回退到 npm。
- Plugin SDK 公开面正式收敛到 `openclaw/plugin-sdk/*`，旧的 `openclaw/extension-api` 路径被移除。
- 浏览器侧移除了旧的 Chrome extension relay 路径，迁移到现有 session / raw CDP 路线。
- 配置和运行时继续清理历史兼容层，包括旧 `CLAWDBOT_*` / `MOLTBOT_*` 环境变量和旧状态目录兼容逻辑。

### 2. provider、模型与工具能力继续扩展

- 新增 `anthropic-vertex` provider，可通过 Google Vertex AI 使用 Claude。
- 增强 MiniMax、xAI、GitHub Copilot、OpenAI 等模型目录与 fast/reasoning 路径。
- 新增或完善 Exa、Tavily、Firecrawl 等 Web/Search 工具与插件化入口。
- Gateway 的 OpenAI 兼容层新增 `/v1/models` 与 `/v1/embeddings`，并改进 chat/responses 的模型透传。

### 3. Skills、插件安装和插件生态明显增强

- 增加原生 `skills search|install|update` 流程，并让 CLI / Gateway / Control UI 更好地对接 ClawHub。
- 多个 bundled skill 增加一键安装元数据，缺依赖时可提示安装方案。
- Marketplace / bundle / plugin 的安装、更新、版本兼容和运行时发现链路都被进一步收紧和稳定化。
- 文档大幅扩充，尤其是 Plugin SDK 的 overview、entrypoints、runtime、testing、migration、setup 等页面。

### 4. 多渠道与消息分发路径有不少用户可感知改动

- Microsoft Teams 切到官方 SDK，并补齐流式回复、welcome card、typing indicator、反馈/反思和原生 AI 标识。
- Slack 交互式回复、Discord 自动线程命名、Telegram topic 编辑/自动命名、Feishu 卡片和 mention 策略都有增强或修复。
- WhatsApp、Telegram、Discord、Feishu 等渠道都有一批围绕 reply 路由、超时、成员权限和错误可见性的稳定性修复。

### 5. Control UI、macOS app 与移动端持续演进

- `/tools` 和 Control UI 开始区分“当前 agent 此刻可用的工具”，减少工具可用性误判。
- Control UI 的 skills、agents、markdown 预览、usage、sidebar、聊天视图等界面明显重做。
- macOS 配置页从 pill 导航转向树状侧栏，skills 配置和 API key 提示更完整。
- Android / iOS / shared chat UI 也继续补充节点能力、主题适配和会话交互改进。

### 6. 启动性能、懒加载与测试基建是这一轮的另一条主线

- 大量提交集中在 lazy-load、启动导入裁剪、runtime registry 延迟加载、memory/status manager 精简、cron/store churn 降低。
- 测试侧持续调整 Vitest lane、线程池、no-isolate 清理与 CI fanout，以降低 OOM 和启动热点。
- 对这个长期分叉 fork 来说，合并后要重点验证插件发现、`dist` 运行时入口、gateway 启动和本地定制的回归脚本。

## 重要修复

- 修补 sandbox media `mediaUrl` / `fileUrl` 绕过，防止越过媒体根目录限制。
- 修复 Docker 首启 setup 死循环、Gateway channel 启动互相阻塞、以及部分 restart/sentinel 恢复路径。
- 修复 Node 22 安装兼容性，下限明确到 `22.14+`，并让 `openclaw update` 在升级前检查目标包的 `engines.node`。
- 修复 DeepSeek 价格、Google provider base URL、LanceDB 代理初始化、默认浏览器 Edge 检测等运行时问题。

## 本地同步建议

- 当前 fork 仍是长期分叉状态，继续优先使用 `git merge upstream/main`，不要切成 rebase 工作流。
- 合并前先处理干净与 upstream 同时改动的未提交文件，否则 merge 很可能被 Git 直接拒绝。
- 合并后不要只看 `fork/scripts/update-local-openclaw.sh` 的退出码，还要补跑：
  - `openclaw gateway status --deep --require-rpc`
  - `ss -ltnp | rg 18789`
  - `journalctl --user -u openclaw-gateway.service -n 50 --no-pager`
- 如果首个严格 RPC 探针失败，先确认网关是否仍在 warm-up，而不是立刻判定启动失败。
