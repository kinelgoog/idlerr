const express = require('express');
const steamUser = require('steam-user');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// 🎯 Предустановленные аккаунты
const DEFAULT_ACCOUNTS = {
    'acc_1': {
        id: 'acc_1',
        username: 'tochka_bi_laik',
        password: 'JenyaKinel2023steam',
        displayName: 'точка',
        steamId: '1',
        games: '730',
        guardType: 'none', // Без защиты
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline'
    },
    'acc_2': {
        id: 'acc_2', 
        username: 'k1nelsteam',
        password: 'JenyaKinel2023steam',
        displayName: 'кинелька',
        steamId: '2',
        games: '730',
        guardType: 'SGM', // Steam Guard Mobile
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline'
    }
};

// 🗄️ Хранение данных
const DATA_FILE = './accounts.json';

function loadAccounts() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.log('❌ Ошибка загрузки аккаунтов, использую предустановленные');
    }
    return DEFAULT_ACCOUNTS;
}

function saveAccounts(accounts) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2));
        return true;
    } catch (error) {
        console.log('❌ Ошибка сохранения аккаунтов');
        return false;
    }
}

let accounts = loadAccounts();

// 🤖 Простой Steam Bot
class SteamFarmBot {
    constructor(accountConfig) {
        this.config = accountConfig;
        this.client = new steamUser();
        this.isRunning = false;
        this.steamGuardCallback = null;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            console.log(`✅ Бот ${this.config.displayName} успешно вошел в систему`);
            
            const games = this.config.games.split(' ').map(g => parseInt(g)).filter(g => !isNaN(g));
            this.client.setPersona(1);
            this.client.gamesPlayed(games);
            
            this.isRunning = true;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].farmStatus = 'running';
                accounts[this.config.id].botStatus = 'online';
                saveAccounts(accounts);
            }
        });

        this.client.on('steamGuard', (domain, callback) => {
            console.log(`🔐 Steam Guard запрос для ${this.config.displayName}`);
            this.steamGuardCallback = callback;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'steam_guard';
                accounts[this.config.id].needsGuardCode = true;
                saveAccounts(accounts);
            }
        });

        this.client.on('error', (err) => {
            console.log(`❌ Ошибка бота ${this.config.displayName}:`, err.message);
            this.isRunning = false;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'error';
                accounts[this.config.id].farmStatus = 'stopped';
                accounts[this.config.id].error = err.message;
                saveAccounts(accounts);
            }
        });

        this.client.on('disconnected', () => {
            console.log(`🔌 Бот ${this.config.displayName} отключен`);
            this.isRunning = false;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'offline';
                accounts[this.config.id].farmStatus = 'stopped';
                saveAccounts(accounts);
            }
        });
    }

    submitSteamGuardCode(code) {
        if (this.steamGuardCallback) {
            console.log(`🔐 Отправка Steam Guard кода для ${this.config.displayName}`);
            this.steamGuardCallback(code);
            this.steamGuardCallback = null;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].needsGuardCode = false;
                saveAccounts(accounts);
            }
            return true;
        }
        return false;
    }

    startFarming() {
        if (this.isRunning) return;

        console.log(`🚀 Запуск бота для ${this.config.displayName}...`);
        
        const logOnOptions = {
            accountName: this.config.username,
            password: this.config.password
        };

        if (accounts[this.config.id]) {
            accounts[this.config.id].farmStatus = 'starting';
            accounts[this.config.id].botStatus = 'connecting';
            accounts[this.config.id].error = null;
            saveAccounts(accounts);
        }

        this.client.logOn(logOnOptions);
    }

    stopFarming() {
        if (this.isRunning) {
            console.log(`🛑 Останавливаю фарм для ${this.config.displayName}...`);
            this.client.logOff();
            this.isRunning = false;
            this.steamGuardCallback = null;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].farmStatus = 'stopped';
                accounts[this.config.id].botStatus = 'offline';
                accounts[this.config.id].needsGuardCode = false;
                saveAccounts(accounts);
            }
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            farmStatus: this.isRunning ? 'running' : 'stopped',
            botStatus: accounts[this.config.id]?.botStatus || 'offline',
            needsGuardCode: accounts[this.config.id]?.needsGuardCode || false,
            error: accounts[this.config.id]?.error || null
        };
    }
}

// 🎯 Менеджер ботов
class BotManager {
    constructor() {
        this.bots = new Map();
    }

    createBot(accountConfig) {
        const bot = new SteamFarmBot(accountConfig);
        this.bots.set(accountConfig.id, bot);
        return bot;
    }

    startFarm(accountId) {
        let bot = this.bots.get(accountId);
        if (!bot && accounts[accountId]) {
            bot = this.createBot(accounts[accountId]);
        }
        if (bot) {
            bot.startFarming();
            return true;
        }
        return false;
    }

    stopFarm(accountId) {
        const bot = this.bots.get(accountId);
        if (bot) {
            bot.stopFarming();
            return true;
        }
        return false;
    }

    submitSteamGuardCode(accountId, code) {
        const bot = this.bots.get(accountId);
        if (bot) {
            return bot.submitSteamGuardCode(code);
        }
        return false;
    }

    getStatus(accountId) {
        const bot = this.bots.get(accountId);
        return bot ? bot.getStatus() : {
            isRunning: false,
            farmStatus: 'stopped',
            botStatus: 'offline',
            needsGuardCode: false,
            error: null
        };
    }
}

const botManager = new BotManager();

// 🚀 Express настройки
app.use(express.json());
app.use(express.static('public'));

// 🌐 API Routes
app.get('/', (req, res) => {
    res.send(generateDashboardHTML());
});

app.get('/api/status', (req, res) => {
    Object.keys(accounts).forEach(accountId => {
        const botStatus = botManager.getStatus(accountId);
        if (botStatus) {
            accounts[accountId].farmStatus = botStatus.farmStatus;
            accounts[accountId].botStatus = botStatus.botStatus;
            accounts[accountId].needsGuardCode = botStatus.needsGuardCode;
            accounts[accountId].error = botStatus.error;
        }
    });
    
    saveAccounts(accounts);
    
    res.json({
        accounts: accounts,
        serverTime: new Date()
    });
});

app.post('/api/accounts/add', (req, res) => {
    const { username, password, displayName, steamId, games, guardType } = req.body;
    
    if (!username || !password || !displayName || !steamId) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    const accountId = 'acc_' + Date.now();
    
    accounts[accountId] = {
        id: accountId,
        username,
        password,
        displayName,
        steamId,
        games: games || '730',
        guardType: guardType || 'none',
        farmedHours: '0.0',
        farmStatus: 'stopped',
        botStatus: 'offline',
        needsGuardCode: false
    };

    if (saveAccounts(accounts)) {
        console.log(`✅ Добавлен аккаунт: ${displayName}`);
        res.json({ success: true, message: 'Аккаунт добавлен', accountId });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.post('/api/accounts/delete/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (accounts[accountId]) {
        const accountName = accounts[accountId].displayName;
        botManager.stopFarm(accountId);
        delete accounts[accountId];
        
        if (saveAccounts(accounts)) {
            console.log(`🗑️ Удален аккаунт: ${accountName}`);
            res.json({ success: true, message: 'Аккаунт удален' });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения' });
        }
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

app.post('/api/farm/start/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.startFarm(accountId)) {
        console.log(`🎮 Запущен фарм: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм запущен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

app.post('/api/farm/stop/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.stopFarm(accountId)) {
        console.log(`⏹️ Остановлен фарм: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм остановлен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден' });
    }
});

app.post('/api/steam-guard/:accountId', (req, res) => {
    const { accountId } = req.params;
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Введите код' });
    }
    
    console.log(`🔐 Отправка кода для ${accountId}: ${code}`);
    
    if (botManager.submitSteamGuardCode(accountId, code)) {
        console.log(`✅ Код отправлен для: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Код отправлен' });
    } else {
        res.status(400).json({ error: 'Ошибка отправки кода' });
    }
});

// 🎨 Простой HTML
function generateDashboardHTML() {
    const accountList = Object.values(accounts);
    
    return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Steam Booster</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; background: #0f172a; color: white; padding: 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .header h1 { font-size: 2.5rem; color: #8b5cf6; margin-bottom: 10px; }
            .accounts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
            .account-card { background: #1e293b; padding: 20px; border-radius: 10px; border-left: 4px solid #8b5cf6; }
            .account-header { display: flex; justify-content: space-between; margin-bottom: 15px; }
            .account-name { font-size: 1.3rem; font-weight: bold; }
            .account-status { padding: 5px 10px; border-radius: 5px; font-size: 0.8rem; }
            .status-online { background: #10b981; }
            .status-steam_guard { background: #f59e0b; }
            .status-error { background: #ef4444; }
            .status-offline { background: #6b7280; }
            .account-details { margin-bottom: 15px; }
            .detail-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
            .detail-label { color: #94a3b8; }
            .btn { padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer; margin: 5px; color: white; }
            .btn-success { background: #10b981; }
            .btn-danger { background: #ef4444; }
            .btn-warning { background: #f59e0b; }
            .btn-primary { background: #8b5cf6; }
            .steam-guard-section { background: #f59e0b20; padding: 15px; border-radius: 5px; margin: 10px 0; }
            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); align-items: center; justify-content: center; }
            .modal-content { background: #1e293b; padding: 30px; border-radius: 10px; max-width: 400px; width: 90%; }
            .form-group { margin-bottom: 15px; }
            .form-group input { width: 100%; padding: 10px; border-radius: 5px; border: 1px solid #374151; background: #0f172a; color: white; }
            .notification { position: fixed; top: 20px; right: 20px; padding: 15px; background: #1e293b; border-radius: 5px; transform: translateX(400px); transition: transform 0.3s; }
            .notification.show { transform: translateX(0); }
        </style>
    </head>
    <body>
        <div id="notification" class="notification"></div>
        
        <div id="steamGuardModal" class="modal">
            <div class="modal-content">
                <h3>🔐 Steam Guard код</h3>
                <div id="steamGuardContent"></div>
            </div>
        </div>

        <div class="header">
            <h1>Steam Booster</h1>
            <button class="btn btn-primary" onclick="showAddAccountModal()">+ Добавить аккаунт</button>
        </div>
        
        <div class="accounts-grid" id="accounts-container">
            ${accountList.map(account => `
                <div class="account-card">
                    <div class="account-header">
                        <div class="account-name">${account.displayName}</div>
                        <div class="account-status status-${account.botStatus}">
                            ${account.botStatus === 'steam_guard' ? 'Steam Guard' : 
                              account.botStatus === 'online' ? 'Онлайн' :
                              account.botStatus === 'error' ? 'Ошибка' : 'Оффлайн'}
                        </div>
                    </div>
                    
                    <div class="account-details">
                        <div class="detail-row">
                            <span class="detail-label">Логин:</span>
                            <span>${account.username}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Защита:</span>
                            <span>${account.guardType === 'SGM' ? '📱 Mobile Guard' : account.guardType === 'SGP' ? '📧 Email Guard' : '❌ Нет'}</span>
                        </div>
                        ${account.error ? `
                        <div class="detail-row">
                            <span class="detail-label">Ошибка:</span>
                            <span style="color: #ef4444;">${account.error}</span>
                        </div>
                        ` : ''}
                    </div>
                    
                    ${account.needsGuardCode ? `
                    <div class="steam-guard-section">
                        <p><strong>Требуется Steam Guard код</strong></p>
                        <button class="btn btn-warning" onclick="showSteamGuardModal('${account.id}', '${account.displayName}')" style="width: 100%;">
                            Ввести код
                        </button>
                    </div>
                    ` : ''}
                    
                    <div>
                        ${account.farmStatus === 'running' ? `
                            <button class="btn btn-danger" onclick="stopFarm('${account.id}')">Стоп</button>
                        ` : `
                            <button class="btn btn-success" onclick="startFarm('${account.id}')">Старт</button>
                        `}
                        <button class="btn btn-primary" onclick="updateAccount('${account.id}')">Обновить</button>
                        <button class="btn btn-danger" onclick="deleteAccount('${account.id}')">Удалить</button>
                    </div>
                </div>
            `).join('')}
        </div>

        <script>
            class Dashboard {
                constructor() {
                    this.init();
                }
                
                init() {
                    this.loadData();
                    setInterval(() => this.loadData(), 3000);
                }
                
                async loadData() {
                    try {
                        const response = await fetch('/api/status');
                        const data = await response.json();
                        this.renderAccounts(data.accounts);
                    } catch (error) {
                        this.showNotification('Ошибка загрузки', 'error');
                    }
                }
                
                renderAccounts(accounts) {
                    const container = document.getElementById('accounts-container');
                    const accountsArray = Object.values(accounts);
                    
                    container.innerHTML = accountsArray.map(account => \`
                        <div class="account-card">
                            <div class="account-header">
                                <div class="account-name">\${account.displayName}</div>
                                <div class="account-status status-\${account.botStatus}">
                                    \${account.botStatus === 'steam_guard' ? 'Steam Guard' : 
                                      account.botStatus === 'online' ? 'Онлайн' :
                                      account.botStatus === 'error' ? 'Ошибка' : 'Оффлайн'}
                                </div>
                            </div>
                            
                            <div class="account-details">
                                <div class="detail-row">
                                    <span class="detail-label">Логин:</span>
                                    <span>\${account.username}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">Защита:</span>
                                    <span>\${account.guardType === 'SGM' ? '📱 Mobile Guard' : account.guardType === 'SGP' ? '📧 Email Guard' : '❌ Нет'}</span>
                                </div>
                                \${account.error ? \`
                                <div class="detail-row">
                                    <span class="detail-label">Ошибка:</span>
                                    <span style="color: #ef4444;">\${account.error}</span>
                                </div>
                                \` : ''}
                            </div>
                            
                            \${account.needsGuardCode ? \`
                            <div class="steam-guard-section">
                                <p><strong>Требуется Steam Guard код</strong></p>
                                <button class="btn btn-warning" onclick="showSteamGuardModal('\${account.id}', '\${account.displayName}')" style="width: 100%;">
                                    Ввести код
                                </button>
                            </div>
                            \` : ''}
                            
                            <div>
                                \${account.farmStatus === 'running' ? \`
                                    <button class="btn btn-danger" onclick="stopFarm('\${account.id}')">Стоп</button>
                                \` : \`
                                    <button class="btn btn-success" onclick="startFarm('\${account.id}')">Старт</button>
                                \`}
                                <button class="btn btn-primary" onclick="updateAccount('\${account.id}')">Обновить</button>
                                <button class="btn btn-danger" onclick="deleteAccount('\${account.id}')">Удалить</button>
                            </div>
                        </div>
                    \`).join('');
                }
                
                showNotification(message, type = 'info') {
                    const notification = document.getElementById('notification');
                    notification.textContent = message;
                    notification.className = \`notification \${type} show\`;
                    setTimeout(() => notification.classList.remove('show'), 3000);
                }
            }

            function showSteamGuardModal(accountId, accountName) {
                document.getElementById('steamGuardContent').innerHTML = \`
                    <div class="form-group">
                        <label>Код для \${accountName}:</label>
                        <input type="text" id="steamGuardCode" placeholder="Введите 5-значный код" maxlength="5">
                    </div>
                    <button class="btn btn-warning" onclick="submitSteamGuardCode('\${accountId}')" style="width: 100%;">
                        Подтвердить
                    </button>
                \`;
                document.getElementById('steamGuardModal').style.display = 'flex';
            }

            async function submitSteamGuardCode(accountId) {
                const code = document.getElementById('steamGuardCode').value;
                if (!code) {
                    dashboard.showNotification('Введите код', 'error');
                    return;
                }

                try {
                    const response = await fetch(\`/api/steam-guard/\${accountId}\`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ code })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        dashboard.showNotification('Код отправлен!', 'success');
                        document.getElementById('steamGuardModal').style.display = 'none';
                    } else {
                        dashboard.showNotification(result.error, 'error');
                    }
                } catch (error) {
                    dashboard.showNotification('Ошибка отправки', 'error');
                }
            }

            async function startFarm(accountId) {
                try {
                    const response = await fetch(\`/api/farm/start/\${accountId}\`, {method: 'POST'});
                    const result = await response.json();
                    dashboard.showNotification(result.success ? 'Фарм запущен' : result.error, result.success ? 'success' : 'error');
                } catch (error) {
                    dashboard.showNotification('Ошибка запуска', 'error');
                }
            }

            async function stopFarm(accountId) {
                try {
                    const response = await fetch(\`/api/farm/stop/\${accountId}\`, {method: 'POST'});
                    const result = await response.json();
                    dashboard.showNotification(result.success ? 'Фарм остановлен' : result.error, result.success ? 'success' : 'error');
                } catch (error) {
                    dashboard.showNotification('Ошибка остановки', 'error');
                }
            }

            async function updateAccount(accountId) {
                dashboard.showNotification('Обновлено', 'success');
                dashboard.loadData();
            }

            async function deleteAccount(accountId) {
                if (confirm('Удалить аккаунт?')) {
                    try {
                        const response = await fetch(\`/api/accounts/delete/\${accountId}\`, {method: 'POST'});
                        const result = await response.json();
                        dashboard.showNotification(result.success ? 'Аккаунт удален' : result.error, result.success ? 'success' : 'error');
                        dashboard.loadData();
                    } catch (error) {
                        dashboard.showNotification('Ошибка удаления', 'error');
                    }
                }
            }

            function showAddAccountModal() {
                const username = prompt('Логин Steam:');
                const password = prompt('Пароль Steam:');
                const displayName = prompt('Название на сайте:');
                const steamId = prompt('Steam ID:');
                const guardType = prompt('Тип защиты (SGM - Mobile, SGP - Email, пусто - нет защиты):', '');

                if (username && password && displayName && steamId) {
                    fetch('/api/accounts/add', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            username, 
                            password, 
                            displayName, 
                            steamId, 
                            games: '730',
                            guardType: guardType || 'none'
                        })
                    })
                    .then(r => r.json())
                    .then(result => {
                        alert(result.success ? 'Аккаунт добавлен' : result.error);
                        if (result.success) dashboard.loadData();
                    });
                }
            }

            const dashboard = new Dashboard();

            // Закрытие модального окна
            document.getElementById('steamGuardModal').addEventListener('click', (e) => {
                if (e.target.id === 'steamGuardModal') {
                    e.target.style.display = 'none';
                }
            });
        </script>
    </body>
    </html>
  `;
}

// 🚀 Запуск сервера
console.log('🚀 Запуск Steam Booster...');
console.log('📊 Предустановленные аккаунты:');
console.log('1. точка (tochka_bi_laik) - без защиты');
console.log('2. кинелька (k1nelsteam) - Mobile Steam Guard');

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Откройте http://localhost:${PORT}`);
});
