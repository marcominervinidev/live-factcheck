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
      comment:
        'System and E2E tests exercise the running stack, not service source code; tool workspaces under scripts/ use packages only.',
      severity: 'error',
      from: { path: '^(tests|scripts)/' },
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
      from: { path: '^(apps|services|tests|packages|scripts)/([^/]+)/' },
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
    {
      name: 'not-to-dev-dep-in-production',
      comment:
        'Production code of services and packages must not import devDependencies: the runtime image installs only dependencies, so the service would crash at start while every test passes (.ai/lessons.md, 2026-09-29). Type-only imports are erased and allowed; tests and test helpers may use devDependencies.',
      severity: 'error',
      from: {
        path: '^(services|packages)/[^/]+/src/',
        pathNot: ['\\.test\\.ts$', '/src/testing/'],
      },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    // npm packages are included as leaves (doNotFollow), so the npm rules below can see them.
    includeOnly: '^(apps|services|packages|tests|scripts/llm-scan)/|(^|/)node_modules/',
    exclude: { path: '(^|/)(dist|coverage)/' },
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
