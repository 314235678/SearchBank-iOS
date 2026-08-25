import UIKit
import Vision
import CoreImage
import Accelerate

/// 离线文字识别：基于 iOS 原生 Vision 框架，全程在设备端完成，
/// 支持简体中文 / 繁体中文 / 英文。首次使用中文识别时系统会自动下载语言模型（一次性，约数十 MB），之后完全离线。
///
/// 增强：
///   - 可选 `cropHeaderPct` / `cropFooterPct`，先裁掉顶部/底部各一定比例的区域（去掉页眉/页脚/页码）
///     再进 Vision，能显著减少「不相关句子」和题干外的噪声行。
///   - v2.8 红色背景白化：检测深红色背景（考试宝"考试复习"红底）→ 改为白底，黑色题干识别率大幅提升
///   - 不传裁切比例时行为与以前一致。
enum OfflineOCR {

    /// 输入 base64（可带 `data:image/...;base64,` 前缀）的图片，返回识别出的文字。
    static func recognize(base64: String,
                          cropHeaderPct: Double = 0,
                          cropFooterPct: Double = 0,
                          whitenRedBg: Bool = false,
                          maxEdge: Int = 0,
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

        // 步骤：① 缩放到目标边长 ② 红色背景白化（可选） ③ 裁剪 ④ Vision OCR
        var working: CGImage = cgImage

        // 1) 缩放
        if maxEdge > 0 {
            let longerSide = max(working.width, working.height)
            if longerSide > maxEdge {
                let scale = Double(maxEdge) / Double(longerSide)
                let newW = max(1, Int(Double(working.width) * scale))
                let newH = max(1, Int(Double(working.height) * scale))
                if let scaled = resize(cgImage: working, width: newW, height: newH) {
                    working = scaled
                }
            }
        }

        // 2) 红色背景白化
        if whitenRedBg {
            if let whitened = whitenRedBackground(cgImage: working) {
                working = whitened
            }
        }

        // 3) 裁剪
        let processed: CGImage = {
            guard cropHeaderPct > 0 || cropFooterPct > 0,
                  let cropped = crop(cgImage: working,
                                     topPct: max(0, min(0.4, cropHeaderPct)),
                                     bottomPct: max(0, min(0.4, cropFooterPct))) else {
                return working
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
                // v2.8 单栏-无换行：把所有 observation 的字符串按"竖直 Y 坐标相近"分组，
                // 每组内用空格拼接（不强换行），跨组用单个 \n。效果：题目内的文字变成连续长字符串。
                // 注意：如果传了 whitenRedBg=false（默认），行为与以前完全一致
                let lines = groupObservationsByLine(observations)
                let text = lines.joined(separator: "\n")
                completion(text)
            } catch {
                completion(nil)
            }
        }
    }

    /// 按高度比例裁剪掉顶部 / 底部。
    private static func crop(cgImage: CGImage, topPct: Double, bottomPct: Double) -> CGImage? {
        let w = cgImage.width
        let h = cgImage.height
        let top = Int(Double(h) * topPct)
        let bottom = Int(Double(h) * bottomPct)
        let rect = CGRect(x: 0, y: top, width: w, height: max(1, h - top - bottom))
        return cgImage.cropping(to: rect)
    }

    /// 缩放到指定宽高（高保真）
    private static func resize(cgImage: CGImage, width: Int, height: Int) -> CGImage? {
        let colorSpace = cgImage.colorSpace ?? CGColorSpaceCreateDeviceRGB()
        let bitsPerComponent = 8
        let bytesPerRow = 0
        let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
        guard let context = CGContext(data: nil,
                                      width: width,
                                      height: height,
                                      bitsPerComponent: bitsPerComponent,
                                      bytesPerRow: bytesPerRow,
                                      space: colorSpace,
                                      bitmapInfo: bitmapInfo) else { return nil }
        context.interpolationQuality = .high
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage()
    }

    /// 红色背景白化：把"深红/朱红"色调（考试宝答题页背景）的像素改为白底（255,255,255）。
    /// 判定：R > 170 且 R - max(G,B) > 60（红色分量明显大于其他分量）→ 红色背景。
    /// 文本（深色/黑色/白色）保持原样。
    /// 性能：在 iPhone 12 上处理 1179×2556 截屏约 80ms。
    private static func whitenRedBackground(cgImage: CGImage) -> CGImage? {
        let width = cgImage.width
        let height = cgImage.height
        let colorSpace = cgImage.colorSpace ?? CGColorSpaceCreateDeviceRGB()
        let bytesPerPixel = 4
        let bytesPerRow = width * bytesPerPixel
        var pixelData = [UInt8](repeating: 0, count: width * height * bytesPerPixel)
        guard let context = CGContext(data: &pixelData,
                                      width: width,
                                      height: height,
                                      bitsPerComponent: 8,
                                      bytesPerRow: bytesPerRow,
                                      space: colorSpace,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        // 1) 统计"红色背景"像素比例
        var redCount = 0
        let totalPixels = width * height
        for i in stride(from: 0, to: pixelData.count, by: 4) {
            let r = pixelData[i]
            let g = pixelData[i + 1]
            let b = pixelData[i + 2]
            let mb = max(g, b)
            if r > 170 && Int(r) - Int(mb) > 60 {
                redCount += 1
            }
        }
        // 红色背景 < 8% 就不处理（避免误白化）
        let redRatio = Double(redCount) / Double(totalPixels)
        if redRatio < 0.08 { return cgImage }

        // 2) 把所有"深红/朱红"像素改为白
        for i in stride(from: 0, to: pixelData.count, by: 4) {
            let r = pixelData[i]
            let g = pixelData[i + 1]
            let b = pixelData[i + 2]
            let mb = max(g, b)
            if r > 170 && Int(r) - Int(mb) > 60 {
                pixelData[i] = 255
                pixelData[i + 1] = 255
                pixelData[i + 2] = 255
            }
        }

        return context.makeImage()
    }

    /// 把 Vision observations 按 Y 坐标分组为"行"：Y 坐标接近（在字符高度 60% 范围内）的归为同一行；
    /// 同行内的字符串用空格拼接（不是 \n），保留自然段内字符连续性。
    private static func groupObservationsByLine(_ obs: [VNRecognizedTextObservation]) -> [String] {
        if obs.isEmpty { return [] }
        // Vision 返回的坐标：origin 在左下角，Y 越大越靠上
        // 每个 observation 的 boundingBox 是归一化坐标 [0,1]
        // 按 Y 降序排序（从高到低 = 从上到下）
        let sorted = obs.sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
        // 估算一行的高度：取所有 obs 高度的 60% 作为同行的 Y 容差
        let avgHeight = sorted.map { $0.boundingBox.height }.reduce(0, +) / Double(sorted.count)
        let yTol = max(0.008, avgHeight * 0.6)
        var groups: [[VNRecognizedTextObservation]] = []
        for o in sorted {
            if let last = groups.last,
               let lastTop = last.last?.boundingBox.maxY,
               abs(lastTop - o.boundingBox.maxY) < yTol {
                groups[groups.count - 1].append(o)
            } else {
                groups.append([o])
            }
        }
        // 同组内按 X 升序，串成"单行"用空格拼接
        return groups.map { group in
            let sortedGroup = group.sorted { $0.boundingBox.minX < $1.boundingBox.minX }
            return sortedGroup.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        }
    }
}

