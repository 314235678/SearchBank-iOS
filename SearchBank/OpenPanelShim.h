// OpenPanelShim.h
// Objective-C shim for WKUIDelegate file picker (where WKOpenPanelParameters
// is forward-declared in WebKit framework and unusable directly from Swift).

#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

@interface OpenPanelShim : NSObject <WKUIDelegate>
- (instancetype)initWithPresenter:(UIViewController *)presenter
                           backend:(id<WKUIDelegate>)backend;
@end
