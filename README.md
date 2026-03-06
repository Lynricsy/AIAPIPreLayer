# AIAPIPreLayer

> AI API 预处理层 - 在请求到达大模型 API 之前，自动完成图片压缩、字段注入与流式失败恢复的透明反向代理。

[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

## 功能特性

- 自动遍历 OpenAI Chat / OpenAI Responses / Anthropic / Gemini 请求中的 base64 图片，并转换为 WebP
- 透明反向代理，SSE 流式响应直通，不改动认证头与查询参数
- 为 OpenAI Responses 请求自动注入 `service_tier`
- 针对 OpenAI Responses 的 `encrypted reasoning` 快速失败场景执行 best-effort 自动重试恢复
- YAML 配置驱动，支持用环境变量覆盖监听地址、端口与日志输出模式
- 处理器采用尽力而为策略，单个处理步骤失败时不会中断整个请求

## 快速开始

```bash
# 安装依赖
bun install

# 复制一份配置文件（也可以直接使用仓库中的 config.yaml）
cp config.example.yaml config.yaml

# 热重载启动
bun run dev
```

生产运行：

```bash
bun run start
```

服务默认监听 `http://0.0.0.0:3000`。

如果 `config.yaml` 不存在，服务不会退出，而是自动回退到内建默认配置启动。

## 代理 URL 规则

AIAPIPreLayer 通过“路径首段嵌入目标主机”的方式决定要转发到哪里：

```text
http://localhost:3000/{目标主机}/{目标路径}
```

例如：

- `http://localhost:3000/api.openai.com/v1/chat/completions`
- `http://localhost:3000/api.openai.com/v1/responses`
- `http://localhost:3000/api.anthropic.com/v1/messages`
- `http://localhost:3000/generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`

规则说明：

- 第一个路径段会被解析为目标主机
- 剩余路径会原样拼接为目标 API 路径
- 上游协议固定为 `https`
- 查询参数会原样透传
- 除了官方主机名匹配，也支持基于路径模式的兜底识别，适配带子路径的中继服务

## 请求处理流程

```text
Client Request
      |
      v
Routing + API 格式检测
      |
      v
JSON 请求预处理管道
  - ImageProcessor
  - ServiceTierProcessor
      |
      v
转发到上游 API
      |
      +--> OpenAI Responses SSE 前导事件分析
              |
              +--> 必要时执行 encrypted reasoning 两级重试
      |
      v
Client Response
```

具体行为如下：

1. `GET /health` 由 `src/index.ts` 直接返回健康状态，其余路径都由 `app.all('/*')` 进入代理
2. `src/routing.ts` 解析目标主机、目标路径，并识别 API 格式
3. 仅 `POST` / `PUT` / `PATCH` 的 JSON 请求体会进入预处理管道，其他请求原样转发
4. `ImageProcessor` 会按 API 格式定位图片节点并尽力转成 WebP；单张图片失败会跳过并保留原值
5. `ServiceTierProcessor` 仅对 OpenAI Responses 请求生效，会向根对象注入 `service_tier`
6. 请求体若被修改，代理会重新计算 `content-length`
7. 普通响应与 SSE 响应都会回传给客户端；SSE 默认直通，不做二次改写
8. 只有命中 OpenAI Responses + encrypted reasoning 失败模式时，代理才会在 SSE 前导阶段执行自动重试

## OpenAI Responses 的 encrypted reasoning 重试

这是当前代码里已经实现、但旧版 README 没有覆盖的重要能力。

触发条件：

- 请求格式为 `openai-responses`
- `processors.encryptedReasoning.enabled` 为 `true`
- 请求体 `input` 中存在 reasoning 项，且包含 `encrypted_content`
- SSE 前导事件在短时间内出现“创建 -> 进行中 -> 错误/失败，且没有输出事件”的快速失败模式

重试策略分为两级：

1. 第一次快速失败：删除最后一个 reasoning 条目的 `encrypted_content` 后重试
2. 第二次快速失败：删除所有 reasoning 条目的 `encrypted_content` 后重试
3. 若仍失败：返回最后一次失败响应对应的 SSE 事件流，并重新计算响应体长度

相关配置：

- `maxRetries`：最大重试次数，当前允许范围为 `1-5`
- `preambleTimeoutMs`：SSE 前导事件缓冲超时，当前允许范围为 `1000-30000`

补充说明：

- 快速失败识别除了受 `preambleTimeoutMs` 影响，还要求失败发生在请求开始后的前 10 秒内
- 当前只有两种降级请求形态：删除最后一个 `encrypted_content`，或删除全部 `encrypted_content`
- 因此当 `maxRetries` 大于 `2` 时，后续重试只会重复发送“已删除全部”的请求体

## 配置参考

运行配置位于项目根目录的 `config.yaml`，完整字段如下：

```yaml
server:
  port: 3000
  host: "0.0.0.0"
  maxPayloadSize: "50mb"

processors:
  image:
    enabled: true
    output:
      format: "webp"
      quality: 80
      effort: 4
    resize:
      maxWidth: 2048
      maxHeight: 2048

  encryptedReasoning:
    enabled: true
    maxRetries: 2
    preambleTimeoutMs: 5000

  serviceTier:
    enabled: true
    value: "priority"

logging:
  level: "info"
  format: "json"
```

环境变量覆盖：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AIAPL_PORT` | `3000` | 覆盖 `server.port` |
| `AIAPL_HOST` | `0.0.0.0` | 覆盖 `server.host` |
| `AIAPL_LOG_LEVEL` | `info` | 覆盖 `logging.level` |
| `AIAPL_LOG_FORMAT` | `json` | 覆盖 `logging.format`，可切到 `text` 便于 `docker compose logs -f` 阅读 |

配置注意事项：

- `maxPayloadSize` 支持 `b` / `kb` / `mb` / `gb` 单位
- 当前图片输出格式固定为 `webp`；即使在配置中填写其他值，运行时也会按 `webp` 处理
- 处理器相关参数目前没有环境变量映射，需要通过 `config.yaml` 调整
- 仅当配置文件不存在、读取失败或 YAML 解析失败时才会回退默认配置
- 大多数字段在配置值非法时会直接拒绝启动；`logging.level` / `logging.format` 在 `config.yaml` 中会回退默认值，但对应的 `AIAPL_LOG_LEVEL` / `AIAPL_LOG_FORMAT` 环境变量会严格校验并拒绝非法值

## 使用示例

### OpenAI Chat Completions

```bash
curl http://localhost:3000/api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "描述这张图片" },
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/png;base64,iVBORw0KGgo..."
            }
          }
        ]
      }
    ]
  }'
```

### OpenAI Responses

```bash
curl -X POST http://localhost:3000/api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "input": [
      {
        "role": "user",
        "content": [
          { "type": "input_text", "text": "描述这张图片" },
          {
            "type": "input_image",
            "image_url": "data:image/png;base64,iVBORw0KGgo..."
          }
        ]
      }
    ]
  }'
```

说明：

- `service_tier` 会按配置自动注入
- 如果请求中包含 encrypted reasoning，代理会在满足条件时自动执行两级重试恢复；若重试耗尽，仍会把最后一次失败响应透传给客户端

### Anthropic Messages

```bash
curl http://localhost:3000/api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "image",
            "source": {
              "type": "base64",
              "media_type": "image/png",
              "data": "iVBORw0KGgo..."
            }
          },
          { "type": "text", "text": "这张图片里有什么？" }
        ]
      }
    ]
  }'
```

### Gemini GenerateContent

```bash
curl -X POST "http://localhost:3000/generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          { "text": "描述这张图片的内容" },
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "iVBORw0KGgo..."
            }
          }
        ]
      }
    ]
  }'
```

## 开发与测试

常用命令：

| 命令 | 说明 |
|------|------|
| `bun run dev` | 热重载开发模式 |
| `bun run start` | 生产方式启动 |
| `bun test` | 运行全部测试 |
| `bun run typecheck` | 运行 TypeScript 类型检查 |

当前测试覆盖包括：

- 配置加载与校验
- 图片转换与遍历逻辑
- 代理转发与 `content-length` 修正
- SSE 事件解析与透传
- OpenAI Responses 的 encrypted reasoning 重试逻辑
- 真实代理链路的集成测试

## 项目结构

```text
src/
├── index.ts                        # 应用入口
├── config.ts                       # 配置加载、校验与默认值
├── pipeline.ts                     # 预处理器责任链
├── proxy.ts                        # 代理引擎、SSE 直通与重试
├── registry.ts                     # 处理器注册中心
├── routing.ts                      # 目标 URL 解析与 API 格式识别
├── processors/
│   ├── encrypted-reasoning.ts      # encrypted reasoning 内容裁剪逻辑
│   ├── post-processor.ts           # 后处理器扩展点（当前未启用）
│   ├── service-tier.ts             # OpenAI Responses 的 service_tier 注入
│   └── image/
│       ├── index.ts                # 图片处理器入口
│       ├── traversal.ts            # 按 API 格式定位图片节点
│       └── converter.ts            # base64 图片转 WebP
├── types/
│   ├── index.ts                    # 核心类型与配置定义
│   └── api-formats.ts              # 各类请求体类型
└── utils/
    ├── base64.ts
    ├── errors.ts
    ├── logger.ts
    ├── mime.ts
    └── sse.ts

test/
├── integration.test.ts             # 端到端代理集成测试
├── proxy-retry.test.ts             # encrypted reasoning 重试专项测试
├── sse.test.ts                     # SSE 解析与序列化测试
└── ...                             # 其余配置、路由、处理器与工具测试
```

## Docker 部署

项目提供 `Dockerfile` 和 `docker-compose.yml`，适合本地或服务器直接部署。

快速启动：

```bash
cp config.example.yaml config.yaml
docker compose up -d
```

部署说明：

- Compose 会将 `./config.yaml` 以只读方式挂载到容器内的 `/app/config.yaml`
- Docker 镜像基于 `oven/bun:1-slim`，并以非 root 的 `bun` 用户运行
- 容器健康检查使用 `bun -e` 请求 `http://localhost:3000/health`，避免把 `/` 误当成代理目标
- 默认 Compose 额外注入 `AIAPL_LOG_FORMAT=text`，让 `docker compose logs -f` 更适合人工阅读；若需要结构化采集，可改回 `json`

常用命令：

| 命令 | 说明 |
|------|------|
| `docker compose up -d` | 后台启动服务 |
| `docker compose down` | 停止并移除容器 |
| `docker compose logs -f` | 查看实时日志 |
| `docker compose restart` | 重启服务 |
| `docker compose build --no-cache` | 重新构建镜像 |

如果在 Compose 场景下修改 `AIAPL_PORT`，还需要同步调整 `ports` 和 `healthcheck` 中写死的 `3000`，否则端口映射和健康检查会失真。

## 技术栈

| 组件 | 说明 |
|------|------|
| Bun | 运行时与测试执行 |
| Hono | HTTP 路由与请求处理 |
| Sharp | 图片解码、压缩与 WebP 转换 |
| yaml | YAML 配置解析 |
| pino / pino-pretty | 结构化日志与文本日志输出 |
| TypeScript | 严格类型约束 |

## 注意事项

- 图片处理只对可解析的 JSON 请求体生效，非 JSON 请求会原样透传
- 单个处理器失败不会阻断整条请求链路，代理会记录告警并继续处理
- 损坏的 base64 图片会被跳过并保留原值，而不是直接报错
- 请求体超过 `maxPayloadSize` 会返回 `413 Payload Too Large`
- 客户端主动断开连接时会记录为 `499 Client Closed Request`
- 日志输出目标是标准错误流，便于与标准输出分离采集
