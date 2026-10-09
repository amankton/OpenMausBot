// Resource-bounded runner for the pinned Platform production webpack configurations.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { frontendMinifyOptions } from './frontend-minify-options.mjs';
import { frontendMemoryPolicy } from './frontend-memory-policy.mjs';

const source = fileURLToPath(new URL('../../../.chief-local/platform-source/', import.meta.url));
const omitDebugArtifacts = process.argv.includes('--omit-debug-artifacts');
const nativeMinify = process.argv.includes('--native-minify');
const constrainedMemory = process.argv.includes('--constrained-memory');
if (process.argv.slice(2).some(argument => !['--omit-debug-artifacts', '--native-minify', '--constrained-memory'].includes(argument))) throw new Error('Unknown build argument.');
if (process.platform !== 'win32') throw new Error('This bounded local runner requires the reviewed Windows memory guard.');
const availableHostKiB = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'], { encoding: 'utf8', windowsHide: true }).trim());
const heapLimitMiB = getHeapStatistics().heap_size_limit / 1024 ** 2;
const memoryPolicy = frontendMemoryPolicy(heapLimitMiB, { constrained: constrainedMemory });
console.log(`Host memory profile: ${memoryPolicy.profile}; start ${memoryPolicy.minimumStartMiB} MiB, running minimum ${memoryPolicy.minimumRunningMiB} MiB.`);
const memoryMeasurements = [];
function checkMemory(minimumKiB) {
  const availableKiB = availableHostKiB();
  memoryMeasurements.push({ at: new Date().toISOString(), availableKiB, rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2) });
  if (!Number.isFinite(availableKiB) || availableKiB < minimumKiB) throw new Error(`Host memory ${Math.round(availableKiB / 1024)} MiB is below the coordinated ${minimumKiB / 1024} MiB build guard.`);
}
checkMemory(memoryPolicy.minimumStartMiB * 1024);
const memoryMonitor = setInterval(() => {
  try { checkMemory(memoryPolicy.minimumRunningMiB * 1024); } catch (error) {
    console.error(error.message);
    process.exit(2); // Terminate only this owned build; never stop apps or containers.
  }
}, 5000);
memoryMonitor.unref();
const provenance = JSON.parse(await readFile(new URL('./source-provenance.json', import.meta.url), 'utf8'));
const revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (revision !== provenance.revision) throw new Error('Source revision differs from the reviewed release.');
const frontendChanges = () => [...new Set([
  ...execFileSync('git', ['-C', source, 'diff', '--name-only', '-z', '--', 'plugins', 'models', 'packages', 'dev/prod'], { encoding: 'utf8' }).split('\0'),
  ...execFileSync('git', ['-C', source, 'ls-files', '--others', '--exclude-standard', '-z', '--', 'plugins', 'models', 'packages', 'dev/prod'], { encoding: 'utf8' }).split('\0')
].filter(Boolean))].sort();
const changesAtStart = frontendChanges();
const inputFiles = [...new Set([
  ...provenance.modifiedFiles.map(file => file.path),
  ...changesAtStart,
  'plugins/love-resources/src/invites.ts',
  'plugins/love-resources/src/loveClient.ts',
  'plugins/love-resources/src/meetings.ts',
  'plugins/love/src/types.ts',
  'models/love/src/index.ts',
  'dev/prod/webpack.config.js',
  'common/config/rush/pnpm-lock.yaml',
  'common/temp/pnpm-lock.yaml'
])].sort();
const hashInputs = async () => Object.fromEntries(await Promise.all(inputFiles.map(async file =>
  [file, createHash('sha256').update(await readFile(join(source, file))).digest('hex')]
)));
const inputs = await hashInputs();
const buildRecipe = Object.fromEntries(await Promise.all(['build-frontend.mjs', 'frontend-minify-options.mjs', 'frontend-memory-policy.mjs'].map(async name =>
  [name, createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex')]
)));
const startedAt = new Date().toISOString();
// Heap limits and host headroom were validated before loading the compiler.
process.env.NODE_ENV = 'production';
process.env.DO_VALIDATE = 'false'; // Package/Svelte validation runs separately, serially.
process.env.GOMAXPROCS = '1';
process.chdir(join(source, 'dev', 'prod'));
const require = createRequire(join(source, 'dev', 'prod', 'package.json'));
const webpack = require('webpack');
const requireWebpack = createRequire(require.resolve('webpack/package.json'));
const TerserPlugin = requireWebpack('terser-webpack-plugin');
const configurations = require('./webpack.config.js');
const assets = new Map();
const AnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const { EsbuildPlugin } = require('esbuild-loader');
const esbuild = require('esbuild');
let minifierQueue = Promise.resolve();
const serialEsbuild = { transform(input, options) {
  const operation = minifierQueue.then(() => esbuild.transform(input, options));
  minifierQueue = operation.then(() => undefined, () => undefined);
  return operation;
} };
function boundedLoader(loader) {
  if (typeof loader !== 'object') return loader;
  if (loader.loader === 'esbuild-loader') return { ...loader, options: { ...loader.options, sourcemap: false } };
  if (loader.loader === 'svelte-loader') return { ...loader, options: {
    ...loader.options,
    compilerOptions: { ...loader.options.compilerOptions, enableSourcemap: false },
    preprocess: require('svelte-preprocess')({ postcss: true, sourceMap: false, scss: { implementation: require('sass') } })
  } };
  return loader;
}

for (const [index, original] of configurations.entries()) {
  let reportedProgress = -1;
  const config = {
    ...original,
    parallelism: 1,
    ...(omitDebugArtifacts ? {
      devtool: false,
      module: { ...original.module, rules: original.module.rules.map(rule => ({
        ...boundedLoader(rule),
        ...(Array.isArray(rule.use) ? { use: rule.use.map(boundedLoader) } : {})
      })) }
    } : {}),
    plugins: [...(original.plugins ?? []).filter(plugin => !omitDebugArtifacts || !(plugin instanceof AnalyzerPlugin)), new webpack.ProgressPlugin((fraction, phase) => {
      const progress = Math.floor(fraction * 10);
      if (progress > reportedProgress) {
        reportedProgress = progress;
        console.log(`${progress * 10}% ${phase}; RSS ${Math.round(process.memoryUsage().rss / 1024 ** 2)} MiB`);
      }
    })],
    optimization: { ...original.optimization, minimizer: [nativeMinify
      ? new EsbuildPlugin({ ...frontendMinifyOptions, implementation: serialEsbuild })
      : new TerserPlugin({ parallel: false })] }
  };
  console.log(`Building production frontend configuration ${index + 1}/${configurations.length} with one worker.`);
  const compiler = webpack(config);
  try {
    const stats = await new Promise((resolve, reject) => compiler.run((error, result) => error ? reject(error) : resolve(result)));
    console.log(stats.toString({ colors: false, all: false, errors: true, errorDetails: true, warnings: true, timings: true, assets: true }));
    if (stats.hasErrors()) throw new Error(`Frontend configuration ${index + 1} failed; inspect the private build log.`);
    for (const asset of stats.compilation.getAssets()) {
      const bytes = await readFile(join(config.output.path, asset.name));
      assets.set(asset.name, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  } finally {
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  }
}
if (JSON.stringify(frontendChanges()) !== JSON.stringify(changesAtStart) || JSON.stringify(await hashInputs()) !== JSON.stringify(inputs)) {
  throw new Error('Reviewed frontend source changed during compilation; rebuild before browser verification.');
}
await writeFile(join(source, '..', 'platform-build-logs', 'production-build-receipt.json'), JSON.stringify({
  sourceRevision: revision, startedAt, completedAt: new Date().toISOString(),
  nodeVersion: process.version, heapLimitMiB: getHeapStatistics().heap_size_limit / 1024 ** 2,
  workerCount: 1, productionConfigurationsPassed: configurations.length,
  omitDebugArtifacts,
  minifier: nativeMinify ? { name: 'EsbuildPlugin', esbuildVersion: esbuild.version, ...frontendMinifyOptions, serial: true } : { name: 'TerserPlugin', parallel: false },
  configurationDifferences: ['Sequential configurations', 'webpack parallelism=1', nativeMinify ? 'Pinned native EsbuildPlugin replaces Terser; transforms serialized and IIFE-scoped per chunk' : 'Terser parallel=false', 'Separate TypeScript/Svelte validation', ...(omitDebugArtifacts ? ['webpack devtool=false', 'esbuild source maps disabled', 'Svelte preprocess/compiler source maps disabled', 'BundleAnalyzerPlugin omitted'] : [])],
    imageDeployed: false, buildRecipe, memoryPolicy, memoryMeasurements, inputs, assets: Object.fromEntries([...assets.entries()].sort())
}, null, 2));
clearInterval(memoryMonitor);

