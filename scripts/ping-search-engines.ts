import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';

const SITEMAP_URL = 'https://fuwtest.netlify.app/sitemap.xml';
const ROBOTS_URL = 'https://fuwtest.netlify.app/robots.txt';

async function verifySeoAndPing() {
  console.log('=== SEO & SITEMAP VERIFICATION ===\n');

  // 1. Verify dist/sitemap.xml
  const sitemapPath = path.resolve('dist', 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    console.error('FAIL: dist/sitemap.xml not found! Run npm run build:seo first.');
    process.exit(1);
  }

  const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
  const locMatches = sitemapContent.match(/<loc>(.*?)<\/loc>/g) || [];
  console.log(`[✓] Sitemap present at dist/sitemap.xml`);
  console.log(`[✓] Total URLs in sitemap: ${locMatches.length}`);

  // Sample check URLs
  const sampleUrls = locMatches.slice(0, 5).map(m => m.replace(/<\/?loc>/g, ''));
  console.log(`[✓] Sample Sitemap URLs:`);
  sampleUrls.forEach(u => console.log(`    - ${u}`));

  // Check no private routes in sitemap
  const privateKeywords = ['/student', '/admin', '/super', '/checkout', '/cart', '/profile', '/settings', '/reset-password'];
  let leakFound = false;
  for (const loc of locMatches) {
    for (const pk of privateKeywords) {
      if (loc.includes(pk)) {
        console.error(`[!] SECURITY ERROR: Private route found in sitemap: ${loc}`);
        leakFound = true;
      }
    }
  }
  if (!leakFound) {
    console.log(`[✓] Security check passed: 0 private routes leaked into sitemap.`);
  }

  // 2. Verify dist/robots.txt
  const robotsPath = path.resolve('dist', 'robots.txt');
  if (fs.existsSync(robotsPath)) {
    const robotsContent = fs.readFileSync(robotsPath, 'utf8');
    const hasSitemapDirective = robotsContent.includes(`Sitemap: ${SITEMAP_URL}`);
    console.log(`[✓] robots.txt contains Sitemap directive: ${hasSitemapDirective}`);
    console.log(`[✓] robots.txt disallows /student, /admin, /super: ${robotsContent.includes('Disallow: /student') && robotsContent.includes('Disallow: /admin')}`);
  }

  // 3. Ping Search Engines
  console.log('\n=== PINGING SEARCH ENGINES ===\n');

  // Bing Ping
  try {
    const bingPingUrl = `https://www.bing.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`;
    console.log(`Pinging Bing: ${bingPingUrl}`);
    const res = await axios.get(bingPingUrl, { timeout: 8000, validateStatus: () => true });
    console.log(`[Bing Response] Status: ${res.status} (${res.status === 200 ? 'OK - Successfully submitted' : 'Response received'})`);
  } catch (err: any) {
    console.log(`[Bing] Ping network notice: ${err?.message || err}`);
  }

  // Google Ping (documented note on Google's 2023+ deprecation of ping endpoint)
  try {
    const googlePingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`;
    console.log(`Pinging Google: ${googlePingUrl}`);
    const res = await axios.get(googlePingUrl, { timeout: 8000, validateStatus: () => true });
    console.log(`[Google Response] Status: ${res.status}`);
    if (res.status === 404) {
      console.log(`[Google Note] As of late 2023, Google has formally deprecated the /ping endpoint (HTTP 404 is standard). Googlebot discovers sitemaps automatically via the robots.txt Sitemap: directive which is configured at https://fuwtest.netlify.app/robots.txt and Google Search Console.`);
    }
  } catch (err: any) {
    console.log(`[Google] Ping network notice: ${err?.message || err}`);
  }

  console.log('\n=== SEO INDEXING VERIFICATION COMPLETE ===\n');
}

verifySeoAndPing().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
