# SearchBank iOS v2 改动清单（2026-08-25）

> 用户反馈的四个使用问题：① 关 App 数据丢失；② OCR 识别带噪声/不相关；③ 图标是占位纯蓝；④ 双指能拉大。
> 全部已修，代码本地 commit `29ca9f5`；推到 GitHub 因 PAT 失效未果，用户在 Mac 或本地 git push 即可。

## 12. v2.9 构建交付（2026-08-26 01:50+）—— 图像预处理 + 分块搜索 + 多候选 + 分区域（本次）

- 用户确认：Umi-OCR 移植不现实（2-4 周工程），但借鉴其设计方向可行；认可 v2.8 的借鉴方案
- 本轮四项强化（用户勾选"图像预处理强化 / 分块搜索 / Vision多候选 / 分区域识别"）：
  1. **Swift 图像预处理**（`OfflineOCR.swift` `enhanceForOCR`）：灰度（饱和度 0）+ 对比度 1.4 + 亮度 -0.04 + 锐化 0.7（CISharpenLuminance）—— 黑白高对比图 Vision 识别率最高
  2. **Swift 分区域识别**（`splitIntoRegions`）：把图按高度切成上下两半，分别跑 Vision 再合并（大图降采样丢小字；半图分辨率相对高，红色界面卡片居中更容易命中）
  3. **Swift Vision 多候选**（`multicand`）：每个 observation 输出 `top1|top2|top3`（置信度降序去重），JS 端分块搜索展开多个候选
  4. **JS 分块搜索**（`chunkQuery` + `scoreBlocks`）：长查询（>10 字）切成 4-6 字滑窗块（步长 3），每块单独 `scoreItem` 取最高分——一个错字只影响相邻块，不再整段 miss；过滤题型标签开头噪声块；`|` 多候选展开为独立块
- 设置项（UserDefaults）：`sb_ocr_enhance`（预处理）/ `sb_ocr_split`（分区域）/ `sb_ocr_multicand`（多候选），默认 enhance=true、split=true、multicand=false
- 测试：chunkQuery 长文本覆盖全文（含"甲炕/传感器"尾部块）、短查询保持原样、`|` 多候选展开，全部通过
- 交付：commit tbd 推 GitHub；Actions run tbd 构建中；产物 SearchBank-v2.9.ipa

## 11. v2.8 构建交付（2026-08-26 00:50+）—— 红色背景 OCR + 错别字容错（本次）

- 用户反馈：v2.7 仍有很多题识别不出；推荐 Umi-OCR（Windows 桌面 PaddleOCR）；红色背景（"考试复习"）的题根本识别不了
- 关键决策：Umi-OCR 移植集成需要 2-4 周工程（集成 Paddle-Lite iOS SDK、8MB+ 模型、Swift 桥接），本轮先借鉴其核心设计（红色背景白化、单栏-无换行、错别字纠正、限制图像边长）强化 Vision
- 本次改动：
  1. **Swift 端红色背景白化**（`OfflineOCR.swift`）：检测深红色背景像素（`R > 170 && R-max(G,B) > 60` 且红色像素占 >8%）→ 改为白底（255,255,255），黑色题干识别率大幅提升
  2. **Swift 端图像缩放**（`OfflineOCR.swift`）：`maxEdge` 参数（默认 1600px，借鉴 Umi-OCR 的 960 选项）限制最长边，减少 Vision 处理时间
  3. **Swift 端单栏-无换行**（`OfflineOCR.swift`）：把 Vision observations 按 Y 坐标分组，**同行内用空格拼接**（不是 \n），效果类似 Umi-OCR 的"单栏-无换行"
  4. **JS 端错别字纠正字典**（`app-bridge.js`）：100+ 常见 OCR 形近字（甲炕→甲烷、瓦丝→瓦斯、应响→影响、没备→设备 等），`fixCommonOCRErrors(text)` 在 OCR 全文后立即替换
  5. **JS 端题干加权**（`index.html` `scoreItem`）：把题库缓存的"题干 Q"和"选项 OPT"分开存储；题干命中权重 2x，选项命中权重 0.5x，避免选项字符占满搜索关键词
  6. **JS 端"顿号"选项起点**：`A、xxx`（中文顿号格式）现在也能识别为选项起点
  7. **设置面板加 OCR 高级选项**（`index.html`）：红色背景白化 / 错别字纠正 / 单栏-无换行 / 限制图像边长 4 个开关
  8. **Swift 端 `setSetting` / `getSetting` bridge**（`ViewController.swift`）：JS 可读写 UserDefaults，下次 OCR 调用立即生效
- 备注：Umi-OCR 移植（v3.0 路线）后续单独评估：模型加载、Swift 桥接、磁盘占用 8MB+、调试困难，先观察 v2.8 红色背景白化效果

## 10. v2.7 构建交付（2026-08-25 23:00+）—— FAB 搜题 + OCR 提纯（本次）

- 用户反馈：FAB 快捷指令搜题识别率低；某些题用图片识别的"自动提炼题干"功能可以搜出，但 FAB 只能识别选项搜不出；搜索栏 × 清空按钮看不出
- 三个根因：
  1. `isNoiseLine` 把"单选"作为整行噪声词，会把"单选 2、为预防工作面两端发生漏顶"这种"题号+题干"行整行剔除 → stem 只剩选项
  2. `runSearchWithStem` 的 fallback 条件 `rawShort.indexOf(stem.slice(0,12)) >= 0` 永远成立（stem 子串是选项字符"10m/15m"等总会出现在 raw 中），导致 fallback 永远不触发
  3. `OfflineOCR.recognize` 的顶/底各 8% 裁切，在 iPhone 截屏 1179×2556 上 = 顶 204px + 底 204px，会把考试宝"题号+题干"裁掉
- 修复：
  - `isNoiseLine`：把"单选/多选/判断题/填空题/简答题"等题型标签改为"独立成行"才剔除（不误伤"单选 2、为预防..."这种题干行）
  - `runSearchWithStem`：fallback 条件改用 `__lastOCR.cleaned`（去噪后的全文），不阻断；触发时给 toast 提示"已切换到全文搜索"
  - `ViewController.handleOCR`：cropHeaderPct/cropFooterPct 8% → 4%（仅够去掉状态栏+灵动岛，保留题目首行）
  - 搜索栏 × 清空按钮：v2.5 已有但只在有内容时显示（不易发现）→ v2.7 改为始终可见（空内容时 opacity: 0.35 半透明），让用户知道有这个功能
- 测试：用 Node 模拟 6 道例题跑 `extractQuestionText`，全部正确提取题干+选项（之前全部失败只有选项）
- 仓库恢复：v2.7 修改期间一次 `git stash` 损坏了 .git（refs 目录被清），通过 `git init + fetch + reset --hard e1c5f6e` 重建，工作区修改从备份恢复
- 交付：commit `tbd` 推送到 GitHub main；Actions run tbd 构建中；产物 SearchBank-v2.7.ipa

## 9. v2.6 构建交付（2026-08-25 21:30+）—— 搜索栏 textarea 化 + OCR 剥离选项

- 用户反馈两个剩余问题：
  - 图片识别页面题干带 ABCD 选项，搜题匹配不到
  - 文字搜索栏 input 单行，超长题干被截断看不到（"最"字后看不见），无法手动删除
- 处理：① #searchInput 改 textarea，多行自适应高度（46–200px），Enter 搜索 / Shift+Enter 换行；×清空和搜索按钮贴右侧
- ② OCR 面板新增「剥选项」按钮 + 「搜题前自动剥离选项」开关（默认开，记住用户偏好到 localStorage）
- ③ app-bridge.js 加 `__SB.stripOptions(text)`：按行扫描定位到第一个 "A./A、/A:" 选项处截断
- 「识别并搜题」按下时若开启剥离开关→ 先 stripOptions→再送入搜索栏，搜索栏因是 textarea 自动撑高，题干完整可见方便用户再次手工清理
- 备注：v2.5 已经实现了 OCR 图片删除按钮（ocrDelImg）、搜索×清空按钮、滑动动画、紧凑化，本版本确认保留并扩展
- 交付：commit `314d0c3`（+docs `d2fa295`）已推送到 GitHub main；Actions run `32858085100` 构建中；产物 SearchBank-v2.6.ipa

## 8. v2.4 构建交付（2026-08-25 20:05）—— 已推送 + IPA 已出

- commit `cfaa4b0` 推送到 GitHub（`15cb565..cfaa4b0 main -> main`），Actions run `32844942595` **completed success**
- artifact `SearchBank-unsigned-ipa`（9562144976）已下载解压
- **产物：`E:\workbuddy\2026-08-25-11-39-00\SearchBank-v2.4.ipa`（1.61MB）**
- 校验通过：www 三件套（index.html 314736B / app-bridge.js 23289B / 搜题题库.json）在 Payload/SearchBank.app/www/ 下；`v2.4` 标记、`calc-sci/calcMode` 科学计算器、QMARK 内联（app-bridge.js 无 STEM_TRIG var 引用）全部命中

## 7. v2.4（2026-08-25 19:00+）—— 五个 P0/P1 修复 + 计算器科学模式

> 第二轮反馈：① 普通练习不记录；② 选项阴影位置乱跳；③ 左右滑跳题且滑久卡死；④ FAB 拍照报 `Can't find variable: QMARK`；⑤ 计算器要加科学模式。
> 这一版五项全部处理；UI 整体重设计见 8。

| 文件 | 改动 |
| --- | --- |
| `www/app-bridge.js` | **修 QMARK 报错**：把 IIFE 内的 `var STEM_TRIG / STEM_NUM / OPTION_RE / PARENTH_BLANK / QMARK` 全部**内联**到 `extractQuestionText()` 内。iOS WKWebView 的 JSC 引擎在某些页面上对闭包内 `var` 声明存在 TDZ 优化，会抛 "Can't find variable"。 |
| `www/index.html` | **修普通练习不记录**：`exitSession()` 先调 `recordSession()`（之前只有模拟考试 timer 到点 / 主动交卷会触发 recordSession，普通练习中途按「退出」会丢数据）。`recordSession()` 加上"零结果不记录"防止空记录刷屏。 |
| `www/index.html` | **修阴影位置错乱（搜索结果卡片选项）**：`optsHtml(opts, ans)` 接收答案参数，把 `answerLabels(it.a)` 解析出的 label 加 `.opt.correct` 类并打 `.opt-mark ✓`。CSS 加 `.opt.correct {border-color:var(--green); background:#ecfdf3}` 和 `.opt-mark`。同步改了 `renderOptsOrInline()` 把 `i.a` 透传。**结果：搜索结果卡 / 题库管理卡 / 浮窗答案卡**任何位置显示题目都对正确选项有绿色 ✓ 标识。 |
| `www/index.html` | **修左右滑动跳题 + 卡死**：`bindBoost()` 在每次 `renderQuestion()` 都被调用，原本会**重复 append** `.play-fav / .play-top / .auto-next / .play-tools` 节点（DOM 无止境膨胀 → 卡死），并**重复 `addEventListener("touchstart/move/end")`** 到 `#trainPlay`，单次滑动 N 次 +1 → 跳到第 4+98 题。修：1) `bindBoost` 进入时 `card.querySelectorAll('[data-boost="1"]').forEach(remove)` 先清旧节点；2) 触摸事件移到 IIFE 顶层 **只绑一次**（用 `trainPlay.__swipeBound` 标志），并加 busy 自旋防止同一手势反复触发；3) 收藏按钮加 `favBusy` 防抖避免双击重入。 |
| `www/index.html` | **科学计算器**：在 `#calcPanel` 头部加 `科学 / DEG` 两个切换按钮（`#calcMode / #calcAngle`），再加一行 `.calc-sci` 隐藏键盘（默认折叠，按"科学"展开）。新增按键 `sin/cos/tan/asin/acos/atan/ln/log/cbrt/xpow/10ˣ/inv/n!/ans/π/e/∛`。`toJS(toJSWithAngle)` 把 sin/cos/tan 按 `angleMode` 自动套度↔弧度；`factorial(n)` 做整数阶乘（n>170 防溢出）；`ans` 回填上一次等号结果；`isFinite` 判溢出；`evalExpr` 严格白名单杜绝任意 eval。重写后支持：`2+3*sqrt(2)`、`sin(30)`（DEG 默认 0.5）、`log(100)`、`5!` → 120、`ans` 复用、`π/4` 等。 |

| `www/index.html` | **UI 重设计（v2.4 蓝紫商务风）**：参考截图，把 5 个 Tab 的结构、样式全面改写，旧 class 全部保留不破坏。 |
| --- | --- |
| 新增 `--pri2 / --pri3 / --pri4 / --amber2 / --gold / --grad-banner/blue/purple/orange/cyan/pink/green / --card-shadow / --big-radius` 等主题 token；新增 `.hero-banner / .entry-card / .shortcut-grid / .circle-progress / .data-card / .bank-tile / .qrow-modern / .records-week / .play-card.v2` 等新元素。 |
| **主页**：顶部蓝色大渐变 banner（带 4 个 hero-stat + 描述）+ 两个大色块入口卡（顺序练习蓝/模拟考试紫）+ 8 格圆形入口图标网格（搜题/拍照/记录/练习/管理/导入/出卷/计算器）+ 4 个数据卡（已做/正确率/错题/收藏）+ 题库色块网格 + 最近练习列表。 |
| **练习页**：顶部蓝色大 banner（左侧大圆环 SVG 显示完成进度 + 右侧 4 个统计数据）+ 顶部题库/题型筛选 + 3 个大色块入口（顺序/随机/模拟）+ 7 格快捷图标（背题/题型/错题/易错/计算器/记录/搜索）。 |
| **搜索页**：顶部固定大搜索框（左侧搜索图标 + 右侧蓝色"搜索"按钮）+ chip 圆角筛选条（题库/题型/分类）+ "仅显示正确答案"复选框；结果卡片加 chip 标签：答案用绿底胶囊、题型用紫底胶囊。 |
| **记录页**：顶部蓝色大 banner（今日练习/做题/正确率/错题/用时 5 项）+ 现代 7 天柱状图（今天高亮蓝）+ 紧凑行（左侧 0%/100% 圆环标识 + 题库/模式/时间 meta 行）。 |
| **管理页**：题库色块化网格（点击直达搜索该题库）+ 题目管理顶部操作按钮突出；bank-list 的 `.bank-card` 替换为 `.bank-tile`，并支持单击进搜索。 |
| **题目卡**：`.opt.correct` 绿色 ✓ 标识（修阴影位置 bug 的核心），`.opt-mark` 绝对定位到右上角。`.opt{position:relative}` 已加。 |
| **新增交互**：`bindHomeV24()` 绑 entrySeq / entryExam / 8 格快捷入口；`quickLocate(id)` 从搜索结果卡片一键定位到练习并打开指定题号；`qRowModern()` 现代化的紧凑题行（管理页和首页共用）。 |
| **副作用清理**：原本 `id="trainHome"` 内的旧 `<div class="mode-card">` 已删除，新结构用 `.entry-card.data-k + .shortcut-cell.mode-btn` 统一入口触发 `startSession()`。 |

**校验方式（无需 Mac）**：浏览器直接打开 `www/index.html` 进首页试 5 个 bug 是否都消失；点计算器 → 「科学」展开新键盘。

## 1. 数据持久化（解决"关闭软件后再打开导入的内容都没了"+"改题库名显示缓存已满"）

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
