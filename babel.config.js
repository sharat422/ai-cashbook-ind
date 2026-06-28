module.exports = {
  presets: [
    ['module:@react-native/babel-preset', {}],
    'nativewind/babel',
  ],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./'],
        alias: {
          '@': './src',
          '@components': './src/components',
          '@features': './src/features',
          '@navigation': './src/navigation',
          '@store': './src/store',
          '@api': './src/api',
          '@config': './src/config',
          '@theme': './src/theme',
          '@utils': './src/utils',
        },
      },
    ],
    // react-native-reanimated/plugin must be listed last.
    'react-native-reanimated/plugin',
  ],
};
