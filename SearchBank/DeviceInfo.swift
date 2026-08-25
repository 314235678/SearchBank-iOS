import UIKit
import Darwin

/// 设备能力分级：根据机型映射为 low / mid / high，供网页端做自适应界面（动画、阴影、列表密度等）。
enum DeviceInfo {

    /// 返回形如 {"tier":"high","isTablet":false,"scale":3} 的 JSON 字符串，直接注入 JS。
    static func snapshotJSON() -> String {
        let dict: [String: Any] = [
            "tier": tier(),
            "isTablet": isTablet(),
            "scale": UIScreen.main.scale
        ]
        if let data = try? JSONSerialization.data(withJSONObject: dict),
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        return "{\"tier\":\"mid\",\"isTablet\":false,\"scale\":2}"
    }

    /// 性能分级
    static func tier() -> String {
        let model = machineModel()
        if model.hasPrefix("iPad") {
            return "high"
        }
        if model.hasPrefix("iPhone") {
            let gen = modelGeneration(model)
            if gen <= 10 { return "low" }      // iPhone 8 及更早（含 SE 1 代）
            if gen == 11 { return "mid" }      // iPhone XR / XS / 11
            return "high"                        // iPhone 12 及更新
        }
        return "mid"
    }

    static func isTablet() -> Bool {
        return UIDevice.current.userInterfaceIdiom == .pad
    }

    // MARK: - 私有

    /// 例如 "iPhone13,2" -> 13
    private static func modelGeneration(_ model: String) -> Int {
        let parts = model.split(separator: ",")
        guard parts.count == 2,
              let num = Int(parts[0].replacingOccurrences(of: "iPhone", with: "")
                                      .replacingOccurrences(of: "iPad", with: "")) else {
            return 12
        }
        return num
    }

    private static func machineModel() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        // 拷贝到局部变量再读取，避免 Swift 6 排他性检查的重叠访问
        var machine = systemInfo.machine
        return withUnsafeBytes(of: &machine) { raw in
            let cStr = raw.bindMemory(to: CChar.self).baseAddress!
            return String(cString: cStr)
        }
    }
}
