# ds-plugin

DSH 持久插件仓库：每个插件一个 npm 包，安装进 `web` profile 后随服务重启永久生效。

## 两种插件形态（别混淆）

| 形态 | 落点 | 生命周期 | 能做什么 |
| --- | --- | --- | --- |
| **Profile bundle**（本仓库） | `packages/<name>/`，安装进 `~/.dsh/profiles/web` | 随 profile 启动挂载 | WebGUI UI（Slot）、Host 服务、HTTP 路由 |
| **Agent preset** | `~/.dsh/.agent-presets/<id>/` | 每个会话挂载一次 | Agent 工具、prompt 段、persona |

本仓库只放第一种。要给 agent 加能力（工具/提示词）就写 preset，不是放这里。

## 目录结构

```
ds-plugin/
├── package.json              # workspace 根（仅元信息）
├── pnpm-workspace.yaml
├── scripts/
│   └── install-plugin.sh     # 把某个插件包装进 web profile
└── packages/
    └── dsh-plugin-balance/   # 示例：余额 + token 用量 pill
        ├── package.json      # dsh.bundle + dsh.client 声明
        ├── cordis.patch.yml  # host 行（bundle patch 层）
        ├── index.js          # host 半部（Node 全环境）
        └── client.js         # 浏览器半部（classic script bundle）
```

## 加一个新插件

1. 复制 `packages/dsh-plugin-balance/` 改名为你的插件名（包名保持 `dsh-plugin-*`）。
2. 改 `package.json` 里的 `name`、`description` 和 `dsh.client.inject`（依赖哪些已装载的客户端包）。
3. 改 `cordis.patch.yml` 里的行 id（唯一），`name` 保持 = 包名。
4. 写 `index.js`（host 逻辑）和 `client.js`（Slot UI）。
5. 安装：`./scripts/install-plugin.sh <目录名>`（实际执行 `dsh plugin --profile web add ./packages/<name>`）。
6. **重启 `dsh web` 服务** —— 插件集合的变化在重启后生效（运行中的服务不改动组合）。

## 开发流程建议

先用**会话内动态 Cordis 插件**验证数据源和 Slot 效果（瞬时可见、可随时撤销），确认体验后固化成本仓库的包。约定：

- Host 半部：`export { name, inject, apply }`（ESM），完整 Node 环境，`fetch` 可用。
- 浏览器半部：`client.js` 必须是 external classic-script 格式（`window.__ModuleLoader__.load({ id: 包名, factory })`），`require("react")` 走客户端模块图；UI 注册到查询过的 Slot；`inject: ["slots", "timer"]` 这类服务注入按需声明。
- Host↔Client 通信走 host 注册的同源 HTTP 路由（`webServer.register`）+ 浏览器 `fetch`，不要用动态插件专用的 `harness.handle`/`host.call`。

## 现有插件

- **dsh-plugin-balance** — 输入区下方 stats 行旁显示 DeepSeek API 余额（CNY/USD/EUR），并显示当前会话 token 用量（in/out），点击刷新，每 60s 自动刷新。Host 半部注册 `GET /api/dsh-plugin-balance/balance`。
