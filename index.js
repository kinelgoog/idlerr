// index.js — Steam Booster Ultimate (ручное Steam Guard Mobile)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const SteamUser = require('steam-user');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// ================= ACCOUNTS =================
const ACCOUNTS = {
  k1nel: {
    id: 'k1nel',
    displayName: 'кинелька',
    username: 'k1nelsteam',
    password: 'JenyaKinel2023steam',
    games: [730],
    needsGuardCode: false,
  },
  tochka: {
    id: 'tochka',
    displayName: 'точка',
    username: 'tochka_bi_laik',
    password: 'JenyaKinel2023steam',
    games: [730],
    needsGuardCode: false,
  },
};

// ================= BOT CLASS =================
class SteamFarmBot {
  constructor(config) {
    this.config = config;
    this.client = new SteamUser();
    this.isRunning = false;
    this.status = 'offline';
    this.logMessages = [];
    this.hoursPlayed = {};
    config.games.forEach(g => (this.hoursPlayed[g] = 0));
    this.steamGuardCallback = null;
    this.errorMessage = null;
    this.hoursInterval = null;
    this.setupEvents();
  }

  log(text, type = 'info') {
    const ts = new Date().toLocaleTimeString();
    const entry = { msg: `[${ts}] ${text}`, type };
    this.logMessages.push(entry);
    if (this.logMessages.length > 50) this.logMessages.shift();
    console.log(`[${this.config.displayName}] ${text}`);
  }

  setupEvents() {
    this.client.on('loggedOn', () => {
      this.log('Успешный вход!', 'success');
      this.client.setPersona(SteamUser.EPersonaState.Online);
      this.client.gamesPlayed(this.config.games);
      this.isRunning = true;
      this.status = 'online';
      this.startHoursTracking();
    });

    this.client.on('steamGuard', (domain, callback) => {
      this.log('Требуется Steam Guard (Mobile). Жду код...', 'warning');
      this.steamGuardCallback = callback;
      this.status = 'steam_guard';
      this.config.needsGuardCode = true;
    });

    this.client.on('error', err => {
      this.log('Ошибка: ' + (err.message || String(err)), 'error');
      this.status = 'error';
      this.errorMessage = err.message || String(err);
      this.stopHoursTracking();
    });

    this.client.on('disconnected', () => {
      this.log('Отключен', 'info');
      this.isRunning = false;
      this.stopHoursTracking();
      if (this.status !== 'error') this.status = 'offline';
    });
  }

  startHoursTracking() {
    if (this.hoursInterval) return;
    this.hoursInterval = setInterval(() => {
      Object.keys(this.hoursPlayed).forEach(gid => {
        this.hoursPlayed[gid] += 1 / 60; // +1 минута
      });
    }, 60 * 1000);
  }

  stopHoursTracking() {
    if (this.hoursInterval) clearInterval(this.hoursInterval);
    this.hoursInterval = null;
  }

  start() {
    if (this.isRunning) {
      this.log('Уже запущен', 'info');
      return;
    }
    this.status = 'connecting';
    this.log('Запуск бота...', 'info');
    this.client.logOn({
      accountName: this.config.username,
      password: this.config.password,
    });
  }

  stop() {
    if (this.isRunning) {
      this.log('Остановка бота...', 'info');
      this.client.logOff();
    }
    this.isRunning = false;
    this.stopHoursTracking();
    this.status = 'offline';
  }

  submitGuardCode(code) {
    if (this.steamGuardCallback) {
      try {
        this.steamGuardCallback(code);
        this.steamGuardCallback = null;
        this.config.needsGuardCode = false;
        this.log('Код Steam Guard принят: ' + code, 'success');
        this.status = 'connecting';
        return true;
      } catch (e) {
        this.log('Ошибка при отправке Steam Guard кода: ' + (e.message || e), 'error');
        return false;
      }
    }
    return false;
  }
}

// ================= CREATE BOTS =================
const bots = {};
Object.values(ACCOUNTS).forEach(cfg => {
  bots[cfg.id] = new SteamFarmBot(cfg);
});

// ================= WEBSOCKET UPDATES =================
wss.on('connection', ws => {
  const interval = setInterval(() => {
    const statusData = {};
    for (const id in bots) {
      const b = bots[id];
      statusData[id] = {
        displayName: b.config.displayName,
        status: b.status,
        needsGuardCode: b.config.needsGuardCode,
        errorMessage: b.errorMessage || null,
        log: b.logMessages,
        hoursPlayed: b.hoursPlayed,
      };
    }
    try {
      ws.send(JSON.stringify({ type: 'update', accounts: statusData }));
    } catch {}
  }, 1500);

  ws.on('close', () => clearInterval(interval));
});

// ================= API =================
app.post('/api/start/:id', (req, res) => {
  const bot = bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Аккаунт не найден' });
  bot.start();
  res.json({ success: true });
});

app.post('/api/stop/:id', (req, res) => {
  const bot = bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Аккаунт не найден' });
  bot.stop();
  res.json({ success: true });
});

app.post('/api/guard/:id', (req, res) => {
  const bot = bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Аккаунт не найден' });
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Требуется { "code": "..." }' });
  const ok = bot.submitGuardCode(code);
  if (ok) res.json({ success: true });
  else res.status(400).json({ error: 'Код не принят' });
});

// ================= FRONTEND =================
app.get('/', (req, res) => {
  let html = `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Steam Booster Personal</title>
<style>
body{font-family:Arial;background:#0a0f1b;color:#fff;margin:0;padding:20px;}
h1{text-align:center;margin-bottom:20px;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;}
.card{background:#1a1f32;padding:15px;border-radius:12px;box-shadow:0 5px 15px rgba(0,0,0,0.5);}
.title{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
.status{padding:4px 8px;border-radius:999px;font-size:12px;font-weight:bold;}
.online{background:#16a34a;color:#fff;}
.offline{background:#64748b;color:#fff;}
.steam_guard{background:#facc15;color:#000;}
.error{background:#ef4444;color:#fff;}
.controls{margin-top:10px;}
.btn{padding:8px 12px;border:none;border-radius:8px;margin-right:6px;cursor:pointer;font-weight:bold;}
.btn-start{background:#06b6d4;color:#000;}
.btn-stop{background:#ef4444;color:#fff;}
.input{margin-top:6px;padding:6px;border-radius:6px;border:none;width:100%;}
.log{margin-top:10px;background:rgba(255,255,255,0.1);height:100px;overflow:auto;padding:6px;font-size:12px;font-family:monospace;}
</style>
</head>
<body>
<h1>🎮 Steam Booster — персональная панель</h1>
<div class="grid">
`;

  Object.values(ACCOUNTS).forEach(acc => {
    html += `
<div class="card" id="card-${acc.id}">
<div class="title"><div>${acc.displayName}</div><div id="status-${acc.id}" class="status offline">OFFLINE</div></div>
<div>Логин: ${acc.username}</div>
<div class="controls">
<button class="btn btn-start" onclick="startBot('${acc.id}')">СТАРТ</button>
<button class="btn btn-stop" onclick="stopBot('${acc.id}')">СТОП</button>
</div>
<div id="guard-${acc.id}" style="margin-top:8px;"></div>
<div class="log" id="log-${acc.id}"></div>
</div>
`;
  });

  html += `
</div>
<script>
const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host);
let accounts = {};
ws.onmessage = e => { try{ const d = JSON.parse(e.data); if(d.type==='update'){ accounts=d.accounts; renderAll(); }}catch{} };
function renderAll(){ Object.keys(accounts).forEach(id=>render(id,accounts[id])); }
function render(id,acc){
const s=document.getElementById('status-'+id);
const log=document.getElementById('log-'+id);
const guard=document.getElementById('guard-'+id);
s.className='status '+(acc.status==='online'?'online':acc.status==='steam_guard'?'steam_guard':acc.status==='error'?'error':'offline');
s.textContent=(acc.status||'offline').toUpperCase();
log.innerHTML=acc.log.slice().reverse().map(l=>'<div style="color:'+(l.type==='error'?'#ffb4b4':l.type==='warning'?'#ffd7a6':'#bce7d8')+'">'+l.msg+'</div>').join('');
if(acc.needsGuardCode){
guard.innerHTML='<input class="input" id="input-'+id+'" placeholder="Код Steam Guard"><button class="btn btn-start" onclick="sendGuardCode(\''+id+'\')">ОТПРАВИТЬ КОД</button>';
}else{ guard.innerHTML=''; }
}
function startBot(id){ fetch('/api/start/'+id,{method:'POST'}); }
function stopBot(id){ fetch('/api/stop/'+id,{method:'POST'}); }
function sendGuardCode(id){ const v=document.getElementById('input-'+id).value; if(!v) return alert('Введите код'); fetch('/api/guard/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:v})}).then(r=>r.json()).then(j=>{ if(j.success)alert('Код принят'); else alert('Ошибка'); }).catch(()=>alert('Ошибка сети')); }
</script>
</body>
</html>
`;
  res.send(html);
});

// ================= START SERVER =================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log('🚀 Steam Booster Personal запущен на порту', PORT);
});
