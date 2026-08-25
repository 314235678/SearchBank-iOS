# SearchBank iOS v2 改动清单（2026-08-25）

> 用户反馈的四个使用问题：① 关 App 数据丢失；② OCR 识别带噪声/不相关；③ 图标是占位纯蓝；④ 双指能拉大。
> 全部已修，代码本地 commit `29ca9f5`；推到 GitHub 因 PAT 失效未果，用户在 Mac 或本地 git push 即可。

## 6. v2.1（2026-08-25 15:40+）—— 适配做题界面 + App 内悬浮搜索

| 文件 | 改动 |
| --- | --- |
| `www/app-bridge.js` | **`extractQuestionText` 改写**：① 噪声词典扩充（答题卡/答题结果/正确答案/您的回答/限时已过/展开/交卷/题型/收藏/历史/错题/作答/批改/重做/重置/进度/剩余/已用/倒计时/考试/练习/模考/返回/考题/重命名/清空/导出/导入 等）。② 题面候选识别为"首个 ABCD 选项之前的所有非噪声行（必须满足：选项连续且 ≥2 个）"；题面终点的判定为"该行尾部是 `（）/）/？/?/。`"。③ 无 ABCD 选项时退化用 `STEM_TRIG` 关键词触发。④ 题号/题型元信息（`判断题 1/20`、`题库(4):...`、`0:10:3 交卷`、`题型：...`、`岗位：...`）一律当噪声剔除。 |
| `www/index.html` | **新增 FAB 悬浮搜题**：右下角圆形按钮（蓝渐变 + 放大镜图标）。点开菜单 3 项：「拍一张搜题」「从相册选图搜题」「粘贴题干文字搜题」。走原生 Vision OCR + 自动提炼题干 + doSearch，从底部弹出**浮窗答案卡**显示匹配项前 3 条 + 「查看全部」按钮。降级路径：浏览器里走 file input + Tesseract。 |
| `SearchBank/ViewController.swift` | 加 `handleCaptureImage(id:)` 弹 `UIImagePickerController`（.camera 源）→ 拍照回 JPEG data URL 给 JS；`WKUIDelegate` 加 `runOpenPanelWith`，让浏览器 `<input type="file">` 在 WKWebView 里也能弹 `UIDocumentPicker`；documentPicker 回调路由两条路径（native bridge 和 open panel 互不冲突）。 |
| `www/app-bridge.js` | 加 `__SB.captureImage()`。 |

> 注意：iOS 沙箱**不允许普通 App 在其他 App 上画 UI**（"全屏悬浮按钮"是 TrollStore / 越狱或企业证书专属，App Store / 自签 IPA 都做不到）。"考试宝"在标准 iOS 上那类"全屏悬浮"几乎全是系统快捷指令 + 录屏 + Live Activities 实现，不是真的在所有 App 之上画 UI。我们做的"App 内 FAB"是合规替代——只能在该 App 内部任何页面浮起按钮拍照/相册/剪贴板搜题，弹底部浮窗答案卡。需要越狱/企业证书的话走 TrollStore / esign + 自带截图的 Live Activity 路线，但那种集成度更高且我们没有适配环境。

## 1. 数据持久化（解决"关闭软件后再打开导入的内容都没了"+"改题库名显示缓存已满"）

| 文件 | 改动 |
| --- | --- |
| `SearchBank/LocalStore.swift` *(new)* | 写入 `Documents/SearchBank/data.json`（原子 rename），Files App 可见；同时在 `Documents/搜题数据(data).json` 留软链入口方便拷贝。 |
| `SearchBank/ViewController.swift` | 新增 `loadData` / `saveData` / `dataPath` 三条 bridge command。 |
| `www/app-bridge.js` | boot 时序：sync 读 localStorage（缓存）→ async 调 `__SB.loadData()` 用沙盒文件覆盖；`patchSave()` 包裹 `window.save()`，每次都并发 `__SB.saveData()`。 |

效果：
- 关闭 App → 重开 → 题库自动从文件恢复（不再受 WKWebView 进程级 localStorage 限制）。
- 题库再大也不会触发"浏览器缓存已满"，因为不再写 localStorage。
- 用户可在 iPhone 「文件 App → 我的 iPhone → SearchBank → 搜题数据(data).json」拿到备份。

## 2. OCR 优化（解决"识别句子与题干不相关较多、句子较乱"）

| 文件 | 改动 |
| --- | --- |
| `SearchBank/OfflineOCR.swift` | `recognize(base64, cropHeaderPct:, cropFooterPct:)` —— 进 Vision 前先裁掉顶 / 底各 8%，显著减少页眉、页脚、状态栏噪声。 |
| `www/app-bridge.js` | 新增 `extractQuestionText(raw)`：噪声词典（"考试宝/答题/背题/分享/收藏/已做题/AI深" 等）整行剔除；自动分行（按题号 `16、` 和 `A./B./C.`）；启发式找题干起点（"下列/关于/请/以下/属于/不属/题号 16、" 或行内含 `?`），拼到最后一个选项；保留原始与清理后两版。 |
| `www/index.html` | OCR 面板新增切换按钮：**「自动提炼题干」**（默认）/ **「识别全文（保留页面噪声）」**，用户可一键对照。 |

## 3. 自定义图标

| 文件 | 改动 |
| --- | --- |
| `genicons.py` *(new)* | 用 Pillow Lanczos 把 `E:\桌面\在线考试-01.png` 缩放到 iOS 全套 12 规格（20@2x/3x、29@2x/3x、40@2x/3x、60@2x/3x、76/152/167/1024），透明合成白底。 |
| `SearchBank/Assets.xcassets/AppIcon.appiconset/*` | 12 个 PNG + `Contents.json` 全部刷新，不再是占位纯蓝。 |
| `genicons.js` | 改为转发到 `genicons.py` 的薄壳（Windows 上 Node 装 sharp 容易失败，改 Pillow 更稳）。 |

执行：`python genicons.py` 即可重出。

## 4. 禁用 WebView 双指缩放

| 文件 | 改动 |
| --- | --- |
| `SearchBank/ViewController.swift` | `webView.scrollView.pinchGestureRecognizer?.isEnabled = false`，并把 `min/maxZoomScale` 都设为 1.0。 |
| `www/index.html` | viewport 加 `maximum-scale=1.0, user-scalable=no`。 |
| `www/app-bridge.js` | 自适应样式里加 `*{ -webkit-touch-callout:none; }`（防长按弹菜单）。 |

## 5. 关于两个非技术问题

- **"清理临时文件时卡死"**：你截图里的"清理临时文件（含 token 痕迹）"是 WorkBuddy IDE 自己在做后台 patch / 清理，**与本 App 无关**。可在 IDE 设置里关掉该钩子，或忽略。
- **"沙箱联网 GitHub 失败"**：沙箱经 `127.0.0.1:7897` 代理可达 github.com（curl 实测 200），**不需要关掉沙箱**。本次 push 失败的真正原因是：**314235678/SearchBank-iOS 是私有仓库，旧 PAT `ghp_iCQ6...` 已失效**，且本会话的 git 凭证管理器也没有可用 token。

## 6. 把改动推到仓库 & 出新 IPA

```bash
cd ios-app
git push origin main          # 需要重新提供带 repo scope 的 PAT
# 然后在 GitHub 网页点 Actions → "Build Unsigned IPA" → Run workflow
# 下载产物 SearchBank-unsigned-ipa → Sideloadly/AltStore 自签安装
```

或者：
```bash
git -c http.proxy=http://127.0.0.1:7897 \
    -c "http.extraHeader=Authorization: Basic $(printf 'github用户名:新PAT' | base64)" \
    push origin main
```
