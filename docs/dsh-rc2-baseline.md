# DSH rc.2 宿主基线升级（Issue #16）

本次将唯一宿主基线从 `0.2.1-alpha.2` 前移到 `0.2.1-rc.2`，不恢复旧多版本矩阵，不放宽为任意版本兼容。现有 GitHub Release 保持不可变；源码候选包与旧发行包必须按 build SHA 区分。

## 公开契约核对

核对上游 tag `dsh-v0.2.1-rc.2`，commit `687f282e8625c6b8d11ff58211a90524be2e4317`：

- `packages/typert/protocol/src/types.ts` 与 `src/index.ts`：Remote/TypertRemoteService、单请求 descriptor、`ctx.invocation.peer.id`、signal、uplink 和 TypertRemoteContribution 仍为公开契约。适配器的单源贡献增加编译时 `satisfies TypertRemoteContribution` 检查。
- `packages/core/tools/src/index.ts`：defineTool、tools/pre-execute、ToolExecution 的 agent/callId/signal 保持可用；不将终端管理审批移入模型控制的 JSON。
- `packages/client/ui-renderer/src/client/registry.ts`：slots.inject/register 仍为公开注册入口；使用 main、sidebar.panellist、conversation.view 和 settings.plugins.tab，不读宿主私有 DOM。
- `packages/client/locale/src/client/index.ts`：active/getSnapshot/subscribe 仍可用。会话 ID 仍由 conversation.view 的宿主标准属性传入。
- 上游 vendor 版本同时前移到 Cordis `4.0.5`、Schemastery `3.18.5`，不能把旧 alpha vendor 与 rc.2 混用。

来源：[上游 rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317)。

## 验证门槛

静态契约核对不是实际安装通过。合并前必须取得本次精确提交的：

1. 正规 registry 生成并提交的 pnpm lockfile；最终检查仍使用 frozen lockfile，不绕过 peer/engine 校验。
2. quality 全部通过，含已安装 DSH/vendor 版本与 manifest、provenance、CI 安装目标的一致性回归。
3. 真实 Herdr 集成、HTTP 浏览器回归及最终 tarball 在全新 DSH rc.2 profile 中的安装、公开槽位/Remote、认证、工作区/会话绑定、终端控制和卸载。
4. 合并后 main 再跑同套检查；不把 alpha.2 历史成功结果当成 rc.2 验证。

开发宿主 React 版本不代表 DSH 生产宿主 React；插件继续使用宿主单例。真实模型调用、人工 IME/读屏器及未声明平台仍不在本次自动化通过的含义中。

临时锁解析工作流只允许当前同仓 PR 分支、contents:read、ignore-scripts，输出公开依赖锁及哈希用于审核。锁提交后必须移除此临时工作流，最终 CI 不得采用动态锁解析代替 frozen 检查。


## Development peer closure

The root manifest explicitly pins the DSH auto-peer closure to rc.2. Updating
only the seven imported contract packages allowed pnpm to retain alpha.2 peer
snapshots from the old lockfile despite the published rc.2 packages requiring
exact rc.2 peers. These pins are development-only; they do not bundle host
services into the plugin or expand its runtime peer declarations. The packaging
regression checks every DSH identity in the lockfile, including nested snapshot
peer contexts, not just the root importer. Regenerate the lock with the existing
temporary metadata-only workflow and review its diff; do not delete the entire
lockfile or update unrelated dependencies to repair this graph.
