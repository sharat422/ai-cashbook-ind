module.exports = {
  preset: 'react-native',
  // On GitHub Actions, also report each failing test as an annotation on the
  // commit/PR (readable without opening the raw log). Locally: default output.
  reporters: process.env.GITHUB_ACTIONS
    ? ['default', ['github-actions', {silent: false}]]
    : ['default'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Mirror the babel module-resolver aliases so `@...` imports (and jest.mock
  // targets) resolve consistently under Jest.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
    '^@features/(.*)$': '<rootDir>/src/features/$1',
    '^@navigation/(.*)$': '<rootDir>/src/navigation/$1',
    '^@store/(.*)$': '<rootDir>/src/store/$1',
    '^@api/(.*)$': '<rootDir>/src/api/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@theme/(.*)$': '<rootDir>/src/theme/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
  },
};
