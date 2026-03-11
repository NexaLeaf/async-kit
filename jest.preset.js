const path = require('path');

module.exports = {
  moduleNameMapper: {
    '^@async-kit/limitx$': path.join(__dirname, 'packages/limitx/src/index.ts'),
    '^@async-kit/retryx$': path.join(__dirname, 'packages/retryx/src/index.ts'),
    '^@async-kit/flowx$': path.join(__dirname, 'packages/flowx/src/index.ts'),
    '^@async-kit/ratelimitx$': path.join(__dirname, 'packages/ratelimitx/src/index.ts'),
  },
  testEnvironment: 'node',
};
