class Dashboard {
    constructor() {
        this.allAccounts = {}; // Кэш для всех аккаунтов
        this.init();
    }
    
    init() {
        this.loadData();
        setInterval(() => this.loadData(), 3000); // Обновление каждые 3 сек
        
        this.setupFormListener();
        
        document.getElementById('searchBox').addEventListener('input', (e) => {
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
            // this.showNotification('Ошибка загрузки статуса', 'error');
            console.error("Ошибка загрузки статуса:", error.message);
        }
    }

    // Фильтрация и рендеринг
    filterAndRender(searchTerm = '') {
        const accountsArray = Object.values(this.allAccounts);
        
        const filtered = accountsArray.filter(acc => 
            acc.displayName.toLowerCase().includes(searchTerm) || 
            acc.username.toLowerCase().includes(searchTerm)
        );
        
        this.renderGroups(filtered);
    }
    
    // Разделение на группы
    renderGroups(accounts) {
        const groups = {
            attention: document.getElementById('group-attention'),
            online: document.getElementById('group-online'),
            offline: document.getElementById('group-offline'),
        };
        const wrappers = {
            attention: document.getElementById('group-attention-wrapper'),
            online: document.getElementById('group-online-wrapper'),
            offline: document.getElementById('group-offline-wrapper'),
        }
        
        Object.values(groups).forEach(group => group.innerHTML = ''); // Очистка
        let counts = { attention: 0, online: 0, offline: 0 };

        accounts.forEach(account => {
            const cardHTML = this.createAccountCardHTML(account);
            
            if (account.botStatus === 'steam_guard' || account.botStatus === 'error') {
                groups.attention.innerHTML += cardHTML;
                counts.attention++;
            } else if (account.botStatus === 'online' || account.botStatus === 'connecting' || account.botStatus === 'starting') {
                groups.online.innerHTML += cardHTML;
                counts.online++;
            } else {
                groups.offline.innerHTML += cardHTML;
                counts.offline++;
            }
        });
        
        // Скрываем пустые группы
        wrappers.attention.style.display = counts.attention > 0 ? 'block' : 'none';
        wrappers.online.style.display = counts.online > 0 ? 'block' : 'none';
        wrappers.offline.style.display = counts.offline > 0 ? 'block' : 'none';
    }
    
    // 🌟 ИСПРАВЛЕННАЯ ГЕНЕРАЦИЯ КАРТОЧКИ (с блокировкой кнопки) 🌟
    createAccountCardHTML(account) {
        const firstAppId = account.games.split(' ')[0];
        const coverUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${firstAppId}/header.jpg`;
        
        const farmedHours = account.farmedHours || 0;
        const progressPercent = (farmedHours % 100); 

        // 🌟 ЛОГИКА БЛОКИРОВКИ КНОПКИ 🌟
        let actionButtonHTML = '';
        if (account.botStatus === 'online' || account.botStatus === 'connecting' || account.botStatus === 'starting' || account.botStatus === 'steam_guard') {
            actionButtonHTML = `<button class="btn btn-danger" onclick="stopFarm('${account.id}')"><i class="fas fa-stop"></i> Стоп</button>`;
        } else if (account.botStatus === 'error') {
            // 🚫 Кнопка "Старт" ОТКЛЮЧЕНА, пока бот в ошибке (на кулдауне)
            actionButtonHTML = `<button class="btn btn-success" disabled title="${account.error}"><i class="fas fa-hourglass-half"></i> Кулдаун...</button>`;
        } else {
            // Бот оффлайн и готов к запуску
            actionButtonHTML = `<button class="btn btn-success" onclick="startFarm('${account.id}')"><i class="fas fa-play"></i> Старт</button>`;
        }

        return `
            <div class="account-card card-status-${account.botStatus}" data-id="${account.id}" data-name="${account.displayName} ${account.username}">
                <div class="card-game-cover" style="background-image: url('${coverUrl}')"></div>
                
                <div class="card-content">
                    <div class="account-header">
                        <span class="account-name">${account.displayName}</span>
                        <span class="account-status status-${account.botStatus}">
                            ${this.formatStatus(account.botStatus)}
                        </span>
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
                            <span class="detail-value" style="color: var(--color-danger); font-size: 0.8em;">${account.error}</span>
                        </div>
                        ` : ''}
                    </div>
                    
                    ${account.needsGuardCode ? `
                    <div style="margin: 15px 0;">
                        <button class="btn btn-warning" onclick="showSteamGuardModal('${account.id}', '${account.displayName}')" style="width: 100%;">
                            <i class="fas fa-shield-halved"></i> Ввести Steam Guard код
                        </button>
                    </div>
                    ` : ''}
                    
                    <div class="analytics">
                        <div class="analytics-item detail-row">
                            <span class="detail-label">Нафармлено:</span>
                            <span class="detail-value" style="color: var(--color-primary);">${farmedHours} ч.</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-bar-inner" style="width: ${progressPercent}%;"></div>
                        </div>
                        <div class="analytics-item detail-row" style="font-size: 0.85rem; margin-top: 5px;">
                            <span class="detail-label">Всего: ${account.currentHours || 0} ч.</span>
                            <span class="detail-label">${100 - progressPercent} ч. до цели</span>
                        </div>
                    </div>
                    
                    <div class="account-actions">
                        ${actionButtonHTML}
                        <button class="btn btn-secondary" onclick="deleteAccount('${account.id}')"><i class="fas fa-trash"></i> Удалить</button>
                    </div>
                </div>
            </div>
        `;
    }

    // Статусы с иконками
    formatStatus(status) {
        switch (status) {
            case 'online': return '<i class="fas fa-check-circle"></i> Онлайн';
            case 'steam_guard': return '<i class="fas fa-shield-halved"></i> Ждет Код';
            case 'error': return '<i class="fas fa-exclamation-triangle"></i> Ошибка';
            case 'connecting': return '<i class="fas fa-sync-alt fa-spin"></i> Соединение';
            case 'starting': return '<i class="fas fa-sync-alt fa-spin"></i> Запуск';
            default: return '<i class="fas fa-bed"></i> Оффлайн';
        }
    }

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

// API-функции (без изменений)
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
    if (!confirm('Вы уверены, что хотите удалить этот аккаунт? Он будет навсегда удален с сервера.')) { return; }
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
        if (!result.success) dashboard.showNotification(result.error, 'error');
    } catch (error) {
        dashboard.showNotification('Ошибка запуска', 'error');
    }
}
async function stopFarm(accountId) {
    try {
        const response = await fetch(`/api/farm/stop/${accountId}`, {method: 'POST'});
        const result = await response.json();
        if (!result.success) dashboard.showNotification(result.error, 'error');
    } catch (error) {
        dashboard.showNotification('Ошибка остановки', 'error');
    }
}
async function showSteamGuardModal(accountId, accountName) {
    document.getElementById('steamGuardContent').innerHTML = `
        <p>Для аккаунта <strong>${accountName}</strong> введите 5-значный код из мобильного приложения Steam Guard.</p>
        <div class="form-group">
            <input type="text" id="steamGuardCode" placeholder="Введите 5-значный код" maxlength="5" style="text-align: center; font-size: 1.5rem; letter-spacing: 5px;">
        </div>
        <button class="btn btn-warning" onclick="submitSteamGuardCode('${accountId}')" style="width: 100%;">
            <i class="fas fa-paper-plane"></i> Подтвердить
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
