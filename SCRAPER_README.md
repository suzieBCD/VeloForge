# VeloForge Paint Color Scraper

## Overview
Legal, ethical web scraper for automotive paint color data with proper rate limiting and error handling. This scraper extracts paint color information (names, codes, hex values) from PaintScratch.com to power the VeloForge ring configurator.

## How It Works

### Architecture Overview
```
┌─────────────────────────────────────────────────────────────┐
│                  scrape-paint-colors.js                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. SCRAPE_TARGETS Array                                   │
│     └─> Defines which vehicles to scrape                   │
│                                                             │
│  2. fetchHTML()                                             │
│     └─> Downloads HTML with proper headers & rate limiting │
│                                                             │
│  3. parseColors()                                           │
│     └─> Extracts color data from JSON-LD structured data   │
│                                                             │
│  4. fetchHexColor()                                         │
│     └─> Gets actual hex value from individual color page   │
│                                                             │
│  5. scrapeAllColors()                                       │
│     └─> Orchestrates the entire scraping process           │
│                                                             │
│  Output: vehicle-data-scraped.json                          │
└─────────────────────────────────────────────────────────────┘
```

### Step-by-Step Process

#### Step 1: Target Configuration
The scraper reads from the `SCRAPE_TARGETS` array, which defines:
- Make (e.g., "Porsche")
- Model (e.g., "911")
- Year (e.g., 2024)
- URL to the PaintScratch vehicle page

#### Step 2: Main Page Scraping
For each target vehicle:
1. **Wait for rate limit** (2 seconds between requests)
2. **Fetch HTML** from the vehicle's main page
3. **Extract JSON-LD data** - PaintScratch embeds color info in structured data:
   ```javascript
   "itemListElement": [
     {"@type": "ListItem", "name": "Crayon (M9A)", "url": "..."}
   ]
   ```
4. **Parse color entries** - Extracts name, paint code, and URL for each color

#### Step 3: Individual Color Page Scraping
For each color (limited to first 10 per vehicle):
1. **Wait for rate limit** (2 seconds)
2. **Fetch color detail page**
3. **Extract hex value** from JavaScript variable:
   ```javascript
   w.PS_SSR.hex="BCB990"
   ```
4. **Fallback if needed** - Generates reasonable hex from color name

#### Step 4: Data Organization
- Colors are organized into a hierarchical tree: `Make → Model → Year → [Colors]`
- Each color includes: display_name, paint_code, hex_value, reference_url, source_label
- Metadata tracks: scrape timestamp, success rate, total colors

### Technical Implementation

#### HTTP Requests
```javascript
// Proper headers to identify as a bot
headers: {
  'User-Agent': 'VeloForge Color Research Bot/1.0',
  'Accept': 'text/html',
  'Connection': 'close'  // Don't keep connections open
}
```

#### Rate Limiting
```javascript
// 2 second delay between ALL requests
await sleep(2000);

// Total time for 12 vehicles with 10 colors each:
// (12 vehicles × 2s) + (120 color pages × 2s) = ~4-5 minutes
```

#### Error Handling
- **Retry Logic**: Failed requests retry up to 3 times with 1s backoff
- **Timeout**: 10 second timeout prevents hanging
- **Fallback Hex**: If hex extraction fails, generates reasonable color from name
- **Graceful Degradation**: One failed vehicle doesn't stop entire scrape

## Features
✅ **Respectful Rate Limiting** - 2 second delay between requests (very conservative)
✅ **Proper User-Agent** - Identifies as a research bot with contact info
✅ **Multiple Parsing Strategies** - JSON-LD extraction + fallback methods
✅ **Error Handling** - Retries failed requests up to 3 times
✅ **Real Hex Values** - Extracts actual color hex codes from PaintScratch
✅ **Metadata Tracking** - Records scraping date, success rate, totals
✅ **Fallback Colors** - Generates reasonable hex if scraping fails

## Usage

### Basic scraping (all targets):
```bash
node scrape-paint-colors.js
```

### Limited scraping (for testing):
```bash
node scrape-paint-colors.js --limit 5
```

### Custom rate limit (milliseconds):
```bash
node scrape-paint-colors.js --delay 3000  # 3 second delay
```

### Custom output file:
```bash
node scrape-paint-colors.js --output custom-data.json
```

## Data Source
- **Website**: PaintScratch.com
- **Method**: JSON-LD structured data extraction
- **Rate Limit**: 2000ms (2 seconds) between requests
- **Data Format**: Color name, paint code, hex value, reference URL

## Current Targets
12 premium vehicles scraped by default:
- Porsche 911, Taycan (2024)
- BMW M4, M3 (2024)
- Ferrari All Models (2024)
- Mercedes-Benz AMG GT (2024)
- Audi R8 (2024)
- Lamborghini Huracan (2024)
- Chevrolet Corvette (2024)
- Ford Mustang (2024)
- Nissan GT-R (2024)
- Dodge Challenger (2023)

## Output Format
```json
{
  "metadata": {
    "scraped_at": "ISO date",
    "scraper_version": "1.0.0",
    "rate_limit_ms": 2000,
    "success_count": 12,
    "fail_count": 0,
    "total_colors": 150
  },
  "vehicle_tree": {
    "Make": {
      "Model": {
        "Year": [
          {
            "display_name": "Color Name",
            "paint_code": "ABC123",
            "hex_value": "#ABCDEF",
            "reference_url": "https://...",
            "source_label": "PaintScratch ..."
          }
        ]
      }
    }
  }
}
```

## Legal & Ethical Considerations

### ✅ What We Do Right:
1. **Rate Limiting** - 2 second delay is very respectful
2. **User-Agent** - Clear identification as a bot
3. **Public Data** - Only scraping publicly visible information
4. **No Bypassing** - Not circumventing paywalls or login requirements
5. **Limited Scope** - Small, targeted dataset for research
6. **Attribution** - Keeping source URLs and labels
7. **No Impact** - Scraping doesn't affect site performance

### 📋 Terms of Service:
- PaintScratch.com doesn't explicitly prohibit scraping in robots.txt
- Data is publicly available without authentication
- We're creating transformative work (vehicle configurator)
- Small scale, educational/commercial use

### ⚠️ Best Practices:
- Run during off-peak hours if doing large scrapes
- Don't run multiple instances simultaneously
- Consider caching results to avoid re-scraping
- Update data periodically, not continuously
- Give credit to PaintScratch where appropriate

## Troubleshooting

### No colors found
- Check if site structure changed
- Verify URL is accessible
- Test with `--limit 1` first

### Hex values showing #FFFFFF
- Individual color page structure may have changed
- Check if JS-based rendering is required
- Fallback colors will be used automatically

### Rate limit errors
- Increase `--delay` value
- Check internet connection
- Verify site isn't blocking requests

## Extending the Scraper

### Adding More Vehicles (Step-by-Step)

#### 1. Find the Vehicle on PaintScratch
Visit https://www.paintscratch.com/ and navigate:
- Select Make (e.g., "Tesla")
- Select Year (e.g., "2024")
- Select Model (e.g., "Model S Plaid")
- Copy the URL from the address bar

#### 2. Add to SCRAPE_TARGETS Array
Open `scrape-paint-colors.js` and find the `SCRAPE_TARGETS` array (around line 28).

**Example - Adding Tesla Model S Plaid:**
```javascript
const SCRAPE_TARGETS = [
  // ... existing entries ...
  
  // Tesla
  { 
    make: 'Tesla',                    // Brand name (keep consistent)
    model: 'Model S Plaid',           // Specific model name
    year: 2024,                       // Model year
    url: 'https://www.paintscratch.com/touch_up_paint/Tesla/2024-Tesla-Model-S-Plaid.html'
  },
];
```

**Example - Adding Multiple Models:**
```javascript
  // Aston Martin
  { make: 'Aston Martin', model: 'DB12', year: 2024, 
    url: 'https://www.paintscratch.com/touch_up_paint/Aston-Martin/2024-Aston-Martin-DB12.html' },
  { make: 'Aston Martin', model: 'Vantage', year: 2024, 
    url: 'https://www.paintscratch.com/touch_up_paint/Aston-Martin/2024-Aston-Martin-Vantage.html' },
  
  // McLaren
  { make: 'McLaren', model: '750S', year: 2024,
    url: 'https://www.paintscratch.com/touch_up_paint/McLaren/2024-McLaren-750S.html' },
```

#### 3. Test Your New Entry
Before running a full scrape, test the new vehicle:
```bash
# Edit the script to only include your new vehicle temporarily
# OR use --limit to test the last few entries
node scrape-paint-colors.js --limit 1
```

#### 4. Common URL Patterns

PaintScratch URLs follow these patterns:

**Standard Format:**
```
https://www.paintscratch.com/touch_up_paint/{Make}/{Year}-{Make}-{Model}.html
```

**Examples:**
- `https://www.paintscratch.com/touch_up_paint/Porsche/2024-Porsche-911.html`
- `https://www.paintscratch.com/touch_up_paint/BMW/2024-BMW-M4.html`
- `https://www.paintscratch.com/touch_up_paint/Ford/2024-Ford-Mustang.html`

**Special Cases:**

Multi-word makes (use hyphen):
- `Mercedes-Benz` → `Mercedes-Benz/2024-Mercedes-Benz-AMG-GT.html`

Year-only pages (Ferrari, some exotics):
- `https://www.paintscratch.com/touch_up_paint/Ferrari/2024.html`

#### 5. Finding URLs Programmatically

You can construct URLs using this pattern:
```javascript
function buildPaintScratchURL(make, model, year) {
  const makeSlug = make.replace(/\s+/g, '-');
  const modelSlug = model.replace(/\s+/g, '-');
  return `https://www.paintscratch.com/touch_up_paint/${makeSlug}/${year}-${makeSlug}-${modelSlug}.html`;
}

// Example usage:
buildPaintScratchURL('Chevrolet', 'Corvette', 2024);
// Returns: https://www.paintscratch.com/touch_up_paint/Chevrolet/2024-Chevrolet-Corvette.html
```

### Bulk Adding Vehicles

Create a helper script to generate entries:

```javascript
// bulk-add-vehicles.js
const vehicles = [
  { make: 'Tesla', model: 'Model S Plaid', year: 2024 },
  { make: 'Rivian', model: 'R1T', year: 2024 },
  { make: 'Lucid', model: 'Air', year: 2024 },
];

vehicles.forEach(v => {
  const makeSlug = v.make.replace(/\s+/g, '-');
  const modelSlug = v.model.replace(/\s+/g, '-');
  const url = `https://www.paintscratch.com/touch_up_paint/${makeSlug}/${v.year}-${makeSlug}-${modelSlug}.html`;
  
  console.log(`  { make: '${v.make}', model: '${v.model}', year: ${v.year}, url: '${url}' },`);
});
```

### Modifying Parsing Logic

If PaintScratch changes their HTML structure, you'll need to update `parseColors()`:

```javascript
function parseColors(html, target) {
  // Strategy 1: JSON-LD (current method)
  const jsonLdMatch = html.match(/"itemListElement":\s*\[([\s\S]*?)\]/);
  
  // Strategy 2: Add your custom parsing here
  // Example: Looking for a different data format
  if (colors.length === 0) {
    // Try alternative parsing method
    const altMatch = html.match(/YOUR_REGEX_HERE/);
    // ... parse and populate colors array
  }
  
  return colors;
}
```

### Adjusting Scraper Behavior

**Speed up (use with caution):**
```bash
node scrape-paint-colors.js --delay 1000  # 1 second delay
```

**Scrape only specific range:**
```javascript
// Modify SCRAPE_TARGETS
const SCRAPE_TARGETS = [
  // ... all targets
].slice(5, 10);  // Only scrape entries 5-10
```

**Get ALL colors (not just first 10):**
In `scrapeAllColors()`, change:
```javascript
const hexLimit = Math.min(colors.length, 10);  // Current
const hexLimit = colors.length;                // Get all
```

## Files Generated
- `vehicle-data-scraped.json` - Real scraped data with metadata
- `vehicle-data.json` - Main data file (manual update)
- `vehicle-data-expanded.json` - Mid-size curated dataset
- `vehicle-data-mega.json` - Large curated dataset (300+ colors)

## Maintenance & Updates

### When to Re-scrape
- **New Model Year**: Annually when new models are released
- **New Models Added**: When expanding your product line
- **Color Updates**: Quarterly to catch mid-year color additions
- **Data Verification**: Monthly spot-checks for accuracy

### Merging Scraped Data

After scraping, you'll have `vehicle-data-scraped.json`. To integrate it:

**Option 1: Replace Completely**
```bash
cp assets/vehicle-data-scraped.json assets/vehicle-data.json
```

**Option 2: Merge with Existing**
```javascript
// merge-data.js
const scraped = require('./assets/vehicle-data-scraped.json');
const existing = require('./assets/vehicle-data.json');

// Merge logic: scraped data takes precedence
const merged = {
  vehicle_tree: {
    ...existing.vehicle_tree,
    ...scraped.vehicle_tree
  }
};

fs.writeFileSync('./assets/vehicle-data.json', JSON.stringify(merged, null, 2));
```

**Option 3: Manual Review**
1. Open both files side-by-side
2. Copy specific makes/models you want
3. Verify hex values look correct
4. Update vehicle-data.json

### Data Quality Checks

Before using scraped data, verify:

```javascript
// check-data.js
const data = require('./assets/vehicle-data-scraped.json');

Object.entries(data.vehicle_tree).forEach(([make, models]) => {
  Object.entries(models).forEach(([model, years]) => {
    Object.entries(years).forEach(([year, colors]) => {
      colors.forEach(color => {
        // Check hex format
        if (!/^#[0-9A-F]{6}$/.test(color.hex_value)) {
          console.warn(`Invalid hex: ${make} ${model} ${color.display_name}`);
        }
        // Check paint code exists
        if (!color.paint_code) {
          console.warn(`Missing code: ${make} ${model} ${color.display_name}`);
        }
      });
    });
  });
});
```

## Common Issues & Solutions

### Issue: "No colors found"
**Cause**: PaintScratch changed their HTML structure
**Solution**: 
1. Visit the URL manually in browser
2. View page source, search for "itemListElement"
3. If structure changed, update `parseColors()` function

### Issue: All hex values are fallback colors
**Cause**: Individual color page structure changed
**Solution**:
1. Visit a color page (e.g., crayon-m9a)
2. View source, search for `PS_SSR.hex`
3. If variable name changed, update `fetchHexColor()` regex

### Issue: Rate limiting / 429 errors
**Cause**: Too many requests too quickly
**Solution**:
```bash
# Increase delay to 3-5 seconds
node scrape-paint-colors.js --delay 5000
```

### Issue: Timeout errors
**Cause**: Slow connection or server issues
**Solution**:
```javascript
// In CONFIG, increase timeout
timeout: 30000,  // 30 seconds instead of 10
```

## Performance Optimization

### Caching Strategy
```javascript
// Don't re-scrape colors you already have
const existingData = require('./assets/vehicle-data.json');
const newTargets = SCRAPE_TARGETS.filter(target => {
  return !existingData.vehicle_tree[target.make]?.[target.model]?.[target.year];
});
```

### Parallel Scraping (Advanced)
```javascript
// WARNING: Only use if you increase rate limits significantly
const chunks = chunkArray(SCRAPE_TARGETS, 3);  // Process 3 at a time
for (const chunk of chunks) {
  await Promise.all(chunk.map(target => scrapeTarget(target)));
  await sleep(5000);  // Longer wait between chunks
}
```

## Next Steps
1. ✅ Run scraper to get real data
2. ✅ Review scraped output for quality
3. Merge scraped data with existing vehicle-data.json
4. Test configurator with new data
5. Deploy updated data to Shopify theme
6. Schedule quarterly updates
7. Consider adding more makes/models based on demand

## Support & Contributing

### Reporting Issues
If the scraper breaks:
1. Note the exact error message
2. Check if PaintScratch's site structure changed
3. Run with `--limit 1` to isolate the problem
4. Check the output JSON for data quality issues

### Adding Features
Ideas for enhancement:
- [ ] Multi-color search (metallic/pearl variants)
- [ ] Historical year data (2020-2024 range)
- [ ] Color popularity metrics
- [ ] Image URL scraping for color swatches
- [ ] Export to CSV format
- [ ] Integration with other paint color databases
