1. ⚡ 自动化文件夹重排引擎 (Folder Auto-Sort Engine)
   智能规则支持：支持 Mode A (排除模式) 与 Mode B (包含模式)，用户可以在 Dashboard 自定义选择哪些文件夹参与或排除自动重排。

双重倒序安全重排算法：

基于 Visits（点击得分）降序优先；得分相同则按 DateAdded（创建时间）降序。

采用 index: 0 倒序插入机制 移动书签，彻底解决了 Chrome Bookmarks API 在顺序移动时容易发生的索引错位（Index Shift）问题。

增加顺序比对校验，若文件夹顺序未发生变化则跳过 API 调用，大幅提升执行效率。

2. ⏰ 多维度自动重排触发机制
   在 background.js 中集成了 3 种维度的自动重排触发：

定时任务 (Hourly Alarm)：插件安装/更新时自动注册 alarms 定时器，每 60 分钟自动静默重排一次。

开机/启动触发 (onStartup)：浏览器每次启动时自动运行一次文件夹重排。

手动即时触发 (Manual Run)：在 Options Dashboard 中支持用户点击 Run Sort Now 按钮，通过 chrome.runtime.sendMessage 响应手动重排请求。

3. 🧊 冷库归档 (Cold Vault Archiver) 优化
   自动扫描超过 30 天未访问的冷门书签。

自动寻找或创建 🧊 BookmarkFlow Cold Vault 专属归档文件夹，支持批量一键安全迁移。

白名单（Whitelist/Protected）保护：支持对冷门书签一键加星保护，防止被误归档。

4. 📊 实时数据统计与仪表盘 (Dashboard & Popup)
   动态图表：Options 页面结合 Chart.js 展示 24 小时、7 天、30 天、90 天、1 年及按年份筛选的 Top 10 访问热度柱状图。

Popup 快捷工具：快速展示 Top 10 最活跃书签，点击时自动记录访问频次并完成页面跳转。
