const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'alias-better-sqlite3',
        setup(build) {
          build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
            external: true,
          }));
        },
      },
    ],
  });

  if (watch) {
    await ctx.watch();
    console.log('[watch] build started');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log(`[build] ${production ? 'production' : 'development'} build complete`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
