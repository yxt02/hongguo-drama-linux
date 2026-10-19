const path = require('node:path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'update-linux-entry.cjs')],
  outfile: path.join(__dirname, '../build/linux-update.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['original-fs'],
});
