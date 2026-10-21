# 添加功能模块

先阅读 `modules/example-notes`：这是实际启动、注册操作、隔离存储、挂载页面并参与测试的第二模块，不是空目录；生产装配不导入它。

1. 在 `modules/<name>` 创建 private workspace 包。只从 SDK/contracts/UI 的公开 exports 导入。
2. 声明唯一 Manifest：id、semver、platformApi、依赖、能力与页面/命令/设置/小组件贡献。贡献必须声明权限，并且不能在启动后暗中注册。
3. Host 的 `start(ctx)` 注册 schema 化 operation/stream，并用 `ctx.own` 管理订阅、计时器和进程。存储使用 `ctx.storage`，不能绕过命名空间访问其他模块。
4. Web 导出 `WebModule`，页面只使用 Workbench UI 和 `WorkbenchClient`。不可引用 DSH/Node 或另一个模块的私有源码。
5. 只在 `apps/*` 装配入口增加导入和注册；不修改 shell 或 Herdr。首先添加到 dev-workbench 与自动化测试，审核后才进入生产装配。
6. 通过重复 ID、依赖环、启动失败回滚、页面错误边界、停止/重启、无权限、schema 漂移和存储隔离测试。

SDK 是第一方代码的组织与权限接口，不是抵御恶意插件的沙箱。任意第三方代码、远程脚本、签名分发和进程隔离属于后续 EXT-05，不得直接用 `import(userUrl)` 替代设计。

只读查询可以按产品策略刷新；有副作用的动作必须独立确认和处理结果不确定状态。不要在 UI 层“看起来禁用”后省略服务端校验。
