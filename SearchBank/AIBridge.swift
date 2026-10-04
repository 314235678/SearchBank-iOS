import Foundation

/// AI 通道（对应电脑版 main.js 里的 ai:ask / ai:chat / ai:proof / ai:recognize）
///
/// 为什么放在原生侧而不是网页里直接 fetch：
///   1. WKWebView 用 file:// 加载页面，Origin 为 null，几乎所有模型服务端都会
///      因 CORS 拒绝 —— 网页里写 fetch 等于把整条 AI 链路做成"看运气"。
///   2. API Key 留在沙盒里，不进页面上下文，也不会上传到任何第三方。
///
/// 协议：任意 OpenAI 兼容的 /chat/completions（DeepSeek、OpenAI、月之暗面、
///       硅基流动、本机 Ollama 等），与电脑版保持完全一致。
enum AIBridge {

    struct Model {
        let baseUrl: String
        let apiKey: String
        let modelName: String

        var isDeepSeek: Bool {
            baseUrl.lowercased().contains("deepseek") || modelName.lowercased().contains("deepseek")
        }
    }

    /// 从 JS 传来的 payload 里取模型配置；缺任何一项都算没配好。
    static func parseModel(_ payload: [String: Any]) -> Model? {
        let b = (payload["baseUrl"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let k = (payload["apiKey"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let m = (payload["modelName"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !b.isEmpty else { return nil }
        guard !k.isEmpty else { return nil }
        guard !m.isEmpty else { return nil }
        return Model(baseUrl: b, apiKey: k, modelName: m)
    }

    // MARK: - 提示词（与电脑版 main.js 逐字一致，保证两端结果可比）

    static let askSystem =
        "你是一个答题助手。用户给你题目和选项，请直接给出：1) 答案（选项字母或 正确/错误）；2) 简要解析。如果不能确定请明确说'无法确定'，不要瞎猜。回答保持简洁。"

    static let proofSystem =
        "你是严谨的中文 OCR 校对员，对照原图片逐字核对识别文本，只输出 JSON。"

    static let recognizeSystem =
        "你是严谨的中文 OCR 转写员，把题目截图逐字转成 JSON，只输出 JSON。"

    /// 图片 → 结构化题目。与电脑版 AI_RECOGNIZE_PROMPT 保持一致。
    static let recognizePrompt: String = [
        "图片里是一道中文考试题（煤矿安全生产培训类）。请把图片内容**逐字转写**成 JSON。",
        "",
        "要求：",
        "1. 只转写图中真实存在的内容，一个字都不要改写、补充、缩写或润色。",
        "2. 题干里若出现填空空位（图片上是一对空括号或一条横线），统一写成「（）」。",
        "3. 选项标号统一用大写 A、B、C…；判断题、填空题若没有选项，options 就给空数组。",
        "4. 题型从 单选题/多选题/判断题/填空题/简答题 里选一个。",
        "5. 答案只填图片上明确写出来的（如「正确答案 ABCD」「答案：A」）；图片没给出答案就填空字符串。",
        "6. 判断题的 answer 一律填「正确」或「错误」：图上若标的是选项标号（作答界面里 A 通常对应「正确」、B 对应「错误」），请按选项的对应关系转换后填写。",
        "7. 图上若同时出现「正确答案」和「我的答案」两处答案（作答界面常见），只取「正确答案」那一处，绝不要取「我的答案」。",
        "8. 图中若有与本题无关的界面文字（软件表单、按钮、导航、页码），一律忽略，不要写进 JSON。",
        "9. 只输出 JSON，不要 markdown 代码块，不要任何解释。",
        "",
        // 注意：这里刻意**不给**真正的 JSON 示例。电脑版踩过坑 —— 开了
        // response_format=json_object 之后，模型会把示例当成"要输出的模板"照抄，
        // 两张完全不同的图都返回同一个与图无关的结果。改用文字描述字段。
        "输出对象的字段：type 是题型字符串；stem 是题干原文；options 是数组，每个元素含 label（选项标号）与 text（选项原文）；answer 是答案字符串。"
    ].joined(separator: "\n")

    // MARK: - 底层调用

    /// 调一次 /chat/completions。completion 回调结果形如
    ///   {ok:true, content:"...", usage:{...}}
    ///   {ok:false, error:"..."}   （可能附带 reasoning）
    static func ask(model: Model,
                    messages: [[String: Any]],
                    temperature: Double = 0.6,
                    maxTokens: Int = 2048,
                    extra: [String: Any]? = nil,
                    timeout: TimeInterval = 240,
                    completion: @escaping ([String: Any]) -> Void) {

        var urlStr = model.baseUrl
        while urlStr.hasSuffix("/") { urlStr.removeLast() }
        urlStr += "/chat/completions"
        guard let url = URL(string: urlStr) else {
            completion(["ok": false, "error": "接口地址不合法：" + model.baseUrl])
            return
        }

        var payload: [String: Any] = [
            "model": model.modelName,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": maxTokens,
            "stream": false
        ]
        if let extra = extra {
            for (k, v) in extra { payload[k] = v }
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = timeout
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer " + model.apiKey, forHTTPHeaderField: "Authorization")
        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            completion(["ok": false, "error": "请求体构造失败：" + error.localizedDescription])
            return
        }

        let task = URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err {
                let ns = err as NSError
                let msg = (ns.code == NSURLErrorTimedOut)
                    ? "请求超时（接口无响应，模型可能在长时间思考）"
                    : "网络错误：" + err.localizedDescription
                completion(["ok": false, "error": msg])
                return
            }
            guard let data = data else {
                completion(["ok": false, "error": "接口没有返回内容"])
                return
            }
            if let http = resp as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                var msg = "HTTP \(http.statusCode)"
                if let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let e = j["error"] as? [String: Any] {
                    if let m = e["message"] as? String { msg = m }
                } else if let raw = String(data: data, encoding: .utf8), !raw.isEmpty {
                    msg += "：" + String(raw.prefix(300))
                }
                completion(["ok": false, "error": msg])
                return
            }

            guard let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(["ok": false, "error": "接口返回的不是合法 JSON"])
                return
            }
            let choices = j["choices"] as? [[String: Any]]
            let ch = choices?.first ?? [:]
            let msgObj = ch["message"] as? [String: Any] ?? [:]
            let content = (msgObj["content"] as? String) ?? ""

            if content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                // 电脑版实测过：推理模型把思考过程计入 max_tokens，
                // 额度不够时 content 会是空串。给一句能诊断的提示。
                let reasoning = (msgObj["reasoning_content"] as? String)
                    ?? (msgObj["reasoning"] as? String) ?? ""
                let finish = ch["finish_reason"] as? String ?? ""
                let msg = (finish == "length")
                    ? "AI 思考过程占满了输出额度，没来得及给结论（可重试，或改用非推理模型）"
                    : "AI 返回了空内容"
                var r: [String: Any] = ["ok": false, "error": msg]
                if !reasoning.isEmpty { r["reasoning"] = reasoning }
                completion(r)
                return
            }

            var r: [String: Any] = ["ok": true, "content": content]
            if let usage = j["usage"] { r["usage"] = usage }
            completion(r)
        }
        task.resume()
    }

    /// DeepSeek 专用：关掉思考 + 原生 JSON 模式。
    ///
    /// 这两个参数**必须成对**（电脑版实测）：
    ///   只关思考不开 JSON 模式 → 模型直接回 [] 敷衍，0.5s / 输出 1 token。
    /// 若开了 response_format 被端点拒（个别中转会 400），自动丢掉它再试一次。
    static func askJSON(model: Model,
                        messages: [[String: Any]],
                        temperature: Double = 0.2,
                        maxTokens: Int = 4096,
                        completion: @escaping ([String: Any]) -> Void) {
        if !model.isDeepSeek {
            // 非 DeepSeek（含本机 Ollama）：不发私有参数，另附 keep_alive=0
            // 让本机模型跑完立刻卸载，别常驻内存。
            ask(model: model, messages: messages,
                temperature: temperature, maxTokens: maxTokens,
                extra: ["keep_alive": 0],
                completion: completion)
            return
        }
        let best: [String: Any] = [
            "thinking": ["type": "disabled"],
            "response_format": ["type": "json_object"]
        ]
        ask(model: model, messages: messages,
            temperature: temperature, maxTokens: maxTokens, extra: best) { r1 in
            if (r1["ok"] as? Bool) == true {
                completion(r1)
                return
            }
            ask(model: model, messages: messages,
                temperature: temperature, maxTokens: maxTokens,
                extra: ["thinking": ["type": "disabled"]]) { r2 in
                completion((r2["ok"] as? Bool) == true ? r2 : r1)
            }
        }
    }

    // MARK: - 四个业务入口

    /// 普通问答
    static func handleAsk(_ payload: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        guard let model = parseModel(payload) else {
            completion(["ok": false, "error": "未配置 AI 模型（请在 设置 里添加）"])
            return
        }
        let prompt = payload["prompt"] as? String ?? ""
        guard !prompt.isEmpty else {
            completion(["ok": false, "error": "问题为空"])
            return
        }
        let messages: [[String: Any]] = [
            ["role": "system", "content": askSystem],
            ["role": "user", "content": prompt]
        ]
        ask(model: model, messages: messages, temperature: 0.3, maxTokens: 2048, completion: completion)
    }

    /// 多轮聊天
    static func handleChat(_ payload: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        guard let model = parseModel(payload) else {
            completion(["ok": false, "error": "未配置 AI 模型（请在 设置 里添加）"])
            return
        }
        guard let messages = payload["messages"] as? [[String: Any]], !messages.isEmpty else {
            completion(["ok": false, "error": "消息为空"])
            return
        }
        ask(model: model, messages: messages, temperature: 0.7, maxTokens: 2048, completion: completion)
    }

    /// 图文校对（对照原图逐字纠错）
    static func handleProof(_ payload: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        guard let model = parseModel(payload) else {
            completion(["ok": false, "error": "未配置 AI 模型（请在 设置 里添加）"])
            return
        }
        let prompt = payload["prompt"] as? String ?? ""
        guard !prompt.isEmpty else {
            completion(["ok": false, "error": "内容为空"])
            return
        }
        let images = (payload["images"] as? [String]) ?? []

        // 有图 → OpenAI 视觉格式：content 数组（text + image_url × N）
        let userContent: Any
        if images.isEmpty {
            userContent = prompt
        } else {
            var arr: [[String: Any]] = [["type": "text", "text": prompt]]
            arr.append(contentsOf: images.map { u in
                ["type": "image_url", "image_url": ["url": u]]
            })
            userContent = arr
        }
        let messages: [[String: Any]] = [
            ["role": "system", "content": proofSystem],
            ["role": "user", "content": userContent]
        ]
        askJSON(model: model, messages: messages, temperature: 0.2, maxTokens: 4096, completion: completion)
    }

    /// 整图 → 结构化题目 JSON
    static func handleRecognize(_ payload: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        guard let model = parseModel(payload) else {
            completion(["ok": false, "error": "未配置 AI 模型（请在 设置 里添加）"])
            return
        }
        let image = payload["image"] as? String ?? ""
        guard !image.isEmpty else {
            completion(["ok": false, "error": "图片数据为空"])
            return
        }
        let messages: [[String: Any]] = [
            ["role": "system", "content": recognizeSystem],
            ["role": "user", "content": [
                ["type": "text", "text": recognizePrompt],
                ["type": "image_url", "image_url": ["url": image]]
            ]]
        ]
        // temperature=0：转写任务不需要"发挥"，也让同一张图每次结果可复现
        askJSON(model: model, messages: messages, temperature: 0.0, maxTokens: 2048, completion: completion)
    }
}
