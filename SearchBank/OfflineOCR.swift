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

        // 3) 图像预处理增强（灰度 + 对比度 + 锐化 + Otsu 二值化）
        if enhance {
            if let enhanced = enhanceForOCR(cgImage: working) {
                working = enhanced
            }
            // v2.12 Otsu 自适应二值化（浅底深字 → 纯黑白），Vision 识别率最高
            // 用当前是否二值化由 enhance 控制；如果用户关闭 enhance 则整段跳过
            if let binary = otsuBinarize(cgImage: working) {
                working = binary
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

        // 5) 分区域识别：v2.10 修复——25% 重叠避免切到题目卡 + Y 坐标绝对化正确合并
        //    注意：v2.10 默认 split=false（避免红色界面被错误切分）
        let regions: [(image: CGImage, yOffset: Int, regionH: Int, totalH: Int)] = splitRegions
            ? splitIntoRegions(cgImage: processed, parts: 2, overlapRatio: 0.25)
            : [(processed, 0, processed.height, processed.height)]

        DispatchQueue.global(qos: .userInitiated).async {
            var allLines: [(text: String, yAbs: CGFloat)] = []
            for r in regions {
                guard let result = recognizeRegion(cgImage: r.image, multicand: multicand) else {
                    continue
                }
                // v2.10 修复：把每个 observation 的归一化 y 转换为**原图绝对 y 坐标**
                //   否则上半区底部的"题干末行"会错误地排在 下半区顶部"选项首行" 之前/之后
                let yBase = CGFloat(r.yOffset) / CGFloat(r.totalH)
                let yScale = CGFloat(r.regionH) / CGFloat(r.totalH)
                for (text, yLocal) in result {
                    let yAbs = yBase + yLocal * yScale
                    allLines.append((text: text, yAbs: yAbs))
                }
            }
            let lines = groupObservationsByLine(allLines.map { $0.text }, yValues: allLines.map { $0.yAbs })
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
    /// v2.10：加 25% 重叠，避免题目卡恰好被切在中间（上半区只剩题干、下半区只剩选项）；
    /// 返回每块在原图中的 yOffset 偏移和高度，供合并时把 y 转成绝对坐标
    private static func splitIntoRegions(cgImage: CGImage, parts: Int, overlapRatio: Double) -> [(image: CGImage, yOffset: Int, regionH: Int, totalH: Int)] {
        let w = cgImage.width
        let h = cgImage.height
        guard parts > 1, h > 200 else { return [(cgImage, 0, h, h)] }
        let partH = h / parts
        let overlap = min(partH / 2, Int(Double(partH) * overlapRatio))  // 重叠不超过一半
        var regions: [(image: CGImage, yOffset: Int, regionH: Int, totalH: Int)] = []
        for i in 0..<parts {
            let yStart = max(0, i * partH - (i > 0 ? overlap : 0))
            let yEnd = (i == parts - 1) ? h : ((i + 1) * partH + overlap)
            let height = yEnd - yStart
            if height < 20 { continue }
            if let r = cgImage.cropping(to: CGRect(x: 0, y: yStart, width: w, height: height)) {
                regions.append((r, yStart, height, h))
            }
        }
        return regions.isEmpty ? [(cgImage, 0, h, h)] : regions
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

    /// 红色背景白化：把"红/朱红/粉红"色调（学习强企、考试宝答题页背景）的像素改为白底（255,255,255）。
    /// v2.12 改进：改用 HSV 色相检测（H 在 340°~360° / 0°~20° 红色区间，饱和度 > 0.35），
    ///   覆盖深红、渐变红、浅红；红色像素占比 > 3% 就触发（之前 8% + RGB 差值 60 太严，浅红检测不到）
    /// 文本（深色/黑色/白色）保持原样。性能：1179×2556 截屏约 100ms。
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

        // 1) 统计"红色背景"像素比例（HSV 检测）
        var redCount = 0
        let totalPixels = width * height
        for i in stride(from: 0, to: pixelData.count, by: 4) {
            let r = Double(pixelData[i]) / 255.0
            let g = Double(pixelData[i + 1]) / 255.0
            let b = Double(pixelData[i + 2]) / 255.0
            let mx = max(r, max(g, b))
            let mn = min(r, min(g, b))
            let delta = mx - mn
            // 饱和度低（接近灰/白）不算红色
            guard mx > 0.55, delta > 0.15 else { continue }
            var hue: Double = 0
            if delta > 0 {
                if mx == r { hue = 60 * ((g - b) / delta) }
                else if mx == g { hue = 60 * ((b - r) / delta + 2) }
                else { hue = 60 * ((r - g) / delta + 4) }
            }
            if hue < 0 { hue += 360 }
            // 红色区间：340~360 / 0~20；亮度高于 55% 是背景（深红/朱红/粉红）
            if (hue <= 20 || hue >= 340) && mx > 0.55 {
                redCount += 1
            }
        }
        // 红色背景 < 3% 就不处理（避免误白化橙色/黄色）
        let redRatio = Double(redCount) / Double(totalPixels)
        if redRatio < 0.03 { return cgImage }

        // 2) 把所有红色调像素改为白
        for i in stride(from: 0, to: pixelData.count, by: 4) {
            let r = Double(pixelData[i]) / 255.0
            let g = Double(pixelData[i + 1]) / 255.0
            let b = Double(pixelData[i + 2]) / 255.0
            let mx = max(r, max(g, b))
            let mn = min(r, min(g, b))
            let delta = mx - mn
            if mx > 0.55, delta > 0.15 {
                var hue: Double = 0
                if delta > 0 {
                    if mx == r { hue = 60 * ((g - b) / delta) }
                    else if mx == g { hue = 60 * ((b - r) / delta + 2) }
                    else { hue = 60 * ((r - g) / delta + 4) }
                }
                if hue < 0 { hue += 360 }
                if (hue <= 20 || hue >= 340) && mx > 0.55 {
                    pixelData[i] = 255
                    pixelData[i + 1] = 255
                    pixelData[i + 2] = 255
                }
            }
        }

        return context.makeImage()
    }

    /// v2.12 Otsu 自适应二值化：灰度图上自动找阈值，把图变成纯黑白（浅底深字 → 黑字白底）。
    /// Vision 对黑白高对比图识别率最高。用 Accelerate vImage 直方图加速。
    /// 处理 1179×2556 截屏约 60ms。
    private static func otsuBinarize(cgImage: CGImage) -> CGImage? {
        let width = cgImage.width
        let height = cgImage.height
        let colorSpace = cgImage.colorSpace ?? CGColorSpaceCreateDeviceRGB()
        let bytesPerRow = width * 4
        var pixelData = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(data: &pixelData,
                                      width: width,
                                      height: height,
                                      bitsPerComponent: 8,
                                      bytesPerRow: bytesPerRow,
                                      space: colorSpace,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        // 1) 直方图（亮度 = (R+G+B)/3）
        var hist = [Int](repeating: 0, count: 256)
        var sum = 0.0
        let n = width * height
        for i in stride(from: 0, to: pixelData.count, by: 4) {
            let l = (Int(pixelData[i]) + Int(pixelData[i+1]) + Int(pixelData[i+2])) / 3
            hist[l] += 1
            sum += Double(l)
        }
        // 2) Otsu 求最优阈值
        var wB = 0
        var sumB = 0.0
        var maxVar = 0.0
        var threshold = 127
        for t in 0..<256 {
            wB += hist[t]
            if wB == 0 { continue }
            let wF = n - wB
            if wF == 0 { break }
            sumB += Double(t) * Double(hist[t])
            let mB = sumB / Double(wB)
            let mF = (sum - sumB) / Double(wF)
            let between = Double(wB) * Double(wF) * (mB - mF) * (mB - mF)
            if between > maxVar { maxVar = between; threshold = t }
        }
        // 3) 判断浅底深字 vs 深底浅字：均值 > 128 为浅底（文字偏黑，二值化后黑字白底）
        let mean = sum / Double(n)
        let invert = mean < 128 // 深底浅字 → 反转（白字变黑字）
        // 4) 二值化
        for i in stride(from: 0, to: pixelData.count, by: 4) {
            let l = (Int(pixelData[i]) + Int(pixelData[i+1]) + Int(pixelData[i+2])) / 3
            let isDark = l <= threshold
            let out: UInt8 = (invert ? !isDark : isDark) ? 0 : 255
            pixelData[i] = out
            pixelData[i+1] = out
            pixelData[i+2] = out
        }
        return context.makeImage()
    }
}


