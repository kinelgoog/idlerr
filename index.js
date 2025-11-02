const express = require('express');
const steamUser = require('steam-user');
const fs = require('fs');
const crypto = require('crypto');
const fetch = require('node-fetch'); 

const app = express();
const PORT = process.env.PORT || 10000;

// =================================================================
// 🚨 КОНФИГУРАЦИЯ БЕЗОПАСНОСТИ И УВЕДОМЛЕНИЙ
// =================================================================
const SECRET_KEY = process.env.SECRET_KEY || 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'; // 32 символа!
const IV_LENGTH = 16; 

if (SECRET_KEY.length !== 32) {
    console.error("⛔ ОШИБКА: SECRET_KEY должен быть ровно 32 символа! Исправьте и перезапустите.");
    process.exit(1);
}

const WEBHOOK_URL = process.env.WEBHOOK_URL || null; 
// =================================================================

// 🔒 Функции шифрования (без изменений)
function encrypt(text) {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(SECRET_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    try {
        let textParts = text.split(':');
        let iv = Buffer.from(textParts.shift(), 'hex');
        let encryptedText = Buffer.from(textParts.join(':'), 'hex');
        let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(SECRET_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        console.error("❌ Ошибка дешифрования.");
        return null;
    }
}

// 🔔 Функция Webhook (без изменений)
function sendNotification(message) {
    const logEntry = `[${new Date().toLocaleTimeString()}] ${message}`;
    console.log(logEntry);
    
    if (WEBHOOK_URL) {
        fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `[Steam Booster] ${message}` })
        }).catch(err => console.error("❌ Ошибка отправки Webhook:", err.message));
    }
}

// 🗄️ Управление данными (без изменений)
const DATA_FILE = './accounts.json';
let accounts = {};
let botInstances = new Map();

function loadAccounts() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            accounts = JSON.parse(data);
            console.log(`✅ Загружено ${Object.keys(accounts).length} аккаунтов.`);
        }
    } catch (error) {
        console.log('❌ Ошибка загрузки/парсинга accounts.json.');
        accounts = {};
    }
}

function saveAccounts() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2));
        return true;
    } catch (error) {
        console.log('❌ Ошибка сохранения аккаунтов:', error.message);
        return false;
    }
}

loadAccounts();

// 🤖 Steam Bot Class
class SteamFarmBot {
    constructor(accountId) {
        this.accountId = accountId;
        this.config = accounts[accountId]; 
        this.client = new steamUser();
        this.isRunning = false;
        this.steamGuardCallback = null; 
        this.retryTimeout = null; // Таймер для авто-рестарта
        this.setupEventHandlers();
    }

    updateAccountStatus(statusUpdate) {
        if (accounts[this.accountId]) {
            Object.assign(accounts[this.accountId], statusUpdate);
            saveAccounts();
        }
    }

    // 📊 Получение часов (без изменений)
    getAndSaveHours() {
        // Убедимся, что games корректно обрабатывается
        const appids = this.config.games.split(' ').map(Number).filter(id => id > 0);
        if (appids.length === 0) {
            console.error(`❌ Нет действительных AppID для ${this.config.displayName}.`);
            return;
        }

        this.client.getOwnedGames({
            appids_filter: appids
        }, (err, games) => {
            if (err) {
                console.error(`❌ Ошибка получения часов для ${this.config.displayName}:`, err.message);
                return;
            }
            
            let totalTime = 0;
            if (games.games) {
                games.games.forEach(game => { totalTime += game.playtime_forever || 0; });
            }
            
            const hours = Math.round(totalTime / 60);

            if (this.config.initialHours === undefined || this.config.initialHours === 0) {
                this.config.initialHours = hours;
            }
            
            this.config.currentHours = hours;
            this.config.farmedHours = hours - (this.config.initialHours || hours);
            
            this.updateAccountStatus({ 
                initialHours: this.config.initialHours,
                currentHours: this.config.currentHours, 
                farmedHours: this.config.farmedHours 
            });
        });
    }

    setupEventHandlers() {
        this.client.on('loggedOn', () => {
            sendNotification(`✅ Бот ${this.config.displayName} успешно вошел в систему и начинает фарм.`);
            
            const games = this.config.games.split(' ').map(Number).filter(id => id > 0);
            this.client.setPersona(1); // Статус "В сети"
            this.client.gamesPlayed(games);
            
            this.isRunning = true;
            this.steamGuardCallback = null; 
            this.clearRetry(); 
            this.updateAccountStatus({ farmStatus: 'running', botStatus: 'online', error: null, needsGuardCode: false });
            
            this.getAndSaveHours();
        });

        this.client.on('steamGuard', (domain, callback) => {
            sendNotification(`🔔 ${this.config.displayName}: ТРЕБУЕТСЯ ВВОД STEAM GUARD КОДА.`);
            
            this.steamGuardCallback = callback; 
            
            this.updateAccountStatus({ 
                botStatus: 'steam_guard', 
                needsGuardCode: true, 
                error: 'Требуется ввод кода Steam Guard (TOTP) из приложения',
                farmStatus: 'stopped' 
            });
        });
        
        // 🌟 ИСПРАВЛЕННАЯ ЛОГИКА ОШИБОК 🌟
        this.client.on('error', (err) => {
            let errorMessage = err.message;
            let canRetry = true; 

            if (err.eresult === steamUser.EResult.RateLimitExceeded) {
                errorMessage = "RateLimitExceeded. Слишком много попыток. Ждем 5 мин.";
            } else if (err.eresult === steamUser.EResult.InvalidPassword) {
                errorMessage = "Неверный пароль. Фарм остановлен.";
                canRetry = false; 
            } else if (err.eresult === steamUser.EResult.InvalidLoginAuthCode) {
                errorMessage = "Неверный код Steam Guard. Попробуйте снова.";
                canRetry = false; 
            } else {
                errorMessage = `Общая ошибка Steam: ${errorMessage}`;
            }
            
            const fullErrorMessage = `❌ Ошибка ${this.config.displayName}: ${errorMessage}`;
            sendNotification(fullErrorMessage);
            
            this.isRunning = false;
            this.steamGuardCallback = null; 
            this.updateAccountStatus({ 
                botStatus: 'error', 
                farmStatus: 'stopped', 
                error: errorMessage, 
                needsGuardCode: false 
            });
            
            // 🛡️ АВТОМАТИЧЕСКИЙ ПЕРЕЗАПУСК (Кулдаун 5 мин)
            if (canRetry && !this.retryTimeout) {
                sendNotification(`🔄 ${this.config.displayName}: Попытка перезапуска через 5 минут.`);
                this.retryTimeout = setTimeout(() => {
                    this.clearRetry();
                    if (accounts[this.accountId]) { 
                        this.startFarming(); 
                    }
                }, 5 * 60 * 1000); 
            }
        });

        this.client.on('disconnected', () => {
            sendNotification(`🔌 Бот ${this.config.displayName} отключен.`);
            this.isRunning = false;
            this.steamGuardCallback = null; 
            // Не переводим в оффлайн, если бот находится на Retry-кулдауне
            if (!this.retryTimeout) {
                this.updateAccountStatus({ botStatus: 'offline', farmStatus: 'stopped', needsGuardCode: false });
            }
        });
    }

    clearRetry() {
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
    }

    submitSteamGuardCode(code) {
        if (this.steamGuardCallback) {
            sendNotification(`🔑 ${this.config.displayName}: Код SGM введен, вход продолжается.`);
            this.steamGuardCallback(code); 
            this.steamGuardCallback = null; 
            this.updateAccountStatus({ botStatus: 'connecting', needsGuardCode: false, error: null, farmStatus: 'starting' });
            return true;
        }
        return false;
    }

    startFarming() {
        if (this.isRunning || !this.config || this.steamGuardCallback || this.retryTimeout) {
             if(this.retryTimeout) console.log(`[${this.config.displayName}] Попытка запуска во время кулдауна. Отклонено.`);
             return false;
        }

        const decryptedPassword = decrypt(this.config.password);
        if (!decryptedPassword) {
             this.updateAccountStatus({ botStatus: 'error', farmStatus: 'stopped', error: 'Ошибка дешифрования пароля.' });
             return false;
        }
        
        this.clearRetry(); 
        this.updateAccountStatus({ farmStatus: 'starting', botStatus: 'connecting', error: null });
        this.client.logOn({
            accountName: this.config.username,
            password: decryptedPassword
        });
        return true;
    }

    stopFarming() {
        if (this.isRunning || this.steamGuardCallback || this.retryTimeout) {
            sendNotification(`🛑 Останавливаю фарм для ${this.config.displayName}.`);
            this.client.logOff();
            this.clearRetry(); 
            this.isRunning = false;
            this.steamGuardCallback = null;
            return true;
        }
        return false;
    }
}

// 🎯 Менеджер ботов (без изменений)
class BotManager {
    startFarm(accountId) {
        let bot = botInstances.get(accountId);
        if (!bot && accounts[accountId]) {
            bot = new SteamFarmBot(accountId);
            botInstances.set(accountId, bot);
        }
        if (bot) { return bot.startFarming(); }
        return false;
    }

    stopFarm(accountId) {
        const bot = botInstances.get(accountId);
        if (bot) {
            const success = bot.stopFarming();
            // Не удаляем инстанс, если бот в статусе error и на retryTimeout
            if (bot.retryTimeout === null) {
                botInstances.delete(accountId);
            }
            
            if (accounts[accountId]) {
                accounts[accountId].botStatus = 'offline';
                accounts[accountId].farmStatus = 'stopped';
                accounts[accountId].needsGuardCode = false;
                accounts[accountId].error = null;
                saveAccounts();
            }
            return success;
        }
        return false;
    }
    
    startAll() {
        Object.keys(accounts).forEach(id => this.startFarm(id));
        return true;
    }

    stopAll() {
        botInstances.forEach(bot => bot.stopFarming());
        Object.keys(accounts).forEach(id => {
            if (accounts[id].botStatus !== 'offline') {
                accounts[id].botStatus = 'offline';
                accounts[id].farmStatus = 'stopped';
                accounts[id].needsGuardCode = false;
                accounts[id].error = null;
            }
        });
        botInstances.clear();
        saveAccounts();
        return true;
    }

    submitSteamGuardCode(accountId, code) {
        const bot = botInstances.get(accountId);
        if (bot) { return bot.submitSteamGuardCode(code); }
        return false;
    }

    addAccount(username, password, games) {
        const accountId = 'acc_' + Date.now();
        const displayName = username.split('@')[0];
        const encryptedPassword = encrypt(password);

        const newAccount = {
            id: accountId, username: username, password: encryptedPassword, 
            displayName: displayName, games: games || '730', guardType: 'SGM', 
            botStatus: 'offline', farmStatus: 'stopped', error: null, needsGuardCode: false,
            initialHours: 0, currentHours: 0, farmedHours: 0
        };

        accounts[accountId] = newAccount;
        saveAccounts();
        sendNotification(`➕ Новый аккаунт ${displayName} добавлен.`);
        return newAccount;
    }

    deleteAccount(accountId) {
        if (botInstances.has(accountId)) {
            this.stopFarm(accountId);
            botInstances.delete(accountId); // Удаляем инстанс после остановки
        }
        if (accounts[accountId]) {
            const displayName = accounts[accountId].displayName;
            delete accounts[accountId];
            saveAccounts();
            sendNotification(`🗑️ Аккаунт ${displayName} удален.`);
            return true;
        }
        return false;
    }
}

// 🌐 API Routes 
const botManager = new BotManager();
app.use(express.json());
app.use(express.static('public')); 

app.get('/api/status', (req, res) => {
    const safeAccounts = Object.keys(accounts).reduce((acc, id) => {
        // Добавляем информацию о кулдауне
        const bot = botInstances.get(id);
        const onCooldown = bot ? (bot.retryTimeout !== null) : false;
        
        const { password, ...rest } = accounts[id];
        acc[id] = { ...rest, onCooldown: onCooldown }; // Передаем статус кулдауна
        return acc;
    }, {});
    res.json({ accounts: safeAccounts, serverTime: new Date() });
});

app.post('/api/accounts/add', (req, res) => {
    const { username, password, games } = req.body;
    if (!username || !password || !games) {
        return res.status(400).json({ error: 'Необходимы логин, пароль и список игр.' });
    }
    const newAccount = botManager.addAccount(username, password, games);
    res.json({ success: true, message: 'Аккаунт добавлен и зашифрован.', accountId: newAccount.id });
});

// ✅ ИСПРАВЛЕННЫЙ МАРШРУТ (строка 392 в старом коде)
app.post('/api/accounts/delete/:accountId', (req, res) => {
    const { accountId } = req.params; // <-- ИСПРАВЛЕНО
    if (botManager.deleteAccount(accountId)) {
        res.json({ success: true, message: 'Аккаунт удален и остановлен.' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден.' });
    }
});

// ✅ ИСПРАВЛЕННЫЙ МАРШРУТ
app.post('/api/farm/start/:accountId', (req, res) => {
    const { accountId } = req.params; // <-- ИСПРАВЛЕНО
    if (botManager.startFarm(accountId)) {
        res.json({ success: true, message: 'Фарм запущен' });
    } else {
        res.status(400).json({ error: 'Аккаунт не найден, уже запущен или на кулдауне.' });
    }
});

// ✅ ИСПРАВЛЕННЫЙ МАРШРУТ
app.post('/api/farm/stop/:accountId', (req, res) => {
    const { accountId } = req.params; // <-- ИСПРАВЛЕНО
    if (botManager.stopFarm(accountId)) {
        res.json({ success: true, message: 'Фарм остановлен' });
    } else {
        res.status(404).json({ error: 'Аккаунт не найден.' });
    }
});

// ✅ ИСПРАВЛЕННЫЙ МАРШРУТ
app.post('/api/steam-guard/:accountId', (req, res) => {
    const { accountId } = req.params; // <-- ИСПРАВЛЕНО
    const { code } = req.body;
    if (!code) { return res.status(400).json({ error: 'Введите код' }); }
    if (botManager.submitSteamGuardCode(accountId, code)) {
        res.json({ success: true, message: 'Код отправлен.' });
    } else {
        res.status(400).json({ error: 'Ошибка отправки кода.' });
    }
});

app.post('/api/farm/startAll', (req, res) => {
    botManager.startAll();
    res.json({ success: true, message: 'Запущены все доступные аккаунты.' });
});

app.post('/api/farm/stopAll', (req, res) => {
    botManager.stopAll();
    res.json({ success: true, message: 'Остановлены все активные аккаунты.' });
});

// 🚀 Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Steam Booster ULTIMATE запущен на порту ${PORT}`);
    console.log(`🌐 Откройте http://localhost:${PORT}`);
    sendNotification(`🚀 Сервер Steam Booster ULTIMATE запущен и готов к работе.`);
});
