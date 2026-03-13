/**
 * CalmLedger — Solana Wallet Proxy
 * Vercel Serverless Function: /api/wallet-solana
 *
 * Provider priority:
 *   1. Helius (HELIUS_API_KEY)  — free tier, 100k req/mo, most reliable
 *   2. Solscan (SOLSCAN_API_KEY) — Pro API fallback
 *
 * Get a free Helius key at: https://dev.helius.xyz (no credit card)
 */

function emptyResult() {
  return {
    transactions: [],
    chainsScanned: [],
    stats: {
      totalTransactions: 0, last30Days: 0, lateNightCount: 0,
      failedCount: 0, rapidFireCount: 0, activeDays: 0,
      avgPerActiveDay: '0', oldestTxDate: null, newestTxDate: null,
    },
  };
}

function computeStats(transactions) {
  if (!transactions.length) return emptyResult().stats;

  const now = Math.floor(Date.now() / 1000);
  const cutoff30 = now - (30 * 24 * 60 * 60);
  const recent = transactions.filter(tx => (tx.timeStamp || 0) > cutoff30);

  const lateNight = recent.filter(tx => {
    const h = new Date((tx.timeStamp || 0) * 1000).getHours();
    return h >= 23 || h < 6;
  });

  let rapidFireCount = 0;
  const sorted = [...recent].sort((a, b) => (a.timeStamp||0) - (b.timeStamp||0));
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i].timeStamp||0) - (sorted[i-1].timeStamp||0) < 600) rapidFireCount++;
  }

  const uniqueDays = new Set(recent.map(tx =>
    new Date((tx.timeStamp||0) * 1000).toDateString()
  ));
  const allTs = transactions.map(t => t.timeStamp||0).filter(Boolean);

  return {
    totalTransactions: transactions.length,
    last30Days:        recent.length,
    lateNightCount:    lateNight.length,
    failedCount:       transactions.filter(t => t.isError).length,
    rapidFireCount,
    activeDays:        uniqueDays.size,
    avgPerActiveDay:   uniqueDays.size > 0
      ? (recent.length / uniqueDays.size).toFixed(1) : '0',
    oldestTxDate: allTs.length
      ? new Date(Math.min(...allTs) * 1000).toISOString().split('T')[0] : null,
    newestTxDate: allTs.length
      ? new Date(Math.max(...allTs) * 1000).toISOString().split('T')[0] : null,
  };
}

// ── Helius: fetch parsed transaction history ──────────────────
// Uses the Enhanced Transactions API (v0 /parsed-transactions)
// Docs: https://docs.helius.dev/solana-apis/enhanced-transactions-api
async function fetchHelius(address, apiKey) {
  const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${apiKey}&limit=100&type=ANY`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn('[solana/helius] non-ok:', res.status, body.slice(0, 200));
    return [];
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) {
    console.warn('[solana/helius] unexpected response shape:', JSON.stringify(raw).slice(0, 200));
    return [];
  }
  console.log('[solana/helius] ok — tx count:', raw.length);
  return raw.map(tx => ({
    hash:        tx.signature || '',
    timeStamp:   tx.timestamp || 0,
    from:        address,
    to:          tx.instructions?.[0]?.accounts?.[1] || '',
    value:       String(tx.nativeTransfers?.[0]?.amount || 0),
    isError:     tx.transactionError !== null && tx.transactionError !== undefined,
    type:        tx.type || 'TRANSACTION',
    chainName:   'Solana',
    chainKey:    'sol',
    symbol:      'SOL',
    description: tx.description || tx.type || 'Solana transaction',
  }));
}

// ── Solscan Pro v2: fetch account transactions ────────────────
// Docs: https://pro-api.solscan.io/pro-api-docs/v2.0
async function fetchSolscan(address, apiKey) {
  // Solscan Pro v2 — correct endpoint and auth header
  const url = `https://pro-api.solscan.io/v2.0/account/transactions?address=${address}&page=1&page_size=100`;
  const res = await fetch(url, {
    headers: {
      'token': apiKey,
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn('[solana/solscan] non-ok:', res.status, body.slice(0, 200));
    return [];
  }
  const json = await res.json();
  // v2 response: { success: true, data: [...] }
  const raw = Array.isArray(json.data) ? json.data : [];
  console.log('[solana/solscan] ok — tx count:', raw.length);
  return raw.map(tx => ({
    hash:        tx.txHash || tx.signature || '',
    timeStamp:   tx.blockTime || 0,
    from:        address,
    to:          tx.parsedInstruction?.[0]?.programId || '',
    value:       '0',
    isError:     tx.status === 'fail' || tx.status === 'Fail',
    type:        tx.parsedInstruction?.[0]?.type || 'transaction',
    chainName:   'Solana',
    chainKey:    'sol',
    symbol:      'SOL',
    description: tx.parsedInstruction?.[0]?.type || 'Solana transaction',
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Missing Solana wallet address' });

  // Base58 address: 32–44 chars, alphanumeric (no 0/O/I/l)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid Solana address format' });
  }

  const HELIUS_API_KEY  = process.env.HELIUS_API_KEY;
  const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY;

  // No keys — return empty gracefully rather than erroring
  if (!HELIUS_API_KEY && !SOLSCAN_API_KEY) {
    console.warn('[solana] No API keys configured — returning empty. Set HELIUS_API_KEY in Vercel env vars.');
    return res.status(200).json({
      ...emptyResult(),
      warning: 'No Solana API key configured. Add HELIUS_API_KEY to Vercel environment variables.',
    });
  }

  try {
    let transactions = [];
    let provider = 'none';

    // ── Try Helius first (recommended — free tier) ──
    if (HELIUS_API_KEY && transactions.length === 0) {
      transactions = await fetchHelius(address, HELIUS_API_KEY);
      if (transactions.length > 0) provider = 'helius';
    }

    // ── Fall back to Solscan ──
    if (SOLSCAN_API_KEY && transactions.length === 0) {
      transactions = await fetchSolscan(address, SOLSCAN_API_KEY);
      if (transactions.length > 0) provider = 'solscan';
    }

    console.log(`[solana] provider=${provider} transactions=${transactions.length} address=${address.slice(0,8)}...`);

    transactions.sort((a, b) => b.timeStamp - a.timeStamp);

    return res.status(200).json({
      transactions,
      chainsScanned: transactions.length > 0 ? ['Solana'] : [],
      stats: computeStats(transactions),
      provider,
    });

  } catch (err) {
    console.error('[solana] proxy error:', err.message);
    return res.status(200).json({
      ...emptyResult(),
      error: err.message,
    });
  }
}