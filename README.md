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
- Slot 覆盖（shadow）规范：遮蔽自带条目时用**相同 id + 更低 `priority`**（最低者渲染）；同 id 同 priority 是硬错误。`order` 仅是同 priority 内的排序字段，不参与冲突判定——不要拿它当优先级用。

## 现有插件

- **dsh-plugin-balance** — 两个功能：
  1. **任务面板**：右上角悬浮面板，显示 DeepSeek 余额、当前会话 token 用量、Git 状态、待办与目标，模块可折叠。
  2. **设置 → 使用情况**：跨会话 token 消耗统计——汇总卡、按模型堆叠的每日柱状图（7/14/30 天可选）、近 6 个月日历热力图（每格一天）。
  Host 半部注册路由：`/api/dsh-plugin-balance/balance`、`/api/dsh-plugin-balance/git`、`/api/dsh-plugin-balance/usage`。

## 在其他电脑上使用

1. 那台机器装好同版本 DSH 部署并保证 `dsh` 在 PATH 中（或用 `DSH_BIN=/path/to/dsh` 指定）。
2. `git clone https://github.com/hhcme/ds-plugin.git && cd ds-plugin`
3. `./scripts/install-plugin.sh dsh-plugin-balance`（等价于 `dsh plugin --profile web add ./packages/dsh-plugin-balance`）
4. **重启 `dsh web`**，任务面板与"使用情况"即生效。

注意：使用数据是**本机本地**的（读取该机器自己的会话日志，不跨机器同步）；余额模块需要该机器 DSH 里配置 `DEEPSEEK_API_KEY`；Git 模块显示的是该机器上当前对话项目的仓库状态。
