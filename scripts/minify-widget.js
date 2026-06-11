#!/usr/bin/env node
/**
 * scripts/minify-widget.js
 *
 * Produces public/widget.min.js from public/widget.js.
 * Run: node scripts/minify-widget.js
 * Or add to package.json: "build:widget": "node scripts/minify-widget.js"
 *
 * Requires: npm install --save-dev terser
 */

const { minify } = require('terser');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

async function run() {
  const src = readFileSync(join(__dirname, '../public/widget.js'), 'utf-8');

  const result = await minify(src, {
    compress: {
      drop_console: false, // keep console.error for [StoryWidget] errors
      passes: 2,
    },
    mangle: true,
    format: {
      comments: false,
    },
  });

  if (!result.code) throw new Error('Minification produced no output');

  const outPath = join(__dirname, '../public/widget.min.js');
  writeFileSync(outPath, result.code, 'utf-8');

  const inKb = (src.length / 1024).toFixed(1);
  const outKb = (result.code.length / 1024).toFixed(1);
  console.log(`✓ widget.min.js  ${inKb} KB → ${outKb} KB`);
}

run().catch((err) => {
  console.error('Minification failed:', err.message);
  process.exit(1);
});
