import UIKit
import Vision

/// 离线文字识别：基于 iOS 原生 Vision 框架，全程在设备端完成，
/// 支持简体中文 / 繁体中文 / 英文。首次使用中文识别时系统会自动下载语言模型（一次性，约数十 MB），之后完全离线。
enum OfflineOCR {

    /// 输入 base64（可带 `data:image/...;base64,` 前缀）的图片，返回识别出的文字。
    static func recognize(base64: String, completion: @escaping (String?) -> Void) {
        // 去掉 data URL 前缀
        var raw = base64
        if let range = raw.range(of: ";base64,") {
            raw = String(raw[range.upperBound...])
        }
        guard let data = Data(base64Encoded: raw,
                              options: .ignoreUnknownCharacters),
              let image = UIImage(data: data),
              let cgImage = image.cgImage else {
            completion(nil)
            return
        }

        let request = VNRecognizeTextRequest()
        // 中文优先，回退英文；开启语言纠错提升准确率
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en"]
        request.usesLanguageCorrection = true
        if #available(iOS 14.0, *) {
            request.recognitionLevel = .accurate
        }
        request.minimumTextHeight = 0.01

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try handler.perform([request])
                guard let observations = request.results else {
                    completion("")
                    return
                }
                let text = observations
                    .compactMap { $0 as? VNRecognizedText }
                    .compactMap { $0.topCandidates(1).first?.string }
                    .joined(separator: "\n")
                completion(text)
            } catch {
                completion(nil)
            }
        }
    }
}
