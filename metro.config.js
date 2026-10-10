const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const {withNativeWind} = require('nativewind/metro');

// Sentry metro wrapper — uploads the JS bundle sourcemap for release builds.
// Guarded require so Metro still boots if @sentry/react-native isn't
// installed yet (run `npm ci` after adding the dependency).
let withSentryConfig = config => config;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  withSentryConfig = require('@sentry/react-native/metro').withSentryConfig;
} catch {
  // Sentry not installed — sourcemap upload skipped.
}

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = mergeConfig(getDefaultConfig(__dirname), {});

module.exports = withSentryConfig(withNativeWind(config, {input: './global.css'}));
