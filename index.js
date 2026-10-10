/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {initSentry} from './src/services/sentry/sentry';

// Initialize crash reporting before anything else runs. No-op when no
// SENTRY_DSN is baked into the build (dev/staging).
initSentry();

AppRegistry.registerComponent(appName, () => App);
