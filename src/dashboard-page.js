/**
 * Owner console UI v2 — one self-contained HTML page (no CDN, no build step).
 * Served at /dashboard?token=…; the page JS reuses the token from the URL for
 * every API call. All untrusted strings render through textContent — no XSS.
 *
 * v2: brand-red BypassX identity, sidebar navigation (Overview · Guilds ·
 * Actions · Commands · Logs · Config), searchable 55+ action palette with
 * category chips, per-command usage table, format-preview runner and a
 * sticky console drawer.
 */

const CSS = `
:root{
--bg:#07060a;--panel:rgba(255,255,255,.04);--panel2:rgba(255,255,255,.07);--line:rgba(255,255,255,.09);
--txt:#eceef4;--mut:#9aa1b5;--acc:#ef2b2b;--acc2:#ff6b5e;--ok:#34d399;--warn:#fbbf24;--err:#f87171;
--ind:#818cf8;--mono:ui-monospace,SFMono-Regular,Menlo,monospace;--rad:14px}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font:14px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;min-height:100vh}
::selection{background:rgba(239,43,43,.35)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.13);border-radius:99px;border:2px solid transparent;background-clip:content-box}
::-webkit-scrollbar-thumb:hover{background:rgba(239,43,43,.45);background-clip:content-box}
a{color:var(--acc2);text-decoration:none}
.aurora{position:fixed;inset:0;z-index:-1;overflow:hidden}
.aurora i{position:absolute;border-radius:50%;filter:blur(130px);opacity:.14}
.aurora i:nth-child(1){width:640px;height:640px;background:#ef2b2b;top:-220px;left:-160px}
.aurora i:nth-child(2){width:520px;height:520px;background:#8b5cf6;top:-160px;right:-160px}
.aurora i:nth-child(3){width:600px;height:600px;background:#34d399;bottom:-280px;left:38%;opacity:.08}

/* ---------- layout ---------- */
.shell{display:flex;min-height:100vh}
.side{width:218px;flex-shrink:0;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;
border-right:1px solid var(--line);background:rgba(10,8,12,.6);backdrop-filter:blur(14px)}
.side .brand{display:flex;align-items:center;gap:10px;padding:20px 16px 14px}
.side .brand .bolt{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;flex-shrink:0;overflow:hidden;
background:linear-gradient(135deg,#ef2b2b,#8b1020);border:1px solid rgba(239,43,43,.55);box-shadow:0 4px 18px rgba(239,43,43,.35),inset 0 1px 0 rgba(255,255,255,.25)}
.side .brand .bolt svg{width:24px;height:24px;display:block}
.side .brand h1{font-size:15.5px;font-weight:700;letter-spacing:.2px}
.side .brand h1 span{color:var(--mut);font-weight:500;font-size:11px;display:block}
nav{padding:8px 10px;display:flex;flex-direction:column;gap:2px}
nav button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:none;background:transparent;color:var(--mut);
padding:9px 12px;border-radius:10px;font-size:13.5px;font-weight:500;cursor:pointer;transition:.15s}
nav button:hover{background:var(--panel);color:var(--txt)}
nav button.on{background:linear-gradient(90deg,rgba(239,43,43,.16),rgba(239,43,43,.04));color:#fff;box-shadow:inset 2px 0 0 var(--acc)}
nav button .ic{width:18px;text-align:center}
.side .foot{margin-top:auto;padding:14px 16px;border-top:1px solid var(--line);font-size:11px;color:var(--mut)}
.main{flex:1;min-width:0;padding:24px 26px 40px}
.topbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.pill{font-size:12px;color:var(--mut);border:1px solid var(--line);border-radius:999px;padding:4px 12px;background:var(--panel)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 10px var(--ok);display:inline-block;margin-right:6px}
.dot.bad{background:var(--err);box-shadow:0 0 10px var(--err)}
.spacer{flex:1}
button.act{cursor:pointer;border:1px solid var(--line);background:var(--panel2);color:var(--txt);
border-radius:9px;padding:7px 13px;font-size:13px;transition:.15s}
button.act:hover{border-color:rgba(255,255,255,.24);background:rgba(255,255,255,.11)}
button.act.pri{background:linear-gradient(135deg,rgba(239,43,43,.3),rgba(139,92,246,.22));border-color:rgba(239,43,43,.45)}
button.act.dgr{color:#fca5a5;border-color:rgba(248,113,113,.4)}
button.act.dgr:hover{background:rgba(248,113,113,.14)}
input,select,textarea{background:rgba(0,0,0,.4);border:1px solid var(--line);color:var(--txt);border-radius:9px;
padding:8px 11px;font-size:13px;outline:none;min-width:0;font-family:inherit}
input:focus,select:focus,textarea:focus{border-color:rgba(239,43,43,.55)}
input::placeholder{color:#5b6072}
section.tab{display:none}
section.tab.on{display:block}
h2.sec{font-size:12.5px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:1.4px;margin:26px 0 12px;display:flex;align-items:center;gap:8px}
h2.sec:first-child{margin-top:0}

/* ---------- hero strip (v3) ---------- */
.hero{display:flex;align-items:center;gap:18px;flex-wrap:wrap;border:1px solid var(--line);border-radius:18px;padding:18px 22px;margin-bottom:14px;
background:linear-gradient(120deg,rgba(239,43,43,.14),rgba(139,92,246,.08) 55%,transparent),var(--panel);position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(600px 180px at 12% -40%,rgba(239,43,43,.22),transparent);pointer-events:none}
.hero .crest{width:54px;height:54px;border-radius:15px;display:grid;place-items:center;flex-shrink:0;
background:linear-gradient(135deg,#ef2b2b,#8b1020);border:1px solid rgba(239,43,43,.55);box-shadow:0 6px 24px rgba(239,43,43,.4),inset 0 1px 0 rgba(255,255,255,.3)}
.hero .crest svg{width:32px;height:32px}
.hero h2{font-size:19px;font-weight:800;letter-spacing:.2px}
.hero p{font-size:12.5px;color:var(--mut);margin-top:2px}
.hero .kpis{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
.hero .kpi{border:1px solid var(--line);border-radius:12px;padding:8px 14px;background:rgba(0,0,0,.3);text-align:center}
.hero .kpi b{display:block;font-size:17px;color:var(--acc2)}
.hero .kpi span{font-size:10.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.8px}

/* ---------- stats ---------- */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:10px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--rad);padding:14px 16px;position:relative;overflow:hidden;transition:transform .18s,border-color .18s,box-shadow .18s}
.stat:hover{transform:translateY(-2px);border-color:rgba(239,43,43,.35);box-shadow:0 10px 30px rgba(239,43,43,.12)}
.stat::after{content:'';position:absolute;inset:0;border-radius:var(--rad);background:linear-gradient(135deg,rgba(239,43,43,.06),transparent 55%);pointer-events:none}
.stat .k{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.9px}
.stat .v{font-size:22px;font-weight:700;margin-top:4px}
.stat .v small{font-size:12px;color:var(--mut);font-weight:400}
.stat.ok .v{color:var(--ok)}.stat.warn .v{color:var(--warn)}.stat.bad .v{color:var(--err)}.stat.acc .v{color:var(--acc2)}
.strip{display:flex;gap:6px;align-items:flex-end;height:34px;margin-top:10px}
.strip b{width:100%;max-width:22px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,var(--acc2),rgba(239,43,43,.25));min-height:3px;display:block}

/* ---------- tables & cards ---------- */
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--rad);padding:16px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{color:var(--mut);font-weight:600;text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);font-size:11.5px;text-transform:uppercase;letter-spacing:.7px}
td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:middle}
tbody tr{transition:background .12s}
tbody tr:hover{background:rgba(255,255,255,.035)}
tr:last-child td{border-bottom:none}
td img.av{width:26px;height:26px;border-radius:8px;vertical-align:middle}
.mono{font-family:var(--mono);font-size:12px;color:var(--mut)}
.gname{font-weight:600}
.badge{display:inline-block;font-size:11px;border-radius:6px;padding:1px 8px;border:1px solid var(--line);color:var(--mut)}
.badge.ab{color:var(--ok);border-color:rgba(52,211,153,.35)}
.badge.bl{color:var(--err);border-color:rgba(248,113,113,.4)}
.badge.warn{color:var(--warn);border-color:rgba(251,191,36,.4)}
.rowbtns{display:flex;gap:5px;flex-wrap:wrap}
.rowbtns button{padding:3px 9px;font-size:11.5px;border-radius:7px}
.mut{color:var(--mut)}.right{text-align:right}
.bar{height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;min-width:60px}
.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--acc2))}

/* ---------- action palette ---------- */
.palette-top{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.palette-top input{flex:1;min-width:220px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{cursor:pointer;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:4px 12px;background:var(--panel);color:var(--mut);transition:.15s}
.chip:hover{color:var(--txt);border-color:rgba(255,255,255,.25)}
.chip.on{color:#fff;border-color:rgba(239,43,43,.5);background:rgba(239,43,43,.14)}
.pgroups{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.pgroup h3{font-size:13px;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.pgroup h3 i{width:9px;height:9px;border-radius:3px;display:inline-block}
.actbox{border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px 12px;margin-bottom:8px;background:rgba(0,0,0,.24)}
.actbox .t{font-size:12.5px;font-weight:600;margin-bottom:3px;display:flex;gap:8px;align-items:center;justify-content:space-between}
.actbox .t .nm{display:flex;gap:8px;align-items:center}
.actbox .t em{font-style:normal;font-size:10.5px;color:var(--acc2);font-weight:600;text-transform:uppercase;letter-spacing:.6px}
.actbox .desc{font-size:11.5px;color:var(--mut);margin-bottom:7px}
.actbox form{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.actbox input,textarea{flex:1;min-width:110px}
.actbox textarea{flex-basis:100%;resize:vertical;min-height:44px}
.hidden{display:none!important}

/* ---------- console drawer ---------- */
#console{position:fixed;left:0;right:0;bottom:0;z-index:50;border-top:1px solid var(--line);
background:rgba(8,6,10,.92);backdrop-filter:blur(16px);transform:translateY(calc(100% - 42px));transition:transform .25s}
#console.open{transform:translateY(0)}
#console .bar-top{display:flex;align-items:center;gap:10px;height:42px;padding:0 16px;cursor:pointer;user-select:none}
#console .bar-top b{font-size:12.5px;letter-spacing:.4px}
#console .count{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:999px;padding:1px 9px}
#out{max-height:260px;overflow-y:auto;padding:6px 16px 14px;font-family:var(--mono);font-size:12.5px}
#out .ok{color:var(--ok)}#out .err{color:var(--err)}#out .dim{color:var(--mut)}
#out div{padding:2px 0;white-space:pre-wrap;word-break:break-word;border-bottom:1px dashed rgba(255,255,255,.04)}

/* ---------- login ---------- */
.login{max-width:390px;margin:15vh auto 0;text-align:center}
.login .card{padding:34px}
.login .bolt{width:46px;height:46px;margin:0 auto 10px;border-radius:13px;display:grid;place-items:center;overflow:hidden;
background:linear-gradient(135deg,#ef2b2b,#8b1020);border:1px solid rgba(239,43,43,.55);box-shadow:0 6px 24px rgba(239,43,43,.4)}
.login h1{font-size:17px;margin-bottom:4px}
.login input{width:100%;margin:16px 0 12px}
.login button{width:100%}
@media(max-width:900px){.side{width:64px}.side .brand h1,.side nav button span.lbl,.side .foot{display:none}.side nav button{justify-content:center;padding:11px 0}.main{padding:18px 14px 60px}}
`;

const JS = `
var TOKEN = new URLSearchParams(location.search).get('token') || '';
var $ = function(s, el){ return (el||document).querySelector(s); };
function el(tag, cls, text){ var e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
function fmtDur(s){ s=Math.floor(s||0); var d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60); return (d?d+'d ':'')+(h?h+'h ':'')+m+'m'; }
function esc(s){ return String(s==null?'':s); }

function api(path, opts){
  opts = opts || {};
  opts.headers = Object.assign({'content-type':'application/json'}, opts.headers||{});
  return fetch('/dashboard/api/'+path+'?token='+encodeURIComponent(TOKEN), opts).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){
      if(!r.ok) throw new Error((j && j.error) || ('HTTP '+r.status));
      return j;
    });
  });
}

/* ---- console drawer ---- */
var consoleCount = 0;
function out(msg, cls){
  var box = $('#out');
  var line = el('div', cls);
  line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  consoleCount++;
  $('#conCount').textContent = consoleCount + ' events';
}
$('#console .bar-top').onclick = function(){ $('#console').classList.toggle('open'); };

function runAction(name, args, btn, needConfirm){
  if(needConfirm && !window.confirm('Run "'+name+'"? This is a danger-zone action.')) return;
  if(btn){ btn.disabled = true; btn.dataset.orig = btn.textContent; btn.textContent = '…'; }
  api('action', {method:'POST', body: JSON.stringify({action:name, args:args||{}, confirm:true})})
    .then(function(j){
      out('['+name+'] ' + (j.confirm ? j.message : (j.message || 'done')), j.ok===false ? 'err' : 'ok');
      $('#console').classList.add('open');
      loadOverview(false);
    })
    .catch(function(e){ out('['+name+'] ✗ ' + e.message, 'err'); $('#console').classList.add('open'); })
    .finally(function(){ if(btn){ btn.disabled=false; btn.textContent = btn.dataset.orig || 'Run'; } });
}

/* ================================================================ */
/* ACTION REGISTRY — 55+ actions across 6 groups                    */
/* args: [key, placeholder, default]                                */
/* ================================================================ */
var GROUPS = [
 {name:'Messaging', color:'#34d399', acts:[
   {id:'dm_user', desc:'DM any user by ID', args:[['userId','user ID'],['message','message text']]},
   {id:'channel_send', desc:'Send a plain message to a channel', args:[['channelId','channel ID'],['message','message text']]},
   {id:'send_embed', desc:'Send an embed from raw JSON', args:[['channelId','channel ID'],['json','{"title":"…","description":"…"}']]},
   {id:'broadcast_all', desc:'Text to every armed auto-bypass channel', args:[['message','text → every armed channel']]},
   {id:'broadcast_guild', desc:'Message a guild system channel', args:[['guildId','guild ID'],['message','message']]},
   {id:'dm_guild_owner', desc:'DM the owner of a guild', args:[['guildId','guild ID'],['message','message']]},
   {id:'fetch_message', desc:'Read any message by ID', args:[['channelId','channel ID'],['messageId','message ID']]},
   {id:'preview_diff', desc:'Send the format-preview card (diff/ansi demo) to a channel', args:[['channelId','channel ID']]},
 ]},
 {name:'Guilds', color:'#818cf8', acts:[
   {id:'guild_details', desc:'Full guild snapshot (JSON)', args:[['guildId','guild ID']]},
   {id:'guild_channels', desc:'List channels', args:[['guildId','guild ID']]},
   {id:'guild_roles', desc:'List roles + colors + sizes', args:[['guildId','guild ID']]},
   {id:'guild_emojis', desc:'List custom emojis', args:[['guildId','guild ID']]},
   {id:'guild_invites', desc:'List active invites', args:[['guildId','guild ID']]},
   {id:'guild_bans', desc:'List bans + reasons', args:[['guildId','guild ID']]},
   {id:'guild_members', desc:'Fetch + search members', args:[['guildId','guild ID'],['query','name filter (optional)']]},
   {id:'guild_invite', desc:'Create a 24h invite (25 uses)', args:[['guildId','guild ID']]},
   {id:'find_user', desc:'Cross-server user lookup', args:[['userId','user ID']]},
   {id:'member_info', desc:'One member in depth', args:[['guildId','guild ID'],['userId','user ID']]},
   {id:'create_channel', desc:'Create a text or voice channel', args:[['guildId','guild ID'],['name','#name'],['type','text / voice']]},
   {id:'create_role', desc:'Create a role (optional hex color)', args:[['guildId','guild ID'],['name','role name'],['color','#ef2b2b (optional)']]},
   {id:'leave_guild', danger:1, desc:'Leave this guild', args:[['guildId','guild ID']]},
   {id:'delete_channel', danger:1, desc:'Delete a channel permanently', args:[['channelId','channel ID']]},
   {id:'delete_role', danger:1, desc:'Delete a role permanently', args:[['guildId','guild ID'],['roleId','role ID']]},
 ]},
 {name:'Members', color:'#f472b6', acts:[
   {id:'member_kick', danger:1, desc:'Kick a member', args:[['guildId','guild ID'],['userId','user ID'],['reason','reason (optional)']]},
   {id:'member_ban', danger:1, desc:'Ban a user', args:[['guildId','guild ID'],['userId','user ID'],['reason','reason (optional)']]},
   {id:'member_timeout', danger:1, desc:'Timeout a member (minutes)', args:[['guildId','guild ID'],['userId','user ID'],['minutes','10']]},
 ]},
 {name:'Bot control', color:'#fbbf24', acts:[
   {id:'set_presence', desc:'Set the activity', args:[['type','watching/listening/playing','watching'],['text','activity text']]},
   {id:'set_status', desc:'Presence status', args:[['status','online / idle / dnd / invisible','online']]},
   {id:'clear_presence', desc:'Clear the activity', args:[]},
   {id:'set_avatar', desc:'Change the bot avatar', args:[['url','image URL']]},
   {id:'set_username', desc:'Change the bot username (2/hour max)', args:[['name','new username']]},
   {id:'reload_commands', desc:'Re-register every slash command globally', args:[]},
   {id:'set_maintenance', desc:'Maintenance mode on/off', args:[['enabled','true / false']]},
   {id:'toggle_autobypass', desc:'Auto-bypass engine on/off', args:[['enabled','true / false']]},
   {id:'reconnect_gateway', desc:'Bounce the gateway connection', args:[]},
   {id:'dump_env', desc:'Show which env vars are set (values redacted)', args:[]},
   {id:'shutdown', danger:1, desc:'Stop the process (Render restarts it)', args:[]},
 ]},
 {name:'Moderation', color:'#f87171', acts:[
   {id:'blacklist_user', desc:'Blacklist a user', args:[['userId','user ID'],['reason','reason (optional)']]},
   {id:'unblacklist_user', desc:'Remove a user from the blacklist', args:[['userId','user ID']]},
   {id:'blacklist_guild', desc:'Blacklist a guild', args:[['guildId','guild ID'],['reason','reason (optional)']]},
   {id:'unblacklist_guild', desc:'Remove a guild from the blacklist', args:[['guildId','guild ID']]},
   {id:'blacklist_list', desc:'Show the blacklist', args:[]},
   {id:'set_cooldown', desc:'Command cooldown override', args:[['command','command name or *'],['seconds','seconds (0=default)']]},
   {id:'disable_command', desc:'Turn a command off', args:[['command','command name']]},
   {id:'enable_command', desc:'Turn a command back on', args:[['command','command name']]},
 ]},
 {name:'Data · API · Formats', color:'#38bdf8', acts:[
   {id:'bypass_url', desc:'Run a bypass right from the console', args:[['url','https://… gated link']]},
   {id:'clear_cache', desc:'Drop every cached result', args:[]},
   {id:'refresh_services', desc:'Reload the service registry from the API', args:[]},
   {id:'test_api', desc:'Probe the BypassX API', args:[]},
   {id:'command_counts', desc:'Per-command usage counters', args:[]},
   {id:'sql_query', desc:'Read-only SQL against Postgres', args:[['query','SELECT * FROM counters LIMIT 10']]},
   {id:'feedback_list', desc:'Show the suggestion inbox', args:[]},
   {id:'feedback_clear', danger:1, desc:'Clear the suggestion inbox', args:[]},
   {id:'prune_logs', danger:1, desc:'Delete old bypass logs', args:[['days','older than N days','30']]},
   {id:'stats_reset', danger:1, desc:'Zero the lifetime counters', args:[]},
   {id:'eval_js', danger:1, desc:'Run JS in the bot process (client, config, store, ctx in scope)', args:[['code','async JS code']]},
 ]},
];

function buildPalette(){
  var host = $('#groups');
  host.innerHTML='';
  var filter = ($('#actFilter').value||'').toLowerCase();
  var cat = $('#actCat').value;
  var shown = 0;
  GROUPS.forEach(function(g){
    var acts = g.acts.filter(function(a){
      var okCat = cat === 'all' || g.name === cat;
      var okTerm = !filter || a.id.toLowerCase().includes(filter) || (a.desc||'').toLowerCase().includes(filter);
      return okCat && okTerm;
    });
    if(!acts.length) return;
    shown += acts.length;
    var card = el('div','card pgroup');
    var h = el('h3',null); h.appendChild(el('i')); h.lastChild.style.background=g.color;
    h.appendChild(document.createTextNode(g.name + ' — ' + acts.length));
    card.appendChild(h);
    acts.forEach(function(a){
      var box = el('div','actbox'+(a.danger?' dgrbox':''));
      var t = el('div','t');
      var nm = el('span','nm'); nm.textContent = a.id;
      t.appendChild(nm);
      if(a.danger) t.appendChild(el('em',null,'danger'));
      box.appendChild(t);
      box.appendChild(el('div','desc',a.desc||''));
      var f = el('form'); f.onsubmit=function(ev){ev.preventDefault();};
      var args={};
      (a.args||[]).forEach(function(inp){
        var key=inp[0], ph=inp[1], def=inp[2];
        var i=document.createElement('input');
        i.placeholder=ph||key; if(def) i.value=def;
        i.oninput=function(){ args[key]=i.value; };
        f.appendChild(i);
      });
      var btn=el('button', 'act '+(a.danger?'dgr':'pri')); btn.type='button'; btn.textContent='Run';
      btn.onclick=function(){ runAction(a.id,args,btn,a.danger); };
      f.appendChild(btn);
      box.appendChild(f);
      card.appendChild(box);
    });
    host.appendChild(card);
  });
  $('#actCount').textContent = shown + ' of ' + GROUPS.reduce(function(n,g){return n+g.acts.length},0) + ' actions';
}

/* ---- shared inline SVG crest (no external assets — works offline) ---- */
var CREST = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M37 4 L13 37 h13.5 L21 60 L51 26 H34.5 Z" fill="#fff"/><path d="M37 4 L13 37 h13.5 L21 60 L51 26 H34.5 Z" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/></svg>';

/* ---- overview ---- */
function statCard(k,v,cls){
  var d=el('div','stat'+(cls?' '+cls:''));
  d.appendChild(el('div','k',k));
  d.appendChild(el('div','v'));
  if(typeof v === 'object' && v.html != null) d.lastChild.innerHTML=v.html;
  else if(typeof v === 'object' && v.node) d.lastChild.appendChild(v.node);
  else if(typeof v === 'string' && v.indexOf('<small>') !== -1) d.lastChild.innerHTML=v; // our own markup — safe
  else d.lastChild.textContent = esc(v);
  return d;
}
function renderStats(o){
  var g=$('#stats'); g.innerHTML='';
  var rate = o.successRate==null?'—':o.successRate+'%';
  var api=o.apiHealth||{}; var apiCls = api.degraded?'bad':'ok';
  var totalCmd = (o.commands||[]).reduce(function(n,c){return n+c.count},0);
  // hero strip — brand crest, live KPIs (single instance, values refreshed)
  var hero=document.getElementById('heroStrip');
  if(!hero){
    hero=document.createElement('div'); hero.id='heroStrip'; hero.className='hero';
    var crest=el('div','crest'); crest.innerHTML=CREST; hero.appendChild(crest);
    var hx=el('div',null); var h2=el('h2',null,'BypassX Mission Control'); var hp=el('p',null, 'Owner console v3 · everything the bot sees, you see');
    hx.appendChild(h2); hx.appendChild(hp); hero.appendChild(hx);
    var kpis=el('div','kpis'); kpis.id='heroKpis'; hero.appendChild(kpis);
    g.parentNode.insertBefore(hero, g);
  }
  var kpis=document.getElementById('heroKpis'); kpis.innerHTML='';
  [['invokables',(o.bot.invokableCount||0)],['guilds',o.guilds.count],['bypasses',(o.counters.bypasses||0).toLocaleString()],['uptime',fmtDur(o.bot.uptimeSec)]].forEach(function(kv){
    var k=el('div','kpi'); k.appendChild(el('b',null,String(kv[1]))); k.appendChild(el('span',null,kv[0])); kpis.appendChild(k);
  });
  var items=[
    statCard('Guilds', o.guilds.count),
    statCard('Total members', o.guilds.totalMembers.toLocaleString()),
    statCard('Bypasses', (o.counters.bypasses||0).toLocaleString(), 'ok'),
    statCard('Auto-bypasses', (o.counters.autoBypasses||0).toLocaleString(), 'acc'),
    statCard('Failures', (o.counters.failures||0).toLocaleString(), (o.counters.failures||0)>0?'warn':''),
    statCard('Success rate', rate, o.successRate>=90?'ok':(o.successRate==null?'':'warn')),
    statCard('Command runs', totalCmd.toLocaleString()),
    statCard('Cache', (o.cache&&o.cache.size!=null?o.cache.size:'—')+' <small>entries</small>'),
    statCard('BX API', (api.degraded?'degraded':'healthy'), apiCls),
    statCard('WS ping', (o.bot.wsPingMs==null?'—':o.bot.wsPingMs+'ms')),
    statCard('Uptime', fmtDur(o.bot.uptimeSec)),
    statCard('Memory', o.bot.memoryMB+' <small>MB</small>'),
    statCard('Slash commands', (o.bot.commandCount||0) + ' <small>top · ' + (o.bot.invokableCount||0) + ' invokable</small>'),
    statCard('Dashboard actions', (o.actions||[]).length, 'acc'),
    statCard('Version','v'+o.bot.version),
    statCard('Feedback', (o.feedback||[]).length + ' <small>queued</small>', (o.feedback||[]).length?'warn':''),
  ];
  items.forEach(function(s){ g.appendChild(s); });
  $('#botline').textContent = (o.bot.tag||'—') + ' · ' + (o.bot.commandCount||0) + ' commands / ' + (o.bot.invokableCount||0) + ' invokable · node ' + o.bot.node;
  $('#headStatus').textContent = o.flags.maintenance ? 'MAINTENANCE' : 'LIVE';
  $('#headDot').className = 'dot' + (o.flags.maintenance ? ' bad' : '');

  // render quick toggles state
  $('#tglMaintenance').checked = !!o.flags.maintenance;
  $('#tglAutobypass').checked = !o.bot.autobypassDisabled;
  $('#flagDisabled').textContent = o.flags.disabledCommands.length ? o.flags.disabledCommands.join(', ') : 'none';
  renderCommands(o);
}
function renderCommands(o){
  var tb=$('#commands tbody'); tb.innerHTML='';
  var rows=o.commands||[];
  var total=rows.reduce(function(n,c){return n+c.count},0);
  if(!rows.length){ var tr=document.createElement('tr'); tr.appendChild(el('td','mut','No per-command usage recorded yet — counters fill as commands run.')).colSpan=4; tb.appendChild(tr); return; }
  rows.slice(0,25).forEach(function(c){
    var tr=document.createElement('tr');
    tr.appendChild(el('td',null,'/'+c.name));
    tr.appendChild(el('td',null,String(c.count)));
    var tdB=document.createElement('td');
    var bar=el('div','bar'); var fill=el('i'); fill.style.width=Math.round((c.count/total)*100)+'%'; bar.appendChild(fill);
    tdB.appendChild(bar); tr.appendChild(tdB);
    tr.appendChild(el('td','mono',Math.round((c.count/total)*100)+'%'));
    tb.appendChild(tr);
  });
}
function renderGuilds(o){
  var tb=$('#guilds tbody'); tb.innerHTML='';
  o.guilds.list.forEach(function(g){
    var tr=document.createElement('tr');
    var td0=document.createElement('td');
    if(g.icon){ var im=document.createElement('img'); im.className='av'; im.src=g.icon; im.alt=''; td0.appendChild(im); }
    td0.appendChild(el('span','gname',g.name));
    tr.appendChild(td0);
    tr.appendChild(el('td','mono',g.id));
    tr.appendChild(el('td',null,(g.members==null?'?':g.members.toLocaleString())));
    tr.appendChild(el('td',null,String(g.channels)));
    var tdAB=document.createElement('td');
    if(g.autobypass.length){ var b1=el('span','badge ab',g.autobypass.length+' armed'); tdAB.appendChild(b1); }
    else tdAB.appendChild(el('span','mut','—'));
    tr.appendChild(tdAB);
    var tdF=document.createElement('td');
    if(g.blacklisted){ var b2=el('span','badge bl','blacklisted'); tdF.appendChild(b2); }
    else tdF.appendChild(el('span','mut',g.joined?new Date(g.joined).toLocaleDateString():''));
    tr.appendChild(tdF);
    var tdA=document.createElement('td'); tdA.className='right';
    var rb=el('div','rowbtns');
    [['info','guild_details'],['roles','guild_roles'],['inv','guild_invite'],['leave','leave_guild']].forEach(function(p){
      var b=el('button','act'+(p[0]==='leave'?' dgr':'')); b.textContent=p[0];
      b.onclick=function(){
        if(p[0]==='leave' && !window.confirm('Leave "'+g.name+'"?')) return;
        runAction(p[1],{guildId:g.id},b,false);
      };
      rb.appendChild(b);
    });
    tdA.appendChild(rb); tr.appendChild(tdA);
    tb.appendChild(tr);
  });
  if(!o.guilds.list.length){ var tr=document.createElement('tr'); tr.appendChild(el('td','mut','No guilds.')).colSpan=7; tb.appendChild(tr); }
}
function renderLists(o){
  var bl=$('#blacklists'); bl.innerHTML='';
  if(!(o.blacklists||[]).length){ bl.appendChild(el('span','mut','Blacklist is empty.')); }
  else (o.blacklists||[]).slice(0,12).forEach(function(b){
    var s=el('span','badge'+(b.type==='guild'?' bl':''), (b.type==='guild'?'🏠 ':'👤 ')+(b.target_id||b.targetId||''));
    s.style.marginRight='6px'; bl.appendChild(s);
  });
  var lg=$('#logs tbody'); lg.innerHTML='';
  (o.logs||[]).forEach(function(l){
    var tr=document.createElement('tr');
    tr.appendChild(el('td','mono', l.created_at?new Date(l.created_at).toLocaleTimeString():''));
    tr.appendChild(el('td',null, l.source||''));
    tr.appendChild(el('td',null, l.domain||l.url||''));
    tr.appendChild(el('td',null, l.success?'✅':'❌'));
    lg.appendChild(tr);
  });
  if(!(o.logs||[]).length){ var tr=document.createElement('tr'); var td=el('td','mut','No bypasses logged yet.'); td.colSpan=4; tr.appendChild(td); lg.appendChild(tr); }

  var fb=$('#feedback'); fb.innerHTML='';
  (o.feedback||[]).forEach(function(f){
    var d=el('div','actbox');
    d.appendChild(el('div','t', (f.from||'?') + (f.guild?' · '+f.guild:'')));
    d.appendChild(el('div','desc', f.message||''));
    fb.appendChild(d);
  });
  if(!(o.feedback||[]).length) fb.appendChild(el('span','mut','No feedback queued.'));
}

var timer=null;
function loadOverview(say){
  return api('overview').then(function(o){
    renderStats(o); renderGuilds(o); renderLists(o);
    if(say) out('overview refreshed — ' + o.guilds.count + ' guild(s), ' + o.guilds.totalMembers.toLocaleString() + ' members, ' + (o.actions||[]).length + ' actions ready', 'dim');
  }).catch(function(e){ out('overview failed: '+e.message, 'err'); });
}

/* ---- nav ---- */
var TABS = ['overview','guilds','actions','commands','logs','config'];
function showTab(name){
  TABS.forEach(function(t){
    var sec = $('#tab-'+t); if(sec) sec.classList.toggle('on', t===name);
    var btn = $('#nav-'+t); if(btn) btn.classList.toggle('on', t===name);
  });
  if(name==='guilds' || name==='logs' || name==='commands') loadOverview(false);
}

/* ---- quick toggles (config tab) ---- */
function wireToggles(){
  $('#tglMaintenance').onchange = function(){
    runAction('set_maintenance', {enabled: this.checked}, null, false);
  };
  $('#tglAutobypass').onchange = function(){
    runAction('toggle_autobypass', {enabled: this.checked}, null, false);
  };
  $('#statusSel').onchange = function(){
    runAction('set_status', {status: this.value}, null, false);
  };
  $('#refreshBtn').onclick = function(){ loadOverview(true); };
  $('#export').onclick = function(){ window.open('/dashboard/api/export.json?token='+encodeURIComponent(TOKEN),'_blank'); };
  $('#logout').onclick = function(){ location.replace('/dashboard'); };
}

function boot(){
  buildPalette();
  loadOverview(true);
  wireToggles();
  $('#actFilter').oninput = buildPalette;
  $('#actCat').onchange = buildPalette;
  var cats = $('#actCat');
  GROUPS.forEach(function(g){ var o=document.createElement('option'); o.value=g.name; o.textContent=g.name; cats.appendChild(o); });
  var t=$('#autoref');
  t.onchange=function(){
    if(timer){ clearInterval(timer); timer=null; }
    if(t.checked) timer=setInterval(function(){ loadOverview(false); }, 15000);
  };
  TABS.forEach(function(t2){
    var b=$('#nav-'+t2); if(b) b.onclick=function(){ showTab(t2); };
  });
}
document.addEventListener('DOMContentLoaded', boot);
`;

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0a080d"/><path d="M35 6 L14 36 h13 l-5 22 24-32 H33 z" fill="#ef2b2b"/></svg>`
  );

const HEAD = (title) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="${FAVICON}">
<title>${title}</title>`;

export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
${HEAD('BypassX · Owner Console')}
<style>${CSS}</style>
</head>
<body>
<div class="aurora"><i></i><i></i><i></i></div>
<div class="shell">
  <aside class="side">
    <div class="brand">
      <div class="bolt">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M37 4 L13 37 h13.5 L21 60 L51 26 H34.5 Z" fill="#fff"/></svg>
      </div>
      <h1>BypassX<span>Owner Console v3</span></h1>
    </div>
    <nav>
      <button id="nav-overview" class="on"><span class="ic">◈</span><span class="lbl">Overview</span></button>
      <button id="nav-guilds"><span class="ic">🏰</span><span class="lbl">Guilds</span></button>
      <button id="nav-actions"><span class="ic">🎛️</span><span class="lbl">Actions</span></button>
      <button id="nav-commands"><span class="ic">📊</span><span class="lbl">Command usage</span></button>
      <button id="nav-logs"><span class="ic">🕘</span><span class="lbl">Logs &amp; feedback</span></button>
      <button id="nav-config"><span class="ic">🎚️</span><span class="lbl">Config</span></button>
    </nav>
    <div class="foot">token-gated · every action is logged<br>bypassx.de5.net</div>
  </aside>

  <main class="main">
    <div class="topbar">
      <span class="pill"><span id="headDot" class="dot"></span><b id="headStatus">LIVE</b></span>
      <span class="pill" id="botline">loading…</span>
      <div class="spacer"></div>
      <label class="pill"><input type="checkbox" id="autoref" checked style="margin-right:6px">auto 15s</label>
      <button class="act" id="refreshBtn">Refresh</button>
      <button class="act" id="export">Export logs</button>
      <button class="act" id="logout">Logout</button>
    </div>

    <!-- OVERVIEW -->
    <section class="tab on" id="tab-overview">
      <div class="grid" id="stats"></div>
    </section>

    <!-- GUILDS -->
    <section class="tab" id="tab-guilds">
      <h2 class="sec">🏰 Servers the bot is in</h2>
      <div class="card" style="padding:6px 10px;overflow-x:auto">
        <table id="guilds">
          <thead><tr><th>Guild</th><th>ID</th><th>Members</th><th>Channels</th><th>Auto-bypass</th><th>Joined</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <!-- ACTIONS -->
    <section class="tab" id="tab-actions">
      <h2 class="sec">🎛️ Action palette</h2>
      <div class="palette-top">
        <input id="actFilter" placeholder="search actions… (dm, broadcast, eval, sql)">
        <select id="actCat"><option value="all">All groups</option></select>
        <span class="pill" id="actCount"></span>
      </div>
      <div class="pgroups" id="groups"></div>
    </section>

    <!-- COMMAND USAGE -->
    <section class="tab" id="tab-commands">
      <h2 class="sec">📊 Slash command usage</h2>
      <div class="card" style="padding:6px 10px;overflow-x:auto">
        <table id="commands">
          <thead><tr><th>Command</th><th>Runs</th><th>Share</th><th>%</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <!-- LOGS & FEEDBACK -->
    <section class="tab" id="tab-logs">
      <h2 class="sec">🚫 Blacklist</h2>
      <div class="card" style="margin-bottom:14px" id="blacklists"></div>
      <h2 class="sec">📝 Feedback &amp; suggestions</h2>
      <div class="card" style="margin-bottom:14px" id="feedback"></div>
      <h2 class="sec">🕘 Recent bypasses</h2>
      <div class="card" style="padding:6px 10px;overflow-x:auto">
        <table>
          <thead><tr><th>Time</th><th>Source</th><th>Link / domain</th><th></th></tr></thead>
          <tbody id="logs"></tbody>
        </table>
      </div>
    </section>

    <!-- CONFIG -->
    <section class="tab" id="tab-config">
      <h2 class="sec">🎚️ Quick toggles</h2>
      <div class="card" style="display:grid;gap:12px;max-width:480px">
        <label style="display:flex;justify-content:space-between;align-items:center">🛠️ Maintenance mode
          <input type="checkbox" id="tglMaintenance">
        </label>
        <label style="display:flex;justify-content:space-between;align-items:center">⚡ Auto-bypass engine
          <input type="checkbox" id="tglAutobypass">
        </label>
        <label style="display:flex;justify-content:space-between;align-items:center">🟢 Presence status
          <select id="statusSel"><option>online</option><option>idle</option><option>dnd</option><option>invisible</option></select>
        </label>
        <div class="mono">disabled commands: <span id="flagDisabled">—</span></div>
      </div>
      <h2 class="sec">ℹ️ About</h2>
      <div class="card mut" style="max-width:480px;font-size:12.5px">
        Every action routes through the same gateway the slash commands use and is written to the console below.
        Danger actions ask for confirmation first. The dashboard is disabled entirely without DASHBOARD_TOKEN.
      </div>
    </section>
  </main>
</div>

<div id="console">
  <div class="bar-top"><b>CONSOLE</b><span class="count" id="conCount">0 events</span><div class="spacer"></div><span class="mut">click to collapse</span></div>
  <div id="out"></div>
</div>
<script>${JS}</script>
</body>
</html>`;
}

export function dashboardLoginHtml() {
  return `<!doctype html>
<html lang="en">
<head>
${HEAD('BypassX · Owner Console — login')}
<style>${CSS}</style>
</head>
<body>
<div class="aurora"><i></i><i></i><i></i></div>
<div class="login">
  <div class="card">
    <div class="bolt">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M37 4 L13 37 h13.5 L21 60 L51 26 H34.5 Z" fill="#fff"/></svg>
    </div>
    <h1>BypassX Owner Console</h1>
    <p class="mut" style="font-size:13px">Private area — enter the <span class="mono">DASHBOARD_TOKEN</span> to continue.</p>
    <form method="GET" action="/dashboard">
      <input type="password" name="token" placeholder="dashboard token" autocomplete="off" autofocus required>
      <button class="act pri" type="submit" style="font-size:14px">Unlock console</button>
    </form>
  </div>
</div>
</body>
</html>`;
}
