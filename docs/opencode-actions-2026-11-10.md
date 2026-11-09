# GitHub Actions OpenCode 实测（2026-11-10，北京时间）

按用户要求，在 GitHub 托管 Runner 上实际安装 OpenCode 并发送真实模型请求，不使用本机 OpenCode，不注入 Telegram Token 或供应商 Key，不读取仓库 Secret。

## 环境和结果

Ubuntu 原生 Node.js 24，以及项目 `node:24-alpine` 生产镜像，均成功完成 npm 自动安装、执行 OpenCode 2.2.6、启动回环常驻服务和读取免费模型目录。真实生成未通过，两轮均未得到可发送的模型回复。

第二轮把两条调用路径分别测试：

1. 原生 CLI：独立 `run --standalone`，移除机器人注入的 `OPENCODE_CONFIG_CONTENT`，只要求中文问候。
2. 机器人路径：`decideAndReply` → 模型池 → 常驻 OpenCode → 严格决策 JSON 解析，使用项目人设回答固定的模拟聊天。

| 模型 | Ubuntu 原生 / 机器人 | Alpine 原生 / 机器人 |
| --- | --- | --- |
| DeepSeek V4.1 Flash Free `#high` | HTTP 429 / HTTP 429 | HTTP 429 / HTTP 429 |
| Big Pickle（第一轮） | HTTP 429 / HTTP 429 | HTTP 429 / HTTP 429 |
| GLM 5.3 Flash Free | HTTP 429 / HTTP 429 | HTTP 429 / HTTP 429 |
| MiMo V2.6 Flash Free | HTTP 429 / HTTP 429 | HTTP 429 / HTTP 429 |
| Nemotron 3.5 Lightning Free | HTTP 429 / HTTP 429 | HTTP 429 / HTTP 429 |
| Flint 40B Free | HTTP 429 / HTTP 429 | HTTP 429 / HTTP 429 |
| Pulse Alpha Free | 调用失败，未解析到 HTTP 状态 | 本轮目录中不存在，未请求 |

这些结果只证明本次请求的观测状态，不能推断所有网络或所有用户的可用性，也不能把 429 的具体原因认定为本机额度、GitHub IP 或某个账户限制。两条调用路径都失败，也不代表机器人适配层已经通过真实生成验收。

目录也有差异：第二轮 Ubuntu 返回 10 个免费模型，Alpine 返回 12 个，模型集合不同。因此测试会先核对各自的目录，报告 `unavailableModels`，不会对目录中不存在的指定模型发请求。

## 可核对证据

- [第一轮运行](https://github.com/sanrokamlan-prog/tg-aibot/actions/runs/42679721796)：原生问候经常驻服务，测试 DeepSeek、Big Pickle，两平台均为 429。
- [第二轮运行](https://github.com/sanrokamlan-prog/tg-aibot/actions/runs/42680758826)：增加其他模型及无机器人注入配置的原生独立调用。
- [Ubuntu 第二轮完整报告](evidence/opencode-actions-ubuntu-2026-11-10.json)
- [Alpine 第二轮完整报告](evidence/opencode-actions-alpine-2026-11-10.json)

Actions 运行摘要及 artifacts 保留逐模型耗时和状态，仓库另存第二轮报告。所有输入都是固定测试内容；不上传 CLI 配置、认证、会话数据库和日志目录。

## 重跑

打开 [OpenCode real generation](https://github.com/sanrokamlan-prog/tg-aibot/actions/workflows/opencode-validation.yml)，点击 **Run workflow**。可填写逗号分隔的免费模型和每个平台最多测试数量（硬上限 6）。至少一个模型在机器人路径返回可发送的 `reply`，该平台才通过；只有安装或目录成功不会标绿。

该工作流仅手动运行，避免普通提交自动消耗模型额度。普通 CI 继续检查单元测试、审计、Docker 构建、CLI 安装和目录发现。
