class Dashboard {
    constructor() {
        this.allAccounts = {}; // Кэш для всех аккаунтов
        this.init();
    }
    
    init() {
        // Загружаем данные каждые 3 секунды
        this.loadData();
        setInterval(() => this.loadData(), 3000); 
        
        this.setupFormListener();
        
        // Листенер для поиска
        document.getElementById('searchBox').addEventListener('keyup', (e) => {
            this.filterAndRender(e.target.value.toLowerCase());
        });
    }
    
    setupFormListener() {
        document.getElementById('addAccountForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const games = document.getElementById('games').value;
            
            try {
                const response = await fetch('/api/accounts/add', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ username, password, games })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    this.showNotification('Аккаунт успешно добавлен!', 'success');
                    closeModal('addAccountModal');
                    document.getElementById('addAccountForm').reset();
                    this.loadData(); // Немедленно обновить
                } else {
                    this.showNotification(result.error || 'Ошибка.', 'error');
                }
            } catch (error) {
                this.showNotification('Ошибка сети', 'error');
            }
        });
    }

    async loadData() {
        try {
            const response = await fetch('/api/status');
            if (!response.ok) throw new Error('Failed to fetch status');
            const data = await response.json();
            this.allAccounts = data.accounts; // Сохраняем в кэш
            const searchTerm = document.getElementById('searchBox').value.toLowerCase();
            this.filterAndRender(searchTerm); // Перерисовываем
        } catch (error) {
            this.showNotification('Ошибка загрузки статуса', 'error');
        }
    }

    // НОВАЯ ЛОГИКА: Фильтрация и рендеринг
    filterAndRender(searchTerm = '') {
        const accountsArray = Object.values(this.allAccounts);
        
        const filtered = accountsArray.filter(acc => 
            acc.displayName.toLowerCase().includes(searchTerm) || 
            acc.username.toLowerCase().includes(searchTerm)
        );
        
        this.renderAccounts(filtered);
    }
    
    // НОВАЯ ЛОГИКА: Разделение на группы
    renderAccounts(accounts) {
        const groups = {
            attention: document.getElementById('group-attention'),
            online: document.getElementById('group-online'),
            offline: document.getElementById('group-offline'),
        };
        
        // Очистка
        Object.values(groups).forEach(group => group.innerHTML = '');

        accounts.forEach(account => {
            const cardHTML = this.createAccountCardHTML(account);
            
            // Распределение по группам
            if (account.botStatus === 'steam_guard' || account.botStatus === 'error') {
                groups.attention.innerHTML += cardHTML;
            } else if (account.botStatus === 'online' || account.botStatus === 'connecting' || account.botStatus === 'starting') {
                groups.online.innerHTML += cardHTML;
            } else {
                groups.offline.innerHTML += cardHTML;
            }
        });
    }
    
    // НОВАЯ ЛОГИКА: Генерация карточки
    createAccountCardHTML(account) {
        const firstAppId = account.games.split(' ')[0];
        const coverUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${firstAppId}/header.jpg`;
        
        // Логика прогресс-бара: показывает прогресс до следующих 100 часов
        const farmedHours = account.farmedHours || 0;
        const progressPercent = (farmedHours % 100); 

        return `
            <div class="account-card card-status-${account.botStatus}" data-id="${account.id}">
                <div class="card-game-cover" style="background-image: url('${coverUrl}')"></div>
                
                <div class="card-content">
                    <div class="account-header">
                        <div class="account-name">${account.displayName}</div>
                        <div class="account-status status-${account.botStatus}">
                            ${this.formatStatus(account.botStatus)}
                        </div>
                    </div>
                    
                    <div class="account-details">
                        <div class="detail-row">
                            <span class="detail-label">Логин:</span>
                            <span class="detail-value">${account.username}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Игры (APPID):</span>
                            <span class="detail-value">${account.games}</span>
                        </div>
                        ${account.error ? `
                        <div class="detail-row">
                            <span class="detail-label">Ошибка:</span>
                            <span class="detail-value" style="color: #ef4444; font-size: 0.8em;">${account.error}</span>
                        </div>
                        ` : ''}
                    </div>
                    
                    ${account.needsGuardCode ? `
                    <div class="steam-guard-section">
                        <button class="btn btn-warning" onclick="showSteamGuardModal('${account.id}', '${account.displayName}')" style="width: 100%;">
                            🔐 Ввести Steam Guard код
                        </button>
                    </div>
                    ` : ''}
                    
                    <div class="analytics">
                        <div class="analytics-item detail-row">
                            <span class="detail-label">Нафармлено:</span>
                            <span class="detail-value" style="color: #a78bfa;">${farmedHours} ч.</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-bar-inner" style="width: ${progressPercent}%;"></div>
                        </div>
                        <div class="analytics-item detail-row" style="font-size: 0.8em; margin-top: 5px;">
                            <span class="detail-label">Всего часов: ${account.currentHours || 0}</span>
                            <span class="detail-label">До цели: ${100 - progressPercent} ч.</span>
                        </div>
                    </div>
                    
                    <div class="account-actions" style="margin-top: 20px;">
                        ${account.farmStatus === 'running' || account.botStatus === 'connecting' || account.botStatus === 'starting' || account.botStatus === 'steam_guard' ? `
                            <button class="btn btn-danger" onclick="stopFarm('${account.id}')">⏹️ Стоп</button>
                        ` : `
                            <button class="btn btn-success" onclick="startFarm('${account.id}')">▶️ Старт</button>
                        `}
                        <button class="btn btn-close" onclick="deleteAccount('${account.id}')">🗑️ Удалить</button>
                    </div>
                </div>
            </div>
        `;
    }

    // НОВАЯ ЛОГИКА: Статусы с иконками
    formatStatus(status) {
        switch (status) {
            case 'online': return '<span>✅</span> Онлайн';
            case 'steam_guard': return '<span>⚠️</span> Ждет Код';
            case 'error': return '<span>❌</span> Ошибка';
            case 'connecting': return '<span>🔄</span> Соединение';
            case 'starting': return '<span>🔄</span> Запуск';
            default: return '<span>🛑</span> Оффлайн';
        }
    }
    
    formatGuardType(type) { /* Эта функция больше не используется, но может пригодиться */ }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        setTimeout(() => notification.classList.remove('show'), 3000);
    }
}

// Global functions
const dashboard = new Dashboard();

function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// Функции API (startAll, stopAll, deleteAccount, startFarm, stopFarm, showSteamGuardModal, submitSteamGuardCode)
// (Остаются такими же, как в предыдущем ответе. Я скопирую их для полноты.)

async function startAll() {
    try {
        const response = await fetch('/api/farm/startAll', {method: 'POST'});
        const result = await response.json();
        dashboard.showNotification(result.message, 'success');
    } catch (error) {
        dashboard.showNotification('Ошибка при запуске всех аккаунтов', 'error');
    }
}

async function stopAll() {
    try {
        const response = await fetch('/api/farm/stopAll', {method: 'POST'});
        const result = await response.json();
        dashboard.showNotification(result.message, 'success');
    } catch (error) {
        dashboard.showNotification('Ошибка при остановке всех аккаунтов', 'error');
    }
}

async function deleteAccount(accountId) {
    if (!confirm('Вы уверены, что хотите удалить этот аккаунт? Он будет навсегда удален с сервера.')) {
        return;
    }
    try {
        const response = await fetch(`/api/accounts/delete/${accountId}`, {method: 'POST'});
        const result = await response.json();
        dashboard.showNotification(result.success ? 'Аккаунт удален' : result.error, result.success ? 'success' : 'error');
        dashboard.loadData();
    } catch (error) {
        dashboard.showNotification('Ошибка удаления', 'error');
    }
}

async function startFarm(accountId) {
    try {
        const response = await fetch(`/api/farm/start/${accountId}`, {method: 'POST'});
        const result = await response.json();
        dashboard.showNotification(result.success ? 'Фарм запущен' : result.error, result.success ? 'success' : 'error');
    } catch (error) {
        dashboard.showNotification('Ошибка запуска', 'error');
    }
}

async function stopFarm(accountId) {
    try {
        const response = await fetch(`/api/farm/stop/${accountId}`, {method: 'POST'});
        const result = await response.json();
        dashboard.showNotification(result.success ? 'Фарм остановлен' : result.error, result.success ? 'success' : 'error');
    } catch (error) {
        dashboard.showNotification('Ошибка остановки', 'error');
    }
}

async function showSteamGuardModal(accountId, accountName) {
    document.getElementById('steamGuardContent').innerHTML = `
        <p>Для аккаунта <strong>${accountName}</strong> введите 5-значный код из мобильного приложения Steam Guard.</p>
        <div class="form-group">
            <input type="text" id="steamGuardCode" placeholder="Введите 5-значный код" maxlength="5">
        </div>
        <button class="btn btn-warning" onclick="submitSteamGuardCode('${accountId}')" style="width: 100%;">
            Подтвердить
        </button>
    `;
    showModal('steamGuardModal');
}

async function submitSteamGuardCode(accountId) {
    const code = document.getElementById('steamGuardCode').value;
    if (!code) {
        dashboard.showNotification('Введите код', 'error');
        return;
    }
    try {
        const response = await fetch(`/api/steam-guard/${accountId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ code })
        });
        const result = await response.json();
        if (result.success) {
            dashboard.showNotification('Код отправлен! Ожидайте входа...', 'success');
            closeModal('steamGuardModal');
        } else {
            dashboard.showNotification(result.error || 'Ошибка', 'error');
        }
    } catch (error) {
        dashboard.showNotification('Ошибка сети', 'error');
    }
}

// Закрытие модального окна по клику вне его области
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
});
