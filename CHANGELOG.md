# Changelog

本项目的所有重要变更都记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.3] - 2026-11-15

### 变更

- 推送、同步、克隆全部改走 GitHub Git Data API（`lib/remote.js`），不再依赖本机 `git`：手机网络里 `github.com:443` 常被掐断，`api.github.com` 可用。
- 推送按内容比对：本地算 git blob sha，只上传变化文件，删除的文件按 `sha: null` 进入 tree。
- 本地仓库用 `.dsh-github.json` 标记（旧的 `.git` 目录仍被识别）。
- 删除 `lib/git.js`。

## [0.1.2] - 2026-11-15

### 变更

- 精简界面：去掉输入框上方的状态条（`composer.strip`）和两个胶囊「建仓」「推代码」（`composer.actions`）。
- 建仓、推送、添加项目全部收进仓库面板的「建仓 / 一键添加 / 推送」表单与按钮里。
- 保留加号面板的「加项目」「设置」（剪贴板令牌兜底）。

## [0.1.1] - 2026-11-10

### 变更

- 插件介绍改为中文：`package.json` 的 `description` 会显示在 npm 与 GitHub 仓库页。
- README 的「License」小节改为「许可证」。

## [0.1.0] - 2026-11-10

### 新增

- **输入框上方状态条**：显示 GitHub 连接状态（未连接 / @登录名），点按打开仓库面板。
- **输入框胶囊**：
  - 「建仓」：用输入框里的文字创建 GitHub 仓库（默认私有、带 README），并克隆到本地、设为当前仓库。
  - 「推代码」：提交当前仓库的改动并推送。
- **加号面板工具**：
  - 「加项目」：fork（可选）+ 克隆任意公开仓库，支持 `owner/repo`、`github.com` 链接和 `git@` 地址。
  - 「设置」：粘贴 GitHub 令牌完成连接，自动读取登录名。
- **仓库面板**：账号、当前仓库、我的仓库（点按切换或克隆）、本地工作副本、拉取、刷新。
- **安全存储**：令牌只写入插件目录 `data/config.json`（权限 600），不进视图、提示和日志。
- **单元测试**：表单解析、仓库名校验、地址解析、本机 git 身份与提交（不联网）。

### 已知限制

- 需要自备 GitHub 令牌（`repo` 权限）。
- 未配置令牌时状态条显示「未连接」。
- 大仓库操作耗时受手机网络影响。

[0.1.1]: https://github.com/manke5201314-svg/dsh-github/releases/tag/v0.1.1
[0.1.0]: https://github.com/manke5201314-svg/dsh-github/releases/tag/v0.1.0
