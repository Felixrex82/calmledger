/**
 * CalmChain — Wallet Proxy
 * Vercel Serverless Function: /api/wallet
 *
 * Sits between the browser and blockchain explorer APIs.
 * Solves CORS. Keeps your API keys off the client.
 *
 * Supported chains: Ethereum, BNB Chain, Polygon, Arbitrum, Base
 * Query params:
 *   ?address=0x...   — wallet address (required)
 *   ?chains=eth,bsc  — comma-separated chain keys (default: eth)
 *   ?type=tx|token   — txlist or tokentx (default: both)
 */

const CHAIN_CONFIGS = {
  eth:     { name: 'Ethereum', api: 'https://api.etherscan.io/api',     key: process.env.ETHERSCAN_API_KEY,  symbol: 'ETH'   },
  bsc:     { name: 'BNB Chain', api: 'https://api.bscscan.com/api',     key: process.env.BSCSCAN_API_KEY,    symbol: 'BNB'   },
  polygon: { name: 'Polygon',  api: 'https://api.polygonscan.com/api',  key: process.env.ETHERSCAN_API_KEY,  symbol: 'MATIC' },
  arb:     { name: 'Arbitrum', api: 'https://api.arbiscan.io/api',      key: process.env.ETHERSCAN_API_KEY,  symbol: 'ETH'   },
  base:    { name: 'Base',     api: 'https://api.basescan.org/api',     key: process.env.ETHERSCAN_API_KEY,  symbol: 'ETH'   },
};

export default async function handler(req, res) {
  // ── CORS headers — allow your deployed frontend domain ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { address, chains = 'eth', type = 'both' } = req.query;

  // ── Validate address ──
  if (!address) return res.status(400).json({ error: 'Missing wallet address' });
  if (!address.startsWith('0x') || address.length !== 42) {
    return res.status(400).json({ error: 'Invalid EVM address format' });
  }

  const chainList = chains.split(',').map(c => c.trim().toLowerCase());
  const results = { transactions: [], tokenTransfers: [], chainsScanned: [], errors: [] };

  await Promise.all(chainList.map(async (chainKey) => {
    const cfg = CHAIN_CONFIGS[chainKey];
    if (!cfg) {
      results.errors.push(`Unknown chain: ${chainKey}`);
      return;
    }

    const apiKey = cfg.key || 'YourApiKeyToken';
    const baseParams = `&address=${address}&page=1&sort=desc&apikey=${apiKey}`;

    // ── Fetch regular transactions ──
    if (type === 'tx' || type === 'both') {
      try {
        const url = `${cfg.api}?module=account&action=txlist${baseParams}&offset=100&startblock=0&endblock=99999999`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === '1' && Array.isArray(data.result)) {
          const mapped = data.result.map(tx => ({
            hash:        tx.hash,
            timeStamp:   parseInt(tx.timeStamp),
            from:        tx.from,
            to:          tx.to,
            value:       tx.value,
            isError:     tx.isError === '1',
            gasPrice:    tx.gasPrice,
            gasUsed:     tx.gasUsed,
            functionName: tx.functionName || '',
            chainName:   cfg.name,
            chainKey,
            symbol:      cfg.symbol,
            type:        'tx',
          }));
          results.transactions.push(...mapped);
          if (!results.chainsScanned.includes(cfg.name)) {
            results.chainsScanned.push(cfg.name);
          }
        }
      } catch (err) {
        results.errors.push(`${cfg.name} tx fetch failed: ${err.message}`);
      }
    }

    // ── Fetch ERC-20 token transfers (DEX swaps show up here) ──
    if (type === 'token' || type === 'both') {
      try {
        const url = `${cfg.api}?module=account&action=tokentx${baseParams}&offset=50&startblock=0&endblock=99999999`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === '1' && Array.isArray(data.result)) {
          const mapped = data.result.map(tx => ({
            hash:          tx.hash,
            timeStamp:     parseInt(tx.timeStamp),
            from:          tx.from,
            to:            tx.to,
            tokenName:     tx.tokenName,
            tokenSymbol:   tx.tokenSymbol,
            tokenDecimal:  tx.tokenDecimal,
            value:         tx.value,
            chainName:     cfg.name,
            chainKey,
            symbol:        cfg.symbol,
            type:          'token_transfer',
            isTrade:       true,
          }));
          results.tokenTransfers.push(...mapped);
        }
      } catch (err) {
        results.errors.push(`${cfg.name} token fetch failed: ${err.message}`);
      }
    }
  }));

  // ── Sort everything by timestamp descending ──
  results.transactions.sort((a, b) => b.timeStamp - a.timeStamp);
  results.tokenTransfers.sort((a, b) => b.timeStamp - a.timeStamp);

  // ── Compute basic behavioral stats server-side ──
  const allTxs = [...results.transactions, ...results.tokenTransfers];
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60);
  const recentTxs = allTxs.filter(tx => tx.timeStamp > thirtyDaysAgo);

  // Late night = between 11pm and 6am UTC
  const lateNightTxs = recentTxs.filter(tx => {
    const hour = new Date(tx.timeStamp * 1000).getUTCHours();
    return hour >= 23 || hour < 6;
  });

  // Failed transactions (desperation/urgency signal)
  const failedTxs = results.transactions.filter(tx => tx.isError);

  // Rapid fire = multiple txs within 10 minutes of each other
  let rapidFireCount = 0;
  const sortedRecent = [...recentTxs].sort((a, b) => a.timeStamp - b.timeStamp);
  for (let i = 1; i < sortedRecent.length; i++) {
    if (sortedRecent[i].timeStamp - sortedRecent[i-1].timeStamp < 600) {
      rapidFireCount++;
    }
  }

  // Days active
  const uniqueDays = new Set(recentTxs.map(tx => new Date(tx.timeStamp * 1000).toDateString()));

  results.stats = {
    totalTransactions:    allTxs.length,
    last30Days:           recentTxs.length,
    lateNightCount:       lateNightTxs.length,
    failedCount:          failedTxs.length,
    rapidFireCount,
    activeDays:           uniqueDays.size,
    avgPerActiveDay:      uniqueDays.size > 0 ? (recentTxs.length / uniqueDays.size).toFixed(1) : '0',
    oldestTxDate:         allTxs.length > 0 ? new Date(Math.min(...allTxs.map(t => t.timeStamp)) * 1000).toISOString().split('T')[0] : null,
    newestTxDate:         allTxs.length > 0 ? new Date(Math.max(...allTxs.map(t => t.timeStamp)) * 1000).toISOString().split('T')[0] : null,
  };

  return res.status(200).json(results);
}