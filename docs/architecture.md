# 模块化单体架构

## 依赖方向

`apps/dsh-plugin → adapters/dsh + platform-core + modules/herdr`；`modules/* → module-sdk + platform-contracts`；Web 功能经 `packages/ui` 和中立契约接入 `workbench-shell`。核心、UI 和宿主适配互不穿透业务内部。

`tooling/check-architecture.mjs` 检查 workspace 声明、公开 exports、依赖环、Host/Web 方向、私有 DOM/Fiber 模式和最终 CSS 作用域。构建期间生成的样式和构建 SHA 不作为源码手改。

## 操作与流

所有操作先经身份/权限、schema、资源归属和实例检查。平台请求为 `operation/requestId/input`，结果为 `ok/data/requestId` 或稳定错误码。DSH 的外层 gateway Result 只解包一次，不能与领域 Result 混淆。

`adapters/dsh/src/contract.ts` 唯一声明五个 Remote 方法及其单请求参数；生成 Host codec 与客户端描述符。终端数据走双向 stream，普通页面数据走 TanStack Query。原始终端字节不进入 React 状态。

模块启动只在贡献完整注册后变为 active；失败原子回滚。停用进入 draining，撤销客户端信号，等待任务并逆序释放资源。清理失败保留 failed/配额占用，不能伪装为成功。清理等待采用每个受控 disposer 的期限，不承诺任意第三方代码可被强制中断。第一方代码需配合 AbortSignal。

## 资源身份与一致性

资源键包含 connection/session/epoch/kind/id/instance。socket inode/ctime 或连接中断改变 epoch；pane terminal_id 改变 occupant。显示名称与标签不能证明所有权。仅本进程新建或用户显式 adopt 的当前实例可被管理；重连后重新确认。

事件只标脏，单飞权威快照负责重读。读取中收到事件会继续读取；events_lost 与断流留下缺口提示。旧数据保留但标 stale，不能显示成空数组或健康的零。五态原样表达；done 只是回合结束，不推导任务成功。

## 终端生命周期

仅打开模块页面不启动终端；用户选择具体 pane 后自动创建只读观察桥接，控制快捷入口先显示显式确认。每次重新点击查看都回到只读状态，URL 不授予控制权。初次附着有独立 15 秒期限，不能与短断线宽限混用。终端模块初始化在请求租约前完成。每个浏览器租约绑定可信 operator、随机 client ID、pane 实例和寿命信号。

同一 pane 的控制请求串行。显式 takeover 先撤销旧租约，再授予新租约。每条输入重新验权/验实例；序号 ACK 表示桥接接收，不保证 shell 命令业务成功。ACK 缺失属于不确定结果，禁止重放。

只接受正确 generation/sequence 的全帧与差量。慢消费者、超额、丢帧或失去基线会停止并要求重新取得全帧，不能丢弃 ANSI 字节后假装画面连续。子进程实际退出前继续占配额。

## 存储与审计

首发实现宿主存储端口，采用私有文件目录、CAS 版本、排他锁、fsync 与原子替换。损坏数据/符号链接拒绝，不默默覆盖。没有远程数据库或隐式旧格式迁移。已读/暂缓偏好为有界客户端元数据；对话绑定与模块启用意图在 profile 存储。

动作先写持久 accepted 记录，失败不执行副作用；最终结果记录失败返回不确定结果，重复 requestId 不重做操作。审计按大小/天数轮转，只含元数据，不含输入、终端正文或凭据。SQLite 可作为后续同一存储端口的适配，并非首发硬依赖。

## React 与 UI 决策

开发宿主固定 React 19.2.8。真实 DSH 0.2.1-rc.2 的 Web 分发包沿用 React 18 系列；插件遵守获批设计中的“使用宿主同一 React 实例”，不把第二个 React renderer 塞入同一组件树，也不使用 React 19 独有运行时 API。此差异在支持表明示，不能把开发依赖版本称为生产宿主版本。

UI 为项目拥有源码的 shadcn-style/Base UI 组合，单一原语基座，Tailwind 4 和语义 token。所有最终选择器在 `.wb-root` 下，弹层在受控 portal 内，不重置宿主 body。终端渲染器随 DSH 公开客户端构件交付，在选择 pane 后延迟初始化，不额外请求网站根路径。客户端不使用运行时代码下载、blob/eval 或额外 CSP 白名单；渲染器加载不授予终端权限。

## 有意不做

不引入旧兼容矩阵、微服务、微前端运行时、任意 npm/URL 模块安装、多租户授权、自动迁移旧工作区或生产独立宿主。未来模块经明确端口扩展，不复制平台壳层。

