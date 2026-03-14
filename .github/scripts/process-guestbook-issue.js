#!/usr/bin/env node
/**
 * process-guestbook-issue.js
 *
 * Reads a GitHub Issue body (from the guestbook-entry.yml template),
 * extracts the structured fields, and writes:
 *   1. guestbook/<username>/index.html   — the guest's personal page
 *   2. Updates guestbook/index.html      — inserts a new card into the listing
 *
 * Runs inside GitHub Actions with the following env vars:
 *   ISSUE_BODY         — raw issue body text
 *   ISSUE_NUMBER       — issue number
 *   ISSUE_AUTHOR       — GitHub login of the issue opener
 *   ANTHROPIC_API_KEY  — Claude API key (CLAUDE secret); enables AI page generation
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the value of a markdown form field from the issue body.
 * GitHub issue templates render fields as:
 *   ### Field Label
 *   value
 */
function extractField(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex   = new RegExp(`###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n###|$)`, 'i');
  const match   = body.match(regex);
  if (!match) return '';
  return match[1].trim();
}

/** Sanitise a string for safe use in HTML text nodes (not attributes). */
function escapeHtml(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/** Sanitise a value for use inside an HTML attribute (href, etc.). */
function sanitiseUrl(raw) {
  const trimmed = raw.trim();
  // Only allow http/https URLs
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '';
}

/** Convert a username string to safe initials (1-2 chars) for the avatar. */
function initials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Convert comma-separated categories string into an array of trimmed strings. */
function parseCategories(raw) {
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0 && s.length <= 40)
    .slice(0, 8); // cap at 8 tags
}

/** Format today's date as "Month YYYY" */
function friendlyDate() {
  return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Parse issue body ──────────────────────────────────────────────────────────

const issueBody    = process.env.ISSUE_BODY   || '';
const issueNumber  = process.env.ISSUE_NUMBER || '0';
const issueAuthor  = process.env.ISSUE_AUTHOR || 'unknown';

const rawUsername    = extractField(issueBody, 'GitHub Username') || issueAuthor;
const rawDisplayName = extractField(issueBody, 'Display Name')    || rawUsername;
const rawDescription = extractField(issueBody, 'Description')     || '';
const rawCategories  = extractField(issueBody, 'Tool Categories') || '';
const rawWebsite     = extractField(issueBody, 'Website \\(optional\\)') ||
                       extractField(issueBody, 'Website')         || '';
const rawCustomHtml  = extractField(issueBody, 'Custom Page HTML \\(optional\\)') ||
                       extractField(issueBody, 'Custom Page HTML') || '';

// Sanitise all values
const username    = rawUsername.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 39) || 'guest';
const displayName = escapeHtml(rawDisplayName.slice(0, 80));
const description = escapeHtml(rawDescription.slice(0, 200));
const categories  = parseCategories(rawCategories);
const website     = sanitiseUrl(rawWebsite);
const signedDate  = friendlyDate();

if (!username) {
  console.error('ERROR: No valid username found in issue body.');
  process.exit(1);
}

console.log(`Processing guestbook entry for: ${username}`);
console.log(`  Display name : ${displayName}`);
console.log(`  Categories   : ${categories.join(', ')}`);
console.log(`  Website      : ${website || '(none)'}`);
console.log(`  Custom HTML  : ${rawCustomHtml.length > 0 ? 'yes' : 'no'}`);
console.log(`  Claude AI    : ${process.env.ANTHROPIC_API_KEY ? 'available' : 'not configured'}`);

// ── Determine guest page content ──────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../..');

let guestPageHtml;

// Validate custom HTML rather than attempting to sanitise it.
// Any HTML containing scripts, event handlers, or dangerous URL schemes is rejected
// entirely — the generated page is used as a safe fallback.
const UNSAFE_PATTERNS = [
  /<script\b/i,           // any opening script tag
  /\bon[a-z]+\s*=/i,      // inline event handlers (onclick=, onload=, …)
  /javascript\s*:/i,      // javascript: URI scheme
  /vbscript\s*:/i,        // vbscript: URI scheme
  /data\s*:\s*text\/html/i, // data:text/html URI
];

const hasCustomHtml = rawCustomHtml.trim().toLowerCase().startsWith('<!doctype html');
const customHtmlIsSafe = hasCustomHtml && !UNSAFE_PATTERNS.some(p => p.test(rawCustomHtml));

if (customHtmlIsSafe) {
  console.log('Custom HTML passed safety validation — using as-is.');
  guestPageHtml = rawCustomHtml;
} else {
  if (hasCustomHtml && !customHtmlIsSafe) {
    console.log('Custom HTML contains unsafe patterns — falling back to generated page.');
  }

  // ── Try Claude AI page generation first ────────────────────────────────────
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Attempting Claude AI page generation...');
    try {
      const claudeScript = path.join(__dirname, 'generate-with-claude.js');
      const claudeEnv = Object.assign({}, process.env, {
        GUEST_USERNAME:     username,
        GUEST_DISPLAY_NAME: rawDisplayName.slice(0, 80),
        GUEST_DESCRIPTION:  rawDescription.slice(0, 200),
        GUEST_CATEGORIES:   categories.join(', '),
        GUEST_WEBSITE:      website,
        GUEST_ISSUE_NUMBER: issueNumber,
        GUEST_SIGNED_DATE:  signedDate,
      });
      const claudeOutput = execSync(`node "${claudeScript}"`, {
        env: claudeEnv,
        maxBuffer: 1024 * 1024 * 2, // 2 MB
        timeout: 60000,              // 60 s
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const claudeHtml = claudeOutput.toString('utf8').trim();
      if (
        claudeHtml.toLowerCase().startsWith('<!doctype html') &&
        !UNSAFE_PATTERNS.some(p => p.test(claudeHtml))
      ) {
        console.log('Claude AI page accepted — using AI-generated page.');
        guestPageHtml = claudeHtml;
      } else {
        console.log('Claude output failed validation — falling back to static template.');
      }
    } catch (err) {
      console.log(`Claude generation failed (${err.message}) — falling back to static template.`);
    }
  }

  // ── Static template fallback ───────────────────────────────────────────────
  if (!guestPageHtml) {
    console.log('Generating page from static template...');
    const tagsHtml = categories
      .map(t => `<span class="tag">${escapeHtml(t)}</span>`)
      .join('\n            ');

    const websiteBlock = website
      ? `<a class="btn btn-outline" href="${website}" target="_blank" rel="noopener noreferrer" aria-label="Visit ${displayName}'s website">
          Visit Website →
        </a>`
      : '';

    guestPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${displayName} – Moltnook guestbook page." />
  <title>${displayName} – Moltnook Guestbook</title>
  <link rel="stylesheet" href="../../styles.css" />
  <style>
    .guest-page-hero {
      text-align: center;
      padding: 4rem 1.5rem 3rem;
      background: radial-gradient(ellipse at 50% 0%, rgba(0,212,255,.1) 0%, transparent 70%);
    }
    .guest-page-hero h1 {
      font-size: clamp(1.8rem, 4vw, 2.8rem);
      font-weight: 800;
      margin-bottom: 1rem;
      background: linear-gradient(135deg, #fff 30%, var(--accent2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .avatar-large {
      width: 5rem; height: 5rem;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      display: flex; align-items: center; justify-content: center;
      font-size: 2rem; font-weight: 800; color: #fff;
      margin: 0 auto 1.5rem;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1rem;
      margin-top: 2rem;
    }
    .info-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem;
    }
    .info-card h3 {
      font-size: .78rem;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--text-muted);
      margin-bottom: .5rem;
    }
    .info-card p { font-size: .95rem; color: var(--text); }
  </style>
</head>
<body>

  <nav aria-label="Main navigation">
    <a class="nav-brand" href="../../index.html" aria-label="Moltnook home">&#8734; Moltnook</a>
    <ul class="nav-links" role="list">
      <li><a href="../../index.html#categories">Tools</a></li>
      <li><a href="../../index.html#how-it-works">How It Works</a></li>
      <li><a href="../index.html">Guestbook</a></li>
      <li><a href="https://github.com/www-infinity/Moltnook" target="_blank" rel="noopener noreferrer">GitHub</a></li>
    </ul>
  </nav>

  <header class="guest-page-hero" role="banner">
    <div class="avatar-large" aria-hidden="true">${escapeHtml(initials(rawDisplayName))}</div>
    <h1>${displayName}</h1>
    <p style="color: var(--text-muted); max-width: 520px; margin: 0 auto 1.5rem;">
      ${description}
    </p>
    <div class="hero-buttons">
      ${websiteBlock}
      <a class="btn btn-outline" href="../index.html" aria-label="Back to Guestbook">&#8592; Guestbook</a>
    </div>
  </header>

  <section aria-labelledby="details-heading">
    <div class="container">
      <h2 id="details-heading" style="text-align:center; margin-bottom:1.5rem;">Entry Details</h2>
      <div class="info-grid" role="list">
        <div class="info-card" role="listitem">
          <h3>GitHub</h3>
          <p>
            <a href="https://github.com/${escapeHtml(username)}"
               target="_blank" rel="noopener noreferrer"
               aria-label="GitHub profile for ${displayName}">
              @${escapeHtml(username)}
            </a>
          </p>
        </div>
        <div class="info-card" role="listitem">
          <h3>Signed</h3>
          <p>${escapeHtml(signedDate)}</p>
        </div>
        <div class="info-card" role="listitem">
          <h3>Issue</h3>
          <p>
            <a href="https://github.com/www-infinity/Moltnook/issues/${issueNumber}"
               target="_blank" rel="noopener noreferrer"
               aria-label="View the guestbook issue">
              #${issueNumber}
            </a>
          </p>
        </div>
        <div class="info-card" role="listitem">
          <h3>Categories</h3>
          <div class="guest-tags" style="margin-top:.25rem;" aria-label="Tool categories">
            ${tagsHtml}
          </div>
        </div>
      </div>
    </div>
  </section>

  <footer role="contentinfo">
    <div class="container">
      <span class="footer-mark" aria-hidden="true">&#8734;</span>
      <p>
        <strong>Moltnook</strong> &mdash; Non-planned obsolescence. Open forever.<br/>
        <a href="../../index.html">Hub</a> &middot;
        <a href="../index.html">Guestbook</a> &middot;
        <a href="https://github.com/www-infinity/Moltnook" target="_blank" rel="noopener noreferrer">GitHub</a>
      </p>
    </div>
  </footer>

</body>
</html>`;
  }
}

// ── Write guest page ──────────────────────────────────────────────────────────

const guestDir = path.join(REPO_ROOT, 'guestbook', username);
fs.mkdirSync(guestDir, { recursive: true });
fs.writeFileSync(path.join(guestDir, 'index.html'), guestPageHtml, 'utf8');
console.log(`Written: guestbook/${username}/index.html`);

// ── Update guestbook listing ──────────────────────────────────────────────────

const listingPath = path.join(REPO_ROOT, 'guestbook', 'index.html');
let listing = fs.readFileSync(listingPath, 'utf8');

// Avoid duplicate entries — skip if username already has a card
if (listing.includes(`aria-label="Guestbook entry from ${username}"`)) {
  console.log(`Entry for ${username} already exists in listing — skipping duplicate.`);
  process.exit(0);
}

const tagsListHtml = categories
  .map(t => `<span class="tag">${escapeHtml(t)}</span>`)
  .join('\n            ');

const websiteLinkHtml = website
  ? `<a class="guest-link" href="${website}" target="_blank" rel="noopener noreferrer" aria-label="Visit ${displayName}'s website">
          Visit website →
        </a>`
  : '';

const newCard = `
        <article class="guest-card glass fade-up" role="listitem" aria-label="Guestbook entry from ${escapeHtml(username)}">
          <div class="guest-header">
            <div class="guest-avatar" aria-hidden="true">${escapeHtml(initials(rawDisplayName))}</div>
            <div>
              <div class="guest-name">${displayName}</div>
              <div class="guest-date">Signed ${escapeHtml(signedDate)}</div>
            </div>
          </div>
          <p class="guest-desc">${description}</p>
          <div class="guest-tags" aria-label="Categories">
            ${tagsListHtml}
          </div>
          ${websiteLinkHtml}
          <a class="guest-link" href="${escapeHtml(username)}/index.html" aria-label="Visit ${displayName}'s guestbook page">Visit page →</a>
        </article>
`;

// Insert before the closing comment marker
const MARKER = '<!-- Additional signed entries will be inserted here by the GitHub Actions workflow -->';
if (!listing.includes(MARKER)) {
  console.error('ERROR: Marker comment not found in guestbook/index.html');
  process.exit(1);
}

listing = listing.replace(MARKER, newCard + '\n        ' + MARKER);
fs.writeFileSync(listingPath, listing, 'utf8');
console.log(`Updated: guestbook/index.html — added card for ${username}`);
