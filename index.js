const express = require("express");
const SteamUser = require("steam-user");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// 🔥 Аккаунты
const accounts = {
  tochka: {
    id: "tochka",
    username: "tochka_bi_laik",
    password: "JenyaKinel2023steam",
    displayName: "точка",
    games: ["730"],
    guard: false,
    status: "offline",
    farm: "stopped",
    error: null,
  },
  kinel: {
    id: "kinel",
    username: "k1nelsteam",
    password: "JenyaKinel2023steam",
    displayName: "кинелька",
    games: ["730"],
    guard: true,
    status: "offline",
    farm: "stopped",
    error: null,
  },
};

const bots = {};

// 🚀 Бот-класс
class SteamBot {
  constructor(acc) {
    this.acc = acc;
    this.client = new SteamUser();
    this.isRunning = false;
    this.guardCallback = null;
  }

  setupEvents() {
    this.client.on("loggedOn", () => {
      this.client.setPersona(SteamUser.EPersonaState.Online);
      this.client.gamesPlayed(this.acc.games);
      this.isRunning = true;
      accounts[this.acc.id].status = "online";
      accounts[this.acc.id].farm = "running";
      accounts[this.acc.id].error = null;
      console.log(`✅ [${this.acc.displayName}] вошёл в Steam`);
    });

    this.client.on("steamGuard", (domain, callback) => {
      accounts[this.acc.id].status = "steam_guard";
      this.guardCallback = callback;
      console.log(`🔐 [${this.acc.displayName}] требует Steam Guard`);
    });

    this.client.on("error", (err) => {
      accounts[this.acc.id].status = "error";
      accounts[this.acc.id].farm = "stopped";
      accounts[this.acc.id].error = err.message;
      console.log(`❌ [${this.acc.displayName}] Ошибка: ${err.message}`);
    });

    this.client.on("disconnected", () => {
      accounts[this.acc.id].status = "offline";
      accounts[this.acc.id].farm = "stopped";
      this.isRunning = false;
      console.log(`🔌 [${this.acc.displayName}] отключён`);
    });
  }

  start() {
    if (this.isRunning) return;
    this.setupEvents();
    accounts[this.acc.id].status = "connecting";
    this.client.logOn({
      accountName: this.acc.username,
      password: this.acc.password,
    });
  }

  stop() {
    if (this.isRunning) {
      this.client.logOff();
      this.isRunning = false;
      accounts[this.acc.id].status = "offline";
      accounts[this.acc.id].farm = "stopped";
    }
  }

  guard(code) {
    if (this.guardCallback) {
      this.guardCallback(code);
      this.guardCallback = null;
      accounts[this.acc.id].status = "connecting";
      return true;
    }
    return false;
  }
}

// 🧠 API
app.post("/api/start/:id", (req, res) => {
  const id = req.params.id;
  if (!accounts[id]) return res.status(404).json({ error: "Аккаунт не найден" });

  if (!bots[id]) bots[id] = new SteamBot(accounts[id]);
  bots[id].start();
  res.json({ success: true });
});

app.post("/api/stop/:id", (req, res) => {
  const id = req.params.id;
  if (bots[id]) bots[id].stop();
  res.json({ success: true });
});

app.post("/api/guard/:id", (req, res) => {
  const id = req.params.id;
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Введите код" });
  if (bots[id] && bots[id].guard(code)) res.json({ success: true });
  else res.status(400).json({ error: "Неверный код или бот не ждёт код" });
});

app.get("/api/status", (req, res) => res.json(accounts));

// 🌌 Интерфейс
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>🚀 Steam Booster Cosmic</title>
<style>
body {
  margin: 0;
  font-family: "Segoe UI", sans-serif;
  background: radial-gradient(circle at 20% 20%, #090a15, #000);
  color: white;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-x: hidden;
}
h1 {
  margin-top: 40px;
  font-size: 2.8em;
  background: linear-gradient(90deg, #6ef, #c6f);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: glow 3s ease-in-out infinite alternate;
}
@keyframes glow { from {text-shadow: 0 0 10px #6ef;} to {text-shadow: 0 0 20px #c6f;} }
.grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 30px;
  margin-top: 40px;
}
.card {
  background: rgba(30,30,60,0.8);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 20px;
  padding: 25px;
  width: 280px;
  text-align: center;
  box-shadow: 0 0 15px rgba(80,80,255,0.3);
  transition: transform 0.3s, box-shadow 0.3s;
}
.card:hover {
  transform: scale(1.05);
  box-shadow: 0 0 25px rgba(140,140,255,0.5);
}
.status {
  margin: 10px 0;
  font-size: 1em;
  padding: 6px 10px;
  border-radius: 8px;
  display: inline-block;
}
.online { background: #43b581; }
.offline { background: #555; }
.error { background: #f04747; }
.steam_guard { background: #faa61a; color: #000; }
button {
  background: linear-gradient(90deg, #6ef, #c6f);
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  margin: 6px;
  font-size: 1em;
  cursor: pointer;
  color: #000;
  transition: 0.3s;
}
button:hover { filter: brightness(1.2); }
.modal {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.85);
  justify-content: center;
  align-items: center;
}
.modal-content {
  background: #1e1e3a;
  padding: 25px;
  border-radius: 15px;
  text-align: center;
  color: white;
  width: 300px;
}
input {
  width: 100%;
  padding: 10px;
  margin-top: 10px;
  border: none;
  border-radius: 8px;
}
</style>
</head>
<body>
<h1>🚀 Steam Booster Cosmic</h1>
<div class="grid" id="accounts"></div>

<div class="modal" id="guardModal">
  <div class="modal-content">
    <h3>Введите Steam Guard код</h3>
    <input id="guardCode" placeholder="Код из мобильного Steam">
    <button onclick="sendGuard()">Отправить</button>
  </div>
</div>

<script>
let currentId = null;

async function load() {
  const res = await fetch('/api/status');
  const data = await res.json();
  document.getElementById('accounts').innerHTML = Object.values(data).map(acc => {
    return \`
    <div class="card">
      <h2>\${acc.displayName}</h2>
      <div class="status \${acc.status}">\${acc.status.toUpperCase()}</div>
      <p>\${acc.error ? '<span style="color:#f77">'+acc.error+'</span>' : ''}</p>
      \${acc.status === 'steam_guard' ? 
        '<button onclick="openGuard(\\'\${acc.id}\\')">Ввести код</button>' : ''}
      <div>
        <button onclick="startFarm('\${acc.id}')">СТАРТ</button>
        <button onclick="stopFarm('\${acc.id}')">СТОП</button>
      </div>
    </div>\`;
  }).join('');
}

async function startFarm(id) {
  await fetch('/api/start/'+id,{method:'POST'});
  setTimeout(load,1500);
}
async function stopFarm(id) {
  await fetch('/api/stop/'+id,{method:'POST'});
  setTimeout(load,1000);
}
function openGuard(id){
  currentId=id;
  document.getElementById('guardModal').style.display='flex';
}
async function sendGuard(){
  const code=document.getElementById('guardCode').value;
  await fetch('/api/guard/'+currentId,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({code})
  });
  document.getElementById('guardModal').style.display='none';
  document.getElementById('guardCode').value='';
  setTimeout(load,1500);
}
document.getElementById('guardModal').addEventListener('click',e=>{
  if(e.target===document.getElementById('guardModal'))e.target.style.display='none';
});
load();
setInterval(load,4000);
</script>
</body>
</html>
`);
});

// 💫 Запуск
app.listen(PORT, () => console.log(`🌌 Cosmic Booster online — порт ${PORT}`));
