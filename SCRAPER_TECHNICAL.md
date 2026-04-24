# VeloForge Scraper - Technical Documentation

## Code Architecture

### Core Components

The scraper consists of 5 main functions that work together to fetch and parse automotive paint color data:

```
┌──────────────────────────────────────────────────────────────┐
│                  scrapeAllColors()                           │
│                  Main orchestrator                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  FOR EACH TARGET VEHICLE:                             │  │
│  │  1. Wait 2 seconds (rate limiting)                    │  │
│  │  2. Call fetchHTML() to get main page                 │  │
│  │  3. Call parseColors() to extract color list          │  │
│  │  4. FOR EACH COLOR (up to 10):                        │  │
│  │     - Wait 2 seconds                                  │  │
│  │     - Call fetchHexColor() to get hex value           │  │
│  │  5. Organize into vehicle_tree structure              │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Function Reference

### 1. `fetchHTML(url, retries)`
**Purpose**: Downloads HTML from a URL with proper headers and error handling

**How it works**:
1. Creates HTTP/HTTPS request with proper headers
2. Identifies as a bot with descriptive User-Agent
3. Follows 301/302 redirects automatically
4. Retries failed requests up to 3 times (1 second between retries)
5. Returns raw HTML content

**Headers sent**:
- `User-Agent`: Identifies our bot (required for ethical scraping)
- `Accept`: Tells server we want HTML content
- `Accept-Language`: Prefer English content
- `Accept-Encoding`: No compression (simplifies parsing)
- `Connection: close`: Don't keep connections open

**Error handling**:
- HTTP errors (4xx, 5xx) → throws error with status code
- Network errors → retries up to 3 times
- Timeout (10 seconds) → throws timeout error

**Example**:
```javascript
const html = await fetchHTML('https://www.paintscratch.com/touch_up_paint/Porsche/2024-Porsche-911.html');
// Returns: "<html>...</html>"
```

---

### 2. `parseColors(html, target)`
**Purpose**: Extracts color names, paint codes, and URLs from vehicle listing page

**How it works**:

#### JSON-LD Parsing (Primary Strategy)
PaintScratch embeds color data in structured JSON-LD format:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Crayon (M9A)",
      "url": "https://www.paintscratch.com/touch_up_paint/Porsche/crayon-m9a.html"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "Speed Yellow (12H/12G/X4)",
      "url": "https://www.paintscratch.com/touch_up_paint/Porsche/speed-yellow-12h-12g-x4.html"
    }
  ]
}
</script>
```

**Extraction steps**:
1. Regex match: `/"itemListElement":\s*\[([\s\S]*?)\]/`
2. Parse JSON array of color items
3. For each item:
   - Extract name (e.g., "Crayon (M9A)")
   - Split into display name ("Crayon") and paint code ("M9A")
   - Build full URL for color detail page

#### HTML Fallback (Backup Strategy)
If JSON-LD not found, searches for HTML anchor tags:
```html
<a href="crayon-m9a.html">Crayon (M9A)</a>
```

**Output format**:
```javascript
[
  {
    name: "Crayon",
    paint_code: "M9A",
    url: "https://www.paintscratch.com/touch_up_paint/Porsche/crayon-m9a.html"
  }
]
```

---

### 3. `fetchHexColor(colorUrl)`
**Purpose**: Gets actual hex color value from individual color page

**How it works**:

PaintScratch embeds hex values in JavaScript variables on color detail pages:

```html
<script>
(function(w,d){
    w.PS_SSR = w.PS_SSR || {};
    w.PS_SSR.hex="BCB990";
    w.PS_SSR.colorName="Crayon";
})(window, document);
</script>
```

**Parsing Strategies** (tried in order):

#### Strategy 1: PS_SSR.hex Variable (Most Reliable)
```javascript
const ssrMatch = html.match(/w\.PS_SSR\.hex="([0-9A-Fa-f]{6})"/);
// Finds: w.PS_SSR.hex="BCB990"
// Returns: #BCB990
```

#### Strategy 2: RGB Values from CSS
```javascript
const rgbMatch = html.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
// Finds: rgb(188, 185, 144)
// Converts to: #BCB990
```

Conversion logic:
```javascript
const [, r, g, b] = rgbMatch;
const hex = '#' + [r, g, b].map(x => {
  return parseInt(x, 10).toString(16).padStart(2, '0');
}).join('').toUpperCase();
```

#### Strategy 3: Direct Hex in HTML
```javascript
const hexMatch = html.match(/#([0-9A-Fa-f]{6})\b/);
// Finds: #BCB990 anywhere in HTML
```

#### Strategy 4: Meta Tag Attributes
```javascript
const metaMatch = html.match(/color["\s:]*#([0-9A-Fa-f]{6})/i);
// Finds: color="#BCB990" or color: #BCB990
```

#### Strategy 5: Background Color CSS
```javascript
const bgMatch = html.match(/background-color:\s*#([0-9A-Fa-f]{6})/i);
// Finds: background-color: #BCB990
```

#### Fallback: Generate from Color Name
If all extraction strategies fail, generates reasonable hex from name:

```javascript
function generateFallbackColor(colorName) {
  const name = colorName.toLowerCase();
  
  if (name.includes('red') || name.includes('rosso')) return '#CC0000';
  if (name.includes('blue') || name.includes('blu')) return '#0000CC';
  if (name.includes('yellow') || name.includes('giallo')) return '#FFCC00';
  if (name.includes('green') || name.includes('verde')) return '#00CC00';
  if (name.includes('black') || name.includes('nero')) return '#000000';
  if (name.includes('white') || name.includes('bianco')) return '#FFFFFF';
  if (name.includes('silver') || name.includes('argento')) return '#C0C0C0';
  if (name.includes('grey') || name.includes('gray')) return '#808080';
  if (name.includes('orange') || name.includes('arancio')) return '#FF8800';
  
  return '#808080'; // Default gray
}
```

**Rate limiting**: Waits 2 seconds before each request

**Example**:
```javascript
const hex = await fetchHexColor('https://www.paintscratch.com/.../crayon-m9a.html');
// Returns: "#BCB990"
```

---

### 4. `scrapeAllColors(limit)`
**Purpose**: Main orchestrator that manages the entire scraping process

**Process flow**:

```javascript
1. Initialize data structure
   vehicle_tree = {}

2. FOR EACH target in SCRAPE_TARGETS:
   a. Wait 2 seconds (rate limiting)
   b. Log progress: "Scraping 1/12: Porsche 911 2024"
   c. Fetch main page HTML
   d. Parse colors from HTML → get array of colors
   e. Log: "Found 16 colors"
   
   f. FOR EACH color (up to first 10):
      i.   Wait 2 seconds
      ii.  Log: "Fetching hex for Crayon (M9A)..."
      iii. Get hex value from color page
      iv.  Log: "✓ #BCB990"
   
   g. Build color objects:
      {
        display_name: "Crayon",
        paint_code: "M9A",
        hex_value: "#BCB990",
        reference_url: "https://...",
        source_label: "PaintScratch.com"
      }
   
   h. Organize into tree:
      vehicle_tree["Porsche"]["911"][2024] = [colors...]

3. Add metadata:
   {
     scraped_at: "2024-04-19T12:34:56.789Z",
     total_colors: 156,
     success_count: 12,
     failed_count: 0,
     vehicle_tree: {...}
   }

4. Save to JSON file
```

**Key features**:
- Progress logging for monitoring
- Success/failure tracking
- Graceful error handling (one failure doesn't stop entire process)
- Metadata generation
- Time tracking

**Example output structure**:
```json
{
  "scraped_at": "2024-04-19T12:34:56.789Z",
  "total_colors": 156,
  "success_count": 12,
  "failed_count": 0,
  "vehicle_tree": {
    "Porsche": {
      "911": {
        "2024": [
          {
            "display_name": "Crayon",
            "paint_code": "M9A",
            "hex_value": "#BCB990",
            "reference_url": "https://www.paintscratch.com/touch_up_paint/Porsche/crayon-m9a.html",
            "source_label": "PaintScratch.com"
          }
        ]
      }
    }
  }
}
```

---

## Adding New Vehicles - Detailed Guide

### Method 1: Using PaintScratch Site Navigation

1. **Visit PaintScratch.com**
   ```
   https://www.paintscratch.com/
   ```

2. **Navigate to your vehicle**:
   - Click "Select Make" dropdown
   - Choose manufacturer (e.g., "Tesla")
   - Click "Select Year" dropdown
   - Choose year (e.g., "2024")
   - Click "Select Model" dropdown
   - Choose model (e.g., "Model S Plaid")

3. **Copy the URL** from address bar:
   ```
   https://www.paintscratch.com/touch_up_paint/Tesla/2024-Tesla-Model-S-Plaid.html
   ```

4. **Add to SCRAPE_TARGETS**:
   ```javascript
   { 
     make: 'Tesla',
     model: 'Model S Plaid',
     year: 2024,
     url: 'https://www.paintscratch.com/touch_up_paint/Tesla/2024-Tesla-Model-S-Plaid.html'
   },
   ```

### Method 2: Constructing URLs Programmatically

PaintScratch URLs follow predictable patterns:

**Standard format**:
```
https://www.paintscratch.com/touch_up_paint/{Make}/{Year}-{Make}-{Model}.html
```

**Rules**:
- Spaces in names → hyphens
- Keep capitalization as-is
- Multi-word makes: use hyphens (e.g., "Mercedes-Benz")

**Examples**:
```javascript
// Single word make
"Porsche" + "911" + 2024
→ https://www.paintscratch.com/touch_up_paint/Porsche/2024-Porsche-911.html

// Multi-word make
"Mercedes-Benz" + "AMG GT" + 2024
→ https://www.paintscratch.com/touch_up_paint/Mercedes-Benz/2024-Mercedes-Benz-AMG-GT.html

// Multi-word model
"Tesla" + "Model S Plaid" + 2024
→ https://www.paintscratch.com/touch_up_paint/Tesla/2024-Tesla-Model-S-Plaid.html
```

**URL Constructor Function**:
```javascript
function buildPaintScratchURL(make, model, year) {
  const makeSlug = make.replace(/\s+/g, '-');
  const modelSlug = model.replace(/\s+/g, '-');
  return `https://www.paintscratch.com/touch_up_paint/${makeSlug}/${year}-${makeSlug}-${modelSlug}.html`;
}

// Usage:
buildPaintScratchURL('Aston Martin', 'DB12', 2024);
// Returns: https://www.paintscratch.com/touch_up_paint/Aston-Martin/2024-Aston-Martin-DB12.html
```

### Method 3: Bulk Adding Multiple Vehicles

Create a helper script to generate multiple entries:

```javascript
// bulk-add-to-scraper.js
const vehicles = [
  // Electric vehicles
  { make: 'Tesla', model: 'Model 3', year: 2024 },
  { make: 'Tesla', model: 'Model S Plaid', year: 2024 },
  { make: 'Rivian', model: 'R1T', year: 2024 },
  { make: 'Lucid', model: 'Air', year: 2024 },
  
  // Supercars
  { make: 'McLaren', model: '750S', year: 2024 },
  { make: 'Lamborghini', model: 'Revuelto', year: 2024 },
  { make: 'Ferrari', model: 'SF90', year: 2024 },
  
  // Luxury
  { make: 'Bentley', model: 'Continental GT', year: 2024 },
  { make: 'Rolls-Royce', model: 'Phantom', year: 2024 },
  { make: 'Aston Martin', model: 'DB12', year: 2024 },
];

console.log('// Generated SCRAPE_TARGETS entries:');
console.log('');

vehicles.forEach(v => {
  const makeSlug = v.make.replace(/\s+/g, '-');
  const modelSlug = v.model.replace(/\s+/g, '-');
  const url = `https://www.paintscratch.com/touch_up_paint/${makeSlug}/${v.year}-${makeSlug}-${modelSlug}.html`;
  
  console.log(`  { make: '${v.make}', model: '${v.model}', year: ${v.year}, url: '${url}' },`);
});
```

Run it:
```bash
node bulk-add-to-scraper.js
```

Output:
```javascript
  { make: 'Tesla', model: 'Model 3', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Tesla/2024-Tesla-Model-3.html' },
  { make: 'Tesla', model: 'Model S Plaid', year: 2024, url: 'https://www.paintscratch.com/touch_up_paint/Tesla/2024-Tesla-Model-S-Plaid.html' },
  // ... etc
```

Copy and paste into `SCRAPE_TARGETS` array.

---

## Modifying Parsing Logic

### When PaintScratch Changes Their HTML

If the scraper starts returning 0 colors or invalid data:

1. **Inspect the actual HTML**:
   ```bash
   curl -s "https://www.paintscratch.com/touch_up_paint/Porsche/2024-Porsche-911.html" > test.html
   ```

2. **Search for color data** in test.html:
   - Look for JSON-LD: `"itemListElement"`
   - Look for anchor tags: `<a href=".*?\.html">`
   - Look for JavaScript arrays: `var colors = [...]`

3. **Add new parsing strategy** in `parseColors()`:

```javascript
function parseColors(html, target) {
  const colors = [];
  
  // Existing Strategy 1: JSON-LD
  // ... existing code ...
  
  // NEW Strategy 3: JavaScript array
  if (colors.length === 0) {
    const jsMatch = html.match(/var\s+colors\s*=\s*\[(.*?)\]/s);
    if (jsMatch) {
      const colorsData = jsMatch[1];
      // Parse the JavaScript array
      // Add your parsing logic here
    }
  }
  
  // NEW Strategy 4: Data attributes
  if (colors.length === 0) {
    const dataMatch = html.matchAll(/data-color="([^"]+)"\s+data-code="([^"]+)"/g);
    for (const match of dataMatch) {
      colors.push({
        name: match[1],
        paint_code: match[2],
        url: constructColorURL(match[2])
      });
    }
  }
  
  return colors;
}
```

4. **Test your changes**:
   ```bash
   node scrape-paint-colors.js --limit 1
   ```

---

## Performance Tuning

### Adjusting Rate Limiting

**Current (conservative)**:
```javascript
rateLimit: 2000  // 2 seconds between requests
```

**Faster (use with caution)**:
```javascript
rateLimit: 1000  // 1 second between requests
```

**Impact**:
- 12 vehicles × 10 colors = 132 requests
- At 2000ms: ~4-5 minutes total
- At 1000ms: ~2-3 minutes total

⚠️ **Warning**: Being too aggressive may result in:
- Rate limiting / 429 errors
- IP bans
- Ethical concerns

### Parallel Scraping (Advanced)

Only use if you've increased rate limits significantly:

```javascript
async function scrapeBatch(targets) {
  const results = await Promise.all(
    targets.map(target => scrapeVehicle(target))
  );
  return results;
}

// Process 3 vehicles at a time
const batchSize = 3;
for (let i = 0; i < SCRAPE_TARGETS.length; i += batchSize) {
  const batch = SCRAPE_TARGETS.slice(i, i + batchSize);
  await scrapeBatch(batch);
  await sleep(5000); // Extra wait between batches
}
```

### Caching to Avoid Re-scraping

```javascript
// Load existing data
const existingData = fs.existsSync('./assets/vehicle-data.json')
  ? JSON.parse(fs.readFileSync('./assets/vehicle-data.json', 'utf8'))
  : { vehicle_tree: {} };

// Filter out already-scraped vehicles
const newTargets = SCRAPE_TARGETS.filter(target => {
  const exists = existingData.vehicle_tree[target.make]?.[target.model]?.[target.year];
  if (exists) {
    console.log(`✓ Skipping ${target.make} ${target.model} (already scraped)`);
    return false;
  }
  return true;
});

// Only scrape new vehicles
await scrapeAllColors(newTargets);
```

---

## Debugging Tips

### Enable Verbose Logging

Add more console.log statements:

```javascript
async function fetchHexColor(colorUrl) {
  console.log(`   → Fetching: ${colorUrl}`);
  await sleep(CONFIG.rateLimit);
  const html = await fetchHTML(colorUrl);
  console.log(`   → HTML length: ${html.length} bytes`);
  
  // Strategy 1
  const ssrMatch = html.match(/w\.PS_SSR\.hex="([0-9A-Fa-f]{6})"/);
  if (ssrMatch) {
    console.log(`   → Strategy 1 SUCCESS: ${ssrMatch[1]}`);
    return '#' + ssrMatch[1].toUpperCase();
  }
  console.log(`   → Strategy 1 failed, trying Strategy 2...`);
  
  // ...etc
}
```

### Save Raw HTML for Analysis

```javascript
async function fetchHexColor(colorUrl) {
  const html = await fetchHTML(colorUrl);
  
  // Save to file for inspection
  const slug = colorUrl.split('/').pop().replace('.html', '');
  fs.writeFileSync(`./debug/${slug}.html`, html);
  
  // Continue with parsing...
}
```

### Test Single Vehicle

```javascript
// Temporarily modify SCRAPE_TARGETS
const SCRAPE_TARGETS = [
  { make: 'Porsche', model: '911', year: 2024, url: '...' }
];
```

Or use --limit flag:
```bash
node scrape-paint-colors.js --limit 1
```

---

## Next Steps

1. ✅ Review this technical documentation
2. Add 10-20 more vehicle targets to SCRAPE_TARGETS
3. Run scraper: `node scrape-paint-colors.js`
4. Verify output quality in vehicle-data-scraped.json
5. Merge with existing vehicle-data.json
6. Test configurator with new data
7. Schedule monthly/quarterly re-scrapes
