import Foundation

/// App 沙盒本地存储：把网页 DATA 持久化到 Documents/SearchBank/data.json，
/// 绕开 localStorage 的 5MB 限制，关 App 重开也不丢。
/// 同时让用户能从「文件 App → 我的 iPhone → SearchBank」看到/拷贝这个文件。
enum LocalStore {

    /// 沙盒内数据文件路径。Documents/ 下，方便通过 Files App 可见。
    static func dataFileURL() -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let dir  = docs.appendingPathComponent("SearchBank", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("data.json")
    }

    /// 读取数据文件，不存在/异常时返回 nil（让 web 端走默认种子）。
    static func read() -> String? {
        let url = dataFileURL()
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            return try String(contentsOf: url, encoding: .utf8)
        } catch {
            // 损坏时不要崩，打回 nil 让前端重新 seed
            return nil
        }
    }

    /// 原子写入：写临时文件再 rename，避免写到一半被强退导致损坏。
    static func write(_ text: String) -> Bool {
        let url = dataFileURL()
        let tmp = url.deletingLastPathComponent()
            .appendingPathComponent("data.json.tmp-\(UUID().uuidString)")
        do {
            try text.write(to: tmp, atomically: true, encoding: .utf8)
            // 覆盖前先清掉旧文件
            if FileManager.default.fileExists(atPath: url.path) {
                _ = try? FileManager.default.removeItem(at: url)
            }
            try FileManager.default.moveItem(at: tmp, to: url)
            return true
        } catch {
            try? FileManager.default.removeItem(at: tmp)
            return false
        }
    }

    /// 把 data.json 暴露给「文件 App」：在 Documents 根留一个软链入口。
    /// iOS 已开 UIFileSharingEnabled，这里再把 SearchBank/ 目录里挂一份易找名字。
    static func ensureFinderVisible() {
        let url = dataFileURL()
        let docs = url.deletingLastPathComponent().deletingLastPathComponent()
        let alias = docs.appendingPathComponent("搜题数据(data).json")
        // 仅当缺失或过期时复制（避免每次启动完整拷贝大文件）
        if let srcAttr = try? FileManager.default.attributesOfItem(atPath: url.path),
           let dstAttr = try? FileManager.default.attributesOfItem(atPath: alias.path) {
            let sM = (srcAttr[.modificationDate] as? Date) ?? .distantPast
            let dM = (dstAttr[.modificationDate] as? Date) ?? .distantPast
            if sM == dM { return }
        }
        try? FileManager.default.removeItem(at: alias)
        try? FileManager.default.copyItem(at: url, to: alias)
    }
}
