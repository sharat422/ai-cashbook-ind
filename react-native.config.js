const path = require('path');

// react-native-config 1.6.x is not detected for Android autolinking by
// @react-native-community/cli (it reports `platforms.android: null`), so the
// `:react-native-config` Gradle project is never registered and the native
// module is never added to the PackageList. That breaks
// `apply from: project(':react-native-config')…/dotenv.gradle` in
// android/app/build.gradle and would leave `Config.*` empty at runtime.
//
// Force-declare its Android config so autolinking includes the Gradle subproject
// AND links the native module. iOS autolinks fine on its own and is left alone.
const rncRoot = path.dirname(require.resolve('react-native-config/package.json'));

module.exports = {
  dependencies: {
    'react-native-config': {
      root: rncRoot,
      platforms: {
        android: {
          sourceDir: path.join(rncRoot, 'android'),
          packageImportPath: 'import com.lugg.RNCConfig.RNCConfigPackage;',
          packageInstance: 'new RNCConfigPackage()',
        },
      },
    },
  },
};
