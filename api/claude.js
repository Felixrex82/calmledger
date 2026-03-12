/**
 * CalmLedger — OpenAI Proxy
 * Vercel Serverless Function: /api/claude
 *
 * Drop-in replacement for the Anthropic proxy.
 * Same endpoint (/api/claude), same request format from the frontend.
 * Translates to OpenAI's chat completions API internally.
 */

export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });
  }

  try {
    // ── Parse body manually (Vercel ES modules don't auto-parse) ──
    let parsed = req.body;
    if (!parsed || typeof parsed === 'string') {
      try {
        const raw = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => resolve(data));
          req.on('error', reject);
        });
        parsed = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    const { messages, system, max_tokens = 800 } = parsed;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    // ── Build OpenAI messages array ──
    // OpenAI uses a "system" message at the start instead of a separate field
    const openaiMessages = [];
    if (system) {
      openaiMessages.push({ role: 'system', content: system });
    }
    openaiMessages.push(...messages);

    const body = {
      model: 'gpt-4o-mini',   // Cheap, fast, very capable — $0.15/1M input tokens
      max_tokens,
      messages: openaiMessages,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'OpenAI API error' });
    }

    // ── Translate OpenAI response format → Anthropic format ──
    // Frontend expects: data.content[0].text
    // OpenAI returns:   data.choices[0].message.content
    const translated = {
      content: [
        { type: 'text', text: data.choices?.[0]?.message?.content || '' }
      ],
      model: data.model,
      usage: data.usage,
    };

    return res.status(200).json(translated);

  } catch (err) {
    console.error('OpenAI proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}