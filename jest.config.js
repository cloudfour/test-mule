module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    'test-mule': '<rootDir>/dist/cjs/index.cjs',
  },
  testRunner: 'jest-circus/runner',
  watchPathIgnorePatterns: ['<rootDir>/src/'],
  transform: {
    '^.+\\.[jt]sx?$': ['esbuild-jest', { sourcemap: true }],
  },
  // Don't transform node_modules, _except_ ansi-regex
  // ansi-regex is ESM and since we are jusing Jest in CJS mode,
  // it must be transpiled to ESM
  transformIgnorePatterns: ['<rootDir>/node_modules/(?!ansi-regex)'],
};
