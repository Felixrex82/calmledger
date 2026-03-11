# CalmChain — Deployment Guide

## Exact folder structure

```
your-repo/
├── index.html              ← rename crypto-wellness-pwa.html
├── sw.js
├── manifest.json           ← create this (template below)
├── vercel.json
├── package.json
├── icon-192.png
├── icon-512.png
└── api/
    ├── claude.js           ← rename api-claude.js
    ├── wallet.js           ← rename api-wallet.js
    └── wallet-solana.js    ← rename api-wallet-solana.js
```

The `api/` folder name must be lowercase. File names inside must match exactly.

---

## manifest.json

```json
{
  "name": "CalmChain",
  "short_name": "CalmChain",
  "description": "Crypto Wellness",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f1114",
  "theme_color": "#0f1114",
  "orientation": "portrait",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

## Step 1 — API keys

| Key | Get it at | Vercel variable name |
|-----|-----------|----------------------|
| Anthropic | console.anthropic.com → API Keys | `ANTHROPIC_API_KEY` |
| Etherscan | etherscan.io/apis | `ETHERSCAN_API_KEY` |
| BscScan | bscscan.com/apis | `BSCSCAN_API_KEY` |
| Helius (Solana) | helius.dev | `HELIUS_API_KEY` |

All free tiers work. One Etherscan key covers ETH, Polygon, Arbitrum, and Base.

---

## Step 2 — Supabase (optional)

1. supabase.com → New project
2. SQL Editor → paste `supabase-schema.sql` → Run
3. Project Settings → API → copy Project URL and anon key
4. In `index.html` replace:
```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Without Supabase everything saves to localStorage automatically.

---

## Step 3 — Deploy to Vercel

1. Create a GitHub repo → push all files in the structure above
2. vercel.com → Add New Project → import the repo
3. Framework Preset → **Other**
4. Root Directory → leave blank
5. Environment Variables → add all four keys:
   - `ANTHROPIC_API_KEY`
   - `ETHERSCAN_API_KEY`
   - `BSCSCAN_API_KEY`
   - `HELIUS_API_KEY`
6. Click Deploy

---

## Step 4 — Point the app at your deployment

In `index.html` find:
```js
const PROXY_BASE = '';
```
Change to your Vercel URL:
```js
const PROXY_BASE = 'https://your-project.vercel.app';
```
Commit and push — Vercel redeploys in ~30 seconds.

---

## Step 5 — Install on phone

**Android (Chrome):** three-dot menu → Add to Home screen

**iPhone (Safari only):** Share → Add to Home Screen → requires iOS 16.4+

---

## How every API call works

```
Browser → /api/claude      → Vercel → Anthropic (AI analysis, coach, insights)
Browser → /api/wallet      → Vercel → Etherscan / BscScan (EVM tx history)
Browser → /api/wallet-solana → Vercel → Helius (Solana tx history)
```

No API key ever touches the browser. Users only see wallet addresses.

---

## Pre-deploy checklist

- [ ] `api/claude.js` exists (renamed from `api-claude.js`)
- [ ] `api/wallet.js` exists (renamed from `api-wallet.js`)
- [ ] `api/wallet-solana.js` exists (renamed from `api-wallet-solana.js`)
- [ ] `index.html` at root (renamed from `crypto-wellness-pwa.html`)
- [ ] `package.json` at root
- [ ] `vercel.json` at root
- [ ] All 4 env variables added in Vercel dashboard
- [ ] Framework preset set to **Other**
- [ ] Root Directory left blank