# Linux 部署与 OpenCode 调用验证（2026-11-10）

本文记录 OpenCode 接入阶段的历史验证；其中 49 项测试发生在自然对话改造之前。当前版本增加了 17 项自然对话测试，完整提交的 Linux 测试、镜像构建和 CLI 安装结果以对应的 [GitHub Actions](https://github.com/sanrokamlan-prog/tg-aibot/actions/workflows/ci.yml) 为准。

测试机器：用户授权的局域网 Ubuntu x86_64 主机。

项目部署在 `/opt/tg-aibot-test-20261110`，使用目录内的官方 Node.js 24.15.0，不替换系统运行时。Node 压缩包已对照官方 SHASUMS256.txt 校验。现有 OpenCode 为 `/root/.opencode/bin/opencode`，版本 2.2.6。

## 已验证

| 项目 | 结果 |
| --- | --- |
| Windows JavaScript 语法检查 | 65 个文件通过 |
| Windows 测试 | 49/49 通过 |
| Linux JavaScript 语法检查 | 65 个文件通过 |
| Linux 测试 | 49/49 通过 |
| Windows 原生 CLI，Iceman Free | 成功返回“你好！有什么我可以帮你的吗？” |
| Linux 原生交互终端 `opencode mini` | 程序通过 SSH PTY 输入“你好”并发送回车，Big Pickle 返回“你好！有什么可以帮你的吗？” |
| 常驻服务 | 预启动，使用原生 `serve --stdio` 协议并保持 stdin 打开；仅监听回环地址 |
| Linux 空闲故障重启 | 人工终止自有 OpenCode 子进程后，监督进程保持运行并自动拉起新子进程 |
| 实际 CLI 失败后切换 API | CLI 实际失败后转到本机临时 HTTP 协议测试服务；第二次跳过冷却项 |

最后一项的 HTTP 响应是明确标记的测试数据，不是真实 AI 回复，不作为模型生成成功的证据。

## 调用差异与尚未通过项

旧适配实现注入自定义 `chat` agent、全局拒绝权限及工具隐藏策略。同一 Windows CLI 在移除注入配置后出现成功回复，而旧配置请求返回 429。后来未注入配置的原始 CLI 和 Linux 交互终端也返回限流，说明不能只根据这些请求断言唯一原因。

现已改为原生 `build` agent，保留原生工具定义，通过 `ask` 权限让非交互调用拒绝工具执行请求。服务采用 CLI 原生的 `serve --stdio` 启动协议，认证口令仅存于内存。没有修改上游身份、请求头或额度标识。

**修正后的机器人适配层尚未获得稳定的真实生成成功证据。** 已成功的原生 CLI/交互终端测试不能替代这一项验收。后续需在模型额度可用时运行：

```sh
cd /opt/tg-aibot-test-20261110
export PATH="$PWD/node-v24.15.0-linux-x64/bin:$PATH"
OPENCODE_BIN=/root/.opencode/bin/opencode OPENCODE_ISOLATED=false npm run opencode:probe
```

逐模型测试保存 `data/opencode-model-probe.json`。此前通过同一常驻服务依次测试 12 个免费模型及 DeepSeek `#high` 变体，旧配置下 11 项返回 429、2 项返回 403、0 项成功。该记录保留作诊断，**不能据此认定全部模型不可用**。

| 模型 | 旧配置实测 HTTP 状态 |
| --- | --- |
| opencode/beam-free | 403 |
| opencode/big-pickle | 429 |
| opencode/crouton-alpha-free | 403 |
| opencode/deepseek-v4.1-flash-free | 429 |
| opencode/flint-40b-free | 429 |
| opencode/glm-5.3-flash-free | 429 |
| opencode/iceman-free | 429 |
| opencode/inkling-2-small-free | 429 |
| opencode/longcat-2.5-free | 429 |
| opencode/mimo-v2.6-flash-free | 429 |
| opencode/nemotron-3.5-lightning-free | 429 |
| opencode/nemotron-3.5-super-vl-free | 429 |
| opencode/deepseek-v4.1-flash-free#high | 429 |

## 机器上的常驻测试服务

`tg-aibot-opencode-test.service` 已启动，用于保持项目自己的 OpenCode 服务常驻并验证健康检查。未设为开机启用，未绑定 Telegram Token。

```sh
systemctl status tg-aibot-opencode-test
journalctl -u tg-aibot-opencode-test -n 30 --no-pager
systemctl stop tg-aibot-opencode-test
```

正常启动机器人时，机器人会管理自己的 OpenCode 服务，不需要再额外启动这个测试单元。当前没有 BOT_TOKEN，因此未运行 Telegram 收发验收。

Docker 构建在拉取 Node 基础镜像时遇到 Docker Hub 超时，尚未在该机器验证容器构建。源码的 Linux 测试已使用官方 Node 直接运行。已加入 CI 的容器安装/目录冒烟步骤，但本次没有发布或触发远程 CI。

该机器的 npm 自动安装冒烟测试两次超时，日志停留在部分可选平台包的元数据请求，尚未通过自动安装验收。本次常驻验证使用机器已有的 CLI。Windows 上此前安装的 npm CLI 可执行文件可以启动，但不代表这台 Linux 已完成 npm 安装。

## 本地证据

`data/linux-validation/` 保存 Linux 测试日志、逐模型 JSON、原始 CLI 失败记录和实际 CLI 到本机 HTTP 测试服务的切换日志。该目录由 Git 忽略。SSH 凭据不写入项目、报告或服务配置。
