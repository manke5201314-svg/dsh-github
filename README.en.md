# DSH GitHub (dsh-github)

A native plugin for the [dsh-go](https://github.com/ccch1mneyyy/dsh-Go) phone app: **handle GitHub right from the composer** — create repos, push code, and fork + clone anyone's project without leaving the conversation.

## What it does

| Where | What |
|---|---|
| Above the composer | Connection status: "GitHub · offline" or "GitHub · @login"; tap to open the repo panel |
| Composer chips | **New repo**: create a GitHub repo from the text in the composer (private by default), clone it locally, set it current; **Push**: commit and push the current repo |
| Plus-panel tools | **Add repo**: fork (optional) + clone any public project; **Setup**: paste a GitHub token to connect |
| Repo panel | Account, current repo, my repos (tap to switch or clone), local working copies, pull, refresh |

## Install

Requires the dsh-go phone app (local engine), dsh ≥ 0.2.1-rc.2, and `git` on the device.

```sh
git clone https://github.com/manke5201314-svg/dsh-github.git
dsh plugin --profile web add ./dsh-github
```

Then restart the engine once from the app's Engine screen (or reopen the app).

## Getting started

1. On github.com → Settings → Developer settings → Personal access tokens, create a token with `repo` scope.
2. Open the plugin's repo panel and paste the token into "Setup", then save.
3. From then on: type a repo name in the composer and tap **New repo**; or open a local project and tap **Push**; or use **Add repo** in the plus panel with someone's repo URL.

Local working copies default to `/sdcard/DeepSeek/github` and can be changed in the panel.

## Privacy and security

- The GitHub token lives only in the plugin's local `data/config.json` (mode 600). It never appears in views, toasts, or logs, and is never sent anywhere except `api.github.com`.
- Network requests go only to `api.github.com`; git operations use the local `git`.
- The composer/clipboard is read only when you tap a button (repo name and repo URL), never conversation content.

## Known limits

- Bring your own GitHub token (classic with `repo`, or fine-grained with Contents read/write + Administration read).
- The token must be configured before anything else works; otherwise the strip shows "offline".
- Cloning/pushing large repos depends on the phone's network; operations show a pending state.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
