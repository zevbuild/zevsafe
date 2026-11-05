/**
 * ZevSafe — Roadmap & Master Plan Portal Test Suite
 * Validates the 14-phase roadmap, filter pills, inspector drawer,
 * offline PWA precaching, USB backup packaging, and zero-knowledge security constraints.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const roadmapPath = path.resolve(__dirname, '../roadmap/index.html');
const indexPath = path.resolve(__dirname, '../index.html');
const swPath = path.resolve(__dirname, '../sw.js');
const usbPath = path.resolve(__dirname, '../js/usb-backup-kit.js');
const sitemapPath = path.resolve(__dirname, '../sitemap.xml');
const stylesPath = path.resolve(__dirname, '../styles.css');

console.log('===============================================================');
console.log('  ZEVSAFE ROADMAP & MASTER PLAN VALIDATION SUITE               ');
console.log('===============================================================');

// 1. File existence
assert.strictEqual(fs.existsSync(roadmapPath), true, 'roadmap/index.html exists');
const roadmapHtml = fs.readFileSync(roadmapPath, 'utf8');
assert.strictEqual(roadmapHtml.length > 5000, true, 'roadmap/index.html has substantial content (>5KB)');

console.log('  ✔ 1. roadmap/index.html file existence and structure verified');

// 2. CSP & Security constraints
assert.strictEqual(roadmapHtml.includes("default-src 'self'"), true, 'roadmap/index.html includes strict CSP default-src');
assert.strictEqual(roadmapHtml.includes("https://fonts.googleapis.com"), false, 'roadmap/index.html has no external Google Fonts');
assert.strictEqual(roadmapHtml.includes("https://fonts.gstatic.com"), false, 'roadmap/index.html has no external gstatic fonts');
assert.strictEqual(roadmapHtml.includes("https://www.google-analytics.com"), false, 'roadmap/index.html has no Google Analytics');
assert.strictEqual(roadmapHtml.includes("https://cdnjs.cloudflare.com"), false, 'roadmap/index.html has no external CDN scripts');

console.log('  ✔ 2. Strict Content Security Policy & Zero-External-Network constraints verified');

// 3. 14 Phases verification (Phase 01 through Phase 14)
for (let i = 1; i <= 14; i++) {
    const padded = i < 10 ? '0' + i : '' + i;
    const hasPhase = roadmapHtml.includes(`Phase ${padded}`) || roadmapHtml.includes(`openPhaseDrawer('p${i}')`);
    assert.strictEqual(hasPhase, true, `Phase ${padded} card exists in DOM`);
}

console.log('  ✔ 3. All 14 Strategic Phases (Phase 01 to Phase 14) present in roadmap');

// 4. Status distribution: 11 delivered, 1 next, 2 planned
const deliveredMatches = roadmapHtml.match(/data-status="delivered"/g) || [];
const nextMatches = roadmapHtml.match(/data-status="next"/g) || [];
const plannedMatches = roadmapHtml.match(/data-status="planned"/g) || [];

assert.strictEqual(deliveredMatches.length, 11, '11 phases are marked delivered / shipped');
assert.strictEqual(nextMatches.length, 1, '1 phase is marked next (Phase 08 Argon2id)');
assert.strictEqual(plannedMatches.length, 2, '2 phases are marked planned (Phase 10 & Phase 12)');

console.log('  ✔ 4. Status distribution verified (11 delivered, 1 next, 2 planned = 14 total)');

// 5. Filter pills & UI controls
assert.strictEqual(roadmapHtml.includes("filterRoadmap('all'"), true, 'Filter pill for "all" exists');
assert.strictEqual(roadmapHtml.includes("filterRoadmap('delivered'"), true, 'Filter pill for "delivered" exists');
assert.strictEqual(roadmapHtml.includes("filterRoadmap('next'"), true, 'Filter pill for "next" exists');
assert.strictEqual(roadmapHtml.includes("filterRoadmap('planned'"), true, 'Filter pill for "planned" exists');
assert.strictEqual(roadmapHtml.includes('rm-filter-pill'), true, 'Filter pill styling class exists');

console.log('  ✔ 5. Interactive Filter Pills & status switcher present');

// 6. Deep-Dive Architecture Inspector Drawer
assert.strictEqual(roadmapHtml.includes('id="rm-drawer"'), true, 'rm-drawer container exists');
assert.strictEqual(roadmapHtml.includes('id="d-title"'), true, 'd-title element exists');
assert.strictEqual(roadmapHtml.includes('id="d-badge"'), true, 'd-badge element exists');
assert.strictEqual(roadmapHtml.includes('id="d-desc"'), true, 'd-desc content area exists');
assert.strictEqual(roadmapHtml.includes('id="d-algo"'), true, 'd-algo spec cell exists');
assert.strictEqual(roadmapHtml.includes('id="d-mem"'), true, 'd-mem spec cell exists');
assert.strictEqual(roadmapHtml.includes('id="d-time"'), true, 'd-time spec cell exists');
assert.strictEqual(roadmapHtml.includes('id="d-par"'), true, 'd-par spec cell exists');
assert.strictEqual(roadmapHtml.includes('id="d-bin"'), true, 'd-bin spec cell exists');
assert.strictEqual(roadmapHtml.includes('id="d-fallback"'), true, 'd-fallback spec cell exists');
assert.strictEqual(roadmapHtml.includes('closeDrawerDirect()'), true, 'closeDrawerDirect method exists');

console.log('  ✔ 6. Deep-Dive Technical Spec Inspector Drawer verified');

// 7. Navbar & Navigation Integration in index.html
const indexHtml = fs.readFileSync(indexPath, 'utf8');
assert.strictEqual(indexHtml.includes('id="nav-roadmap-pill"'), true, 'index.html desktop navbar has #nav-roadmap-pill');
assert.strictEqual(indexHtml.includes('href="./roadmap/"'), true, 'index.html links to ./roadmap/');
assert.strictEqual(indexHtml.includes('11 / 14'), true, 'index.html displays 11 / 14 progress counter');
assert.strictEqual(indexHtml.includes('Master Plan &amp; Roadmap'), true, 'index.html includes Master Plan & Roadmap in mobile drawer and footer');

console.log('  ✔ 7. Primary App Navbar, Mobile Drawer & Footer integration verified');

// 8. Service Worker Precaching & Section Routing in sw.js
const swContent = fs.readFileSync(swPath, 'utf8');
assert.strictEqual(swContent.includes("APP_VERSION    = 'v62'"), true, 'sw.js APP_VERSION is bumped to v62');
assert.strictEqual(swContent.includes("'./roadmap/'"), true, "sw.js precaches './roadmap/'");
assert.strictEqual(swContent.includes("'./roadmap/index.html'"), true, "sw.js precaches './roadmap/index.html'");
assert.strictEqual(swContent.includes("'roadmap'"), true, "sw.js includes 'roadmap' in SECTION_ROUTES");

console.log('  ✔ 8. Service Worker offline precaching & section routing verified');

// 9. USB Air-Gap Kit Asset Ingestion
const usbContent = fs.readFileSync(usbPath, 'utf8');
assert.strictEqual(usbContent.includes("'roadmap/index.html'"), true, 'js/usb-backup-kit.js packages roadmap/index.html');

console.log('  ✔ 9. USB Air-Gap Backup Kit asset bundling verified');

// 10. Sitemap XML
const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
assert.strictEqual(sitemapContent.includes('https://zevsafe.pages.dev/roadmap/'), true, 'sitemap.xml indexes roadmap URL');

console.log('  ✔ 10. SEO Sitemap indexing verified');

// 11. CSS Styling
const stylesCss = fs.readFileSync(stylesPath, 'utf8');
assert.strictEqual(stylesCss.includes('.plan-pill-nav'), true, 'styles.css defines .plan-pill-nav class');
assert.strictEqual(stylesCss.includes('.plan-pill-nav .counter-badge'), true, 'styles.css defines .counter-badge styling');

console.log('  ✔ 11. CSS Pill styles verified');

console.log('===============================================================');
console.log('  ALL ROADMAP & MASTER PLAN TESTS PASSED (11/11)               ');
console.log('===============================================================');
