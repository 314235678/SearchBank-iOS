import UIKit
import WebKit
import UniformTypeIdentifiers

/// 搜题平台 iOS 外壳：用 WKWebView 承载网页版全部功能，
/// 通过名为 "bridge" 的 WKScriptMessageHandler 与网页 JS 通信，
/// 提供：离线 OCR（Vision）、文件导入（DocumentPicker）、导出分享、设备分级。
class ViewController: UIViewController,
                      WKScriptMessageHandler,
                      UIDocumentPickerDelegate,
                      UINavigationControllerDelegate {

    private var webView: WKWebView!
    private var documentPickerResolve: (([[String: Any]]) -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        setupWebView()
        loadApp()
    }

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
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = true
        webView.allowsLinkPreview = false
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }

    private func loadApp() {
        guard let www = Bundle.main.url(forResource: "www", withExtension: nil) else {
            showFatal("找不到 www 资源目录")
            return
        }
        let index = www.appendingPathComponent("index.html")
        webView.loadFileURL(index, allowingReadAccessTo: www)
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
        case "pickFiles":
            handlePickFiles(id: id)
        case "shareExport":
            handleShareExport(id: id, payload: payload)
        case "getBundledBank":
            handleBundledBank(id: id)
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

    // MARK: - 离线 OCR（Vision，全程本机，支持中文）

    private func handleOCR(id: String, payload: [String: Any]) {
        guard let b64 = payload["base64"] as? String else {
            respond(id: id, result: ["error": "缺少 base64"])
            return
        }
        OfflineOCR.recognize(base64: b64) { text in
            respond(id: id, result: ["text": text ?? ""])
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

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        var files: [[String: Any]] = []
        for url in urls {
            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                let b64 = data.base64EncodedString()
                let mime = (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType?.identifier)
                    ?? "application/octet-stream"
                files.append(["name": url.lastPathComponent, "mime": mime, "data": b64])
            } catch {
                // 忽略单个读取失败的文件
            }
        }
        let resolve = documentPickerResolve
        documentPickerResolve = nil
        resolve?(files)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let resolve = documentPickerResolve
        documentPickerResolve = nil
        resolve?([])
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
        guard let www = Bundle.main.url(forResource: "www", withExtension: nil) else {
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
}

// MARK: - WKNavigationDelegate / WKUIDelegate

extension ViewController: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(.allow)
    }
}
