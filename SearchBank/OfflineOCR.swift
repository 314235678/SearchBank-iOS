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
    /// v2.9 新增：enhance（灰度+对比度+锐化）、splitRegions（分上下两半识别）、multicand（多候选 top3）
    static func recognize(base64: String,
                          cropHeaderPct: Double = 0,
                          cropFooterPct: Double = 0,
                          whitenRedBg: Bool = false,
                          maxEdge: Int = 0,
                          enhance: Bool = true,
                          splitRegions: Bool = true,
                          multicand: Bool = false,
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

        // 步骤：① 缩放 ② 红色背景白化（可选） ③ 灰度/对比度/锐化 ④ 裁剪 ⑤ 分区域识别 + 多候选
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

        // 3) 图像预处理增强（灰度 + 对比度 + 锐化）
        if enhance {
            if let enhanced = enhanceForOCR(cgImage: working) {
                working = enhanced
            }
        }

        // 4) 裁剪
        let processed: CGImage = {
            guard cropHeaderPct > 0 || cropFooterPct > 0,
                  let cropped = crop(cgImage: working,
                                     topPct: max(0, min(0.4, cropHeaderPct)),
                                     bottomPct: max(0, min(0.4, cropFooterPct))) else {
                return working
            }
            return cropped
        }()

        // 5) 分区域识别：把图按高度切成上下两半，分别跑 Vision，再合并（大图降采样会丢小字，
        //    半图分辨率相对更高；红色界面卡片居中也更容易命中）
        let regions: [CGImage] = splitRegions
            ? splitIntoRegions(cgImage: processed, parts: 2)
            : [processed]

        DispatchQueue.global(qos: .userInitiated).async {
            var allLines: [[(text: String, y: CGFloat)]] = []
            for region in regions {
                guard let result = recognizeRegion(cgImage: region, multicand: multicand) else {
                    continue
                }
                allLines.append(result)
            }
            // 合并所有区域的行（Vision 坐标是左下原点，y 越大越靠上）
            var merged = allLines.flatMap { $0 }
            merged.sort { $0.y > $1.y }
            // 合并成"行"（单栏-无换行：同行用空格）
            let lines = groupObservationsByLine(merged.map { $0.text }, yValues: merged.map { $0.y })
            completion(lines.joined(separator: "\n"))
        }
    }

    /// 对单张 CGImage 跑 Vision OCR，返回 (文本, y 坐标) 列表。
    /// multicand=true 时每个观察输出 top1|top2|top3（置信度降序，JS 端可做多候选搜索）
    private static func recognizeRegion(cgImage: CGImage, multicand: Bool) -> [(text: String, y: CGFloat)]? {
        let request = VNRecognizeTextRequest()
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en"]
        request.usesLanguageCorrection = true
        if #available(iOS 14.0, *) {
            request.recognitionLevel = .accurate
        }
        request.minimumTextHeight = 0.008
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
            guard let observations = request.results else { return [] }
            var out: [(text: String, y: CGFloat)] = []
            for obs in observations {
                let y = obs.boundingBox.midY
                if multicand {
                    let cands = obs.topCandidates(3).map { $0.string }
                    // 去重（可能 top2==top1）
                    var seen = Set<String>()
                    var texts: [String] = []
                    for c in cands {
                        if !seen.contains(c) { seen.insert(c); texts.append(c) }
                    }
                    if texts.isEmpty { continue }
                    out.append((text: texts.joined(separator: "|"), y: y))
                } else {
                    guard let s = obs.topCandidates(1).first?.string else { continue }
                    out.append((text: s, y: y))
                }
            }
            return out
        } catch {
            return nil
        }
    }

    /// 把图按高度切成 N 份（每份独立识别，避免大图降采样丢小字）
    private static func splitIntoRegions(cgImage: CGImage, parts: Int) -> [CGImage] {
        let w = cgImage.width
        let h = cgImage.height
        guard parts > 1, h > 200 else { return [cgImage] }
        let partH = h / parts
        var regions: [CGImage] = []
        for i in 0..<parts {
            let y = i * partH
            let height = (i == parts - 1) ? (h - y) : partH
            if height < 20 { continue }
            if let r = cgImage.cropping(to: CGRect(x: 0, y: y, width: w, height: height)) {
                regions.append(r)
            }
        }
        return regions.isEmpty ? [cgImage] : regions
    }

    /// 按 Y 坐标把 (文本, y) 分组为"行"：y 接近（高度 60% 容差）归同一行，同行内用空格拼接。
    private static func groupObservationsByLine(_ texts: [String], yValues: [CGFloat]) -> [String] {
        var pairs: [(text: String, y: CGFloat)] = []
        for i in 0..<min(texts.count, yValues.count) {
            pairs.append((texts[i], yValues[i]))
        }
        guard !pairs.isEmpty else { return [] }
        let sorted = pairs.sorted { $0.y > $1.y }
        // 估算行高：取 y 的最小差作为参考（简单方式：用全部 y 的标准差太小，用相邻差值的中位数）
        var lines: [String] = []
        var curY = sorted[0].y
        var cur = sorted[0].text
        for i in 1..<sorted.count {
            let delta = abs(sorted[i].y - curY)
            if delta < 0.015 {   // 归一化坐标下，约 1.5% 高度差 = 同一行
                cur += " " + sorted[i].text
            } else {
                lines.append(cur)
                cur = sorted[i].text
                curY = sorted[i].y
            }
        }
        lines.append(cur)
        return lines
    }

    /// v2.9 图像预处理：灰度 + 对比度 + 锐化。黑白高对比图 Vision 识别率最高。
    private static func enhanceForOCR(cgImage: CGImage) -> CGImage? {
        let ci = CIImage(cgImage: cgImage)
        // 1) 灰度（饱和度 0）+ 对比度增强
        let gray = ci.applyingFilter("CIColorControls", parameters: [
            "inputSaturation": 0,
            "inputContrast": 1.4
        ])
        // 2) 亮度微调（压掉浅背景噪声）
        let adjusted = gray.applyingFilter("CIColorControls", parameters: [
            "inputBrightness": -0.04
        ])
        // 3) 锐化（文字边缘更清晰）
        let sharp = adjusted.applyingFilter("CISharpenLuminance", parameters: [
            "inputSharpness": 0.7
        ])
        let ctx = CIContext(options: [.useSoftwareRenderer: false])
        return ctx.createCGImage(sharp, from: sharp.extent)
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
}


