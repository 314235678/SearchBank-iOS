import UIKit
import Vision

/// 离线文字识别：基于 iOS 原生 Vision 框架，全程在设备端完成，
/// 支持简体中文 / 繁体中文 / 英文。首次使用中文识别时系统会自动下载语言模型（一次性，约数十 MB），之后完全离线。
///
/// 增强：
///   - 可选 `cropHeaderPct` / `cropFooterPct`，先裁掉顶部/底部各一定比例的区域（去掉页眉/页脚/页码）
///     再进 Vision，能显著减少「不相关句子」和题干外的噪声行。
///   - 不传裁切比例时行为与以前一致。
enum OfflineOCR {

    /// 输入 base64（可带 `data:image/...;base64,` 前缀）的图片，返回识别出的文字。
    static func recognize(base64: String,
                          cropHeaderPct: Double = 0,
                          cropFooterPct: Double = 0,
                          completion: @escaping (String?) -> Void) {
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

        // 先按比例裁掉顶/底，再交给 Vision
        let processed: CGImage = {
            guard cropHeaderPct > 0 || cropFooterPct > 0,
                  let cropped = crop(cgImage: cgImage,
                                     topPct: max(0, min(0.4, cropHeaderPct)),
                                     bottomPct: max(0, min(0.4, cropFooterPct))) else {
                return cgImage
            }
            return cropped
        }()

        let request = VNRecognizeTextRequest()
        // 中文优先，回退英文；开启语言纠错提升准确率
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en"]
        request.usesLanguageCorrection = true
        if #available(iOS 14.0, *) {
            request.recognitionLevel = .accurate
        }
        request.minimumTextHeight = 0.01

        let handler = VNImageRequestHandler(cgImage: processed, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try handler.perform([request])
                guard let observations = request.results else {
                    completion("")
                    return
                }
                let text = observations
                    .compactMap { $0.topCandidates(1).first?.string }
                    .joined(separator: "\n")
                completion(text)
            } catch {
                completion(nil)
            }
        }
    }

    /// 按图像高度比例裁剪掉顶部 / 底部。
    private static func crop(cgImage: CGImage, topPct: Double, bottomPct: Double) -> CGImage? {
        let w = cgImage.width
        let h = cgImage.height
        let top = Int(Double(h) * topPct)
        let bottom = Int(Double(h) * bottomPct)
        let rect = CGRect(x: 0, y: top, width: w, height: max(1, h - top - bottom))
        // 起点在 (0, top)：苹果 CGImage API 的 y 起点在 bottom-left
        return cgImage.cropping(to: rect)
    }
}
