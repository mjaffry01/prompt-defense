/**
 * Prompt Defense class server (Cloudflare Worker).
 *
 * Why this exists: a website can't keep an API key secret, because anything in the page can be read.
 * This tiny server holds your key, checks a class passcode, and forwards the student's request.
 *
 * Secrets and variables (set in the Cloudflare dashboard or with `wrangler secret put`):
 *   CLASS_PASSCODE      The passcode you give your students. Required.
 *   ANTHROPIC_API_KEY   Needed if you allow Anthropic models.
 *   OPENAI_API_KEY      Needed if you allow OpenAI (or compatible) models.
 *   OPENAI_BASE_URL     Optional. Defaults to https://api.openai.com/v1
 *   ALLOWED_MODELS      Required. JSON object of model ID to provider, for example
 *                       {"claude-haiku-5-5":"anthropic","gpt-4o-mini":"openai"}
 *   ALLOWED_ORIGINS     Optional. Comma-separated site addresses allowed to call this server,
 *                       for example https://yourschool.github.io . Defaults to any.
 *   MAX_TOKENS_CAP      Optional. Upper limit on tokens per request. Default 1500.
 *   RATE_PER_MIN        Optional. Requests per minute per visitor address. Default 30.
 */
const hits = new Map();

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors) });
}
function same(a, b) {
  a = String(a); b = String(b);
  let r = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}
function limited(ip, perMin) {
  const now = Date.now(), win = hits.get(ip) || [];
  const recent = win.filter(t => now - t < 60000);
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > perMin;
}
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0] || ''),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: { message: 'Use POST.' } }, 405, cors);
    if (!allowed.includes('*') && !allowed.includes(origin)) return json({ error: { message: 'This site is not allowed to use the class server.' } }, 403, cors);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: { message: 'Bad request.' } }, 400, cors); }
    if (!env.CLASS_PASSCODE || !same(body.passcode || '', env.CLASS_PASSCODE)) return json({ error: { message: 'Wrong class passcode.' } }, 401, cors);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (limited(ip, Number(env.RATE_PER_MIN || 30))) return json({ error: { message: 'Slow down: too many requests.' } }, 429, cors);

    let models = {};
    try { models = JSON.parse(env.ALLOWED_MODELS || '{}'); } catch (e) {}
    const provider = models[body.model];
    if (!provider) return json({ error: { message: 'That model is not available on this class server.' } }, 400, cors);

    const system = String(body.system || '').slice(0, 12000);
    const user = String(body.user || '').slice(0, 12000);
    const p = body.params || {};
    const cap = Number(env.MAX_TOKENS_CAP || 1500);
    const max_tokens = Math.min(cap, Math.max(1, Math.round(num(p.max_tokens, 1024))));
    const stop = (Array.isArray(p.stop) ? p.stop : []).map(s => String(s).slice(0, 40)).filter(Boolean).slice(0, 4);

    try {
      if (provider === 'anthropic') {
        if (!env.ANTHROPIC_API_KEY) return json({ error: { message: 'Server has no Anthropic key.' } }, 500, cors);
        const req = { model: body.model, max_tokens, messages: [{ role: 'user', content: user }] };
        if (system) req.system = system;
        if (p.temperature != null) req.temperature = Math.min(1, Math.max(0, num(p.temperature, 0)));
        if (p.top_p != null && p.top_p < 1) req.top_p = num(p.top_p, 1);
        if (p.top_k != null && p.top_k < 13) req.top_k = Math.max(1, Math.round(num(p.top_k, 13)));
        if (stop.length) req.stop_sequences = stop;
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(req),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) return json({ error: { message: (d && d.error && d.error.message) || 'Provider error.' } }, r.status, cors);
        const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        return json({ text, finish: d.stop_reason === 'max_tokens' ? 'length' : d.stop_reason === 'stop_sequence' ? 'stop_sequence' : 'end', stop_sequence: d.stop_sequence || null, out_tokens: d.usage ? d.usage.output_tokens : null }, 200, cors);
      }
      if (provider === 'openai') {
        if (!env.OPENAI_API_KEY) return json({ error: { message: 'Server has no OpenAI key.' } }, 500, cors);
        const base = String(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const req = { model: body.model, max_tokens, messages: (system ? [{ role: 'system', content: system }] : []).concat([{ role: 'user', content: user }]) };
        if (p.temperature != null) req.temperature = Math.min(2, Math.max(0, num(p.temperature, 0)));
        if (p.top_p != null && p.top_p < 1) req.top_p = num(p.top_p, 1);
        if (stop.length) req.stop = stop;
        if (p.freq) req.frequency_penalty = Math.min(2, Math.max(-2, num(p.freq, 0)));
        if (p.pres) req.presence_penalty = Math.min(2, Math.max(-2, num(p.pres, 0)));
        if (p.seed != null) req.seed = Math.round(num(p.seed, 0));
        let r = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENAI_API_KEY }, body: JSON.stringify(req) });
        let d = await r.json().catch(() => null);
        if (!r.ok && r.status === 400 && d && d.error && /max_completion_tokens/i.test(d.error.message || '')) {
          req.max_completion_tokens = req.max_tokens; delete req.max_tokens;
          r = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENAI_API_KEY }, body: JSON.stringify(req) });
          d = await r.json().catch(() => null);
        }
        if (!r.ok) return json({ error: { message: (d && d.error && d.error.message) || 'Provider error.' } }, r.status, cors);
        const ch = d.choices && d.choices[0];
        return json({ text: (ch && ch.message && ch.message.content) || '', finish: ch && ch.finish_reason === 'length' ? 'length' : 'end', stop_sequence: null, out_tokens: d.usage ? d.usage.completion_tokens : null }, 200, cors);
      }
      return json({ error: { message: 'Unknown provider in ALLOWED_MODELS.' } }, 500, cors);
    } catch (e) {
      return json({ error: { message: 'Could not reach the provider.' } }, 502, cors);
    }
  },
};
