# collab-doc-platform

在线协作文档平台（含自研监控 SDK / Mini Builder / Mini Agent）。

> 设计文档见 `~/baidu/docs/project-docs/collab-doc-platform/`：
>
> - 总览：`collab-doc-platform.md`
> - 路线图：`collab-doc-platform-roadmap.md`
> - 监控 SDK：`monitor-sdk-design.md`
> - Mini Builder：`mini-builder-design.md`
> - 协作协议：`collab-protocol.md`

当前里程碑：**M1 — 文档业务 MVP（单人）**。

## 仓库结构

```
collab-doc-platform
├── apps
│   ├── doc-web              # 协作文档前端（React + Vite，M4 切到 mini-builder）
│   ├── monitor-dashboard    # 监控可视化后台
│   └── server               # 协作 / 监控 / Agent 服务（Node + tsx）
├── packages
│   ├── shared               # 通用类型与工具
│   ├── monitor-sdk          # 自研前端监控 SDK（M3）
│   ├── mini-builder         # 自研迷你构建工具（M4）
│   ├── builder-plugin-monitor  # SDK 注入 + sourcemap 上传插件（M5）
│   └── mini-agent           # AI 协作者运行时（M6）
└── .github/workflows        # CI
```

## 环境要求

- Node `>=20.10`（见 `.nvmrc`）
- pnpm `>=9`（仓库锁定 `pnpm@9.12.0`）

## 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 并行启动所有 apps（doc-web / monitor-dashboard / server）
pnpm build            # 全量构建
pnpm typecheck        # 全仓 TS 检查
pnpm lint             # ESLint
pnpm format           # Prettier 写入
pnpm test             # 全仓 Vitest（M0 目前为空跑通）
```

单独跑某个包：

```bash
pnpm --filter @collab/doc-web dev
pnpm --filter @collab/server dev
```

## M1 启动指南（单人 MVP）

```bash
# 1. 启动 Postgres
docker compose up -d postgres

# 2. 准备 .env
cp .env.example .env

# 3. 初始化数据库
pnpm --filter @collab/server prisma:migrate
pnpm --filter @collab/server seed   # 生成 demo@collab.dev / demo1234

# 4. 启动服务端 + 前端
pnpm --filter @collab/server dev
pnpm --filter @collab/doc-web dev

# 5. 浏览器打开 http://localhost:5173
#    用 demo@collab.dev / demo1234 登录
```

## M0 验收

- [x] pnpm + monorepo（apps + packages）
- [x] tsconfig.base.json + 各包 references
- [x] ESLint flat config + Prettier + EditorConfig
- [x] commitlint + husky + lint-staged
- [x] GitHub Actions：lint / format / typecheck / test
- [x] 各包最小可跑代码 + README
- [ ] `pnpm install` 后 `pnpm lint && pnpm typecheck && pnpm build` 全绿（首次安装请在本地执行验证）

## 下一步：M2 — 实时协作

详见 `collab-doc-platform-roadmap.md`。

## 提交规范

Conventional Commits，由 commitlint 校验：

```
feat(doc-web): tiptap editor scaffold
fix(server): jwt expiry check
chore(repo): bump deps
```
