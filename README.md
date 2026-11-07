# Navidrome · MyGo Music 插件

在 [MyGo Music](https://github.com/egoist/mygo-music) 中连接自己的 [Navidrome](https://github.com/navidrome/navidrome) 音乐库。插件通过 Subsonic / OpenSubsonic API 直接访问服务器，无需额外服务。

## 安装和配置

1. 在 MyGo Music 0.1.8 或更新版本中，打开「设置 → 插件 → +」，选择从本地文件夹安装，选中本项目目录。
2. 打开插件设置，填写 Navidrome 服务器地址、用户名和密码。地址包含协议与端口，例如 `https://music.example.com` 或 `https://example.com/navidrome`。
3. 在来源选择器中选择 Navidrome。修改服务器或账号后，如界面仍显示旧数据，请重新进入来源或重启应用。

插件需要访问任意网络主机的权限，因为 Navidrome 可以部署在用户自定义的地址。插件设置由 MyGo Music 管理并保存；密码不是通过系统密钥环保存的。Subsonic 令牌及用户名会出现在 API、封面和音频请求的 URL 中，可能被服务器、反向代理或日志记录。请使用 HTTPS、妥善保护日志，并尽量为插件使用独立账号。内网 HTTP 地址也可使用，但流量未经加密。

## 功能

- 随机歌曲、最近添加与最近播放的专辑。
- 歌曲、专辑、歌手和可访问歌单搜索；专辑、歌手、歌单详情。
- 创建、重命名、删除歌单，添加或移除歌曲；移除时会删除歌单中该歌曲的所有出现位置。
- 喜欢歌曲、收藏专辑、关注歌手，以及向服务器记录播放。
- 通过 OpenSubsonic 歌词接口显示歌词（需要服务器支持）。
- 原格式播放 MyGo Music 支持的格式；其他格式请求服务器转码为 MP3，需服务器配置相应转码器。

歌单搜索在可访问歌单中按名称筛选。部分功能受 Navidrome 版本、账号权限、音乐元数据和服务器配置影响。

## 开发

插件运行无需安装依赖或构建。使用 Node.js 运行检查：

```sh
npm run check
npm test
```

将项目发布为公开 GitHub 仓库后，也可以通过 MyGo Music 的「从 GitHub 安装」填写仓库名安装。
