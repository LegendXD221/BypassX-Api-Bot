/**
 * Owner console UI — one self-contained HTML page (no CDN, no build step).
 * Served at /dashboard?token=…; the page JS reuses the token from the URL for
 * every API call. All untrusted strings render through textContent — no XSS.
 */

const CSS = `
:root{--bg:#050508;--panel:rgba(255,255,255,.035);--panel2:rgba(255,255,255,.06);--line:rgba(255,255,255,.09);
--txt:#e8eaf0;--mut:#98a0b3;--acc:#34d399;--ind:#818cf8;--red:#f87171;--amber:#fbbf24;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font:14px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;min-height:100vh}
.aurora{position:fixed;inset:0;z-index:-1;overflow:hidden}
.aurora i{position:absolute;border-radius:50%;filter:blur(110px);opacity:.16}
.aurora i:nth-child(1){width:560px;height:560px;background:#34d399;top:-180px;left:-120px}
.aurora i:nth-child(2){width:520px;height:520px;background:#6366f1;top:-120px;right:-140px}
.aurora i:nth-child(3){width:620px;height:620px;background:#8b5cf6;bottom:-260px;left:32%}
.wrap{max-width:1180px;margin:0 auto;padding:26px 20px 70px}
header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:22px}
.logo{display:flex;align-items:center;gap:10px}
.logo .bolt{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:19px;
background:linear-gradient(135deg,rgba(52,211,153,.25),rgba(129,140,248,.25));border:1px solid var(--line)}
h1{font-size:19px;font-weight:650;letter-spacing:.2px}
h1 span{color:var(--mut);font-weight:500;font-size:13px;display:block}
.pill{font-size:12px;color:var(--mut);border:1px solid var(--line);border-radius:999px;padding:3px 11px;background:var(--panel)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--acc);box-shadow:0 0 10px var(--acc);display:inline-block;margin-right:6px}
.spacer{flex:1}
button{cursor:pointer;border:1px solid var(--line);background:var(--panel2);color:var(--txt);
border-radius:9px;padding:7px 13px;font-size:13px;transition:.15s}
button:hover{border-color:rgba(255,255,255,.22);background:rgba(255,255,255,.1)}
button.pri{background:linear-gradient(135deg,rgba(52,211,153,.22),rgba(129,140,248,.22));border-color:rgba(52,211,153,.4)}
button.dgr{color:#fca5a5;border-color:rgba(248,113,113,.35)}
button.dgr:hover{background:rgba(248,113,113,.12)}
input,select{background:rgba(0,0,0,.35);border:1px solid var(--line);color:var(--txt);border-radius:8px;
padding:7px 10px;font-size:13px;outline:none;min-width:0}
input:focus{border-color:rgba(52,211,153,.5)}
section{margin-top:26px}
h2{font-size:14px;font-weight:650;color:var(--mut);text-transform:uppercase;letter-spacing:1.3px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:10px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:13px 15px}
.stat .k{font-size:11.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.8px}
.stat .v{font-size:21px;font-weight:650;margin-top:3px}
.stat .v small{font-size:12px;color:var(--mut);font-weight:400}
.stat.ok .v{color:var(--acc)} .stat.warn .v{color:var(--amber)} .stat.bad .v{color:var(--red)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{color:var(--mut);font-weight:500;text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);font-size:12px}
td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:middle}
tr:last-child td{border-bottom:none}
td img.av{width:26px;height:26px;border-radius:8px;vertical-align:middle}
.mono{font-family:var(--mono);font-size:12px;color:var(--mut)}
.gname{font-weight:600}
.badge{display:inline-block;font-size:11px;border-radius:6px;padding:1px 8px;border:1px solid var(--line);color:var(--mut)}
.badge.ab{color:var(--acc);border-color:rgba(52,211,153,.35)}
.badge.bl{color:var(--red);border-color:rgba(248,113,113,.4)}
.rowbtns{display:flex;gap:6px;flex-wrap:wrap}
.rowbtns button{padding:3px 9px;font-size:12px;border-radius:7px}
.groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.group h3{font-size:13px;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.group h3 i{width:9px;height:9px;border-radius:3px;display:inline-block}
.act{border:1px solid rgba(255,255,255,.06);border-radius:11px;padding:9px 11px;margin-bottom:8px;background:rgba(0,0,0,.22)}
.act .t{font-size:12.5px;font-weight:600;margin-bottom:6px;display:flex;gap:8px;align-items:center}
.act .t em{font-style:normal;font-size:11px;color:var(--mut);font-weight:400}
.act form{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.act input{flex:1;min-width:110px}
.act.dgr{border-color:rgba(248,113,113,.25)}
#out{background:rgba(0,0,0,.45);border:1px solid var(--line);border-radius:14px;padding:14px;
font-family:var(--mono);font-size:12.5px;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
#out .ok{color:var(--acc)} #out .err{color:var(--red)} #out .dim{color:var(--mut)}
.login{max-width:380px;margin:16vh auto 0;text-align:center}
.login .card{padding:30px}
.login h1{margin-bottom:6px}
.login input{width:100%;margin:14px 0}
.login button{width:100%}
.mut{color:var(--mut)} .right{text-align:right}
@media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr)}}
`;

const JS = `
var TOKEN = new URLSearchParams(location.search).get('token') || '';
var $ = function(s, el){ return (el||document).querySelector(s); };
function el(tag, cls, text){ var e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
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

function out(msg, cls){
  var box = $('#out');
  var line = el('div', cls);
  line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function runAction(name, args, btn, needConfirm){
  if(needConfirm && !window.confirm('Run "'+name+'"? This is a danger-zone action.')) return;
  if(btn){ btn.disabled = true; btn.textContent = '…'; }
  api('action', {method:'POST', body: JSON.stringify({action:name, args:args||{}, confirm:true})})
    .then(function(j){
      out('['+name+'] ' + (j.confirm ? j.message : (j.message || 'done')), j.ok===false ? 'err' : 'ok');
      loadOverview(false);
    })
    .catch(function(e){ out('['+name+'] ✗ ' + e.message, 'err'); })
    .finally(function(){ if(btn){ btn.disabled=false; btn.textContent='Run'; } });
}

/* ---- action definitions ---- */
var GROUPS = [
 {name:'Messaging', color:'#34d399', acts:[
   {id:'dm_user', args:[{k:'userId',ph:'user ID'},{k:'message',ph:'message'}]},
   {id:'channel_send', args:[{k:'channelId',ph:'channel ID'},{k:'message',ph:'message'}]},
   {id:'broadcast_all', args:[{k:'message',ph:'text → every armed channel'}]},
   {id:'broadcast_guild', args:[{k:'guildId',ph:'guild ID'},{k:'message',ph:'message'}]},
 ]},
 {name:'Guilds', color:'#818cf8', acts:[
   {id:'guild_details', args:[{k:'guildId',ph:'guild ID'}]},
   {id:'guild_channels', args:[{k:'guildId',ph:'guild ID'}]},
   {id:'guild_invite', args:[{k:'guildId',ph:'guild ID'}]},
   {id:'find_user', args:[{k:'userId',ph:'user ID'}]},
   {id:'leave_guild', danger:1, args:[{k:'guildId',ph:'guild ID'}]},
 ]},
 {name:'Bot control', color:'#fbbf24', acts:[
   {id:'set_presence', args:[{k:'type',ph:'watching/listening/playing',v:'watching'},{k:'text',ph:'activity text'}]},
   {id:'clear_presence', args:[]},
   {id:'set_avatar', args:[{k:'url',ph:'image URL'}]},
   {id:'set_username', args:[{k:'name',ph:'new username'}]},
   {id:'set_maintenance', args:[{k:'enabled',ph:'true/false'}]},
   {id:'toggle_autobypass', args:[{k:'enabled',ph:'true/false'}]},
   {id:'reconnect_gateway', args:[]},
   {id:'shutdown', danger:1, args:[]},
 ]},
 {name:'Moderation', color:'#f87171', acts:[
   {id:'blacklist_user', args:[{k:'userId',ph:'user ID'},{k:'reason',ph:'reason (optional)'}]},
   {id:'unblacklist_user', args:[{k:'userId',ph:'user ID'}]},
   {id:'blacklist_guild', args:[{k:'guildId',ph:'guild ID'},{k:'reason',ph:'reason (optional)'}]},
   {id:'unblacklist_guild', args:[{k:'guildId',ph:'guild ID'}]},
   {id:'blacklist_list', args:[]},
   {id:'set_cooldown', args:[{k:'command',ph:'command name'},{k:'seconds',ph:'seconds (0=default)'}]},
   {id:'disable_command', args:[{k:'command',ph:'command name'}]},
   {id:'enable_command', args:[{k:'command',ph:'command name'}]},
 ]},
 {name:'Data & API', color:'#38bdf8', acts:[
   {id:'clear_cache', args:[]},
   {id:'refresh_services', args:[]},
   {id:'test_api', args:[]},
   {id:'run_autoleave', danger:1, args:[]},
   {id:'prune_logs', danger:1, args:[{k:'days',ph:'older than N days',v:'30'}]},
   {id:'stats_reset', danger:1, args:[]},
   {id:'eval_js', danger:1, args:[{k:'code',ph:'JS to evaluate (client, config, store in scope)'}]},
 ]},
];

function buildConsole(){
  var host = $('#groups');
  GROUPS.forEach(function(g){
    var card = el('div','card group');
    var h = el('h3',null); h.appendChild(el('i')); h.lastChild.style.background=g.color;
    h.appendChild(document.createTextNode(g.name));
    card.appendChild(h);
    g.acts.forEach(function(a){
      var box = el('div','act'+(a.danger?' dgr':''));
      var t = el('div','t'); t.textContent=a.id; if(a.danger){var b=el('em'); b.textContent='danger zone'; t.appendChild(b);} 
      box.appendChild(t);
      var f = el('form'); f.onsubmit=function(ev){ev.preventDefault();};
      var args={};
      a.args.forEach(function(inp){
        var i=document.createElement('input');
        i.placeholder=inp.ph; if(inp.v) i.value=inp.v;
        i.oninput=function(){ args[inp.k]=i.value; };
        f.appendChild(i);
      });
      var btn=el('button', a.danger?'dgr':'pri'); btn.type='button'; btn.textContent='Run';
      btn.onclick=function(){ runAction(a.id,args,btn,a.danger); };
      f.appendChild(btn);
      box.appendChild(f);
      card.appendChild(box);
    });
    host.appendChild(card);
  });
}

/* ---- overview rendering ---- */
function statCard(k,v,cls){
  var d=el('div','stat'+(cls?' '+cls:''));
  d.appendChild(el('div','k',k));
  d.appendChild(el('div','v'));
  var raw=typeof v==='object'?v:{html:v};
  if(raw.html!=null) d.lastChild.innerHTML=raw.html; else if(raw.node) d.lastChild.appendChild(raw.node);
  return d;
}
function fmtDur(s){
  s=Math.floor(s||0); var d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return (d?d+'d ':'')+(h?h+'h ':'')+m+'m';
}
function renderStats(o){
  var g=$('#stats'); g.innerHTML='';
  var rate = o.successRate==null?'—':o.successRate+'%';
  var api=o.apiHealth||{}; var apiCls = api.degraded?'bad':'ok';
  var items=[
    statCard('Guilds', o.guilds.count),
    statCard('Total members', o.guilds.totalMembers.toLocaleString()),
    statCard('Bypasses', (o.counters.bypasses||0).toLocaleString(), 'ok'),
    statCard('Auto-bypasses', (o.counters.autoBypasses||0).toLocaleString()),
    statCard('Failures', (o.counters.failures||0).toLocaleString(), (o.counters.failures||0)>0?'warn':''),
    statCard('Success rate', rate, o.successRate>=90?'ok':(o.successRate==null?'':'warn')),
    statCard('Cache', (o.cache&&o.cache.size!=null?o.cache.size:'—')+' <small>entries</small>'),
    statCard('BX API', (api.degraded?'degraded':'healthy'), apiCls),
    statCard('WS ping', (o.bot.wsPingMs==null?'—':o.bot.wsPingMs+'ms')),
    statCard('Uptime', fmtDur(o.bot.uptimeSec)),
    statCard('Memory', o.bot.memoryMB+' <small>MB</small>'),
    statCard('Version','v'+o.bot.version),
  ];
  items.forEach(function(s){ g.appendChild(s); });
  $('#botline').textContent = o.bot.tag + ' · ' + o.bot.commandCount + ' commands · node ' + o.bot.node +
    (o.flags.maintenance?' · 🛠 MAINTENANCE':'') + (o.bot.autobypassDisabled?' · auto-bypass OFF':'') +
    (o.flags.disabledCommands.length?(' · disabled: '+o.flags.disabledCommands.join(', ')):'');
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
    tr.appendChild(el('td',null,g.channels));
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
    [['info','guild_details'],['inv','guild_invite'],['leave','leave_guild']].forEach(function(p){
      var b=el('button', p[0]==='leave'?'dgr':''); b.textContent=p[0];
      b.onclick=function(){
        if(p[0]==='leave' && !window.confirm('Leave "'+g.name+'"?')) return;
        runAction(p[1],{guildId:g.id},b,false);
      };
      rb.appendChild(b);
    });
    tdA.appendChild(rb); tr.appendChild(tdA);
    tb.appendChild(tr);
  });
  if(!o.guilds.list.length){ var tr=document.createElement('tr'); tr.appendChild(el('td','mut','No guilds.')).colSpan=6; tb.appendChild(tr); }
}

function renderLists(o){
  var bl=$('#blacklists'); bl.innerHTML='';
  if(!o.blacklists.length){ bl.appendChild(el('span','mut','Blacklist is empty.')); }
  else o.blacklists.slice(0,12).forEach(function(b){
    var s=el('span','badge'+(b.type==='guild'?' bl':''), (b.type==='guild'?'🏠 ':'👤 ')+(b.target_id||b.targetId));
    s.style.marginRight='6px'; bl.appendChild(s);
  });
  var lg=$('#logs tbody'); lg.innerHTML='';
  (o.logs||[]).forEach(function(l){
    var tr=document.createElement('tr');
    tr.appendChild(el('td','mono', l.created_at?new Date(l.created_at).toLocaleTimeString():''));
    tr.appendChild(el('td','mono', l.source||''));
    tr.appendChild(el('td',null, l.domain||l.url||''));
    tr.appendChild(el('td',null, l.success?'✅':'❌'));
    lg.appendChild(tr);
  });
  if(!(o.logs||[]).length){ var tr=document.createElement('tr'); var td=el('td','mut','No bypasses logged yet.'); td.colSpan=4; tr.appendChild(td); lg.appendChild(tr); }
}

var timer=null;
function loadOverview(say){
  return api('overview').then(function(o){
    renderStats(o); renderGuilds(o); renderLists(o);
    if(say) out('overview refreshed — ' + o.guilds.count + ' guild(s), ' + o.guilds.totalMembers.toLocaleString() + ' members', 'dim');
  }).catch(function(e){ out('overview failed: '+e.message, 'err'); });
}

function boot(){
  buildConsole();
  loadOverview(true);
  var t=$('#autoref');
  t.onchange=function(){
    if(timer){ clearInterval(timer); timer=null; }
    if(t.checked) timer=setInterval(function(){ loadOverview(false); }, 15000);
  };
  $('#logout').onclick=function(){ location.replace('/dashboard'); };
  $('#export').onclick=function(){ window.open('/dashboard/api/export.json?token='+encodeURIComponent(TOKEN),'_blank'); };
}
document.addEventListener('DOMContentLoaded', boot);
`;

export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>BypassX · Owner Console</title>
<style>${CSS}</style>
</head>
<body>
<div class="aurora"><i></i><i></i><i></i></div>
<div class="wrap">
  <header>
    <div class="logo">
      <div class="bolt">⚡</div>
      <h1>BypassX <span>Owner Console — private, token-gated</span></h1>
    </div>
    <span class="pill"><span class="dot"></span><span id="botline">loading…</span></span>
    <div class="spacer"></div>
    <label class="pill"><input type="checkbox" id="autoref" checked style="margin-right:6px">auto-refresh 15s</label>
    <button id="export">Export logs</button>
    <button id="logout">Logout</button>
  </header>

  <div class="grid" id="stats"></div>

  <section>
    <h2>Servers the bot is in</h2>
    <div class="card" style="padding:6px 10px;overflow-x:auto">
      <table id="guilds">
        <thead><tr><th>Guild</th><th>ID</th><th>Members</th><th>Channels</th><th>Auto-bypass</th><th>Joined</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Owner command arsenal</h2>
    <div class="groups" id="groups"></div>
  </section>

  <section>
    <h2>Console output</h2>
    <div id="out"></div>
  </section>

  <section>
    <h2>Blacklist &amp; recent bypasses</h2>
    <div class="card" style="margin-bottom:12px" id="blacklists"></div>
    <div class="card" style="padding:6px 10px;overflow-x:auto">
      <table>
        <thead><tr><th>Time</th><th>Source</th><th>Link / domain</th><th></th></tr></thead>
        <tbody id="logs"></tbody>
      </table>
    </div>
  </section>
</div>
<script>${JS}</script>
</body>
</html>`;
}

export function dashboardLoginHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>BypassX · Owner Console — login</title>
<style>${CSS}</style>
</head>
<body>
<div class="aurora"><i></i><i></i><i></i></div>
<div class="login">
  <div class="card">
    <div class="logo" style="justify-content:center;margin-bottom:8px">
      <div class="bolt">⚡</div>
    </div>
    <h1>BypassX Owner Console</h1>
    <p class="mut" style="font-size:13px">Private area — enter the <span class="mono">DASHBOARD_TOKEN</span> to continue.</p>
    <form method="GET" action="/dashboard">
      <input type="password" name="token" placeholder="dashboard token" autocomplete="off" autofocus required>
      <button class="pri" type="submit">Unlock console</button>
    </form>
  </div>
</div>
</body>
</html>`;
}
