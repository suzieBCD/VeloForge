#!/usr/bin/env node
/**
 * ============================================================================
 * VeloForge Automotive Paint Color Scraper - Full Catalog Edition
 * ============================================================================
 *
 * WHAT'S NEW vs scrape-paint-colors.js:
 *   - Auto-discovers ALL makes from PaintScratch catalog (80+ makes)
 *   - Auto-discovers ALL years per make (e.g. 1955–2027 for Porsche)
 *   - ConcurrencyPool: N parallel workers (default 4) — much faster
 *   - Incremental saves: progress written after every vehicle
 *   - Resume mode: skips already-scraped make/year combos
 *   - Year range filter: --min-year / --max-year
 *   - Make filter: --makes Porsche,BMW,Ferrari
 *   - Optional hex fetching: --no-hex to skip (much faster, just names/codes)
 *
 * USAGE:
 *   Full catalog (all makes, all years, no hex):
 *     node scrape-paint-colors-full.js --no-hex
 *
 *   Full catalog with hex values (slow, ~hours):
 *     node scrape-paint-colors-full.js --hex-per-vehicle 5
 *
 *   Specific makes, recent years only:
 *     node scrape-paint-colors-full.js --makes Porsche,BMW,Ferrari --min-year 2015
 *
 *   Resume interrupted run:
 *     node scrape-paint-colors-full.js --resume
 *
 *   Quick test:
 *     node scrape-paint-colors-full.js --makes Porsche --min-year 2020 --max-year 2024
 *
 * OUTPUT:
 *   ./assets/vehicle-data-scraped.json  (same format as original scraper)
 *
 * RATE LIMITING:
 *   With default concurrency=4 and 800ms delay per worker,
 *   effective rate is ~5 req/s — respectful and stable.
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
  // Delay between requests PER WORKER (ms). Lower = faster but riskier.
  rateLimit: 800,

  // Number of parallel workers for vehicle page fetching.
  // 4 is a good balance: fast enough without overloading the server.
  concurrency: 4,

  // Max concurrent hex color fetches (separate pool, lower to be safe)
  hexConcurrency: 3,

  // How many hex values to fetch per vehicle page (0 = none)
  hexPerVehicle: 0,

  // Request timeout in ms
  timeout: 15000,

  // Max retries per request
  maxRetries: 3,

  // User agent — identifies this bot to the server
  userAgent: 'VeloForge Color Research Bot/2.0 (respectful scraper; contact: dev@veloforge.com)',

  // Where to save output (same location as original scraper)
  outputFile: './assets/vehicle-data-scraped.json',

  // Progress file for resume support
  progressFile: './assets/vehicle-data-progress.json',

  // Only scrape years within this range (inclusive). null = no limit.
  minYear: null,
  maxYear: null,

  // If set, only scrape these makes (case-insensitive)
  makesFilter: null,   // e.g. ['Porsche', 'BMW', 'Ferrari']

  // Resume mode: skip make/year combos already in outputFile
  resume: false,

  // Hard limit on total vehicles to scrape (null = unlimited). Useful for testing.
  limit: null,

  // Base URL
  baseUrl: 'https://www.paintscratch.com',
  catalogUrl: 'https://www.paintscratch.com/touch_up_paint/',
};

// ============================================================================
// CONCURRENCY POOL
// ============================================================================
/**
 * Limits the number of async operations running simultaneously.
 * Uses a simple queue: tasks wait until a slot is free.
 */
class ConcurrencyPool {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  /**
   * Run fn() as soon as a slot is free.
   * @param {() => Promise<any>} fn
   */
  run(fn) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.running++;
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          this.running--;
          if (this.queue.length > 0) {
            this.queue.shift()();
          }
        }
      };

      if (this.running < this.concurrency) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }
}

// ============================================================================
// UTILITIES
// ============================================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg)  { process.stdout.write(msg + '\n'); }
function info(msg) { process.stdout.write('  ' + msg + '\n'); }
function warn(msg) { process.stdout.write('  ⚠  ' + msg + '\n'); }
function ok(msg)   { process.stdout.write('  ✓  ' + msg + '\n'); }
function fail(msg) { process.stdout.write('  ✗  ' + msg + '\n'); }

// ============================================================================
// HTTP FETCHER
// ============================================================================
/**
 * Fetch HTML from url with retries, redirect following, and proper headers.
 * Each call sleeps CONFIG.rateLimit ms BEFORE making the request so that
 * concurrent workers spread out naturally.
 *
 * @param {string} url
 * @param {number} retries
 * @param {boolean} [skipRateLimit=false] - skip sleep (used for catalog/discovery)
 * @returns {Promise<string>} HTML content
 */
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

    const req = protocol.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = new URL(res.headers.location, url);
        return fetchHTML(redirectUrl.href, retries, true).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) {
        reject(new Error('HTTP 404'));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', async (error) => {
      if (retries > 0) {
        await sleep(1500);
        fetchHTML(url, retries - 1, true).then(resolve).catch(reject);
      } else {
        reject(error);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      if (retries > 0) {
        fetchHTML(url, retries - 1, true).then(resolve).catch(reject);
      } else {
        reject(new Error('Request timeout'));
      }
    });
  });

  if (skipRateLimit) return doFetch();
  return sleep(CONFIG.rateLimit).then(doFetch);
}

// ============================================================================
// CATALOG DISCOVERY
// ============================================================================
/**
 * Scrape the PaintScratch catalog index and return all make names + URLs.
 * e.g. [{ make: 'Porsche', url: 'https://www.paintscratch.com/touch_up_paint/Porsche/' }, ...]
 *
 * @returns {Promise<Array<{make: string, url: string, colorCount: number}>>}
 */
async function discoverMakes() {
  log('\n📋 Discovering makes from catalog...');
  const html = await fetchHTML(CONFIG.catalogUrl, CONFIG.maxRetries, true);

  const makes = [];
  const seen = new Set();

  // Match both relative (/touch_up_paint/Make/) and absolute (https://...Make/) hrefs
  // Exclude sub-pages that contain a dot (e.g. /911.html) or extra path segments
  const patterns = [
    // Absolute URL in href: href="https://www.paintscratch.com/touch_up_paint/Make/"
    /href="https?:\/\/(?:www\.)?paintscratch\.com\/touch_up_paint\/([A-Za-z0-9][A-Za-z0-9-]*)\/"/g,
    // Relative URL in href: href="/touch_up_paint/Make/"
    /href="\/touch_up_paint\/([A-Za-z0-9][A-Za-z0-9-]*)\/"/g,
    // Anchor text fallback: any /touch_up_paint/Make/ occurrence
    /\/touch_up_paint\/([A-Za-z0-9][A-Za-z0-9-]*)\//g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const slug = match[1];
      // Skip obvious non-make segments
      if (['colors', 'all', 'page'].includes(slug.toLowerCase())) continue;
      if (seen.has(slug)) continue;
      seen.add(slug);
      makes.push({
        make: slug,
        slug,
        url: `${CONFIG.baseUrl}/touch_up_paint/${slug}/`,
      });
    }
    if (makes.length > 20) break; // first pattern that gives good results
  }

  log(`   Found ${makes.length} makes`);
  return makes;
}

/**
 * Scrape a make's index page and return all available year entries.
 * Returns entries like: [{ year: 2024, url: '...Porsche/2024.html' }, ...]
 *
 * @param {string} makeUrl  e.g. https://www.paintscratch.com/touch_up_paint/Porsche/
 * @param {string} makeName e.g. 'Porsche'
 * @returns {Promise<Array<{year: number, url: string}>>}
 */
async function discoverYears(makeUrl, makeName) {
  const html = await fetchHTML(makeUrl, CONFIG.maxRetries, false);

  const years = [];
  const seen = new Set();
  // Year links: /touch_up_paint/{Make}/YYYY.html
  const escaped = makeName.replace(/[-]/g, '[-]');
  const pattern = new RegExp(
    `\\/touch_up_paint\\/${escaped}\\/(\\d{4})\\.html`,
    'gi'
  );
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const year = parseInt(match[1], 10);
    if (seen.has(year)) continue;
    seen.add(year);

    // Apply year range filter
    if (CONFIG.minYear && year < CONFIG.minYear) continue;
    if (CONFIG.maxYear && year > CONFIG.maxYear) continue;

    years.push({
      year,
      url: `${CONFIG.baseUrl}/touch_up_paint/${makeName}/${year}.html`,
    });
  }

  // Sort descending (newest first)
  years.sort((a, b) => b.year - a.year);
  return years;
}

// ============================================================================
// COLOR PARSING  (same logic as original, adapted for year pages)
// ============================================================================
/**
 * Parse color entries from a vehicle/year HTML page.
 * Tries JSON-LD structured data first, falls back to inline regex.
 *
 * @param {string} html
 * @param {string} make
 * @param {number|string} yearOrModel - year (number) or model (string)
 * @returns {Array<Object>} color objects
 */
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
          colors.push({
            display_name: displayName.trim(),
            paint_code:   paintCode.trim(),
            slug,
            reference_url: item.url,
            source_label:  label,
          });
        }
      }
    } catch (_) { /* fall through */ }
  }

  // Strategy 2: Inline JSON objects
  if (colors.length === 0) {
    const matches = [...html.matchAll(
      /\{"@type":"ListItem"[^}]*?"name":"([^"]+)"[^}]*?"url":"([^"]+)"/g
    )];
    for (const [, fullName, url] of matches) {
      const nameMatch = fullName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (!nameMatch) continue;
      const [, displayName, paintCode] = nameMatch;
      const urlObj = new URL(url);
      const slug = urlObj.pathname.split('/').filter(Boolean).pop();
      colors.push({
        display_name: displayName.trim(),
        paint_code:   paintCode.trim(),
        slug,
        reference_url: url,
        source_label:  label,
      });
    }
  }

  // Strategy 3: color detail links (/colors/{make}/{slug}/)
  if (colors.length === 0) {
    const colorPattern = /\/colors\/[^/]+\/([a-z0-9-]+)\//g;
    const seenSlugs = new Set();
    let m;
    while ((m = colorPattern.exec(html)) !== null) {
      const slug = m[1];
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      // Try to extract color name from nearby text — best-effort
      const nameFromSlug = slug
        .split('-')
        .slice(0, -1)  // last segment is often the code
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      colors.push({
        display_name:  nameFromSlug || slug,
        paint_code:    slug.split('-').pop().toUpperCase(),
        slug,
        reference_url: `${CONFIG.baseUrl}/colors/${make.toLowerCase()}/${slug}/`,
        source_label:  label,
      });
    }
  }

  // Deduplicate by paint_code
  const seen = new Set();
  return colors.filter(c => {
    const key = c.paint_code;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// HEX COLOR FETCHER  (same logic as original)
// ============================================================================
async function fetchHexColor(colorUrl) {
  try {
    const html = await fetchHTML(colorUrl, CONFIG.maxRetries, false);

    // Strategy 1: PaintScratch SSR data (most reliable)
    const ssr = html.match(/w\.PS_SSR\.hex="([0-9A-Fa-f]{6})"/);
    if (ssr) return '#' + ssr[1].toUpperCase();

    // Strategy 2: RGB triplet
    const rgb = html.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
    if (rgb) {
      const [, r, g, b] = rgb;
      return '#' + [r, g, b]
        .map(x => parseInt(x, 10).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    }

    // Strategy 3: Any hex color
    const hex = html.match(/#([0-9A-Fa-f]{6})\b/);
    if (hex) return '#' + hex[1].toUpperCase();

    // Strategy 4: color meta attributes
    const meta = html.match(/color["\s:]*#([0-9A-Fa-f]{6})/i);
    if (meta) return '#' + meta[1].toUpperCase();

    // Strategy 5: background-color CSS
    const bg = html.match(/background-color:\s*#([0-9A-Fa-f]{6})/i);
    if (bg) return '#' + bg[1].toUpperCase();

  } catch (_) { /* silent fail */ }
  return null;
}

/**
 * Fallback hex from color name when scraping fails.
 */
function generateFallbackHex(colorName) {
  const name = colorName.toLowerCase();
  const map = {
    red: '#CC0000',   black: '#0A0A0A', white: '#F5F5F5',
    blue: '#0066CC',  green: '#006633', yellow: '#FFD700',
    orange: '#FF6600',silver: '#C0C0C0',grey: '#808080',
    gray: '#808080',  purple: '#663399',brown: '#8B4513',
    gold: '#CFB53B',  beige: '#F5F5DC', cream: '#FFFDD0',
    burgundy: '#800020', maroon: '#800000', navy: '#000080',
    teal: '#008080',  turquoise: '#40E0D0', bronze: '#CD7F32',
    champagne: '#F7E7CE', charcoal: '#36454F', copper: '#B87333',
  };
  for (const [keyword, hex] of Object.entries(map)) {
    if (name.includes(keyword)) return hex;
  }
  return '#888888';
}

// ============================================================================
// VEHICLE SCRAPER
// ============================================================================
/**
 * Scrape colors for a single make+year page, including optional hex fetching.
 *
 * @param {string} make
 * @param {number} year
 * @param {string} url
 * @param {ConcurrencyPool} hexPool
 * @returns {Promise<Array>} colors with optional hex_value
 */
async function scrapeVehicle(make, year, url, hexPool) {
  const html = await fetchHTML(url, CONFIG.maxRetries, false);
  const colors = parseColors(html, make, year);

  if (colors.length === 0) return colors;

  // Fetch hex values if requested
  const hexLimit = Math.min(colors.length, CONFIG.hexPerVehicle);
  if (hexLimit > 0) {
    const hexPromises = colors.slice(0, hexLimit).map(color =>
      hexPool.run(async () => {
        const hex = await fetchHexColor(color.reference_url);
        color.hex_value = hex || generateFallbackHex(color.display_name);
        return color;
      })
    );
    await Promise.all(hexPromises);
  }

  // Fallback hex for remaining colors
  for (let i = hexLimit; i < colors.length; i++) {
    colors[i].hex_value = generateFallbackHex(colors[i].display_name);
  }

  return colors;
}

// ============================================================================
// PROGRESS / RESUME
// ============================================================================
function loadExistingOutput() {
  try {
    if (fs.existsSync(CONFIG.outputFile)) {
      const raw = fs.readFileSync(CONFIG.outputFile, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_) { /* corrupt file, start fresh */ }
  return null;
}

function saveOutput(vehicleTree, stats) {
  const output = {
    metadata: {
      scraped_at:      new Date().toISOString(),
      scraper_version: '2.0.0',
      rate_limit_ms:   CONFIG.rateLimit,
      concurrency:     CONFIG.concurrency,
      user_agent:      CONFIG.userAgent,
      success_count:   stats.success,
      fail_count:      stats.fail,
      skipped_count:   stats.skipped,
      total_vehicles:  stats.success + stats.fail,
      total_colors:    stats.totalColors,
    },
    vehicle_tree: vehicleTree,
  };
  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================
async function scrapeFullCatalog() {
  log('');
  log('🎨 VeloForge Paint Color Scraper v2.0 — Full Catalog Edition');
  log('='.repeat(60));
  log(`Concurrency:    ${CONFIG.concurrency} parallel workers`);
  log(`Rate limit:     ${CONFIG.rateLimit}ms per worker`);
  log(`Hex per vehicle:${CONFIG.hexPerVehicle}`);
  if (CONFIG.makesFilter)  log(`Makes filter:   ${CONFIG.makesFilter.join(', ')}`);
  if (CONFIG.minYear)      log(`Min year:       ${CONFIG.minYear}`);
  if (CONFIG.maxYear)      log(`Max year:       ${CONFIG.maxYear}`);
  if (CONFIG.limit)        log(`Vehicle limit:  ${CONFIG.limit}`);
  log('');

  // Load existing data if resuming
  let vehicleTree = {};
  const scraped = new Set(); // key: `${make}::${year}`
  if (CONFIG.resume) {
    const existing = loadExistingOutput();
    if (existing && existing.vehicle_tree) {
      vehicleTree = existing.vehicle_tree;
      for (const [make, models] of Object.entries(vehicleTree)) {
        for (const [, years] of Object.entries(models)) {
          for (const year of Object.keys(years)) {
            scraped.add(`${make}::${year}`);
          }
        }
      }
      log(`Resuming — already scraped: ${scraped.size} make/year combos`);
    }
  }

  // Phase 1: Discover makes
  let allMakes = await discoverMakes();

  // Apply makes filter
  if (CONFIG.makesFilter && CONFIG.makesFilter.length > 0) {
    const filterLower = CONFIG.makesFilter.map(m => m.toLowerCase());
    allMakes = allMakes.filter(m =>
      filterLower.includes(m.make.toLowerCase()) ||
      filterLower.includes(m.slug.toLowerCase())
    );
    log(`After filter: ${allMakes.length} makes selected`);
  }

  if (allMakes.length === 0) {
    log('❌ No makes to scrape. Check --makes filter.');
    return;
  }

  // Phase 2: Discover year URLs for each make
  log('\n📅 Discovering years per make...');
  const vehicleQueue = []; // [{make, year, url}]

  const discoverPool = new ConcurrencyPool(CONFIG.concurrency);
  const discoverPromises = allMakes.map(makeEntry =>
    discoverPool.run(async () => {
      try {
        const years = await discoverYears(makeEntry.url, makeEntry.slug);
        for (const { year, url } of years) {
          const key = `${makeEntry.make}::${year}`;
          if (CONFIG.resume && scraped.has(key)) continue;
          vehicleQueue.push({ make: makeEntry.make, slug: makeEntry.slug, year, url });
        }
        info(`${makeEntry.make}: ${years.length} years found`);
      } catch (err) {
        warn(`${makeEntry.make}: discovery failed (${err.message})`);
      }
    })
  );

  await Promise.all(discoverPromises);

  // Sort queue: alphabetical make, then descending year
  vehicleQueue.sort((a, b) =>
    a.make.localeCompare(b.make) || b.year - a.year
  );

  // Apply global vehicle limit
  const targets = CONFIG.limit ? vehicleQueue.slice(0, CONFIG.limit) : vehicleQueue;

  log(`\n🚗 Scraping ${targets.length} make/year combinations...`);
  log(`   (${scraped.size} already done, skipped)`);
  log('');

  // Phase 3: Scrape each make/year page concurrently
  const vehiclePool = new ConcurrencyPool(CONFIG.concurrency);
  const hexPool     = new ConcurrencyPool(CONFIG.hexConcurrency);

  const stats = { success: 0, fail: 0, skipped: scraped.size, totalColors: 0 };
  let completed = 0;

  // Count pre-existing colors
  for (const make of Object.values(vehicleTree)) {
    for (const models of Object.values(make)) {
      for (const colors of Object.values(models)) {
        if (Array.isArray(colors)) stats.totalColors += colors.length;
      }
    }
  }

  const scrapePromises = targets.map(({ make, slug, year, url }) =>
    vehiclePool.run(async () => {
      try {
        const colors = await scrapeVehicle(slug, year, url, hexPool);
        completed++;

        const pct = Math.round((completed / targets.length) * 100);
        const prefix = `[${completed}/${targets.length} ${pct}%]`;

        if (colors.length === 0) {
          info(`${prefix} ${make} ${year} — no colors found`);
          stats.fail++;
          return;
        }

        // Store in tree under canonical make name
        if (!vehicleTree[make]) vehicleTree[make] = {};
        // Use 'All Models' as the model key since year pages aggregate all models
        if (!vehicleTree[make]['All Models']) vehicleTree[make]['All Models'] = {};
        vehicleTree[make]['All Models'][year] = colors;

        stats.totalColors += colors.length;
        stats.success++;
        ok(`${prefix} ${make} ${year} — ${colors.length} colors`);

        // Incremental save every 20 successful vehicles
        if (stats.success % 20 === 0) {
          saveOutput(vehicleTree, stats);
          info(`Progress saved (${stats.success} vehicles, ${stats.totalColors} colors)`);
        }

      } catch (err) {
        completed++;
        stats.fail++;
        const pct = Math.round((completed / targets.length) * 100);
        fail(`[${completed}/${targets.length} ${pct}%] ${make} ${year} — ${err.message}`);
      }
    })
  );

  await Promise.all(scrapePromises);

  // Final save
  saveOutput(vehicleTree, stats);

  log('');
  log('='.repeat(60));
  log('✅  Scraping complete!');
  log(`    Successful:   ${stats.success}`);
  log(`    Failed:       ${stats.fail}`);
  log(`    Skipped:      ${stats.skipped}`);
  log(`    Total colors: ${stats.totalColors}`);
  log(`    Output:       ${CONFIG.outputFile}`);
  log('');
}

// ============================================================================
// LEGACY MODE: run original SCRAPE_TARGETS (for backward compatibility)
// ============================================================================
/**
 * Scrape a fixed list of targets, same interface as original scraper.
 * Used when --targets flag is passed or imported as a module.
 */
async function scrapeTargets(targets, limit = null) {
  const t = limit ? targets.slice(0, limit) : targets;
  log(`\n🎨 VeloForge Paint Color Scraper v2.0 — Legacy Targets Mode`);
  log('='.repeat(60));
  log(`Targets: ${t.length}`);

  const vehicleTree = {};
  const vehiclePool = new ConcurrencyPool(CONFIG.concurrency);
  const hexPool     = new ConcurrencyPool(CONFIG.hexConcurrency);
  const stats = { success: 0, fail: 0, skipped: 0, totalColors: 0 };
  let completed = 0;

  const promises = t.map(target =>
    vehiclePool.run(async () => {
      try {
        const colors = await scrapeVehicle(target.make, target.year, target.url, hexPool);
        completed++;
        if (colors.length === 0) { stats.fail++; return; }

        if (!vehicleTree[target.make]) vehicleTree[target.make] = {};
        if (!vehicleTree[target.make][target.model]) vehicleTree[target.make][target.model] = {};
        vehicleTree[target.make][target.model][target.year] = colors;
        stats.totalColors += colors.length;
        stats.success++;
        ok(`[${completed}/${t.length}] ${target.year} ${target.make} ${target.model} — ${colors.length} colors`);
      } catch (err) {
        completed++;
        stats.fail++;
        fail(`[${completed}/${t.length}] ${target.year} ${target.make} ${target.model} — ${err.message}`);
      }
    })
  );

  await Promise.all(promises);
  saveOutput(vehicleTree, stats);
  log(`\n✅  Done! ${stats.success} vehicles, ${stats.totalColors} colors → ${CONFIG.outputFile}`);
  return { vehicleTree, stats };
}

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================
function parseArgs(argv) {
  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '--concurrency':
        CONFIG.concurrency = parseInt(args[++i], 10) || 4;
        break;
      case '--delay':
        CONFIG.rateLimit = parseInt(args[++i], 10) || 800;
        break;
      case '--hex-per-vehicle':
        CONFIG.hexPerVehicle = parseInt(args[++i], 10) || 0;
        break;
      case '--no-hex':
        CONFIG.hexPerVehicle = 0;
        break;
      case '--all-hex':
        CONFIG.hexPerVehicle = Infinity;
        break;
      case '--makes':
        CONFIG.makesFilter = args[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--min-year':
        CONFIG.minYear = parseInt(args[++i], 10);
        break;
      case '--max-year':
        CONFIG.maxYear = parseInt(args[++i], 10);
        break;
      case '--limit':
        CONFIG.limit = parseInt(args[++i], 10);
        break;
      case '--output':
        CONFIG.outputFile = args[++i];
        break;
      case '--resume':
        CONFIG.resume = true;
        break;
      default:
        warn(`Unknown argument: ${arg}`);
    }
    i++;
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================
if (require.main === module) {
  parseArgs(process.argv);
  scrapeFullCatalog().catch(err => {
    process.stderr.write('\n❌ Fatal error: ' + err.message + '\n');
    process.stderr.write(err.stack + '\n');
    process.exit(1);
  });
}

module.exports = { scrapeFullCatalog, scrapeTargets, fetchHTML, parseColors };
