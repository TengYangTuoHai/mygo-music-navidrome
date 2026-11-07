# Navidrome · MyGo Music 插件

在 [MyGo Music](https://github.com/egoist/mygo-music) 中搜索和播放 [Navidrome](https://github.com/navidrome/navidrome) 音乐库。通过 Subsonic / OpenSubsonic API 连接自己的服务器，无需额外服务。

## 安装和使用

需要 MyGo Music **0.1.8 或更新版本**，以及可以访问的 Navidrome 服务器。

打开 MyGo Music → **设置 → 插件 → + → 从 GitHub 安装**，填入：

```text
TengYangTuoHai/mygo-music-navidrome
```

也可以点击[安装插件](mygo-music://install-plugin?repo=TengYangTuoHai/mygo-music-navidrome)，或下载本仓库后选择从本地文件夹安装。

安装后，在插件设置中填写以下信息，然后在来源选择器中选择 **Navidrome**：

- **服务器地址**：包含协议和端口，例如 `https://music.example.com`；部署在子路径时填写完整地址，例如 `https://example.com/navidrome`。
- **用户名和密码**：你的 Navidrome 账号。

修改服务器或账号后，如界面仍显示旧数据，请重新进入来源或重启应用。

## 功能

- 搜索歌曲、专辑、歌手和可访问的歌单；浏览专辑、歌手和歌单详情。
- 发现随机歌曲、最近添加和最近播放的专辑；浏览音乐库中的专辑和艺人。
- 在侧边栏查看喜欢的音乐、艺人和专辑。
- 创建、重命名、删除歌单，添加和移除歌曲。
- 喜欢歌曲、收藏专辑、关注歌手，并向服务器记录播放。
- 显示 OpenSubsonic 歌词，取决于服务器和歌曲是否提供歌词。
- 以原格式播放 MyGo Music 支持的音频；其他格式请求服务器转码为 MP3，需要服务器配置相应转码器。

歌单搜索按名称筛选当前账号可访问的歌单。搜索后的「搜索结果」入口由 MyGo Music 自动显示，清空搜索框即可移除。从歌单移除歌曲时，会移除该歌曲在歌单中的所有出现位置。可用功能还取决于 Navidrome 版本、账号权限和音乐元数据。

## 账号和网络

插件需要访问任意网络主机的权限，以连接用户填写的服务器地址。密码由 MyGo Music 保存在插件设置中，并非保存在系统密钥环中。

插件使用 Subsonic 令牌认证；用户名和令牌会出现在 API、封面和音频请求的 URL 中，可能被服务器、反向代理或日志记录。建议使用 HTTPS、保护日志，并为插件使用独立账号。内网 HTTP 地址也可使用，但流量未经加密。

## 开发

运行插件无需构建或安装依赖。使用 Node.js 运行语法检查和测试：

```sh
npm run check
npm test
```

## 许可证

[GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）。
