/** @type {import('jest').Config} */
export default {
  displayName: '@async-kit/cachex',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: '../../coverage/packages/cachex',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/index.ts'],
};
