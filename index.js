// index.js — с экспоненциальным бэкоффом при RateLimitExceeded
const express = require('express');
const SteamUser = require('steam-user');

const app = express();
const PORT = process.env.PORT || 10000;
app.use(express.json());

// ========== Accounts (hardcoded as requested) ==========
const accounts = {
  tochka: {
    id: 'tochka',
    username: 'tochka_bi_laik',
    password: 'JenyaKinel2023steam',
    displayName: 'точка',
    games: ['730'],
    status: 'offline',
    farm: 'stopped',
    error: null,
    retryState: null, // will hold backoff info
  },
  kinel: {
    id: 'kinel',
    username: 'k1nelsteam',
    password: 'JenyaKinel2023steam',
    displayName: 'кинелька',
    games: ['730'],
    status: 'offline',
    farm: 'stopped',
    error: null,
    retryState: null,
  }
};

const bots = {};

// ========== Backoff helper ==========
function initRetryState(acc) {
  acc.retryState = {
    attempts: 0,
    // backoff sequence in seconds: increase if needed
    sequence: [30, 60, 120, 300, 600, 1800],
    timeoutId: null,
    nextTryAt: null
  };
}
function getNextDelay(acc) {
  if (!acc.retryState) initRetryState(acc);
  const rs = acc.retryState;
  const idx = Math.min(rs.attempts, rs.sequence.length - 1);
  return rs.sequence[idx] * 1000;
}
function scheduleRetry(accId, fnAttempt) {
  const acc = accounts[accId];
  if (!acc) return;
  if (!acc.retryState) initRetryState(acc);
  const rs = acc.retryState;
  const delay = getNextDelay(acc);
  rs.attempts++;
  rs.nextTryAt = Date.now() + delay;
  // clear previous just in case
  if (rs.timeoutId) clearTimeout(rs.timeoutId);
  rs.timeoutId = setTimeout(async () => {
    rs.timeoutId = null;
    rs.nextTryAt = null;
    try {
      await fnAttempt();
    } catch (e) {
      // fnAttempt handles errors itself
    }
  }, delay);
}

// ========== SteamBot class with backoff-aware start ==========
class SteamBot {
  constructor(acc) {
    this.acc = acc;
    this.client = new SteamUser();
    this.isRunning = false;
    this.guardCallback = null;
    this.setupEvents();
  }

  setupEvents() {
    // remove previous listeners to avoid duplication
    this.client.removeAllListeners && this.client.removeAllListeners();

    this.client.on('loggedOn', () => {
      this.acc.status = 'online';
      this.acc.farm = 'running';
      this.acc.error = null;
      this.isRunning = true;
      // reset retry state on success
      if (this.acc.retryState) this.acc.retryState.attempts = 0;
      console.log(`[${this.acc.displayName}] logged in`);
    });

    this.client.on('steamGuard', (domain, callback) => {
      this.guardCallback = callback;
      this.acc.status = 'steam_guard';
      this.acc.farm = 'stopped';
      console.log(`[${this.acc.displayName}] steamGuard required`);
    });

    this.client.on('error', (err) => {
      const msg = (err && err.message) ? err.message : String(err);
      this.acc.error = msg;
      this.acc.farm = 'stopped';
      this.isRunning = false;
      console.log(`[${this.acc.displayName}] error: ${msg}`);

      // handle RateLimitExceeded specifically (err.message or err.eresult sometimes)
      const m = msg.toLowerCase();
      const isRate = m.includes('ratelimit') || m.includes('ratelimitexceeded') || (err && err.eresult === 29);

      if (isRate) {
        // schedule retry with backoff
        if (!this.acc.retryState) initRetryState(this.acc);
        scheduleRetry(this.acc.id, async () => {
          console.log(`[${this.acc.displayName}] retry attempt #${this.acc.retryState.attempts} after backoff`);
          // try to start again (this.start will respect current client)
          this.start();
        });
      } else {
        // for other errors, wait short time before allowing manual retry
        if (!this.acc.retryState) initRetryState(this.acc);
        // small delay of 30s
        if (this.acc.retryState.timeoutId) clearTimeout(this.acc.retryState.timeoutId);
        this.acc.retryState.nextTryAt = Date.now() + 30000;
        this.acc.retryState.timeoutId = setTimeout(() => {
          this.acc.retryState.nextTryAt = null;
        }, 30000);
      }
    });

    this.client.on('disconnected', () => {
      this.acc.status = 'offline';
      this.acc.farm = 'stopped';
      this.isRunning = false;
      console.log(`[${this.acc.displayName}] disconnected`);
    });
  }

  async start() {
    // if there is a scheduled nextTryAt in the future, do NOT start now
    if (this.acc.retryState && this.acc.retryState.nextTryAt && Date.now() < this.acc.retryState.nextTryAt) {
      console.log(`[${this.acc.displayName}] start blocked by backoff, next try at ${new Date(this.acc.retryState.nextTryAt).toLocaleTimeString()}`);
      return;
    }

    if (this.isRunning) return;
    this.acc.status = 'connecting';
    this.acc.farm = 'starting';
    try {
      this.client.logOn({ accountName: this.acc.username, password: this.acc.password });
    } catch (e) {
      console.error('logOn threw', e);
    }
  }

  stop() {
    try {
      this.client.logOff();
    } catch (e) {}
    if (this.acc.retryState && this.acc.retryState.timeoutId) { clearTimeout(this.acc.retryState.timeoutId); this.acc.retryState.timeoutId = null; this.acc.retryState.nextTryAt = null; }
    this.acc.status = 'offline';
    this.acc.farm = 'stopped';
    this.isRunning = false;
  }

  submitGuard(code) {
    if (this.guardCallback) {
      try {
        this.guardCallback(code);
        this.guardCallback = null;
        this.acc.status = 'connecting';
        return true;
      } catch (e) {
        console.error('guard submit error', e);
        return false;
      }
    }
    return false;
  }
}

// ========== API ==========

app.post('/api/start/:id', (req, res) => {
  const id = req.params.id;
  const acc = accounts[id];
  if (!acc) return res.status(404).json({ error: 'Аккаунт не найден' });

  if (!bots[id]) bots[id] = new SteamBot(acc);
  // try start (SteamBot.start will respect backoff)
  bots[id].start();

  return res.json({ success: true, message: 'Запуск инициирован' });
});

app.post('/api/stop/:id', (req, res) => {
  const id = req.params.id;
  if (bots[id]) bots[id].stop();
  return res.json({ success: true });
});

app.post('/api/guard/:id', (req, res) => {
  const id = req.params.id;
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Введите code в JSON' });
  if (!bots[id]) return res.status(404).json({ error: 'Бот не найден' });
  const ok = bots[id].submitGuard(code);
  if (ok) return res.json({ success: true });
  return res.status(400).json({ error: 'Код не принят' });
});

app.get('/api/status', (req, res) => {
  // send accounts + retry info
  const out = {};
  Object.keys(accounts).forEach(k => {
    const a = Object.assign({}, accounts[k]);
    if (a.retryState) {
      out[k] = Object.assign({}, a, {
        retryState: {
          attempts: a.retryState.attempts,
          nextTryAt: a.retryState.nextTryAt
        }
      });
    } else out[k] = a;
  });
  res.json(out);
});

// ========== Frontend (cosmic UI improved with backoff info) ==========
app.get('/', (req, res) => {
  res.send(`
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Steam Booster — safe backoff</title>
<style>
:root{--bg1:#05021a;--bg2:#07123a;--neon:#7cf;}
body{margin:0;font-family:Inter,Segoe UI,Arial;background:linear-gradient(180deg,var(--bg1),var(--bg2));color:#e8f0ff;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:28px;}
h1{font-size:28px;margin:8px 0 20px;text-align:center;color:var(--neon);text-shadow:0 0 18px rgba(124,207,255,0.16);}
.container{width:100%;max-width:1100px;}
.grid{display:flex;gap:20px;flex-wrap:wrap;justify-content:center;}
.card{background:rgba(255,255,255,0.03);border-radius:14px;padding:18px;width:340px;box-shadow:0 10px 30px rgba(0,0,0,0.5);position:relative;overflow:hidden;border:1px solid rgba(124,207,255,0.05);}
.card h2{margin:0 0 8px;font-size:18px;}
.status{display:inline-block;padding:6px 10px;border-radius:999px;font-weight:700;margin-bottom:8px;}
.online{background:#16a34a;color:#02140b;}
.offline{background:#64748b;color:#fff;}
.steam_guard{background:#facc15;color:#000;}
.error{background:#ef4444;color:#fff;}
.controls{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
.btn{padding:10px 14px;border-radius:10px;border:none;cursor:pointer;font-weight:700;background:linear-gradient(90deg,#7cf,#9f7cff);color:#001;box-shadow:0 6px 18px rgba(124,207,255,0.06);}
.btn.secondary{background:#ef4444;color:#fff;}
.small{font-size:13px;color:#9fb2d9;margin-top:8px;text-align:center;}
.log{margin-top:10px;height:120px;overflow:auto;background:rgba(255,255,255,0.02);padding:10px;border-radius:8px;font-family:monospace;font-size:12px;color:#dbeeff;}
.timer{margin-top:8px;font-size:13px;color:#ffd7a6}
.footer{margin-top:26px;color:#9fb2d9;text-align:center;font-size:13px;}
</style>
</head>
<body>
  <h1>🚀 Steam Booster — safe login with backoff</h1>
  <div class="container">
    <div class="grid" id="grid"></div>
    <div class="footer">Система автоматически применяет задержки при ошибках (RateLimit). Нажимай START только если индикатор "next try" пуст.</div>
  </div>

<script>
async function fetchStatus(){
  const r = await fetch('/api/status');
  return r.json();
}

function fmtTime(ts){
  if(!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function renderAccount(acc){
  const retry = acc.retryState || {};
  const nextTry = retry.nextTryAt ? fmtTime(retry.nextTryAt) : '';
  const nextTryMs = retry.nextTryAt ? (retry.nextTryAt - Date.now()) : 0;
  const blocked = nextTryMs > 0;
  return \`
  <div class="card">
    <h2>\${acc.displayName}</h2>
    <div class="status \${acc.status}">\${(acc.status||'offline').toUpperCase()}</div>
    <div class="small">\${acc.error?'<span style="color:#ffb4b4">Ошибка: '+acc.error+'</span>': ''}</div>
    <div class="controls">
      <button class="btn" onclick="start('\${acc.id}')" \${blocked?'disabled':''}>START</button>
      <button class="btn secondary" onclick="stop('\${acc.id}')">STOP</button>
      \${acc.status==='steam_guard' ? '<button class="btn" onclick="openGuard(\\''+acc.id+'\\')">Ввести код</button>' : ''}
    </div>
    <div class="timer">\${blocked ? 'Следующая автоматическая попытка: ' + nextTry + ' (через ' + Math.ceil(nextTryMs/1000) + 's) — попыток: ' + (retry.attempts||0) : (retry.attempts?('Попыток: '+retry.attempts):'')}</div>
    <div class="log">\${(acc.log||[]).slice().reverse().map(l=>'&gt; '+l.msg).join('<br>')}</div>
  </div>\`;
}

let polling = null;
async function reload(){
  const st = await fetchStatus();
  const grid = document.getElementById('grid');
  grid.innerHTML = Object.values(st).map(renderAccount).join('');
}

window.start = async (id) => {
  await fetch('/api/start/'+id,{method:'POST'});
  setTimeout(reload,1000);
};
window.stop = async (id) => {
  await fetch('/api/stop/'+id,{method:'POST'});
  setTimeout(reload,1000);
};
window.openGuard = (id) => {
  const code = prompt('Введите код Steam Guard для '+id+':');
  if (!code) return;
  fetch('/api/guard/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})}).then(r=>r.json()).then(j=>{
    if(j.success) alert('Код отправлен');
    else alert('Ошибка: '+(j.error||'неизвестно'));
    setTimeout(reload,800);
  });
};

reload();
setInterval(reload,3000);
</script>
</body>
</html>
  `);
});

// ========== Start server ==========
app.listen(PORT, () => console.log(\`Server listening on \${PORT}\`));
