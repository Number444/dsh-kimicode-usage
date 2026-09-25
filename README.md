# dsh-kimicode-usage

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that shows your **Kimi Code quota** right where you work:

- **Composer badge** — a compact `● 5h:xx%` pill in the input box toolbar, just left of the model selector. The dot turns green / yellow / red as the remaining quota drops. Click it to open a small popover with both windows (5-hour rolling and weekly), progress bars, reset countdowns and a refresh button. Click outside or press `Esc` to close.
- **Settings section** — a full "Kimi Code 额度" card under Settings with the same two progress bars, a manual refresh button and a 60-second auto refresh.

## Install

```sh
dsh plugin --profile web add github:Number444/dsh-kimicode-usage
```

Use `--profile desktop` (or your own profile name) if you run a desktop build instead of `dsh web`. Refresh the page after installing.

## Requirements

The plugin needs a Kimi Code API key, resolved on the **host** side in this order:

1. the DSH credentials service (i.e. you already configured the `kimi-coding` provider in DSH),
2. the `KIMI_CODING_API_KEY` environment variable,
3. the `refs:` section of `~/.dsh/.credentials.yaml`.

If DSH can already run Kimi Code models for you, no extra setup is needed. The key can also be overridden per-install via the plugin config (`apiKey` / `apiKeyEnv`).

> The composer badge occupies the `conversation.input.right` slot, which exists in recent DSH builds (0.1.7-rc.2 era). On older hosts the Settings section still works; the badge simply does not appear.

## Security notes

- The API key **never leaves the host process** — the browser half talks only to a local proxy route (`/dsh-kimi-quota/api/usages`).
- The route answers **loopback requests only**; LAN clients get `403`. Remote control through remote-web-ui keeps working because the tunnel re-issues the request on loopback.
- The upstream call (`GET https://api.kimi.com/coding/v1/usages`) is read-only and does not consume quota.
- Responses are cached in memory for 2 minutes; on upstream failure the last good data is served with a `stale` flag.

## Repository layout

- `lib/index.js` — host half: the loopback-only quota proxy route, credential resolution, caching.
- `lib/client.js` — browser half: the composer badge (with popover) and the Settings section.
- `cordis.patch.yml` — bundle patch inserting the plugin into the DSH composition.

## License

[MIT](LICENSE)
