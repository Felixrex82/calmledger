/**
 * CalmChain — Solana Wallet Proxy
 * Vercel Serverless Function: /api/wallet-solana
 *
 * Proxies Helius API for Solana transaction history.
 * Keeps your Helius API key off the client.
 *
 * Query params:
 *   ?address=...  — Solana base58 wallet address (required)
 */

export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.query;

  if (!address) return res.status(400).json({ error: 'Missing Solana wallet address' });

  // Basic Solana address validation — base58, 32–44 chars
  if (address.length < 32 || address.length > 44) {
    return res.status(400).json({ error: 'Invalid Solana address format' });
  }

  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_API_KEY) {
    return res.status(500).json({ error: 'Helius API key not configured' });
  }

  try {
    // ── Fetch enhanced transaction history from Helius ──
    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}&limit=100`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Helius returned ${response.status}`);
    }

    const raw = await response.json();

    if (!Array.isArray(raw)) {
      return res.status(200).json({ transactions: [], stats: emptyStats(), chainsScanned: [] });
    }

    // ── Normalize Helius transactions ──
    const transactions = raw.map(tx => ({
      hash:        tx.signature,
      timeStamp:   tx.timestamp || Math.floor(Date.now() / 1000),
      type:        tx.type || 'UNKNOWN',
      description: tx.description || '',
      fee:         tx.fee,
      feePayer:    tx.feePayer,
      successful:  !tx.transactionError,
      source:      tx.source || '',          // e.g. JUPITER, RAYDIUM, MAGIC_EDEN
      chainName:   'Solana',
      chainKey:    'sol',
      symbol:      'SOL',
      isTrade:     ['SWAP', 'TOKEN_MINT', 'NFT_SALE', 'NFT_BID'].includes(tx.type),
      isSolana:    true,
    }));

    // ── Compute behavioral stats ──
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60);
    const recentTxs = transactions.filter(tx => tx.timeStamp > thirtyDaysAgo);

    const lateNightTxs = recentTxs.filter(tx => {
      const hour = new Date(tx.timeStamp * 1000).getUTCHours();
      return hour >= 23 || hour < 6;
    });

    const failedTxs = transactions.filter(tx => !tx.successful);

    let rapidFireCount = 0;
    const sorted = [...recentTxs].sort((a, b) => a.timeStamp - b.timeStamp);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].timeStamp - sorted[i-1].timeStamp < 600) rapidFireCount++;
    }

    const uniqueDays = new Set(recentTxs.map(tx => new Date(tx.timeStamp * 1000).toDateString()));

    // Identify DEX sources used
    const dexSources = [...new Set(transactions.map(tx => tx.source).filter(s => s && s !== 'UNKNOWN'))];

    return res.status(200).json({
      transactions,
      chainsScanned: ['Solana'],
      dexSources,
      stats: {
        totalTransactions: transactions.length,
        last30Days:        recentTxs.length,
        lateNightCount:    lateNightTxs.length,
        failedCount:       failedTxs.length,
        rapidFireCount,
        activeDays:        uniqueDays.size,
        avgPerActiveDay:   uniqueDays.size > 0 ? (recentTxs.length / uniqueDays.size).toFixed(1) : '0',
        swapCount:         transactions.filter(tx => tx.type === 'SWAP').length,
        topDex:            dexSources[0] || 'Unknown',
        oldestTxDate:      transactions.length > 0 ? new Date(Math.min(...transactions.map(t => t.timeStamp)) * 1000).toISOString().split('T')[0] : null,
        newestTxDate:      transactions.length > 0 ? new Date(Math.max(...transactions.map(t => t.timeStamp)) * 1000).toISOString().split('T')[0] : null,
      }
    });

  } catch (err) {
    console.error('Helius fetch error:', err);
    return res.status(500).json({ error: `Failed to fetch Solana data: ${err.message}` });
  }
}

function emptyStats() {
  return { totalTransactions: 0, last30Days: 0, lateNightCount: 0, failedCount: 0, rapidFireCount: 0, activeDays: 0, avgPerActiveDay: '0' };
}