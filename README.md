# DSH GitHub（dsh-github）

给 [dsh-go](https://github.com/ccch1mneyyy/dsh-Go) 手机 App 的原生插件：**在输入框里就把 GitHub 的事办了**——建仓、推代码、fork 并克隆别人的项目，不用离开对话。

## 功能

| 位置 | 效果 |
|---|---|
| 输入框上方 | 连接状态：「GitHub · 未连接」或「GitHub · @登录名」；点按打开仓库面板 |
| 输入框胶囊 | **建仓**：用输入框里的文字建一个 GitHub 仓库（默认私有），克隆到本地并设为当前仓库；**推代码**：提交并推送当前仓库 |
| 加号面板 | **加项目**：fork（可选）+ 克隆任意公开项目；**设置**：粘贴 GitHub 令牌完成连接 |
| 仓库面板 | 账号、当前仓库、我的仓库列表（点一下切换或克隆）、本地工作副本、拉取、刷新 |

## 安装

要求：dsh-go 手机 App（本机引擎），dsh ≥ 0.2.1-rc.2，本机有 `git`。

```sh
git clone https://github.com/manke5201314-svg/dsh-github.git
dsh plugin --profile web add ./dsh-github
```

然后在 App 的「引擎」页重启一次引擎（或重开 App）。

## 开始使用

1. 在 GitHub 网页版 → Settings → Developer settings → Personal access tokens 生成一个带 `repo` 权限的令牌。
2. 打开插件的仓库面板，把令牌粘进「接入令牌」，点「保存并连接」。
3. 之后：输入框里写仓库名 → 点胶囊「建仓」；或打开一个本地项目 → 点「推代码」；或在加号面板点「加项目」粘贴别人仓库地址。

本地工作副本默认放在 `/sdcard/DeepSeek/github`，可在面板设置里改。

## 隐私与安全

- GitHub 令牌只保存在本机插件目录的 `data/config.json`（权限 600），**不会出现在视图、提示或日志里**，也不会上传到任何第三方。
- 网络请求只发往 `api.github.com`；git 操作走本机 `git`。
- 只在你点按钮时读输入框 / 剪贴板内容（用于建仓名和仓库地址），不读对话内容。

## 已知限制

- 需要自备 GitHub 令牌（经典令牌勾 `repo`，或细粒度令牌给 Contents 读写 + Administration 只读）。
- 首次使用前必须先在面板配置令牌，否则状态条显示「未连接」。
- 大仓库的克隆/推送耗时受手机网络影响，操作会显示等待状态。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT
