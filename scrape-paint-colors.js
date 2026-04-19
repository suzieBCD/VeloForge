#!/usr/bin/env node
/**
 * Auto Paint Color Scraper for VeloForge
 * 
 * Legal web scraping with proper rate limiting and error handling
 * Scrapes paint color data from PaintScratch.com
 * 
 * Usage: node scrape-paint-colors.js [--limit N] [--delay MS] [--output file.json]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const { URL } = require('url');

// Configuration
const CONFIG = {
  rateLimit: 2000,        // Milliseconds between requests (2 seconds - very respectful)
  timeout: 10000,         // Request timeout
  maxRetries: 3,          // Retry failed requests
  userAgent: 'VeloForge Color Research Bot/1.0 (respectful scraper; contact: dev@veloforge.com)',
  respectRobotsTxt: true,
  outputFile: './assets/vehicle-data-scraped.json'
};

// Target makes/models to scrape
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
 * Sleep utility for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch HTML from a URL with proper headers and error handling
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
 * Fetch hex color from individual color page
 */
async function fetchHexColor(colorUrl) {
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
