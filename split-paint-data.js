#!/usr/bin/env node
/**
 * split-paint-data.js
 * Splits a monolithic vehicle paint JSON into:
 *   assets/paint-index.json          — list of make display names
 *   assets/paint-data-{slug}.json    — per-make subtree (models → years → colors)
 *
 * Usage:
 *   node split-paint-data.js [source-file]
 *   node split-paint-data.js vehicle-data-scraped.json
 *
 * Default source: assets/vehicle-data-expanded.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, 'assets');

/** Same slug function used in the browser configurator JS */
function makeSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const sourceArg = process.argv[2];
const sourcePath = sourceArg
  ? path.resolve(__dirname, sourceArg)
  : path.join(ASSETS_DIR, 'vehicle-data-expanded.json');

if (!fs.existsSync(sourcePath)) {
  console.error(`Error: source file not found: ${sourcePath}`);
  process.exit(1);
}

console.log(`Reading: ${sourcePath}`);
const raw = fs.readFileSync(sourcePath, 'utf8');
const parsed = JSON.parse(raw);
const vehicleTree = parsed.vehicle_tree || parsed;

const makes = Object.keys(vehicleTree);
console.log(`Found ${makes.length} makes`);

// Write index
const indexPath = path.join(ASSETS_DIR, 'paint-index.json');
fs.writeFileSync(indexPath, JSON.stringify({ makes }, null, 2), 'utf8');
console.log(`Wrote: ${path.relative(__dirname, indexPath)}`);

// Write per-make chunks
for (const make of makes) {
  const slug = makeSlug(make);
  const chunkPath = path.join(ASSETS_DIR, `paint-data-${slug}.json`);
  fs.writeFileSync(chunkPath, JSON.stringify(vehicleTree[make], null, 2), 'utf8');
  const models = Object.keys(vehicleTree[make]);
  const colorCount = models.reduce((sum, model) => {
    return sum + Object.values(vehicleTree[make][model]).reduce((s, years) => s + years.length, 0);
  }, 0);
  const sizeKb = Math.round(fs.statSync(chunkPath).size / 1024);
  console.log(`  ${path.basename(chunkPath)} (${sizeKb}KB, ${models.length} models, ${colorCount} colors)`);
}

console.log(`\nDone. ${makes.length + 1} files written to assets/`);
