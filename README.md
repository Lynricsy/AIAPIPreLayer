# AIAPIPreLayer

> 🦊 AI API 预处理层 — 在请求到达大模型 API 之前，自动完成图片压缩等预处理工作的透明反向代理

[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## ✨ 功能特性

- 🖼️ **图片格式转换** — 自动将请求中的 base64 图片转换为 WebP 格式，支持质量与尺寸控制
- 🔄 **透明代理** — SSE 流式响应直通，对客户端完全透明
- 🌐 **多 API 支持** — 兼容 OpenAI Chat / OpenAI Responses / Anthropic / Gemini 四种格式
- ⚙️ **YAML 配置驱动** — 所有参数均可通过配置文件灵活调整
- 🧩 **可扩展处理器管道** — 基于责任链模式，轻松添加自定义预处理器

## 🚀 快速开始

```bash
# 克隆仓库
git clone git@github.com:Lynricsy/AIAPIPreLayer.git
cd AIAPIPreLayer

# 安装依赖
bun install

# 编辑配置文件（按需修改）
vim config.yaml

# 启动服务
bun run start
```

服务启动后默认监听 `http://0.0.0.0:3000`。

## 🌐 URL 格式

AIAPIPreLayer 采用 **URL 内嵌目标地址** 的路由方式：

```
http://localhost:3000/{目标主机}/{路径}
```

第一个路径段作为目标主机名，其余部分作为请求路径，协议固定为 HTTPS。

### 支持的 API 端点

| API 服务 | 代理 URL |
|----------|----------|
| OpenAI Chat | `http://localhost:3000/api.openai.com/v1/chat/completions` |
| OpenAI Responses | `http://localhost:3000/api.openai.com/v1/responses` |
| Anthropic | `http://localhost:3000/api.anthropic.com/v1/messages` |
| Gemini | `http://localhost:3000/generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent` |

> 💡 只需将原本的 API 基础 URL 替换为 `http://localhost:3000/{原主机}` 即可，查询参数原样透传。

## 📝 使用示例

### OpenAI Chat Completions

```bash
curl http://localhost:3000/api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
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

### Anthropic Messages

```bash
curl http://localhost:3000/api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
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

> 🖼️ 请求中的 base64 图片会被自动转换为 WebP 格式，显著减小请求体积。

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
          { "type": "input_text", "text": "这张图片是什么？" },
          {
            "type": "input_image",
            "image_url": "data:image/png;base64,iVBORw0KGgo..."
          }
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

> 💡 所有格式的图片都会被自动检测并转换，无需额外配置。

## ⚙️ 配置参考

配置文件为项目根目录下的 `config.yaml`，完整选项如下：

```yaml
# 服务器配置
server:
  port: 3000                  # 监听端口（环境变量：AIAPL_PORT）
  host: "0.0.0.0"             # 监听地址（环境变量：AIAPL_HOST）
  maxPayloadSize: "50mb"      # 请求体最大大小（支持 b/kb/mb/gb）

# 处理器配置
processors:
  image:
    enabled: true              # 是否启用图片处理器
    output:
      format: "webp"           # 输出格式：webp | jpeg | png
      quality: 80              # 输出质量（0-100）
      effort: 4                # WebP 编码努力程度（0-6，越大压缩越好但越慢）
    resize:
      maxWidth: 2048           # 最大宽度（像素），超出则等比缩小
      maxHeight: 2048          # 最大高度（像素），超出则等比缩小

# 日志配置
logging:
  level: "info"                # 日志级别：debug | info | warn | error
  format: "json"               # 日志格式：json | text
```

## 🏗️ 架构

```
Client Request
      │
      ▼
┌─────────────────────────────────┐
│         AIAPIPreLayer           │
│                                 │
│  URL 解析 → API 格式检测        │
│      │                          │
│      ▼                          │
│  ┌─────────────────────────┐    │
│  │    预处理器管道 (Pipeline)│    │
│  │  ┌───────────────────┐  │    │
│  │  │  ImageProcessor   │  │    │
│  │  │  base64 → WebP    │  │    │
│  │  └───────────────────┘  │    │
│  │          ↓              │    │
│  │  ┌───────────────────┐  │    │
│  │  │   ... 更多处理器   │  │    │
│  │  └───────────────────┘  │    │
│  └─────────────────────────┘    │
│      │                          │
│      ▼                          │
│  转发请求 (SSE 流式直通)        │
└─────────────────────────────────┘
      │
      ▼
  Target API
(OpenAI / Anthropic / Gemini)
```

### 🔍 工作原理

以一次带图片的 OpenAI Chat 请求为例，完整流程如下：

1. **客户端发起请求** — 将目标 API 地址嵌入代理 URL，例如 `http://proxy:3000/api.openai.com/v1/chat/completions`
2. **URL 路由解析** — 代理从请求路径中提取目标主机 `api.openai.com` 和路径 `/v1/chat/completions`，拼接为 `https://api.openai.com/v1/chat/completions`
3. **API 格式检测** — 根据主机名 + 路径模式自动识别请求属于哪种 API 格式（OpenAI Chat / Responses / Anthropic / Gemini），决定后续如何遍历请求体
4. **请求体解析** — 读取 JSON 请求体，交由预处理器管道依次处理
5. **图片节点遍历** — `ImageProcessor` 按照检测到的 API 格式，深度遍历 JSON 结构，定位所有 base64 编码的图片节点（不同格式的图片字段位置各不相同）
6. **图片转换** — 对每个检测到的 base64 图片，通过 Sharp 解码、压缩、转换为 WebP 格式（可配置质量与尺寸上限），再重新编码为 base64 写回原位
7. **转发请求** — 将处理后的请求体以正确的 `Content-Length` 转发到真实 API，原始请求头（含认证信息）原样透传
8. **响应直通** — API 返回的响应（包括 SSE 流式响应）直接传回客户端，代理不做任何修改

> 📦 **压缩效果**：以一张 1MB 的 PNG 截图为例，转换为 WebP 后通常可压缩到 100~300KB，token 花费不变但传输速度大幅提升。

**各格式图片字段位置对照：**

| API 格式 | 图片定位路径 | base64 存储方式 |
|----------|------------|----------------|
| OpenAI Chat | `messages[].content[].image_url.url` | data URI（`data:image/png;base64,...`） |
| OpenAI Responses | `input[].content[].image_url` | data URI（`data:image/png;base64,...`） |
| Anthropic | `messages[].content[].source.data` | 纯 base64 + `media_type` 字段 |
| Gemini | `contents[].parts[].inlineData.data` | 纯 base64 + `mimeType` 字段 |

## 🛠️ 开发指南

```bash
# 热重载开发模式
bun run dev

# 运行测试
bun test

# 类型检查
bun run typecheck
```

### 技术栈

| 组件 | 技术选型 |
|------|----------|
| 运行时 | [Bun](https://bun.sh) |
| Web 框架 | [Hono](https://hono.dev) |
| 图片处理 | [Sharp](https://sharp.pixelplumbing.com) |
| 配置解析 | [yaml](https://eemeli.org/yaml/) |
| 类型系统 | TypeScript (strict mode) |

### 项目结构

```
src/
├── index.ts               # 应用入口
├── config.ts              # 配置加载与验证
├── pipeline.ts            # 预处理器管道管理
├── proxy.ts               # 代理引擎（请求转发 + SSE 直通）
├── registry.ts            # 处理器注册中心
├── routing.ts             # URL 路由解析 + API 格式检测
├── types/
│   ├── index.ts           # 核心类型定义
│   └── api-formats.ts    # 四种 API 请求格式的类型定义
├── processors/
│   ├── post-processor.ts  # 后处理器管道管理
│   └── image/
│       ├── index.ts       # ImageProcessor 入口（组装遍历 + 转换）
│       ├── traversal.ts   # JSON 遍历：按 API 格式定位 base64 图片节点
│       └── converter.ts   # 图片格式转换（base64 → WebP via Sharp）
└── utils/
    ├── base64.ts          # Base64 编解码与 data URI 解析
    ├── errors.ts          # 自定义错误类
    ├── logger.ts          # 结构化日志
    └── mime.ts            # MIME 类型工具

test/
├── fixtures/              # 测试用 JSON 固定数据
│   ├── openai-chat.json
│   ├── openai-responses.json
│   ├── anthropic-messages.json
│   ├── gemini-generate.json
│   ├── mixed-content.json
│   └── no-images.json
├── config.test.ts
├── converter.test.ts
├── errors.test.ts
├── image-processor.test.ts
├── logger.test.ts
├── pipeline.test.ts
├── post-processor.test.ts
├── proxy.test.ts
├── registry.test.ts
├── routing.test.ts
├── server.test.ts
├── traversal.test.ts
├── types.test.ts
└── utils.test.ts

config.yaml                # 默认配置文件
```

## 📄 License

[MIT](./LICENSE)
