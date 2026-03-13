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
  // Two-step approach that works for ALL transaction types including plain SOL transfers:
  // Step 1: getSignaturesForAddress via standard RPC — returns up to 100 recent sigs
  // Step 2: parse enhanced details for those sigs in one batch POST call
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;

  // ── Step 1: get signatures ──
  let sigRes;
  try {
    sigRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getSignaturesForAddress',
        params: [ address, { limit: 50, commitment: 'finalized' } ],
      }),
    });
  } catch(e) {
    return { ok: false, transactions: [], error: 'getSignaturesForAddress network error: ' + e.message };
  }

  const sigBody = await sigRes.text();
  if (!sigRes.ok) {
    return { ok: false, transactions: [], error: `getSignaturesForAddress HTTP ${sigRes.status}: ${sigBody.slice(0,200)}` };
  }

  let sigJson;
  try { sigJson = JSON.parse(sigBody); } catch(e) {
    return { ok: false, transactions: [], error: 'getSignaturesForAddress JSON parse error' };
  }

  if (sigJson.error) {
    console.warn('[solana/helius] RPC error:', sigJson.error);
    return { ok: false, transactions: [], error: 'RPC: ' + JSON.stringify(sigJson.error) };
  }

  const sigs = (sigJson.result || []).map(s => s.signature);
  console.log('[solana/helius] signatures fetched:', sigs.length);

  if (sigs.length === 0) {
    // Wallet exists but has no transactions
    return { ok: true, transactions: [], error: null };
  }

  // ── Step 2: parse enhanced transactions ──
  let txRes;
  try {
    txRes = await fetch(`https://api-mainnet.helius-rpc.com/v0/transactions?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: sigs }),
    });
  } catch(e) {
    // Step 2 failed — fall back to raw signature data only
    console.warn('[solana/helius] enhanced parse failed, using raw sigs:', e.message);
    return buildFromSigs(sigJson.result, address);
  }

  const txBody = await txRes.text();
  if (!txRes.ok) {
    console.warn('[solana/helius] enhanced parse non-ok:', txRes.status, '— falling back to raw sigs');
    return buildFromSigs(sigJson.result, address);
  }

  let txJson;
  try { txJson = JSON.parse(txBody); } catch(e) {
    return buildFromSigs(sigJson.result, address);
  }

  if (!Array.isArray(txJson)) {
    console.warn('[solana/helius] unexpected enhanced shape, falling back');
    return buildFromSigs(sigJson.result, address);
  }

  console.log('[solana/helius] enhanced txns:', txJson.length);
  return {
    ok: true,
    transactions: txJson.map(tx => ({
      hash:        tx.signature || '',
      timeStamp:   tx.timestamp || 0,
      from:        tx.feePayer || address,
      to:          tx.nativeTransfers?.[0]?.toUserAccount || '',
      value:       String(tx.nativeTransfers?.[0]?.amount || 0),
      isError:     !!tx.transactionError,
      type:        tx.type || 'TRANSACTION',
      chainName:   'Solana',
      chainKey:    'sol',
      symbol:      'SOL',
      description: tx.description || tx.type || 'Solana transaction',
    })),
    error: null,
  };
}

// Fallback: build minimal transaction objects from raw signature list
function buildFromSigs(sigResults, address) {
  return {
    ok: true,
    transactions: (sigResults || []).map(s => ({
      hash:        s.signature,
      timeStamp:   s.blockTime || 0,
      from:        address,
      to:          '',
      value:       '0',
      isError:     !!s.err,
      type:        'TRANSACTION',
      chainName:   'Solana',
      chainKey:    'sol',
      symbol:      'SOL',
      description: s.memo || 'Solana transaction',
    })),
    error: null,
  };
}

// ── Solscan Pro v2: fetch account transactions ────────────────
// Docs: https://pro-api.solscan.io/pro-api-docs/v2.0
async function fetchSolscan(address, apiKey) {
  const url = `https://pro-api.solscan.io/v2.0/account/transactions?address=${address}&page=1&page_size=100`;
  let res;
  try {
    res = await fetch(url, { headers: { 'token': apiKey } });
  } catch(e) {
    console.warn('[solana/solscan] network error:', e.message);
    return { ok: false, transactions: [], error: e.message };
  }

  const body = await res.text();
  if (!res.ok) {
    console.warn('[solana/solscan] non-ok:', res.status, body.slice(0, 300));
    return { ok: false, transactions: [], error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  }

  let json;
  try { json = JSON.parse(body); } catch(e) {
    return { ok: false, transactions: [], error: 'Invalid JSON response' };
  }

  const raw = Array.isArray(json.data) ? json.data : [];
  console.log('[solana/solscan] ok — tx count:', raw.length);
  return {
    ok: true,
    transactions: raw.map(tx => ({
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
    })),
    error: null,
  };
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

    const errors = [];

    // ── Try Helius first (recommended — free tier) ──
    if (HELIUS_API_KEY) {
      const result = await fetchHelius(address, HELIUS_API_KEY);
      if (result.ok) {
        transactions = result.transactions;
        provider = 'helius';
        // provider stays 'helius' even if 0 txns — wallet just has no history
      } else {
        errors.push('Helius: ' + result.error);
      }
    }

    // ── Fall back to Solscan if Helius errored (not just empty) ──
    if (SOLSCAN_API_KEY && provider === 'none') {
      const result = await fetchSolscan(address, SOLSCAN_API_KEY);
      if (result.ok) {
        transactions = result.transactions;
        provider = 'solscan';
      } else {
        errors.push('Solscan: ' + result.error);
      }
    }

    console.log(`[solana] provider=${provider} txns=${transactions.length} errors=${JSON.stringify(errors)} address=${address.slice(0,8)}...`);

    transactions.sort((a, b) => b.timeStamp - a.timeStamp);

    return res.status(200).json({
      transactions,
      chainsScanned: transactions.length > 0 ? ['Solana'] : [],
      stats: computeStats(transactions),
      provider,
      // errors array tells you exactly why a provider failed, even if overall response is 200
      apiErrors: errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    console.error('[solana] proxy error:', err.message);
    return res.status(200).json({
      ...emptyResult(),
      error: err.message,
    });
  }
}