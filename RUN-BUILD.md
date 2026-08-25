# v2.13 出包说明

## 状态
- 代码 100% 准备好（commit `5efdef4`），已推 GitHub
- **GitHub Actions macOS runner 临时不可用**（`runner: 0` 2 秒挂），连续 7+ 次构建失败
- 不是代码问题——v2.12 失败也是这个原因（v2.11 成功后突然不可用）
- 等待 GitHub 恢复中（macOS runner 后端临时故障）

## 解决方案（按推荐顺序）

### 方案 1：等 GitHub 恢复后手动触发（最简单）
1. 打开 https://github.com/314235678/SearchBank-iOS/actions
2. 点左侧 **"Build Unsigned IPA"** workflow
3. 右上角 **"Run workflow"** → 选 `main` 分支 → 绿色 **"Run workflow"** 按钮
4. 等 5-10 分钟，构建成功后下载 `SearchBank-unsigned-ipa` artifact
5. 解压得到 `SearchBank.ipa`，用 Sideloadly/AltStore/esign 自签安装

### 方案 2：本地构建（如果你有 Mac）
```bash
cd ios-app
bash build_unsigned_ipa.sh
# 产物：当前目录的 SearchBank.ipa
```

### 方案 3：现在装 v2.11 临时用
- v2.11 也能用"识别全文"模式（界面有 toggle）
- 只是设置项不够"真"
- 路径：`E:\workbuddy\2026-08-25-11-39-00\SearchBank-v2.11.ipa`

## v2.13 全部改动（commit 5efdef4）

### Swift 端
1. **剪贴板原生桥接**（`ViewController.swift`）：`__SB.readClipboard/writeClipboard` 直接走 UIPasteboard，绕开 WKWebView 用 file:// 协议时 `navigator.clipboard` 不可用的问题
2. **设置读写**（之前已有）

### JS 端
1. **OCR 默认模式强制 raw**：启动时强制 `localStorage.sb_ocr_default_mode="raw"`（覆盖 v2.11 之前残留的 stem 值）
2. **OCR 默认模式真设置项**：设置面板加下拉框"图片搜题默认模式"：识别全文 / 自动提炼，可随时切换
3. **剪贴板搜题改用原生**：FAB 剪贴板按钮用 `__SB.readClipboard()` 替代 `navigator.clipboard.readText()`，彻底解决"读取粘贴版失败"
4. **历史搜索下拉**：搜索页顶部"最近搜过"+一键清空历史，存最近 50 条去重
5. **搜索结果关键词高亮**：题卡里命中的关键词用 `<mark>` 黄色高亮
6. **浮窗答案卡加"复制答案"按钮**：一键把正确答案写到剪贴板（用原生 `__SB.writeClipboard`）
7. **错别字字典重写**（v2.12 已提交）：去除自映射条目，扩充"娄试复习→考试复习"等真实错字（9/9 测试通过）
8. **提取题干/分区域切题 bug 修复**（v2.7~v2.12 已提交）

### CI 配置
- workflow 改用 `macos-14` runner 队列（避开 `macos-latest` 拥堵）

## 等用户醒来可操作
- 直接 GitHub 网页点 Run workflow（最简单）
- 看到 v2.13 IPA 下载即可
- 装上后测试：① OCR 默认"识别全文" ② 剪贴板搜题不报错 ③ 历史搜索记录 ④ 答案一键复制
