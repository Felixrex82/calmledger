/**
 * CalmLedger — Price Proxy
 * Vercel Serverless Function: /api/prices
 * 
 * Proxies CoinGecko free API — no key required.
 * Solves CORS since browser can't call CoinGecko directly.
 *
 * Query params:
 *   ?ids=bitcoin,ethereum,solana,binancecoin
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ids = req.query.ids || 'bitcoin,ethereum,solana,binancecoin';

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `CoinGecko returned ${response.status}` });
    }

    const data = await response.json();

    // Cache for 5 minutes on Vercel edge
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(data);

  } catch (err) {
    console.error('Price proxy error:', err);
    return res.status(500).json({ error: 'Failed to fetch prices', detail: err.message });
  }
}