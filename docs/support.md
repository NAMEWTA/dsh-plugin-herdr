# 支持与验证基线

| 项目 | 冻结值 | 说明 |
|---|---|---|
| Node | 24.22.0（包范围 24.22.0 ≤ x < 25） | CI 使用精确值；测试用原生 transform-types 的实验标志。 |
| pnpm | 10.28.2 | frozen lockfile；只批准 workspace 文件中列明的构建依赖。 |
| DSH | 0.2.1-alpha.2 | 唯一新宿主基线，不保留 rc/其他 alpha 的旧适配。 |
| Herdr | 0.9.3 / protocol 22 | fixture 来自该二进制的实际 `api schema --json`；不同协议禁止写。 |
| OS | Linux x86_64 / Ubuntu 24.04 runner | macOS、Windows/WSL 不宣称自动验收通过。 |
| 浏览器 | CI 安装的 Playwright 1.64.1 Chromium | 本地受管 Chromium 仅做离线组件渲染，不替代实际 HTTP/DSH 检查。 |
| React | 开发 19.2.8；DSH Web 自带 18.3.1 | 插件用宿主单例；没有把开发版本冒称生产运行时。 |
| UI | Base UI 1.9.0，Tailwind 4.3.3 | 唯一共享组件体系；依赖精确版本见 lockfile。 |
| 终端 | xterm 6.0.0，FitAddon 0.11.0 | 单独静态资源、按需加载。 |

连接成功不等于版本完整支持；环境页同时展示安装文件、运行服务、协议和流能力。支持声明以当前提交的 CI、真实最终包和人工记录为准，不从 README 历史文字推断。

使用不同 XDG 目录时明确配置 socket。原生 Windows named pipe 和多主机 SSH 不在首发范围。不存在旧配置自动迁移或任意版本兜底。
