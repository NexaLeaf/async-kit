const path = require('path');

module.exports = {
  moduleNameMapper: {
    '^@async-kit/limitx$': path.join(__dirname, 'packages/limitx/src/index.ts'),
    '^@async-kit/retryx$': path.join(__dirname, 'packages/retryx/src/index.ts'),
    '^@async-kit/flowx$': path.join(__dirname, 'packages/flowx/src/index.ts'),
    '^@async-kit/ratelimitx$': path.join(__dirname, 'packages/ratelimitx/src/index.ts'),
    '^@async-kit/cachex$': path.join(__dirname, 'packages/cachex/src/index.ts'),
    '^@async-kit/eventx$': path.join(__dirname, 'packages/eventx/src/index.ts'),
    '^@async-kit/workflowx$': path.join(__dirname, 'packages/workflowx/src/index.ts'),
  },
  testEnvironment: 'node',
};
