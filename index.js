require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// === Настройки аккаунтов через .env ===
const accountsConfig = [
  {
    id: 'acc_1',
    displayName: 'точка',
    username: process.env.ACC_1_USERNAME,
    password: process.env.ACC_1_PASSWORD,
    sharedSecret: process.env.ACC_1_SHAREDSECRET,
    games: [730]
  },
  {
    id: 'acc_2',
    displayName: 'кинелька',
    username: process.env.ACC_2_USERNAME,
    password: process.env.ACC_2_PASSWORD,
    sharedSecret: process.env.ACC_2_SHAREDSECRET,
    games: [730]
  }
];

// === Класс бота ===
class SteamFarmBot {
  constructor({ id, displayName, username, password, sharedSecret, games }) {
    this.config = { id, displayName, username, password, sharedSecret, games };
    this.client = new SteamUser();
    this.isRunning = false;
    this.status = 'offline';
    this.logMessages = [];
    this.hoursPlayed = {};
    games.forEach(game => (this.hoursPlayed[game] = 0));
    this.steamGuardCallback = null;
    this.errorMessage = null;
    this.setupEvents();
  }

  log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    this.logMessages.push({ msg: formatted, type });
    if (this.logMessages.length > 50) this.logMessages.shift();
    console.log(`[${this.config.displayName}] ${msg}`);
    return formatted;
  }

  setupEvents() {
    this.client.on('loggedOn', () => {
      this.log('✅ Успешный вход!', 'success');
      this.client.setPersona(SteamUser.EPersonaState.Online);
      this.client.gamesPlayed(this.config.games);
      this.isRunning = true;
      this.status = 'online';
      this.startTrackingHours();
    });

    this.client.on('steamGuard', (domain, callback) => {
      if (this.config.sharedSecret) {
        const code = SteamTotp.generateAuthCode(this.config.sharedSecret);
        this.log(`🔐 Отправка Mobile Steam Guard: ${code}`, 'info');
        callback(code);
      } else {
        this.log('🔐 Требуется код Steam Guard (Email)', 'warning');
        this.steamGuardCallback = callback;
        this.status = 'steam_guard';
      }
    });

    this.client.on('error', err => {
      this.log(`❌ Ошибка: ${err.message}`, 'error');
      this.status = 'error';
      this.errorMessage = err.message;
      this.stopTrackingHours();
    });

    this.client.on('disconnected', () => {
      this.log('🔌 Отключен', 'info');
      this.isRunning = false;
      this.stopTrackingHours();
      if (this.status !== 'error') this.status = 'offline';
    });
  }

  startTrackingHours() {
    if (this.hoursInterval) return;
    this.hoursInterval = setInterval(() => {
      for (let gameId of this.config.games) this.hoursPlayed[gameId] += 1 / 60;
    }, 60 * 1000);
  }

  stopTrackingHours() {
    if (this.hoursInterval) clearInterval(this.hoursInterval);
    this.hoursInterval = null;
  }

  start() {
    if (this.isRunning) return;
    this.status = 'connecting';
    this.log('🚀 Запуск...', 'info');
    this.client.logOn({ accountName: this.config.username, password: this.config.password });
  }

  stop() {
    if (this.isRunning) {
      this.log('🛑 Остановка...', 'info');
      this.client.logOff();
    }
    this.isRunning = false;
    this.stopTrackingHours();
    this.status = 'offline';
  }

  submitSteamGuardCode(code) {
    if (this.steamGuardCallback) {
      this.steamGuardCallback(code);
      this.steamGuardCallback = null;
      this.status = 'connecting';
      this.log(`🔐 Отправлен код Steam Guard: ${code}`, 'success');
      return true;
    }
    return false;
  }
}

// === Создаем боты ===
const bots = {};
accountsConfig.forEach(acc => {
  bots[acc.id] = new SteamFarmBot(acc);
});

// === WebSocket для фронтенда ===
wss.on('connection', ws => {
  const interval = setInterval(() => {
    const statusData = {};
    for (const id in bots) {
      const bot = bots[id];
      statusData[id] = {
        displayName: bot.config.displayName,
        status: bot.status,
        needsGuardCode: !!bot.steamGuardCallback,
        errorMessage: bot.errorMessage || null,
        log: bot.logMessages,
        hoursPlayed: bot.hoursPlayed
      };
    }
    ws.send(JSON.stringify({ type: 'update', accounts: statusData }));
  }, 2000);

  ws.on('close', () => clearInterval(interval));
});

// === API ===
app.post('/api/farm/start/:id', (req, res) => {
  const bot = bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Аккаунт не найден' });
  bot.start();
  res.json({ success: true });
});

app.post('/api/farm/stop/:id', (req, res) => {
  const bot = bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Аккаунт не найден' });
  bot.stop();
  res.json({ success: true });
});

app.post('/api/steam-guard/:id', (req, res) => {
  const bot = bots[req.params.id];
  const { code } = req.body;
  if (!bot) return res.status(404).json({ error: 'Аккаунт не найден' });
  if (!code) return res.status(400).json({ error: 'Введите код' });
  if (bot.submitSteamGuardCode(code)) res.json({ success: true });
  else res.status(400).json({ error: 'Код не принят' });
});

// === Фронтенд ===
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Steam Booster Ultimate</title>
<style>
body{font-family:Arial;background:#1e1e1e;color:#fff;padding:20px;}
h1{text-align:center;margin-bottom:20px;}
.account{background:#2d2d2d;padding:15px;margin:10px 0;border-radius:10px;transition:all 0.3s;}
.account:hover{background:#333;}
.status{padding:5px 10px;border-radius:5px;margin-left:10px;color:#fff;}
.online{background:#43b581;}
.offline{background:#747f8d;}
.steam_guard{background:#faa61a;}
.error{background:#f04747;}
button{padding:8px 12px;margin:3px;border:none;border-radius:5px;cursor:pointer;color:#fff;}
.start{background:#43b581;}
.stop{background:#f04747;}
input{width:50%;padding:5px;border-radius:3px;margin-right:5px;border:1px solid #444;background:#1e1e1e;color:#fff;}
.log{background:#1e1e1e;padding:5px;margin-top:5px;max-height:150px;overflow:auto;border-radius:5px;font-size:12px;}
.progress-container{background:#444;border-radius:5px;margin:5px 0;height:12px;width:100%;}
.progress-bar{height:12px;border-radius:5px;background:#43b581;width:0%;transition:width 1s;}
</style>
</head>
<body>
<h1>🎮 Steam Booster Ultimate 10/10++</h1>
<div id="accounts"></div>

<script>
let accounts={};
const ws=new WebSocket(\`\${location.protocol==='https:'?'wss':'ws'}://\${location.host}\`);

ws.onmessage=msg=>{
  const data=JSON.parse(msg.data);
  if(data.type==='update'){accounts=data.accounts;renderAccounts();}
};

function renderAccounts(){
  const container=document.getElementById('accounts'); container.innerHTML='';
  for(const id in accounts){
    const acc=accounts[id];
    const div=document.createElement('div'); div.className='account';
    let logs=acc.log.map(l=>\`<div style="color:\${l.type==='error'?'#f04747':l.type==='warning'?'#faa61a':'#43b581'}">\${l.msg}</div>\`).join('');
    let hoursHtml=Object.entries(acc.hoursPlayed).map(([gid,h])=>\`
      <div>Game \${gid}: \${h.toFixed(2)}h
        <div class="progress-container"><div class="progress-bar" style="width:\${Math.min(h/100*100,100)}%"></div></div>
      </div>\`).join('');
    div.innerHTML=\`
      <strong>\${acc.displayName}</strong>
      <span class="status \${acc.status==='steam_guard'?'steam_guard':acc.status==='online'?'online':acc.status==='error'?'error':'offline'}">\${acc.status.toUpperCase()}</span>
      \${acc.errorMessage?`<div style="color:#f04747;">Ошибка: \${acc.errorMessage}</div>`:''}
      <div>\${hoursHtml}</div>
      <div class="log">\${logs}</div>
      <div>
        <button class="start" onclick="startFarm('\${id}')">СТАРТ</button>
        <button class="stop" onclick="stopFarm('\${id}')">СТОП</button>
        \${acc.status==='steam_guard'?`<input id="guard-\${id}" placeholder="Steam Guard код"><button onclick="submitGuard('\${id}')">ВВЕСТИ</button>`:''}
      </div>
    \`;
    container.appendChild(div);
  }
}

function startFarm(id){fetch(`/api/farm/start/${id}`,{method:'POST'});}
function stopFarm(id){fetch(`/api/farm/stop/${id}`,{method:'POST'});}
function submitGuard(id){
  const code=document.getElementById(`guard-${id}`).value;
  fetch(`/api/steam-guard/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})})
    .then(res=>res.json()).then(res=>{if(!res.success) alert(res.error);});
}
</script>
</body>
</html>
  `);
});

// === Запуск сервера ===
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на http://localhost:${PORT}`));
