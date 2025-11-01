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
        console.log('❌ Ошибка загрузки аккаунтов, используем предустановленные.');
    }
    return DEFAULT_ACCOUNTS;
}

function saveAccounts(accounts) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2));
        return true;
    } catch (error) {
        console.log('❌ Ошибка сохранения аккаунтов.');
        return false;
    }
}

let accounts = loadAccounts();

// 🤖 Класс Steam Farm Bot
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
            console.log(`✅ Бот ${this.config.displayName} вошёл в систему.`);
            
            const games = this.config.games.split(' ').map(g => parseInt(g)).filter(g => !isNaN(g));
            this.client.setPersona(steamUser.EPersonaState.Online);
            this.client.gamesPlayed(games);
            
            this.isRunning = true;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].farmStatus = 'running';
                accounts[this.config.id].botStatus = 'online';
                saveAccounts(accounts);
            }
        });

        this.client.on('steamGuard', (domain, callback) => {
            console.log(`🔐 Steam Guard запрос для ${this.config.displayName}.`);
            this.steamGuardCallback = callback;
            
            if (accounts[this.config.id]) {
                accounts[this.config.id].botStatus = 'steam_guard';
                accounts[this.config.id].needsGuardCode = true;
                saveAccounts(accounts);
            }

            // Небольшая пауза перед повторной попыткой
            setTimeout(() => {
                if (this.steamGuardCallback) {
                    console.log("Проверка Steam Guard после задержки.");
                }
            }, 30000); // Пауза в 30 секунд
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
            console.log(`🔌 Бот ${this.config.displayName} отключён.`);
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
            console.log(`🔐 Отправка Steam Guard кода для ${this.config.displayName}.`);
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

// 🚀 Express настройка
app.use(express.json());
app.use(express.static('public'));

// 🌐 API маршруты
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
        return res.status(400).json({ error: 'Все поля обязательны.' });
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
        res.json({ success: true, message: 'Аккаунт добавлен.', accountId });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения.' });
    }
});

app.post('/api/accounts/delete/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (accounts[accountId]) {
        const accountName = accounts[accountId].displayName;
        botManager.stopFarm(accountId);
        delete accounts[accountId];
        
        if (saveAccounts(accounts)) {
            console.log(`🗑️ Удалён аккаунт: ${accountName}`);
            res.json({ success: true, message: 'Аккаунт удалён.' });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения.' });
        }
    } else {
        res.status(404).json({ error: 'Аккаунт не найден.' });
    }
});

app.post('/api/farm/start/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.startFarm(accountId)) {
        console.log(`🎮 Запущено: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм запущен.' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден.' });
    }
});

app.post('/api/farm/stop/:accountId', (req, res) => {
    const { accountId } = req.params;
    
    if (botManager.stopFarm(accountId)) {
        console.log(`⏹️ Остановлено: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Фарм остановлен.' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден.' });
    }
});

app.post('/api/steam-guard/:accountId', (req, res) => {
    const { accountId } = req.params;
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Введите код.' });
    }
    
    console.log(`🔐 Отправка кода для ${accountId}: ${code}`);
    
    if (botManager.submitSteamGuardCode(accountId, code)) {
        console.log(`✅ Код отправлен для: ${accounts[accountId]?.displayName}`);
        res.json({ success: true, message: 'Код отправлен.' });
    } else {
        res.status(400).json({ error: 'Ошибка отправки кода.' });
    }
});

// 🎨 Генерация полноценного HTML-дашборда
function generateDashboardHTML() {
    return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Steam Farm Booster</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: #333;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
            color: white;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        .dashboard {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            margin-bottom: 30px;
        }
        
        .section-title {
            font-size: 1.5rem;
            margin-bottom: 20px;
            color: #2a5298;
            border-bottom: 2px solid #eee;
            padding-bottom: 10px;
        }
        
        .accounts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .account-card {
            border: 1px solid #e0e0e0;
            border-radius: 10px;
            padding: 20px;
            background: #fafafa;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .account-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        
        .account-header {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-bottom: 15px;
        }
        
        .account-name {
            font-size: 1.3rem;
            font-weight: bold;
            color: #2a5298;
        }
        
        .account-status {
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: bold;
        }
        
        .status-online { background: #d4edda; color: #155724; }
        .status-offline { background: #f8d7da; color: #721c24; }
        .status-steam_guard { background: #fff3cd; color: #856404; }
        .status-error { background: #f8d7da; color: #721c24; }
        .status-connecting { background: #cce7ff; color: #004085; }
        
        .account-info {
            margin-bottom: 15px;
        }
        
        .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            padding: 5px 0;
            border-bottom: 1px solid #eee;
        }
        
        .info-label {
            font-weight: bold;
            color: #666;
        }
        
        .controls {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        
        .btn {
            padding: 10px 15px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s ease;
            flex: 1;
        }
        
        .btn-start {
            background: #28a745;
            color: white;
        }
        
        .btn-start:hover {
            background: #218838;
        }
        
        .btn-stop {
            background: #dc3545;
            color: white;
        }
        
        .btn-stop:hover {
            background: #c82333;
        }
        
        .btn-delete {
            background: #6c757d;
            color: white;
        }
        
        .btn-delete:hover {
            background: #545b62;
        }
        
        .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        
        .steam-guard-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        
        .modal-content {
            background: white;
            padding: 30px;
            border-radius: 10px;
            width: 400px;
            max-width: 90%;
        }
        
        .modal-title {
            font-size: 1.3rem;
            margin-bottom: 15px;
            color: #2a5298;
        }
        
        .input-group {
            margin-bottom: 20px;
        }
        
        .input-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        
        .input-group input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 1rem;
        }
        
        .modal-buttons {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
        
        .btn-cancel {
            background: #6c757d;
            color: white;
        }
        
        .btn-submit {
            background: #007bff;
            color: white;
        }
        
        .add-account-form {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
        }
        
        .form-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 15px;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
        }
        
        .form-group label {
            margin-bottom: 5px;
            font-weight: bold;
            color: #555;
        }
        
        .form-group input, .form-group select {
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 1rem;
        }
        
        .btn-add {
            background: #17a2b8;
            color: white;
            padding: 12px 25px;
        }
        
        .btn-add:hover {
            background: #138496;
        }
        
        .loading {
            text-align: center;
            padding: 20px;
            color: #666;
        }
        
        .error-message {
            background: #f8d7da;
            color: #721c24;
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
            border: 1px solid #f5c6cb;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Steam Farm Booster</h1>
            <p>Управление ботами для фарма часов в Steam</p>
        </div>
        
        <div class="dashboard">
            <h2 class="section-title">📊 Аккаунты</h2>
            <div id="accountsContainer" class="accounts-grid">
                <div class="loading">Загрузка аккаунтов...</div>
            </div>
            
            <h2 class="section-title">➕ Добавить аккаунт</h2>
            <div class="add-account-form">
                <div class="form-grid">
                    <div class="form-group">
                        <label for="username">Логин Steam *</label>
                        <input type="text" id="username" placeholder="Введите логин" required>
                    </div>
                    <div class="form-group">
                        <label for="password">Пароль *</label>
                        <input type="password" id="password" placeholder="Введите пароль" required>
                    </div>
                    <div class="form-group">
                        <label for="displayName">Имя аккаунта *</label>
                        <input type="text" id="displayName" placeholder="Отображаемое имя" required>
                    </div>
                    <div class="form-group">
                        <label for="steamId">Steam ID *</label>
                        <input type="text" id="steamId" placeholder="Steam ID64" required>
                    </div>
                    <div class="form-group">
                        <label for="games">ID игр</label>
                        <input type="text" id="games" placeholder="730 570 440" value="730">
                    </div>
                    <div class="form-group">
                        <label for="guardType">Тип защиты</label>
                        <select id="guardType">
                            <option value="none">Без защиты</option>
                            <option value="SGM">Steam Guard Mobile</option>
                        </select>
                    </div>
                </div>
                <button class="btn btn-add" onclick="addAccount()">Добавить аккаунт</button>
            </div>
        </div>
    </div>
    
    <!-- Модальное окно для Steam Guard -->
    <div id="steamGuardModal" class="steam-guard-modal">
        <div class="modal-content">
            <h3 class="modal-title">🔐 Steam Guard код</h3>
            <p>Введите код из приложения Steam Guard для аккаунта <span id="guardAccountName"></span>:</p>
            <div class="input-group">
                <label for="guardCode">Код:</label>
                <input type="text" id="guardCode" placeholder="Введите 5-значный код" maxlength="5">
            </div>
            <div class="modal-buttons">
                <button class="btn btn-cancel" onclick="closeSteamGuardModal()">Отмена</button>
                <button class="btn btn-submit" onclick="submitSteamGuardCode()">Отправить</button>
            </div>
        </div>
    </div>
    
    <script>
        let currentGuardAccountId = null;
        let accountsData = {};
        
        // Загрузка статуса аккаунтов
        async function loadStatus() {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                accountsData = data.accounts;
                renderAccounts();
            } catch (error) {
                console.error('Ошибка загрузки статуса:', error);
            }
        }
        
        // Отображение аккаунтов
        function renderAccounts() {
            const container = document.getElementById('accountsContainer');
            
            if (!accountsData || Object.keys(accountsData).length === 0) {
                container.innerHTML = '<div class="loading">Нет аккаунтов для отображения</div>';
                return;
            }
            
            container.innerHTML = Object.values(accountsData).map(account => \`
                <div class="account-card">
                    <div class="account-header">
                        <div class="account-name">\${account.displayName}</div>
                        <div class="account-status status-\${account.botStatus}">\${getStatusText(account.botStatus)}</div>
                    </div>
                    
                    <div class="account-info">
                        <div class="info-row">
                            <span class="info-label">Логин:</span>
                            <span>\${account.username}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Steam ID:</span>
                            <span>\${account.steamId}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Игры:</span>
                            <span>\${account.games}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Защита:</span>
                            <span>\${account.guardType === 'SGM' ? 'Mobile' : 'Нет'}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Фарм часов:</span>
                            <span>\${account.farmedHours}</span>
                        </div>
                    </div>
                    
                    \${account.error ? \`
                        <div class="error-message">
                            Ошибка: \${account.error}
                        </div>
                    \` : ''}
                    
                    <div class="controls">
                        <button class="btn btn-start" 
                                onclick="startFarm('\${account.id}')"
                                \${account.farmStatus === 'running' ? 'disabled' : ''}>
                            \${account.farmStatus === 'running' ? 'Запущен' : 'Запустить'}
                        </button>
                        <button class="btn btn-stop" 
                                onclick="stopFarm('\${account.id}')"
                                \${account.farmStatus !== 'running' ? 'disabled' : ''}>
                            Остановить
                        </button>
                        <button class="btn btn-delete" onclick="deleteAccount('\${account.id}')">
                            Удалить
                        </button>
                    </div>
                    
                    \${account.needsGuardCode ? \`
                        <div style="margin-top: 10px;">
                            <button class="btn" onclick="openSteamGuardModal('\${account.id}', '\${account.displayName}')" 
                                    style="background: #ffc107; color: #000; width: 100%;">
                                🔐 Ввести Steam Guard код
                            </button>
                        </div>
                    \` : ''}
                </div>
            \`).join('');
        }
        
        // Текстовое представление статуса
        function getStatusText(status) {
            const statusMap = {
                'online': 'Онлайн',
                'offline': 'Оффлайн',
                'steam_guard': 'Требуется код',
                'error': 'Ошибка',
                'connecting': 'Подключение'
            };
            return statusMap[status] || status;
        }
        
        // Управление фармом
        async function startFarm(accountId) {
            try {
                const response = await fetch(\`/api/farm/start/\${accountId}\`, {
                    method: 'POST'
                });
                const result = await response.json();
                
                if (result.success) {
                    loadStatus();
                } else {
                    alert('Ошибка: ' + result.error);
                }
            } catch (error) {
                alert('Ошибка запуска фарма: ' + error.message);
            }
        }
        
        async function stopFarm(accountId) {
            try {
                const response = await fetch(\`/api/farm/stop/\${accountId}\`, {
                    method: 'POST'
                });
                const result = await response.json();
                
                if (result.success) {
                    loadStatus();
                } else {
                    alert('Ошибка: ' + result.error);
                }
            } catch (error) {
                alert('Ошибка остановки фарма: ' + error.message);
            }
        }
        
        // Добавление аккаунта
        async function addAccount() {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const displayName = document.getElementById('displayName').value;
            const steamId = document.getElementById('steamId').value;
            const games = document.getElementById('games').value;
            const guardType = document.getElementById('guardType').value;
            
            if (!username || !password || !displayName || !steamId) {
                alert('Пожалуйста, заполните все обязательные поля (отмечены *)');
                return;
            }
            
            try {
                const response = await fetch('/api/accounts/add', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        username,
                        password,
                        displayName,
                        steamId,
                        games,
                        guardType
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Очистка формы
                    document.getElementById('username').value = '';
                    document.getElementById('password').value = '';
                    document.getElementById('displayName').value = '';
                    document.getElementById('steamId').value = '';
                    document.getElementById('games').value = '730';
                    
                    loadStatus();
                    alert('Аккаунт успешно добавлен!');
                } else {
                    alert('Ошибка: ' + result.error);
                }
            } catch (error) {
                alert('Ошибка добавления аккаунта: ' + error.message);
            }
        }
        
        // Удаление аккаунта
        async function deleteAccount(accountId) {
            if (!confirm('Вы уверены, что хотите удалить этот аккаунт?')) {
                return;
            }
            
            try {
                const response = await fetch(\`/api/accounts/delete/\${accountId}\`, {
                    method: 'POST'
                });
                
                const result = await response.json();
                
                if (result.success) {
                    loadStatus();
                } else {
                    alert('Ошибка: ' + result.error);
                }
            } catch (error) {
                alert('Ошибка удаления аккаунта: ' + error.message);
            }
        }
        
        // Steam Guard модальное окно
        function openSteamGuardModal(accountId, accountName) {
            currentGuardAccountId = accountId;
            document.getElementById('guardAccountName').textContent = accountName;
            document.getElementById('steamGuardModal').style.display = 'flex';
            document.getElementById('guardCode').focus();
        }
        
        function closeSteamGuardModal() {
            document.getElementById('steamGuardModal').style.display = 'none';
            currentGuardAccountId = null;
            document.getElementById('guardCode').value = '';
        }
        
        async function submitSteamGuardCode() {
            const code = document.getElementById('guardCode').value;
            
            if (!code || code.length !== 5) {
                alert('Пожалуйста, введите 5-значный код');
                return;
            }
            
            try {
                const response = await fetch(\`/api/steam-guard/\${currentGuardAccountId}\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ code })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    closeSteamGuardModal();
                    loadStatus();
                    alert('Код успешно отправлен!');
                } else {
                    alert('Ошибка: ' + result.error);
                }
            } catch (error) {
                alert('Ошибка отправки кода: ' + error.message);
            }
        }
        
        // Закрытие модального окна по клику вне его
        document.getElementById('steamGuardModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeSteamGuardModal();
            }
        });
        
        // Enter для отправки кода Steam Guard
        document.getElementById('guardCode').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                submitSteamGuardCode();
            }
        });
        
        // Автообновление статуса каждые 5 секунд
        loadStatus();
        setInterval(loadStatus, 5000);
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
