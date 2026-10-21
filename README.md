# Workbench

**独立维护、功能模块化的开发工作台。Herdr 是第一个模块，而不是整个平台。**

本分支用 `@namewta/dsh-workbench` 替换旧插件架构：统一 React 界面、第一方模块 SDK、服务端授权、明确的资源归属和受控终端。没有旧 API、旧配置、旧导出或旧预设兼容层。旧插件不被自动卸载，已有工作区和 Agent 不被迁移或删除。

> 当前为 `1.0.0-alpha.1` 候选版本，不是已发布的 npm 版本。GitHub 仓库仍位于原 fork 网络；代码重构不等于完成 GitHub 管理员侧的脱离操作。发布门槛与未验证项见 [验收记录](docs/acceptance.md)。

## 产品结构

```text
apps/dsh-plugin        最终发行包与装配入口
apps/dev-workbench     无 DSH/Herdr 的可复验开发宿主（仅模拟数据）
packages/platform-*   中立契约、模块运行时、权限、操作、审计端口
packages/module-sdk   Manifest、贡献、生命周期与存储接口
packages/ui           唯一公共 UI 入口、主题、密度、表单与浮层
packages/workbench-shell  导航、命令面板、模块管理、设置与审计
adapters/dsh           DSH 公开槽位、Remote、工具与持久化适配
modules/herdr          Herdr 领域、应用、基础设施和 Web 功能
modules/example-notes 第二模块扩展证明；不进入发行包
```

总览优先显示待处理事项，工作区、Agent、终端、环境与连接使用同一套设计系统。支持中文/英文、明暗/系统主题、舒适/紧凑密度、卡片/表格、键盘命令面板和窄屏布局。终端列表不会创建隐藏观察进程；xterm 资源只在用户打开终端时加载。

## 开发与验证

冻结基线：Node **24.22.0**、pnpm **10.28.2**。先安装这些版本，再执行：

```sh
pnpm install --frozen-lockfile
pnpm quality
pnpm dev
```

开发页面完全使用模拟数据，不代表真实终端或远程部署已经通过验收。附加验证：

```sh
HERDR_TEST_BINARY=/absolute/path/to/herdr-0.9.3 pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm pack:plugin
node tooling/check-package.mjs artifacts/*.tgz
HERDR_TEST_BINARY=/absolute/path/to/herdr-0.9.3 node tests/e2e/dsh.mjs /absolute/path/to/dsh/lib/bin.js artifacts/*.tgz
```

集成环境缺失会失败，不会跳过后报告通过。CI 固定 Linux x86_64、Herdr 0.9.3/protocol 22 和 DSH 0.2.1-alpha.2，只生成候选包，不自动发布 npm/GitHub Release。

## 安装和使用

见 [安装与配置](docs/installation.md)。安装的是 `apps/dsh-plugin` 构建后的 `.tgz`，不是仓库源码目录。进入 DSH 侧栏 **Workbench** 后，先查看 **环境与连接**，再创建工作区或明确接管现有资源。

观察终端默认只读。取得控制权、接管、关闭资源均需独立确认。控制互斥仅覆盖 Workbench 的租约，不声称阻止其他 Herdr TUI。退出页面只释放桥接进程，不关闭外部 shell/Agent。

## 文档

[架构](docs/architecture.md) · [模块开发](docs/module-guide.md) · [安全模型](docs/security.md) · [测试与证据](docs/testing.md) · [支持基线](docs/support.md) · [需求状态台账](docs/requirements-status.csv) · [获批设计](docs/design-baseline.md) · [来源与独立化](docs/provenance.md)

## 许可证

MIT。保留 NAMEWTA 与 sunny0826 的必要版权通知。发行包包含 `NOTICE`、实际打包依赖的许可证、CycloneDX SBOM、源码 SHA 和构件校验清单。独立维护不抹去保留代码的来源。
