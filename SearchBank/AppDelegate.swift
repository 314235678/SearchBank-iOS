import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.backgroundColor = .systemBackground
        let root = ViewController()
        window?.rootViewController = root
        window?.makeKeyAndVisible()
        return true
    }

    // iOS 13+ 新版 URL 处理
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
        // 通知所有监听者（ViewController 收到后注入 JS 调 __SB.processURL）
        NotificationCenter.default.post(name: .searchBankOpenURL, object: nil, userInfo: ["url": url.absoluteString])
        return true
    }
}

extension Notification.Name {
    /// 用户通过 searchbank:// URL scheme 打开 App 时触发；userInfo 含 {url: "searchbank://..."}
    static let searchBankOpenURL = Notification.Name("com.searchbank.openURL")
}
