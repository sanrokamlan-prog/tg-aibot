# Telegram 群组 AI 气氛活跃机器人

一个可以放进 Telegram 群里的 AI 气氛机器人。它会根据群聊上下文偶尔接话、被 @ 时回复、冷场时主动抛话题。

项目基于 Telegraf + OpenAI 兼容格式的 AI 接口，支持 Groq、OpenAI、各种中转站。默认使用长轮询模式，不需要域名、不需要 SSL、不需要开放任何端口。

---

## 服务器配置要求

这个项目不在服务器本地跑大模型，只是接收 Telegram 消息，然后请求 AI 接口，所以配置要求很低。

### 最低配置

| 项目 | 最低要求 |
| --- | --- |
| CPU | 1 核 |
| 内存 | 512MB |
| 硬盘 | 5GB |
| 系统 | Ubuntu / Debian |
| 网络 | 能访问 Telegram 和你的 AI 中转站 |

### 推荐配置

| 项目 | 推荐 |
| --- | --- |
| CPU | 1 核 |
| 内存 | 1GB |
| 硬盘 | 10GB |
| 系统 | Ubuntu 22.04 / Debian 12 |

**1C1G + 10G 硬盘完全够用。**

如果你的服务器还要同时跑宝塔、Nginx、数据库、其他机器人，建议用 2G 内存会更稳。

---

## 一、创建 Telegram 机器人

1. 打开 Telegram，搜索 `@BotFather`。
2. 给 `@BotFather` 发送：

   ```text
   /newbot
   ```

3. 按提示设置机器人名称和用户名。
4. 创建完成后，BotFather 会给你一个 `BOT_TOKEN`，格式大概像这样：

   ```text
   123456789:AAxxxxxx_xxxxxxxxxxxxxxxxx
   ```

   这个后面要填进 `.env` 文件。

5. 继续给 `@BotFather` 发送：

   ```text
   /setprivacy
   ```

6. 选择你的机器人，然后选择：

   ```text
   Disable
   ```

这一步非常重要。只有关闭 privacy mode，机器人才能看到群里的普通消息。

如果机器人已经在群里了，改完 privacy 后，建议把机器人从群里踢出，再重新拉进群，否则可能不生效。

---

## 二、准备 AI 接口

本项目支持 OpenAI 兼容格式接口。一般中转站都会提供这三项：

| 配置项 | 说明 | 示例 |
| --- | --- | --- |
| `AI_BASE_URL` | 接口基础地址 | `https://api.example.com/v1` |
| `AI_API_KEY` | API Key | `sk-xxxxxx` |
| `AI_MODEL` | 模型名 | `gpt-4o-mini` |

如果你的中转站给的是完整接口地址，例如：

```text
https://api.example.com/v1/chat/completions
```

也可以直接填 `AI_API_URL`。

通常情况下，只需要填 `AI_BASE_URL`，不用填 `AI_API_URL`。

### 使用 Groq 免费 API

如果你暂时没有中转站，也可以先用 Groq 免费 API 测试。

1. 打开 Groq Console：

   ```text
   https://console.groq.com
   ```

2. 注册或登录账号。
3. 进入 API Keys 页面，创建一个新的 API Key。
4. 复制 API Key，填到 `.env` 的 `AI_API_KEY`。
5. Groq 的模型列表可以看官方文档：

   ```text
   https://console.groq.com/docs/models
   ```

Groq 示例配置：

```env
AI_API_TYPE=chat_completions
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=你的GroqApiKey
AI_MODEL=llama-3.3-70b-versatile
```

如果 `llama-3.3-70b-versatile` 不可用，就去 Groq 模型文档里换一个当前可用的模型名。

---

## 三、服务器安装 Docker

先登录你的服务器，然后执行下面命令安装 Docker：

```bash
curl -sSL https://get.docker.com | bash
systemctl enable --now docker
```

再安装 `git`，后面下载项目要用：

```bash
apt update
apt install -y git
```

检查 Docker 是否安装成功：

```bash
docker --version
docker compose version
```

能看到版本号就说明成功。

如果 `docker compose version` 有版本号，后面就使用：

```bash
docker compose up -d --build
```

如果你的系统只支持老版 `docker-compose`，则需要把后面的命令改成：

```bash
docker-compose up -d --build
```

说明：`https://get.docker.com` 是 Docker 官方提供的便捷安装脚本，适合大多数 Ubuntu / Debian / CentOS 服务器。

---

## 四、下载项目

在服务器执行：

```bash
git clone https://github.com/sanrokamlan-prog/tg-aibot.git
cd tg-aibot
```

---

## 五、配置环境变量

### 方式 A：交互式配置，推荐新手使用

服务器只要装好了 Docker，就可以直接运行这个交互式配置命令：

```bash
docker run --rm -it -v "$PWD:/app" -w /app node:20-alpine node scripts/setup-env.js
```

它会一步步提示你填写：

- Telegram `BOT_TOKEN`
- API 类型：`chat_completions` 或 `responses`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`
- 管理员 Telegram 用户 ID
- 随机发言频率参数

填错会提示重新输入，最后会自动生成 `.env` 文件。

如果服务器已经安装了 Node.js，也可以用：

```bash
npm run setup
```

### 方式 B：手动配置

复制配置文件：

```bash
cp .env.example .env
```

编辑配置：

```bash
nano .env
```

至少需要填写下面几项：

```env
BOT_TOKEN=你的Telegram机器人Token

AI_API_TYPE=chat_completions
AI_BASE_URL=https://你的中转站地址/v1
AI_API_KEY=你的中转站APIKey
AI_MODEL=你的模型名
```

例如普通 OpenAI 兼容中转站：

```env
BOT_TOKEN=123456789:AAxxxxxx_xxxxxxxxxxxxxxxxx

AI_API_TYPE=chat_completions
AI_BASE_URL=https://api.example.com/v1
AI_API_KEY=sk-xxxxxxxxxxxxxxxx
AI_MODEL=gpt-4o-mini
```

如果你的中转站给的是 Codex CLI 这种配置：

```toml
model_provider = "OpenAI"
model = "gpt-5.5"

[model_providers.OpenAI]
base_url = "https://openapi.xz.wtf"
wire_api = "responses"
```

那么在本项目里应该这样填：

```env
BOT_TOKEN=123456789:AAxxxxxx_xxxxxxxxxxxxxxxxx

AI_API_TYPE=responses
AI_BASE_URL=https://openapi.xz.wtf
AI_API_KEY=你的中转站APIKey
AI_MODEL=gpt-5.5
AI_DISABLE_RESPONSE_STORAGE=true
```

如果你的中转站给的是完整接口地址，可以这样写：

```env
BOT_TOKEN=123456789:AAxxxxxx_xxxxxxxxxxxxxxxxx

AI_API_URL=https://api.example.com/v1/chat/completions
AI_API_KEY=sk-xxxxxxxxxxxxxxxx
AI_MODEL=gpt-4o-mini
```

编辑完成后：

- `nano` 保存：按 `Ctrl + O`，回车
- 退出：按 `Ctrl + X`

---

## 六、推荐新手先用的参数

为了避免机器人太吵，也为了省中转站额度，建议一开始这样配置：

```env
# 省钱：限制每次发给 AI 的上下文和输出长度
AI_MAX_CONTEXT_MESSAGES=12
AI_MAX_INPUT_CHARS=1500
AI_MAX_MESSAGE_CHARS=160
AI_MAX_OUTPUT_TOKENS=120
AI_REQUEST_TIMEOUT_MS=30000

# 随机插话、冷场复活可以用便宜模型；留空则使用 AI_MODEL
AI_MODEL_RANDOM=
AI_MODEL_IDLE=

# 安全：限制机器人只在指定群使用；留空则不限制
ALLOWED_CHAT_IDS=

# 贴纸：群内可用 /sticker_add 添加；这里也可以配置全局贴纸池
STICKER_IDS=
STICKER_REPLY_CHANCE=0.15
DATA_DIR=/app/data

# 降低主动发言频率
RANDOM_REPLY_CHANCE=0.02
MIN_REPLY_INTERVAL_SECONDS=180
MIN_MSGS_BETWEEN_REPLIES=5
IDLE_THRESHOLD_MINUTES=30
IDLE_COOLDOWN_MINUTES=120
MAX_HISTORY=25
```

含义简单解释：

| 配置项 | 说明 |
| --- | --- |
| `AI_MAX_CONTEXT_MESSAGES` | 每次请求最多带最近多少条聊天记录，越大越懂上下文但越费钱 |
| `AI_MAX_INPUT_CHARS` | 每次请求最多发送多少字符的上下文，越小越省钱 |
| `AI_MAX_MESSAGE_CHARS` | 单条群消息最多保留多少字符，防止长消息烧 token |
| `AI_MAX_OUTPUT_TOKENS` | AI 每次最多输出多少 token，群聊建议 80-120 |
| `AI_REQUEST_TIMEOUT_MS` | AI 请求超时毫秒数，默认 30000，防止接口无响应时长期卡住 |
| `AI_MODEL_RANDOM` | 随机插话单独使用的模型，可以填便宜模型 |
| `AI_MODEL_IDLE` | 冷场复活单独使用的模型，可以填便宜模型 |
| `ALLOWED_CHAT_IDS` | 只允许指定群使用机器人，防止被陌生人拉进其他群烧额度 |
| `STICKER_IDS` | 全局贴纸池，多个贴纸 file_id 用英文逗号分隔 |
| `STICKER_REPLY_CHANCE` | AI 判断适合发贴纸时，实际发送贴纸的概率 |
| `DATA_DIR` | 持久化数据目录，贴纸池会保存在这里 |
| `RANDOM_REPLY_CHANCE` | 普通聊天时随机插话概率，越大越活跃，也越费钱 |
| `MIN_REPLY_INTERVAL_SECONDS` | 两次主动发言最少间隔多少秒 |
| `MIN_MSGS_BETWEEN_REPLIES` | 距离上次发言至少过多少条群消息才会再次插话 |
| `IDLE_THRESHOLD_MINUTES` | 群里安静多久后尝试主动抛话题 |
| `IDLE_COOLDOWN_MINUTES` | 两次冷场发言之间的最少间隔 |
| `MAX_HISTORY` | 每个群内存里最多保存多少条历史消息，不代表每次都发给 AI |

如果觉得机器人太安静，可以慢慢把 `RANDOM_REPLY_CHANCE` 调高，比如：

```env
RANDOM_REPLY_CHANCE=0.05
```

不建议一开始设置太高，比如 `0.2`、`0.5`，容易刷屏，也更费额度。

### 限制机器人只能在指定群使用

为了防止机器人被陌生人拉到其他群乱触发、烧额度，建议配置 `ALLOWED_CHAT_IDS`。

先在目标群里发送：

```text
/chat_id
```

机器人会返回当前群 ID，例如：

```text
-1001234567890
```

然后编辑 `.env`：

```env
ALLOWED_CHAT_IDS=-1001234567890
```

多个群用英文逗号分隔：

```env
ALLOWED_CHAT_IDS=-1001234567890,-1009876543210
```

修改后重启：

```bash
docker compose restart
```

### 添加 AI 可发送的贴纸

不用去服务器改配置，直接在群里操作：

1. 在群里发一个你想让机器人使用的贴纸。
2. 管理员回复这条贴纸，发送，并在后面写标签：

   ```text
   /sticker_add 开心 可爱
   ```

   标签建议写情绪或用途，比如：`开心`、`无语`、`吐槽`、`哭哭`、`赞同`、`震惊`。

3. 查看当前群贴纸池：

   ```text
   /sticker_list
   ```

4. 如果想清空当前群贴纸池：

   ```text
   /sticker_clear
   ```

贴纸池会保存在 Docker 数据卷里，容器重启不会丢。

---

## 七、启动机器人

在项目目录里执行：

```bash
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f
```

如果看到类似下面的内容，说明启动成功：

```text
机器人已启动: @你的机器人用户名
```

然后把机器人拉进 Telegram 群，就可以使用了。

---

## 八、常用管理命令

这些命令在群里发送。`/my_id` 所有人都可以用，其它管理命令只有群管理员或 `ADMIN_USER_IDS` 白名单用户可以操作：

```text
/my_id
```

查看自己的 Telegram 用户 ID。如果机器人一直提示“只有管理员可以操作”，可以把这个 ID 填进 `.env` 的 `ADMIN_USER_IDS`。

```text
/chat_id
```

查看当前群 ID。如果你想限制机器人只在指定群可用，把这个 ID 填进 `.env` 的 `ALLOWED_CHAT_IDS`。

```text
/ai_on
```

开启当前群的 AI 互动。

```text
/ai_off
```

关闭当前群的 AI 互动。机器人还在群里，但不会主动说话。

```text
/ai_chance 0.05
```

调整随机插话概率。数字范围是 `0` 到 `1`。

例如：

- `0.01`：很少说话
- `0.05`：适中
- `0.1`：比较活跃
- `0.3`：很吵，不建议

```text
/ai_status
```

查看当前群的 AI 状态、机器人用户名和机器人 ID。@ 机器人时要 @ 这里显示的用户名。

```text
/ai_config
```

管理员查看当前群的详细配置，包括随机插话概率、冷却时间、贴纸概率等。

```text
/ai_set random_chance 0.02
/ai_set min_interval 180
/ai_set min_msgs 5
/ai_set idle_threshold 30
/ai_set idle_cooldown 120
/ai_set sticker_chance 0.15
```

管理员在群里直接修改配置，不用上服务器。配置会保存到 Docker 数据卷里，重启不丢。

可改参数：

| 参数 | 说明 |
| --- | --- |
| `random_chance` | 随机插话概率，范围 0-1 |
| `min_interval` | 两次主动发言最少间隔秒数 |
| `min_msgs` | 距离上次发言至少间隔多少条群消息 |
| `idle_threshold` | 群里安静多少分钟后尝试冷场复活 |
| `idle_cooldown` | 两次冷场复活之间最少间隔分钟数 |
| `sticker_chance` | AI 想发贴纸时，实际发送贴纸的概率，范围 0-1 |

```text
/persona
```

管理员查看当前群额外人设规则。

```text
/persona_add 说话更毒舌一点，但不要骂人
/persona_add 偶尔用一点广东话
/persona_add 不要每次都回复太热情，要像真实群友
```

管理员逐条追加当前群的人设规则。也可以回复一条文字消息发送 `/persona_add`，机器人会把被回复那条消息作为人设规则添加。

```text
/persona_del 2
```

删除第 2 条人设规则。

```text
/persona_clear
```

清空当前群额外人设规则。这些规则保存在 Docker 数据卷里，重启不丢。

```text
/ai_test
```

测试 AI 接口是否正常。如果 @ 机器人没反应，先用这个命令看中转站接口有没有报错。

```text
/sticker_id
```

回复一条贴纸发送这个命令，查看贴纸的 `file_id`。

```text
/sticker_add 开心 可爱
```

管理员回复一条贴纸发送这个命令，把贴纸加入当前群的贴纸池，并给它打标签。以后 AI 会根据语境优先选择匹配标签的贴纸。

例子：

```text
/sticker_add 开心 赞同
/sticker_add 无语 吐槽
/sticker_add 哭哭 委屈
```

```text
/sticker_list
```

管理员查看当前群已经添加了多少贴纸。

```text
/sticker_clear
```

管理员清空当前群贴纸池。贴纸池保存在 Docker 数据卷里，重启不会丢。

---

## 九、更新项目

### 服务器更新代码

如果 GitHub 仓库有更新，登录服务器后进入项目目录：

```bash
cd ~/tg-aibot
```

拉取最新代码：

```bash
git pull
```

重新构建并启动：

```bash
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f
```

如果你的系统使用老版 `docker-compose`，就把命令换成：

```bash
docker-compose up -d --build
docker-compose logs -f
```

### 本地电脑更新代码

如果你本地电脑也 clone 了这个项目，进入本地项目目录后执行：

```bash
git pull
```

如果你本地改过文件，`git pull` 提示冲突，可以先查看改了哪些：

```bash
git status
```

不懂怎么处理冲突时，不要直接删除文件，把报错复制出来再问。

---

## 十、停止和重启

停止机器人：

```bash
docker compose down
```

重启机器人：

```bash
docker compose restart
```

查看日志：

```bash
docker compose logs -f
```

---

## 十一、常见问题

### 1. 日志显示机器人启动失败

先检查 `.env` 里的 `BOT_TOKEN` 是否正确。

```bash
nano .env
```

常见错误：

- Token 前后多了空格
- Token 复制不完整
- 填成了 BotFather 里的机器人用户名，而不是 token

### 2. 机器人进群后不看普通消息

检查 BotFather 的 privacy mode 是否关闭：

```text
/setprivacy
```

选择机器人后设置为：

```text
Disable
```

如果之前已经把机器人拉进群，关闭 privacy 后需要把机器人踢出群，再重新拉进群。

### 3. 管理员发送 `/ai_on` 仍提示“只有管理员可以操作”

先在群里发送：

```text
/my_id
```

机器人会回复你的 Telegram 用户 ID。

然后编辑 `.env`：

```bash
nano .env
```

把你的用户 ID 填进去：

```env
ADMIN_USER_IDS=123456789
```

如果有多个管理员，使用英文逗号分隔：

```env
ADMIN_USER_IDS=123456789,987654321
```

保存后重启：

```bash
docker compose restart
```

再回群里发送：

```text
/ai_on
```

### 4. 被 @ 也不回复

查看日志：

```bash
docker compose logs -f
```

如果日志里出现 AI API 报错，通常是这些原因：

- `AI_BASE_URL` 写错
- `AI_API_KEY` 写错
- `AI_MODEL` 模型名不对
- 中转站余额不足
- 中转站接口暂时不可用

### 5. 日志里出现 401 / 403

一般是 API Key 错误，或者中转站没有权限使用这个模型。

检查：

```env
AI_API_KEY=
AI_MODEL=
```

### 6. 日志里出现 429

一般是请求太频繁或额度不够。

可以把参数调低：

```env
AI_MAX_CONTEXT_MESSAGES=8
AI_MAX_INPUT_CHARS=1000
AI_MAX_MESSAGE_CHARS=120
AI_MAX_OUTPUT_TOKENS=80
RANDOM_REPLY_CHANCE=0.01
MIN_REPLY_INTERVAL_SECONDS=300
MIN_MSGS_BETWEEN_REPLIES=8
MAX_HISTORY=20
```

然后重启：

```bash
docker compose restart
```

### 7. 怎么确认容器还在运行

```bash
docker ps
```

能看到 `tg-ai-bot` 就说明容器还在。

---

## 十二、修改机器人说话人设

机器人有两层人设：

1. `.env` 里的 `PERSONA_PROMPT`：全局基础人设，适合一开始设置大方向。
2. 群内 `/persona_add`：当前群的额外人设规则，适合后面慢慢微调。

### 推荐方式：群内渐进式调整

管理员在群里发送：

```text
/persona
```

查看当前群额外人设规则。

逐条追加规则：

```text
/persona_add 说话更毒舌一点，但不要骂人
/persona_add 偶尔用一点广东话
/persona_add 不要每次都回复太热情，要像真实群友
```

也可以先在群里发一条规则说明，然后管理员回复那条消息：

```text
/persona_add
```

机器人会把被回复的那条文字作为人设规则添加。

删除某条规则：

```text
/persona_del 2
```

清空当前群额外规则：

```text
/persona_clear
```

这些规则保存在 Docker 数据卷里，重启不会丢。

### 全局基础人设

机器人默认人设在 `src/persona.js`，但不建议新手直接改代码。更推荐改 `.env` 里的：

```env
PERSONA_PROMPT=
```

可以用交互式配置修改：

```bash
docker run --rm -it -v "$PWD:/app" -w /app node:20-alpine node scripts/setup-env.js
```

也可以手动修改：

```bash
nano .env
```

例如：

```env
PERSONA_PROMPT="你是群里的普通群友，说话简短、自然、偶尔吐槽，不要暴露自己是 AI。"
```

修改 `.env` 后需要重启：

```bash
docker compose restart
```

注意：人设不要写太长。越长每次请求越费 token，也越贵。

---

## 十三、安全注意事项

- 不要把 `.env` 发给别人。
- 不要把 `.env` 上传到 GitHub。
- 如果 `BOT_TOKEN` 泄露，去 `@BotFather` 使用 `/revoke` 重新生成。
- 如果 `AI_API_KEY` 泄露，去中转站后台删除旧 key，重新创建。
- 群聊天内容会发送给你的 AI 接口或中转站，建议在群公告里说明有 AI 机器人在场。

---

## 十四、工作原理简述

机器人会把每个群最近的若干条文字消息缓存在内存里，作为上下文发给模型。

触发方式有三种：

1. 群友 @ 机器人，或回复机器人的消息：一定尝试回复。
2. 普通聊天：满足冷却时间、消息间隔和概率条件后，随机插话。
3. 群里冷场：安静一段时间后，主动抛一个话题。

注意：

- 聊天上下文只存在内存里，重启会清空。
- 目前只处理文字消息，不处理图片、贴纸、语音。
- `/ai_off`、`/ai_chance` 这些群配置目前也只存在内存里，重启后会恢复 `.env` 默认值。

---

## 后续可以加的功能

- 按不同群设置不同人设
- 关键词触发固定回复
- 使用 SQLite 持久化群配置和上下文
- 支持图片、贴纸、语音消息
- 增加限流退避，遇到 429 自动降低发言频率

---

## AI 中转站推荐

如果你需要 AI 中转站，可以看看这个：

```text
https://openapi.xz.wtf/register?aff=C6ACRK5UC9RR
```

特点：

- 价格便宜
- `1 CNY = 2 USD` 额度
- Claude Max 号池 1x
- Claude Code 纯 Max 号池 1x
- ChatGPT Plus 号池 0.5x
- 剩余价值无条件退款保障

如果不想使用邀请链接，把地址里的 `?aff=C6ACRK5UC9RR` 删除即可：

```text
https://openapi.xz.wtf/register
```
