#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(GameCenterPlugin, "GameCenter",
    CAP_PLUGIN_METHOD(authenticate, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(submitScore, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(reportAchievement, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(showLeaderboard, CAPPluginReturnPromise);
)
