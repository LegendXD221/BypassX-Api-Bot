import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { V2, card, errorContainer } from '../../components.js';
import { kvTable, codeBlock, cut, diffBlock, diffFail } from '../../format.js';

/* ------------------------------------------------------------------ */
/* /tools — network & web intelligence                                 */
/* ip · dns · headers · urlstatus · unshort · json · regex · jwt ·     */
/* qr · cron                                                           */
/*                                                                     */
/* Everything here is real: live public APIs (ip-api.com, dns.google,  */
/* qrserver.com) or pure local computation. No stubs, no placeholders. */
/* ------------------------------------------------------------------ */

const FETCH_TIMEOUT = 9000;
const fetchish = (url, init = {}) => fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT), ...init });

export default {
  data: new SlashCommandBuilder()
    .setName('tools')
    .setDescription('Network & web intelligence — IP lookup, DNS, headers, QR codes, cron math…')
    .addSubcommand((sc) =>
      sc
        .setName('ip')
        .setDescription('Look up any IP or domain — ISP, country, ASN, proxy/hosting flags')
        .addStringOption((o) => o.setName('target').setDescription('IPv4/IPv6 address or domain').setRequired(true).setMaxLength(200))
    )
    .addSubcommand((sc) =>
      sc
        .setName('dns')
        .setDescription('Resolve DNS records for a domain (via dns.google)')
        .addStringOption((o) => o.setName('domain').setDescription('Domain to resolve').setRequired(true).setMaxLength(200))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Record type (default A)')
            .addChoices(
              { name: 'A', value: 'A' },
              { name: 'AAAA', value: 'AAAA' },
              { name: 'CNAME', value: 'CNAME' },
              { name: 'MX', value: 'MX' },
              { name: 'TXT', value: 'TXT' },
              { name: 'NS', value: 'NS' },
              { name: 'SOA', value: 'SOA' },
              { name: 'CAA', value: 'CAA' }
            )
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('headers')
        .setDescription('Fetch a URL and show its HTTP response headers')
        .addStringOption((o) => o.setName('url').setDescription('The URL to inspect').setRequired(true).setMaxLength(1000))
    )
    .addSubcommand((sc) =>
      sc
        .setName('urlstatus')
        .setDescription('Quick HTTP status check of a URL — code, latency, redirects')
        .addStringOption((o) => o.setName('url').setDescription('The URL to check').setRequired(true).setMaxLength(1000))
    )
    .addSubcommand((sc) =>
      sc
        .setName('unshort')
        .setDescription('Expand a shortened link — follow every redirect hop')
        .addStringOption((o) => o.setName('url').setDescription('The short link to expand').setRequired(true).setMaxLength(1000))
    )
    .addSubcommand((sc) =>
      sc
        .setName('json')
        .setDescription('Validate & pretty-print JSON — shows the exact parse error')
        .addStringOption((o) => o.setName('data').setDescription('The JSON to check').setRequired(true).setMaxLength(1500))
    )
    .addSubcommand((sc) =>
      sc
        .setName('regex')
        .setDescription('Test a regular expression against text — live matches')
        .addStringOption((o) => o.setName('pattern').setDescription('The regex, e.g. \\d+').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('text').setDescription('Text to test against').setRequired(true).setMaxLength(1500))
        .addStringOption((o) =>
          o
            .setName('flags')
            .setDescription('Regex flags (default: g)')
            .addChoices({ name: 'g', value: 'g' }, { name: 'gi', value: 'gi' }, { name: 'i', value: 'i' }, { name: 'gm', value: 'gm' }, { name: 'gim', value: 'gim' })
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('jwt')
        .setDescription('Decode a JWT — header & payload (signature is NOT verified)')
        .addStringOption((o) => o.setName('token').setDescription('The JWT to decode').setRequired(true).setMaxLength(1800))
    )
    .addSubcommand((sc) =>
      sc
        .setName('qr')
        .setDescription('Turn text or a link into a scannable QR code image')
        .addStringOption((o) => o.setName('data').setDescription('Text or URL to encode').setRequired(true).setMaxLength(900))
    )
    .addSubcommand((sc) =>
      sc
        .setName('cron')
        .setDescription('Explain a cron expression and compute its next 3 runs (UTC)')
        .addStringOption((o) => o.setName('expression').setDescription('e.g. */15 9-17 * * 1-5').setRequired(true).setMaxLength(100))
    ),
  meta: { cooldownMs: 2500 },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'ip':
        return runIp(interaction);
      case 'dns':
        return runDns(interaction);
      case 'headers':
        return runHeaders(interaction);
      case 'urlstatus':
        return runUrlstatus(interaction);
      case 'unshort':
        return runUnshort(interaction);
      case 'json':
        return runJson(interaction);
      case 'regex':
        return runRegex(interaction);
      case 'jwt':
        return runJwt(interaction);
      case 'qr':
        return runQr(interaction);
      case 'cron':
        return runCron(interaction);
      default:
        return interaction.reply({
          flags: V2 | MessageFlags.Ephemeral,
          components: [errorContainer({ title: 'Unknown subcommand', description: `**${sub}** is not wired up — use \`/help\`.` })],
        });
    }
  },
};

const replyEphemeral = (interaction, body, extra = {}) =>
  interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ emoji: '🌐', title: 'Web tools', body, ...extra })],
  });

const replyPublic = (interaction, body, extra = {}) =>
  interaction.reply({
    flags: V2,
    components: [card({ emoji: '🌐', title: 'Web tools', body, ...extra })],
  });

const fail = (interaction, title, description) =>
  interaction.editReply({
    content: '',
    components: [errorContainer({ title, description })],
    flags: V2,
  });

const deferE = (interaction) => interaction.deferReply({ flags: MessageFlags.Ephemeral });
const deferP = (interaction) => interaction.deferReply();

const isUrl = (raw) => {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
};

/* ---------------- ip ---------------- */

async function runIp(interaction) {
  const target = interaction.options.getString('target', true).trim();
  await deferE(interaction);
  try {
    const fields = 'status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,reverse,mobile,proxy,hosting,query';
    const res = await fetchish(`http://ip-api.com/json/${encodeURIComponent(target)}?fields=${fields}`);
    if (!res.ok) throw new Error(`ip-api answered HTTP ${res.status}`);
    const d = await res.json();
    if (d.status !== 'success') throw new Error(d.message || 'lookup failed — is that a valid IP/domain?');
    const flags = [d.mobile ? '📱 mobile' : null, d.proxy ? '🕵️ proxy/VPN' : null, d.hosting ? '🖥️ hosting/datacenter' : null].filter(Boolean);
    await interaction.editReply({
      content: '',
      components: [
        card({
          emoji: '📡',
          title: `IP intel — ${d.query}`,
          body: [
            kvTable(
              [
                ['country', `${d.country} (${d.countryCode})`],
                ['region', `${d.regionName}`],
                ['city', `${d.city}${d.zip ? ` ${d.zip}` : ''}`],
                ['coords', `${d.lat}, ${d.lon}`],
                ['timezone', d.timezone],
                ['isp', cut(d.isp ?? '—', 60)],
                ['org', cut(d.org ?? '—', 60)],
                ['as', cut(d.as ?? '—', 60)],
                ['reverse', cut(d.reverse || '—', 60)],
                ['flags', flags.length ? flags.join(' · ') : 'clean residential'],
              ],
              { title: 'ip-api.com' }
            ),
          ],
          footerText: 'live data · ip-api.com free tier',
        }),
      ],
      flags: V2,
    });
  } catch (e) {
    return fail(interaction, 'IP lookup failed', cut(e.message, 300));
  }
}

/* ---------------- dns ---------------- */

const DNS_TYPE_NAMES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 257: 'CAA' };

async function runDns(interaction) {
  const domain = interaction.options.getString('domain', true).trim().replace(/^https?:\/\//, '').split('/')[0];
  const type = interaction.options.getString('type') ?? 'A';
  await deferE(interaction);
  try {
    const res = await fetchish(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`);
    if (!res.ok) throw new Error(`dns.google answered HTTP ${res.status}`);
    const d = await res.json();
    const answers = (d.Answer ?? []).map((a) => ({
      type: DNS_TYPE_NAMES[a.type] ?? String(a.type),
      ttl: a.TTL,
      data: a.data,
    }));
    const rows = answers.map((a) => [a.type.padEnd(6), cut(a.data, 110)]);
    const body = rows.length
      ? [kvTable(rows, { title: `${domain} · ${type} · ${answers.length} record(s)` })]
      : [diffFail(`no ${type} records found for ${domain} (status ${d.Status})`)];
    body.push(`-# resolver: dns.google (public) · nameserver: ${cut(d.Authority?.[0]?.data ?? d.AD ? 'ad=1' : '—', 60)}`);
    await interaction.editReply({ content: '', components: [card({ emoji: '🧭', title: `DNS — ${domain}`, body, footerText: 'live data · dns.google' })], flags: V2 });
  } catch (e) {
    return fail(interaction, 'DNS lookup failed', cut(e.message, 300));
  }
}

/* ---------------- headers ---------------- */

async function runHeaders(interaction) {
  const raw = interaction.options.getString('url', true).trim();
  await deferE(interaction);
  const url = isUrl(raw);
  if (!url) return fail(interaction, 'Invalid URL', 'Give me a full http(s) URL.');
  try {
    const started = Date.now();
    const res = await fetchish(url.href, { redirect: 'follow', headers: { 'user-agent': 'BypassX-Bot/2 (+tools /headers)' } });
    const ms = Date.now() - started;
    const interesting = ['server', 'content-type', 'content-length', 'cache-control', 'cf-ray', 'cf-cache-status', 'x-powered-by', 'location', 'set-cookie', 'strict-transport-security', 'via', 'date'];
    const rows = [];
    for (const h of interesting) {
      const v = res.headers.get(h);
      if (v) rows.push([h, cut(v.replace(/\s{2,}/g, ' ').split(', ').slice(0, 2).join(', '), 100)]);
    }
    rows.push(['(total)', `${[...res.headers.keys()].length} headers · ${ms}ms`]);
    const sec = res.headers.get('strict-transport-security') ?? res.headers.get('content-security-policy');
    await interaction.editReply({
      content: '',
      components: [
        card({
          emoji: '🧾',
          title: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
          body: [kvTable(rows, { title: cut(res.url, 70) }), sec ? '+ TLS/HSTS or CSP present — connection hardened' : '! no HSTS/CSP header detected'].join('\n\n'),
          footerText: `${ms}ms · followed ${res.redirected ? 'redirects' : 'no redirects'}`,
        }),
      ],
      flags: V2,
    });
  } catch (e) {
    return fail(interaction, 'Fetch failed', cut(e.message, 300));
  }
}

/* ---------------- urlstatus ---------------- */

async function runUrlstatus(interaction) {
  const raw = interaction.options.getString('url', true).trim();
  await deferE(interaction);
  const url = isUrl(raw);
  if (!url) return fail(interaction, 'Invalid URL', 'Give me a full http(s) URL.');
  try {
    const started = Date.now();
    let res;
    try {
      res = await fetchish(url.href, { method: 'HEAD', redirect: 'follow' });
      if (res.status === 405 || res.status >= 500) throw new Error('HEAD refused');
    } catch {
      res = await fetchish(url.href, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'BypassX-Bot/2' } });
      await res.body?.cancel().catch(() => {});
    }
    const ms = Date.now() - started;
    const moved = res.url && res.url.replace(/\/$/, '') !== url.href.replace(/\/$/, '');
    const verdict = res.ok ? `+ alive — HTTP ${res.status} in ${ms}ms` : res.status >= 400 ? `- broken — HTTP ${res.status}` : `! unusual — HTTP ${res.status}`;
    const rows = [
      ['status', `${res.status} ${res.statusText || ''}`.trim()],
      ['latency', `${ms}ms`],
      ['content-type', cut(res.headers.get('content-type') ?? '—', 60)],
      ['server', cut(res.headers.get('server') ?? '—', 60)],
      ['final-url', moved ? cut(res.url, 100) : 'no redirect'],
    ];
    await interaction.editReply({
      content: '',
      components: [card({ emoji: '🩺', title: 'URL health check', body: [verdict, kvTable(rows, { title: cut(url.href, 70) })].join('\n\n') })],
      flags: V2,
    });
  } catch (e) {
    return fail(interaction, 'Check failed', cut(e.message, 300));
  }
}

/* ---------------- unshort ---------------- */

async function runUnshort(interaction) {
  const raw = interaction.options.getString('url', true).trim();
  await deferE(interaction);
  const first = isUrl(raw);
  if (!first) return fail(interaction, 'Invalid URL', 'Give me a full http(s) URL.');
  try {
    const chain = [first.href];
    let current = first.href;
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetchish(current, { redirect: 'manual', headers: { 'user-agent': 'BypassX-Bot/2' } });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).href;
        chain.push(current);
        if (chain.length >= 7) break;
      } else {
        await res.body?.cancel().catch(() => {});
        break;
      }
    }
    const hops = chain.length - 1;
    const lines = chain.map((u, i) => `${i === 0 ? '@' : i === chain.length - 1 ? '+' : '>'} ${i === 0 ? 'start' : `hop ${i}`}: ${cut(u, 180)}`);
    const body = [
      hops === 0 ? '+ no redirects — this is the final destination' : `+ ${hops} redirect hop${hops === 1 ? '' : 's'} — final destination below`,
      codeBlock('diff', lines.join('\n'), 1500),
      hops > 0 ? `-# tip: use \`/bypass\` instead if the final URL is still gated` : '',
    ];
    await interaction.editReply({ content: '', components: [card({ emoji: '🪤', title: 'Redirect chain', body, footerText: `${hops} hop(s) traced` })], flags: V2 });
  } catch (e) {
    return fail(interaction, 'Unshort failed', cut(e.message, 300));
  }
}

/* ---------------- json ---------------- */

function runJson(interaction) {
  const data = interaction.options.getString('data', true);
  try {
    const parsed = JSON.parse(data);
    const pretty = JSON.stringify(parsed, null, 2);
    const type = Array.isArray(parsed) ? `array(${parsed.length})` : parsed === null ? 'null' : typeof parsed;
    const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
    const body = [
      diffBlock({ add: [`valid JSON — ${type}`, keys.length ? `top-level keys: ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? '…' : ''}` : ''] }),
      codeBlock('json', cut(pretty, 1200)),
    ];
    return replyEphemeral(interaction, body);
  } catch (e) {
    const msg = String(e.message || 'invalid');
    const posMatch = /position (\d+)/.exec(msg);
    let context = '';
    if (posMatch) {
      const p = Number(posMatch[1]);
      context = `near: ${cut(JSON.stringify(data.slice(Math.max(0, p - 18), p + 18)), 60)}`;
    }
    return replyEphemeral(interaction, [
      diffBlock({ del: ['invalid JSON — parse failed'], warn: [cut(msg, 180), context].filter(Boolean) }),
      codeBlock('txt', cut(data, 500)),
    ]);
  }
}

/* ---------------- regex ---------------- */

function runRegex(interaction) {
  const pattern = interaction.options.getString('pattern', true);
  const text = interaction.options.getString('text', true);
  const flags = interaction.options.getString('flags') ?? 'g';
  let re;
  try {
    re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  } catch (e) {
    return replyEphemeral(interaction, [diffBlock({ del: ['invalid regex'], warn: [cut(e.message, 180)] }), codeBlock('js', pattern)]);
  }
  const matches = [...text.matchAll(re)].slice(0, 10);
  const total = [...text.matchAll(re)].length;
  const lines = matches.map((m, i) => `+ #${i + 1} "${cut(m[0], 90)}"${m.length > 1 ? `  groups: [${m.slice(1).map((g) => (g ?? '∅')).join(' | ')}]` : ''}`);
  const body = [
    total ? diffBlock({ add: [`${total} match${total === 1 ? '' : 'es'} found`] }) : diffBlock({ del: ['no matches'] }),
    lines.length ? codeBlock('diff', lines.join('\n'), 1200) : '',
    `-# pattern: /${pattern}/${flags} · showing first ${matches.length}`,
  ];
  return replyEphemeral(interaction, body.filter(Boolean));
}

/* ---------------- jwt ---------------- */

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function runJwt(interaction) {
  const token = interaction.options.getString('token', true).trim();
  const parts = token.split('.');
  if (parts.length < 2 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(token)) {
    return replyEphemeral(interaction, diffFail('not a JWT — expected header.payload.signature'));
  }
  try {
    const header = JSON.parse(b64url(parts[0]));
    const payload = JSON.parse(b64url(parts[1]));
    const claims = Object.entries(payload).map(([k, v]) => [k, typeof v === 'object' ? cut(JSON.stringify(v), 60) : String(v)]);
    const alg = header.alg ?? 'none';
    const exp = payload.exp ? new Date(payload.exp * 1000) : null;
    const expired = exp ? exp.getTime() < Date.now() : null;
    const body = [
      expired === null ? diffBlock({ add: ['decoded — no expiry claim'] }) : expired ? diffBlock({ del: [`EXPIRED ${exp.toISOString()}`] }) : diffBlock({ add: [`decoded — expires ${exp.toISOString()}`] }),
      kvTable([['alg', alg], ['header', cut(JSON.stringify(header), 80)]].concat(claims.slice(0, 12)), { title: 'claims' }),
      '! signature NOT verified — decoding only, no secret involved',
    ];
    return replyEphemeral(interaction, body);
  } catch (e) {
    return replyEphemeral(interaction, diffFail('malformed JWT segments', cut(e.message, 150)));
  }
}

/* ---------------- qr ---------------- */

async function runQr(interaction) {
  const data = interaction.options.getString('data', true).trim();
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(data)}`;
  // Probe the image once so we never show a dead link.
  await deferP(interaction);
  try {
    const res = await fetchish(url);
    if (!res.ok) throw new Error(`QR service answered HTTP ${res.status}`);
    await res.body?.cancel().catch(() => {});
    const c = card({
      emoji: '🧩',
      title: 'QR code ready',
      body: [`Scannable QR — ${cut(data, 300)}`, '-# point any phone camera at it'],
      footerText: 'generated via qrserver.com',
    });
    c.addMediaGalleryComponents({
      items: [{ media: { url }, description: 'QR code' }],
    });
    return interaction.editReply({ content: '', components: [c], flags: V2 });
  } catch (e) {
    return fail(interaction, 'QR generation failed', cut(e.message, 250));
  }
}

/* ---------------- cron ---------------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseField(field, min, max, names = null) {
  const set = new Set();
  for (const part of field.split(',')) {
    let body = part.trim().toLowerCase();
    let step = 1;
    const slash = body.indexOf('/');
    if (slash !== -1) {
      step = Number(body.slice(slash + 1));
      if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${part}"`);
      body = body.slice(0, slash);
    }
    // Cron accepts both numbers and names ("1-5" or "mon-fri", "1" or "jan").
    const resolve = (x) => {
      if (x === '') throw new Error(`bad value in "${part}"`);
      const n = Number(x);
      if (Number.isInteger(n)) return n;
      if (names) {
        const i = names.indexOf(x);
        if (i !== -1) return names === MONTHS ? i + 1 : i; // jan=1…dec=12 · sun=0…sat=6
      }
      throw new Error(`bad value "${x}" in "${part}"`);
    };
    let lo = min;
    let hi = max;
    if (body !== '*' && body !== '?') {
      if (body.includes('-')) {
        const [a, b] = body.split('-').map(resolve);
        lo = a;
        hi = b;
      } else {
        lo = hi = resolve(body);
      }
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`range out of bounds in "${part}" (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) {
      set.add(names === DAYS && v === 7 ? 0 : v);
    }
    if (!set.size) throw new Error(`empty field "${part}"`);
  }
  return set;
}

function humanize(expr) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, h, dom, mon, dow] = f;
  const mins = mi === '*' ? 'every minute' : mi.startsWith('*/') ? `every ${mi.slice(2)} minutes` : `at minute ${mi}`;
  const hours = h === '*' ? 'of every hour' : h.startsWith('*/') ? `every ${h.slice(2)} hours` : h.includes('-') ? `between hours ${h.replace('-', ' and ')}` : `at hour ${h}`;
  const doms = dom === '*' ? '' : `, day-of-month ${dom}`;
  const mons = mon === '*' ? '' : `, month ${mon}`;
  const dows = dow === '*' ? '' : `, day-of-week ${dow}`;
  return `${mins} ${hours}${doms}${mons}${dows} (UTC)`;
}

function runCron(interaction) {
  const expr = interaction.options.getString('expression', true).trim();
  const f = expr.split(/\s+/);
  if (f.length !== 5) {
    return replyEphemeral(interaction, [
      diffFail('a cron expression has exactly 5 fields', 'minute  hour  day-of-month  month  day-of-week'),
      codeBlock('txt', expr),
    ]);
  }
  try {
    const mins = parseField(f[0], 0, 59);
    const hours = parseField(f[1], 0, 23);
    const doms = parseField(f[2], 1, 31);
    const mons = parseField(f[3], 1, 12, MONTHS);
    const dows = parseField(f[4], 0, 7, DAYS);
    const now = new Date();
    const cursor = new Date(now.getTime());
    cursor.setSeconds(0, 0);
    const nexts = [];
    for (let i = 0; i < 366 * 24 * 60 + 1 && nexts.length < 3; i++) {
      cursor.setMinutes(cursor.getMinutes() + 1);
      if (!mins.has(cursor.getMinutes())) continue;
      if (!hours.has(cursor.getHours())) continue;
      if (!mons.has(cursor.getMonth() + 1)) continue;
      const domOk = doms.has(cursor.getDate());
      const dowOk = dows.has(cursor.getDay());
      // Vixie cron semantics: dom and dow restrict with OR when both are set.
      if (f[2] !== '*' && f[4] !== '*' ? !(domOk || dowOk) : !(domOk && dowOk)) continue;
      nexts.push(new Date(cursor.getTime()));
    }
    const human = humanize(expr);
    const lines = nexts.map((d, i) => `+ next #${i + 1}: ${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    const body = [
      nexts.length ? diffBlock({ add: lines }) : diffBlock({ del: ['no matching time within the next year'] }),
      human ? `-# reads as: ${human}` : '',
      '-# matches Vixie cron (dom+dow OR rule). Discord bot times are UTC.',
    ];
    return replyEphemeral(interaction, body.filter(Boolean));
  } catch (e) {
    return replyEphemeral(interaction, [diffFail('invalid cron expression', cut(e.message, 180)), codeBlock('txt', expr)]);
  }
}
