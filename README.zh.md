# dsh-kimicode-usage

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件，把 **Kimi Code 额度**显示在你干活的地方：

- **输入框徽章**——输入框工具行、模型选择器左侧的 `● 5h:xx%` 小药丸，圆点随剩余量绿 / 黄 / 红变色。点击弹出小悬窗：5 小时滚动窗口与每周额度的进度条、重置倒计时与刷新按钮；点击外部或按 `Esc` 关闭。
- **设置页区块**——设置里的「Kimi Code 额度」卡片，同样的两条进度条，手动刷新 + 60 秒自动重拉。

## 安装

```sh
dsh plugin --profile web add github:Number444/dsh-kimicode-usage
```

桌面端或非 web profile 换成 `--profile desktop`（或你的 profile 名）。装完刷新页面即可。

## 前置条件

插件需要一个 Kimi Code API key，在 **host 侧**按以下顺序解析：

1. DSH credentials 服务（即你已经在 DSH 里配置过 `kimi-coding` 提供商）；
2. 环境变量 `KIMI_CODING_API_KEY`；
3. `~/.dsh/.credentials.yaml` 的 `refs:` 段。

只要 DSH 能正常用 Kimi Code 跑模型，就无需额外配置。也可以通过插件 config 的 `apiKey` / `apiKeyEnv` 覆盖。

> 输入框徽章占用 `conversation.input.right` 席位，需要较新的 DSH 构建（0.1.7-rc.2 这一代）。旧宿主上设置页区块照常工作，徽章不出现。

## 安全说明

- API key **不会离开主机进程**——浏览器半边只访问本地代理路由 `/dsh-kimi-quota/api/usages`。
- 路由**只应答回环请求**，局域网直连一律 `403`；经 remote-web-ui 的远程遥控不受影响（通道在回环上重新发起请求）。
- 上行调用（`GET https://api.kimi.com/coding/v1/usages`）只读，不消耗额度。
- 响应在内存中缓存 2 分钟；上行失败时回退到最近一次成功数据并标记 `stale`。

## 仓库结构

- `lib/index.js`——主机半边：仅回环的额度代理路由、凭据解析、缓存。
- `lib/client.js`——浏览器半边：输入框徽章（含悬窗）与设置页区块。
- `cordis.patch.yml`——组合包 patch，把插件插进 DSH 组合。

## License

[MIT](LICENSE)
