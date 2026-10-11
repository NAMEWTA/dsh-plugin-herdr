# @namewta/dsh-plugin-herdr

> [English](README.md) | **简体中文**

![Herdr 面板](assets/home.png)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Herdr 控制面插件：
提供 19 个 `herdr_*` 工具、Web 总览，以及为对话绑定独立工作区的 Herdr 模式。

## 环境要求与下载版本

插件 **0.0.2** 适配 Node **24+**，支持 DSH **0.2.0-rc.2**、**0.2.1-alpha.1** 和
**0.2.1-alpha.2**。DSH 插件安装器还要求 **pnpm 在 PATH 中可用**。插件与 Herdr 必须运行在
同一台 Linux/macOS 主机上，Herdr 基线为 **0.9.0 / protocol 22**。不支持 Windows named pipe；
使用 WSL 时两者须在同一 Linux 环境。

截至 **2026-10-11**，npm 的 `latest`/`next` 是 **0.2.0-rc.2**，`alpha` 才是
**0.2.1-alpha.2**。因此默认运行 `npx @deepseek-ai/dsh web` 不一定得到 GitHub 上最新的预览版。
版本矩阵与验证边界见 [COMPATIBILITY.md](COMPATIBILITY.md)。

```sh
npm install --global pnpm@10.28.2
# 当前默认下载通道的版本，使用精确版本保证可复现
npm install --global @deepseek-ai/dsh@0.2.0-rc.2
# 或者主动选择最新 alpha，二选一：
# npm install --global @deepseek-ai/dsh@0.2.1-alpha.2
dsh --version
pnpm --version
```

## 安装预构建插件

从 [GitHub Releases](https://github.com/NAMEWTA/dsh-plugin-herdr/releases) 下载
`namewta-dsh-plugin-herdr-0.0.2.tgz` 和 `SHA256SUMS`。仅在 main 的完整质量检查、真实 Herdr
集成和 DSH Web 安装矩阵全部通过后才生成发布包。成功 `ci` 运行中的 `herdr-plugin-package`
产物也包含同一个包。本插件尚未单独发布到 npm，不能仅凭 npm 包名下载它。

```sh
# 在下载包和校验文件所在目录执行
sha256sum --check SHA256SUMS  # macOS 使用 shasum -a 256 --check SHA256SUMS
dsh plugin --profile web add /绝对路径/namewta-dsh-plugin-herdr-0.0.2.tgz
dsh plugin --profile web list
dsh web
```

安装或替换版本后，重启已经运行的 Web profile。也可在 DSH 的插件安装界面选择同一个
预构建 `.tgz` 文件。侧栏 **Herdr** 入口打开总览；对话选择 **Herdr 模式** 后使用专属工作区。
Herdr 本体需要另行安装并运行；存在 `PATH` 中的可执行文件时，面板可尝试启动服务。

**不要直接安装尚未构建的 Git 目录。** 仓库不会提交 `lib/`；GitHub 的源码压缩包也不等于
可安装的预构建插件包。

## 从源码构建

```sh
git clone https://github.com/NAMEWTA/dsh-plugin-herdr.git
cd dsh-plugin-herdr
npm install --global pnpm@10.28.2
pnpm install --frozen-lockfile
pnpm quality
pnpm pack  # prepack 会自动构建 Host、Typert 和 Web
pnpm check:package ./namewta-dsh-plugin-herdr-0.0.2.tgz
dsh plugin --profile web add ./namewta-dsh-plugin-herdr-0.0.2.tgz
```

## 升级与卸载

向同一个 `web` profile 安装新 `.tgz` 后重启。遇到版本兼容检查失败，应切换到矩阵内的
DSH 版本，不要强制绕过 peer 检查或复制其他版本的 `node_modules`。

```sh
dsh plugin --profile web remove @namewta/dsh-plugin-herdr
```

随后重启 profile，卸载工具、面板与运行时注册的预设。只有过去手工复制的旧预设可能在
`.agent-presets/herdr/` 留下文件；当前插件不会往那里安装预设目录。

## 开发与验证

`pnpm quality` 执行构建、类型检查、协议生成漂移检查、单元测试和打包回归测试。
`pnpm test:integration` 需要真实 Herdr 服务；本地环境缺失时可以跳过，CI 则要求实际执行。
真实 DSH 安装与浏览器冒烟测试由独立的 CI 版本矩阵执行。

全面加固工作仍在草稿 PR #13 中，本次兼容性发布不宣称已经完成全部加固。

## 许可证

MIT © 2026 NAMEWTA。保留 sunny0826 的原始代码署名，详见 [LICENSE](LICENSE)。
