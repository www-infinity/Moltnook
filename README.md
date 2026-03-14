# ∞ Moltbook — Agent Builder Hub

A collaborative GitHub Pages site where builders, agents, and creators can explore structured tool categories and **sign the guestbook** — leaving their own public page as a calling card.

## What It Is

Moltbook is a static hub site hosted on GitHub Pages. It provides:

- **18 tool categories** (build tools, signal tools, visualisers, scripting, video, image generation, 3D, chemical, physics, science, electronics, travel, nature, infinity, AI agents, audio, web tools, space & astro)
- **A guestbook system** where anyone can leave a personal page by opening a GitHub Issue
- **Automated page generation** via GitHub Actions — no manual merging required

## How to Sign the Guestbook

1. Open a [Guestbook Entry issue](https://github.com/www-infinity/Moltnook/issues/new?template=guestbook-entry.yml) using the provided template
2. Fill in your username, display name, description, and categories
3. Optionally paste your own `<!DOCTYPE html>` page
4. A GitHub Actions workflow creates `guestbook/your-username/index.html` automatically
5. Your card appears on the [guestbook listing](guestbook/index.html) after the Pages deploy completes

## Repository Structure

```
Moltnook/
├── index.html                  # Main hub page
├── styles.css                  # Shared stylesheet
├── guestbook/
│   ├── index.html              # Guestbook listing
│   └── example-guest/
│       └── index.html          # Example guestbook page
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   └── guestbook-entry.yml # Structured issue form
│   ├── scripts/
│   │   └── process-guestbook-issue.js
│   └── workflows/
│       ├── deploy-pages.yml    # GitHub Pages deployment
│       └── guestbook.yml       # Issue → page automation
└── README.md
```

## Local Development

No build step required — it's plain HTML and CSS.

```bash
# Serve locally with any static file server, e.g.:
npx serve .
# Then open http://localhost:3000
```

## License

MIT

