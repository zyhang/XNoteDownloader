# Product Context: XNote Downloader

## 1. Core Philosophy (核心理念)
XNote Downloader 是一款轻量级、零干扰的 Chrome 浏览器扩展。
* **Mission:** 让用户以最少的点击次数（One-Click），保存 X (Twitter) 上的高质量媒体资源。
* **Non-Intrusive:** UI 必须完美融入 X 的原生设计风格（Native Look & Feel），不要像个丑陋的补丁。
* **Privacy First:** 不收集任何用户数据，不上传任何内容到第三方服务器。所有处理都在本地完成。

## 2. Technical Architecture (技术架构)
* **Platform:** Chrome Extension (Manifest V3).
* **Tech Stack:** Vanilla JavaScript (ES6+), HTML, CSS. (无庞大的前端框架，保持体积极小).
* **Target Site:** `https://x.com/*` & `https://twitter.com/*`

## 3. Key Features & Logic (核心功能逻辑)

### A. Media Detection (媒体嗅探)
* **Challenge:** X 是一个高度动态的 React 单页应用 (SPA)。DOM 结构极深且类名也是动态混淆的 (e.g., `css-175oi2r`).
* **Solution:**
    * 必须使用 `MutationObserver` 监听 DOM 变化，探测新的 Tweet 流加载。
    * **定位锚点:** 寻找 `<article data-testid="tweet">` 作为每一个推文的根节点。
    * **Action Bar 注入:** 将下载按钮插入到推文底部的 Action Bar (评论、转发、点赞) 区域中，通常位于 `role="group"` 的元素内。

### B. Image Downloading (图片下载)
* **Source:** 查找推文内的 `<img>` 标签。
* **Resolution:** 必须获取最高分辨率。
    * 通常图片 URL 格式为 `.../name.jpg&name=small`。
    * **Rule:** 必须将 URL 修正为 `.../name.jpg&name=orig` 以获取原始画质。
* **Batch:** 如果推文包含多张图片，点击下载按钮应一次性触发所有图片的下载，或提供 ZIP 打包 (MVP阶段先直接触发多次下载).

### C. Video Downloading (视频下载)
* **Complexity:** X 的视频通常是 `blob:` 链接或 HLS 流 (`.m3u8`)，直接 `src` 可能无法下载。
* **Strategy:**
    * **Plan A (API Interception):** 尝试拦截网络请求或解析 React Props (寻找 `__reactProps` 或类似挂载数据) 来获取 `.mp4` 真实地址。
    * **Plan B (External Service fallback):** 如果本地解析失败，允许通过配置调用第三方解析 API（但在 MVP 阶段尽量做纯本地）。
    * *当前 MVP 策略:* 优先尝试在 DOM 中寻找 `<video>` 标签的 `src`，如果只有 blob，则需解析页面嵌入的 JSON 数据。

### D. File Naming (文件命名规范)
* 自动重命名文件，防止文件名混乱。
* **Format:** `xnote_{username}_{tweetId}_{index}.{ext}`
* *Example:* `xnote_elonmusk_123456789_1.jpg`

## 4. UI/UX Specifications (交互规范)
* **Icon:** 使用简单的 Feather Icon 风格（如下载箭头），颜色需适配 X 的当前主题（Light/Dim/Lights Out 模式自动适应 SVG `fill` 颜色）。
* **Feedback:** 点击后必须有视觉反馈（Loading 状态 -> Success 对钩 / Error 红色感叹号）。
* **Menu:** 点击扩展图标 (Popup) 仅提供简单的开关设置（如：“自动重命名”、“下载位置设置”）。

## 5. Constraints & Rules (开发红线)
1.  **禁止硬编码类名:** 尽量使用属性选择器 (e.g., `[data-testid="reply"]`) 而不是随机生成的 CSS 类名 (e.g., `.r-18jsvk2`)，因为 X 每周都会变类名。
2.  **Manifest V3 兼容:** 所有的后台任务必须在 Service Worker 中处理，禁止使用阻塞型的 `webRequest` API，改用 `declarativeNetRequest` 或在 Content Script 处理逻辑。
3.  **防抖 (Debounce):** `MutationObserver` 触发频率极高，必须对注入逻辑做 Debounce 处理，防止页面卡顿。

## 6. Current Roadmap (当前迭代)
* **Phase 1 (MVP):** 实现图片下载功能（自动替换为 `orig` 画质），按钮成功注入 Action Bar。
* **Phase 2:** 攻克视频下载（解析 MP4 地址）。
* **Phase 3:** 增加 ZIP 打包下载功能。