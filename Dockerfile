# =============================================================================
# AIAPIPreLayer — 多阶段 Docker 构建
# =============================================================================
# 基于 Bun 运行时的 AI API 预处理代理服务
# 使用 oven/bun:1-slim (Debian-slim) 以兼容 sharp 所需的 glibc
# =============================================================================

# ---------------------------------------------------------------------------
# 阶段 1：安装依赖
# 仅安装生产依赖，利用 Docker 层缓存加速后续构建
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim AS install

WORKDIR /app

# 先复制依赖声明文件，充分利用层缓存
# 只有 package.json 或 bun.lock 变化时才会重新安装依赖
COPY package.json bun.lock ./

# 使用 --frozen-lockfile 确保可复现构建，--production 排除开发依赖
RUN bun install --frozen-lockfile --production

# ---------------------------------------------------------------------------
# 阶段 2：运行时镜像
# 仅包含必要的 node_modules 和源代码，以非 root 用户运行
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim

WORKDIR /app

# 从安装阶段复制生产依赖（不包含开发依赖）
COPY --from=install /app/node_modules ./node_modules

# 复制源代码（变更最频繁，放在最后以优化层缓存）
COPY src/ ./src/

# 复制项目配置文件（注意：config.yaml 不复制，运行时通过 volume 挂载）
COPY package.json tsconfig.json ./

# 以非 root 用户运行，提升容器安全性
# oven/bun 镜像内置了 bun 用户
USER bun

# 声明服务监听端口（可通过 AIAPL_PORT 环境变量覆盖）
EXPOSE 3000

# 启动服务（对应 package.json 中的 start 脚本：bun run src/index.ts）
CMD ["bun", "run", "start"]
