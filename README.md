# 搜题平台 · iOS App（离线搜题 + 离线 OCR）

把网页版「搜题平台」完整移植到 iPhone/iPad 的原生 App：用 WKWebView 承载网页版全部功能，
通过原生桥接补充 **离线文字识别（OCR）**、**本地文件导入**、**导出分享**，并按设备性能做自适应界面。
全部功能离线可用（首次中文 OCR 需联网下载一次语言模型）。

---

## 一、关于网页版 `.json` 导出（已核实 ✅）

已对网页版 `搜题平台.html` 的导出逻辑做静态 + 运行时级验证：

- 网页版两处导出（顶部「导出备份」按钮、`exportJSON()` 下载到本地）均序列化 **完整的 `DATA` 对象**：
  `JSON.stringify(DATA, null, 2)`，其中 `DATA = { items: [...题目], banks: [...题库] }`。
- 实测网页版导出的题库文件含 **6,465 道题目 + 1 个题库（约 3.31 MB）**，格式为
  `{ "items": [...], "banks": [...] }`，与手机端导入解析逻辑（`d.items && Array.isArray(d.items)`）完全一致，
  往返导入不丢字段。

**结论：网页版 `.json` 导出已包含完整题库数据，导出逻辑无需修复，手机端可直接导入使用。**

> 仓库内 `2026-08-23-17-55-30/搜题题库.json` 即网页版完整题库样例，已随本工程打包进 `www/搜题题库.json`，
> App 首次启动会自动载入（离线可用）。

---

## 二、目录结构

```
ios-app/
├── project.yml                # XcodeGen 工程定义（生成 .xcodeproj）
├── build_www.js               # 由网页版生成 www/index.html 的脚本（已执行）
├── genicons.js                # 生成 AppIcon 的脚本（已执行）
├── SearchBank/
│   ├── AppDelegate.swift      # 应用入口（UIKit 生命周期）
│   ├── ViewController.swift    # WKWebView + 原生桥接 messageHandler
│   ├── OfflineOCR.swift        # Vision 离线 OCR（中文/英文）
│   ├── DeviceInfo.swift        # 设备性能分级（low/mid/high）
│   ├── Info.plist             # 权限声明（相机/相册/文件分享）
│   └── Assets.xcassets/        # 应用图标（占位蓝，可替换为设计稿）
└── www/                       # 网页版（完整功能）
    ├── index.html             # 由搜题平台.html 注入桥接脚本生成
    ├── app-bridge.js          # JS↔原生 桥接层（OCR/导入/导出/自适应）
    └── 搜题题库.json           # 包内自带题库（首次启动自动载入）
```

---

## 三、在 Mac 上构建并签名（使用你已有的苹果证书）

> ⚠️ 本工程在 Windows 环境产出源码，无法在此直接编译/签名 IPA；请在你的 Mac 上完成以下步骤。

### 方式 A：用 XcodeGen（推荐，工程由工具正确生成）
```bash
brew install xcodegen
cd ios-app
xcodegen generate                 # 生成 SearchBank.xcodeproj
open SearchBank.xcodeproj
```
在 Xcode 中：
1. 选中 Target **SearchBank** → **Signing & Capabilities**；
2. **Team** 选择你已有的苹果开发者证书（个人/企业/公司均可，自动签名）；
3. 如需固定 Bundle ID，改 `project.yml` 里的 `PRODUCT_BUNDLE_IDENTIFIER`（默认 `com.searchbank.app`）；
4. 连接 iPhone → ▶ 运行；或 **Product → Archive → Distribute App** 导出 `.ipa`
   （分发方式取决于你的证书类型：Ad Hoc / 企业 / TestFlight）。

### 方式 B：手动建工程（无 xcodegen 时）
Xcode → New Project → App（Interface: Storyboard 可留空，Life Cycle 选 UIKit）→
把 `SearchBank/*.swift` 拖入工程，把 `www/` 整个文件夹「Create folder references」拖入，
在 Build Settings 指定 `INFOPLIST_FILE = SearchBank/Info.plist`、`ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`，再按方式 A 第 2–4 步签名。

---

## 四、功能对照（网页版 → 手机端）

| 网页版功能 | 手机端实现 |
|---|---|
| 题库搜索（关键字/分类/题型） | 同网页，完全离线（数据在本地） |
| 题库管理、查重、编辑、删除 | 同网页 |
| 练习 / 错题 / 掌握标记 | 同网页 |
| 出试卷 + Word 导出 | 同网页（纯 JS 生成 .docx，离线） |
| 导入 .docx/.xlsx/.csv 题库 | 原生「文件」选择器（UIDocumentPicker），复用网页解析 |
| 导入网页版导出 `.json` | 原生「文件」选择器 → 合并题库 |
| 图片识别搜题（OCR） | **原生 Vision 离线识别**（中文/英文），替代网页的 Tesseract/OCR.space |
| 导出备份 | 系统分享面板（保存/隔空投送/微信等） |
| 设备自适应 | 原生上报性能分级，网页端自动调整动画/阴影/密度 |

---

## 五、离线 OCR 说明

- 使用 iOS 原生 **Vision** 框架的 `VNRecognizeTextRequest`，全部在设备端运算，不联网、不上传图片。
- 支持 `zh-Hans / zh-Hant / en`，开启语言纠错。
- **首次**使用中文识别时，系统会一次性下载中文语言模型（约数十 MB，需联网）；之后完全离线。
- 识别结果回填到「识别出的文字」框，点「识别并搜题」即在本地题库中检索。

---

## 六、导入说明（手机端）

- 点网页内的「导入恢复」（.json）或「导入题库」拖放区（.docx/.xlsx/.csv），
  手机端会弹出 iOS「文件」选择器，从 iCloud/本机/网盘选取文件。
- `.json`：合并进当前题库（与网页版导出格式一致）。
- `.docx/.xlsx/.csv`：复用网页版既有解析（含查重预览、按题型比对），导入本地题库。
- 浏览器中打开 `www/index.html` 时，桥接层自动降级为原网页逻辑（Tesseract / OCR.space / 系统文件框），
  行为与网页版一致。

---

## 七、已知限制 / 下一步

- 图标为占位纯色，发布前请替换为正式设计稿（替换 `Assets.xcassets/AppIcon.appiconset`）。
- IPA 分发方式取决于你的证书类型（个人证书仅能装已注册设备；企业证书可广部署；TestFlight 需上架审核）。
- 如需把网页版后续改动同步到手机端，重新运行 `node build_www.js` 即可（会重新注入桥接脚本）。
- 如网页版后续新增功能，只要仍是同一套 `DATA` 结构与函数名，桥接层无需改动即可生效。

---

## 八、在 Windows 上如何拿到 IPA（用 GitHub Actions 自动编译）

> 关键点：IPA 里必须有一个**为 iOS(arm64) 编译好的原生二进制**，而这只能在 macOS + Xcode 工具链下完成。
> 本机是 Windows，无法在这里直接编出可运行的 IPA。但已把整套编译流水线准备好——
> 推到 GitHub 后，由 GitHub 的 macOS 免费构建机自动编译出**未签名 IPA**，你下载后在手机上自签即可。

### 步骤
1. 在 GitHub 新建一个**私有或公开**仓库。
2. 把本 `ios-app/` 目录全部推上去（已含 `project.yml`、原生代码、`www/`、构建脚本，**无需** `node_modules`）：
   ```bash
   cd ios-app
   git init
   git add -A
   git commit -m "SearchBank iOS app"
   git branch -M main
   git remote add origin https://github.com/<你的账号>/<仓库名>.git
   git push -u origin main
   ```
3. 进入仓库 → **Actions** → 找到 **Build Unsigned IPA** → **Run workflow**（手动触发；push 到 main/master 也会自动触发）。
4. 构建完成后，在 **Actions → 该次运行 → Artifacts** 里下载 `SearchBank-unsigned-ipa`（即 `SearchBank.ipa`）。

> 说明：构建机是 `macos-latest`（自带 Xcode），脚本 `build_unsigned_ipa.sh` 会执行
> `xcodegen generate` + `xcodebuild archive CODE_SIGNING_ALLOWED=NO`，产出**未签名** IPA，不依赖任何证书。

### 如果你手边有 Mac（更快，免上传）
直接在 Mac 终端跑：
```bash
cd ios-app
bash build_unsigned_ipa.sh     # 产出 SearchBank.ipa（未签名）
```
或走「三、方式 A」用 Xcode 直接 Archive 并选你已有的证书签名（那会得到**已签名** IPA）。

---

## 九、在手机上自签安装（无需 Mac 证书）

下载到的 `SearchBank.ipa` 是**未签名**的，用下面任一工具、用你的 Apple ID 在手机端自签即可：

| 工具 | 平台 | 简要流程 |
|---|---|---|
| **AltStore** | 手机端 App（需配合电脑端 AltServer 一次性注入） | 手机打开 AltStore → My Apps → `+` → 选 `SearchBank.ipa` → 输入 Apple ID 自签 |
| **Sideloadly** | Windows / macOS 桌面软件 | 打开 Sideloadly → 拖入 `SearchBank.ipa` → 填 Apple ID → Start |
| **esign** | 手机端 App（无需电脑） | 导入 `SearchBank.ipa` + 你的 `.p12` 证书与 `.mobileprovision` → 签名 → 安装 |
| **TrollStore** | 手机端（仅限受支持 iOS 版本，免签） | 把 `SearchBank.ipa` 用 TrollStore 打开直接安装 |

注意事项：
- **免费 Apple ID**：自签应用有效期约 **7 天**，过期后重新自签一次即可（数据在 App 沙盒内会保留，只要 Bundle ID 不变）。
- **付费开发者账号**：有效期 1 年；用 esign/Sideloadly 时可导入你自己的证书与描述文件。
- **Bundle ID 唯一性**：免费账号建议改成你自己的标识（如 `com.<你的名>.searchbank`），可在 `SearchBank/Info.plist` 的
  `CFBundleIdentifier`，或 `project.yml` 的 `PRODUCT_BUNDLE_IDENTIFIER` 里改；多数自签工具也支持导入时覆盖。
- 安装后首次打开「拍照/相册搜题」会请求相机/相册权限；首次中文 OCR 会联网下载一次语言模型，之后完全离线。
