# CalmChain — Deployment & Setup Guide

## Your Files

| File | Purpose |
|------|---------|
| `crypto-wellness-pwa.html` | The entire app — rename to `index.html` |
| `sw.js` | Service worker — push notifications + offline cache |
| `api-wallet.js` | Vercel serverless proxy for EVM chains |
| `api-wallet-solana.js` | Vercel serverless proxy for Solana |
| `vercel.json` | Vercel routing config |
| `supabase-schema.sql` | Supabase database schema |

---

## Folder Structure Before Uploading

```
calmchain/
├── index.html               ← rename crypto-wellness-pwa.html
├── sw.js
├── manifest.json            ← create this (template below)
├── vercel.json
├── icon-192.png             ← your logo, 192×192px PNG
├── icon-512.png             ← your logo, 512×512px PNG
└── api/
    ├── wallet.js            ← rename api-wallet.js
    └── wallet-solana.js     ← rename api-wallet-solana.js
```

---

## Step 1 — Create manifest.json

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

## Step 2 — Get Free API Keys (10 minutes)

| Key | Sign up at | Environment variable |
|-----|-----------|----------------------|
| Etherscan | etherscan.io/apis | `ETHERSCAN_API_KEY` |
| BscScan | bscscan.com/apis | `BSCSCAN_API_KEY` |
| Helius (Solana) | helius.dev | `HELIUS_API_KEY` |

One Etherscan key covers Ethereum, Polygon, Arbitrum, and Base.

---

## Step 3 — Set Up Supabase (AI memory + persistence)

1. Go to **supabase.com** → Create account → New project
2. Go to **SQL Editor** → paste contents of `supabase-schema.sql` → Run
3. Go to **Project Settings → API** → copy your Project URL and anon key
4. Open `index.html` and find near the top of the script section:

```javascript
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace both with your actual values.

Until Supabase is connected, everything stores in localStorage automatically.

---

## Step 4 — Deploy to Vercel

1. Go to **vercel.com** → sign up with GitHub
2. Create a new GitHub repository → push all your files into it
3. Vercel → **Add New Project** → import your repo
4. Add Environment Variables before deploying:
   - `ETHERSCAN_API_KEY`
   - `BSCSCAN_API_KEY`
   - `HELIUS_API_KEY`
5. Click **Deploy**

Live at: `https://your-project-name.vercel.app`

---

## Step 5 — Update PROXY_BASE

In `index.html`, find:

```javascript
const PROXY_BASE = '';
```

Change to your Vercel URL:

```javascript
const PROXY_BASE = 'https://your-project-name.vercel.app';
```

Commit and push — Vercel redeploys in ~30 seconds.

---

## Step 6 — Install on Phone

**Android (Chrome):**
Three-dot menu → Add to Home screen → Add

**iPhone (Safari only — not Chrome):**
Share button → Add to Home Screen → Add

Push notifications work on Android immediately.
On iPhone: requires iOS 16.4+ and must be added to Home Screen first.

---

## How It Works

```
App opens → saved wallet detected
      ↓
Daily auto-analysis (once per day, background)
      ↓
Browser → /api/wallet on Vercel (your server)
      ↓
Vercel → Etherscan / BscScan / Helius (keys stay server-side)
      ↓
Transaction data → Claude AI analysis
      ↓
Wellness score + fresh AI insight written to screen
      ↓
Score history, check-ins, chat saved to Supabase
      ↓
AI coach remembers everything next session
```

---

## Feature Requirements

| Feature | Requires |
|---------|---------|
| Wellness score | Vercel + blockchain API keys |
| AI coach | Works immediately (direct Anthropic API) |
| AI memory between sessions | Supabase |
| Journal persistence | Supabase (falls back to localStorage) |
| Daily check-in streak | localStorage — works offline |
| Push notifications | HTTPS deployment + user permission |
| Daily auto-analysis | HTTPS deployment |
| Late-night trading alert | Works in browser immediately |