<div align="center">

# tg-aibot

**面向 Telegram 群聊的上下文感知 AI 气氛机器人**

不是逐条抢答的客服机器人，而是会判断什么时候该说话、什么时候只点一个 Reaction、什么时候保持安静的群聊参与者。

[![CI](https://github.com/sanrokamlan-prog/tg-aibot/actions/workflows/ci.yml/badge.svg)](https://github.com/sanrokamlan-prog/tg-aibot/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![License](https://img.shields.io/github/license/sanrokamlan-prog/tg-aibot)](LICENSE)

[快速部署](#快速部署) · [能力矩阵](#能力矩阵) · [配置参考](#配置参考) · [管理命令](#管理命令) · [升级与迁移](#升级与迁移) · [安全边界](#安全边界)

</div>

---

tg-aibot 使用 Telegram 长轮询接收群消息，通过 OpenAI 兼容接口完成意图判断与回复生成。它不在服务器本地运行大模型，不需要域名、SSL、反向代理或开放入站端口，适合部署在低配 VPS 上长期运行。

> [!IMPORTANT]
> 机器人要理解普通群消息，必须在 `@BotFather` 中关闭 Privacy Mode。图片理解、语音转写、链接读取和 TTS 默认关闭，确认模型与接口支持后再按需启用。

## 为什么它不像普通聊天机器人

自然对话现已支持连续文字合并、短时间内免 @ 接话、按群友表达节奏调整语气，以及有原消息可核对的表达学习。配置和部署后的验收方法见 [自然对话说明](docs/natural-conversation.md)。

| 场景 | 行为 |
| --- | --- |
| 群友 `@机器人` 或回复机器人 | 必须尝试给出有效回复，并引用原消息 |
| 普通群聊 | 满足冷却、消息间隔和概率后才触发；聊天越密集，插话概率越低 |
| 正在与你聊天 | 同一人短时间继续发言可免 @ 接话；简单致谢收住，不追着别人聊 |
| 连续补充 | 短暂等待同一人的连续文字，合起来理解；生成中的补充会进入下一轮 |
| 群聊冷场 | 有自然后续才发言，也可以安静旁观；同一轮对话不会反复自言自语 |
| 只需要轻量回应 | AI 可以选择 Telegram Reaction 或匹配语境的贴纸 |
| 没有值得回应的内容 | AI 可以选择 `silent`，不发送消息 |
| Telegram Forum Topic | 每个 Topic 独立保存上下文，不会跨话题串线 |
| 安静时段 | 禁止随机插话和冷场复活，但被直接提及时仍然回复 |

AI 每次被触发后只会选择一种动作：

```text
silent   不回应
reaction 给当前消息添加 Reaction
sticker  发送匹配标签的群专属贴纸
reply    发送文字，或在开启后发送 TTS 语音
```

## 能力矩阵

| 模块 | 能力 | 默认状态 |
| --- | --- | --- |
| 上下文 | 群与 Topic 隔离、SQLite 持久化、严格 TTL 定期清理、手动清除 | 开启 |
| 触发策略 | 被提及、昵称称呼、自然接话、随机插话、冷场判断、自适应概率、安静时段 | 开启；昵称需配置 |
| 对话节奏 | 同一人连续文字合并、同群有界排队、补充消息更新回复、取消过时插话 | 开启 |
| 互动动作 | `silent`、Reaction、贴纸、文字回复 | 开启 |
| 模型路由 | 被提及、随机、冷场可分别指定模型 | 开启 |
| 接口容错 | 多供应商、多 Key、多模型轮询；失败冷却、限流等待、空回复换模型、停机排空 | 开启 |
| 群管理 | Inline 面板、活跃度预设、群级参数持久化 | 开启 |
| 人设 | 全局基础人设 + 每个群最多 30 条附加规则；按目标消息和引用关系回复 | 开启 |
| 记忆 | 管理员确认后记录当前群/Topic 的短期记忆，可删除、自动过期 | 可用 |
| 表达学习 | 核对真人原文、按群/Topic 隔离、场景匹配、支持查看删除，默认保留 30 天 | 开启 |
| OpenCode | 可选自动安装 CLI，发现免费模型并在失败时尝试下一模型 | 可用 |
| 关键词规则 | 固定回复、删除匹配消息、独立通知冷却 | 开启 |
| 用量 | 24 小时请求量、成功数、字符数和平均延迟 | 开启 |
| 图片理解 | 将触发消息中的图片交给视觉模型 | 关闭 |
| 语音转写 | OpenAI 兼容 `/audio/transcriptions` | 关闭 |
| 链接摘要 | 安全读取首个公网链接，校验并固定公网解析地址 | 关闭 |
| TTS | Edge 免费语音或 OpenAI 兼容 `/audio/speech` | 关闭 |
| 迁移 | 一键导出/恢复 `.env` 与 Docker 数据卷 | 可用 |

## 工作流程

```mermaid
flowchart LR
    A[Telegram 群消息] --> B[保存到 SQLite]
    B --> C{关键词规则命中?}
    C -->|是| D[固定回复或删除消息]
    C -->|否| E{触发条件满足?}
    E -->|否| F[保持安静]
    E -->|是| Q[收齐连续文字并按群排队]
    Q --> G[按需读取图片/语音/链接]
    G --> H[模型池轮询]
    H -->|失败/空输出/无效 JSON| I[冷却当前 Key/模型]
    I --> H
    H --> J{AI 决策}
    J --> K[Reaction]
    J --> L[贴纸]
    J --> M[文字或语音]
    J --> F
```

同一个群同一时间只允许一个 AI 请求，直接提问会排队处理，不同群仍可并行。同一人连续补充文字默认等待 900ms，最长 3 秒；生成期间收到补充，会结合新上下文处理。媒体文件只会在消息已经触发 AI 后下载，不会扫描群里的每一张图片或每一条语音。

## 运行要求

| 项目 | 最低配置 | 推荐配置 |
| --- | --- | --- |
| CPU | 1 核 | 1 核或以上 |
| 内存 | 512 MB | 1 GB |
| 硬盘 | 5 GB | 10 GB |
| 系统 | 支持 Docker 的 Linux | Ubuntu 22.04+ / Debian 12+ |
| Docker | Docker Engine + Compose v2 | 当前稳定版本 |
| 网络 | 可访问 Telegram 和 AI 接口 | 稳定国际网络 |

机器人只负责调用远程模型接口。单独部署时，`1C1G + 10GB` 足够长期使用。

## 快速部署

### 1. 创建 Telegram Bot

1. 在 Telegram 打开 `@BotFather`，发送 `/newbot`。
2. 按提示设置名称和用户名，保存生成的 `BOT_TOKEN`。
3. 向 `@BotFather` 发送 `/setprivacy`。
4. 选择刚创建的机器人，然后选择 `Disable`。
5. 把机器人加入目标群；如需关键词删除消息，授予删除消息权限。

如果机器人已经在群里，修改 Privacy Mode 后建议将它移出群再重新加入。

### 2. 准备 AI 接口

常规部署可以使用 OpenAI 兼容接口，至少包含：

| 配置 | 示例 |
| --- | --- |
| `AI_BASE_URL` | `https://api.example.com/v1` |
| `AI_API_KEY` | `sk-xxxxxx` |
| `AI_MODEL` | `gpt-4o-mini` |

支持常见的 `/chat/completions`，也支持 Responses API。中转站提供完整地址时可以直接使用 `AI_API_URL`。需要 Anthropic、Gemini 或多个 Key/模型轮询时，使用下方的[多供应商模型池](#多供应商模型池与故障切换)。也可单独配置 [OpenCode](#opencode-cli-免费模型)，真实生成可用性以部署后的验证为准。

### 3. 安装 Docker

Ubuntu / Debian 可以使用 Docker 官方安装脚本：

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo apt-get update
sudo apt-get install -y git
```

确认 Compose v2 可用：

```bash
docker --version
docker compose version
```

> [!NOTE]
> 快速备份与迁移脚本依赖 `docker compose`，不支持老式 `docker-compose` 命令。

### 4. 下载并配置

```bash
git clone https://github.com/sanrokamlan-prog/tg-aibot.git
cd tg-aibot
```

推荐使用交互式配置：

```bash
docker run --rm -it \
  -v "$PWD:/app" \
  -w /app \
  node:24-alpine \
  node scripts/setup-env.js
```

脚本会校验 Bot Token、API 地址、模型、管理员 ID 和互动参数，然后原子写入 `.env`。如果服务器已经安装 Node.js 24，也可以运行：

```bash
npm run setup
```

手动配置方式：

```bash
cp .env.example .env
nano .env
```

最小可运行配置：

```env
BOT_TOKEN=123456789:AAxxxxxxxxxxxxxxxxxxxx

AI_API_TYPE=chat_completions
AI_BASE_URL=https://api.example.com/v1
AI_API_KEY=sk-xxxxxx
AI_MODEL=gpt-4o-mini

# 建议部署后通过 /chat_id 获取并填写
ALLOWED_CHAT_IDS=-1001234567890

# 可选：Telegram 管理员之外的手动管理白名单
ADMIN_USER_IDS=123456789
```

### 5. 启动并验证

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
```

看到下面信息说明启动成功：

```text
机器人已启动: @your_bot (123456789)
```

在 Telegram 群里依次发送：

```text
/my_id
/chat_id
/ai_test
/ai_panel
```

`/ai_test` 成功后，再测试 `@机器人 你好`。普通消息不会每条都回复，这是预期行为。

## 推荐起步配置

以下配置适合希望机器人存在感自然、成本可控的普通群聊：

```env
# 控制发给模型的上下文与输出
AI_MAX_CONTEXT_MESSAGES=24
AI_MAX_INPUT_CHARS=6000
AI_MAX_MESSAGE_CHARS=600
AI_MAX_OUTPUT_TOKENS=600
AI_REQUEST_TIMEOUT_MS=30000

# 自然互动
REACTION_ENABLED=true
RANDOM_REPLY_CHANCE=0.05
MIN_REPLY_INTERVAL_SECONDS=60
MIN_MSGS_BETWEEN_REPLIES=3
IDLE_THRESHOLD_MINUTES=20
IDLE_COOLDOWN_MINUTES=60
CONVERSATION_DEBOUNCE_MS=900
CONVERSATION_FOLLOWUP_SECONDS=120
EXPRESSION_LEARNING_ENABLED=true

# 短期记忆
MAX_HISTORY=40
MESSAGE_TTL_HOURS=24
USAGE_TTL_DAYS=30

# 多模态和语音先保持关闭
VISION_ENABLED=false
TRANSCRIPTION_ENABLED=false
LINK_PREVIEW_ENABLED=false
TTS_ENABLED=false
```

机器人还会根据最近两分钟的消息密度调整随机概率；即使配置值较高，实际随机概率也不会超过 `0.5`。

## 配置参考

完整模板见 [.env.example](.env.example)。修改 `.env` 后需要重建或重启容器：

```bash
docker compose up -d --build
```

### Telegram 与访问控制

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BOT_TOKEN` | 必填 | `@BotFather` 生成的机器人 Token |
| `ALLOWED_CHAT_IDS` | 空 | 允许使用机器人的群 ID，逗号分隔；空值表示不限制 |
| `ADMIN_USER_IDS` | 空 | 额外管理员用户 ID，逗号分隔 |
| `TZ` | `Asia/Shanghai` | 容器时区，影响安静时段判断 |

建议先部署，在群里使用 `/chat_id` 和 `/my_id` 取得准确 ID，再写入 `.env`。

### AI 接口与模型路由

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_API_TYPE` | `chat_completions` | `chat_completions`、`responses`、`anthropic` 或 `gemini` |
| `AI_BASE_URL` | Groq OpenAI 地址 | 主接口基础地址 |
| `AI_API_URL` | 空 | 主接口完整地址；填写后优先于 Base URL |
| `AI_API_KEY` | 必填 | 主接口 API Key |
| `AI_MODEL` | `llama-3.3-70b-versatile` | 默认模型 |
| `AI_MODEL_RANDOM` | 空 | 随机插话专用模型；空值继承默认模型 |
| `AI_MODEL_IDLE` | 空 | 冷场复活专用模型；空值继承默认模型 |
| `AI_REQUEST_TIMEOUT_MS` | `30000` | 单次 AI 请求超时 |
| `AI_RESPONSE_MAX_BYTES` | `1048576` | AI HTTP 响应体最大字节数 |
| `AI_DISABLE_RESPONSE_STORAGE` | `true` | Responses API 请求附带 `store: false` |
| `AI_CHAT_TOKEN_FIELD` | `max_tokens` | Chat Completions 的输出 token 字段名 |

群管理员还可以用 `/ai_model mention|random|idle` 覆盖当前群的模型，不影响其他群。

### 多供应商模型池与故障切换

复制 [`ai-providers.example.json`](ai-providers.example.json) 为 `ai-providers.json`，修改接口、模型及 `apiKeysEnv`，并把对应的 Key 写进 `.env`。不使用示例中的 `free-cli` 时，将该项设为 `"enabled": false`。

Docker 使用命名卷保存模型池文件，先构建并创建容器，再复制配置：

```bash
cp ai-providers.example.json ai-providers.json
# 编辑 ai-providers.json 和 .env，填写实际接口、模型及 Key
docker compose create --build
docker compose cp ai-providers.json tg-ai-bot:/app/data/ai-providers.json
```

在 `.env` 设置以下选项后，执行 `docker compose up -d --build`：

```env
AI_PROVIDERS_FILE=/app/data/ai-providers.json
AI_POOL_STRATEGY=round_robin
AI_MAX_ATTEMPTS=6
AI_TOTAL_TIMEOUT_MS=90000
AI_FAILURE_COOLDOWN_MS=60000
```

支持 `chat_completions`、`responses`、Anthropic `messages`、Gemini `generateContent` 和 `opencode`。同一供应商可以填多个 `apiKeysEnv` 与 `models`，程序会展开成独立的故障单元。`/ai_providers` 可查看当前冷却状态。配置文件在每次 AI 请求前读取，可在 Docker 卷中更新后立即生效。

### OpenCode CLI 免费模型

OpenCode 是独立 CLI，程序不会把 Telegram Token、API Key 或聊天记录写入 OpenCode 配置。发送给模型的聊天上下文仍会进入 OpenCode 会话记录，应一并保护数据卷。启用自动安装：

```env
OPENCODE_ENABLED=true
OPENCODE_AUTO_INSTALL=true
OPENCODE_MODELS=
```

或使用可选 Compose 覆盖：

```sh
docker compose -f docker-compose.yml -f docker-compose.opencode.yml up -d --build
```

机器人启动时会先检查安装并启动 OpenCode 常驻服务，收到消息后通过 `run --server` 向同一服务提交输入，不为每条消息重启服务。每 30 秒检查一次健康状态，空闲时进程退出也会自动重启；机器人退出时清理自己启动的服务。服务只监听 `127.0.0.1`，认证口令只保存在内存。使用 OpenCode 原生 `build` agent，工具执行需要确认，非交互调用自动拒绝工具权限请求。

免费模型通过常驻服务的 `opencode models` 动态发现，默认每次最多尝试 3 个，失败后冷却并切换下一个或普通 API。可以先运行 `npm run opencode:install`，再运行 `npm run opencode:models` 查看目录。免费模型由 OpenCode 服务方提供，目录存在不代表当前能生成；服务返回 429、403、超时或无效 JSON 时按各模型分别记录失败。

逐个实测目录里的免费模型，结果保存为 `data/opencode-model-probe.json`：

```sh
npm run opencode:probe
```

测试常驻模式并在测试完成后继续运行服务：

```sh
npm run opencode:service -- --probe-all
```

这两个命令都会发出真实模型请求并使用免费额度。`opencode:probe` 结束后清理自己的服务；`opencode:service` 持续运行直到收到退出信号。正常运行机器人时只需 `npm start`，无需单独再运行测试服务。

Linux 部署后应在容器内验证真实回复，而不仅查看模型列表：

```sh
docker compose exec -e OPENCODE_SMOKE_MODEL=opencode/deepseek-v4.1-flash-free#high tg-ai-bot npm run opencode:smoke
```

2026-11-10 已在 GitHub Actions 的 Ubuntu 与 Alpine 生产容器实际安装 OpenCode 2.2.6，启动服务并发送真实请求。安装和目录发现通过，但已测的 DeepSeek、Big Pickle、GLM、MiMo、Nemotron、Flint 均返回 HTTP 429，原生独立 CLI 与机器人路径均未获得真实回复。完整证据见 [Actions 实测报告](docs/opencode-actions-2026-11-10.md)。机器人适配层稳定生成真实回复仍待验收；模型目录可读取、测试接口通过，均不能替代真实聊天验收。

可以在 [OpenCode real generation](https://github.com/sanrokamlan-prog/tg-aibot/actions/workflows/opencode-validation.yml) 点击 **Run workflow**，在 GitHub 托管的 Ubuntu 与 Alpine Docker 中自动安装 CLI、发现免费模型并测试真实回复。默认测试 3 个模型，每个模型对比原生 CLI 普通问候和本项目完整模型路由、严格 JSON 解析后的回复；至少一个模型通过机器人路径，该平台才通过。测试会使用免费额度，不配置或使用仓库 Secret，不连接 Telegram。每个平台的 `report.json` 保存在 Actions artifacts 和运行摘要中，记录安装、版本、目录、逐模型回复及失败状态；CLI 会话目录不会上传。

同样的验收脚本可在部署机器运行 `npm run opencode:validate`，需要启用 `OPENCODE_ENABLED=true` 和自动安装，或指定已有 `OPENCODE_BIN`。该命令会发出真实请求，报告位于 `data/opencode-validation/report.json`。

CLI 安装包会根据操作系统、CPU 和 libc 选择二进制，程序从安装包的 `bin` 字段读取实际路径；Linux 文件名也可能带 `.exe`，不能按扩展名判断是否为 Windows 程序。`OPENCODE_BIN` 可指定已有 CLI 的绝对路径；默认使用独立配置，需要复用当前系统用户的 OpenCode 配置时设置 `OPENCODE_ISOLATED=false`。Windows 上调用成功不能证明 Linux 服务器的免费模型额度或网络可用，部署后以真实生成测试为准。

### 兼容旧版主备配置

```env
AI_FALLBACK_API_TYPE=chat_completions
AI_FALLBACK_BASE_URL=https://backup.example.com/v1
AI_FALLBACK_API_KEY=sk-backup
AI_FALLBACK_MODEL=gpt-4o-mini
```

模型池出现以下情况时会尝试下一项：

- HTTP `408/409/425/429`
- HTTP `5xx`
- 网络连接错误
- 请求超时
- 图片请求返回 `400`，且下一项支持视觉
- 返回空内容、无效 JSON，或直接提及时没有可发送文字

HTTP `401/403` 也会冷却当前 Key。程序不会把接口原始错误正文发送到群里，避免泄露响应中的 Key 或聊天内容。

### 上下文与成本

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_MAX_CONTEXT_MESSAGES` | `24` | 单次最多发送给 AI 的最近消息数 |
| `AI_MAX_INPUT_CHARS` | `6000` | 单次群聊记录最大字符数 |
| `AI_MAX_MESSAGE_CHARS` | `600` | 每条消息截断长度 |
| `AI_MAX_OUTPUT_TOKENS` | `600` | 最大输出 token |
| `MAX_HISTORY` | `40` | 每个群/Topic 在 SQLite 中保留的最大消息数 |
| `MESSAGE_TTL_HOURS` | `24` | 短期上下文保留时间 |
| `USAGE_TTL_DAYS` | `30` | AI 用量明细保留时间 |

`MAX_HISTORY` 是本地短期历史上限，真正发送给模型的条数还会受到 `AI_MAX_CONTEXT_MESSAGES` 与字符限制约束。当前默认上下文为 24 条、6000 字符；闲聊会简短，认真提问允许适当展开。

### 当前 Topic 记忆

管理员可以使用 `/memory_add 内容` 记录已确认的群规、术语或偏好；`/memory` 查看，`/memory_del ID` 删除，`/memory_clear` 清空。记忆按群和 Telegram Topic 隔离，默认 30 天过期，不会自动从聊天内容猜测并保存用户隐私。

### 互动策略

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REACTION_ENABLED` | `true` | 允许 AI 使用 Telegram Reaction |
| `RANDOM_REPLY_CHANCE` | `0.05` | 普通消息触发 AI 的基础概率 |
| `MIN_REPLY_INTERVAL_SECONDS` | `60` | 两次主动发言最小间隔 |
| `MIN_MSGS_BETWEEN_REPLIES` | `3` | 再次主动发言前至少经过的群消息数 |
| `IDLE_THRESHOLD_MINUTES` | `20` | 群聊安静多久后考虑复活话题 |
| `IDLE_COOLDOWN_MINUTES` | `60` | 两次冷场复活的最小间隔 |
| `QUIET_HOURS_START` | 空 | 全局安静时段开始，如 `23:00` |
| `QUIET_HOURS_END` | 空 | 全局安静时段结束，如 `08:00` |
| `STICKER_REPLY_CHANCE` | `0.15` | AI 选择贴纸后实际发送的概率 |
| `RULE_COOLDOWN_SECONDS` | `60` | 同一关键词规则的通知冷却 |

这些值是新群默认值。部署后可以通过 `/ai_panel`、`/ai_chance`、`/ai_set` 和 `/quiet` 为每个群独立调整。

### 自然接话与表达学习

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CONVERSATION_DEBOUNCE_MS` | `900` | 收齐同一人连续文字的等待毫秒数，累计最多 3 秒；`0` 关闭等待 |
| `CONVERSATION_FOLLOWUP_SECONDS` | `120` | 机器人回应后，同一人可免 @ 继续接话的时间；`0` 关闭 |
| `BOT_ALIASES` | 空 | 句首昵称称呼，英文逗号分隔，如 `喵喵,小喵` |
| `EXPRESSION_LEARNING_ENABLED` | `true` | 从可核对的真人原文学习表达，并按场景使用；`false` 同时停用已有表达 |
| `EXPRESSION_TTL_DAYS` | `30` | 学到的表达保留天数，每个群/Topic 最多 60 条 |
| `MEMORY_TTL_DAYS` | `30` | 管理员通过 `/memory_add` 确认的记忆保留天数 |

自然接话会考虑回复对象、其他人是否插入对话、是否在回复其他群友及对话是否已经结束。表达学习只附带在正常模型请求中，不额外调用学习模型；资料按群和 Topic 隔离。完整行为和部署后的测试方法见 [自然对话说明](docs/natural-conversation.md)。

### 图片、转写与链接

```env
# 图片理解：当前 AI 模型必须支持视觉输入
VISION_ENABLED=true
VISION_MAX_BYTES=5242880

# 语音转写：兼容 OpenAI /audio/transcriptions
TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_BASE_URL=https://api.example.com/v1
TRANSCRIPTION_API_KEY=sk-xxxxxx
TRANSCRIPTION_MODEL=whisper-1
TRANSCRIPTION_LANGUAGE=zh
TRANSCRIPTION_MAX_BYTES=20971520
TRANSCRIPTION_RESPONSE_MAX_BYTES=1048576
TRANSCRIPTION_TIMEOUT_MS=60000

# 读取触发消息中的第一个公网链接
LINK_PREVIEW_ENABLED=true
LINK_PREVIEW_MAX_BYTES=524288
LINK_PREVIEW_TIMEOUT_MS=10000
```

未单独填写转写地址或 Key 时，会尝试复用主 AI 配置。链接读取会检查全部 DNS 结果，拒绝回环、私有和保留地址，并通过自定义 dispatcher 将请求固定到已经验证的地址；每次重定向都会重新解析和校验，降低 DNS rebinding 风险。

> [!CAUTION]
> 开启多模态后，相应图片、语音转写结果或网页摘要会发送给配置的 AI 服务。启用前应确认群成员知情，并评估所用接口的隐私政策。

### TTS 语音回复

免费 Edge TTS：

```env
TTS_ENABLED=true
TTS_PROVIDER=edge
TTS_EDGE_VOICE=zh-CN-XiaoxiaoNeural
TTS_REPLY_CHANCE=1
```

OpenAI 兼容语音接口：

```env
TTS_ENABLED=true
TTS_PROVIDER=openai
TTS_BASE_URL=https://api.example.com/v1
TTS_API_KEY=sk-xxxxxx
TTS_MODEL=gpt-4o-mini-tts
TTS_OPENAI_VOICE=alloy
TTS_RESPONSE_FORMAT=mp3
TTS_REPLY_CHANCE=1
TTS_TIMEOUT_MS=30000
TTS_MAX_BYTES=10485760
TTS_SPEED=1
```

`TTS_ENABLED` 决定尚未保存群配置时的语音默认状态。更稳妥的做法是保持 `false`，再由管理员在需要语音的群发送 `/voice_on`；该命令会覆盖当前群设置。生成语音失败时会自动回退到文字回复。

### SQLite 与数据目录

| 变量 | Docker 默认值 | 说明 |
| --- | --- | --- |
| `DATA_DIR` | `/app/data` | 持久化数据目录 |
| `DATABASE_PATH` | `/app/data/bot.db` | SQLite 数据库路径 |
| `MAINTENANCE_INTERVAL_MINUTES` | `60` | 物理清理过期消息/用量并优化 SQLite 的间隔 |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `15000` | 停机时等待在途 AI 请求完成的最长时间 |

Docker Compose 使用命名卷 `tg-ai-bot-data` 保存：

- 群配置与模型覆盖
- 每个群/Topic 的短期上下文
- 群贴纸及标签
- 群人设规则
- 关键词规则
- AI 用量统计
- 管理员确认的 Topic 记忆和学到的表达

SQLite 使用 WAL 模式。启动时和运行期间会定期清理过期消息、用量记录并执行 `PRAGMA optimize`。容器重建不会删除命名卷；不要使用 `docker compose down -v`，除非明确要删除全部机器人数据。

## 管理命令

### 权限层级

| 权限 | 命令 |
| --- | --- |
| 所有人 | `/my_id` |
| 允许群内成员 | `/chat_id`、`/ai_status`、`/usage`、`/extensions`、`/sticker_id` |
| Telegram 群管理员或 `ADMIN_USER_IDS` | 其余配置、人设、规则和贴纸管理命令 |

`ALLOWED_CHAT_IDS` 配置后，不在名单中的群不会触发 AI，也不能使用群级查询命令。

### 状态与开关

| 命令 | 作用 |
| --- | --- |
| `/my_id` | 查看自己的 Telegram 用户 ID |
| `/chat_id` | 查看当前群 ID 和 Topic ID |
| `/ai_status` | 查看当前群配置、模型、上下文和 24 小时用量 |
| `/ai_test` | 测试当前群 AI 接口并显示模型与 Provider |
| `/ai_providers` | 查看模型池、失败冷却及 OpenCode 常驻状态 |
| `/ai_on` / `/ai_off` | 开启或关闭当前群 AI 互动 |
| `/voice_on` / `/voice_off` | 开启或关闭当前群 TTS 回复 |
| `/context_clear` | 清除当前 Topic 短期上下文，不影响群配置、人设、规则和贴纸 |
| `/usage` | 查看最近 24 小时请求统计 |
| `/extensions` | 查看已加载扩展模块 |

### 面板与互动参数

```text
/ai_panel
/ai_config
```

Inline 面板可以切换 AI、Reaction、语音，并应用三种预设：

| 预设 | 随机概率 | 主动冷却 | 消息间隔 | 冷场阈值 |
| --- | ---: | ---: | ---: | ---: |
| 安静 | `0.01` | 300 秒 | 8 条 | 60 分钟 |
| 均衡 | `0.03` | 180 秒 | 5 条 | 30 分钟 |
| 活跃 | `0.08` | 60 秒 | 3 条 | 20 分钟 |

精细调整：

```text
/ai_chance 0.05
/ai_set random_chance 0.03
/ai_set min_interval 180
/ai_set min_msgs 5
/ai_set idle_threshold 30
/ai_set idle_cooldown 120
/ai_set sticker_chance 0.15
/ai_set tts_chance 1
/quiet 23:00 08:00
/quiet off
```

`/quiet` 支持跨午夜时段。安静时段只禁止主动互动，不阻止直接提及回复。

### 群级模型路由

```text
/ai_model mention gpt-5-mini
/ai_model random gpt-4o-mini
/ai_model idle default
```

可选模式为 `mention`、`random`、`idle`。模型名使用 `default` 会清除当前群覆盖并恢复 `.env` 路由。

### 群人设

```text
/persona
/persona_add 说话简短一点，像真实群友
/persona_add 偶尔使用广东话，但不要影响理解
/persona_del 2
/persona_clear
```

也可以先发送一条规则说明，再回复该消息发送 `/persona_add`。每个群最多保留 30 条附加规则，每条最多 500 字符。

全局基础人设可以使用 `PERSONA_PROMPT` 覆盖；留空时使用 [src/persona.js](src/persona.js) 内置人设。

### Topic 记忆与表达

以下命令均要求管理员权限，并仅操作当前群的当前 Topic：

| 命令 | 作用 |
| --- | --- |
| `/memory` | 查看管理员确认的记忆 |
| `/memory_add 内容` | 添加已确认的群内约定、术语或偏好 |
| `/memory_del ID` / `/memory_clear` | 删除一条或清空确认记忆 |
| `/expressions` | 查看模型从真人原文中学到的表达及 ID |
| `/expression_del ID` / `/expression_clear` | 删除一条或清空学到的表达 |

`/context_clear` 清除短期聊天记录；确认记忆和表达集合分别使用对应的清空命令管理。

### 关键词规则

```text
/rule_add reply 早上好 => 早啊，今天状态怎么样？
/rule_add block 广告链接 => 请不要发广告
/rule_list
/rule_del 3
/rule_clear
```

| 类型 | 行为 |
| --- | --- |
| `reply` | 命中关键词后发送固定回复 |
| `block` | 尝试删除原消息，并按冷却发送提示 |

`block` 每次命中都会尝试删除消息，即使提示仍处于冷却期。机器人必须拥有删除消息权限；规则应尽量精确，避免误删正常内容。

### 群贴纸池

1. 在群里发送一张贴纸。
2. 管理员回复该贴纸：

```text
/sticker_add 开心 赞同
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `/sticker_id` | 查看被回复贴纸的 `file_id` |
| `/sticker_add 标签...` | 加入当前群贴纸池并附加标签 |
| `/sticker_list` | 查看当前群贴纸池 |
| `/sticker_clear` | 清空当前群贴纸池 |

AI 会根据语境选择贴纸标签，再按当前群的 `sticker_chance` 决定是否实际发送。

也可以在 `.env` 中使用 `STICKER_IDS` 配置逗号分隔的全局贴纸池，作为所有群的后备选择。群内 `/sticker_add` 支持标签匹配，更适合作为主要配置方式。

## 升级与迁移

### 从 1.x 原地升级到 2.x

2.x 继续使用原命名卷 `tg-ai-bot-data`。首次启动会自动将旧版 `chat-config.json` 和 `stickers.json` 导入 SQLite，旧 JSON 文件保留不删。

```bash
cd ~/tg-aibot

# 服务器有本地修改时先处理，不要强行覆盖
git status

git pull

# 使用旧数据和现有 .env 生成一致备份
sh scripts/migrate.sh export "$HOME/tg-aibot-pre-v2.tar.gz"

docker compose up -d --build
docker compose logs --tail=100 -f
```

首次启动日志可能出现：

```text
已导入旧数据: 群配置 1，贴纸 5
机器人已启动: @your_bot (123456789)
```

旧版 `.env` 可以直接继续使用。缺少的 2.0 配置会采用代码默认值，多模态和 TTS 不会自动开启。

### 日常更新

本次更新会事务性升级 SQLite 到 schema 3，保留旧上下文和已确认记忆。先导出备份，再更新并重建；回退旧程序时需恢复与旧 schema 匹配的数据库备份。

```bash
cd ~/tg-aibot
sh scripts/migrate.sh export
git pull
docker compose up -d --build
docker compose logs --tail=100
```

不要使用 `docker compose down -v`，否则会连同 SQLite、贴纸、规则和群配置一起删除。

### 迁移到新服务器

旧服务器导出：

```bash
cd ~/tg-aibot
sh scripts/migrate.sh export
```

脚本会短暂停止机器人，复制一致的 `.env` 和 `/app/data`，然后恢复原运行状态。默认生成：

```text
tg-aibot-backup-YYYYMMDD-HHMMSS.tar.gz
```

将备份文件通过可信通道传到新服务器，然后：

```bash
git clone https://github.com/sanrokamlan-prog/tg-aibot.git
cd tg-aibot
sh scripts/migrate.sh import /path/to/tg-aibot-backup.tar.gz
```

目标目录已经存在 `.env` 时，必须显式允许覆盖：

```bash
sh scripts/migrate.sh import /path/to/tg-aibot-backup.tar.gz --force
```

导入前会校验压缩包文件清单和路径，拒绝未知文件及目录穿越路径。备份文件权限默认为 `600`。

> [!WARNING]
> 迁移包包含 `BOT_TOKEN`、`AI_API_KEY` 和完整机器人数据。不要上传到 GitHub、公开网盘或聊天群；迁移完成后及时删除。

## 运维

### 常用操作

```bash
# 查看容器状态
docker compose ps

# 跟踪日志
docker compose logs -f

# 查看最近 200 行
docker compose logs --tail=200

# 重启
docker compose restart

# 停止但保留数据
docker compose down

# 重新构建
docker compose up -d --build
```

### 运行时保护

Docker Compose 默认启用：

- 只读容器根文件系统
- `/tmp` 独立内存文件系统与容量限制
- `no-new-privileges`
- 删除全部 Linux capabilities，并限制容器最多 100 个进程
- PID 1 init 进程
- 20 秒优雅停止时间
- 停机时拒绝新 AI 请求，并等待在途请求完成后再关闭 SQLite
- 单文件 10 MB、最多 3 个日志文件轮转
- `/app/data` 独立持久化命名卷

机器人没有 HTTP 管理端口，不会向公网监听服务。

## 故障排查

| 现象 | 优先检查 |
| --- | --- |
| 容器不断重启 | `docker compose logs --tail=200`，检查 `BOT_TOKEN` 与 `.env` 格式 |
| 普通消息完全看不到 | `@BotFather` 的 `/setprivacy` 是否为 `Disable`，修改后重新入群 |
| 被 `@` 也不回复 | `/ai_test`，检查 Base URL、Key、模型、余额和网络 |
| 管理命令提示无权限 | 使用 `/my_id`，确认 Telegram 管理员状态或 `ADMIN_USER_IDS` |
| 出现 `401/403` | API Key、模型权限、接口类型或完整 API URL |
| 出现 `429` | 降低互动频率、缩短上下文、配置备用接口或检查额度 |
| 图片无法理解 | `VISION_ENABLED` 与当前模型视觉能力 |
| 语音转写失败 | 转写地址、Key、模型、文件大小和接口兼容性 |
| TTS 只发文字 | 群内 `/voice_on`、Provider 配置、语音接口响应和容器日志 |
| 关键词无法删除消息 | 机器人是否拥有群管理中的删除消息权限 |
| 更新后旧配置没导入 | 数据卷是否仍为 `tg-ai-bot-data`，日志是否出现 JSON 解析错误 |

快速检查：

```bash
docker compose config
docker compose ps
docker compose logs --tail=200
```

## 安全边界

### 已有保护

- `ALLOWED_CHAT_IDS` 可以限制机器人只服务指定群。
- 管理操作要求 Telegram 群管理员或手动管理员白名单。
- AI 请求有超时，同群请求有并发锁并在 `finally` 中释放。
- 链接读取默认拒绝回环、私有和保留地址，固定已验证 DNS 结果，并重新验证重定向目标。
- AI、媒体、转写、TTS 和链接正文均设置响应大小上限与超时。
- 外部链接正文在提示词中明确标记为不可信资料，不作为系统指令执行。
- 被关键词规则处理的消息不会写入后续 AI 上下文。
- SQLite 使用事务迁移，旧 JSON 自动导入但不会删除。
- 迁移导入校验压缩包路径和允许文件清单。
- `.env`、数据库和迁移备份都不会进入 Git 版本控制。

### 部署者仍需负责

- 不要公开 `.env`、`BOT_TOKEN`、API Key 或迁移压缩包。
- Token 泄露后使用 `@BotFather /revoke`，API Key 泄露后立即撤销。
- 群聊上下文会发送给配置的 AI 服务；应让群成员知道机器人存在。
- 开启图片、转写和链接能力后，对应内容也会发送给 AI 服务。
- 关键词 `block` 规则不是完整内容审核系统，启用前应验证误删风险。
- `ALLOWED_CHAT_IDS` 留空代表不限制群；长期自用部署建议明确填写。
- 主机系统、Docker、云防火墙和 SSH 安全不属于本项目管理范围。

## 数据与隐私

机器人保存的是带 TTL 的短期上下文，不是永久群记忆。过期数据会在启动时以及默认每小时从内存和 SQLite 中物理清理：

- 默认每个群/Topic 最多 40 条消息
- 默认消息最多保留 24 小时
- 默认 AI 用量明细保留 30 天
- 管理员确认的 Topic 记忆默认保留 30 天，每个 Topic 最多 30 条
- 从真人原文学习的表达默认保留 30 天，每个 Topic 最多 60 条，可查看和删除
- 不提供长期群摘要或无限期历史检索
- 删除 Docker 数据卷会永久删除全部机器人数据

需要检查数据卷时：

```bash
docker volume ls | grep tg-ai-bot
docker compose run --rm --no-deps --entrypoint sh tg-ai-bot -c 'ls -lah /app/data'
```

## 项目结构

```text
tg-aibot/
├── src/
│   ├── index.js               启动与生命周期
│   ├── interactionService.js  消息生命周期与触发编排
│   ├── decisionDelivery.js    Reaction、贴纸、文字和语音投递
│   ├── ai.js                  模型池调用与失败切换
│   ├── aiClient.js            多种 AI 协议、HTTP 与模型路由
│   ├── aiPrompt.js            提示词、上下文裁剪与决策解析
│   ├── conversationContext.js 发言者识别、接话条件与语气参考
│   ├── conversationQueue.js   连续文字合并与群级请求队列
│   ├── expressionStore.js     表达学习、来源核对与过期清理
│   ├── memoryStore.js         管理员确认的 Topic 记忆
│   ├── providerPool.js        多供应商、多 Key、多模型轮询与冷却
│   ├── opencode.js            OpenCode 安装、模型发现与调用
│   ├── opencodeService.js     OpenCode 常驻进程与健康检查
│   ├── commands/              按领域拆分的群管理命令
│   ├── database.js            SQLite Schema 与旧数据导入
│   ├── contextStore.js        Topic 上下文与 TTL
│   ├── defaults.js            运行时与配置向导共享默认值
│   ├── maintenance.js         定期保留期清理与 SQLite 优化
│   ├── mediaContext.js        图片、转写和链接上下文
│   ├── tts.js                 Edge/OpenAI 语音生成
│   └── extensions/            消息扩展模块
├── scripts/
│   ├── setup-env.js           交互式配置
│   ├── check-js.js            跨平台 JavaScript 语法检查
│   └── migrate.sh             备份与跨服务器迁移
├── test/                      Node.js 行为测试
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## 开发与验证

本地需要 Node.js 24.15 或更高版本：

```bash
npm ci
npm run check
npm test
npm run test:coverage
npm audit --omit=dev
```

额外检查：

```bash
sh -n scripts/migrate.sh
docker build -t tg-aibot:test .
```

GitHub Actions 会在 `main` 推送和 Pull Request 时执行：

1. `npm ci`
2. 全部 JavaScript 文件语法检查
3. `npm test`
4. 生产依赖安全审计
5. 迁移脚本语法检查
6. Docker 镜像构建

Dependabot 每月检查 npm、Docker 基础镜像和 GitHub Actions 更新。当前 69 项测试覆盖 AI 请求超时与模型池切换、原生 API 协议、OpenCode 进程管理、连续消息合并、同群排队与多群并行、补充消息更新、身份和 Topic 隔离、表达来源核对与清理、SQLite schema 3 升级、停机排空，以及原有媒体、规则和上下文功能。测试使用模拟模型或本地协议服务，不消耗真实模型额度；真实聊天效果仍需部署验收。

## 适用范围

适合：

- 希望机器人像普通群友一样低频参与讨论
- 需要多个群或 Forum Topic 隔离上下文
- 希望按群调整人设、模型、活跃程度和规则
- 使用 OpenAI、Groq 或 OpenAI 兼容中转站
- 希望用 Docker 在低配 VPS 上长期自托管

不适合：

- 要求每条消息必答的客服机器人
- 需要无限期知识记忆或群聊归档系统
- 需要强一致内容审核或反垃圾平台
- 希望在本机离线运行大模型
- 需要 Web 管理后台或多租户 SaaS

## License

本项目使用 [GNU GPL v3.0](LICENSE)，使用、修改和分发须遵守该许可证。

---

部署完成后先执行 `/ai_test`，再调整活跃度；让机器人少说但说对，通常比提高回复频率更自然。
