# VeloForge Paint Color Scraper

## Overview
Legal, ethical web scraper for automotive paint color data with proper rate limiting and error handling.

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

### Add more vehicles:
Edit `SCRAPE_TARGETS` array in the script:
```javascript
{ 
  make: 'Make', 
  model: 'Model', 
  year: 2024, 
  url: 'https://www.paintscratch.com/touch_up_paint/...'
}
```

### Change parsing strategy:
Modify `parseColors()` function to handle different HTML structures.

### Adjust rate limiting:
Modify `CONFIG.rateLimit` value (in milliseconds).

## Files Generated
- `vehicle-data-scraped.json` - Real scraped data with metadata
- `vehicle-data.json` - Main data file (manual update)
- `vehicle-data-expanded.json` - Mid-size curated dataset
- `vehicle-data-mega.json` - Large curated dataset (300+ colors)

## Next Steps
1. ✅ Run scraper to get real data
2. Merge scraped data with curated data
3. Update main vehicle-data.json
4. Integrate into Shopify theme/configurator
5. Schedule periodic updates (monthly/quarterly)
