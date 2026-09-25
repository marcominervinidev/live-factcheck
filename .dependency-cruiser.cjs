/**
 * Module boundaries (brief 4.2), enforced in pre-commit and CI.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-service-to-service',
      comment: 'Services never import each other; they talk via events and HTTP/WebSocket only.',
      severity: 'error',
      from: { path: '^services/([^/]+)/' },
      to: { path: '^services/', pathNot: '^services/$1/' },
    },
    {
      name: 'no-app-to-service',
      comment: 'Apps reach services over the network, never via imports.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^services/' },
    },
    {
      name: 'no-tests-to-service-internals',
      comment: 'System and E2E tests exercise the running stack, not service source code.',
      severity: 'error',
      from: { path: '^tests/' },
      to: { path: '^(services|apps)/' },
    },
    {
      name: 'no-package-to-app-or-service',
      comment: 'Shared packages must not depend on the code that consumes them.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(apps|services)/' },
    },
    {
      name: 'only-package-entry-points',
      comment:
        'Other workspaces may import a package only through its declared exports (resolved to src/index.ts, src/testing/index.ts or src/bin/healthcheck.ts in development).',
      severity: 'error',
      from: { path: '^(apps|services|tests|packages)/([^/]+)/' },
      to: {
        path: '^packages/([^/]+)/',
        pathNot: [
          '^packages/$2/',
          '^packages/[^/]+/src/(index|testing/index|bin/healthcheck)\\.ts$',
        ],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-undeclared-dependency',
      comment: 'Every npm import must be declared in the importing workspace package.json.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
  ],
  options: {
    includeOnly: '^(apps|services|packages|tests)/',
    exclude: { path: '(^|/)(node_modules|dist|coverage)/' },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['development', 'import', 'types', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
  },
};
