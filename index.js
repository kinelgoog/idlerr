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

// 🎨 Генерация простого HTML-дашборда
function generateDashboardHTML() {
    const accountList = Object.values(accounts);
    
    return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <!-- Остальные стили и скрипты остаются прежними -->
    </head>
    <body>
        <!-- Оставшаяся структура страницы остаётся прежней -->
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
