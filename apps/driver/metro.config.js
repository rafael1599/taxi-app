const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root for hoisted node_modules
config.watchFolders = [monorepoRoot];

// Resolve modules from both the project and monorepo node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// ── CRITICAL: Force single React copy ─────────────────────────────────────
// The monorepo has 11+ nested copies of react@18.2.0 inside various packages.
// Having multiple React copies causes:
//   "TypeError: Cannot read property 'useRef' of null"
// in release builds (Hermes). We intercept ALL react imports at the resolver
// level and return the absolute path to the root copy.

const reactDir = path.resolve(monorepoRoot, 'node_modules', 'react');

// Map of module names to absolute file paths
const REACT_REDIRECTS = {
  'react': path.join(reactDir, 'index.js'),
  'react/jsx-runtime': path.join(reactDir, 'jsx-runtime.js'),
  'react/jsx-dev-runtime': path.join(reactDir, 'jsx-dev-runtime.js'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Direct redirect for react core imports
  if (REACT_REDIRECTS[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: REACT_REDIRECTS[moduleName],
    };
  }

  // Catch any other react/ sub-path (e.g., react/cjs/react.production.min.js)
  if (moduleName.startsWith('react/') && !moduleName.startsWith('react-')) {
    const subPath = moduleName.slice('react/'.length);
    const fullPath = path.join(reactDir, subPath);
    return {
      type: 'sourceFile',
      filePath: fullPath,
    };
  }

  // Default resolution for everything else
  return context.resolveRequest(context, moduleName, platform);
};

// Block nested react copies as additional safety
config.resolver.blockList = [
  /node_modules\/.*\/node_modules\/react\//,
  /node_modules\\.*\\node_modules\\react\\/,
];

module.exports = config;
