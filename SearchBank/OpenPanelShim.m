// OpenPanelShim.m
// Objective-C shim: implements WKUIDelegate.runOpenPanelWith (which references
// forward-declared WKOpenPanelParameters that Swift can't import directly),
// and forwards all other WKUIDelegate calls back to the host Swift ViewController.

#import "OpenPanelShim.h"
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <WebKit/WebKit.h>

@interface OpenPanelShim () <UIDocumentPickerDelegate, WKUIDelegate>
@property (nonatomic, copy) void (^currentCompletion)(NSArray<NSURL *> * _Nullable);
@property (nonatomic, weak) UIViewController *presenter;
@property (nonatomic, weak) id<WKUIDelegate> backend;
@end

@implementation OpenPanelShim

- (instancetype)initWithPresenter:(UIViewController *)presenter
                           backend:(id<WKUIDelegate>)backend {
    self = [super init];
    if (self) {
        _presenter = presenter;
        _backend = backend;
    }
    return self;
}

#pragma mark - WKUIDelegate (the one we need to override)

- (void)webView:(WKWebView *)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
              initiatedByFrame:(WKFrameInfo *)frame
             completionHandler:(void (^)(NSArray<NSURL *> * _Nullable))completionHandler {
    self.currentCompletion = [completionHandler copy];
    NSMutableArray<UTType *> *types = [NSMutableArray arrayWithObject:[UTType typeWithIdentifier:@"public.image"]];
    UTType *docx = [UTType typeWithIdentifier:@"org.openxmlformats.wordprocessingml.document"];
    if (docx) { [types insertObject:docx atIndex:0]; }
    UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc]
        initForOpeningContentTypes:types asCopy:YES];
    // WKOpenPanelParameters 在 WebKit 中是 forward-declared 类，无法访问任何属性
    // （Swift、ObjC、KVC 都报 "forward declaration" 错）。
    // 保守默认单选；如果 WKWebView 上传需要多选，后续再用私有 API 反射。
    picker.allowsMultipleSelection = NO;
    picker.delegate = self;
    [self.presenter presentViewController:picker animated:YES completion:nil];
}

#pragma mark - UIDocumentPickerDelegate

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
    void (^cb)(NSArray<NSURL *> * _Nullable) = self.currentCompletion;
    self.currentCompletion = nil;
    if (cb) cb(urls);
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
    void (^cb)(NSArray<NSURL *> * _Nullable) = self.currentCompletion;
    self.currentCompletion = nil;
    if (cb) cb(nil);
}

#pragma mark - Forward everything else to the Swift backend

- (void)webView:(WKWebView *)webView
    runJavaScriptAlertPanelWithMessage:(NSString *)message
                       initiatedByFrame:(WKFrameInfo *)frame
                      completionHandler:(void (^)(void))completionHandler {
    if ([self.backend respondsToSelector:@selector(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:)]) {
        [self.backend webView:webView runJavaScriptAlertPanelWithMessage:message initiatedByFrame:frame completionHandler:completionHandler];
    } else { completionHandler(); }
}

- (void)webView:(WKWebView *)webView
    runJavaScriptConfirmPanelWithMessage:(NSString *)message
                       initiatedByFrame:(WKFrameInfo *)frame
                      completionHandler:(void (^)(BOOL))completionHandler {
    if ([self.backend respondsToSelector:@selector(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:)]) {
        [self.backend webView:webView runJavaScriptConfirmPanelWithMessage:message initiatedByFrame:frame completionHandler:completionHandler];
    } else { completionHandler(NO); }
}

- (void)webView:(WKWebView *)webView
    runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt
                                 defaultText:(NSString *)defaultText
                            initiatedByFrame:(WKFrameInfo *)frame
                           completionHandler:(void (^)(NSString * _Nullable))completionHandler {
    if ([self.backend respondsToSelector:@selector(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:)]) {
        [self.backend webView:webView runJavaScriptTextInputPanelWithPrompt:prompt defaultText:defaultText initiatedByFrame:frame completionHandler:completionHandler];
    } else { completionHandler(nil); }
}

@end
