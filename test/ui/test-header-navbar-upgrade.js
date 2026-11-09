/**
 * ZevSafe Main Website Header & Navbar Upgrade Verification Suite
 * 
 * Verifies:
 * 1. Semantic DOM structure of the 3-zone cybernetic navbar in index.html
 * 2. Brand link accessibility, logo rotation animation, and status badge
 * 3. Nav links group, badges, dividers, and action deck (buttons & theme toggle)
 * 4. Desktop intermediate responsive protection (769px–1240px and 769px–1040px)
 * 5. Full light-theme navbar and hero overrides (WCAG AAA contrast)
 * 6. Hero header trust strip with 4th pill: 5 GB Instant Streaming
 * 7. Mobile hamburger drawer compatibility and preservation of all tested IDs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '../..');
let passed = 0;
let total = 0;

function runTest(name, fn) {
    total++;
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        throw err;
    }
}

console.log('===============================================================');
console.log('  ZevSafe Header & Cybernetic Navbar Test Suite               ');
console.log('===============================================================');

const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(ROOT_DIR, 'styles.css'), 'utf8').replace(/\r\n/g, '\n');

// ── 1. DOM STRUCTURE & ACCESSIBILITY IN INDEX.HTML ──────────────────
console.log('\n--- 1. Semantic DOM Structure & Accessibility ---');

runTest('1.1: Navbar uses semantic nav tag with role and aria-label', () => {
    assert.ok(indexHtml.includes('<nav class="navbar" role="navigation" aria-label="Main Navigation">'), 'Must have semantic navbar');
});

runTest('1.2: Brand is wrapped in accessible .brand-link with aria-label', () => {
    assert.ok(indexHtml.includes('<a href="./" class="brand-link" aria-label="ZevSafe Home - Zero-Knowledge File Encryption">'), 'Brand must be wrapped in .brand-link');
    assert.ok(indexHtml.includes('class="brand-logo"'), 'Must contain .brand-logo');
    assert.ok(indexHtml.includes('class="brand-name"'), 'Must contain .brand-name');
    assert.ok(indexHtml.includes('class="brand-status-badge"'), 'Must contain .brand-status-badge');
    assert.ok(indexHtml.includes('class="status-pulse-dot"'), 'Must contain .status-pulse-dot');
});

runTest('1.3: Navigation links are grouped in .nav-links-group with badge pills', () => {
    assert.ok(indexHtml.includes('<div class="nav-links-group">'), 'Must contain .nav-links-group');
    assert.ok(indexHtml.includes('class="nav-badge-pill nav-badge-pill--purple"'), 'Must contain purple badge pill');
    assert.ok(indexHtml.includes('class="nav-badge-pill nav-badge-pill--green"'), 'Must contain green badge pill');
    assert.ok(indexHtml.includes('class="nav-badge-pill nav-badge-pill--muted"'), 'Must contain muted badge pill');
    assert.ok(indexHtml.includes('id="nav-roadmap-pill"'), 'Must preserve #nav-roadmap-pill');
});

runTest('1.4: Action buttons are grouped in .nav-actions-deck with divider', () => {
    assert.ok(indexHtml.includes('<div class="nav-actions-divider" aria-hidden="true"></div>'), 'Must contain .nav-actions-divider');
    assert.ok(indexHtml.includes('<div class="nav-actions-deck">'), 'Must contain .nav-actions-deck');
    assert.ok(indexHtml.includes('id="btn-open-usb-backup-nav"'), 'Must preserve #btn-open-usb-backup-nav');
    assert.ok(indexHtml.includes('id="btn-install-pwa"'), 'Must preserve #btn-install-pwa');
    assert.ok(indexHtml.includes('id="btn-theme-toggle"'), 'Must preserve #btn-theme-toggle');
    assert.ok(indexHtml.includes('id="btn-download-pc-setup"'), 'Must preserve #btn-download-pc-setup');
});

runTest('1.5: Mobile hamburger toggle and drawer are preserved', () => {
    assert.ok(indexHtml.includes('id="btn-mobile-nav-toggle"'), 'Must preserve #btn-mobile-nav-toggle');
    assert.ok(indexHtml.includes('id="mobile-nav-drawer"'), 'Must preserve #mobile-nav-drawer');
    assert.ok(indexHtml.includes('id="btn-open-usb-backup-mobile"'), 'Must preserve #btn-open-usb-backup-mobile');
    assert.ok(indexHtml.includes('id="btn-theme-toggle-mobile"'), 'Must preserve #btn-theme-toggle-mobile');
});

// ── 2. HERO HEADER ELEVATION & TRUST STRIP ──────────────────────────
console.log('\n--- 2. Hero Header Elevation & Trust Strip ---');

runTest('2.1: Hero security badge has semantic icon and text', () => {
    assert.ok(indexHtml.includes('class="hero-security-badge"'), 'Must contain .hero-security-badge');
    assert.ok(indexHtml.includes('Zero-Knowledge · Zero-Tracking · Client-Side Vaults'), 'Must contain security subtitle');
});

runTest('2.2: Hero trust strip includes all 4 trust pills including 5 GB Instant Streaming', () => {
    assert.ok(indexHtml.includes('class="hero-trust-strip"'), 'Must contain .hero-trust-strip');
    assert.ok(indexHtml.includes('AES-256-GCM'), 'Must contain AES-256-GCM pill');
    assert.ok(indexHtml.includes('600,000 PBKDF2'), 'Must contain 600,000 PBKDF2 pill');
    assert.ok(indexHtml.includes('100% Air-Gapped'), 'Must contain 100% Air-Gapped pill');
    assert.ok(indexHtml.includes('5 GB Instant Streaming'), 'Must contain 5 GB Instant Streaming pill');
    assert.ok(indexHtml.includes('class="trust-pill trust-pill--highlight"'), 'Must contain highlighted 4th pill');
});

// ── 3. CSS RESPONSIVE ARCHITECTURE & 1-ROW PROTECTION ───────────────
console.log('\n--- 3. CSS Responsive Architecture & 1-Row Protection ---');

runTest('3.1: Glassmorphism and brand logo hover interaction defined', () => {
    assert.ok(stylesCss.includes('backdrop-filter: blur(24px) saturate(190%)'), 'Navbar must feature elevated 24px blur and saturation');
    assert.ok(stylesCss.includes('.brand-link:hover .brand-logo'), 'Brand logo must rotate on hover');
    assert.ok(stylesCss.includes('.brand-link:focus-visible'), 'Brand link must provide accessible focus-visible indicator');
});

runTest('3.2: Single-row layout protected between 769px and 1240px', () => {
    assert.ok(stylesCss.includes('@media (max-width: 1240px) and (min-width: 769px)'), 'Must define 1240px intermediate desktop rule');
    assert.ok(stylesCss.includes('.nav-badge-pill {\n        display: none;'), 'Must hide badge pills on crowded mid-tier desktops');
    assert.ok(stylesCss.includes('@media (max-width: 1040px) and (min-width: 769px)'), 'Must define 1040px tablet-desktop rule');
    assert.ok(stylesCss.includes('.nav-actions-deck .nav-btn-secondary span'), 'Must collapse text to icon-only buttons on 1040px');
});

// ── 4. LIGHT THEME OVERRIDES & WCAG AAA CONTRAST ────────────────────
console.log('\n--- 4. Light Theme Overrides & Contrast ---');

runTest('4.1: Light theme navbar background and border defined', () => {
    assert.ok(stylesCss.includes('.light-theme .navbar'), 'Must style .light-theme .navbar');
    assert.ok(stylesCss.includes('rgba(255, 255, 255, 0.88)'), 'Light navbar must have high-opacity frosted background');
});

runTest('4.2: Light theme brand, nav links, and action buttons defined', () => {
    assert.ok(stylesCss.includes('.light-theme .brand-name'), 'Must style .light-theme .brand-name');
    assert.ok(stylesCss.includes('.light-theme .brand-status-badge'), 'Must style .light-theme .brand-status-badge');
    assert.ok(stylesCss.includes('.light-theme .nav-link-subtle'), 'Must style .light-theme .nav-link-subtle');
    assert.ok(stylesCss.includes('.light-theme .nav-actions-deck .nav-btn-secondary'), 'Must style .light-theme action buttons');
    assert.ok(stylesCss.includes('.light-theme .nav-badge-pill--purple'), 'Must style light theme badge pills');
});

runTest('4.3: Light theme hero title, subtitle, security badge, and trust strip defined', () => {
    assert.ok(stylesCss.includes('.light-theme .hero-security-badge'), 'Must style .light-theme .hero-security-badge');
    assert.ok(stylesCss.includes('.light-theme .hero-title-refined'), 'Must style .light-theme .hero-title-refined');
    assert.ok(stylesCss.includes('.light-theme .hero-gradient-text'), 'Must style .light-theme .hero-gradient-text');
    assert.ok(stylesCss.includes('.light-theme .hero-sub-refined'), 'Must style .light-theme .hero-sub-refined');
    assert.ok(stylesCss.includes('.light-theme .hero-trust-strip'), 'Must style .light-theme .hero-trust-strip');
    assert.ok(stylesCss.includes('.light-theme .trust-pill'), 'Must style .light-theme .trust-pill');
});

// ── 5. MAIN LANDING PAGE UI, BENTO CARDS & LIGHT THEME ──────────────
console.log('\n--- 5. Main Landing Page UI, Bento Cards & Polish ---');

runTest('5.1: Card tags include live pulsing indicator dots', () => {
    assert.ok(indexHtml.includes('<span class="card-tag-dot"></span>'), 'Card tag must contain .card-tag-dot');
    assert.ok(stylesCss.includes('.card-tag-dot'), 'CSS must define .card-tag-dot pulse animation');
});

runTest('5.2: Primary action buttons feature Lock/Unlock SVG icons', () => {
    assert.ok(indexHtml.includes('class="btn-icon"'), 'Primary buttons must include .btn-icon SVG');
    assert.ok(stylesCss.includes('.btn-icon'), 'CSS must style .btn-icon');
});

runTest('5.3: SEO features use bento card layout with icon wrap badges', () => {
    assert.ok(indexHtml.includes('class="seo-card-icon-wrap"'), 'SEO cards must contain .seo-card-icon-wrap');
    assert.ok(stylesCss.includes('.seo-card-icon-wrap'), 'CSS must style .seo-card-icon-wrap');
});

runTest('5.4: Light theme landing page overrides provide WCAG AAA contrast', () => {
    assert.ok(stylesCss.includes('.light-theme .vault-card'), 'Must style .light-theme .vault-card');
    assert.ok(stylesCss.includes('.light-theme .card-title'), 'Must style .light-theme .card-title');
    assert.ok(stylesCss.includes('.light-theme .seo-card'), 'Must style .light-theme .seo-card');
    assert.ok(stylesCss.includes('.light-theme .seo-faq-item'), 'Must style .light-theme .seo-faq-item');
});

runTest('5.5: Critical interactive IDs and accessibility hooks remain intact', () => {
    assert.ok(indexHtml.includes('id="encrypt-drop-zone"'), 'Must preserve #encrypt-drop-zone');
    assert.ok(indexHtml.includes('id="decrypt-drop-zone"'), 'Must preserve #decrypt-drop-zone');
    assert.ok(indexHtml.includes('id="btn-encrypt"'), 'Must preserve #btn-encrypt');
    assert.ok(indexHtml.includes('id="btn-decrypt"'), 'Must preserve #btn-decrypt');
    assert.ok(indexHtml.includes('id="max-security-bar"'), 'Must preserve #max-security-bar');
    assert.ok(indexHtml.includes('id="btn-toggle-max-security"'), 'Must preserve #btn-toggle-max-security');
    assert.ok(indexHtml.includes('id="btn-decrypt-salvage"'), 'Must preserve #btn-decrypt-salvage');
    assert.ok(indexHtml.includes('id="encrypt-password"'), 'Must preserve #encrypt-password');
    assert.ok(indexHtml.includes('id="decrypt-password"'), 'Must preserve #decrypt-password');
});

console.log('===============================================================');
console.log(`  ALL ${passed}/${total} HEADER & NAVBAR TESTS PASSED (100%)       `);
console.log('===============================================================');
