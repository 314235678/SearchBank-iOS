import UIKit
import WebKit
import UniformTypeIdentifiers
import PhotosUI
import Photos

/// 搜题平台 iOS 外壳：用 WKWebView 承载网页版全部功能，
/// 通过名为 "bridge" 的 WKScriptMessageHandler 与网页 JS 通信，
/// 提供：离线 OCR（Vision）、文件导入（DocumentPicker）、系统相册选图（PHPicker）、
///       拍照（UIImagePickerController）、导出分享、本地数据持久化
///       （LocalStore → Documents/SearchBank/data.json）、设备分级。
class ViewController: UIViewController,
                      WKScriptMessageHandler,
                      UIDocumentPickerDelegate,
                      UINavigationControllerDelegate,
                      UIImagePickerControllerDelegate,
                      PHPickerViewControllerDelegate {

    private var webView: WKWebView!
    private var documentPickerResolve: (([[String: Any]]) -> Void)?
    private var cameraResolve: ((String?) -> Void)?
    private var openPanelResolve: (([URL]?) -> Void)?
    private var photoPickerResolve: ((String?) -> Void)?

    // 收到 URL scheme 唤醒（NotificationCenter 由 AppDelegate.post 触发）
    private var pendingOpenURL: String?

    /// 超过这个大小的 JSON 备份改走「沙盒暂存 + 分块读取」，
    /// 避免把 ~10MB 的 base64 一次性塞进 evaluateJavaScript（慢且可能静默失败）。
    static let importStageThreshold = 3 * 1024 * 1024

    // MARK: - WebView 配置与加载

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        controller.add(self, name: "bridge")
        config.userContentController = controller
        if #available(iOS 15.4, *) {
            config.preferences.isTextInteractionEnabled = true
        }

        webView = WKWebView(frame: .zero, configuration: config)
        // 用 ObjC shim 处理 <input type=file>，其他 uiDelegate 转回 self
        // 原因：WKOpenPanelParameters 是 forward-declared，Swift 引用会编译失败
        let shim = OpenPanelShim(presenter: self, backend: self)
        objc_setAssociatedObject(webView, "openPanelShim", shim, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        webView.uiDelegate = shim
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = true
        webView.allowsLinkPreview = false

        // ✅ 禁止双指缩放 / 双击放大：让它像真正 App 而不是浏览器
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.scrollView.minimumZoomScale = 1.0
        webView.scrollView.maximumZoomScale = 1.0

        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }

    /// 定位包内网页资源根目录。
    /// 正常布局：SearchBank.app/www/（文件夹引用）。
    /// 兼容布局：部分 Xcode/XcodeGen 组合会把 www 扁平化复制，
    /// 使 index.html 等文件直接平铺在 SearchBank.app/ 根目录，这里做兜底。
    private var wwwRoot: URL? {
        if let www = Bundle.main.url(forResource: "www", withExtension: nil) {
            return www
        }
        if Bundle.main.url(forResource: "index.html", withExtension: nil) != nil {
            return Bundle.main.resourceURL
        }
        return nil
    }

    private func loadApp() {
        guard let www = wwwRoot else {
            showFatal("找不到 www 资源目录")
            return
        }
        let index = www.appendingPathComponent("index.html")
        // v2.17：清除 WKWebView 缓存 + URL 加 ?v= 强制重新加载（v2.15→v2.16 时用户装新 IPA 但页面还是旧的）
        URLCache.shared.removeAllCachedResponses()
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { _ in }
        webView.configuration.websiteDataStore.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
            for r in records {
                WKWebsiteDataStore.default().removeData(ofTypes: r.dataTypes, for: [r], completionHandler: {})
            }
        }
        let indexURL = URL(string: "file://\(index.path)?v=2.17&t=\(Int(Date().timeIntervalSince1970))")!
        webView.loadFileURL(indexURL, allowingReadAccessTo: www)
    }

    private func showFatal(_ msg: String) {
        let label = UILabel()
        label.text = msg
        label.textColor = .secondaryLabel
        label.textAlignment = .center
        label.frame = view.bounds
        view.addSubview(label)
    }

    // 页面加载完成后，把设备分级信息注入 JS（window.__SB.device）
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let js = "window.__SB = window.__SB || {}; window.__SB.device = \(DeviceInfo.snapshotJSON());"
        webView.evaluateJavaScript(js, completionHandler: nil)
        // 消费此前可能已收到的 URL scheme 唤醒（冷启动场景）
        if let pending = pendingOpenURL {
            consumeOpenURL(pending)
            pendingOpenURL = nil
        }
    }

    // 收到 URL scheme 唤醒（NotificationCenter 由 AppDelegate.post 触发）
    // (pendingOpenURL 属性已声明在 class 顶部)

    override func viewDidLoad() {
        super.viewDidLoad()
        setupWebView()
        // 启动时确保 Documents 下的 data.json 在 Files App 可见
        LocalStore.ensureFinderVisible()
        // 监听 URL scheme 唤醒
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleOpenURL(_:)),
            name: .searchBankOpenURL, object: nil)
        loadApp()
    }

    @objc private func handleOpenURL(_ note: Notification) {
        guard let s = note.userInfo?["url"] as? String else { return }
        // WebView 还没就绪就先存起来，等 didFinish 再消费
        if webView == nil {
            pendingOpenURL = s
        } else {
            consumeOpenURL(s)
        }
    }

    /// 把 URL 注入到 JS 端做处理：
    ///   searchbank://fab-camera   → 触发 FAB 拍照
    ///   searchbank://fab-album    → 触发 FAB 相册
    ///   searchbank://fab-clip     → 触发 FAB 剪贴板
    ///   searchbank://search?q=... → 直接搜题
    private func consumeOpenURL(_ urlStr: String) {
        // 简单转义后内联进 JS
        let escaped = urlStr
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        let js = "if(window.__SB && window.__SB.handleDeepLink){window.__SB.handleDeepLink('\(escaped)');}else{window.__SB.__pendingURL='\(escaped)';}"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - WKScriptMessageHandler（JS -> 原生）

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let type = body["type"] as? String else { return }
        let payload = body["payload"] as? [String: Any] ?? [:]

        switch type {
        case "ocr":
            handleOCR(id: id, payload: payload)
        // v3.0：带坐标+置信度的离线 OCR（网页的"按坐标重排/低分块标黄"要用）
        case "ocrBlocks":
            handleOCRBlocks(id: id, payload: payload)
        case "pickFiles":
            handlePickFiles(id: id)
        // v3.0.1：分块读取「待导入备份」（大 JSON 不走 base64 的那条路）
        case "readImportChunk":
            handleReadImportChunk(id: id, payload: payload)
        case "shareExport":
            handleShareExport(id: id, payload: payload)
        // v3.0：二进制导出（试卷 docx）走系统分享
        case "shareBinary":
            handleShareBinary(id: id, payload: payload)
        // v3.0：在 Safari 里打开外链（网页的 aiBridge.openExternal）
        case "openExternal":
            handleOpenExternal(id: id, payload: payload)
        // v3.0：AI 通道（原生 URLSession，绕开 CORS）
        case "aiAsk":
            handleAIAsk(id: id, payload: payload)
        case "aiChat":
            handleAIChat(id: id, payload: payload)
        case "aiProof":
            handleAIProof(id: id, payload: payload)
        case "aiRecognize":
            handleAIRecognize(id: id, payload: payload)
        case "getBundledBank":
            handleBundledBank(id: id)
        case "loadData":
            handleLoadData(id: id)
        case "saveData":
            handleSaveData(id: id, payload: payload)
        case "dataPath":
            handleDataPath(id: id)
        case "captureImage":
            handleCaptureImage(id: id)
        case "pickImage":
            handlePickImage(id: id)
        case "pickLatestPhoto":
            handlePickLatestPhoto(id: id)
        case "processURL":
            // URL scheme 唤醒参数处理：JS 端只需要 acknowledge
            handleProcessURL(id: id, payload: payload)
        case "setSetting":
            handleSetSetting(id: id, payload: payload)
        case "getSetting":
            handleGetSetting(id: id, payload: payload)
        // v2.13：原生剪贴板桥接（WKWebView 用 file:// 协议时 navigator.clipboard 不可用）
        case "readClipboard":
            handleReadClipboard(id: id)
        // v3.0.2：剪贴板富探测（changeCount 门控，支持文本与图片）
        case "readClipboardRich":
            handleReadClipboardRich(id: id, payload: payload)
        case "writeClipboard":
            handleWriteClipboard(id: id, payload: payload)
        default:
            respond(id: id, result: ["error": "unknown type: \(type)"])
        }
    }

    // 把结果回传给 JS：window.__SB.__onNative(id, result)
    private func respond(id: String, result: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let str = String(data: data, encoding: .utf8) else {
            webView.evaluateJavaScript("window.__SB.__onNative('\(id)', {error:'json-encode'});", completionHandler: nil)
            return
        }
        let js = "window.__SB.__onNative('\(id)', \(str));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - 本地数据持久化（取代 localStorage）

    /// JS 启动时调用：拿本地 data.json（不存在返回空串，让前端走 seed）。
    private func handleLoadData(id: String) {
        let text = LocalStore.read() ?? ""
        respond(id: id, result: ["text": text])
    }

    /// JS 改完题库后调用：原样写回 Documents/SearchBank/data.json。
    private func handleSaveData(id: String, payload: [String: Any]) {
        guard let text = payload["text"] as? String else {
            respond(id: id, result: ["error": "缺少 text"])
            return
        }
        let ok = LocalStore.write(text)
        if ok { LocalStore.ensureFinderVisible() }
        respond(id: id, result: ok ? ["ok": true] : ["error": "写入失败"])
    }

    /// JS 调试用：拿到 App 沙盒下文件的真实路径（提示用户）。
    private func handleDataPath(id: String) {
        let path = LocalStore.dataFileURL().path
        respond(id: id, result: ["path": path])
    }

    // MARK: - 离线 OCR（Vision，全程本机，支持中文）

    private func handleOCR(id: String, payload: [String: Any]) {
        guard let b64 = payload["base64"] as? String else {
            respond(id: id, result: ["error": "缺少 base64"])
            return
        }
        // 【v2.7】让 Swift 端做裁切：去掉顶部/底部各 4%（仅够去掉状态栏+灵动岛+底部小白条），
        //   之前 8% 在 iPhone 截屏上会把"题号"和题干首行裁掉，导致 OCR 只能识别中下部的选项。
        // 【v2.8】红色背景白化 + 限制图像边长（借鉴 Umi-OCR 的"限制图像边长 960"），
        //   从 UserDefaults 读用户偏好（JS 端通过 __SB.setSettings 写入）。
        let defaults = UserDefaults.standard
        let whiten = defaults.object(forKey: "sb_ocr_whiten_red") as? Bool ?? true
        let maxEdge = defaults.object(forKey: "sb_ocr_max_edge") as? Int ?? 1600
        let enhance = defaults.object(forKey: "sb_ocr_enhance") as? Bool ?? true
        // v2.10 重要：分区域识别默认【关闭】——v2.9 的 50/50 硬切会把题目卡（学习强企红色界面）切成两半，
        //   导致只识别出选项/题干丢失。改为整图识别 + 预处理（白化/灰度/锐化）最稳。
        let split = defaults.object(forKey: "sb_ocr_split") as? Bool ?? false
        let multicand = defaults.object(forKey: "sb_ocr_multicand") as? Bool ?? false
        // iPhone 15 (1179×2556) 顶部灵动岛+状态栏 ≈ 177px ≈ 6.9% 高；
        // 顶部裁 5% (128px) 去掉状态栏/灵动岛，又不会切到题目卡（学习强企题卡从 ~200px 开始）
        OfflineOCR.recognize(base64: b64,
                             cropHeaderPct: 0.05,
                             cropFooterPct: 0.04,
                             whitenRedBg: whiten,
                             maxEdge: maxEdge,
                             enhance: enhance,
                             splitRegions: split,
                             multicand: multicand) { text in
            self.respond(id: id, result: ["text": text ?? ""])
        }
    }

    // MARK: - 带坐标的离线 OCR（v3.0）

    /// 与 handleOCR 走同一套预处理，但把每个文本块的**坐标与置信度**一起带回去。
    /// 网页 v1.0.61 的「按坐标重排成阅读顺序」「低置信度标黄」「自动定位题目区」
    /// 全靠这份数据；纯文本是做不到这些的。
    private func handleOCRBlocks(id: String, payload: [String: Any]) {
        guard let b64 = payload["base64"] as? String else {
            respond(id: id, result: ["error": "缺少 base64"])
            return
        }
        let defaults = UserDefaults.standard
        let whiten = defaults.object(forKey: "sb_ocr_whiten_red") as? Bool ?? true
        let maxEdge = defaults.object(forKey: "sb_ocr_max_edge") as? Int ?? 1600
        let enhance = defaults.object(forKey: "sb_ocr_enhance") as? Bool ?? true

        OfflineOCR.recognizeBlocks(base64: b64,
                                   cropHeaderPct: 0.05,
                                   cropFooterPct: 0.04,
                                   whitenRedBg: whiten,
                                   maxEdge: maxEdge,
                                   enhance: enhance) { res in
            guard let res = res else {
                self.respond(id: id, result: ["error": "识别失败（图片无法解析或 Vision 报错）"])
                return
            }
            self.respond(id: id, result: res)
        }
    }

    // MARK: - 二进制导出分享（v3.0：试卷 docx）

    private func handleShareBinary(id: String, payload: [String: Any]) {
        guard let b64 = payload["base64"] as? String,
              let name = payload["filename"] as? String,
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else {
            respond(id: id, result: ["error": "缺少导出内容"])
            return
        }
        // 文件名兜底：临时目录里不能出现路径分隔符
        let safeName = name.replacingOccurrences(of: "/", with: "_")
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try data.write(to: tmp)
        } catch {
            respond(id: id, result: ["error": "写入临时文件失败"])
            return
        }
        let av = UIActivityViewController(activityItems: [tmp], applicationActivities: nil)
        av.modalPresentationStyle = .formSheet
        if let pop = av.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        }
        present(av, animated: true) {
            self.respond(id: id, result: ["ok": true])
        }
    }

    // MARK: - 打开外链（v3.0）

    private func handleOpenExternal(id: String, payload: [String: Any]) {
        guard let s = payload["url"] as? String,
              let url = URL(string: s),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            respond(id: id, result: ["error": "非法链接"])
            return
        }
        UIApplication.shared.open(url, options: [:]) { ok in
            self.respond(id: id, result: ok ? ["ok": true] : ["error": "无法打开链接"])
        }
    }

    // MARK: - AI 通道（v3.0）
    // 放在原生侧跑的原因：WKWebView 用 file:// 加载页面，Origin 为 null，
    // 绝大多数模型服务端会因 CORS 直接拒绝；而且 API Key 留在沙盒里更安全。
    // 注意：URLSession 回调在后台线程，回传 JS 前必须切回主线程。

    private func handleAIAsk(id: String, payload: [String: Any]) {
        AIBridge.handleAsk(payload) { r in
            DispatchQueue.main.async { self.respond(id: id, result: r) }
        }
    }

    private func handleAIChat(id: String, payload: [String: Any]) {
        AIBridge.handleChat(payload) { r in
            DispatchQueue.main.async { self.respond(id: id, result: r) }
        }
    }

    private func handleAIProof(id: String, payload: [String: Any]) {
        AIBridge.handleProof(payload) { r in
            DispatchQueue.main.async { self.respond(id: id, result: r) }
        }
    }

    private func handleAIRecognize(id: String, payload: [String: Any]) {
        AIBridge.handleRecognize(payload) { r in
            DispatchQueue.main.async { self.respond(id: id, result: r) }
        }
    }

    // MARK: - 文件导入（DocumentPicker，支持 .json/.docx/.xlsx/.csv）

    private func handlePickFiles(id: String) {
        var types: [UTType] = [.json, .commaSeparatedText, .spreadsheet, .xml, .data]
        if #available(iOS 15.0, *) {
            // 显式加入 docx 扩展名类型，提升在「文件」App 中的可见性
            if let docx = UTType(filenameExtension: "docx") { types.insert(docx, at: 0) }
        }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = true
        picker.modalPresentationStyle = .formSheet
        documentPickerResolve = { files in
            self.respond(id: id, result: ["files": files])
        }
        present(picker, animated: true, completion: nil)
    }

    // documentPicker 回调实现统一在 WKNavigationDelegate/WKUIDelegate 扩展里
    // （同时处理 native bridge 和 `<input type="file">` 两条路径）

    // MARK: - 分块读取待导入备份（v3.0.1）

    /// JS 按 256KB 逐块请求，这里每次最多返回 4MB。
    /// 返回的 base64 是**原始字节**的片段，JS 需在字节层拼接后再统一解 UTF-8
    /// （分块边界可能切断一个汉字，逐块 decode 会得到乱码）。
    private func handleReadImportChunk(id: String, payload: [String: Any]) {
        let offset = payload["offset"] as? Int ?? 0
        let length = payload["length"] as? Int ?? (256 * 1024)
        guard let r = LocalStore.readImportChunk(offset: offset, length: length) else {
            respond(id: id, result: ["error": "没有待导入的备份文件（请重新选择文件）"])
            return
        }
        respond(id: id, result: [
            "data": r.b64,
            "next": r.next,
            "eof": r.eof,
            "size": r.size
        ])
    }

    // MARK: - 导出分享（把 JSON 写入临时文件后用系统分享面板）

    private func handleShareExport(id: String, payload: [String: Any]) {
        guard let text = payload["text"] as? String,
              let filename = payload["filename"] as? String else {
            respond(id: id, result: ["error": "缺少导出内容"])
            return
        }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try text.write(to: tmp, atomically: true, encoding: .utf8)
        } catch {
            respond(id: id, result: ["error": "写入临时文件失败"])
            return
        }
        let av = UIActivityViewController(activityItems: [tmp], applicationActivities: nil)
        av.modalPresentationStyle = .formSheet
        if let pop = av.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        }
        present(av, animated: true) {
            self.respond(id: id, result: [:])
        }
    }

    // MARK: - 读取包内自带题库

    private func handleBundledBank(id: String) {
        guard let www = wwwRoot else {
            respond(id: id, result: ["error": "缺少 www 目录"])
            return
        }
        let url = www.appendingPathComponent("搜题题库.json")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            respond(id: id, result: ["error": "找不到包内题库"])
            return
        }
        respond(id: id, result: ["text": text])
    }

    // MARK: - 系统相册选图（PHPicker，替代 UIDocumentPicker；iOS 14+；无需照片权限）

    /// 弹系统相册（PHPickerViewController），选完回 JPEG data URL 给 JS。
    /// 替代 UIDocumentPicker：在 iOS 上 UIDocumentPicker 默认走"文件"App 视图，
    /// 体验差；PHPicker 直接是系统相册，更符合用户预期。
    private func handlePickImage(id: String) {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        picker.modalPresentationStyle = .formSheet
        photoPickerResolve = { dataUrl in
            self.respond(id: id, result: dataUrl.map { ["dataUrl": $0] } ?? ["error": "已取消"])
        }
        present(picker, animated: true, completion: nil)
    }

    // PHPickerViewControllerDelegate

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true) {
            let r = self.photoPickerResolve
            self.photoPickerResolve = nil
            guard let first = results.first else { r?(nil); return }
            // PHPicker 不需要 photo library 授权（在沙箱外访问）
            if first.itemProvider.canLoadObject(ofClass: UIImage.self) {
                first.itemProvider.loadObject(ofClass: UIImage.self) { obj, err in
                    DispatchQueue.main.async {
                        let dataUrl: String?
                        if let img = obj as? UIImage, let jpeg = img.jpegData(compressionQuality: 0.85) {
                            dataUrl = "data:image/jpeg;base64," + jpeg.base64EncodedString()
                        } else {
                            dataUrl = nil
                        }
                        r?(dataUrl)
                    }
                }
            } else {
                r?(nil)
            }
        }
    }

    // MARK: - 读取相册最新一张图片（快捷指令"截屏搜题"用）

    /// 拉取相册里最新的一张图（默认是刚截的屏），转 base64 回 JS。
    /// 需要相册读权限（NSPhotoLibraryUsageDescription 已在 Info.plist）。
    private func handlePickLatestPhoto(id: String) {
        // 无权限且未决定 → 请求；已决定但拒绝 → 错误提示
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        let proceed: () -> Void = {
            let opts = PHFetchOptions()
            opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            opts.fetchLimit = 1
            let result = PHAsset.fetchAssets(with: .image, options: opts)
            guard let asset = result.firstObject else {
                self.respond(id: id, result: ["error": "相册为空"])
                return
            }
            let manager = PHImageManager.default()
            let reqOpts = PHImageRequestOptions()
            reqOpts.isSynchronous = false
            reqOpts.deliveryMode = .highQualityFormat
            reqOpts.resizeMode = .exact
            // 最长边缩到 2400，避免超大原图（iPhone 截图约 12MP）卡内存
            let target = CGSize(width: 2400, height: 2400)
            manager.requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: reqOpts) { img, _ in
                guard let img = img, let jpeg = img.jpegData(compressionQuality: 0.85) else {
                    self.respond(id: id, result: ["error": "读取图片失败"])
                    return
                }
                self.respond(id: id, result: ["dataUrl": "data:image/jpeg;base64," + jpeg.base64EncodedString()])
            }
        }
        switch status {
        case .authorized, .limited:
            proceed()
        case .notDetermined:
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { newStatus in
                DispatchQueue.main.async {
                    if newStatus == .authorized || newStatus == .limited {
                        proceed()
                    } else {
                        self.respond(id: id, result: ["error": "需要相册权限，请到 设置→隐私→照片 开启"])
                    }
                }
            }
        default:
            respond(id: id, result: ["error": "需要相册权限，请到 设置→隐私→照片 开启"])
        }
    }

    // MARK: - URL scheme 唤醒

    /// JS 端 query 这个方法确认已经处理了 URL 唤醒参数。
    /// 真正的 URL 解析在 AppDelegate 的 openURL 中完成，并通过 evaluateJavaScript 注入。
    private func handleProcessURL(id: String, payload: [String: Any]) {
        respond(id: id, result: ["ok": true])
    }

    // MARK: - 设置读写（v2.8 OCR 行为控制）

    /// JS 端通过 __SB.setSetting(key, value) 写入 UserDefaults
    /// 供 setEngine/ocrCfg 等其他设置共存（key 全部 sb_ 前缀避免冲突）
    private func handleSetSetting(id: String, payload: [String: Any]) {
        guard let key = payload["key"] as? String, !key.isEmpty else {
            respond(id: id, result: ["error": "missing key"])
            return
        }
        let value = payload["value"]
        let defaults = UserDefaults.standard
        if let b = value as? Bool { defaults.set(b, forKey: key) }
        else if let i = value as? Int { defaults.set(i, forKey: key) }
        else if let d = value as? Double { defaults.set(d, forKey: key) }
        else if let s = value as? String { defaults.set(s, forKey: key) }
        else if value is NSNull { defaults.removeObject(forKey: key) }
        else { respond(id: id, result: ["error": "unsupported value type"]); return }
        respond(id: id, result: ["ok": true])
    }

    private func handleGetSetting(id: String, payload: [String: Any]) {
        guard let key = payload["key"] as? String, !key.isEmpty else {
            respond(id: id, result: ["error": "missing key"])
            return
        }
        let value = UserDefaults.standard.object(forKey: key)
        respond(id: id, result: ["value": value as Any])
    }

    // MARK: - 原生剪贴板（v2.13 桥接：解决 WKWebView 用 file:// 协议时 navigator.clipboard 不可用的问题）

    /// 读系统剪贴板文本（UIPasteboard.general.string）。
    /// iOS 13+ 在 WKWebView 中剪贴板访问需要用户交互授权；这里从原生 API 直接读，绕开 WebView 权限限制。
    /// 同时作为快捷指令 OCR 全文链路的核心（searchbank://fab-clipboard 路径用此读剪贴板）
    private func handleReadClipboard(id: String) {
        let s = UIPasteboard.general.string ?? ""
        respond(id: id, result: ["text": s])
    }

    /// 剪贴板富探测（v3.0.2）。手机版「复制题干自动搜题」「复制截图自动识别」靠它。
    ///
    /// 为什么不是简单轮询 `UIPasteboard.general.string`：
    ///   iOS 16 起，读取**别人写入**的剪贴板内容会弹一次系统「允许粘贴」。
    ///   每 1.2 秒读一次 = 每 1.2 秒弹一次，完全没法用。
    ///   而 `changeCount` 只是个计数，读它**不碰内容、不弹窗**，
    ///   所以这里先用 changeCount 门控：没变化就直接返回，连内容都不读。
    ///
    /// 参数：since = 上次见到的 changeCount；peek = true 时只回计数、绝不读内容。
    /// 返回：{changeCount, changed, kind: "same"|"empty"|"text"|"image", text?, dataUrl?}
    private func handleReadClipboardRich(id: String, payload: [String: Any]) {
        let pb = UIPasteboard.general
        let count = pb.changeCount
        let since = payload["since"] as? Int ?? -1
        let peek = payload["peek"] as? Bool ?? false

        if peek {
            respond(id: id, result: ["changeCount": count, "changed": false, "kind": "same"])
            return
        }
        // 计数没变 → 连内容都不读（这一步是「不反复弹窗」的关键）
        if since >= 0 && since == count {
            respond(id: id, result: ["changeCount": count, "changed": false, "kind": "same"])
            return
        }

        // 用 hasStrings / hasImages 判类型，不读内容（也不会弹窗）
        if pb.hasStrings, let s = pb.string, !s.isEmpty {
            respond(id: id, result: [
                "changeCount": count, "changed": true, "kind": "text", "text": s
            ])
            return
        }
        if pb.hasImages, let img = pb.image, let dataUrl = downscaleJPEG(img) {
            respond(id: id, result: [
                "changeCount": count, "changed": true, "kind": "image", "dataUrl": dataUrl
            ])
            return
        }
        respond(id: id, result: ["changeCount": count, "changed": true, "kind": "empty"])
    }

    /// 把剪贴板图片缩到最长边 1600 再转 JPEG data URL。
    /// 手机截屏原图约 12MP，直接 base64 会有 4MB+ 经 evaluateJavaScript 传给页面 ——
    /// 又慢又有静默失败的风险，而离线 OCR 本来也只按 1600 处理。
    private func downscaleJPEG(_ img: UIImage, maxEdge: CGFloat = 1600, quality: CGFloat = 0.8) -> String? {
        let w = img.size.width, h = img.size.height
        guard w > 0, h > 0 else { return nil }
        let longest = max(w, h)
        let scale = longest > maxEdge ? maxEdge / longest : 1
        let nw = max(1, (w * scale).rounded())
        let nh = max(1, (h * scale).rounded())
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let out = UIGraphicsImageRenderer(size: CGSize(width: nw, height: nh), format: fmt).image { _ in
            img.draw(in: CGRect(x: 0, y: 0, width: nw, height: nh))
        }
        guard let jpeg = out.jpegData(compressionQuality: quality) else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }

    /// 写系统剪贴板文本
    private func handleWriteClipboard(id: String, payload: [String: Any]) {
        let text = (payload["text"] as? String) ?? ""
        UIPasteboard.general.string = text
        respond(id: id, result: ["ok": true])
    }

    // MARK: - 拍照（FAB 相机按钮使用）

    /// 弹出系统相机，拍照后回传 JPEG data URL 给 JS。
    /// 真机/模拟器均无效时（iOS 模拟器没有摄像头），回传 error 让 JS 降级为相册选择。
    private func handleCaptureImage(id: String) {
        // 检查相机可用性
        let hasCamera = UIImagePickerController.isSourceTypeAvailable(.camera)
        guard hasCamera else {
            respond(id: id, result: ["error": "当前设备不支持相机"])
            return
        }
        let pick = UIImagePickerController()
        pick.sourceType = .camera
        pick.cameraCaptureMode = .photo
        pick.allowsEditing = false
        pick.delegate = self
        pick.modalPresentationStyle = .fullScreen
        cameraResolve = { dataUrl in
            self.respond(id: id, result: dataUrl.map { ["dataUrl": $0] } ?? ["error": "已取消"])
        }
        present(pick, animated: true, completion: nil)
    }

    // UIImagePickerControllerDelegate

    func imagePickerController(_ picker: UIImagePickerController,
                               didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        let image = (info[.originalImage] as? UIImage)
        picker.dismiss(animated: true) {
            let dataUrl: String?
            if let img = image, let jpeg = img.jpegData(compressionQuality: 0.85) {
                dataUrl = "data:image/jpeg;base64," + jpeg.base64EncodedString()
            } else {
                dataUrl = nil
            }
            let r = self.cameraResolve
            self.cameraResolve = nil
            r?(dataUrl)
        }
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) {
            let r = self.cameraResolve
            self.cameraResolve = nil
            r?(nil)
        }
    }
}

// MARK: - WKNavigationDelegate / WKUIDelegate

extension ViewController: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(.allow)
    }

    // 注：webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:) 方法实现在
    //     SearchBank/OpenPanelShim.m 里用 Objective-C 写，避免 Swift 引用 forward-declared
    //     的 WKOpenPanelParameters 类型（编译报 "cannot find type"）。
    //     Swift 侧只持有 completionHandler 结果 (`openPanelResolve`)。

    /// 用 documentPicker 的回调同时路由到 `documentPickerResolve` 和 `openPanelResolve`。
    /// 调用方根据谁设置谁消费。
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        // 1) 先看是不是 open panel（即来自 <input type="file">）
        if let openResolve = openPanelResolve {
            openPanelResolve = nil
            documentPickerResolve = nil  // 同时清掉另一条
            openResolve(urls)
            return
        }
        // 2) 否则走 native bridge
        var files: [[String: Any]] = []
        for url in urls {
            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                let mime = (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType?.identifier)
                    ?? "application/octet-stream"
                // v3.0.1：大 JSON 备份不走 base64。
                // 电脑版导出的备份已有 8MB，base64 后约 10.7MB，一次性经
                // evaluateJavaScript 传给 JS 又慢又可能静默失败；
                // 改成写进沙盒，JS 用 readImportChunk 按 256KB 分块取。
                if url.pathExtension.lowercased() == "json",
                   data.count > Self.importStageThreshold,
                   LocalStore.stageImport(data) != nil {
                    files.append([
                        "name": url.lastPathComponent,
                        "mime": mime,
                        "staged": true,
                        "size": data.count
                    ])
                    continue
                }
                // 小文件（以及落盘失败时）仍走 base64，改动最小
                files.append([
                    "name": url.lastPathComponent,
                    "mime": mime,
                    "data": data.base64EncodedString(),
                    "size": data.count
                ])
            } catch {}
        }
        let resolve = documentPickerResolve
        documentPickerResolve = nil
        resolve?(files)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let openResolve = openPanelResolve {
            openPanelResolve = nil
            documentPickerResolve = nil
            openResolve(nil)
            return
        }
        let resolve = documentPickerResolve
        documentPickerResolve = nil
        resolve?([])
    }
}
