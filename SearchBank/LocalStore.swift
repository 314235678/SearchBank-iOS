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

    // MARK: - 设置持久化（m6）

    /// 设置文件：Documents/SearchBank/settings.json。
    /// 与电脑版 <数据目录>/settings.json **同名同格式**，方便两边互相拷贝迁移。
    ///
    /// 为什么必须走文件：iOS 的 WKWebView 用 file:// 加载页面，这种"不透明来源"的
    /// localStorage 只存在内存里，App 一关就没了。桥接原本把 writeSettings 实现成
    /// "再写一份 localStorage"，等于写进了同一个临时抽屉 —— 用户看到的
    /// "添加 AI 模型保存后，重启就没了" 就是这么来的。
    static func settingsFileURL() -> URL {
        return dataFileURL().deletingLastPathComponent()
            .appendingPathComponent("settings.json")
    }

    /// 读取设置文件；不存在/损坏返回 nil（让前端走默认值）。
    static func readSettings() -> String? {
        let url = settingsFileURL()
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    /// 原子写入设置（写临时文件再 rename），与 data.json 同样的做法。
    static func writeSettings(_ text: String) -> Bool {
        let url = settingsFileURL()
        let tmp = url.deletingLastPathComponent()
            .appendingPathComponent("settings.json.tmp-\(UUID().uuidString)")
        do {
            try text.write(to: tmp, atomically: true, encoding: .utf8)
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

    // MARK: - 待导入备份的暂存（v3.0.1）

    /// 用户从电脑导出的备份可能有 8MB，base64 后约 10.7MB。
    /// 一次性把它塞进 evaluateJavaScript 的字符串参数既慢、又可能静默失败
    /// （失败时用户只看到"导入没反应"）。所以大文件先落到这里，
    /// 再由 JS 用 readImportChunk 分块取。
    /// 与 data.json 同目录；每次导入覆盖写，不会堆积。
    static func importStagingURL() -> URL {
        return dataFileURL().deletingLastPathComponent()
            .appendingPathComponent("import-staged.json")
    }

    /// 把选中的备份写进暂存文件；成功返回 URL，失败返回 nil（调用方退回 base64）。
    static func stageImport(_ data: Data) -> URL? {
        let url = importStagingURL()
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    /// 读取暂存文件的一段。返回 (base64 片段, 下一偏移, 是否读到末尾, 总大小)。
    ///
    /// 注意：这里返回的是**原始字节**的 base64 片段，JS 侧必须在字节层拼接
    /// 之后再整体解 UTF-8 —— 分块边界可能正好切在一个汉字中间，
    /// 逐块 decode 会把汉字拼成乱码。
    static func readImportChunk(offset: Int, length: Int) -> (b64: String, next: Int, eof: Bool, size: Int)? {
        let url = importStagingURL()
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }

        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let total = (attrs?[.size] as? Int) ?? 0

        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }

        // 上限 4MB：JS 侧按 256KB 请求，这个上限只是防御异常参数
        let want = max(1, min(length, 4 * 1024 * 1024))
        let start = max(0, min(offset, total))

        try? handle.seek(toOffset: UInt64(start))
        let chunk = (try? handle.read(upToCount: want)) ?? Data()
        let next = start + chunk.count

        return (chunk.base64EncodedString(), next, next >= total, total)
    }
}
