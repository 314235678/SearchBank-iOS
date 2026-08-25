// SearchBank-Bridging-Header.h
// 把 Objective-C 头文件暴露给 Swift 代码。
// 当前包含：OpenPanelShim（处理 WKUIDelegate 的 file picker 回调，
//                  因为 WKOpenPanelParameters 在 WebKit 中是 forward-declared，
//                  Swift 直接引用会报 "cannot find type"）。

#import "OpenPanelShim.h"
