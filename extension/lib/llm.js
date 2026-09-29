// Optional LLM synthesis (spec §8.3). BYOK: the user's Claude API key, stored in chrome.storage.local.
// The LLM only names, structures and writes: every number it writes must exist in the measured data.
// Raw fetch is used because the extension ships without a bundler (the SDK can't be imported as-is).

export const LLM_MODEL = 'claude-sonnet-5-5';
export const PROMPT_VERSION = 'synthesis-v1';

const SYSTEM = `You are a senior creative front-end engineer. You receive EXACT MEASUREMENTS of a website captured in a browser (effects with traces, easings, durations, shader uniforms, design tokens).
Tasks:
1. Write a short overview of the site's visual and motion language (4-6 sentences).
2. For every effect: name it in one precise sentence, then explain how it is built (DOM structure, CSS, JS, shader) in 2-4 sentences.
3. For every WebGL program: explain the principle (inputs, maths, animated uniforms and their source, key parameters) in 3-5 sentences.
Constraints: use ONLY the numeric values present in the data. If information is missing, write [unknown]. Never invent a value. Write in English.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'effects', 'shaders'],
  properties: {
    overview: { type: 'string' },
    effects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'summary'], properties: { id: { type: 'string' }, summary: { type: 'string' } } } },
    shaders: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'summary'], properties: { id: { type: 'string' }, summary: { type: 'string' } } } },
  },
};

function compactInput(analysis) {
  return {
    url: analysis.url,
    tier: analysis.tier,
    stack: analysis.stack.filter((s) => s.confidence >= 0.6).map((s) => `${s.name}${s.version ? '@' + s.version : ''}`),
    scroll: { type: analysis.scroll.type, feel: analysis.scroll.feel, options: analysis.scroll.options },
    typography: analysis.typography.slice(0, 6).map((r) => ({ role: r.role, family: r.fontFamily, size: r.fontSize, fluid: r.fluid && r.fluid.formula })),
    colors: analysis.tokens && analysis.tokens.color ? Object.fromEntries(Object.entries(analysis.tokens.color).slice(0, 6).map(([k, v]) => [k, v.$value])) : {},
    sections: analysis.sections.map((s) => ({ id: s.id, height: s.height, heading: s.heading })),
    effects: analysis.effects.map((e) => ({ id: e.id, type: e.effect_type, section: e.section, trigger: e.trigger, technique: e.technique, source: e.source, confidence: e.confidence, targets: (e.targets || []).slice(0, 4).map((t) => t.selector), split: e.split, scrollTrigger: e.scrollTrigger, animation: e.animation || {} })).map(safeJson),
    shaders: analysis.webgl.cards.map((c) => ({ id: c.id, type: c.type, uniforms: c.uniforms.map((u) => ({ name: u.name, drivenBy: u.drivenBy, range: u.range })), traits: c.traits, fragment: (c.fragment || '').slice(0, 4000) })),
  };
}
function safeJson(x) {
  try {
    return JSON.parse(JSON.stringify(x));
  } catch (e) {
    return {};
  }
}

// Every number in LLM text must exist in the measured data; otherwise it gets flagged [estimated].
export function checkNumbers(text, sourceJson) {
  const known = new Set((sourceJson.match(/-?\d+(?:\.\d+)?/g) || []).map((n) => String(parseFloat(n))));
  return text.replace(/(?<![\w#.-])(-?\d+(?:\.\d+)?)(?![\w.]*\d)/g, (m) => {
    const v = String(parseFloat(m));
    if (known.has(v) || /^[0-5]$/.test(v)) return m; // tiny integers (ordinals, "2 layers") are fine
    return m + ' [estimated]';
  });
}

export async function synthesize(analysis, apiKey, opts) {
  opts = opts || {};
  const input = compactInput(analysis);
  const inputJson = JSON.stringify(input);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: opts.model || LLM_MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: 'Measured data (JSON):\n' + inputJson }],
    }),
  });
  if (!res.ok) {
    let msg = res.status + '';
    try {
      const j = await res.json();
      msg += ' ' + ((j.error && j.error.message) || '');
    } catch (e) {
      /* ignore */
    }
    throw new Error('Claude API error ' + msg);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('Claude declined the request' + (data.stop_details && data.stop_details.category ? ` (${data.stop_details.category})` : ''));
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try {
    out = JSON.parse(text);
  } catch (e) {
    throw new Error('LLM output is not valid JSON');
  }
  if (!out || typeof out.overview !== 'string' || !Array.isArray(out.effects) || !Array.isArray(out.shaders)) throw new Error('LLM output does not match the schema');
  analysis.llm = { model: data.model, promptVersion: PROMPT_VERSION, overview: checkNumbers(out.overview, inputJson), usage: data.usage };
  for (const e of out.effects) {
    const fx = analysis.effects.find((x) => x.id === e.id);
    if (fx && typeof e.summary === 'string') fx.llm = { summary: checkNumbers(e.summary, inputJson) };
  }
  for (const s of out.shaders) {
    const c = analysis.webgl.cards.find((x) => x.id === s.id);
    if (c && typeof s.summary === 'string') c.llm = { summary: checkNumbers(s.summary, inputJson) };
  }
  return analysis.llm;
}
