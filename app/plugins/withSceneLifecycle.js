// Adopts the UIKit scene-based life cycle, which the iOS 27 SDK requires at
// launch ("UIScene life cycle is required for apps built with this SDK").
// Expo SDK 57 ships the scene delegate (expo/ios/AppDelegates/ExpoAppSceneDelegate.swift)
// but its prebuild template still starts React Native from the app delegate,
// so this plugin wires it up — instead of hand-editing the generated ios/ dir:
//  - AppDelegate conforms to ExpoReactNativeFactoryProvider and no longer
//    creates the window (ExpoAppSceneDelegate does, per scene);
//  - Info.plist declares a scene manifest using EXExpoAppSceneDelegate.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins')

const WINDOW_BLOCK = /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\([\s\S]*?\)\s*\n#endif\n/

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') throw new Error('withSceneLifecycle expects a Swift AppDelegate')
    let src = cfg.modResults.contents
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace(
        'class AppDelegate: ExpoAppDelegate {',
        'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
      )
    }
    if (WINDOW_BLOCK.test(src)) {
      src = src.replace(
        WINDOW_BLOCK,
        '    // Window + startReactNative happen in ExpoAppSceneDelegate (scene life cycle).\n'
      )
    }
    if (!src.includes('ExpoReactNativeFactoryProvider') || src.includes('UIWindow(frame: UIScreen.main.bounds)')) {
      throw new Error('withSceneLifecycle: AppDelegate template changed — update the plugin')
    }
    cfg.modResults.contents = src
    return cfg
  })
}

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate'
          }
        ]
      }
    }
    return cfg
  })
}

module.exports = function withSceneLifecycle(config) {
  return withSceneManifest(withSceneAppDelegate(config))
}
