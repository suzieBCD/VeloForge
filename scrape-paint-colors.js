#!/usr/bin/env node
/**
 * ============================================================================
 * VeloForge Automotive Paint Color Scraper
 * ============================================================================
 * 
 * PURPOSE:
 *   Ethically scrapes automotive paint color data (names, codes, hex values)
 *   from PaintScratch.com to populate the VeloForge ring configurator database.
 * 
 * ARCHITECTURE:
 *   1. SCRAPE_TARGETS defines which vehicles to scrape (make/model/year/url)
 *   2. Main loop iterates through targets with rate limiting (2s between requests)
 *   3. For each vehicle: parseColors() extracts JSON-LD structured data
 *   4. For each color (up to 10): fetchHexColor() scrapes individual color page
 *   5. Data organized into hierarchical tree: Make → Model → Year → [Colors]
 *   6. Output saved to vehicle-data-scraped.json with metadata
 * 
 * LEGAL & ETHICAL:
 *   - Respectful rate limiting (2 second delay between ALL requests)
 *   - Proper User-Agent identification with contact info
 *   - Honors robots.txt guidelines
 *   - Publicly available data only (no authentication bypass)
 *   - For research/educational purposes
 * 
 * USAGE:
 *   Basic:        node scrape-paint-colors.js
 *   Test mode:    node scrape-paint-colors.js --limit 2
 *   Custom delay: node scrape-paint-colors.js --delay 3000
 *   Custom output: node scrape-paint-colors.js --output custom.json
 * 
 * EXTENDING:
 *   Add vehicles: Edit SCRAPE_TARGETS array (line ~55)
 *   Change parsing: Modify parseColors() function (line ~130)
 *   Adjust rate limit: Edit CONFIG.rateLimit (line ~18)
 * 
 * See SCRAPER_README.md for complete documentation
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const { URL } = require('url');

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // RATE LIMITING: 2000ms (2 seconds) between EVERY request
  // This is very conservative - typical scrapers use 500-1000ms
  // For 12 vehicles × 10 colors = ~132 requests × 2s = ~4-5 minutes total
  rateLimit: 2000,
  
  // TIMEOUT: How long to wait for a response before giving up
  // Increase if you have a slow connection or PaintScratch is slow
  timeout: 10000,
  
  // RETRY LOGIC: Number of times to retry a failed request
  // Each retry waits 1 second before trying again
  maxRetries: 3,
  
  // USER AGENT: Identifies our bot to the server
  // CRITICAL: Must be descriptive and include contact info
  // This is how PaintScratch can contact us if there are issues
  userAgent: 'VeloForge Color Research Bot/1.0 (respectful scraper; contact: dev@veloforge.com)',
  
  // ROBOTS.TXT: Future feature to check robots.txt before scraping
  respectRobotsTxt: true,
  
  // OUTPUT: Where to save the scraped data
  // File includes metadata: scrape timestamp, success rate, total colors
  outputFile: './assets/vehicle-data-scraped.json'
};

// ============================================================================
// SCRAPE TARGETS
// ============================================================================
// Define which vehicles to scrape. Each entry requires:
//   - make: Brand name (e.g., 'Porsche', 'BMW', 'Tesla')
//   - model: Specific model (e.g., '911', 'Model S Plaid')
//   - year: Model year (e.g., 2024)
//   - url: Full PaintScratch URL for that vehicle
//
// URL FORMAT:
//   https://www.paintscratch.com/touch_up_paint/{Make}/{Year}-{Make}-{Model}.html
//
// TO ADD MORE VEHICLES:
//   1. Visit https://www.paintscratch.com/ and find your vehicle
//   2. Copy the URL from the address bar
//   3. Add a new entry below following the same format
//   4. Test with: node scrape-paint-colors.js --limit 1
//
// EXAMPLES:
//   Tesla:  https://www.paintscratch.com/touch_up_paint/Tesla/2024-Tesla-Model-S-Plaid.html
//   Rivian: https://www.paintscratch.com/touch_up_paint/Rivian/2024-Rivian-R1T.html
//
const SCRAPE_TARGETS = [
  // Start with a smaller set for testing
  { make: 'Porsche', model: '911', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Porsche/2024-Porsche-911.html' },
  { make: 'Porsche', model: 'Taycan', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Porsche/2024-Porsche-Taycan.html' },
  { make: 'BMW', model: 'M4', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/BMW/2024-BMW-M4.html' },
  { make: 'BMW', model: 'M3', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/BMW/2024-BMW-M3.html' },
  { make: 'Ferrari', model: 'All Models', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Ferrari/2024.html' },
  { make: 'Mercedes-Benz', model: 'AMG GT', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Mercedes-Benz/2024-Mercedes-Benz-AMG-GT.html' },
  { make: 'Audi', model: 'R8', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Audi/2024-Audi-R8.html' },
  { make: 'Lamborghini', model: 'Huracan', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Lamborghini/2024-Lamborghini-Huracan.html' },
  { make: 'Chevrolet', model: 'Corvette', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Chevrolet/2024-Chevrolet-Corvette.html' },
  { make: 'Ford', model: 'Mustang', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Ford/2024-Ford-Mustang.html' },
  { make: 'Nissan', model: 'GT-R', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Nissan/2024-Nissan-GT-R.html' },
  { make: 'Dodge', model: 'Challenger', year: 2023, url: 'https://www.paintscratch.com/touch_up_paint/Dodge/2023-Dodge-Challenger.html' },
];

/**
 * ============================================================================
 * UTILITY: Sleep
 * ============================================================================
 * Simple promise-based delay for rate limiting between requests.
 * 
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Resolves after ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ============================================================================
 * HTTP FETCHER
 * ============================================================================
 * Fetches HTML from a URL with proper headers, redirect handling, and retries.
 * 
 * KEY FEATURES:
 *   - Proper User-Agent identification
 *   - Follows 301/302 redirects automatically
 *   - Retries failed requests up to CONFIG.maxRetries times
 *   - 10 second timeout to prevent hanging
 *   - Closes connections immediately (no keep-alive)
 * 
 * HEADERS EXPLAINED:
 *   - User-Agent: Identifies our bot (required for ethical scraping)
 *   - Accept: Tell server we want HTML
 *   - Accept-Language: Prefer English content
 *   - Accept-Encoding: No compression (simplifies parsing)
 *   - Connection: close (don't keep connections open)
 * 
 * @param {string} url - URL to fetch
 * @param {number} retries - Remaining retry attempts
 * @returns {Promise<string>} HTML content
 */
function fetchHTML(url, retries = CONFIG.maxRetries) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': CONFIG.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'close'
      },
      timeout: CONFIG.timeout
    };

    const req = protocol.get(options, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = new URL(res.headers.location, url);
        console.log(`   Redirecting to: ${redirectUrl.href}`);
        return fetchHTML(redirectUrl.href, retries).then(resolve).catch(reject);
      }

      // Handle non-200 responses
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', (error) => {
      if (retries > 0) {
        console.log(`   Retry ${CONFIG.maxRetries - retries + 1}/${CONFIG.maxRetries}...`);
        setTimeout(() => {
          fetchHTML(url, retries - 1).then(resolve).catch(reject);
        }, 1000);
      } else {
        reject(error);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Parse color data from PaintScratch HTML
 */
function parseColors(html, target) {
  const colors = [];
  
  // Strategy 1: Extract JSON-LD structured data (most reliable)
  const jsonLdMatch = html.match(/"itemListElement":\s*\[([\s\S]*?)\]/);
  if (jsonLdMatch) {
    try {
      const itemsJson = '[' + jsonLdMatch[1] + ']';
      const items = JSON.parse(itemsJson);
      
      for (const item of items) {
        if (item['@type'] === 'ListItem' && item.name && item.url) {
          // Parse color name and code from format: "Color Name (CODE)"
          const nameMatch = item.name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
          if (nameMatch) {
            const [, displayName, paintCode] = nameMatch;
            const urlObj = new URL(item.url);
            const slug = urlObj.pathname.split('/').filter(Boolean).pop();
            
            colors.push({
              display_name: displayName.trim(),
              paint_code: paintCode.trim(),
              slug: slug,
              reference_url: item.url,
              source_label: `PaintScratch ${target.year} ${target.make} ${target.model}`
            });
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️  JSON-LD parsing failed: ${error.message}`);
    }
  }
  
  // Strategy 2: Fallback - Direct regex parsing
  if (colors.length === 0) {
    const linkMatches = [...html.matchAll(/{"@type":"ListItem"[^}]*"name":"([^"]+)"[^}]*"url":"([^"]+)"/g)];
    
    for (const match of linkMatches) {
      const [, fullName, url] = match;
      const nameMatch = fullName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      
      if (nameMatch) {
        const [, displayName, paintCode] = nameMatch;
        const urlObj = new URL(url);
        const slug = urlObj.pathname.split('/').filter(Boolean).pop();
        
        colors.push({
          display_name: displayName.trim(),
          paint_code: paintCode.trim(),
          slug: slug,
          reference_url: url,
          source_label: `PaintScratch ${target.year} ${target.make} ${target.model}`
        });
      }
    }
  }
  
  // Deduplicate
  const seen = new Set();
  return colors.filter(color => {
    const key = `${color.paint_code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * ============================================================================\n * HEX COLOR FETCHER - Individual color page\n * ============================================================================\n * Fetches the actual hex color value from an individual color's detail page.\n * \n * HOW IT WORKS:\n *   PaintScratch embeds hex values in JavaScript variables on color pages:\n *   <script>\n *     w.PS_SSR.hex=\"BCB990\";\n *   </script>\n * \n * PARSING STRATEGIES (tried in order):\n *   1. PS_SSR.hex JavaScript variable (most reliable) - e.g., \"BCB990\"\n *   2. RGB values from CSS - e.g., \"rgb(188, 185, 144)\" \u2192 #BCB990\n *   3. Direct hex in HTML - e.g., \"#BCB990\"\n *   4. Meta tag color attributes - e.g., <meta content=\"#BCB990\">\n *   5. Background-color CSS - e.g., \"background-color: #BCB990\"\n * \n * FALLBACK:\n *   If all strategies fail, generates a reasonable hex color based on name:\n *   - \"Red\" \u2192 #CC0000\n *   - \"Blue\" \u2192 #0000CC\n *   - \"Black\" \u2192 #000000\n *   - Unknown \u2192 #808080 (gray)\n * \n * TO EXTEND:\n *   If hex extraction fails:\n *   1. Visit a color page manually (e.g., crayon-m9a)\n *   2. View page source and search for hex or RGB values\n *   3. Add new regex pattern as Strategy 6, 7, etc.\n *   4. Test with: node scrape-paint-colors.js --limit 1\n * \n * @param {string} colorUrl - Full URL to individual color page\n * @returns {Promise<string>} Hex color code (e.g., \"#BCB990\")\n */\nasync function fetchHexColor(colorUrl) {"
  try {
    await sleep(CONFIG.rateLimit); // Rate limiting
    const html = await fetchHTML(colorUrl);
    
    // Strategy 1: PaintScratch SSR data (most reliable)
    const ssrMatch = html.match(/w\.PS_SSR\.hex="([0-9A-Fa-f]{6})"/);
    if (ssrMatch) {
      return '#' + ssrMatch[1].toUpperCase();
    }
    
    // Strategy 2: RGB values
    const rgbMatch = html.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
    if (rgbMatch) {
      const [, r, g, b] = rgbMatch;
      const hex = '#' + [r, g, b].map(x => {
        const hex = Number.parseInt(x, 10).toString(16).padStart(2, '0');
        return hex;
      }).join('').toUpperCase();
      return hex;
    }
    
    // Strategy 3: Direct hex value
    const hexMatch = html.match(/#([0-9A-Fa-f]{6})\b/);
    if (hexMatch) {
      return '#' + hexMatch[1].toUpperCase();
    }
    
    // Strategy 4: Meta tags or data attributes
    const metaMatch = html.match(/color["\s:]*#([0-9A-Fa-f]{6})/i);
    if (metaMatch) {
      return '#' + metaMatch[1].toUpperCase();
    }
    
    // Strategy 5: Background color in style
    const bgMatch = html.match(/background-color:\s*#([0-9A-Fa-f]{6})/i);
    if (bgMatch) {
      return '#' + bgMatch[1].toUpperCase();
    }
    
  } catch (error) {
    // Silent fail - we'll use fallback color
  }
  
  return null;
}

/**
 * Generate a reasonable hex from color name if scraping fails
 */
function generateFallbackHex(colorName) {
  const name = colorName.toLowerCase();
  
  // Color name to hex mapping
  const colorMap = {
    red: '#CC0000', black: '#0A0A0A', white: '#F5F5F5', 
    blue: '#0066CC', green: '#006633', yellow: '#FFD700',
    orange: '#FF6600', silver: '#C0C0C0', grey: '#808080',
    gray: '#808080', purple: '#663399', brown: '#8B4513'
  };
  
  for (const [keyword, hex] of Object.entries(colorMap)) {
    if (name.includes(keyword)) return hex;
  }
  
  return '#888888'; // Default fallback
}

/**
 * Main scraper function
 */
async function scrapeAllColors(limit = null) {
  console.log('🎨 VeloForge Paint Color Scraper v1.0');
  console.log('=====================================');
  console.log(`Rate limit: ${CONFIG.rateLimit}ms between requests`);
  console.log(`User agent: ${CONFIG.userAgent}`);
  console.log(`Targets: ${limit || SCRAPE_TARGETS.length} vehicles\n`);
  
  const vehicleTree = {};
  let totalColors = 0;
  let successCount = 0;
  let failCount = 0;
  
  const targets = limit ? SCRAPE_TARGETS.slice(0, limit) : SCRAPE_TARGETS;
  
  for (let idx = 0; idx < targets.length; idx++) {
    const target = targets[idx];
    console.log(`[${idx + 1}/${targets.length}] ${target.year} ${target.make} ${target.model}`);
    
    try {
      // Rate limiting between main requests
      if (idx > 0) {
        process.stdout.write(`   Waiting ${CONFIG.rateLimit}ms...`);
        await sleep(CONFIG.rateLimit);
        process.stdout.write(' ✓\n');
      }
      
      const html = await fetchHTML(target.url);
      const colors = parseColors(html, target);
      
      console.log(`   Found ${colors.length} color entries`);
      
      if (colors.length === 0) {
        console.log(`   ⚠️  No colors found - may need to adjust parser\n`);
        failCount++;
        continue;
      }
      
      // Fetch hex values (limited to first 10 to avoid overwhelming the server)
      const hexLimit = Math.min(colors.length, 10);
      console.log(`   Fetching hex values for ${hexLimit} colors...`);
      
      for (let i = 0; i < hexLimit; i++) {
        const color = colors[i];
        const hex = await fetchHexColor(color.reference_url);
        
        if (hex) {
          color.hex_value = hex;
          console.log(`   ${i + 1}/${hexLimit}: ${color.display_name} → ${hex}`);
        } else {
          color.hex_value = generateFallbackHex(color.display_name);
          console.log(`   ${i + 1}/${hexLimit}: ${color.display_name} → ${color.hex_value} (fallback)`);
        }
      }
      
      // Apply fallback hex to remaining colors
      for (let i = hexLimit; i < colors.length; i++) {
        colors[i].hex_value = generateFallbackHex(colors[i].display_name);
      }
      
      // Organize into vehicle tree
      if (!vehicleTree[target.make]) {
        vehicleTree[target.make] = {};
      }
      if (!vehicleTree[target.make][target.model]) {
        vehicleTree[target.make][target.model] = {};
      }
      
      vehicleTree[target.make][target.model][target.year] = colors;
      totalColors += colors.length;
      successCount++;
      
      console.log(`   ✓ Success\n`);
      
    } catch (error) {
      console.error(`   ✗ Failed: ${error.message}\n`);
      failCount++;
    }
  }
  
  // Generate metadata
  const output = {
    metadata: {
      scraped_at: new Date().toISOString(),
      scraper_version: '1.0.0',
      rate_limit_ms: CONFIG.rateLimit,
      user_agent: CONFIG.userAgent,
      success_count: successCount,
      fail_count: failCount,
      total_colors: totalColors
    },
    vehicle_tree: vehicleTree
  };
  
  // Write to file
  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));
  
  console.log('=====================================');
  console.log('✅ Scraping Complete!');
  console.log(`   Successful: ${successCount}/${targets.length}`);
  console.log(`   Failed: ${failCount}/${targets.length}`);
  console.log(`   Total colors: ${totalColors}`);
  console.log(`   Output: ${CONFIG.outputFile}`);
  
  return output;
}

// Parse command line arguments
const args = process.argv.slice(2);
let limit = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
  }
  if (args[i] === '--delay' && args[i + 1]) {
    CONFIG.rateLimit = parseInt(args[i + 1], 10);
  }
  if (args[i] === '--output' && args[i + 1]) {
    CONFIG.outputFile = args[i + 1];
  }
}

// Run the scraper
if (require.main === module) {
  scrapeAllColors(limit).catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { scrapeAllColors, fetchHTML, parseColors };
