#!/usr/bin/env node
/**
 * ============================================================================
 * VeloForge Model Scraper
 * ============================================================================
 * Scrapes PaintScratch to build a vehicle tree WITH real model breakdowns:
 *   make → model → year → colors
 *
 * Strategy per make:
 *   1. Fetch the make index page (e.g. /touch_up_paint/Porsche/)
 *   2. Look for model sub-page links: /touch_up_paint/Porsche/911/
 *   3. For each model, discover year links: /touch_up_paint/Porsche/911/YYYY.html
 *   4. Scrape colors per model/year
 *   5. If NO model sub-pages found, fall back to year-only scraping
 *      and store under the original "All Models" key (preserves existing data)
 *
 * OUTPUT:
 *   ./assets/vehicle-data-with-models.json
 *
 * USAGE:
 *   # All makes:
 *   node scrape-models.js
 *
 *   # Specific makes only:
 *   node scrape-models.js --makes Porsche,BMW,Ferrari
 *
 *   # Specific makes, recent years only:
 *   node scrape-models.js --makes Porsche --min-year 2015
 *
 *   # Resume interrupted run:
 *   node scrape-models.js --resume
 *
 *   # Quick test (1 make, last 3 years):
 *   node scrape-models.js --makes Porsche --min-year 2022 --max-year 2024
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const { URL } = require('url');

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  rateLimit:    800,   // ms delay between requests per worker
  concurrency:  4,     // parallel workers
  timeout:      15000, // request timeout ms
  maxRetries:   3,
  userAgent:    'VeloForge Color Research Bot/2.0 (respectful scraper; contact: dev@veloforge.com)',
  outputFile:   './assets/vehicle-data-with-models.json',
  baseUrl:      'https://www.paintscratch.com',
  catalogUrl:   'https://www.paintscratch.com/touch_up_paint/',
  minYear:      null,
  maxYear:      null,
  makesFilter:  null,
  resume:       false,
};

// ============================================================================
// CONCURRENCY POOL
// ============================================================================
class ConcurrencyPool {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }
  run(fn) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.running++;
        try { resolve(await fn()); }
        catch (err) { reject(err); }
        finally {
          this.running--;
          if (this.queue.length > 0) this.queue.shift()();
        }
      };
      if (this.running < this.concurrency) execute();
      else this.queue.push(execute);
    });
  }
}

// ============================================================================
// UTILITIES
// ============================================================================
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log  = msg => process.stdout.write(msg + '\n');
const info = msg => process.stdout.write('  ' + msg + '\n');
const ok   = msg => process.stdout.write('  ✓  ' + msg + '\n');
const warn = msg => process.stdout.write('  ⚠  ' + msg + '\n');
const fail = msg => process.stdout.write('  ✗  ' + msg + '\n');

// ============================================================================
// HTTP FETCHER
// ============================================================================
function fetchHTML(url, retries = CONFIG.maxRetries, skipRateLimit = false) {
  const doFetch = () => new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent':      CONFIG.userAgent,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection':      'close',
      },
      timeout: CONFIG.timeout,
    };
    const req = protocol.get(options, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchHTML(new URL(res.headers.location, url).href, retries, true)
          .then(resolve).catch(reject);
      }
      if (res.statusCode === 404) return reject(new Error('HTTP 404'));
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', async err => {
      if (retries > 0) { await sleep(1500); fetchHTML(url, retries - 1, true).then(resolve).catch(reject); }
      else reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      if (retries > 0) fetchHTML(url, retries - 1, true).then(resolve).catch(reject);
      else reject(new Error('Request timeout'));
    });
  });
  if (skipRateLimit) return doFetch();
  return sleep(CONFIG.rateLimit).then(doFetch);
}

// ============================================================================
// CATALOG DISCOVERY
// ============================================================================
async function discoverMakes() {
  log('\n📋 Discovering makes from catalog...');
  const html = await fetchHTML(CONFIG.catalogUrl, CONFIG.maxRetries, true);
  const makes = [];
  const seen = new Set();
  const pattern = /href="(?:https?:\/\/(?:www\.)?paintscratch\.com)?\/touch_up_paint\/([A-Za-z0-9][A-Za-z0-9-]*)\/"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const slug = match[1];
    if (['colors', 'all', 'page'].includes(slug.toLowerCase())) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    makes.push({ make: slug, slug, url: `${CONFIG.baseUrl}/touch_up_paint/${slug}/` });
  }
  log(`   Found ${makes.length} makes`);
  return makes;
}

// ============================================================================
// MODEL DISCOVERY
// ============================================================================
/**
 * From a make's index page, extract model sub-page links.
 * Model links look like /touch_up_paint/{make}/{model-slug}/
 * Year links look like /touch_up_paint/{make}/YYYY.html — these are excluded.
 *
 * @param {string} makeSlug  e.g. 'Porsche'
 * @returns {Promise<Array<{model: string, slug: string, url: string}>>}
 */
async function discoverModels(makeSlug) {
  const makeUrl = `${CONFIG.baseUrl}/touch_up_paint/${makeSlug}/`;
  const html = await fetchHTML(makeUrl, CONFIG.maxRetries, false);

  const models = [];
  const seen = new Set();

  // Match /touch_up_paint/{make}/{sub-slug}/ but NOT .html year pages
  const escapedMake = makeSlug.replace(/[-]/g, '[-]');
  const pattern = new RegExp(
    `href="(?:https?:\\/\\/(?:www\\.)?paintscratch\\.com)?\\/touch_up_paint\\/${escapedMake}\\/([A-Za-z0-9][A-Za-z0-9-]*)\\/?"`,
    'gi'
  );
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const subSlug = match[1];
    // Exclude bare 4-digit years and self-links
    if (/^\d{4}$/.test(subSlug)) continue;
    if (subSlug.toLowerCase() === makeSlug.toLowerCase()) continue;
    if (seen.has(subSlug)) continue;
    seen.add(subSlug);
    // Convert slug to display name: "911-carrera" → "911 Carrera"
    const displayName = subSlug
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    models.push({
      model: displayName,
      slug: subSlug,
      url: `${CONFIG.baseUrl}/touch_up_paint/${makeSlug}/${subSlug}/`,
    });
  }
  return models;
}

/**
 * Discover year links from a page (make or model index).
 * Handles both:
 *   /touch_up_paint/{make}/YYYY.html
 *   /touch_up_paint/{make}/{model}/YYYY.html
 *
 * @param {string} pageUrl
 * @param {string} html  already-fetched HTML (optional, will fetch if not provided)
 * @returns {Promise<Array<{year: number, url: string}>>}
 */
async function discoverYears(pageUrl, html = null) {
  if (!html) html = await fetchHTML(pageUrl, CONFIG.maxRetries, false);
  const years = [];
  const seen = new Set();
  // Match any year link with a 4-digit year followed by .html
  const pattern = /href="([^"]*\/(\d{4})\.html)"/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const year = parseInt(match[2], 10);
    if (seen.has(year)) continue;
    seen.add(year);
    if (CONFIG.minYear && year < CONFIG.minYear) continue;
    if (CONFIG.maxYear && year > CONFIG.maxYear) continue;
    const yearUrl = match[1].startsWith('http')
      ? match[1]
      : new URL(match[1], CONFIG.baseUrl).href;
    years.push({ year, url: yearUrl });
  }
  years.sort((a, b) => b.year - a.year);
  return years;
}

// ============================================================================
// COLOR PARSING
// ============================================================================
function generateFallbackHex(colorName) {
  const name = colorName.toLowerCase();
  const map = {
    red: '#CC0000', black: '#0A0A0A', white: '#F5F5F5', blue: '#0066CC',
    green: '#006633', yellow: '#FFD700', orange: '#FF6600', silver: '#C0C0C0',
    grey: '#808080', gray: '#808080', purple: '#663399', brown: '#8B4513',
    gold: '#CFB53B', beige: '#F5F5DC', cream: '#FFFDD0', burgundy: '#800020',
    maroon: '#800000', navy: '#000080', teal: '#008080', turquoise: '#40E0D0',
    bronze: '#CD7F32', champagne: '#F7E7CE', charcoal: '#36454F', copper: '#B87333',
  };
  for (const [keyword, hex] of Object.entries(map)) {
    if (name.includes(keyword)) return hex;
  }
  return '#888888';
}

function parseColors(html, make, yearOrModel) {
  const colors = [];
  const label = `PaintScratch ${yearOrModel} ${make}`;

  // Strategy 1: JSON-LD itemListElement
  const jsonLdMatch = html.match(/"itemListElement":\s*\[([\s\S]*?)\]/);
  if (jsonLdMatch) {
    try {
      const items = JSON.parse('[' + jsonLdMatch[1] + ']');
      for (const item of items) {
        if (item['@type'] !== 'ListItem' || !item.name || !item.url) continue;
        const nameMatch = item.name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (nameMatch) {
          const [, displayName, paintCode] = nameMatch;
          const urlObj = new URL(item.url);
          const slug = urlObj.pathname.split('/').filter(Boolean).pop();
          colors.push({ display_name: displayName.trim(), paint_code: paintCode.trim(),
            slug, reference_url: item.url, source_label: label });
        }
      }
    } catch (_) {}
  }

  // Strategy 2: inline JSON objects
  if (colors.length === 0) {
    for (const [, fullName, url] of html.matchAll(
      /\{"@type":"ListItem"[^}]*?"name":"([^"]+)"[^}]*?"url":"([^"]+)"/g
    )) {
      const nm = fullName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (!nm) continue;
      const [, displayName, paintCode] = nm;
      const urlObj = new URL(url);
      const slug = urlObj.pathname.split('/').filter(Boolean).pop();
      colors.push({ display_name: displayName.trim(), paint_code: paintCode.trim(),
        slug, reference_url: url, source_label: label });
    }
  }

  // Strategy 3: color detail links
  if (colors.length === 0) {
    const seenSlugs = new Set();
    for (const [, slug] of html.matchAll(/\/colors\/[^/]+\/([a-z0-9-]+)\//g)) {
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      const nameFromSlug = slug.split('-').slice(0, -1)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      colors.push({ display_name: nameFromSlug || slug,
        paint_code: slug.split('-').pop().toUpperCase(),
        slug, reference_url: `${CONFIG.baseUrl}/colors/${make.toLowerCase()}/${slug}/`,
        source_label: label });
    }
  }

  // Apply fallback hex and deduplicate
  const seen = new Set();
  return colors.filter(c => {
    if (seen.has(c.paint_code)) return false;
    seen.add(c.paint_code);
    c.hex_value = generateFallbackHex(c.display_name);
    return true;
  });
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================
async function main() {
  log('');
  log('🎨 VeloForge Model Scraper — Make → Model → Year → Colors');
  log('='.repeat(60));

  // Parse CLI args
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--makes' && args[i + 1]) {
      CONFIG.makesFilter = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--min-year' && args[i + 1]) {
      CONFIG.minYear = parseInt(args[++i], 10);
    } else if (args[i] === '--max-year' && args[i + 1]) {
      CONFIG.maxYear = parseInt(args[++i], 10);
    } else if (args[i] === '--resume') {
      CONFIG.resume = true;
    }
  }

  if (CONFIG.makesFilter) log(`Makes filter:   ${CONFIG.makesFilter.join(', ')}`);
  if (CONFIG.minYear)     log(`Min year:       ${CONFIG.minYear}`);
  if (CONFIG.maxYear)     log(`Max year:       ${CONFIG.maxYear}`);
  log('');

  // Load existing output if resuming
  let vehicleTree = {};
  if (CONFIG.resume && fs.existsSync(CONFIG.outputFile)) {
    try {
      const ex = JSON.parse(fs.readFileSync(CONFIG.outputFile, 'utf8'));
      vehicleTree = ex.vehicle_tree || {};
      log(`Resuming — loaded existing data for ${Object.keys(vehicleTree).length} makes`);
    } catch (_) {}
  }

  // Discover makes
  let allMakes = await discoverMakes();
  if (CONFIG.makesFilter) {
    const fl = CONFIG.makesFilter.map(m => m.toLowerCase());
    allMakes = allMakes.filter(m => fl.includes(m.slug.toLowerCase()));
    log(`After filter: ${allMakes.length} makes`);
  }

  const pool = new ConcurrencyPool(CONFIG.concurrency);
  const stats = { makes: 0, models: 0, years: 0, colors: 0, fails: 0 };

  const makePromises = allMakes.map(makeEntry =>
    pool.run(async () => {
      const { make, slug } = makeEntry;
      if (CONFIG.resume && vehicleTree[make]) {
        info(`Skipping ${make} (already in output)`);
        return;
      }

      try {
        // --- Step 1: Discover models ---
        const makeUrl = `${CONFIG.baseUrl}/touch_up_paint/${slug}/`;
        const makeHtml = await fetchHTML(makeUrl, CONFIG.maxRetries, false);
        const models = await discoverModels(slug);

        if (models.length > 0) {
          // Real model breakdown available
          info(`${make}: ${models.length} models found`);
          vehicleTree[make] = vehicleTree[make] || {};

          for (const { model, slug: modelSlug, url: modelUrl } of models) {
            const years = await discoverYears(modelUrl);
            if (years.length === 0) continue;

            vehicleTree[make][model] = vehicleTree[make][model] || {};

            for (const { year, url: yearUrl } of years) {
              if (vehicleTree[make][model][year]) continue; // resume skip
              try {
                const html = await fetchHTML(yearUrl, CONFIG.maxRetries, false);
                const colors = parseColors(html, slug, year);
                vehicleTree[make][model][year] = colors;
                stats.colors += colors.length;
                stats.years++;
              } catch (err) {
                warn(`${make}/${model}/${year}: ${err.message}`);
                stats.fails++;
              }
            }
            stats.models++;
          }
        } else {
          // No model sub-pages — fall back to year-only scraping under "All Models"
          info(`${make}: no model sub-pages, scraping by year`);
          const years = await discoverYears(makeUrl, makeHtml);
          if (years.length === 0) {
            warn(`${make}: no years found, skipping`);
            return;
          }

          vehicleTree[make] = vehicleTree[make] || {};
          vehicleTree[make]['All Models'] = vehicleTree[make]['All Models'] || {};

          for (const { year, url: yearUrl } of years) {
            if (vehicleTree[make]['All Models'][year]) continue;
            try {
              const html = await fetchHTML(yearUrl, CONFIG.maxRetries, false);
              const colors = parseColors(html, slug, year);
              vehicleTree[make]['All Models'][year] = colors;
              stats.colors += colors.length;
              stats.years++;
            } catch (err) {
              warn(`${make}/All Models/${year}: ${err.message}`);
              stats.fails++;
            }
          }
          stats.models++;
        }

        stats.makes++;
        ok(`${make} done`);

        // Incremental save every 5 makes
        if (stats.makes % 5 === 0) saveOutput(vehicleTree, stats);

      } catch (err) {
        fail(`${make}: ${err.message}`);
        stats.fails++;
      }
    })
  );

  await Promise.all(makePromises);
  saveOutput(vehicleTree, stats);

  log('');
  log('='.repeat(60));
  log('✅  Done!');
  log(`    Makes processed: ${stats.makes}`);
  log(`    Models found:    ${stats.models}`);
  log(`    Years scraped:   ${stats.years}`);
  log(`    Total colors:    ${stats.colors}`);
  log(`    Failures:        ${stats.fails}`);
  log(`    Output:          ${CONFIG.outputFile}`);
  log('');
}

function saveOutput(vehicleTree, stats) {
  const output = {
    metadata: {
      scraped_at:   new Date().toISOString(),
      scraper:      'scrape-models.js',
      total_makes:  Object.keys(vehicleTree).length,
      total_colors: stats.colors,
    },
    vehicle_tree: vehicleTree,
  };
  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
