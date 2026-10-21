# 来源、独立化与发行治理

## 来源冻结

原仓库：`NAMEWTA/dsh-plugin-herdr`；基线提交：`846583f0c7aff044a09bb878ba3e03d996b2ff56`（2026-10-20）。父项目为 `sunny0826/dsh-plugin-herdr`。保留代码的 MIT 署名在根 LICENSE 和发行包 LICENSE 中。

获批设计原文保存在 `design-baseline.md`；原始 89 项验收条件及实施状态保存在 `requirements-status.csv`。文档的历史调研时点与当前源码验收时点不要混淆。

保留资产：终端生命周期/协议逻辑、NDJSON/transport 思路及相应回归；其余按中立平台、模块边界和新契约重组/重写。产品图标是本项目新绘制的几何 SVG；不分发字体。实际 bundle 中的第三方包与许可证由构建器遍历模块生成，不用一份手填依赖清单代替。

## 独立化已落地的代码边界

独立包名、版本、配置、预设、命令、数据命名空间、构建和 CI。没有获取原插件上游发布包、自动合并上游、旧 alias 或旧运行时矩阵。所有问题入口指向 NAMEWTA 的当前仓库。

Herdr 与 DSH 是外部运行依赖，不等于本产品的代码上游。独立维护不意味着不依赖它们，也不允许删除必要的来源/许可证记录。

## 管理员侧尚未完成的动作

PR 不能把 GitHub 的 fork 标记改为独立仓库。应在审核/备份后由维护者使用 GitHub 支持的 detach 流程或创建独立仓库迁入；保留 issue/PR/历史引用，不删除当前仓库作为“脱离”的捷径。

最终产品/仓库名需维护者确认。候选 npm 名 `@namewta/dsh-workbench` 的注册表查询保存于 CI 的 `package-name.json`；404 只说明该时点未找到包，不证明 scope 发布权限或商标授权。未执行 npm 发布、release 覆盖或仓库重命名。

完成仓库独立化后，统一更新 package repository/bugs/homepage、CI、安装文档与支持入口，并重跑最终构件验收。发布与合并是独立批准动作，不能由测试成功自动触发。
