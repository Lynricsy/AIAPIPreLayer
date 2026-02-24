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

**处理流程：**

1. 解析请求 URL，提取目标主机与路径
2. 检测 API 格式（OpenAI Chat / Responses / Anthropic / Gemini）
3. 对 JSON 请求体执行预处理器管道（图片转 WebP 等）
4. 转发处理后的请求到目标 API
5. 将响应原样返回客户端（SSE 流式响应直通）

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
├── config.ts              # 配置加载与验证
├── pipeline.ts            # 预处理器管道管理
├── proxy.ts               # 代理引擎（请求转发 + SSE 直通）
├── routing.ts             # URL 路由解析 + API 格式检测
├── types/
│   └── index.ts           # 核心类型定义
├── processors/
│   └── image/
│       └── converter.ts   # 图片格式转换（base64 → WebP）
└── utils/
    ├── base64.ts          # Base64 编解码
    ├── errors.ts          # 自定义错误类
    ├── logger.ts          # 结构化日志
    └── mime.ts            # MIME 类型工具
```

## 📄 License

[MIT](./LICENSE)
