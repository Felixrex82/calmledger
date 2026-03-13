/**
 * CalmLedger — Groq Proxy
 * Vercel Serverless Function: /api/claude
 *
 * Drop-in replacement. Same endpoint, same response format for the frontend.
 * Uses Groq's free tier — llama-3.3-70b-versatile.
 * Sign up free at console.groq.com, no credit card required.
 */

export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured on server' });
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

    console.log('[api/claude] request — messages:', messages.length, 'max_tokens:', max_tokens);

    // ── Build Groq messages array ──
    // Groq uses OpenAI format — system prompt goes as first message
    const groqMessages = [];
    if (system) {
      groqMessages.push({ role: 'system', content: system });
    }
    groqMessages.push(...messages);

    const body = {
      model: 'llama-3.3-70b-versatile', // Free, fast, very capable
      max_tokens,
      messages: groqMessages,
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq error:', response.status, data);
      // Surface rate limit errors clearly so the frontend can show a helpful message
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') || '60';
        return res.status(429).json({
          error: `Groq rate limit hit. Resets in ~${retryAfter}s. The daily analysis runs once per day to avoid this.`,
          retryAfter: parseInt(retryAfter),
          rateLimited: true,
        });
      }
      return res.status(response.status).json({ error: data.error?.message || 'Groq API error' });
    }

    console.log('[api/claude] Groq response ok — model:', data.model, 'tokens used:', data.usage?.total_tokens);
    // ── Translate Groq response → Anthropic format ──
    // Frontend expects: data.content[0].text
    // Groq returns:     data.choices[0].message.content
    const translated = {
      content: [
        { type: 'text', text: data.choices?.[0]?.message?.content || '' }
      ],
      model: data.model,
      usage: data.usage,
    };

    return res.status(200).json(translated);

  } catch (err) {
    console.error('Groq proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}