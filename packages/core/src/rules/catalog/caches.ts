import type { Rule } from '../../types';

export const cacheRules: Rule[] = [
  {
    schemaVersion: 1,
    id: 'homebrew.cache',
    title: 'Homebrew download cache',
    category: 'dev',
    tier: 1,
    requires: ['homebrew'],
    roots: ['~/Library/Caches/Homebrew'],
    matcher: { kind: 'path', path: '~/Library/Caches/Homebrew' },
    action: 'brew-cleanup',
    rationale:
      'Homebrew keeps the bottles and source tarballs it downloads here only so a reinstall does not re-download them; installed formulae do not read from this cache, so clearing it cannot break a package.',
    regeneration:
      'Homebrew re-downloads any bottle or source it needs again from its taps, which costs network bandwidth.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'node.npm-cache',
    title: 'npm content-addressable cache',
    category: 'dev',
    tier: 1,
    requires: ['node'],
    roots: ['~/.npm/_cacache'],
    matcher: { kind: 'path', path: '~/.npm/_cacache' },
    action: 'npm-cache-clean',
    rationale:
      'npm stores every package tarball it has ever fetched in a content-addressed cache; no installed project depends on it, and npm validates and re-fetches anything it needs.',
    regeneration:
      'The next `npm install` re-downloads the tarballs it is missing, which needs network access.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'node.pnpm-store',
    title: 'pnpm global content store',
    category: 'dev',
    tier: 1,
    requires: ['pnpm'],
    roots: ['~/Library/pnpm/store'],
    matcher: { kind: 'path', path: '~/Library/pnpm/store' },
    action: 'pnpm-store-prune',
    rationale:
      'pnpm’s prune only removes packages that no project on this machine references, so every package an installed project still needs stays in the store and nothing breaks.',
    regeneration:
      'The removed packages are fetched again the next time a project installs a dependency that needs them.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'node.yarn-cache',
    title: 'Yarn classic global cache',
    category: 'dev',
    tier: 1,
    requires: ['yarn'],
    roots: ['~/Library/Caches/Yarn'],
    matcher: { kind: 'path', path: '~/Library/Caches/Yarn' },
    action: 'yarn-cache-clean',
    rationale:
      'This is the Yarn classic global cache of downloaded tarballs; it is a re-downloadable copy and installing a project again does not need it. Yarn 2+ and newer keep their caches inside each project instead.',
    regeneration:
      'Yarn re-downloads the tarballs it needs from the registry the next time you install.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'node.gyp-cache',
    title: 'node-gyp build caches',
    category: 'dev',
    tier: 1,
    roots: ['~/Library/Caches/node-gyp'],
    matcher: { kind: 'glob-children', root: '~/Library/Caches/node-gyp' },
    action: 'remove-path',
    rationale:
      'node-gyp caches the Node headers and built tools per version so native addons can compile offline; these are machine-local build artifacts with no source or user data in them.',
    regeneration:
      'node-gyp re-downloads the Node headers when a native addon is next built, which needs network access.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'python.uv-cache',
    title: 'uv package cache',
    category: 'dev',
    tier: 1,
    requires: ['uv'],
    roots: ['~/.cache/uv'],
    matcher: { kind: 'path', path: '~/.cache/uv' },
    action: 'uv-cache-clean',
    rationale:
      'uv keeps downloaded wheels, sdists and built wheels in its cache purely to avoid re-resolving them; installed virtualenvs hold their own copies of everything they use.',
    regeneration:
      'uv downloads and rebuilds the wheels it needs again on the next sync, which needs network access.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'python.pip-cache',
    title: 'pip wheel cache',
    category: 'dev',
    tier: 1,
    requires: ['python'],
    roots: ['~/Library/Caches/pip'],
    matcher: { kind: 'path', path: '~/Library/Caches/pip' },
    action: 'remove-dir-contents',
    rationale:
      'This folder only holds wheels pip downloaded or built earlier; pip never reads it except to skip a download, and installed packages live in their own site-packages.',
    regeneration:
      'pip downloads and rebuilds any needed wheel again on the next install, which needs network access.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'go.build-cache',
    title: 'Go build cache',
    category: 'dev',
    tier: 0,
    requires: ['go'],
    roots: ['~/Library/Caches/go-build'],
    matcher: { kind: 'path', path: '~/Library/Caches/go-build' },
    action: 'go-clean-build',
    rationale:
      'The Go build cache holds compiled package objects and test results keyed by inputs; go rebuilds anything missing from source, so clearing it only costs compile time.',
    regeneration:
      'Nothing to download. Go recompiles the packages it needs on the next build, which is slower the first time.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'go.mod-cache',
    title: 'Go module download cache',
    category: 'dev',
    tier: 1,
    requires: ['go'],
    roots: ['~/go/pkg/mod'],
    matcher: { kind: 'path', path: '~/go/pkg/mod' },
    action: 'go-clean-mod',
    rationale:
      'This is only the extracted copy of modules downloaded from proxy servers; module source of record is the version control repository, so a cleared cache is never the only copy of anything you wrote.',
    regeneration:
      'Go re-downloads every module version a project imports on the next build, which needs network access.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'rust.cargo-registry-cache',
    title: 'Cargo registry tarballs',
    category: 'dev',
    tier: 1,
    requires: ['rust'],
    roots: ['~/.cargo/registry/cache'],
    matcher: { kind: 'glob-children', root: '~/.cargo/registry/cache' },
    action: 'remove-path',
    rationale:
      'Cargo keeps the crate archives it downloaded here after unpacking them; the unpacked sources and every project’s Cargo.lock stay put, so builds remain reproducible.',
    regeneration:
      'Cargo re-downloads the needed crate archives from crates.io on the next build, which needs network access.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'ruby.cocoapods-cache',
    title: 'CocoaPods pod cache',
    category: 'dev',
    tier: 1,
    requires: ['cocoapods'],
    roots: ['~/Library/Caches/CocoaPods'],
    matcher: { kind: 'path', path: '~/Library/Caches/CocoaPods' },
    action: 'remove-dir-contents',
    rationale:
      'CocoaPods caches pod source checkouts to speed up installs; each project’s Podfile.lock and its Pods folder already pin and contain what it needs.',
    regeneration:
      'CocoaPods clones the pods again the next time you run `pod install`, which needs network access.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'xcode.caches',
    title: 'Xcode caches',
    category: 'dev',
    tier: 0,
    requires: ['xcode'],
    roots: ['~/Library/Caches/com.apple.dt.Xcode'],
    matcher: { kind: 'path', path: '~/Library/Caches/com.apple.dt.Xcode' },
    action: 'remove-dir-contents',
    preflight: { processes: ['Xcode'] },
    rationale:
      'Xcode’s own on-disk caches (module, index and asset catalogs); no project, source or device data lives here and Xcode regenerates them from the project itself.',
    regeneration:
      'Nothing to download. Xcode rebuilds these caches as you open and build projects, which is slower the first time.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'simulator.dyld-cache',
    title: 'Simulator dyld shared caches (system)',
    category: 'dev',
    tier: 0,
    requires: ['xcode'],
    roots: ['/Library/Developer/CoreSimulator/Caches/dyld'],
    matcher: { kind: 'path', path: '/Library/Developer/CoreSimulator/Caches/dyld' },
    action: null,
    needsRoot: true,
    manualCommand: 'sudo rm -rf /Library/Developer/CoreSimulator/Caches/dyld/*',
    preflight: { bootedSimulators: true },
    rationale:
      'System-wide dyld shared caches shared by all users; they are rebuilt on demand from the installed simulator runtimes, so removing them loses nothing but is a root operation macsweep will not run for you.',
    regeneration:
      'Nothing to download. The caches are rebuilt from local runtime images at the next simulator boot.',
  },
  {
    schemaVersion: 1,
    id: 'chrome.on-device-model',
    title: 'Chrome on-device AI model',
    category: 'browser',
    tier: 1,
    roots: ['~/Library/Application Support/Google/Chrome/OptGuideOnDeviceModel'],
    matcher: {
      kind: 'path',
      path: '~/Library/Application Support/Google/Chrome/OptGuideOnDeviceModel',
    },
    action: 'remove-path',
    manualCommand:
      'defaults write com.google.Chrome GenAILocalFoundationalModelSettings -int 1',
    preflight: { processes: ['Google Chrome'] },
    rationale:
      'The on-device model Chrome downloaded for its built-in AI features; nothing but that optional feature reads it, and browsing, profiles and saved data are untouched.',
    regeneration:
      'Chrome re-downloads the model (roughly 4 GB) the next time the feature is used, unless the GenAILocalFoundationalModelSettings policy above disables it.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'browser.chrome-code-cache',
    title: 'Chrome code cache',
    category: 'browser',
    tier: 0,
    roots: ['~/Library/Caches/Google/Chrome'],
    matcher: { kind: 'path', path: '~/Library/Caches/Google/Chrome' },
    action: 'remove-dir-contents',
    preflight: { processes: ['Google Chrome'] },
    rationale:
      'Compiled JavaScript and WebAssembly bytecode Chrome caches per site; it holds no history, cookies or passwords, and Chrome simply recompiles what it needs.',
    regeneration:
      'Nothing to download. Chrome recompiles the bytecode as you browse, which is slower for the first visit to each site.',
    minBytes: 50e6,
  },
  {
    schemaVersion: 1,
    id: 'ai.ollama-models',
    title: 'Ollama model store',
    category: 'dev',
    tier: 1,
    roots: ['~/.ollama/models'],
    matcher: { kind: 'path', path: '~/.ollama/models' },
    action: null,
    manualCommand: 'ollama list',
    rationale:
      'Downloaded model weights are usually kept on purpose so they run offline, and macsweep cannot tell which ones you still use — remove one deliberately with `ollama rm <model>`.',
    regeneration:
      'Anything you remove must be pulled again with `ollama pull`, which costs network bandwidth.',
  },
  {
    schemaVersion: 1,
    id: 'ai.huggingface-hub',
    title: 'Hugging Face hub cache',
    category: 'dev',
    tier: 1,
    roots: ['~/.cache/huggingface/hub'],
    matcher: { kind: 'glob-children', root: '~/.cache/huggingface/hub' },
    action: null,
    manualCommand: 'huggingface-cli delete-cache',
    rationale:
      'Model and dataset downloads with many revisions, some of which your own code still loads; `huggingface-cli delete-cache` lets you pick interactively which revisions to drop.',
    regeneration:
      'Any removed revision is downloaded from the Hub again next time it is loaded, which costs bandwidth.',
  },
];
