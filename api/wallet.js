/**
 * CalmLedger — EVM Wallet Proxy
 * Vercel Serverless Function: /api/wallet
 *
 * Uses Etherscan v2 API — supports all chains with one key.
 */

const CHAIN_CONFIGS = {
  eth:     { name: 'Ethereum', api: 'https://api.etherscan.io/v2/api', chainid: 1,     symbol: 'ETH'  },
  bsc:     { name: 'BNB Chain', api: 'https://api.etherscan.io/v2/api', chainid: 56,   symbol: 'BNB'  },
  polygon: { name: 'Polygon',  api: 'https://api.etherscan.io/v2/api', chainid: 137,   symbol: 'MATIC'},
  arb:     { name: 'Arbitrum', api: 'https://api.etherscan.io/v2/api', chainid: 42161, symbol: 'ETH'  },
  base:    { name: 'Base',     api: 'https://api.etherscan.io/v2/api', chainid: 8453,  symbol: 'ETH'  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Guard: API key required ──
  const etherscanKey = process.env.ETHERSCAN_API_KEY;
  if (!etherscanKey) {
    console.error('[api/wallet] ETHERSCAN_API_KEY not set');
    return res.status(500).json({ error: 'ETHERSCAN_API_KEY not configured on server' });
  }

  const { address, chains = 'eth', type = 'both' } = req.query;

  if (!address) return res.status(400).json({ error: 'Missing wallet address' });
  if (!address.startsWith('0x') || address.length !== 42) {
    return res.status(400).json({ error: 'Invalid EVM address format' });
  }

  const chainList = chains.split(',').map(c => c.trim().toLowerCase());
  const results = { transactions: [], tokenTransfers: [], chainsScanned: [], errors: [] };

  await Promise.all(chainList.map(async (chainKey) => {
    const cfg = CHAIN_CONFIGS[chainKey];
    if (!cfg) { results.errors.push(`Unknown chain: ${chainKey}`); return; }

    const apiKey = etherscanKey; // validated above — never a placeholder
    const baseParams = `&chainid=${cfg.chainid}&address=${address}&page=1&sort=desc&apikey=${apiKey}`;

    // ── Regular transactions ──
    if (type === 'tx' || type === 'both') {
      try {
        const url = `${cfg.api}?module=account&action=txlist${baseParams}&offset=100&startblock=0&endblock=99999999`;
        const response = await fetch(url);
        const data = await response.json();

        console.log(`[${cfg.name}] tx status=${data.status} message=${data.message} count=${Array.isArray(data.result) ? data.result.length : data.result}`);

        if (data.status === '1' && Array.isArray(data.result)) {
          results.transactions.push(...data.result.map(tx => ({
            hash:         tx.hash,
            timeStamp:    parseInt(tx.timeStamp),
            from:         tx.from,
            to:           tx.to,
            value:        tx.value,
            isError:      tx.isError === '1',
            gasPrice:     tx.gasPrice,
            gasUsed:      tx.gasUsed,
            functionName: tx.functionName || '',
            chainName:    cfg.name,
            chainKey,
            symbol:       cfg.symbol,
            type:         'tx',
          })));
          if (!results.chainsScanned.includes(cfg.name)) results.chainsScanned.push(cfg.name);
        } else {
          results.errors.push(`${cfg.name} tx: status=${data.status} msg=${data.message}`);
        }
      } catch (err) {
        results.errors.push(`${cfg.name} tx fetch failed: ${err.message}`);
      }
    }

    // ── ERC-20 token transfers ──
    if (type === 'token' || type === 'both') {
      try {
        const url = `${cfg.api}?module=account&action=tokentx${baseParams}&offset=50&startblock=0&endblock=99999999`;
        const response = await fetch(url);
        const data = await response.json();

        console.log(`[${cfg.name}] token status=${data.status} message=${data.message} count=${Array.isArray(data.result) ? data.result.length : data.result}`);

        if (data.status === '1' && Array.isArray(data.result)) {
          results.tokenTransfers.push(...data.result.map(tx => ({
            hash:         tx.hash,
            timeStamp:    parseInt(tx.timeStamp),
            from:         tx.from,
            to:           tx.to,
            tokenName:    tx.tokenName,
            tokenSymbol:  tx.tokenSymbol,
            tokenDecimal: tx.tokenDecimal,
            value:        tx.value,
            chainName:    cfg.name,
            chainKey,
            symbol:       cfg.symbol,
            type:         'token_transfer',
            isTrade:      true,
          })));
        } else {
          results.errors.push(`${cfg.name} token: status=${data.status} msg=${data.message}`);
        }
      } catch (err) {
        results.errors.push(`${cfg.name} token fetch failed: ${err.message}`);
      }
    }
  }));

  // ── Sort by timestamp ──
  results.transactions.sort((a, b) => b.timeStamp - a.timeStamp);
  results.tokenTransfers.sort((a, b) => b.timeStamp - a.timeStamp);

  // ── Behavioral stats ──
  const allTxs = [...results.transactions, ...results.tokenTransfers];
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60);
  const recentTxs = allTxs.filter(tx => tx.timeStamp > thirtyDaysAgo);

  const lateNightTxs = recentTxs.filter(tx => {
    const hour = new Date(tx.timeStamp * 1000).getUTCHours();
    return hour >= 23 || hour < 6;
  });

  const failedTxs = results.transactions.filter(tx => tx.isError);

  let rapidFireCount = 0;
  const sortedRecent = [...recentTxs].sort((a, b) => a.timeStamp - b.timeStamp);
  for (let i = 1; i < sortedRecent.length; i++) {
    if (sortedRecent[i].timeStamp - sortedRecent[i - 1].timeStamp < 600) rapidFireCount++;
  }

  const uniqueDays = new Set(recentTxs.map(tx => new Date(tx.timeStamp * 1000).toDateString()));

  results.stats = {
    totalTransactions: allTxs.length,
    last30Days:        recentTxs.length,
    lateNightCount:    lateNightTxs.length,
    failedCount:       failedTxs.length,
    rapidFireCount,
    activeDays:        uniqueDays.size,
    avgPerActiveDay:   uniqueDays.size > 0 ? (recentTxs.length / uniqueDays.size).toFixed(1) : '0',
    oldestTxDate:      allTxs.length > 0 ? new Date(Math.min(...allTxs.map(t => t.timeStamp)) * 1000).toISOString().split('T')[0] : null,
    newestTxDate:      allTxs.length > 0 ? new Date(Math.max(...allTxs.map(t => t.timeStamp)) * 1000).toISOString().split('T')[0] : null,
  };

  // ── Behavior Profile ──
  // Classifies the trader into a human-readable archetype based on patterns.
  // This gives the AI coach a strong anchor for its tone and advice.
  let profile = 'Unknown';
  const profileSignals = [];
  if (results.stats.rapidFireCount > 5) profileSignals.push('rapid transaction bursts');
  if (results.stats.lateNightCount > 3) profileSignals.push('late night activity');
  if (results.stats.failedCount > 2)    profileSignals.push('multiple failed transactions');

  if (profileSignals.length >= 2) {
    profile = 'High Stress Trader';
  } else if (results.stats.totalTransactions < 10) {
    profile = 'Calm Holder';
  } else if (results.stats.lateNightCount > 3) {
    profile = 'Night Trader';
  } else if (results.stats.rapidFireCount > 3) {
    profile = 'Impulsive Trader';
  } else {
    profile = 'Balanced Trader';
  }

  results.behaviorProfile = { profile, signals: profileSignals };

  // ── Wallet Stress Score ──
  // A 0-100 numeric score computed purely from on-chain data.
  // Sent to the AI so it can reference a concrete number in its analysis.
  let stressScore = 0;
  const stressSignals = [];

  if (results.stats.rapidFireCount > 3) {
    stressScore += 25;
    stressSignals.push('rapid trading bursts');
  }
  if (results.stats.lateNightCount > 2) {
    stressScore += 20;
    stressSignals.push('late night activity');
  }
  if (results.stats.failedCount > 1) {
    stressScore += 20;
    stressSignals.push('multiple failed transactions');
  }
  if (results.stats.last30Days > 50) {
    stressScore += 15;
    stressSignals.push('high activity in last 30 days');
  }
  if (parseFloat(results.stats.avgPerActiveDay) > 5) {
    stressScore += 20;
    stressSignals.push('high trading intensity');
  }

  const stressLevel = stressScore >= 70 ? 'High' : stressScore >= 40 ? 'Moderate' : 'Low';

  results.stressAnalysis = { stressScore, stressLevel, signals: stressSignals };

  // ── Calm Recommendation ──
  // A pre-computed plain-English recommendation based on stress signals.
  // The AI coach uses this as a baseline and adds its own nuance on top.
  let recommendation = 'Your wallet activity appears balanced. Keep trading mindfully.';
  if (stressLevel === 'High') {
    recommendation = 'Your wallet shows signs of high trading stress. Consider stepping away for a while.';
  } else if (stressLevel === 'Moderate') {
    recommendation = 'Your trading activity is elevated. A short break could help maintain clarity.';
  }
  if (results.stats.lateNightCount > 3) {
    recommendation += ' Late-night trading detected — fatigue significantly affects decision quality.';
  }
  if (results.stats.failedCount > 2) {
    recommendation += ' Multiple failed transactions suggest possible rushed decisions.';
  }

  results.calmAdvice = { message: recommendation };

  return res.status(200).json(results);
}