# Product Context: XNote Downloader

## 1. Core Philosophy (核心理念)
XNote Downloader 是一款轻量级、零干扰的 Chrome 浏览器扩展。
* **Mission:** 让用户以最少的点击次数（One-Click），保存 X (Twitter) 上的高质量媒体资源，并保护用户免受社区黑名单用户的骚扰。
* **Non-Intrusive:** UI 必须完美融入 X 的原生设计风格（Native Look & Feel），不要像个丑陋的补丁。
* **Privacy First:** 不收集任何用户数据，不上传任何内容到第三方服务器。所有处理都在本地完成。

## 2. Technical Architecture (技术架构)
* **Platform:** Chrome Extension (Manifest V3).
* **Tech Stack:** Vanilla JavaScript (ES6+), HTML, CSS. (无庞大的前端框架，保持体积极小).
* **Target Site:** `https://x.com/*` & `https://twitter.com/*`
* **Backend API:** 云端黑名单 API（用于社区黑名单同步）

## 3. Key Features & Logic (核心功能逻辑)

### A. Media Detection (媒体嗅探)
* **Challenge:** X 是一个高度动态的 React 单页应用 (SPA)。DOM 结构极深且类名也是动态混淆的。
* **Solution:**
    * 必须使用 `MutationObserver` 监听 DOM 变化，探测新的 Tweet 流加载。
    * **定位锚点:** 寻找 `<article data-testid="tweet">` 作为每一个推文的根节点。
    * **Sift Action Bar:** 将操作按钮整合为统一组件，注入到推文底部 Action Bar。

### B. Sift Action Bar (统一操作栏) - NEW
* **设计原则:** 极简、原生感、无干扰
* **按钮布局:**
  * 列表页：⬇️ 打包下载 + 🚫 上报拉黑
  * 详情页主推文：⬇️ 打包下载 + 🚫 上报拉黑 + 📊 评论抓取
* **交互效果:**
  * Hover：圆形蓝色背景蒙版（拉黑按钮为红色）
  * Tooltip：悬停 0.5s 后显示在图标上方
* **暗黑模式:** 自动适配 `prefers-color-scheme: dark`

### C. Zip Package Download (打包下载)
* **功能:** 一键下载推文所有内容
* **包含内容:**
  * `text.txt` - 推文文本
  * `img_{n}.jpg` - 所有图片（原始画质）
  * `video.mp4` - 视频（如有）
* **文件命名:** `Tweet_{username}_{tweetId}.zip`

### D. Community Shield (社群盾牌) - NEW
* **功能:** 社区驱动的黑名单屏蔽系统
* **工作原理:**
  * 定时从云端同步社区黑名单（每 15 分钟）
  * 开启时自动折叠黑名单用户的推文
  * 关闭后立即恢复所有被折叠推文
* **Popup 控制:** iOS 风格开关，实时生效
* **技术实现:** 
  * 使用 `body.xnote-shield-on` class 控制可见性
  * CSS-based 即时切换（无需 DOM 遍历）

### E. Sift Block (上报拉黑) - NEW
* **功能:** 将用户加入本地黑名单 + 上报云端 + 调用 X 内部 API 拉黑
* **三重操作:**
  1. 本地黑名单存储
  2. 云端 API 上报（需 API Key）
  3. X 内部 `blocks/create.json` API 拉黑
* **技术实现:** 通过注入 main world 脚本解决 CORS 和 Cookie 问题

### F. Download Reviews (评论抓取)
* **入口:** 仅在推文详情页主推文显示
* **抓取逻辑:**
  * 自动向下滚动页面
  * 随机等待 1.5-2.5 秒
  * 抓取上限：100 条评论
* **导出格式:** CSV 文件
  * 列：`Username, Date, Text, Likes, Replies_Count, Views`
  * 文件名：`comments_{tweetId}.csv`

## 4. UI/UX Specifications (交互规范)
* **Icon:** SVG 图标，18.75px，线条风格与 Twitter 一致
* **Feedback:** Toast 通知 + 按钮状态变化（loading/success/error）
* **Popup:** 极简设计，250px 宽度，仅一个 Community Shield 开关

## 5. Constraints & Rules (开发红线)
1. **禁止硬编码类名:** 使用属性选择器 (e.g., `[data-testid="reply"]`)
2. **Manifest V3 兼容:** Service Worker + `declarativeNetRequest`
3. **防抖 (Debounce):** `MutationObserver` 必须做 Debounce 处理
4. **Main World 注入:** X Block API 必须在页面主世界执行（解决 CORS）

## 6. Current Roadmap (当前迭代)
* **Phase 1 (MVP):** ✅ 图片下载功能
* **Phase 2:** ✅ 视频下载（Syndication API）
* **Phase 3:** ✅ ZIP 打包下载
* **Phase 4:** ✅ 评论抓取导出（CSV）
* **Phase 5:** ✅ Community Shield（社区黑名单屏蔽）
* **Phase 6:** ✅ Sift Block（上报拉黑 + X API 拉黑）
* **Phase 7:** ✅ Sift Action Bar UI 重构（原生风格图标按钮）
* **Phase 8:** 🔲 多语言支持优化

## 7. File Structure (文件结构)
```
XNoteDownloader/
├── manifest.json      # 扩展配置
├── background.js      # Service Worker（API 调用、下载、黑名单同步）
├── content.js         # 内容脚本（DOM 操作、按钮注入）
├── inject.js          # Main World 脚本（X Block API）
├── styles.css         # 样式（Sift Action Bar、弹窗、Toast）
├── popup.html/js      # 扩展弹窗（Community Shield 开关）
├── i18n.js            # 国际化翻译
└── icons/             # 扩展图标
```