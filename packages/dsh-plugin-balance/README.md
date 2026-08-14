# dsh-plugin-balance

Codex 风格的**悬浮任务面板**：一个固定在视口右上方的悬浮卡片（不在右侧 details 栏内），集中显示：

- **余额**：`GET /api/dsh-plugin-balance/balance`（host 经 credentials 服务按需解析 `DEEPSEEK_API_KEY`，密钥只留在 host 进程）。点击 ⟳ 刷新，每 60s 自动刷新。
- **Token**：当前会话 in / out / 合计（`useProjection("tokenUsage")`）。
- **统计**：步骤、轮次、LLM/工具耗时、tok/s（`useProjection("sessionStats")`）。
- **目标**：当前 goal 的 objective、阶段、轮次（`useProjection("goal")`）。
- **任务清单**：todo 列表与完成进度（`useProjection("todos")`）。

原位置的内容已“迁移”进卡片：`conversation.input.dock` 的 `todo`、`goal` 条和 `conversation.composer.dock` 的 `stats` 行被本包以 null 组件遮蔽（卸载本包即恢复原样）。`queue`（后台任务队列条）保持原位。

遮蔽机制（重要）：list 插槽的冲突判定与遮蔽都只看 **`priority`** 字段（缺省 0）——同 id 同 priority 直接抛错；同 id 不同 priority 时**最低者渲染**。`order` 只是同 priority 内的排序补充，**不参与**冲突判定。因此本包把三个替换组件注册为 `priority: -10`，低于自带条目的 0，让 null 组件胜出渲染。

实现要点：`shell.overlay` 是 root 级（无会话 props），因此包内用会话级 `conversation.input.dock` 上的一个渲染 `null` 的桥接组件把 projections 泵进共享 store，面板订阅该 store —— 会话切换/无会话时自动清空会话数据，仅余额常显。

注意：`BalanceSection` 必须是真正的组件元素（`React.createElement(BalanceSection)`），不能当普通函数条件调用，否则 React 会报 #300（hook 顺序错乱）。
