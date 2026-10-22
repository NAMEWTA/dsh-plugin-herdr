# Workbench 安装与配置 / Installation

这是新的独立包 `@namewta/dsh-workbench@1.0.1-alpha.1`，不是旧包的兼容更新。候选构件不等于已经发布到 npm。

## 冻结环境

Node 24.22.0、pnpm 10.28.2、DSH 0.2.1-alpha.2、Herdr 0.9.3/protocol 22。自动化验收目标为 Linux x86_64。macOS、原生 Windows 和其他版本不宣称已验证。浏览器和 Herdr 可以不在同一设备，但 DSH Host 与 Herdr 必须在同一 Linux 环境；WSL 也必须是同一发行版。

```sh
npm install --global pnpm@10.28.2
npm install --global @deepseek-ai/dsh@0.2.1-alpha.2
# 在候选包与 SHA256SUMS 所在目录检查校验值：
sha256sum --check SHA256SUMS
dsh plugin --profile web add /absolute/path/namewta-dsh-workbench-1.0.1-alpha.1.tgz
dsh web
```

不要安装未构建的源码目录。旧包不被新包自动卸载。需要停止使用旧产品时，由管理员明确执行 `dsh plugin --profile web remove @namewta/dsh-plugin-herdr` 并重启对应 profile；不删除旧 profile、凭据、Herdr pane 或工作区。

## 新配置

在 DSH 的插件配置中设置下列新键，修改后重启同一个 profile。所有路径必须是绝对路径。没有旧环境变量或旧字段回退。

| 键 | 默认与用途 |
|---|---|
| `socket` | 默认 HOME 下 `.config/herdr/herdr.sock`；非 default session 使用其 sessions 子目录。自定义 XDG/服务路径时应明确指定。 |
| `session` | `default`；允许字母、数字、下划线、连字符，1–64 字符。 |
| `binary` | 显式路径优先，其后 `WORKBENCH_HERDR_BINARY`，最后在受控 PATH/官方目录查找。错误显式路径不会悄悄换程序。 |
| `workspaceRoot` | 默认 DSH 进程工作目录；创建工作区的路径经 realpath 后必须在此根目录内。 |
| `dataDirectory` | 默认当前 DSH profile 下 `workbench/`，不读取旧插件数据。 |
| `readOnly` | `false`；开启后服务端只授予平台读取、Herdr 读取和观察能力。 |
| `pollMs` | 3000，范围 500–30000 毫秒。事件推送失效时显示轮询降级。 |
| `toolsEnabled` | `true`；注册显式绑定和审批保护的 Workbench 对话工具。 |
| `maxObservers` | 8，范围 0–64。 |
| `maxControllers` | 2，范围 0–16。 |
| `maxProcesses` | 16，范围 1–128；清理中的桥接进程仍占配额。 |

`WORKBENCH_HERDR_SOCKET` 可作为新 socket 配置的环境输入。示例：

```sh
WORKBENCH_HERDR_SOCKET=/absolute/private/herdr.sock WORKBENCH_HERDR_BINARY=/absolute/path/to/herdr dsh web
```

## 使用边界

检测不会下载安装软件、自动启动/升级服务或停止现有 daemon。只读观察、取得控制、接管控制、关闭资源分别处理。首次加载终端渲染器在取得租约之前完成；无浏览器附着的桥接有独立的有界回收期限。断线不会自动恢复输入或重发按键。

Workbench 的控制互斥不阻止外部 Herdr TUI。所有 DSH 已鉴权浏览器继承同一宿主 operator 权限；这是单用户本地产品，不是多租户远程 shell。保持在可信私网内。

对话页需显式绑定工作区。`workbench_herdr_inspect` 只读取该绑定；`workbench_herdr_action` 必须经过 DSH 人工审批，不提供原始按键、隐式接管或跨工作区操作。断线/重启改变资源 epoch 后，旧绑定失败关闭，应重新选择当前资源。

## 卸载与回退

```sh
dsh plugin --profile web remove @namewta/dsh-workbench
```

随后重启 profile。不会关闭外部 Agent 或删除工作区。新数据目录保留给管理员决定如何备份/删除。回退到旧产品必须显式安装旧构件；没有新旧格式双写或自动降级。
