# 🚀 BookmarkFlow

[中文](#chinese) | [English](#english)

---

<a name="chinese"></a>
## 中文

BookmarkFlow 是一款轻量、注重隐私的 Chrome 浏览器插件。通过智能热度分析、动态文件夹重排与自动化冷库归档，帮您轻松保持书签栏的高效与整洁。

### 🌟 v1.0 核心功能列表

#### 📊 全场景访问计数与热度统计
- **全渠道点击追踪**：无论是从书签栏点击、历史记录访问，还是地址栏直接输入网址，均能精准捕获并增加对应书签的访问计数。
- **多维度数据统计面板**：提供 24 小时、7 天、30 天、90 天、1 年、特定年份及 All Time 的可视化柱状图分析，直观展示最高频使用的 Top 10 书签。
- **Popup 热门书签（Hot Bookmarks）**：插件弹窗快速展示最常访问的书签，按点击热度和添加时间智能排序。

#### ⚡ 智能文件夹自动重排（Sort Engine）
- **定时与启动重排**：支持每小时后台自动重排及浏览器启动时自动重排，同时提供“Run Sort Now”手动即时触发功能。
- **多模式过滤规则**：支持黑名单模式（Exclude，重排除选中文件夹外的所有文件夹）与白名单模式（Include，仅重排选中文件夹）。
- **最小干预原则与安全隔离**：零点击量的书签保持原始相对位置不变；严格做到子文件夹隔离与同级绝对索引对齐，确保嵌套结构不乱序。

#### 🧊 冷库归档与防误删机制（Cold Vault Archiver）
- **冷书签自动识别**：自动检索超过 30 天未访问的书签，支持一键安全移动至 `🧊 BookmarkFlow Cold Vault` 专用归档文件夹。
- **白名单保护（Whitelist）**：支持对特定重要书签一键加星保护（Protected），免受冷库归档影响。
- **冷启动防御保护（Installation Guard）**：引入 30 天安装学习期机制，避免新用户刚安装插件时将大量历史老书签误判为冷书签。

#### ✨ 细节与体验优化
- **无标题智能回填**：书签标题为空时，自动截取域名并智能处理路径作为展示 Title，并支持站点 Icon 显示。

---

### 💬 问题反馈与建议
本仓库专门用于 BookmarkFlow 的用户反馈与 Bug 收集。如果您在使用过程中遇到问题或有新功能想法，欢迎提交 Issue！

[👉 点击提交 Issue / Bug 反馈](https://github.com/avidbyte/bookmarkflow-community/issues)

---

<a name="english"></a>
## English

BookmarkFlow is a lightweight, privacy-focused Chrome extension designed to keep your browser organized effortlessly through smart analytics, dynamic sorting, and automated lifecycle archiving.

### 🌟 Features (v1.0)

#### 📊 Comprehensive Visit Tracking & Hot Analytics
- **Omnichat Visit Tracking**: Accurately captures and increments visit counts whether you open a link via the bookmark bar, browser history, or direct URL input in the address bar.
- **Multi-Dimensional Dashboard**: Offers interactive bar charts filtered by 24 Hours, 7 Days, 30 Days, 90 Days, 1 Year, Specific Year, or All Time to visually highlight your Top 10 most visited bookmarks.
- **Popup Hot Bookmarks**: Quick-access browser action popup displaying your top-ranked links, smartly ordered by visit points and addition date.

#### ⚡ Smart Folder Auto-Sort Engine
- **Scheduled & Startup Sorting**: Automatically runs background reordering hourly and upon browser launch, with a "Run Sort Now" option for instant manual sorting.
- **Flexible Filter Modes**: Supports **Exclude Mode** (sorts all folders except selected ones) and **Include Mode** (sorts *only* selected folders).
- **Minimal Intervention & Isolation**: Unvisited bookmarks retain their original relative order. Strict child-folder isolation and absolute index alignment ensure nested structures never get mixed up.

#### 🧊 Cold Vault Archiver & Anti-Accidental Deletion
- **Dormant Bookmark Detection**: Automatically scans for bookmarks unvisited for over 30 days and lets you safely move them to the `🧊 BookmarkFlow Cold Vault` folder with a single click.
- **Whitelist Protection**: Star important bookmarks to mark them as **Protected**, exempting them from cold archiving.
- **Cold-Start Protection (Installation Guard)**: Includes a 30-day learning period upon installation to prevent older pre-existing bookmarks from being wrongly flagged as "cold" for new users.

#### ✨ UX & Design Details
- **Smart Title Fallback**: If a bookmark lacks a title, the plugin automatically extracts and formats the domain/path as the title, along with favicon rendering.

---

### 💬 Feedback & Bug Reports
This repository is exclusively used for community support, bug reports, and feature requests. Please feel free to open an issue!

[👉 Submit a Bug Report or Feature Request](https://github.com/avidbyte/bookmarkflow-community/issues)
