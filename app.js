

document.addEventListener('DOMContentLoaded', () => {
    const DB_NAME = 'FFPOS006A';
    const DB_VERSION = 1;
    const ALL_STORES = ['products', 'categories', 'stock', 'purchases', 'orders', 'settings', 'hh_transactions', 'hr_employees', 'hr_attendance', 'hr_payroll', 'todos'];
    let dbInstance;
    let itemToDelete = null;
    let html5QrCode = null;
    let bluetoothDevice = null;
    let bluetoothCharacteristic = null;
    
    let navHistory = ['home'];
    let currentHistoryIndex = 0;

    const DEVICE_ID = localStorage.getItem('ffpos_device_id') || (() => {
        const id = 'dev-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('ffpos_device_id', id);
        return id;
    })();
    let rtcPeers = new Map();
    let pendingOfferPeerId = null;
    let rtcPeerCounter = 0;

    let gdriveTokenClient = null;
    let gdriveAccessToken = null;
    const GDRIVE_BACKUP_FILENAME = 'FFPOS_Backup.json';

    const openDatabase = () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('products')) {
                    const productsStore = db.createObjectStore('products', { keyPath: 'id' });
                    productsStore.createIndex('categoryId', 'categoryId', { unique: false });
                    productsStore.createIndex('name', 'name', { unique: false });
                }
                if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('stock')) {
                    const stockStore = db.createObjectStore('stock', { keyPath: 'productId' });
                    stockStore.createIndex('quantity', 'quantity', { unique: false });
                }
                if (!db.objectStoreNames.contains('purchases')) {
                    const purchasesStore = db.createObjectStore('purchases', { keyPath: 'id' });
                    purchasesStore.createIndex('dateTime', 'dateTime', { unique: false });
                    purchasesStore.createIndex('productId', 'productId', { unique: false });
                }
                if (!db.objectStoreNames.contains('orders')) {
                    const ordersStore = db.createObjectStore('orders', { keyPath: 'id' });
                    ordersStore.createIndex('date', 'date', { unique: false });
                    ordersStore.createIndex('status', 'status', { unique: false });
                }
                if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });

                if (!db.objectStoreNames.contains('hh_transactions')) {
                    const hhTrans = db.createObjectStore('hh_transactions', { keyPath: 'id' });
                    hhTrans.createIndex('date', 'date', { unique: false });
                }

                if (!db.objectStoreNames.contains('hr_employees')) {
                    const empStore = db.createObjectStore('hr_employees', { keyPath: 'id' });
                    empStore.createIndex('status', 'status', { unique: false });
                }
                if (!db.objectStoreNames.contains('hr_attendance')) {
                    const attStore = db.createObjectStore('hr_attendance', { keyPath: 'id' });
                    attStore.createIndex('date', 'date', { unique: false });
                    attStore.createIndex('employeeId', 'employeeId', { unique: false });
                }
                if (!db.objectStoreNames.contains('hr_payroll')) {
                    const payStore = db.createObjectStore('hr_payroll', { keyPath: 'id' });
                    payStore.createIndex('month', 'month', { unique: false });
                }
                if (!db.objectStoreNames.contains('todos')) {
                    const todoStore = db.createObjectStore('todos', { keyPath: 'id' });
                    todoStore.createIndex('status', 'status', { unique: false });
                }
            };
            request.onsuccess = (event) => {
                dbInstance = event.target.result;
                resolve(dbInstance);
            };
            request.onerror = (event) => {
                console.error('Database error:', event.target.error);
                reject(event.target.error);
            };
        });
    };

    const db = {
        add: (storeName, item) => new Promise((resolve, reject) => {
            const t = dbInstance.transaction(storeName, 'readwrite');
            t.oncomplete = () => resolve(item);
            t.onerror = event => reject(event.target.error);
            t.objectStore(storeName).add(item);
        }),
        put: (storeName, item) => new Promise((resolve, reject) => {
            const t = dbInstance.transaction(storeName, 'readwrite');
            t.oncomplete = () => resolve(item);
            t.onerror = event => reject(event.target.error);
            t.objectStore(storeName).put(item);
        }),
        get: (storeName, key) => new Promise((resolve, reject) => {
            const t = dbInstance.transaction(storeName, 'readonly');
            const request = t.objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = event => reject(event.target.error);
        }),
        getAll: (storeName, indexName, range) => new Promise((resolve, reject) => {
            const store = dbInstance.transaction(storeName, 'readonly').objectStore(storeName);
            const target = indexName ? store.index(indexName) : store;
            const request = range ? target.getAll(range) : target.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = event => reject(event.target.error);
        }),
        delete: (storeName, key) => new Promise((resolve, reject) => {
            const t = dbInstance.transaction(storeName, 'readwrite');
            t.oncomplete = () => resolve();
            t.onerror = event => reject(event.target.error);
            t.objectStore(storeName).delete(key);
        }),
        clear: (storeName) => new Promise((resolve, reject) => {
            const t = dbInstance.transaction(storeName, 'readwrite');
            t.oncomplete = () => resolve();
            t.onerror = event => reject(event.target.error);
            t.objectStore(storeName).clear();
        }),
        count: (storeName, indexName, range) => new Promise((resolve, reject) => {
            const store = dbInstance.transaction(storeName, 'readonly').objectStore(storeName);
            const target = indexName ? store.index(indexName) : store;
            const request = range ? target.count(range) : target.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = event => reject(event.target.error);
        }),
    };

    const initSampleData = async () => {
        const productCount = await db.count('products');
        const nowIso = new Date().toISOString();
        const todayStr = nowIso.slice(0, 10);
        const thisMonthStr = nowIso.slice(0, 7);
        
        if (productCount === 0) {
            const categories = [ 
                { id: 'cat1', name: 'အီလက်ထရွန်းနစ်', isSample: true }, 
                { id: 'cat2', name: 'အဝတ်အထည်', isSample: true }, 
                { id: 'cat3', name: 'ကုန်စုံပစ္စည်း', isSample: true }
            ];
            const products = [
                { id: 'prod1', categoryId: 'cat1', name: 'Wireless Mouse', price: 25000, image: null, barcode: '1001', isSample: true },
                { id: 'prod2', categoryId: 'cat2', name: 'တီရှပ် (T-Shirt)', price: 15000, image: null, barcode: '1002', isSample: true },
                { id: 'prod3', categoryId: 'cat1', name: 'USB-C Cable', price: 8000, image: null, barcode: '1003', isSample: true },
                { id: 'prod4', categoryId: 'cat3', name: 'ခေါက်ဆွဲခြောက်ထုပ်', price: 1500, image: null, barcode: '1004', isSample: true },
            ];
            const stock = products.map(p => ({ productId: p.id, quantity: 50, lowThreshold: 10, isSample: true }));

            const purchases = [
                { id: 'pch-sample-1', productId: 'prod1', productName: 'Wireless Mouse', supplier: 'Tech Supply Co.', quantity: 20, unitCost: 18000, totalCost: 360000, dateTime: `${todayStr}T09:30`, isSample: true },
                { id: 'pch-sample-2', productId: 'prod4', productName: 'ခေါက်ဆွဲခြောက်ထုပ်', supplier: 'City Mart Wholesales', quantity: 100, unitCost: 1100, totalCost: 110000, dateTime: `${todayStr}T10:15`, isSample: true }
            ];

            const orders = [
                {
                    id: `ord-sample-1`,
                    date: todayStr,
                    status: 'completed',
                    items: [
                        { productId: 'prod1', name: 'Wireless Mouse', price: 25000, quantity: 1 },
                        { productId: 'prod3', name: 'USB-C Cable', price: 8000, quantity: 2 }
                    ],
                    subtotal: 41000,
                    discount: 1000,
                    tax: 0,
                    total: 40000,
                    paymentMethod: 'Cash',
                    isSample: true
                }
            ];

            try {
                await Promise.all(categories.map(c => db.put('categories', c)));
                await Promise.all(products.map(p => db.put('products', p)));
                await Promise.all(stock.map(s => db.put('stock', s)));
                await Promise.all(purchases.map(p => db.put('purchases', p)));
                await Promise.all(orders.map(o => db.put('orders', o)));
                await db.put('settings', { key: 'theme', value: 'light' });
                await db.put('settings', { key: 'language', value: 'mm' });
                await db.put('settings', { key: 'taxRate', value: 0 });
                await db.put('settings', { key: 'receiptTitle', value: 'Free Free POS!' });
                await db.put('settings', { key: 'appMode', value: 'retail' });
                await db.put('settings', { key: 'printerType', value: 'bluetooth' });
            } catch (error) {
                console.error('Error initializing sample data:', error);
            }
        }

        const hhCount = await db.count('hh_transactions');
        if (hhCount === 0) {
            const sampleTrans = [
                { id: 'hht-sample-1', type: 'income', category: 'လစာ / စီးပွားရေးဝင်ငွေ', amount: 3500000, date: todayStr, isSample: true },
                { id: 'hht-sample-2', type: 'expense', category: 'မီးဖိုးနှင့် ရေဖိုး', amount: 45000, date: todayStr, isSample: true },
                { id: 'hht-sample-3', type: 'expense', category: 'ဈေးဖိုးအထွေထွေ', amount: 120000, date: todayStr, isSample: true }
            ];
            for (const t of sampleTrans) await db.put('hh_transactions', t);
        }

        const hrCount = await db.count('hr_employees');
        if (hrCount === 0) {
            const sampleEmployees = [
                { id: 'emp-sample-1', name: 'ကင်ဂျုံအန်', position: 'ဆိုင်မန်နေဂျာ', phone: '09790000001', basicSalary: 350000, joinDate: todayStr, status: 'active', isSample: true },
                { id: 'emp-sample-2', name: 'ပူတင်', position: 'အရောင်းဝန်ထမ်း / Cashier', phone: '09790000002', basicSalary: 220000, joinDate: todayStr, status: 'active', isSample: true }
            ];
            const sampleAttendance = [
                { id: 'att-sample-1', employeeId: 'emp-sample-1', employeeName: 'ကင်ဂျုံအန်', date: todayStr, status: 'present', notes: 'အချိန်မှန်', isSample: true },
                { id: 'att-sample-2', employeeId: 'emp-sample-2', employeeName: 'ပူတင်', date: todayStr, status: 'present', notes: 'အချိန်မှန်', isSample: true }
            ];
            const samplePayroll = [
                { id: 'pay-sample-1', employeeId: 'emp-sample-2', employeeName: 'ပူတင်', month: thisMonthStr, payDate: todayStr, basic: 220000, bonus: 20000, deduction: 0, netPay: 240000, method: 'Cash', isSample: true }
            ];
            for (const e of sampleEmployees) await db.put('hr_employees', e);
            for (const a of sampleAttendance) await db.put('hr_attendance', a);
            for (const p of samplePayroll) await db.put('hr_payroll', p);
        }

        const todoCount = await db.count('todos');
        if (todoCount === 0) {
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
            const tomorrowLocal = tomorrow.toISOString().slice(0, 16);

            const sampleTodos = [
                {
                    id: 'todo-sample-1',
                    text: 'ပစ္စည်းအသစ်များစာရင်းသွင်းရန်',
                    status: 'pending',
                    category: 'inventory',
                    priority: 'high',
                    dueDate: tomorrowLocal,
                    subtasks: [
                        { id: 'sub-sample-1', text: 'အဝယ်ဘောင်ချာ စစ်ဆေးရန်', completed: true },
                        { id: 'sub-sample-2', text: 'Barcode များကပ်ရန်', completed: false }
                    ],
                    order: 1,
                    createdAt: Date.now(),
                    isSample: true
                },
                {
                    id: 'todo-sample-2',
                    text: 'ဆိုင်လခ ပေးချေရန်',
                    status: 'completed',
                    category: 'finance',
                    priority: 'medium',
                    dueDate: '',
                    subtasks: [],
                    order: 2,
                    createdAt: Date.now() + 1,
                    isSample: true
                }
            ];
            for (const t of sampleTodos) await db.put('todos', t);
        }
    };

    const state = {
        currentSection: 'home', 
        currentOrder: null,
        taxRate: 0,
        currentLanguage: 'mm',
        appMode: 'retail',
        printerType: 'bluetooth',
        syncRole: 'standalone',
        lastCompletedOrder: null,
        productsPage: 1, productsPerPage: 10,
        stockPage: 1, stockPerPage: 10,
        categoriesPage: 1, categoriesPerPage: 10,
        expiringSoonPage: 1, expiringSoonPerPage: 10,
        saleHistoryPage: 1, saleHistoryPerPage: 10,
        filteredPurchases: [], filteredSales: [], reportData: null,
        todoStatusFilter: 'all',
        todoNotifiedIds: new Set(),
        draggedTodoId: null,
        settingsTab: 'general'
    };

    const UIElements = {
        sidebar: document.querySelector('.akmsidebar'),
        mainContent: document.querySelector('.akmmain-content'),
        menuToggle: document.querySelector('.akmmenu-toggle'),
        sections: document.querySelectorAll('.content-section'),
        sidebarLinks: document.querySelectorAll('.akmmenu-link'),
    };

    function populateYearDatalist() {
        const datalist = document.getElementById('year-suggestions-list');
        if (!datalist) return;
        const currentYear = new Date().getFullYear();
        const options = [];
        for (let y = currentYear + 20; y >= currentYear - 20; y--) {
            options.push(`<option value="${y}">`);
        }
        datalist.innerHTML = options.join('');
    }

    window.switchSettingsTab = function(tabName) {
        state.settingsTab = tabName;
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.settingsTab === tabName);
        });
        document.querySelectorAll('.settings-tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === `settings-pane-${tabName}`);
        });
    };

    window.renderUserGuidePage = function() {
        const container = document.getElementById('user-guide-content');
        if (!container) return;
        const isMm = state.currentLanguage === 'mm';

        if (isMm) {
            container.innerHTML = `
                <div class="guide-intro-banner">
                    <strong><i class="fas fa-hand-sparkles" style="color: var(--primary-color);"></i> မင်္ဂလာပါ! Free Free POS! မှ ကြိုဆိုပါတယ်။</strong><br>
                    စနစ်ကို ပထမဆုံး စတင်အသုံးပြုမည့်သူများ နားလည်လွယ်စေရန် အဆင့် (၁) မှ (၉) အထိ စနစ်တကျ ရှင်းလင်းဖော်ပြပေးထားပါသည်။ အောက်ပါအစီအစဉ်အတိုင်း တစ်ဆင့်ချင်း လုပ်ဆောင်ရုံဖြင့် မိမိဆိုင်အတွက် အလွယ်တကူ စတင်အသုံးပြုနိုင်ပါပြီ။
                </div>

                <div class="guide-grid">
                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">၁</span> Demo (နမူနာ) Data များ ဖျက်နည်း</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-warning" onclick="navigateTo('settings'); switchSettingsTab('backup');">
                                <i class="fas fa-broom"></i> Backup &amp; Data သို့သွားမည်
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>စနစ်ကို စဖွင့်ချိန်တွင် စမ်းသပ်ကြည့်ရှုနိုင်ရန် နမူနာကုန်ပစ္စည်း၊ အရောင်း/အဝယ်စာရင်းနှင့် ဝန်ထမ်းစာရင်းအချို့ ကြိုတင်ထည့်သွင်းပေးထားပါသည်။ မိမိဆိုင်၏ စာရင်းအစစ်များ မထည့်မီ ထိုနမူနာဒေတာများကို အရင်ဖျက်ပစ်နိုင်ပါသည်။</p>
                            <ol>
                                <li>Home page မှ <strong>Settings (ဆက်တင်များ)</strong> ထဲသို့ ဝင်ပါ။</li>
                                <li>အပေါ်ဆုံးရှိ Tab များထဲမှ <strong>Backup &amp; Data</strong> Tab ကို နှိပ်ပါ။</li>
                                <li>အောက်ဘက်ရှိ <strong>"နမူနာဒေတာများ ဖျက်မည် (Delete Sample Data)"</strong> ခလုတ်ကို နှိပ်ပြီး Confirm လုပ်ပါ။</li>
                            </ol>
                            <div class="guide-tip-box">
                                <strong>မှတ်ချက်:</strong> "Delete Sample Data" သည် စနစ်မှ ထည့်ထားသော နမူနာဒေတာများကိုသာ ဖျက်ပေးမည်ဖြစ်ပြီး သင်ကိုယ်တိုင် ထည့်သွင်းထားသော ဒေတာများကို မထိခိုက်ပါ။ အကယ်၍ ဒေတာအားလုံး (ကိုယ်တိုင်ထည့်ထားသည်များပါ) အစအဆုံး ရှင်းလင်းလိုပါက <strong>"Reset All Data"</strong> ကိုသုံးပြီး Confirm box တွင် <code>DELETE</code> ဟု ရိုက်ထည့်ပါ။
                            </div>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">၂</span> Settings (ဆက်တင်များ) ချိန်ညှိနည်း</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-primary" onclick="navigateTo('settings'); switchSettingsTab('general');">
                                <i class="fas fa-cog"></i> Settings သို့သွားမည်
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>Settings ထဲတွင် စနစ်တစ်ခုလုံးအတွက် အပိုင်း (၄) ပိုင်း ခွဲထားပါသည်။ ပြင်ဆင်ပြီးတိုင်း ညာဘက်အပေါ်ထောင့်ရှိ <strong>"Save Settings (ဆက်တင်များသိမ်းမည်)"</strong> ခလုတ်ကို နှိပ်ရန် မမေ့ပါနှင့်။</p>
                            <ul>
                                <li><strong>General (အထွေထွေ):</strong> ဘောင်ချာထိပ်တွင် ပေါ်မည့် ဆိုင်အမည် (Receipt Title)၊ အခွန်နှုန်း (Tax Rate %)၊ ဘာသာစကား (မြန်မာ / English)၊ စနစ်အမျိုးအစား (<strong>Retail Mode</strong> - လက်လီဆိုင် သို့မဟုတ် <strong>Bakery</strong> - သက်တမ်းကုန်ရက်ပါ စစ်ဆေးလိုသော မုန့်ဆိုင်) နှင့် အပြင်အဆင် (<strong>Light Mode / Dark Mode</strong>) တို့ကို ရွေးချယ်နိုင်ပါသည်။</li>
                                <li><strong>Printer:</strong> ဘောင်ချာထုတ်ရန် <strong>Direct Web Bluetooth</strong> (Chrome မှတစ်ဆင့် Bluetooth Printer တိုက်ရိုက်ချိတ်ဆက်ခြင်း)၊ <strong>RawBT Android App</strong> သို့မဟုတ် <strong>Browser Print</strong> တို့ကို ရွေးချယ်ပြီး "Test Print" ဖြင့် စမ်းသပ်နိုင်ပါသည်။</li>
                                <li><strong>Wi-Fi Sync:</strong> Wi-Fi Router တစ်ခုတည်းသုံးထားသော စက် (၂) လုံးအကြား (Server စက်နှင့် Counter စက်) QR Code Scan ဖတ်၍ စာရင်းချိတ်ဆက်နိုင်ပါသည်။</li>
                                <li><strong>Backup &amp; Data:</strong> ဒေတာများ မပျောက်ဆုံးစေရန် <strong>Export Backup file</strong> ဖြင့် ဖုန်း/ကွန်ပျူတာထဲသို့ backup ဖိုင်အဖြစ် သိမ်းထားနိုင်သလို Google Drive ဖြင့်လည်း Backup/Restore လုပ်နိုင်ပါသည်။ လအလိုက် ဒေတာဟောင်းများကိုလည်း ဖျက်နိုင်ပါသည်။</li>
                            </ul>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">၃</span> Categories (အမျိုးအစားများ) ဖန်တီးနည်း</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('categories')">
                                <i class="fas fa-tags"></i> Categories သို့သွားမည်
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>ကုန်ပစ္စည်းများ မထည့်သွင်းမီ ပစ္စည်းအုပ်စု (Category) များကို ဦးစွာ ဖန်တီးထားပါက အရောင်းလုပ်ချိန်တွင် ရှာဖွေရ ပိုမိုလွယ်ကူပါသည်။ (ဥပမာ - အချိုရည်၊ မုန့်မျိုးစုံ၊ အဝတ်အထည်၊ အလှကုန်)</p>
                            <ol>
                                <li><strong>Categories</strong> ထဲသို့ ဝင်ပြီး <strong>"Add Category (အမျိုးအစားထည့်ရန်)"</strong> ခလုတ်ကို နှိပ်ပါ။</li>
                                <li>အမျိုးအစားအမည် ရိုက်ထည့်ပြီး <strong>Save</strong> နှိပ်ပါ။</li>
                                <li>နောက်ပိုင်းတွင် အမည်ပြင်လိုပါက ခဲတံပုံ (Edit) ခလုတ်ကို နှိပ်၍ ပြင်နိုင်ပါသည်။ (ပစ္စည်းထည့်ထားခြင်းမရှိသေးသော Category ကိုသာ ဖျက်နိုင်ပါမည်။)</li>
                            </ol>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">၄</span> Products (ကုန်ပစ္စည်းများ) ထည့်သွင်းနည်း</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('products')">
                                <i class="fas fa-box-open"></i> Products သို့သွားမည်
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>မိမိဆိုင်တွင် ရောင်းချမည့် ကုန်ပစ္စည်းတစ်ခုချင်းစီကို ဤနေရာတွင် စာရင်းသွင်းရပါမည်။</p>
                            <ol>
                                <li><strong>Products</strong> ထဲသို့ ဝင်ပြီး <strong>"Add Product (ပစ္စည်းထည့်ရန်)"</strong> ကို နှိပ်ပါ။</li>
                                <li><strong>Product Name:</strong> ကုန်ပစ္စည်းအမည် ရိုက်ထည့်ပါ။</li>
                                <li><strong>Barcode (ရှိပါက):</strong> ပစ္စည်းပေါ်ရှိ Barcode ကို ဘေးနားရှိ <strong>Scan</strong> ခလုတ်နှိပ်၍ ကင်မရာဖြင့် Scan ဖတ်ထည့်နိုင်သလို ကိုယ်တိုင်လည်း ရိုက်ထည့်နိုင်ပါသည်။</li>
                                <li><strong>Category နှင့် Price:</strong> သက်ဆိုင်ရာ အမျိုးအစားကို ရွေးချယ်ပြီး <strong>ရောင်းဈေး</strong> ကို ထည့်ပါ။</li>
                                <li><strong>Product Image:</strong> ပစ္စည်းပုံ ထည့်လိုပါက ဖိုင်ရွေးထည့်ပြီး <strong>"Save Product"</strong> ကို နှိပ်ပါ။</li>
                            </ol>
                            <div class="guide-tip-box">
                                <strong>အရေးကြီးအချက်:</strong> ပစ္စည်းအသစ်စထည့်ချိန်တွင် ထိုပစ္စည်း၏ Stock လက်ကျန်သည် <strong>0 (Out of Stock)</strong> ဖြစ်နေပါမည်။ အရောင်းစတင်နိုင်ရန် အောက်ပါ အဆင့် (၅) Purchases မှတစ်ဆင့် အရေအတွက် ထည့်သွင်းပေးရပါမည်။
                            </div>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">၅</span> Purchases (အဝယ်စာရင်းသွင်းခြင်းနှင့် Stock ဖြည့်နည်း)</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('purchases')">
                                <i class="fas fa-truck-loading"></i> Purchases သို့သွားမည်
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>ကုန်ပစ္စည်းအသစ် ဝယ်ယူတင်သွင်းသည့်အခါတိုင်း Purchases ထဲတွင် စာရင်းသွင်းခြင်းဖြင့် <strong>Stock လက်ကျန်အရေအတွက် အလိုအလျောက် တိုးလာမည်</strong> ဖြစ်ပြီး လစဉ်/နေ့စဉ် အရင်းစရိတ် (Total Cost) ကိုလည်း တွက်ချက်ပေးပါမည်။</p>
                            <ol>
                                <li><strong>Purchases</strong> ထဲဝင်ပြီး <strong>"Add Purchase (အဝယ်ထည့်ရန်)"</strong> ကို နှိပ်ပါ။</li>
                                <li>အမျိုးအစား (Category) ကို အရင်ရွေးပြီး ပစ္စည်း (Product) ကို ရွေးချယ်ပါ။</li>
                                <li>ဝယ်ယူသည့် <strong>အရေအတွက် (Quantity)</strong> နှင့် <strong>တစ်ခုချင်းအရင်းဈေး (Unit Cost)</strong> (သို့မဟုတ် စုစုပေါင်းကျသင့်ငွေ Total Cost) ကို ထည့်ပါ။</li>
                                <li>အကယ်၍ ဈေးနှုန်းအသစ်ပြောင်းလိုပါက <strong>"New Selling Price (Optional)"</strong> တွင် ရောင်းဈေးအသစ်ကို တစ်ခါတည်း ပြောင်းနိုင်ပါသည်။</li>
                                <li>Bakery Mode ဖွင့်ထားပါက <strong>Expiration Date (ကုန်ဆုံးရက်)</strong> ကိုပါ ရွေးထည့်ပြီး <strong>"Save Purchase"</strong> နှိပ်ပါ။</li>
                            </ol>
                            <p style="margin-top:6px;">Purchases စာမျက်နှာတွင် ရက်စွဲအလိုက်၊ လအလိုက် စစ်ထုတ်ကြည့်နိုင်သလို CSV / PDF ဖိုင်အဖြစ်လည်း ထုတ်ယူနိုင်ပါသည်။</p>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">၆</span> Stock (ကုန်ပစ္စည်းလက်ကျန်) စီမံခန့်ခွဲနည်း</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('stock')">
                                <i class="fas fa-warehouse"></i> Stock သို့သွားမည်
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>ဆိုင်တွင် ပစ္စည်းမည်မျှ ကျန်ရှိနေသေးသည်ကို အချိန်နှင့်တစ်ပြေးညီ စစ်ဆေးနိုင်သော နေရာဖြစ်ပါသည်။</p>
                            <ul>
                                <li><strong>အရေအတွက် (Quantity):</strong> Purchases မှ ဝယ်ထည့်လျှင် တိုးလာပြီး New Sale မှ ရောင်းလိုက်လျှင် အလိုအလျောက် လျော့သွားပါမည်။</li>
                                <li><strong>Low Threshold (အနည်းဆုံးသတ်မှတ်ချက်):</strong> ဥပမာ- 10 ဟု ထားပါက လက်ကျန် 10 ခုနှင့်အောက် ရောက်လျှင် <strong>"Low Stock (ကုန်တော့မည်)"</strong> ဟု အနီရောင်ဖြင့် သတိပေးပါမည်။</li>
                                <li><strong>Low Stock Only:</strong> ထိုအမှန်ခြစ်ကွက်ကို နှိပ်ခြင်းဖြင့် ကုန်တော့မည့် ပစ္စည်းများကိုသာ သီးသန့် စစ်ထုတ်ကြည့်ရှုနိုင်ပါသည်။</li>
                            </ul>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">၇</span> New Sale (အရောင်းပြုလုပ်နည်း)</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-success" onclick="navigateTo('orders')">
                                <i class="fas fa-cash-register"></i> New Sale သို့သွားမည်
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>ဝယ်သူကို ပစ္စည်းရောင်းချသည့်အခါ အသုံးပြုရန်ဖြစ်ပါသည်။</p>
                            <ol>
                                <li>ဘယ်ဘက်ခြမ်းမှ ပစ္စည်းကတ်ကို နှိပ်၍ဖြစ်စေ၊ ရှာဖွေကွက်ဘေးရှိ <strong>Scan</strong> ခလုတ်နှိပ်၍ Barcode ဖတ်ပြီးဖြစ်စေ ပစ္စည်းထည့်ပါ။</li>
                                <li>ညာဘက်ခြမ်းတွင် <strong>+ / -</strong> ခလုတ်များဖြင့် အရေအတွက် အတိုးအလျှော့ လုပ်နိုင်ပါသည်။</li>
                                <li>လျှော့ဈေးပေးလိုပါက <strong>Discount</strong> ကွက်တွင် ထည့်ပြီး ငွေပေးချေမှုပုံစံ (<strong>Cash</strong> သို့မဟုတ် <strong>KBZ Pay</strong>) ကို ရွေးပါ။</li>
                                <li>အားလုံးသေချာပါက <strong>"Complete (ပြီးပြီ)"</strong> ခလုတ်ကို နှိပ်၍ Confirm လုပ်ပါ။</li>
                                <li>အရောင်းပြီးဆုံးပါက ဘောင်ချာပေါ်လာမည်ဖြစ်ပြီး <strong>Print Thermal</strong> (Printer ဖြင့်ထုတ်ရန်)၊ <strong>Save Image</strong> (ပုံသိမ်းရန်) သို့မဟုတ် <strong>Share</strong> (Telegram/Viber/Messenger ပို့ရန်) တို့ကို ရွေးချယ်နိုင်ပါသည်။</li>
                            </ol>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">၈</span> Sale History (အရောင်းမှတ်တမ်း) ကြည့်ရှုနည်း</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('sale-history')">
                                <i class="fas fa-history"></i> Sale History သို့သွားမည်
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>ရောင်းချပြီးသား ဘောင်ချာမှတ်တမ်းအားလုံးကို ပြန်လည်စစ်ဆေးနိုင်ပါသည်။</p>
                            <ul>
                                <li><strong>စစ်ထုတ်ခြင်း:</strong> All (အားလုံး)၊ By Date (ရက်စွဲအလိုက်)၊ By Month (လအလိုက်) ရွေးချယ်ပြီး <strong>Apply Filter</strong> နှိပ်၍ ကြည့်နိုင်ပါသည်။</li>
                                <li><strong>အသေးစိတ်ကြည့်ရန်:</strong> မျက်လုံးပုံ (View) ခလုတ်ကို နှိပ်ပါက ထိုဘောင်ချာထဲတွင် ပါဝင်သော ပစ္စည်းစာရင်းအပြည့်အစုံကို မြင်ရပြီး ပြန်လည် Print ထုတ်နိုင်ပါသည်။</li>
                                <li><strong>Export ထုတ်ရန်:</strong> အပေါ်ရှိ <strong>CSV</strong> သို့မဟုတ် <strong>PDF</strong> ခလုတ်ကို နှိပ်၍ အရောင်းစာရင်းများကို ဖိုင်အဖြစ် သိမ်းဆည်းနိုင်ပါသည်။</li>
                            </ul>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">၉</span> Reports (အစီရင်ခံစာများ) ထုတ်ယူကြည့်ရှုနည်း</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('reports')">
                                <i class="fas fa-chart-bar"></i> Reports သို့သွားမည်
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>ဆိုင်၏ နေ့စဉ်နှင့် လစဉ် ငွေဝင်/ငွေထွက်နှင့် အမြတ်အစွန်းအခြေအနေကို တစ်ချက်တည်း ကြည့်ရှုနိုင်ပါသည်။</p>
                            <ul>
                                <li><strong>Daily Report (နေ့စဉ်အစီရင်ခံစာ):</strong> ကြည့်လိုသော ရက်စွဲကို ရွေးပြီး "Generate Daily Report" ကို နှိပ်ပါ။</li>
                                <li><strong>Monthly Report (လစဉ်အစီရင်ခံစာ):</strong> လနှင့် ခုနှစ်ကို ရွေးပြီး "Generate Monthly Report" ကို နှိပ်ပါ။</li>
                                <li>Report ထဲတွင် <strong>Total Revenue (စုစုပေါင်းရောင်းရငွေ)</strong>၊ <strong>Total Cost (စုစုပေါင်းဝယ်ယူကုန်ကျငွေ)</strong>၊ <strong>Net Profit (အသားတင်အမြတ်)</strong> နှင့် <strong>Cash / KBZ Pay</strong> အလိုက် ရောင်းရငွေများကို အလိုအလျောက် တွက်ချက်ပြသပေးပါမည်။</li>
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="guide-intro-banner">
                    <strong><i class="fas fa-hand-sparkles" style="color: var(--primary-color);"></i> Welcome to Free Free POS!</strong><br>
                    Follow this step-by-step beginner guide (Steps 1 to 9) to set up your store, clear demo records, and start selling smoothly.
                </div>

                <div class="guide-grid">
                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">1</span> How to Delete Demo / Sample Data</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-warning" onclick="navigateTo('settings'); switchSettingsTab('backup');">
                                <i class="fas fa-broom"></i> Go to Backup &amp; Data
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>Free Free POS! includes sample products, purchases, and staff records so you can explore first. Before adding real business data:</p>
                            <ol>
                                <li>Open <strong>Settings</strong> from Home.</li>
                                <li>Select the <strong>Backup &amp; Data</strong> tab.</li>
                                <li>Click <strong>Delete Sample Data</strong> and confirm.</li>
                            </ol>
                            <div class="guide-tip-box">
                                <strong>Tip:</strong> "Delete Sample Data" only removes demo entries and keeps your own records safe. To wipe everything completely, use <strong>Reset All Data</strong> and type <code>DELETE</code>.
                            </div>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">2</span> How to Configure Settings</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-primary" onclick="navigateTo('settings'); switchSettingsTab('general');">
                                <i class="fas fa-cog"></i> Go to Settings
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>Settings are organized into 4 clean tabs. Always click <strong>Save Settings</strong> at the top right after making changes.</p>
                            <ul>
                                <li><strong>General:</strong> Set Receipt Title (shop name), Tax Rate (%), Language (English / Myanmar), Application Mode (<strong>Retail Mode</strong> or <strong>Bakery</strong> with expiry tracking), and Theme (<strong>Light Mode / Dark Mode</strong>).</li>
                                <li><strong>Printer:</strong> Choose Direct Web Bluetooth, RawBT Android App, or Browser Print and test with <strong>Test Print Receipt</strong>.</li>
                                <li><strong>Wi-Fi Sync:</strong> Sync Server and Counter devices on the same Wi-Fi by scanning QR codes.</li>
                                <li><strong>Backup &amp; Data:</strong> Export/Import JSON backup files offline, connect Google Drive backup, or delete data by month.</li>
                            </ul>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">3</span> Managing Categories</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('categories')">
                                <i class="fas fa-tags"></i> Go to Categories
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>Create categories before adding products (e.g., Drinks, Snacks, Electronics) so items are easy to filter during sales.</p>
                            <ol>
                                <li>Open <strong>Categories</strong> and click <strong>Add Category</strong>.</li>
                                <li>Enter the category name and click <strong>Save</strong>.</li>
                            </ol>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">4</span> Adding Products</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('products')">
                                <i class="fas fa-box-open"></i> Go to Products
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <ol>
                                <li>Open <strong>Products</strong> and click <strong>Add Product</strong>.</li>
                                <li>Fill in Product Name, optional Barcode (use the <strong>Scan</strong> button for camera scanning), Category, Selling Price, and optional Image.</li>
                                <li>Click <strong>Save Product</strong>.</li>
                            </ol>
                            <div class="guide-tip-box">
                                <strong>Important:</strong> New products start with 0 stock. Add inventory via <strong>Purchases</strong> (Step 5) before selling.
                            </div>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">5</span> Recording Purchases &amp; Adding Stock</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('purchases')">
                                <i class="fas fa-truck-loading"></i> Go to Purchases
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>Adding a purchase automatically increases stock quantity and tracks your purchase costs for profit reports.</p>
                            <ol>
                                <li>Open <strong>Purchases</strong> and click <strong>Add Purchase</strong>.</li>
                                <li>Select Category and Product, then enter Quantity and Unit Cost (or Total Cost).</li>
                                <li>Optionally update the product's Selling Price right inside the modal. In Bakery Mode, also set the Expiration Date.</li>
                                <li>Click <strong>Save Purchase</strong>. You can filter purchases by date/month or export CSV/PDF.</li>
                            </ol>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">6</span> Stock Management</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('stock')">
                                <i class="fas fa-warehouse"></i> Go to Stock
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <ul>
                                <li>Monitor real-time stock quantities (automatically increased by Purchases and deducted by completed Sales).</li>
                                <li>Set each product's <strong>Low Threshold</strong> so items turn red (<strong>Low Stock</strong>) when running low.</li>
                                <li>Toggle <strong>Low Stock Only</strong> to quickly view items that need restocking.</li>
                            </ul>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">7</span> Making a New Sale</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-success" onclick="navigateTo('orders')">
                                <i class="fas fa-cash-register"></i> Go to New Sale
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <ol>
                                <li>Tap product cards or scan a Barcode using the <strong>Scan</strong> button to add items to the cart.</li>
                                <li>Adjust quantities with <strong>+ / -</strong>, enter any Discount, and choose Payment Method (Cash / KBZ Pay).</li>
                                <li>Click <strong>Complete</strong> and confirm. From the receipt popup, you can Print Thermal, Save Image, or Share.</li>
                            </ol>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">8</span> Checking Sale History</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('sale-history')">
                                <i class="fas fa-history"></i> Go to Sale History
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <ul>
                                <li>Filter past sales by All, Date, or Month.</li>
                                <li>Click the eye icon to inspect full receipt details or reprint, or export records as CSV/PDF.</li>
                            </ul>
                        </div>
                    </div>

                    <div class="guide-item-card">
                        <div class="guide-item-header">
                            <h3 class="guide-item-title"><span class="guide-step-badge">9</span> Generating Reports</h3>
                            <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="navigateTo('reports')">
                                <i class="fas fa-chart-bar"></i> Go to Reports
                            </button>
                        </div>
                        <div class="guide-item-body">
                            <p>Open <strong>Reports</strong> to generate Daily or Monthly summaries showing Total Revenue, Total Cost, Net Profit, Cash Sales, and KBZ Pay Sales.</p>
                        </div>
                    </div>
                </div>
            `;
        }
    };

    const AD_ALLOWED_SECTIONS = new Set(['home', 'daily-review', 'orders', 'sale-history', 'todo']);
    let adDismissedInSession = false;
    let activeAdsList = [];
    let currentAdIndex = 0;
    let adFetchToken = 0;

    function getSafeAdUrl(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url.trim());
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
        } catch {}
        return '';
    }

    function renderAdModalSlide(index) {
        if (!activeAdsList.length) return;
        currentAdIndex = (index + activeAdsList.length) % activeAdsList.length;
        const currentAd = activeAdsList[currentAdIndex];

        const titleEl = document.getElementById('ad-modal-title');
        const bodyEl = document.getElementById('ad-modal-body');
        titleEl.textContent = currentAd.title || '';

        const slidesHtml = activeAdsList.map((ad, idx) => {
            const safeUrl = getSafeAdUrl(ad.link_url);
            const imgTag = `<img src="${escapeHtml(ad.image_data)}" alt="${escapeHtml(ad.title || 'Ad')}">`;
            const content = safeUrl
                ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${imgTag}</a>`
                : imgTag;
            return `<div class="ad-slide ${idx === currentAdIndex ? 'active' : ''}">${content}</div>`;
        }).join('');

        const navBtns = activeAdsList.length > 1
            ? `<button type="button" class="ad-nav-btn prev" id="ad-prev-btn"><i class="fas fa-chevron-left"></i></button>
               <button type="button" class="ad-nav-btn next" id="ad-next-btn"><i class="fas fa-chevron-right"></i></button>`
            : '';

        const dotsHtml = activeAdsList.length > 1
            ? `<div class="ad-dots">${activeAdsList.map((_, idx) => `<button type="button" class="ad-dot ${idx === currentAdIndex ? 'active' : ''}" data-ad-dot="${idx}"></button>`).join('')}</div>`
            : '';

        const safeCurrentUrl = getSafeAdUrl(currentAd.link_url);
        const linkBtnHtml = safeCurrentUrl
            ? `<div class="ad-link-row"><a href="${escapeHtml(safeCurrentUrl)}" target="_blank" rel="noopener noreferrer" class="akmbtn akmbtn-sm akmbtn-primary"><i class="fas fa-external-link-alt"></i> Link ဖွင့်ကြည့်ရန်</a></div>`
            : '';

        bodyEl.innerHTML = `
            <div class="ad-slider-wrap">
                ${navBtns}
                ${slidesHtml}
            </div>
            ${dotsHtml}
            ${linkBtnHtml}
        `;

        if (activeAdsList.length > 1) {
            document.getElementById('ad-prev-btn')?.addEventListener('click', () => renderAdModalSlide(currentAdIndex - 1));
            document.getElementById('ad-next-btn')?.addEventListener('click', () => renderAdModalSlide(currentAdIndex + 1));
            bodyEl.querySelectorAll('[data-ad-dot]').forEach(dot => {
                dot.addEventListener('click', () => renderAdModalSlide(Number(dot.dataset.adDot)));
            });
        }
    }

    async function maybeShowAdModalForSection(section) {
        if (adDismissedInSession) return;
        if (!AD_ALLOWED_SECTIONS.has(section)) {
            closeModal('ad-popup-modal');
            return;
        }
        if (!navigator.onLine || typeof window.supabase === 'undefined') return;
        if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT_ID') || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') return;

        const token = ++adFetchToken;
        try {
            const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: { persistSession: false }
            });
            const { data, error } = await sb.rpc('get_pos_ads');
            if (error) throw error;

            if (token !== adFetchToken || adDismissedInSession || state.currentSection !== section) return;

            const ads = Array.isArray(data) ? data.filter(a => a && a.image_data) : [];
            if (ads.length === 0) {
                activeAdsList = [];
                closeModal('ad-popup-modal');
                return;
            }

            activeAdsList = ads;
            renderAdModalSlide(0);
            openModal('ad-popup-modal');
        } catch (err) {
            console.debug('Ad load skipped:', err.message);
        }
    }

    window.navigateTo = function(section, isHistoryNavigation = false) {
        if (state.currentSection === section && section !== 'home') return;
        state.currentSection = section;

        if (!isHistoryNavigation) {
            navHistory = navHistory.slice(0, currentHistoryIndex + 1);
            navHistory.push(section);
            currentHistoryIndex++;
        }

        updateBottomNavUI();
        render();
        maybeShowAdModalForSection(section);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function updateBottomNavUI() {
        const backBtn = document.getElementById('nav-btn-back');
        const forwardBtn = document.getElementById('nav-btn-forward');
        const homeBtn = document.getElementById('nav-btn-home');

        if (currentHistoryIndex > 0) backBtn.classList.remove('disabled-nav');
        else backBtn.classList.add('disabled-nav');

        if (currentHistoryIndex < navHistory.length - 1) forwardBtn.classList.remove('disabled-nav');
        else forwardBtn.classList.add('disabled-nav');

        homeBtn.classList.toggle('active', state.currentSection === 'home');
    }

    document.getElementById('nav-btn-back').addEventListener('click', (e) => {
        e.preventDefault();
        if (currentHistoryIndex > 0) {
            currentHistoryIndex--;
            navigateTo(navHistory[currentHistoryIndex], true);
        }
    });

    document.getElementById('nav-btn-forward').addEventListener('click', (e) => {
        e.preventDefault();
        if (currentHistoryIndex < navHistory.length - 1) {
            currentHistoryIndex++;
            navigateTo(navHistory[currentHistoryIndex], true);
        }
    });
    
    document.getElementById('nav-btn-home').addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('home');
    });

    async function render() {
        UIElements.sections.forEach(sec => sec.style.display = 'none');
        const currentSectionEl = document.getElementById(`${state.currentSection}-section`);
        if (currentSectionEl) {
            currentSectionEl.style.display = 'block';
        }
        switch (state.currentSection) {
            case 'home': renderHomePage(); break;
            case 'user-guide': renderUserGuidePage(); break;
            case 'daily-review': await renderDailyReviewPage(); break;
            case 'orders': await renderOrdersPage(); break;
            case 'products': await renderProductsPage(); break;
            case 'categories': await renderCategoriesPage(); break;
            case 'purchases': await renderPurchasesPage(); break;
            case 'stock': await renderStockPage(); break;
            case 'expiring-soon': await renderExpiringSoonPage(); break;
            case 'sale-history': await renderSaleHistoryPage(); break; 
            case 'settings': await renderSettingsPage(); break;
            case 'reports': await renderReportsPage(); break;
            case 'household-budget': await renderHouseholdBudgetPage(); break;
            case 'hr-management': await renderHRPage(); break;
            case 'todo': await renderTodoPage(); break;
        }
        
        UIElements.sidebarLinks.forEach(link => {
            link.classList.toggle('active', link.dataset.section === state.currentSection);
        });
    }

    function renderHomePage() {
        const dateEl = document.getElementById('home-current-date');
        if (dateEl) {
            const today = new Date();
            dateEl.textContent = today.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
        }
        document.getElementById('home-expiring-soon-btn').style.display = state.appMode === 'bakery' ? 'flex' : 'none';
    }

    async function renderDailyReviewPage() {
        const todayStr = new Date().toISOString().slice(0, 10);
        const [allOrders, products, stock] = await Promise.all([
            db.getAll('orders'),
            db.getAll('products'),
            db.getAll('stock')
        ]);

        const todayOrders = allOrders.filter(o => o.status === 'completed' && o.date === todayStr);
        const todaySales = todayOrders.reduce((acc, o) => acc + (o.total || 0), 0);
        const lowStockCount = stock.filter(s => s.quantity <= (s.lowThreshold || 10)).length;

        document.getElementById('home-today-sales').textContent = formatCurrency(todaySales);
        document.getElementById('home-today-orders').textContent = todayOrders.length;
        document.getElementById('home-total-products').textContent = products.length;
        document.getElementById('home-low-stock').textContent = lowStockCount;

        const recentOrders = allOrders
            .filter(o => o.status === 'completed')
            .sort((a,b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5);

        const tableBody = document.getElementById('home-recent-sales-table');
        if (recentOrders.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; opacity: 0.7;">${getTranslation('empty_no_sales_found')}</td></tr>`;
        } else {
            tableBody.innerHTML = recentOrders.map(o => `
                <tr>
                    <td>#${o.id.slice(-6)}</td>
                    <td>${o.date}</td>
                    <td><strong>${formatCurrency(o.total)}</strong></td>
                    <td><span class="akmstock-status normal">${o.paymentMethod || 'Cash'}</span></td>
                </tr>
            `).join('');
        }
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeTodo(todo, fallbackIndex = 0) {
        return {
            ...todo,
            category: todo.category || 'general',
            priority: todo.priority || 'medium',
            dueDate: todo.dueDate || '',
            subtasks: Array.isArray(todo.subtasks) ? todo.subtasks : [],
            order: typeof todo.order === 'number' ? todo.order : (todo.createdAt || fallbackIndex)
        };
    }

    function getTodoCategoryLabel(cat) {
        const map = {
            shop: getTranslation('todo_cat_shop'),
            finance: getTranslation('todo_cat_finance'),
            inventory: getTranslation('todo_cat_inventory'),
            general: getTranslation('todo_cat_general')
        };
        return map[cat] || map.general;
    }

    function getTodoPriorityLabel(prio) {
        const map = {
            high: getTranslation('todo_prio_high'),
            medium: getTranslation('todo_prio_medium'),
            low: getTranslation('todo_prio_low')
        };
        return map[prio] || map.medium;
    }

    function getDueState(todo) {
        if (!todo.dueDate || todo.status === 'completed') return 'none';
        const dueMs = new Date(todo.dueDate).getTime();
        if (isNaN(dueMs)) return 'none';
        const nowMs = Date.now();
        if (dueMs < nowMs) return 'overdue';
        if (dueMs - nowMs <= 24 * 60 * 60 * 1000) return 'duesoon';
        return 'upcoming';
    }

    function formatDueDisplay(dueDateStr) {
        if (!dueDateStr) return '';
        const d = new Date(dueDateStr);
        if (isNaN(d.getTime())) return dueDateStr;
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    window.setTodoStatusFilter = function(statusFilter) {
        state.todoStatusFilter = statusFilter;
        document.querySelectorAll('#todo-status-tabs .akmcategory-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.todoFilter === statusFilter);
        });
        renderTodoPage();
    };

    window.requestTodoReminderPermission = async function() {
        if (!('Notification' in window)) {
            alert(getTranslation('todo_notif_unsupported'));
            return;
        }
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            alert(getTranslation('todo_notif_enabled'));
            checkTodoReminders();
        } else {
            alert(getTranslation('todo_notif_denied'));
        }
    };

    async function checkTodoReminders() {
        if (!dbInstance) return;
        const rawTodos = await db.getAll('todos');
        const todos = rawTodos.map((t, idx) => normalizeTodo(t, idx));
        const overdueList = todos.filter(t => getDueState(t) === 'overdue');

        if ('Notification' in window && Notification.permission === 'granted') {
            overdueList.forEach(t => {
                if (!state.todoNotifiedIds.has(t.id)) {
                    state.todoNotifiedIds.add(t.id);
                    try {
                        new Notification('Free Free POS! - Task Overdue', {
                            body: `${t.text} (${formatDueDisplay(t.dueDate)})`
                        });
                    } catch (e) {}
                }
            });
        }
    }

    window.renderTodoPage = async function() {
        const rawTodos = await db.getAll('todos');
        const allTodos = rawTodos.map((t, idx) => normalizeTodo(t, idx));
        allTodos.sort((a, b) => a.order - b.order);

        let needsOrderNormalize = rawTodos.some(t => typeof t.order !== 'number');
        if (needsOrderNormalize) {
            for (let i = 0; i < allTodos.length; i++) {
                allTodos[i].order = i + 1;
                await db.put('todos', allTodos[i]);
            }
        }

        const pendingCount = allTodos.filter(t => t.status === 'pending').length;
        const completedCount = allTodos.filter(t => t.status === 'completed').length;
        const overdueCount = allTodos.filter(t => getDueState(t) === 'overdue').length;

        document.getElementById('todo-stat-all').textContent = allTodos.length;
        document.getElementById('todo-stat-pending').textContent = pendingCount;
        document.getElementById('todo-stat-completed').textContent = completedCount;
        document.getElementById('todo-stat-overdue').textContent = overdueCount;

        const banner = document.getElementById('todo-overdue-banner');
        const bannerText = document.getElementById('todo-overdue-banner-text');
        if (overdueCount > 0) {
            banner.style.display = 'flex';
            bannerText.textContent = getTranslation('todo_overdue_warning_msg', { count: overdueCount });
        } else {
            banner.style.display = 'none';
        }

        const statusFilter = state.todoStatusFilter || 'all';
        const catFilter = document.getElementById('todo-category-filter')?.value || 'all';
        const searchTerm = (document.getElementById('todo-search-input')?.value || '').trim().toLowerCase();

        const filteredTodos = allTodos.filter(todo => {
            if (statusFilter !== 'all' && todo.status !== statusFilter) return false;
            if (catFilter !== 'all' && todo.category !== catFilter) return false;
            if (searchTerm) {
                const matchMain = todo.text.toLowerCase().includes(searchTerm);
                const matchCat = getTodoCategoryLabel(todo.category).toLowerCase().includes(searchTerm);
                const matchSub = todo.subtasks.some(s => s.text.toLowerCase().includes(searchTerm));
                if (!matchMain && !matchCat && !matchSub) return false;
            }
            return true;
        });

        const container = document.getElementById('todo-list-container');
        if (filteredTodos.length === 0) {
            container.innerHTML = `<div class="akmempty-state"><i class="fas fa-tasks"></i><p>${getTranslation('todo_empty')}</p></div>`;
            return;
        }

        container.innerHTML = filteredTodos.map((todo, idx) => {
            const dueState = getDueState(todo);
            const totalSubs = todo.subtasks.length;
            const doneSubs = todo.subtasks.filter(s => s.completed).length;
            const subPercent = totalSubs > 0 ? Math.round((doneSubs / totalSubs) * 100) : 0;

            let dueBadgeHtml = '';
            if (todo.dueDate) {
                const formattedDue = formatDueDisplay(todo.dueDate);
                if (dueState === 'overdue') {
                    dueBadgeHtml = `<span class="todo-badge todo-badge-overdue"><i class="fas fa-exclamation-triangle"></i> ${getTranslation('todo_overdue')}: ${escapeHtml(formattedDue)}</span>`;
                } else if (dueState === 'duesoon') {
                    dueBadgeHtml = `<span class="todo-badge todo-badge-duesoon"><i class="fas fa-clock"></i> ${getTranslation('todo_due_soon')}: ${escapeHtml(formattedDue)}</span>`;
                } else {
                    dueBadgeHtml = `<span class="todo-badge todo-badge-due"><i class="far fa-calendar-alt"></i> ${escapeHtml(formattedDue)}</span>`;
                }
            }

            const subtasksHtml = todo.subtasks.map(sub => `
                <div class="todo-subtask-item ${sub.completed ? 'done' : ''}">
                    <input type="checkbox" ${sub.completed ? 'checked' : ''} onchange="toggleSubtask('${todo.id}', '${sub.id}')">
                    <span style="flex:1; cursor:pointer;" onclick="toggleSubtask('${todo.id}', '${sub.id}')">${escapeHtml(sub.text)}</span>
                    <button type="button" class="todo-subtask-del" onclick="deleteSubtask('${todo.id}', '${sub.id}')" title="Delete Subtask"><i class="fas fa-times"></i></button>
                </div>
            `).join('');

            const progressHtml = totalSubs > 0 ? `
                <div class="todo-subtask-progress-row">
                    <span><i class="fas fa-check-double"></i> ${doneSubs}/${totalSubs}</span>
                    <div class="todo-progress-track">
                        <div class="todo-progress-fill" style="width: ${subPercent}%;"></div>
                    </div>
                    <span>${subPercent}%</span>
                </div>
            ` : '';

            return `
            <div class="todo-card priority-${escapeHtml(todo.priority)} ${todo.status === 'completed' ? 'completed' : ''} ${dueState === 'overdue' ? 'overdue-task' : ''}"
                 draggable="true"
                 data-todo-id="${todo.id}"
                 ondragstart="handleTodoDragStart(event, '${todo.id}')"
                 ondragover="handleTodoDragOver(event)"
                 ondragleave="handleTodoDragLeave(event)"
                 ondrop="handleTodoDrop(event, '${todo.id}')"
                 ondragend="handleTodoDragEnd(event)">
                <div class="todo-card-header">
                    <span class="todo-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
                    <input type="checkbox" class="todo-checkbox" ${todo.status === 'completed' ? 'checked' : ''} onchange="toggleTodo('${todo.id}')">
                    <div class="todo-main-content">
                        <div class="todo-title-row">
                            <span class="todo-text" onclick="toggleTodo('${todo.id}')">${escapeHtml(todo.text)}</span>
                        </div>
                        <div class="todo-meta-row">
                            <span class="todo-badge todo-badge-priority-${escapeHtml(todo.priority)}">
                                <i class="fas fa-flag"></i> ${escapeHtml(getTodoPriorityLabel(todo.priority))}
                            </span>
                            <span class="todo-badge todo-badge-category">
                                <i class="fas fa-tag"></i> ${escapeHtml(getTodoCategoryLabel(todo.category))}
                            </span>
                            ${dueBadgeHtml}
                        </div>
                    </div>
                    <div class="todo-actions-group">
                        <button type="button" class="todo-icon-btn" onclick="moveTodoOrder('${todo.id}', -1)" ${idx === 0 ? 'disabled style="opacity:0.35;cursor:not-allowed;"' : ''} title="Move Up"><i class="fas fa-arrow-up"></i></button>
                        <button type="button" class="todo-icon-btn" onclick="moveTodoOrder('${todo.id}', 1)" ${idx === filteredTodos.length - 1 ? 'disabled style="opacity:0.35;cursor:not-allowed;"' : ''} title="Move Down"><i class="fas fa-arrow-down"></i></button>
                        <button type="button" class="todo-icon-btn" onclick="openEditTodoModal('${todo.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                        <button type="button" class="todo-icon-btn danger" onclick="deleteTodo('${todo.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div class="todo-subtasks-box">
                    ${progressHtml}
                    ${totalSubs > 0 ? `<div class="todo-subtask-list">${subtasksHtml}</div>` : ''}
                    <div class="todo-subtask-add-row">
                        <input type="text" id="subtask-input-${todo.id}" class="todo-subtask-input"
                               placeholder="${escapeHtml(getTranslation('todo_subtask_placeholder'))}"
                               onkeypress="if(event.key==='Enter'){ addSubtask('${todo.id}'); }">
                        <button type="button" class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="addSubtask('${todo.id}')">
                            <i class="fas fa-plus"></i> ${escapeHtml(getTranslation('todo_add_subtask'))}
                        </button>
                    </div>
                </div>
            </div>
            `;
        }).join('');
    };

    window.addTodo = async function() {
        const input = document.getElementById('new-todo-input');
        const text = input.value.trim();
        if (!text) return;

        const category = document.getElementById('new-todo-category').value || 'general';
        const priority = document.getElementById('new-todo-priority').value || 'medium';
        const dueDate = document.getElementById('new-todo-due').value || '';

        const existingTodos = await db.getAll('todos');
        const maxOrder = existingTodos.reduce((max, t) => Math.max(max, typeof t.order === 'number' ? t.order : 0), 0);

        await db.add('todos', {
            id: `todo-${Date.now()}`,
            text: text,
            status: 'pending',
            category,
            priority,
            dueDate,
            subtasks: [],
            order: maxOrder + 1,
            createdAt: Date.now()
        });
        
        input.value = '';
        document.getElementById('new-todo-due').value = '';
        renderTodoPage();
    };

    window.openEditTodoModal = async function(id) {
        const raw = await db.get('todos', id);
        if (!raw) return;
        const todo = normalizeTodo(raw);
        document.getElementById('edit-todo-id').value = todo.id;
        document.getElementById('edit-todo-text').value = todo.text;
        document.getElementById('edit-todo-category').value = todo.category;
        document.getElementById('edit-todo-priority').value = todo.priority;
        document.getElementById('edit-todo-due').value = todo.dueDate || '';
        openModal('todo-edit-modal');
    };

    window.saveEditedTodo = async function() {
        const id = document.getElementById('edit-todo-id').value;
        const text = document.getElementById('edit-todo-text').value.trim();
        if (!text) {
            alert(getTranslation('alert_fill_all_fields'));
            return;
        }
        const raw = await db.get('todos', id);
        if (!raw) return;
        const todo = normalizeTodo(raw);
        todo.text = text;
        todo.category = document.getElementById('edit-todo-category').value;
        todo.priority = document.getElementById('edit-todo-priority').value;
        todo.dueDate = document.getElementById('edit-todo-due').value || '';
        await db.put('todos', todo);
        closeModal('todo-edit-modal');
        renderTodoPage();
    };

    window.toggleTodo = async function(id) {
        const todo = await db.get('todos', id);
        if (todo) {
            todo.status = todo.status === 'pending' ? 'completed' : 'pending';
            await db.put('todos', todo);
            renderTodoPage();
        }
    };

    window.deleteTodo = async function(id) {
        if(confirm(getTranslation('confirm_delete_item_msg', { type: getTranslation('menu_todo') }))) {
            await db.delete('todos', id);
            renderTodoPage();
        }
    };

    window.addSubtask = async function(todoId) {
        const input = document.getElementById(`subtask-input-${todoId}`);
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;

        const raw = await db.get('todos', todoId);
        if (!raw) return;
        const todo = normalizeTodo(raw);
        todo.subtasks.push({
            id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            text,
            completed: false
        });
        await db.put('todos', todo);
        renderTodoPage();
    };

    window.toggleSubtask = async function(todoId, subId) {
        const raw = await db.get('todos', todoId);
        if (!raw) return;
        const todo = normalizeTodo(raw);
        const sub = todo.subtasks.find(s => s.id === subId);
        if (sub) {
            sub.completed = !sub.completed;
            await db.put('todos', todo);
            renderTodoPage();
        }
    };

    window.deleteSubtask = async function(todoId, subId) {
        const raw = await db.get('todos', todoId);
        if (!raw) return;
        const todo = normalizeTodo(raw);
        todo.subtasks = todo.subtasks.filter(s => s.id !== subId);
        await db.put('todos', todo);
        renderTodoPage();
    };

    window.handleTodoDragStart = function(e, id) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) {
            e.preventDefault();
            return;
        }
        state.draggedTodoId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        e.currentTarget.classList.add('dragging');
    };

    window.handleTodoDragOver = function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drag-over');
    };

    window.handleTodoDragLeave = function(e) {
        e.currentTarget.classList.remove('drag-over');
    };

    window.handleTodoDragEnd = function(e) {
        e.currentTarget.classList.remove('dragging');
        document.querySelectorAll('.todo-card').forEach(el => el.classList.remove('drag-over'));
        state.draggedTodoId = null;
    };

    window.handleTodoDrop = async function(e, targetId) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        const draggedId = state.draggedTodoId || e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === targetId) return;

        const rawTodos = await db.getAll('todos');
        const allTodos = rawTodos.map((t, idx) => normalizeTodo(t, idx)).sort((a, b) => a.order - b.order);

        const fromIdx = allTodos.findIndex(t => t.id === draggedId);
        const toIdx = allTodos.findIndex(t => t.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;

        const [movedItem] = allTodos.splice(fromIdx, 1);
        allTodos.splice(toIdx, 0, movedItem);

        for (let i = 0; i < allTodos.length; i++) {
            allTodos[i].order = i + 1;
            await db.put('todos', allTodos[i]);
        }
        renderTodoPage();
    };

    window.moveTodoOrder = async function(todoId, direction) {
        const rawTodos = await db.getAll('todos');
        const allTodos = rawTodos.map((t, idx) => normalizeTodo(t, idx)).sort((a, b) => a.order - b.order);

        const visibleCards = Array.from(document.querySelectorAll('#todo-list-container .todo-card')).map(el => el.dataset.todoId);
        const visibleIdx = visibleCards.indexOf(todoId);
        const swapVisibleIdx = visibleIdx + direction;
        if (visibleIdx === -1 || swapVisibleIdx < 0 || swapVisibleIdx >= visibleCards.length) return;

        const targetId = visibleCards[swapVisibleIdx];
        const idxA = allTodos.findIndex(t => t.id === todoId);
        const idxB = allTodos.findIndex(t => t.id === targetId);
        if (idxA === -1 || idxB === -1) return;

        const temp = allTodos[idxA];
        allTodos[idxA] = allTodos[idxB];
        allTodos[idxB] = temp;

        for (let i = 0; i < allTodos.length; i++) {
            allTodos[i].order = i + 1;
            await db.put('todos', allTodos[i]);
        }
        renderTodoPage();
    };

    async function renderProductsPage() { 
        const searchInput = document.getElementById('products-search-input');
        const catFilter = document.getElementById('product-category-filter');
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : ''; 
        const categoryFilter = catFilter ? catFilter.value : 'all'; 
        const allProducts = await db.getAll('products'); 
        const filteredProducts = allProducts.filter(p => { 
            const matchesSearch = p.name.toLowerCase().includes(searchTerm) || (p.barcode && p.barcode.includes(searchTerm)); 
            const matchesCategory = (categoryFilter === 'all' || p.categoryId === categoryFilter); 
            return matchesSearch && matchesCategory; 
        }); 
        const totalPages = Math.ceil(filteredProducts.length / state.productsPerPage) || 1; 
        state.productsPage = Math.min(state.productsPage, totalPages); 
        const startIndex = (state.productsPage - 1) * state.productsPerPage; 
        const endIndex = startIndex + state.productsPerPage; 
        const paginatedProducts = filteredProducts.slice(startIndex, endIndex); 
        const tbody = document.getElementById('products-table');
        
        if (paginatedProducts.length === 0 && searchTerm === '' && categoryFilter === 'all') { 
            tbody.innerHTML = `<tr><td colspan="5"><div class="akmempty-state"><i class="fas fa-box-open"></i><p>${getTranslation('empty_no_products_yet')}</p></div></td></tr>`; 
            document.getElementById('products-pagination').style.display = 'none'; 
        } else if (paginatedProducts.length === 0) { 
            tbody.innerHTML = `<tr><td colspan="5"><div class="akmempty-state"><i class="fas fa-search"></i><p>${getTranslation('empty_no_products_match')}</p></div></td></tr>`; 
            document.getElementById('products-pagination').style.display = 'none'; 
        } else { 
            document.getElementById('products-pagination').style.display = 'flex'; 
            document.getElementById('pagination-info').textContent = getTranslation('pagination_info', { current: state.productsPage, total: totalPages }); 
            document.getElementById('prev-page-btn').disabled = state.productsPage === 1; 
            document.getElementById('next-page-btn').disabled = state.productsPage === totalPages; 
            const categories = await db.getAll('categories'); 
            tbody.innerHTML = paginatedProducts.map(p => { 
                const category = categories.find(c => c.id === p.categoryId); 
                return ` <tr> <td> <img src="${p.image || ''}" class="akmproduct-table-image" alt="Product" data-id="${p.id}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block'"> <i class="fas fa-image" style="display:none; font-size: 24px; color: var(--border-color);"></i> </td> <td>${p.name}<br><small style="opacity:0.7;">${p.barcode || ''}</small></td> <td>${category ? category.name : getTranslation('label_uncategorized')}</td> <td>${formatCurrency(p.price)}</td> <td class="action-buttons"> <button class="akmbtn akmbtn-sm akmbtn-outline-primary" data-action="edit-product" data-id="${p.id}"><i class="fas fa-edit"></i></button> <button class="akmbtn akmbtn-sm akmbtn-danger" data-action="delete-product" data-id="${p.id}"><i class="fas fa-trash"></i></button> </td> </tr> `; 
            }).join(''); 
        } 
    }

    async function renderCategoriesPage() { 
        const [allCategories, products] = await Promise.all([db.getAll('categories'), db.getAll('products')]); 
        const tableBody = document.getElementById('categories-table'); 
        const totalPages = Math.ceil(allCategories.length / state.categoriesPerPage) || 1; 
        state.categoriesPage = Math.min(state.categoriesPage, totalPages); 
        const startIndex = (state.categoriesPage - 1) * state.categoriesPerPage; 
        const endIndex = startIndex + state.categoriesPerPage; 
        const paginatedCategories = allCategories.slice(startIndex, endIndex); 
        if (allCategories.length === 0) { 
            tableBody.innerHTML = `<tr><td colspan="3"><div class="akmempty-state"><i class="fas fa-tags"></i><p>${getTranslation('empty_no_categories')}</p></div></td></tr>`; 
            document.getElementById('categories-pagination').style.display = 'none'; 
            return; 
        } 
        document.getElementById('categories-pagination').style.display = 'flex'; 
        document.getElementById('category-pagination-info').textContent = getTranslation('pagination_info', { current: state.categoriesPage, total: totalPages }); 
        document.getElementById('prev-category-page-btn').disabled = state.categoriesPage === 1; 
        document.getElementById('next-category-page-btn').disabled = state.categoriesPage === totalPages; 
        tableBody.innerHTML = paginatedCategories.map(c => { 
            const productCount = products.filter(p => p.categoryId === c.id).length; 
            return ` <tr> <td>${c.name}</td> <td>${productCount}</td> <td class="action-buttons"> <button class="akmbtn akmbtn-sm akmbtn-outline-primary" data-action="edit-category" data-id="${c.id}"><i class="fas fa-edit"></i></button> <button class="akmbtn akmbtn-sm akmbtn-danger" data-action="delete-category" data-id="${c.id}"><i class="fas fa-trash"></i></button> </td> </tr> `; 
        }).join(''); 
    }

    async function renderOrdersPage() { 
        const categories = await db.getAll('categories'); 
        document.getElementById('category-tabs').innerHTML = `<button class="akmcategory-tab active" data-id="all">${getTranslation('filter_all')}</button>` + categories.map(c => `<button class="akmcategory-tab" data-id="${c.id}">${c.name}</button>`).join(''); 
        await renderProductsGrid('all'); 
        renderCurrentOrder(); 
    }

    async function renderProductsGrid(categoryId) { 
        document.querySelectorAll('.akmcategory-tab').forEach(tab => tab.classList.remove('active')); 
        const activeTab = document.querySelector(`.akmcategory-tab[data-id="${categoryId}"]`);
        if (activeTab) activeTab.classList.add('active'); 
        const searchTerm = document.getElementById('product-search').value.toLowerCase(); 
        const [products, stock] = await Promise.all([db.getAll('products'), db.getAll('stock')]); 
        const productsToShow = products.filter(p => { 
            const matchesCategory = (categoryId === 'all') || (p.categoryId === categoryId); 
            const matchesSearch = p.name.toLowerCase().includes(searchTerm) || (p.barcode && p.barcode.includes(searchTerm)); 
            return matchesCategory && matchesSearch; 
        }); 
        if (productsToShow.length === 0) { 
            document.getElementById('products-grid').innerHTML = `<div class="akmempty-state"><i class="fas fa-box-open"></i><p>${getTranslation('empty_no_products_in_category')}</p></div>`; 
            return; 
        } 
        document.getElementById('products-grid').innerHTML = productsToShow.map((p) => { 
            const stockItem = stock.find(s => s.productId === p.id); 
            const isOutOfStock = !stockItem || stockItem.quantity <= 0; 
            return ` <div class="akmproduct-card ${isOutOfStock ? 'disabled' : ''}" data-id="${p.id}"> <div class="akmproduct-image"> ${p.image ? `<img src="${p.image}" alt="${p.name}">` : '<i class="fas fa-box"></i>'} </div> <div class="akmproduct-details"> <div class="akmproduct-name">${p.name}</div> <div class="akmproduct-price">${formatCurrency(p.price)}</div> </div> ${isOutOfStock ? `<div class="akmout-of-stock">${getTranslation('label_out_of_stock')}</div>` : ''} </div> `; 
        }).join(''); 
    }

    function renderCurrentOrder() { 
        const order = state.currentOrder; 
        document.getElementById('order-tax-label').textContent = getTranslation('label_tax_rate_value', { rate: state.taxRate }); 
        if (!order) { 
            document.getElementById('current-order-id').textContent = '-'; 
            document.getElementById('order-items-list').innerHTML = `<tr><td colspan="4"><div class="akmempty-state" style="padding:10px;"><p style="font-size:0.8rem; margin:0;">${getTranslation('empty_no_items_added')}</p></div></td></tr>`; 
            document.getElementById('order-subtotal').textContent = formatCurrency(0); 
            document.getElementById('order-discount').value = ''; 
            document.getElementById('order-tax').textContent = formatCurrency(0); 
            document.getElementById('order-total').textContent = formatCurrency(0); 
            document.getElementById('complete-order-btn').disabled = true; 
            document.getElementById('cancel-order-btn').disabled = true; 
            return; 
        } 
        document.getElementById('current-order-id').textContent = `${order.id.slice(-5)}`; 
        document.getElementById('order-items-list').innerHTML = order.items.length > 0 ? order.items.map(item => ` <tr> <td>${item.name}</td> <td> <button class="akmbtn akmbtn-sm akmbtn-secondary" data-action="decrease-qty" data-id="${item.productId}">-</button> <span style="display: inline-block; width: 25px; text-align: center;">${item.quantity}</span> <button class="akmbtn akmbtn-sm akmbtn-secondary" data-action="increase-qty" data-id="${item.productId}">+</button> </td> <td>${formatCurrency(item.price)}</td> <td>${formatCurrency(item.price * item.quantity)}</td> </tr> `).join('') : `<tr><td colspan="4"><div class="akmempty-state" style="padding:10px;"><p style="font-size:0.8rem; margin:0;">${getTranslation('empty_no_items_added')}</p></div></td></tr>`; 
        const subtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0); 
        const discount = parseFloat(document.getElementById('order-discount').value) || 0; 
        const taxableAmount = Math.max(0, subtotal - discount); 
        const tax = taxableAmount * (state.taxRate / 100); 
        const total = taxableAmount + tax; 
        order.subtotal = subtotal; 
        order.discount = discount; 
        order.tax = tax; 
        order.total = total; 
        if(order.paymentMethod) { 
            document.getElementById('order-payment-method').value = order.paymentMethod; 
        } else { 
            order.paymentMethod = document.getElementById('order-payment-method').value; 
        } 
        document.getElementById('order-subtotal').textContent = formatCurrency(subtotal); 
        document.getElementById('order-tax').textContent = formatCurrency(tax); 
        document.getElementById('order-total').textContent = formatCurrency(total); 
        document.getElementById('complete-order-btn').disabled = order.items.length === 0; 
        document.getElementById('cancel-order-btn').disabled = false; 
    }

    async function renderPurchasesPage() { 
        const tableBody = document.getElementById('purchases-table'); 
        let allPurchases = await db.getAll('purchases'); 
        let filteredPurchases = allPurchases; 
        const filterTypeEl = document.querySelector('input[name="purchase-filter-type"]:checked');
        const filterType = filterTypeEl ? filterTypeEl.value : 'date';
        const dateInput = document.getElementById('purchase-filter-date');
        if (filterType === 'date') { 
            if (!dateInput.value) dateInput.valueAsDate = new Date();
            const date = dateInput.value; 
            if (date) filteredPurchases = allPurchases.filter(p => p.dateTime.startsWith(date)); 
        } else if (filterType === 'month') { 
            const month = document.getElementById('purchase-filter-month').value; 
            const year = document.getElementById('purchase-filter-year').value; 
            if (month && year) { 
                const monthPadded = month.toString().padStart(2, '0'); 
                const filterPrefix = `${year}-${monthPadded}`; 
                filteredPurchases = allPurchases.filter(p => p.dateTime.startsWith(filterPrefix)); 
            } 
        } 
        state.filteredPurchases = filteredPurchases.sort((a,b) => new Date(b.dateTime) - new Date(a.dateTime)); 
        if (state.filteredPurchases.length === 0) { 
            tableBody.innerHTML = `<tr><td colspan="7"><div class="akmempty-state"><i class="fas fa-shopping-cart"></i><p>${getTranslation('empty_no_purchases_for_filter')}</p></div></td></tr>`; 
            return; 
        } 
        tableBody.innerHTML = state.filteredPurchases.map(p => ` <tr> <td>${p.productName}</td> <td>${p.supplier || '-'}</td> <td>${p.quantity}</td> <td>${formatCurrency(p.unitCost)}</td> <td>${formatCurrency(p.totalCost)}</td> <td>${new Date(p.dateTime).toLocaleString()}</td> <td class="action-buttons"> <button class="akmbtn akmbtn-sm akmbtn-danger" data-action="delete-purchase" data-id="${p.id}"><i class="fas fa-trash"></i></button> </td> </tr> `).join(''); 
    }

    async function renderStockPage() { 
        const [stock, products] = await Promise.all([ db.getAll('stock'), db.getAll('products') ]); 
        const searchTerm = document.getElementById('stock-search-input').value.toLowerCase(); 
        const categoryFilter = document.getElementById('stock-category-filter').value; 
        const showLowStockOnly = document.getElementById('stock-low-filter').checked; 
        const filteredProducts = products.filter(p => { 
            const matchesSearch = p.name.toLowerCase().includes(searchTerm) || (p.barcode && p.barcode.includes(searchTerm)); 
            const matchesCategory = (categoryFilter === 'all' || p.categoryId === categoryFilter); 
            return matchesSearch && matchesCategory; 
        }); 
        const filteredProductIds = new Set(filteredProducts.map(p => p.id)); 
        let filteredStock = stock.filter(s => filteredProductIds.has(s.productId)); 
        if (showLowStockOnly) { 
            filteredStock = filteredStock.filter(s => s.quantity <= s.lowThreshold); 
        } 
        const totalPages = Math.ceil(filteredStock.length / state.stockPerPage) || 1; 
        state.stockPage = Math.min(state.stockPage, totalPages); 
        const startIndex = (state.stockPage - 1) * state.stockPerPage; 
        const endIndex = startIndex + state.stockPerPage; 
        const paginatedStock = filteredStock.slice(startIndex, endIndex); 
        const tbody = document.getElementById('stock-table');
        
        if (paginatedStock.length === 0 && searchTerm === '' && categoryFilter === 'all' && !showLowStockOnly) { 
            tbody.innerHTML = `<tr><td colspan="4"><div class="akmempty-state"><i class="fas fa-warehouse"></i><p>${getTranslation('empty_no_stock')}</p></div></td></tr>`; 
            document.getElementById('stock-pagination').style.display = 'none'; 
        } else if (paginatedStock.length === 0) { 
            tbody.innerHTML = `<tr><td colspan="4"><div class="akmempty-state"><i class="fas fa-search"></i><p>${getTranslation('empty_no_stock_for_filter')}</p></div></td></tr>`; 
            document.getElementById('stock-pagination').style.display = 'none'; 
        } else { 
            document.getElementById('stock-pagination').style.display = 'flex'; 
            document.getElementById('stock-pagination-info').textContent = getTranslation('pagination_info', { current: state.stockPage, total: totalPages }); 
            document.getElementById('stock-prev-page-btn').disabled = state.stockPage === 1; 
            
            document.getElementById('stock-next-page-btn').disabled = state.stockPage === totalPages; 
            tbody.innerHTML = paginatedStock.map(s => { 
                const product = products.find(p => p.id === s.productId); 
                if (!product) return ''; 
                const statusClass = s.quantity <= s.lowThreshold ? 'low' : 'normal'; 
                const statusText = statusClass === 'low' ? getTranslation('label_low_stock') : getTranslation('label_in_stock'); 
                return ` <tr> <td>${product.name}<br><small style="opacity:0.7">${product.barcode || ''}</small></td> <td>${s.quantity}</td> <td> <input type="number" class="akmform-control akmstock-threshold-input" value="${s.lowThreshold}" min="0" data-product-id="${s.productId}"> </td> <td><span class="akmstock-status ${statusClass}">${statusText}</span></td> </tr> `; 
            }).join(''); 
        } 
    }

    async function renderExpiringSoonPage() { 
        const [allPurchases, products, categories] = await Promise.all([ db.getAll('purchases'), db.getAll('products'), db.getAll('categories') ]); 
        const daysFilter = parseInt(document.getElementById('expiring-days-filter').value) || 7; 
        const today = new Date(); 
        today.setHours(0, 0, 0, 0); 
        const expiryLimit = new Date(); 
        expiryLimit.setDate(today.getDate() + daysFilter); 
        const expiringPurchases = allPurchases.filter(p => { 
            if (!p.expiryDate) return false; 
            const expiry = new Date(p.expiryDate); 
            return expiry >= today && expiry <= expiryLimit; 
        }); 
        const searchTerm = document.getElementById('expiring-soon-search-input').value.toLowerCase(); 
        const categoryFilter = document.getElementById('expiring-soon-category-filter').value; 
        const filteredPurchases = expiringPurchases.filter(p => { 
            const product = products.find(prod => prod.id === p.productId); 
            if (!product) return false; 
            const matchesSearch = product.name.toLowerCase().includes(searchTerm); 
            const matchesCategory = (categoryFilter === 'all' || product.categoryId === categoryFilter); 
            return matchesSearch && matchesCategory; 
        }); 
        const totalPages = Math.ceil(filteredPurchases.length / state.expiringSoonPerPage) || 1; 
        state.expiringSoonPage = Math.min(state.expiringSoonPage, totalPages); 
        const startIndex = (state.expiringSoonPage - 1) * state.expiringSoonPerPage; 
        const endIndex = startIndex + state.expiringSoonPerPage; 
        const paginatedPurchases = filteredPurchases.slice(startIndex, endIndex); 
        const tbody = document.getElementById('expiring-soon-table');
        
        if (paginatedPurchases.length === 0) { 
            const emptyMessage = (searchTerm || categoryFilter !== 'all') ? getTranslation('empty_no_expiring_items_for_filter') : getTranslation('empty_no_expiring_items'); 
            tbody.innerHTML = `<tr><td colspan="5"><div class="akmempty-state"><i class="fas fa-hourglass-half"></i><p>${emptyMessage}</p></div></td></tr>`; 
            document.getElementById('expiring-soon-pagination').style.display = 'none'; 
        } else { 
            document.getElementById('expiring-soon-pagination').style.display = 'flex'; 
            document.getElementById('expiring-soon-pagination-info').textContent = getTranslation('pagination_info', { current: state.expiringSoonPage, total: totalPages }); 
            document.getElementById('expiring-soon-prev-page-btn').disabled = state.expiringSoonPage === 1; 
            document.getElementById('expiring-soon-next-page-btn').disabled = state.expiringSoonPage === totalPages; 
            tbody.innerHTML = paginatedPurchases.map(p => { 
                const product = products.find(prod => prod.id === p.productId); 
                const category = categories.find(c => c.id === product.categoryId); 
                return ` <tr> <td>${product.name}</td> <td>${category ? category.name : getTranslation('label_uncategorized')}</td> <td>${p.quantity}</td> <td>${p.expiryDate}</td> <td><span class="akmstock-status expiring">${getTranslation('label_expiring_soon')}</span></td> </tr> `; 
            }).join(''); 
        } 
    }

    async function renderSaleHistoryPage() { 
        const allSales = (await db.getAll('orders', 'status', 'completed')).sort((a,b) => new Date(b.date) - new Date(a.date)); 
        let filteredSales = allSales; 
        const filterType = document.querySelector('input[name="sale-filter-type"]:checked').value; 
        if (filterType === 'date') { 
            const date = document.getElementById('sale-history-filter-date').value; 
            if (date) filteredSales = allSales.filter(s => s.date === date); 
        } else if (filterType === 'month') { 
            const month = document.getElementById('sale-history-filter-month').value; 
            const year = document.getElementById('sale-history-filter-year').value; 
            if (month && year) { 
                const monthPadded = month.toString().padStart(2, '0'); 
                const filterPrefix = `${year}-${monthPadded}`; 
                filteredSales = allSales.filter(s => s.date.startsWith(filterPrefix)); 
            } 
        } 
        state.filteredSales = filteredSales; 
        const totalPages = Math.ceil(filteredSales.length / state.saleHistoryPerPage) || 1; 
        state.saleHistoryPage = Math.min(state.saleHistoryPage, totalPages); 
        const startIndex = (state.saleHistoryPage - 1) * state.saleHistoryPerPage; 
        const endIndex = startIndex + state.saleHistoryPerPage; 
        const paginatedSales = filteredSales.slice(startIndex, endIndex); 
        const tbody = document.getElementById('sale-history-table');
        
        if (paginatedSales.length === 0) { 
            tbody.innerHTML = `<tr><td colspan="7"><div class="akmempty-state"><i class="fas fa-history"></i><p>${getTranslation('empty_no_sales_found')}</p></div></td></tr>`; 
            document.getElementById('sale-history-pagination').style.display = 'none'; 
        } else { 
            document.getElementById('sale-history-pagination').style.display = 'flex'; 
            document.getElementById('sale-history-pagination-info').textContent = getTranslation('pagination_info', { current: state.saleHistoryPage, total: totalPages }); 
            document.getElementById('sale-history-prev-page-btn').disabled = state.saleHistoryPage === 1; 
            document.getElementById('sale-history-next-page-btn').disabled = state.saleHistoryPage === totalPages; 
            tbody.innerHTML = paginatedSales.map(s => ` <tr> <td>#${s.id.slice(-8)}</td> <td>${s.date}</td> <td>${s.items.length}</td> <td>${s.paymentMethod || 'Cash'}</td> <td>${formatCurrency(s.discount || 0)}</td> <td>${formatCurrency(s.total)}</td> <td class="action-buttons"> <button class="akmbtn akmbtn-sm akmbtn-primary" data-action="view-sale" data-id="${s.id}"><i class="fas fa-eye"></i></button> <button class="akmbtn akmbtn-sm akmbtn-danger" data-action="delete-sale" data-id="${s.id}"><i class="fas fa-trash"></i></button> </td> </tr> `).join(''); 
        } 
    }

    async function renderSettingsPage() { 
        const [taxRate, receiptTitle, language, appMode, theme, printerType, syncRole, gdriveClientId] = await Promise.all([ 
            db.get('settings', 'taxRate'), 
            db.get('settings', 'receiptTitle'), 
            db.get('settings', 'language'), 
            db.get('settings', 'appMode'),
            db.get('settings', 'theme'),
            db.get('settings', 'printerType'),
            db.get('settings', 'syncRole'),
            db.get('settings', 'gdriveClientId')
        ]); 
        document.getElementById('tax-rate-setting').value = taxRate ? taxRate.value : 0; 
        document.getElementById('receipt-title-setting').value = receiptTitle ? receiptTitle.value : 'Free Free POS!'; 
        document.getElementById('language-select').value = language ? language.value : 'mm'; 
        document.getElementById('app-mode-select').value = appMode ? appMode.value : 'retail'; 
        document.getElementById('theme-select').value = theme ? theme.value : 'light'; 
        
        const pt = printerType ? printerType.value : 'bluetooth';
        document.getElementById('printer-type-select').value = pt;
        state.printerType = pt;

        state.syncRole = syncRole ? syncRole.value : 'standalone';
        document.getElementById('sync-role-select').value = state.syncRole;
        document.getElementById('gdrive-client-id').value = gdriveClientId ? gdriveClientId.value : '';

        updateSyncPanelVisibility();
        updateSyncStatusUI();
        switchSettingsTab(state.settingsTab || 'general');

        const deleteMonthSelect = document.getElementById('delete-data-month'); 
        const deleteYearInput = document.getElementById('delete-data-year'); 
        const monthNames = getTranslation('month_names'); 
        deleteMonthSelect.innerHTML = monthNames.map((name, index) => `<option value="${index + 1}">${name}</option>`).join(''); 
        if (!deleteYearInput.value) {
            deleteYearInput.value = new Date().getFullYear();
        }
    }

    async function renderReportsPage() { 
        const currentYear = new Date().getFullYear(); 
        const currentMonth = new Date().getMonth() + 1; 
        const reportYearInput = document.getElementById('report-year');
        if (!reportYearInput.value) {
            reportYearInput.value = currentYear;
        }
        const monthNames = getTranslation('month_names'); 
        const monthOptions = monthNames.map((name, index) => { 
            const monthValue = index + 1; 
            return `<option value="${monthValue}" ${monthValue === currentMonth ? 'selected' : ''}>${name}</option>`; 
        }); 
        document.getElementById('report-month').innerHTML = monthOptions.join(''); 
        document.getElementById('report-date').valueAsDate = new Date(); 
    }

    window.renderHouseholdBudgetPage = async function() {
        const transactions = await db.getAll('hh_transactions');
        const currMonthPrefix = new Date().toISOString().slice(0,7);
        let mIncome = 0, mExpense = 0;
        
        transactions.forEach(t => {
            if (t.type === 'income' && t.date.startsWith(currMonthPrefix)) mIncome += t.amount;
            if (t.type === 'expense' && t.date.startsWith(currMonthPrefix)) mExpense += t.amount;
        });

        document.getElementById('hh-income').textContent = formatCurrency(mIncome);
        document.getElementById('hh-expense').textContent = formatCurrency(mExpense);
        
        const filterMonth = document.getElementById('hh-filter-month').value;
        let displayTrans = transactions;
        if (filterMonth) {
            displayTrans = transactions.filter(t => t.date.startsWith(filterMonth));
        }

        const tTbody = document.getElementById('hh-transactions-table');
        if(displayTrans.length === 0) {
            tTbody.innerHTML = `<tr><td colspan="5" class="text-center" style="text-align: center; opacity: 0.7;">${getTranslation('hh_no_trans')}</td></tr>`;
        } else {
            tTbody.innerHTML = displayTrans.sort((a,b)=> new Date(b.date) - new Date(a.date)).map(t => {
                const color = t.type === 'income' ? 'var(--success-color)' : 'var(--danger-color)';
                const translatedType = getTranslation(`hh_type_${t.type}`) || t.type;
                return `
                <tr>
                    <td>${t.date}</td>
                    <td style="color:${color}; font-weight:bold;">${translatedType}</td>
                    <td>${t.category}</td>
                    <td><strong>${formatCurrency(t.amount)}</strong></td>
                    <td><button class="akmbtn akmbtn-sm akmbtn-danger" onclick="deleteHHTransaction('${t.id}')"><i class="fas fa-trash"></i></button></td>
                </tr>
            `}).join('');
        }
    }

    window.openHHTransactionModal = function() {
        document.getElementById('hh-trans-amount').value = '';
        document.getElementById('hh-trans-category').value = '';
        document.getElementById('hh-trans-date').value = new Date().toISOString().slice(0,10);
        document.getElementById('hh-trans-type').value = 'expense';
        openModal('hh-transaction-modal');
    };

    window.saveHHTransaction = async function() {
        const type = document.getElementById('hh-trans-type').value;
        const category = document.getElementById('hh-trans-category').value.trim();
        const amount = parseFloat(document.getElementById('hh-trans-amount').value);
        const date = document.getElementById('hh-trans-date').value;

        if(!category || isNaN(amount) || !date) { 
            alert(getTranslation('alert_fill_all_fields')); 
            return; 
        }

        await db.add('hh_transactions', { id: `hht-${Date.now()}`, type, category, amount, date });
        closeModal('hh-transaction-modal');
        renderHouseholdBudgetPage();
    };

    window.deleteHHTransaction = async function(id) {
        if(confirm(getTranslation('confirm_delete_item_msg', { type: getTranslation('menu_household') }))) {
            await db.delete('hh_transactions', id);
            renderHouseholdBudgetPage();
        }
    };

    window.switchHRTab = function(tabName) {
        document.getElementById('hr-tab-employees').classList.toggle('active', tabName === 'employees');
        document.getElementById('hr-tab-attendance').classList.toggle('active', tabName === 'attendance');
        document.getElementById('hr-tab-payroll').classList.toggle('active', tabName === 'payroll');

        document.getElementById('hr-employees-view').style.display = tabName === 'employees' ? 'block' : 'none';
        document.getElementById('hr-attendance-view').style.display = tabName === 'attendance' ? 'block' : 'none';
        document.getElementById('hr-payroll-view').style.display = tabName === 'payroll' ? 'block' : 'none';
    };

    async function renderHRPage() {
        const [employees, attendances, payrolls] = await Promise.all([
            db.getAll('hr_employees'),
            db.getAll('hr_attendance'),
            db.getAll('hr_payroll')
        ]);

        const todayStr = new Date().toISOString().slice(0, 10);
        const thisMonthStr = todayStr.slice(0, 7);

        const totalStaff = employees.length;
        const activeStaff = employees.filter(e => e.status === 'active').length;
        const todayPresent = attendances.filter(a => a.date === todayStr && a.status === 'present').length;
        const monthSalary = payrolls.filter(p => p.month === thisMonthStr).reduce((sum, p) => sum + (p.netPay || 0), 0);

        document.getElementById('hr-total-staff').textContent = totalStaff;
        document.getElementById('hr-active-staff').textContent = activeStaff;
        document.getElementById('hr-today-present').textContent = todayPresent;
        document.getElementById('hr-month-salary').textContent = formatCurrency(monthSalary);

        const attFilterDateInput = document.getElementById('hr-attendance-filter-date');
        if (!attFilterDateInput.value) {
            attFilterDateInput.value = todayStr;
        }
        const selectedAttDate = attFilterDateInput.value;

        const empTbody = document.getElementById('hr-employees-table');
        if (employees.length === 0) {
            empTbody.innerHTML = `<tr><td colspan="7" class="text-center" style="text-align: center; opacity: 0.7;">${getTranslation('hr_no_employees')}</td></tr>`;
        } else {
            empTbody.innerHTML = employees.map(e => `
                <tr>
                    <td><strong>${e.name}</strong></td>
                    <td>${e.position}</td>
                    <td>${e.phone || '-'}</td>
                    <td><strong>${formatCurrency(e.basicSalary)}</strong></td>
                    <td>${e.joinDate}</td>
                    <td><span class="akmstock-status ${e.status === 'active' ? 'normal' : 'low'}">${e.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                    <td>
                        <button class="akmbtn akmbtn-sm akmbtn-outline-primary" onclick="openHREmployeeModal('${e.id}')"><i class="fas fa-edit"></i></button>
                        <button class="akmbtn akmbtn-sm akmbtn-danger" onclick="deleteHREmployee('${e.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        }

        const attTbody = document.getElementById('hr-attendance-table');
        const filteredAtt = attendances.filter(a => a.date === selectedAttDate);
        if (filteredAtt.length === 0) {
            attTbody.innerHTML = `<tr><td colspan="5" class="text-center" style="text-align: center; opacity: 0.7;">${getTranslation('hr_no_attendance')}</td></tr>`;
        } else {
            attTbody.innerHTML = filteredAtt.map(a => {
                let statusBadge = 'normal';
                if (a.status === 'absent') statusBadge = 'low';
                else if (a.status === 'leave' || a.status === 'half-day') statusBadge = 'expiring';
                return `
                <tr>
                    <td>${a.date}</td>
                    <td><strong>${a.employeeName}</strong></td>
                    <td><span class="akmstock-status ${statusBadge}">${a.status.toUpperCase()}</span></td>
                    <td>${a.notes || '-'}</td>
                    <td>
                        <button class="akmbtn akmbtn-sm akmbtn-danger" onclick="deleteHRAttendance('${a.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `}).join('');
        }

        const payTbody = document.getElementById('hr-payroll-table');
        if (payrolls.length === 0) {
            payTbody.innerHTML = `<tr><td colspan="9" class="text-center" style="text-align: center; opacity: 0.7;">${getTranslation('hr_no_payroll')}</td></tr>`;
        } else {
            payTbody.innerHTML = payrolls.sort((a,b) => new Date(b.payDate) - new Date(a.payDate)).map(p => `
                <tr>
                    <td>${p.payDate}</td>
                    <td><strong>${p.employeeName}</strong></td>
                    <td>${p.month}</td>
                    <td>${formatCurrency(p.basic)}</td>
                    <td style="color:var(--success-color);">+${formatCurrency(p.bonus || 0)}</td>
                    <td style="color:var(--danger-color);">-${formatCurrency(p.deduction || 0)}</td>
                    <td><strong>${formatCurrency(p.netPay)}</strong></td>
                    <td><span class="akmstock-status normal">${p.method || 'Cash'}</span></td>
                    <td>
                        <button class="akmbtn akmbtn-sm akmbtn-danger" onclick="deleteHRPayroll('${p.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        }
    }

    window.openHREmployeeModal = async function(id = null) {
        document.getElementById('hr-emp-id').value = '';
        document.getElementById('hr-emp-name').value = '';
        document.getElementById('hr-emp-position').value = '';
        document.getElementById('hr-emp-phone').value = '';
        document.getElementById('hr-emp-salary').value = '';
        document.getElementById('hr-emp-joindate').value = new Date().toISOString().slice(0, 10);
        document.getElementById('hr-emp-status').value = 'active';

        if (id) {
            const emp = await db.get('hr_employees', id);
            if (emp) {
                document.getElementById('hr-emp-id').value = emp.id;
                document.getElementById('hr-emp-name').value = emp.name;
                document.getElementById('hr-emp-position').value = emp.position;
                document.getElementById('hr-emp-phone').value = emp.phone || '';
                document.getElementById('hr-emp-salary').value = emp.basicSalary;
                document.getElementById('hr-emp-joindate').value = emp.joinDate;
                document.getElementById('hr-emp-status').value = emp.status;
            }
        }
        openModal('hr-employee-modal');
    };

    window.saveHREmployee = async function() {
        const id = document.getElementById('hr-emp-id').value || `emp-${Date.now()}`;
        const name = document.getElementById('hr-emp-name').value.trim();
        const position = document.getElementById('hr-emp-position').value.trim();
        const phone = document.getElementById('hr-emp-phone').value.trim();
        const basicSalary = parseFloat(document.getElementById('hr-emp-salary').value) || 0;
        const joinDate = document.getElementById('hr-emp-joindate').value;
        const status = document.getElementById('hr-emp-status').value;

        if (!name || !position || isNaN(basicSalary) || !joinDate) {
            alert(getTranslation('alert_fill_all_fields'));
            return;
        }

        await db.put('hr_employees', { id, name, position, phone, basicSalary, joinDate, status });
        closeModal('hr-employee-modal');
        renderHRPage();
    };

    window.deleteHREmployee = async function(id) {
        if (confirm(getTranslation('confirm_delete_item_msg', { type: getTranslation('menu_hr') }))) {
            await db.delete('hr_employees', id);
            renderHRPage();
        }
    };

    window.openHRAttendanceModal = async function() {
        const employees = (await db.getAll('hr_employees')).filter(e => e.status === 'active');
        const select = document.getElementById('hr-att-employee');
        if (employees.length === 0) {
            alert("ကျေးဇူးပြု၍ ဝန်ထမ်းအချက်အလက်ကို ဦးစွာထည့်သွင်းပေးပါ။");
            return;
        }
        select.innerHTML = employees.map(e => `<option value="${e.id}">${e.name} (${e.position})</option>`).join('');
        document.getElementById('hr-att-date').value = new Date().toISOString().slice(0, 10);
        document.getElementById('hr-att-status').value = 'present';
        document.getElementById('hr-att-notes').value = '';
        openModal('hr-attendance-modal');
    };

    window.saveHRAttendance = async function() {
        const employeeId = document.getElementById('hr-att-employee').value;
        const date = document.getElementById('hr-att-date').value;
        const status = document.getElementById('hr-att-status').value;
        const notes = document.getElementById('hr-att-notes').value.trim();

        const emp = await db.get('hr_employees', employeeId);
        if (!emp || !date) {
            alert(getTranslation('alert_fill_all_fields'));
            return;
        }

        const id = `att-${employeeId}-${date}`;
        await db.put('hr_attendance', {
            id,
            employeeId,
            employeeName: emp.name,
            date,
            status,
            notes
        });

        closeModal('hr-attendance-modal');
        document.getElementById('hr-attendance-filter-date').value = date;
        switchHRTab('attendance');
        renderHRPage();
    };

    window.deleteHRAttendance = async function(id) {
        if (confirm("ရုံးတက်မှတ်တမ်းကို ဖျက်မှာ သေချာလား?")) {
            await db.delete('hr_attendance', id);
            renderHRPage();
        }
    };

    window.openHRPayrollModal = async function() {
        const employees = await db.getAll('hr_employees');
        if (employees.length === 0) {
            alert("ဝန်ထမ်းအချက်အလက် ဦးစွာထည့်သွင်းပါ။");
            return;
        }
        const select = document.getElementById('hr-pay-employee');
        select.innerHTML = employees.map(e => `<option value="${e.id}">${e.name} (${e.position})</option>`).join('');

        const now = new Date();
        document.getElementById('hr-pay-month').value = now.toISOString().slice(0, 7);
        document.getElementById('hr-pay-date').value = now.toISOString().slice(0, 10);
        document.getElementById('hr-pay-bonus').value = '0';
        document.getElementById('hr-pay-deduct').value = '0';

        await autoFillHRSalary();
        openModal('hr-payroll-modal');
    };

    window.autoFillHRSalary = async function() {
        const empId = document.getElementById('hr-pay-employee').value;
        if (!empId) return;
        const emp = await db.get('hr_employees', empId);
        if (emp) {
            document.getElementById('hr-pay-basic').value = emp.basicSalary || 0;
            calculateHRNetPay();
        }
    };

    window.calculateHRNetPay = function() {
        const basic = parseFloat(document.getElementById('hr-pay-basic').value) || 0;
        const bonus = parseFloat(document.getElementById('hr-pay-bonus').value) || 0;
        const deduct = parseFloat(document.getElementById('hr-pay-deduct').value) || 0;
        const net = Math.max(0, basic + bonus - deduct);
        document.getElementById('hr-pay-net').value = net;
    };

    window.saveHRPayroll = async function() {
        const empId = document.getElementById('hr-pay-employee').value;
        const month = document.getElementById('hr-pay-month').value;
        const payDate = document.getElementById('hr-pay-date').value;
        const basic = parseFloat(document.getElementById('hr-pay-basic').value) || 0;
        const bonus = parseFloat(document.getElementById('hr-pay-bonus').value) || 0;
        const deduction = parseFloat(document.getElementById('hr-pay-deduct').value) || 0;
        const netPay = parseFloat(document.getElementById('hr-pay-net').value) || 0;
        const method = document.getElementById('hr-pay-method').value;

        const emp = await db.get('hr_employees', empId);
        if (!emp || !month || !payDate || isNaN(netPay)) {
            alert(getTranslation('alert_fill_all_fields'));
            return;
        }

        await db.add('hr_payroll', {
            id: `pay-${Date.now()}`,
            employeeId: empId,
            employeeName: emp.name,
            month,
            payDate,
            basic,
            bonus,
            deduction,
            netPay,
            method
        });

        closeModal('hr-payroll-modal');
        switchHRTab('payroll');
        renderHRPage();
    };

    window.deleteHRPayroll = async function(id) {
        if (confirm("လစာထုတ်ပေးမှုမှတ်တမ်းကို ဖျက်မှာ သေချာလား?")) {
            await db.delete('hr_payroll', id);
            renderHRPage();
        }
    };

    function appendSyncLog(msg) {
        const box = document.getElementById('sync-log-box');
        if (!box) return;
        const time = new Date().toLocaleTimeString();
        const line = `[${time}] ${msg}`;
        const lines = box.textContent ? box.textContent.split('\n') : [];
        lines.push(line);
        if (lines.length > 25) lines.shift();
        box.textContent = lines.join('\n');
        box.scrollTop = box.scrollHeight;
    }

    function updateSyncPanelVisibility() {
        const role = state.syncRole;
        const rtcPanel = document.getElementById('sync-webrtc-panel');
        const rtcServerControls = document.getElementById('rtc-server-controls');
        const rtcCounterControls = document.getElementById('rtc-counter-controls');
        const rtcAcceptOfferBtn = document.getElementById('rtc-accept-offer-btn');
        const rtcAcceptAnsBtn = document.getElementById('rtc-accept-answer-btn');

        if (role === 'standalone') {
            rtcPanel.style.display = 'none';
        } else {
            rtcPanel.style.display = 'block';
            rtcServerControls.style.display = role === 'server' ? 'block' : 'none';
            rtcCounterControls.style.display = role === 'counter' ? 'block' : 'none';
            if (rtcAcceptAnsBtn) rtcAcceptAnsBtn.style.display = role === 'server' ? 'inline-flex' : 'none';
            if (rtcAcceptOfferBtn) rtcAcceptOfferBtn.style.display = role === 'counter' ? 'inline-flex' : 'none';
        }
    }

    function updateSyncStatusUI() {
        const headerDot = document.getElementById('header-sync-dot');
        const headerLabel = document.getElementById('header-sync-label');
        const settingsDot = document.getElementById('settings-sync-dot');
        const settingsStatus = document.getElementById('sync-connection-status');

        const openRtcCount = Array.from(rtcPeers.values()).filter(p => p.dc && p.dc.readyState === 'open').length;

        if (state.syncRole === 'standalone') {
            headerDot.className = 'akmsync-dot offline';
            settingsDot.className = 'akmsync-dot offline';
            headerLabel.textContent = getTranslation('sync_badge_standalone');
            settingsStatus.textContent = getTranslation('sync_status_standalone');
        } else if (openRtcCount > 0) {
            headerDot.className = 'akmsync-dot connected';
            settingsDot.className = 'akmsync-dot connected';
            const roleTxt = state.syncRole === 'server' ? 'Server' : 'Counter';
            headerLabel.textContent = `${roleTxt} (${openRtcCount} QR)`;
            settingsStatus.textContent = `${getTranslation('sync_status_connected')} (${openRtcCount} P2P)`;
        } else {
            headerDot.className = 'akmsync-dot';
            settingsDot.className = 'akmsync-dot';
            headerLabel.textContent = state.syncRole === 'server' ? 'Server (Idle)' : 'Counter (Idle)';
            settingsStatus.textContent = getTranslation('sync_status_disconnected');
        }
    }

    function getPendingSyncOrders() {
        try {
            return JSON.parse(localStorage.getItem('ffpos_pending_sync_orders') || '[]');
        } catch {
            return [];
        }
    }

    function setPendingSyncOrders(list) {
        localStorage.setItem('ffpos_pending_sync_orders', JSON.stringify(list));
    }

    async function getSyncSnapshot() {
        const [categories, products, stock, orders] = await Promise.all([
            db.getAll('categories'),
            db.getAll('products'),
            db.getAll('stock'),
            db.getAll('orders')
        ]);
        return { categories, products, stock, orders, timestamp: Date.now() };
    }

    async function applyServerSnapshot(snapshot) {
        if (!snapshot) return;
        const pendingOrders = getPendingSyncOrders();

        if (Array.isArray(snapshot.categories)) {
            await db.clear('categories');
            for (const c of snapshot.categories) await db.put('categories', c);
        }
        if (Array.isArray(snapshot.products)) {
            await db.clear('products');
            for (const p of snapshot.products) await db.put('products', p);
        }
        if (Array.isArray(snapshot.stock)) {
            await db.clear('stock');
            for (const s of snapshot.stock) {
                let pendingQty = 0;
                for (const po of pendingOrders) {
                    for (const item of (po.items || [])) {
                        if (item.productId === s.productId) pendingQty += item.quantity;
                    }
                }
                await db.put('stock', { ...s, quantity: Math.max(0, s.quantity - pendingQty) });
            }
        }
        if (Array.isArray(snapshot.orders)) {
            for (const o of snapshot.orders) {
                await db.put('orders', o);
            }
        }

        await populateFilterDropdowns();
        if (state.currentSection !== 'settings') {
            await render();
        }
    }

    function sendOverRtcPeers(payloadObj) {
        const raw = JSON.stringify(payloadObj);
        let sentCount = 0;
        rtcPeers.forEach((peer) => {
            if (peer.dc && peer.dc.readyState === 'open') {
                peer.dc.send(raw);
                sentCount++;
            }
        });
        return sentCount;
    }

    async function handleIncomingSyncMessage(rawData, replyFn = null) {
        let msg;
        try {
            msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        } catch (e) {
            return;
        }
        if (!msg || !msg.type || msg.senderId === DEVICE_ID) return;

        if (msg.type === 'REQUEST_SNAPSHOT' && state.syncRole === 'server') {
            const snap = await getSyncSnapshot();
            const reply = { type: 'SYNC_SNAPSHOT', senderId: DEVICE_ID, data: snap };
            if (replyFn) replyFn(JSON.stringify(reply));
            else sendOverRtcPeers(reply);
            appendSyncLog('Sent full catalog & stock snapshot to Counter.');
        } else if (msg.type === 'SYNC_SNAPSHOT' && state.syncRole === 'counter') {
            await applyServerSnapshot(msg.data);
            appendSyncLog(`Synced snapshot (${msg.data?.products?.length || 0} products).`);
        } else if (msg.type === 'NEW_ORDER' && state.syncRole === 'server' && msg.order) {
            const existing = await db.get('orders', msg.order.id);
            if (!existing) {
                for (const item of (msg.order.items || [])) {
                    const stockItem = await db.get('stock', item.productId);
                    if (stockItem) {
                        stockItem.quantity = Math.max(0, stockItem.quantity - item.quantity);
                        await db.put('stock', stockItem);
                    }
                }
                await db.put('orders', msg.order);
                appendSyncLog(`Received Counter Sale #${msg.order.id.slice(-6)} (${formatCurrency(msg.order.total)}).`);
                if (state.currentSection !== 'settings') await render();
            }
            const ack = { type: 'ORDER_ACK', senderId: DEVICE_ID, orderId: msg.order.id };
            if (replyFn) replyFn(JSON.stringify(ack));
            sendOverRtcPeers(ack);
            const snap = await getSyncSnapshot();
            sendOverRtcPeers({ type: 'SYNC_SNAPSHOT', senderId: DEVICE_ID, data: snap });
        } else if (msg.type === 'ORDER_ACK' && state.syncRole === 'counter' && msg.orderId) {
            const pending = getPendingSyncOrders().filter(o => o.id !== msg.orderId);
            setPendingSyncOrders(pending);
            appendSyncLog(`Server confirmed Sale #${msg.orderId.slice(-6)}.`);
        } else if (msg.type === 'HELLO') {
            appendSyncLog(`Peer connected (${msg.role || 'device'}).`);
            if (state.syncRole === 'server') {
                const snap = await getSyncSnapshot();
                const reply = { type: 'SYNC_SNAPSHOT', senderId: DEVICE_ID, data: snap };
                if (replyFn) replyFn(JSON.stringify(reply));
                else sendOverRtcPeers(reply);
            }
        }
    }

    async function flushPendingCounterOrders() {
        if (state.syncRole !== 'counter') return;
        const pending = getPendingSyncOrders();
        if (pending.length === 0) return;

        for (const order of pending) {
            sendOverRtcPeers({ type: 'NEW_ORDER', senderId: DEVICE_ID, order });
        }
    }

    async function syncAfterOrderCompleted(completedOrder) {
        if (state.syncRole === 'standalone') return;
        if (state.syncRole === 'counter') {
            const pending = getPendingSyncOrders();
            pending.push(completedOrder);
            setPendingSyncOrders(pending);
            sendOverRtcPeers({ type: 'NEW_ORDER', senderId: DEVICE_ID, order: completedOrder });
            appendSyncLog(`Queued/sent Sale #${completedOrder.id.slice(-6)} to Server.`);
        } else if (state.syncRole === 'server') {
            await syncBroadcastSnapshotIfServer();
        }
    }

    async function syncBroadcastSnapshotIfServer() {
        if (state.syncRole !== 'server') return;
        const snap = await getSyncSnapshot();
        const sent = sendOverRtcPeers({ type: 'SYNC_SNAPSHOT', senderId: DEVICE_ID, data: snap });
        if (sent > 0) {
            appendSyncLog(`Broadcasted updated inventory snapshot to ${sent} Counter(s).`);
        }
    }

    async function manualSyncNow() {
        if (state.syncRole === 'server') {
            await syncBroadcastSnapshotIfServer();
        } else if (state.syncRole === 'counter') {
            await flushPendingCounterOrders();
            sendOverRtcPeers({ type: 'REQUEST_SNAPSHOT', senderId: DEVICE_ID });
        }
    }

    function waitForIceGatheringComplete(pc, timeoutMs = 2500) {
        return new Promise((resolve) => {
            if (pc.iceGatheringState === 'complete') {
                resolve();
                return;
            }
            const timer = setTimeout(resolve, timeoutMs);
            pc.addEventListener('icegatheringstatechange', () => {
                if (pc.iceGatheringState === 'complete') {
                    clearTimeout(timer);
                    resolve();
                }
            });
        });
    }

    async function compressRtcCode(desc) {
        const compact = JSON.stringify({ t: desc.type === 'offer' ? 'o' : 'a', s: desc.sdp });
        if (typeof CompressionStream !== 'undefined') {
            try {
                const stream = new Blob([compact]).stream().pipeThrough(new CompressionStream('deflate-raw'));
                const buf = await new Response(stream).arrayBuffer();
                const bytes = new Uint8Array(buf);
                let bin = '';
                for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                return 'Z1:' + btoa(bin);
            } catch (e) {
                console.warn('Compression fallback:', e);
            }
        }
        return compact;
    }

    async function decompressRtcCode(rawText) {
        const txt = rawText.trim();
        if (txt.startsWith('Z1:') && typeof DecompressionStream !== 'undefined') {
            const bin = atob(txt.slice(3));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            const jsonStr = await new Response(stream).text();
            const parsed = JSON.parse(jsonStr);
            return { type: parsed.t === 'o' ? 'offer' : 'answer', sdp: parsed.s };
        }
        const parsed = JSON.parse(txt);
        if (parsed.t && parsed.s) {
            return { type: parsed.t === 'o' ? 'offer' : 'answer', sdp: parsed.s };
        }
        return parsed;
    }

    function showRtcQrCode(codeText, titleText) {
        const box = document.getElementById('rtc-qr-display-box');
        const canvas = document.getElementById('rtc-qr-canvas');
        const title = document.getElementById('rtc-qr-title');
        title.textContent = titleText;
        box.style.display = 'block';

        if (typeof QRCode !== 'undefined') {
            QRCode.toCanvas(canvas, codeText, {
                errorCorrectionLevel: 'L',
                width: 260,
                margin: 2
            }, (err) => {
                if (err) {
                    console.error('QR generation failed:', err);
                    alert('QR ထုတ်ရာတွင် အမှားရှိနေပါသည် (Manual Copy/Paste ကိုသုံးပါ)။');
                }
            });
        } else {
            alert('QR Code Library မတွေ့ပါ (Manual Copy/Paste ကိုသုံးပါ)။');
        }
    }

    function setupDataChannel(peerId, dc) {
        dc.onopen = async () => {
            const qrBox = document.getElementById('rtc-qr-display-box');
            if (qrBox) qrBox.style.display = 'none';
            appendSyncLog(`P2P Wi-Fi Channel OPEN (${peerId})!`);
            updateSyncStatusUI();
            dc.send(JSON.stringify({ type: 'HELLO', role: state.syncRole, senderId: DEVICE_ID }));
            if (state.syncRole === 'server') {
                const snap = await getSyncSnapshot();
                dc.send(JSON.stringify({ type: 'SYNC_SNAPSHOT', senderId: DEVICE_ID, data: snap }));
            } else if (state.syncRole === 'counter') {
                await flushPendingCounterOrders();
                dc.send(JSON.stringify({ type: 'REQUEST_SNAPSHOT', senderId: DEVICE_ID }));
            }
        };
        dc.onmessage = async (event) => {
            await handleIncomingSyncMessage(event.data, (reply) => {
                if (dc.readyState === 'open') dc.send(reply);
            });
        };
        dc.onclose = () => {
            appendSyncLog(`P2P Wi-Fi Channel closed (${peerId}).`);
            rtcPeers.delete(peerId);
            updateSyncStatusUI();
        };
    }

    async function createRtcOffer() {
        const peerId = `counter-${++rtcPeerCounter}`;
        const pc = new RTCPeerConnection({ iceServers: [] });
        const dc = pc.createDataChannel('ffpos-lan-sync');
        setupDataChannel(peerId, dc);
        rtcPeers.set(peerId, { pc, dc });
        pendingOfferPeerId = peerId;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc);

        const packed = await compressRtcCode(pc.localDescription);
        document.getElementById('rtc-local-sdp').value = packed;
        showRtcQrCode(packed, `Offer QR (${peerId}) — Counter စက်ဖြင့် Scan ဖတ်ပါ`);
        appendSyncLog(`Offer QR created for ${peerId}. Scan from Counter device.`);
    }

    async function acceptRtcOfferAndCreateAnswer(scannedOfferText = null) {
        const rawOffer = (scannedOfferText || document.getElementById('rtc-remote-sdp').value).trim();
        if (!rawOffer) {
            alert(getTranslation('alert_paste_remote_code'));
            return;
        }
        try {
            const offerDesc = await decompressRtcCode(rawOffer);
            const peerId = 'server-host';
            if (rtcPeers.has(peerId)) {
                try { rtcPeers.get(peerId).pc.close(); } catch {}
            }
            const pc = new RTCPeerConnection({ iceServers: [] });
            const peerEntry = { pc, dc: null };
            rtcPeers.set(peerId, peerEntry);

            pc.ondatachannel = (event) => {
                peerEntry.dc = event.channel;
                setupDataChannel(peerId, event.channel);
            };

            await pc.setRemoteDescription(new RTCSessionDescription(offerDesc));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await waitForIceGatheringComplete(pc);

            const packed = await compressRtcCode(pc.localDescription);
            document.getElementById('rtc-local-sdp').value = packed;
            showRtcQrCode(packed, 'Answer QR — Server စက်ဖြင့် ပြန်လည် Scan ဖတ်ပါ');
            appendSyncLog('Answer QR created! Scan it on the Server device.');
        } catch (err) {
            alert('Invalid Offer QR/Code: ' + err.message);
        }
    }

    async function acceptRtcAnswerOnServer(scannedAnswerText = null) {
        const rawAnswer = (scannedAnswerText || document.getElementById('rtc-remote-sdp').value).trim();
        if (!rawAnswer || !pendingOfferPeerId || !rtcPeers.has(pendingOfferPeerId)) {
            alert(getTranslation('alert_paste_remote_code'));
            return;
        }
        try {
            const answerDesc = await decompressRtcCode(rawAnswer);
            const peerEntry = rtcPeers.get(pendingOfferPeerId);
            await peerEntry.pc.setRemoteDescription(new RTCSessionDescription(answerDesc));
            document.getElementById('rtc-remote-sdp').value = '';
            document.getElementById('rtc-local-sdp').value = '';
            document.getElementById('rtc-qr-display-box').style.display = 'none';
            pendingOfferPeerId = null;
            appendSyncLog('Answer accepted! Establishing direct Wi-Fi P2P link...');
        } catch (err) {
            alert('Invalid Answer QR/Code: ' + err.message);
        }
    }

    function disconnectAllRtc() {
        rtcPeers.forEach((peer) => {
            try { if (peer.dc) peer.dc.close(); } catch {}
            try { peer.pc.close(); } catch {}
        });
        rtcPeers.clear();
        pendingOfferPeerId = null;
        document.getElementById('rtc-local-sdp').value = '';
        document.getElementById('rtc-remote-sdp').value = '';
        const qrBox = document.getElementById('rtc-qr-display-box');
        if (qrBox) qrBox.style.display = 'none';
        updateSyncStatusUI();
        appendSyncLog('All P2P links disconnected.');
    }

    function appendGDriveLog(msg) {
        const box = document.getElementById('gdrive-log-box');
        if (!box) return;
        box.style.display = 'block';
        const time = new Date().toLocaleTimeString();
        const lines = box.textContent ? box.textContent.split('\n') : [];
        lines.push(`[${time}] ${msg}`);
        if (lines.length > 15) lines.shift();
        box.textContent = lines.join('\n');
        box.scrollTop = box.scrollHeight;
    }

    function updateGDriveAuthUI() {
        const statusEl = document.getElementById('gdrive-auth-status');
        if (!statusEl) return;
        if (gdriveAccessToken) {
            statusEl.textContent = getTranslation('gdrive_connected');
            statusEl.style.color = 'var(--success-color)';
            statusEl.style.borderColor = 'var(--success-color)';
        } else {
            statusEl.textContent = getTranslation('gdrive_not_connected');
            statusEl.style.color = '';
            statusEl.style.borderColor = '';
        }
    }

    async function exportAllStoresToJson() {
        const storesData = {};
        for (const storeName of ALL_STORES) {
            storesData[storeName] = await db.getAll(storeName);
        }
        return {
            app: 'FFPOS',
            version: '4.9',
            timestamp: new Date().toISOString(),
            stores: storesData
        };
    }

    async function restoreAllStoresFromJson(backupObj) {
        if (!backupObj || backupObj.app !== 'FFPOS' || !backupObj.stores) {
            throw new Error(getTranslation('alert_invalid_backup_file'));
        }
        for (const storeName of ALL_STORES) {
            if (Array.isArray(backupObj.stores[storeName])) {
                await db.clear(storeName);
                for (const item of backupObj.stores[storeName]) {
                    await db.put(storeName, item);
                }
            }
        }
        const [tax, language, appMode, printerType, syncRole] = await Promise.all([
            db.get('settings', 'taxRate'),
            db.get('settings', 'language'),
            db.get('settings', 'appMode'),
            db.get('settings', 'printerType'),
            db.get('settings', 'syncRole')
        ]);
        state.taxRate = tax ? tax.value : 0;
        state.printerType = printerType ? printerType.value : 'bluetooth';
        state.syncRole = syncRole ? syncRole.value : 'standalone';
        await applyTheme();
        applyAppMode(appMode ? appMode.value : 'retail');
        await setLanguage(language ? language.value : 'mm');
        await populateFilterDropdowns();
        await render();
    }

    async function signInGoogleDrive() {
        const clientId = document.getElementById('gdrive-client-id').value.trim();
        if (!clientId) {
            alert(getTranslation('alert_enter_gdrive_client_id'));
            return false;
        }
        await db.put('settings', { key: 'gdriveClientId', value: clientId });

        if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
            alert(getTranslation('alert_gdrive_sdk_missing'));
            return false;
        }

        return new Promise((resolve) => {
            try {
                gdriveTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: clientId,
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    callback: (tokenResponse) => {
                        if (tokenResponse && tokenResponse.access_token) {
                            gdriveAccessToken = tokenResponse.access_token;
                            updateGDriveAuthUI();
                            appendGDriveLog('Google Drive authenticated successfully.');
                            resolve(true);
                        } else {
                            appendGDriveLog('Google authentication cancelled or failed.');
                            resolve(false);
                        }
                    },
                    error_callback: (err) => {
                        appendGDriveLog('OAuth error: ' + (err?.message || JSON.stringify(err)));
                        resolve(false);
                    }
                });
                gdriveTokenClient.requestAccessToken({ prompt: gdriveAccessToken ? '' : 'consent' });
            } catch (err) {
                alert('Google Auth initialization error: ' + err.message);
                resolve(false);
            }
        });
    }

    async function ensureGDriveToken() {
        if (gdriveAccessToken) return true;
        return await signInGoogleDrive();
    }

    async function findExistingGDriveBackupFile() {
        const q = encodeURIComponent(`name='${GDRIVE_BACKUP_FILENAME}' and trashed=false`);
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,size)`, {
            headers: { Authorization: `Bearer ${gdriveAccessToken}` }
        });
        if (res.status === 401) {
            gdriveAccessToken = null;
            updateGDriveAuthUI();
            throw new Error('Google session expired. Please reconnect.');
        }
        if (!res.ok) throw new Error(`Drive search failed (${res.status})`);
        const data = await res.json();
        return data.files && data.files.length > 0 ? data.files[0] : null;
    }

    async function handleBackupToGoogleDrive() {
        const btn = document.getElementById('gdrive-backup-btn');
        btn.disabled = true;
        try {
            const ok = await ensureGDriveToken();
            if (!ok) return;

            appendGDriveLog('Preparing IndexedDB JSON backup...');
            const backupPayload = await exportAllStoresToJson();
            const jsonString = JSON.stringify(backupPayload);

            const existingFile = await findExistingGDriveBackupFile();
            const metadata = {
                name: GDRIVE_BACKUP_FILENAME,
                mimeType: 'application/json'
            };

            const boundary = '-------ffposBackupBoundary' + Date.now();
            const multipartBody =
                `--${boundary}\r\n` +
                `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${JSON.stringify(metadata)}\r\n` +
                `--${boundary}\r\n` +
                `Content-Type: application/json\r\n\r\n` +
                `${jsonString}\r\n` +
                `--${boundary}--`;

            const url = existingFile
                ? `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`
                : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
            const method = existingFile ? 'PATCH' : 'POST';

            appendGDriveLog(existingFile ? 'Updating existing FFPOS_Backup.json on Google Drive...' : 'Uploading new FFPOS_Backup.json to Google Drive...');
            const uploadRes = await fetch(url, {
                method,
                headers: {
                    Authorization: `Bearer ${gdriveAccessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`
                },
                body: multipartBody
            });

            if (!uploadRes.ok) {
                const errTxt = await uploadRes.text();
                throw new Error(`Upload failed (${uploadRes.status}): ${errTxt}`);
            }

            const uploaded = await uploadRes.json();
            const sizeKb = (jsonString.length / 1024).toFixed(1);
            appendGDriveLog(`Backup complete! File: ${uploaded.name} (${sizeKb} KB).`);
            alert(getTranslation('alert_gdrive_backup_success'));
        } catch (err) {
            console.error('Google Drive Backup Error:', err);
            appendGDriveLog('Backup error: ' + err.message);
            alert('Google Drive Backup Error: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    }

    async function handleRestoreFromGoogleDrive() {
        const btn = document.getElementById('gdrive-restore-btn');
        btn.disabled = true;
        try {
            const ok = await ensureGDriveToken();
            if (!ok) return;

            appendGDriveLog('Searching for FFPOS_Backup.json on Google Drive...');
            const file = await findExistingGDriveBackupFile();
            if (!file) {
                appendGDriveLog('No backup file found on Google Drive.');
                alert(getTranslation('alert_gdrive_no_backup'));
                return;
            }

            const modifiedStr = file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : 'Unknown';
            showConfirmation({
                title: getTranslation('title_gdrive_backup'),
                message: getTranslation('confirm_gdrive_restore_msg', { date: modifiedStr }),
                isDanger: true,
                okText: 'btn_confirm',
                async onConfirm() {
                    closeModal('confirm-modal');
                    try {
                        appendGDriveLog(`Downloading ${file.name} (${modifiedStr})...`);
                        const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                            headers: { Authorization: `Bearer ${gdriveAccessToken}` }
                        });
                        if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`);
                        const backupJson = await dlRes.json();
                        await restoreAllStoresFromJson(backupJson);
                        appendGDriveLog('Restore complete! All IndexedDB stores updated.');
                        alert(getTranslation('alert_gdrive_restore_success'));
                    } catch (err) {
                        console.error('Restore failed:', err);
                        appendGDriveLog('Restore failed: ' + err.message);
                        alert('Restore Error: ' + err.message);
                    }
                }
            });
        } catch (err) {
            console.error('Google Drive Restore Error:', err);
            appendGDriveLog('Restore error: ' + err.message);
            alert('Google Drive Restore Error: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    }

    async function handleLocalJsonExport() {
        const backupPayload = await exportAllStoresToJson();
        const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `FFPOS_Backup_${new Date().toISOString().slice(0,10)}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
        appendGDriveLog('Exported local JSON backup file.');
    }

    function handleLocalJsonImportFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                showConfirmation({
                    title: getTranslation('btn_import_json'),
                    message: getTranslation('confirm_gdrive_restore_msg', { date: parsed.timestamp ? new Date(parsed.timestamp).toLocaleString() : file.name }),
                    isDanger: true,
                    okText: 'btn_confirm',
                    async onConfirm() {
                        closeModal('confirm-modal');
                        try {
                            await restoreAllStoresFromJson(parsed);
                            appendGDriveLog('Restored database from local JSON file.');
                            alert(getTranslation('alert_gdrive_restore_success'));
                        } catch (err) {
                            alert('Import failed: ' + err.message);
                        }
                    }
                });
            } catch (err) {
                alert(getTranslation('alert_invalid_backup_file'));
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    async function connectBluetoothPrinter() {
        const statusEl = document.getElementById('bt-printer-status');
        if (!navigator.bluetooth) {
            alert("Web Bluetooth API is not supported on this browser/device. Please use Google Chrome on Android or a compatible browser, or choose RawBT app mode.");
            return;
        }

        try {
            statusEl.textContent = "Connecting...";
            bluetoothDevice = await navigator.bluetooth.requestDevice({
                filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
                optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2']
            }).catch(async () => {
                return await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2']
                });
            });

            if (!bluetoothDevice) {
                statusEl.textContent = "Disconnected";
                return;
            }

            const server = await bluetoothDevice.gatt.connect();
            const services = await server.getPrimaryServices();
            for (const service of services) {
                const characteristics = await service.getCharacteristics();
                for (const char of characteristics) {
                    if (char.properties.write || char.properties.writeWithoutResponse) {
                        bluetoothCharacteristic = char;
                        break;
                    }
                }
                if (bluetoothCharacteristic) break;
            }

            if (bluetoothCharacteristic) {
                statusEl.textContent = `Connected: ${bluetoothDevice.name || 'Printer'}`;
                statusEl.style.color = "var(--success-color)";
                alert(`Bluetooth Printer (${bluetoothDevice.name || 'Printer'}) connected successfully!`);
            } else {
                statusEl.textContent = "Write characteristic not found";
                statusEl.style.color = "var(--danger-color)";
            }
        } catch (err) {
            console.error("Bluetooth Connection Error:", err);
            statusEl.textContent = "Connection failed";
            statusEl.style.color = "var(--danger-color)";
            alert("Bluetooth pairing cancelled or failed: " + err.message);
        }
    }

    function generateReceiptPlainText(order, title = "Free Free POS!") {
        let text = "";
        const line = "--------------------------------\n";
        text += `          ${title}\n`;
        text += line;
        text += `Sale ID: #${order.id.slice(-8)}\n`;
        text += `Date: ${new Date().toLocaleString()}\n`;
        text += `Payment: ${order.paymentMethod || 'Cash'}\n`;
        text += line;
        text += "Item           Qty       Total\n";
        text += line;
        order.items.forEach(i => {
            let name = i.name.slice(0, 14).padEnd(15, ' ');
            let qty = (i.quantity + '').padStart(3, ' ');
            let total = (formatCurrency(i.price * i.quantity)).padStart(14, ' ');
            text += `${name}${qty}${total}\n`;
        });
        text += line;
        text += `Subtotal:      ${formatCurrency(order.subtotal)}\n`;
        text += `Discount:     -${formatCurrency(order.discount || 0)}\n`;
        text += `Tax:           ${formatCurrency(order.tax || 0)}\n`;
        text += line;
        text += `GRAND TOTAL:   ${formatCurrency(order.total)}\n`;
        text += line;
        text += "   Thank you for your purchase! \n\n\n\n";
        return text;
    }

    async function printReceiptThermal(order) {
        if (!order) return;
        const receiptTitleSetting = await db.get('settings', 'receiptTitle');
        const title = receiptTitleSetting?.value || 'Free Free POS!';
        const receiptText = generateReceiptPlainText(order, title);
        const method = state.printerType;

        if (method === 'rawbt') {
            const encodedText = encodeURIComponent(receiptText);
            window.location.href = `rawbt:data:text/plain;charset=utf-8,${encodedText}`;
        } else if (method === 'bluetooth') {
            if (!bluetoothCharacteristic) {
                const wantConnect = confirm("Bluetooth printer is not connected. Do you want to connect it now?");
                if (wantConnect) await connectBluetoothPrinter();
                else return;
            }
            if (!bluetoothCharacteristic) return;

            try {
                const encoder = new TextEncoder();
                await bluetoothCharacteristic.writeValue(new Uint8Array([0x1B, 0x40]));
                const data = encoder.encode(receiptText);
                const chunkSize = 50;
                for (let i = 0; i < data.length; i += chunkSize) {
                    await bluetoothCharacteristic.writeValue(data.slice(i, i + chunkSize));
                    await new Promise(r => setTimeout(r, 20));
                }
                await bluetoothCharacteristic.writeValue(new Uint8Array([0x1D, 0x56, 0x42, 0x00]));
                alert("Receipt sent to Bluetooth Printer successfully!");
            } catch (err) {
                console.error("Bluetooth Print Error:", err);
                alert("Failed to print via Bluetooth: " + err.message);
            }
        } else {
            window.print();
        }
    }

    async function handleDeleteSampleData() {
        showConfirmation({
            title: getTranslation('title_delete_sample_data'),
            message: getTranslation('confirm_delete_sample_data_msg'),
            isDanger: true,
            okText: 'btn_delete',
            async onConfirm() {
                try {
                    const stores = ['products', 'categories', 'stock', 'purchases', 'orders', 'hh_transactions', 'hr_employees', 'hr_attendance', 'hr_payroll', 'todos'];
                    for (const storeName of stores) {
                        const items = await db.getAll(storeName);
                        for (const item of items) {
                            if (item.isSample === true || (typeof item.id === 'string' && item.id.includes('sample'))) {
                                const key = storeName === 'stock' ? item.productId : item.id;
                                await db.delete(storeName, key);
                            }
                        }
                    }
                    closeModal('confirm-modal');
                    alert(getTranslation('alert_sample_data_deleted'));
                    await populateFilterDropdowns();
                    await syncBroadcastSnapshotIfServer();
                    render();
                } catch (err) {
                    console.error("Failed to delete sample data:", err);
                    alert("Error while deleting sample data.");
                    closeModal('confirm-modal');
                }
            }
        });
    }

    async function populateFilterDropdowns() { 
        const categories = await db.getAll('categories'); 
        const optionsHtml = `<option value="all" data-translate="filter_all_categories">${getTranslation('filter_all_categories')}</option>` + categories.map(c => `<option value="${c.id}">${c.name}</option>`).join(''); 
        const filterSelects = [ document.getElementById('product-category-filter'), document.getElementById('stock-category-filter'), document.getElementById('expiring-soon-category-filter') ]; 
        filterSelects.forEach(select => { 
            if (select) { 
                const currentValue = select.value; 
                select.innerHTML = optionsHtml; 
                select.value = currentValue || 'all'; 
            } 
        }); 
    }

    function populateDynamicFilters() { 
        const currentYear = new Date().getFullYear(); 
        const purchaseYearInput = document.getElementById('purchase-filter-year');
        const saleHistoryYearInput = document.getElementById('sale-history-filter-year');
        if (purchaseYearInput && !purchaseYearInput.value) purchaseYearInput.value = currentYear;
        if (saleHistoryYearInput && !saleHistoryYearInput.value) saleHistoryYearInput.value = currentYear;

        const monthNames = getTranslation('month_names'); 
        const monthOptions = monthNames.map((name, index) => `<option value="${index + 1}">${name}</option>`).join(''); 
        document.getElementById('purchase-filter-month').innerHTML = monthOptions; 
        document.getElementById('sale-history-filter-month').innerHTML = monthOptions; 
        document.getElementById('purchase-filter-date').valueAsDate = new Date(); 
        document.getElementById('sale-history-filter-date').valueAsDate = new Date(); 
    }

    function openModal(modalId) { document.getElementById(modalId).classList.add('show'); }
    window.closeModal = function(modalId) { document.getElementById(modalId).classList.remove('show'); }

    function showConfirmation({ title, message, onConfirm, okText = 'btn_confirm', isDanger = true, requiresInput = false, inputPlaceholder = '' }) { 
        const modal = document.getElementById('confirm-modal'); 
        modal.querySelector('#confirm-modal-title').textContent = title; 
        modal.querySelector('#confirm-modal-message').textContent = message; 
        const okBtn = modal.querySelector('#confirm-ok-btn'); 
        okBtn.innerHTML = `<span data-translate="${okText}">${getTranslation(okText)}</span>`; 
        okBtn.className = `akmbtn ${isDanger ? 'akmbtn-danger' : 'akmbtn-primary'}`; 
        const inputContainer = modal.querySelector('#reset-confirm-input-container'); 
        const inputField = modal.querySelector('#reset-confirm-input'); 
        if (requiresInput) { 
            inputContainer.style.display = 'block'; 
            inputField.value = ''; 
            inputField.placeholder = inputPlaceholder; 
        } else { 
            inputContainer.style.display = 'none'; 
        } 
        openModal('confirm-modal'); 
        const newOkBtn = okBtn.cloneNode(true); 
        okBtn.parentNode.replaceChild(newOkBtn, okBtn); 
        newOkBtn.addEventListener('click', () => { 
            if (requiresInput) onConfirm(inputField.value); 
            else onConfirm(); 
        }); 
    }

    async function applyTheme() { 
        const themeSetting = await db.get('settings', 'theme'); 
        const theme = themeSetting ? themeSetting.value : 'light'; 
        document.body.className = `${theme}-mode`; 
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) themeSelect.value = theme;
    }

    function applyAppMode(mode) { 
        state.appMode = mode; 
        const isBakery = mode === 'bakery'; 
        document.getElementById('expiring-soon-menu-item').style.display = isBakery ? 'block' : 'none'; 
        document.getElementById('purchase-expiry-date-group').style.display = isBakery ? 'block' : 'none'; 
        if (!isBakery && state.currentSection === 'expiring-soon') { 
            navigateTo('home');
        } 
    }

    function formatCurrency(amount) { 
        return new Intl.NumberFormat('en-US').format(amount) + ' ကျပ်'; 
    }

    const translations = {
        menu_home: { en: "Home", mm: "ပင်မစာမျက်နှာ" },
        menu_user_guide: { en: "User Guide", mm: "အသုံးပြုနည်းလမ်းညွှန်" },
        guide_quick_sub: { en: "Step-by-step beginner guide: Delete Demo Data, Settings, Products, Purchases, Reports & more", mm: "စတင်အသုံးပြုသူများအတွက် Demo Data ဖျက်နည်းနှင့် စနစ်တစ်ခုလုံး အသုံးပြုနည်း အသေးစိတ်" },
        menu_daily_review: { en: "Daily Review", mm: "ယနေ့လုပ်ငန်းသုံးသပ်ချက်" },
        home_welcome_text: { en: "Welcome to POS and Note Management System", mm: "အရောင်းမှတ်တမ်းနှင့် မှတ်စုစီမံခန့်ခွဲမှုစနစ်မှ ကြိုဆိုပါသည်" },
        home_quick_actions: { en: "Quick Actions", mm: "အမြန်လုပ်ဆောင်ချက်များ" },
        home_overview: { en: "Business Overview", mm: "လုပ်ငန်းအခြေအနေ အကျဉ်းချုပ်" },
        home_today_sales: { en: "Today's Sales", mm: "ယနေ့ရောင်းရငွေ" },
        home_today_orders: { en: "Today's Orders", mm: "ယနေ့အရောင်းဘောင်ချာ" },
        home_total_products: { en: "Total Products", mm: "စုစုပေါင်းပစ္စည်း" },
        home_low_stock_items: { en: "Low Stock Items", mm: "လက်ကျန်နည်းပစ္စည်း" },
        home_recent_sales: { en: "Recent Sales", mm: "မကြာသေးမီအရောင်းများ" },
        btn_view_all: { en: "View All", mm: "အားလုံးကြည့်မည်" },
        menu_main: { en: "Main", mm: "ပင်မ" },
        menu_new_sale: { en: "New Sale", mm: "အရောင်းသစ်" },
        menu_management: { en: "Management", mm: "စီမံခန့်ခွဲမှု" },
        menu_products: { en: "Products", mm: "ကုန်ပစ္စည်းများ" },
        menu_categories: { en: "Categories", mm: "အမျိုးအစားများ" },
        menu_stock: { en: "Stock", mm: "ကုန်ပစ္စည်းလက်ကျန်" },
        menu_expiring_soon: { en: "Expiring Soon", mm: "ကုန်ဆုံးရက်နီး" },
        menu_purchases: { en: "Purchases", mm: "အဝယ်စာရင်း" },
        menu_addons: { en: "Add-ons", mm: "အထူးလုပ်ဆောင်ချက်များ" },
        menu_household: { en: "Household Budget", mm: "အိမ်ထောင်စုစရိတ်" },
        menu_hr: { en: "HR Management", mm: "ဝန်ထမ်းရေးရာ စီမံခန့်ခွဲမှု" },
        menu_sale_history: { en: "Sale History", mm: "အရောင်းမှတ်တမ်း" },
        menu_reports: { en: "Reports", mm: "အစီရင်ခံစာများ" },
        menu_reports_link: { en: "Reports", mm: "အစီရင်ခံစာများ" },
        menu_about: { en: "About", mm: "အချက်အလက်" },
        menu_settings: { en: "Settings", mm: "ဆက်တင်များ" },
        tab_settings_general: { en: "General", mm: "အထွေထွေ" },
        tab_settings_printer: { en: "Printer", mm: "Printer" },
        tab_settings_sync: { en: "Wi-Fi Sync", mm: "Wi-Fi ချိတ်ဆက်မှု" },
        tab_settings_backup: { en: "Backup & Data", mm: "Backup & ဒေတာ" },
        title_store_preferences: { en: "Store & Receipt Preferences", mm: "ဆိုင်နှင့် ဘောင်ချာဆက်တင်များ" },
        label_theme: { en: "Theme / Appearance", mm: "အပြင်အဆင် (Theme)" },
        theme_light: { en: "Light Mode", mm: "အလင်း (Light Mode)" },
        theme_dark: { en: "Dark Mode", mm: "အမှောင် (Dark Mode)" },
        btn_scan_short: { en: "Scan", mm: "Scan ဖတ်" },
        hint_barcode_scan_sale: { en: "Tap Scan to read Barcode / QR and add item", mm: "Barcode / QR Scan ဖတ်၍ ပစ္စည်းအမြန်ထည့်နိုင်ပါသည်" },
        hint_barcode_scan_product: { en: "Tap Scan to capture product Barcode / QR via camera", mm: "ကင်မရာဖြင့် Barcode / QR Scan ဖတ်၍ ထည့်သွင်းနိုင်ပါသည်" },
        label_tax_rate: { en: "Tax Rate (%)", mm: "အခွန်နှုန်း (%)" },
        label_receipt_title: { en: "Receipt Title", mm: "ဘောင်ချာခေါင်းစဉ်" },
        label_app_mode: { en: "Application Mode", mm: "စနစ်အမျိုးအစား" },
        mode_retail: { en: "Retail Mode", mm: "လက်လီအရောင်းစနစ်" },
        mode_bakery: { en: "Bakery", mm: "ဘေကာရီစနစ်" },
        title_printer_settings: { en: "Thermal & Bluetooth Printer Settings", mm: "Thermal & Bluetooth Printer ဆက်တင်များ" },
        label_printer_type: { en: "Printer Connection Method:", mm: "Printer ချိတ်ဆက်မည့်စနစ်:" },
        label_bt_device: { en: "Bluetooth Device:", mm: "Bluetooth စက်:" },
        btn_pair_bluetooth: { en: "Pair / Connect Bluetooth Printer", mm: "Bluetooth Printer စက်ရှာဖွေချိတ်ဆက်မည်" },
        btn_test_print: { en: "Test Print Receipt", mm: "စမ်းသပ် Print ထုတ်ကြည့်မည်" },
        btn_print_receipt: { en: "Print Thermal", mm: "Thermal Print ထုတ်မည်" },

        title_wifi_sync: { en: "Wi-Fi Local Sync (WebRTC QR Scan)", mm: "Wi-Fi စက်တွင်းကွန်ရက် ချိတ်ဆက်မှု (WebRTC QR Scan)" },
        desc_wifi_sync: { en: "Synchronize products, stock, and sales across devices on the same Wi-Fi router without internet or extra software by scanning QR codes.", mm: "အင်တာနက်နှင့် ဆော့ဖ်ဝဲအပိုမလိုဘဲ Wi-Fi Router တစ်ခုတည်းသုံးထားသော စက်များအကြား QR Code Scan ဖတ်၍ ကုန်ပစ္စည်း၊ လက်ကျန်နှင့် အရောင်းစာရင်းများကို တိုက်ရိုက်ချိတ်ဆက်မျှဝေနိုင်ပါသည်။" },
        label_sync_role: { en: "Device Role", mm: "စက်၏အခန်းကဏ္ဍ" },
        sync_role_standalone: { en: "Standalone (Single Device)", mm: "တစ်လုံးတည်းသုံး (Standalone)" },
        sync_role_server: { en: "Server (Main Host)", mm: "ပင်မစက် (Server / Host)" },
        sync_role_counter: { en: "Counter (Client Device)", mm: "အရောင်းကောင်တာစက် (Counter)" },
        btn_sync_disconnect: { en: "Disconnect", mm: "ဖြတ်တောက်မည်" },
        btn_sync_now: { en: "Sync Now", mm: "ယခု Sync လုပ်မည်" },
        hint_webrtc_p2p: { en: "Pure browser-to-browser Wi-Fi sync with zero external software: scan QR codes between Server and Counter.", mm: "အခြားဆော့ဖ်ဝဲမလိုဘဲ Browser အချင်းချင်း Wi-Fi မှတစ်ဆင့် ချိတ်ဆက်နိုင်ရန် Server နှင့် Counter အကြား QR Code ကို အပြန်အလှန် Scan ဖတ်ပါ။" },
        btn_rtc_create_offer: { en: "1. Create Offer QR", mm: "၁။ Offer QR ထုတ်မည်" },
        btn_rtc_scan_answer: { en: "2. Scan Counter Answer QR", mm: "၂။ Counter ၏ Answer QR ကို Scan ဖတ်မည်" },
        btn_rtc_scan_offer: { en: "1. Scan Server Offer QR", mm: "၁။ Server ၏ Offer QR ကို Scan ဖတ်မည်" },
        rtc_manual_fallback: { en: "Manual Copy / Paste (If device has no camera)", mm: "Manual Copy / Paste (ကင်မရာမရှိပါက ဤနေရာကိုနှိပ်ပါ)" },
        btn_rtc_accept_offer: { en: "Accept Offer & Create Answer", mm: "Offer ထည့်ပြီး Answer ထုတ်မည်" },
        btn_rtc_complete: { en: "Complete Counter Connection", mm: "ချိတ်ဆက်မှုအတည်ပြုမည်" },
        label_rtc_local_code: { en: "Your Connection Code:", mm: "သင့်စက်၏ Connection Code:" },
        label_rtc_remote_code: { en: "Paste Other Device's Code:", mm: "တစ်ဖက်စက်မှ Code ကို ဤနေရာတွင်ထည့်ပါ:" },
        sync_badge_standalone: { en: "Standalone", mm: "single device" },
        sync_status_standalone: { en: "Standalone", mm: "တစ်လုံးတည်းသုံး" },
        sync_status_connected: { en: "Connected", mm: "ချိတ်ဆက်ပြီး" },
        sync_status_disconnected: { en: "Disconnected", mm: "မချိတ်ဆက်ရသေး" },
        alert_paste_remote_code: { en: "Please scan the QR code or paste the connection code from the other device first.", mm: "တစ်ဖက်စက်မှ QR Code ကို Scan ဖတ်ပါ (သို့မဟုတ်) Connection Code ကို ဦးစွာထည့်သွင်းပါ။" },

        title_gdrive_backup: { en: "Google Drive Backup & Restore", mm: "Google Drive အရန်သိမ်းခြင်းနှင့် ပြန်ယူခြင်း" },
        desc_gdrive_backup: { en: "Export your entire IndexedDB database as a JSON backup file directly to your Google Drive or restore from an existing backup.", mm: "လက်ရှိ ဒေတာအားလုံးကို Backup ဖိုင်အဖြစ် Google Drive သို့ တိုက်ရိုက်သိမ်းဆည်းခြင်း သို့မဟုတ် ပြန်လည်ရယူခြင်း ပြုလုပ်နိုင်ပါသည်။" },
        label_gdrive_client_id: { en: "Google OAuth 2.0 Client ID", mm: "Google OAuth 2.0 Client ID" },
        hint_gdrive_client_id: { en: "Enter your Google Cloud Web OAuth Client ID (with Drive API enabled). Saved locally on this device.", mm: "Google Cloud မှ Drive API ဖွင့်ထားသော Web OAuth Client ID ကို ထည့်သွင်းပါ။" },
        btn_gdrive_signin: { en: "Connect Google Drive", mm: "Google Drive ချိတ်ဆက်မည်" },
        btn_gdrive_backup: { en: "Backup to Google Drive", mm: "Google Drive သို့ Backup သိမ်းမည်" },
        btn_gdrive_restore: { en: "Restore from Google Drive", mm: "Google Drive မှ ပြန်ယူမည်" },
        gdrive_connected: { en: "Connected", mm: "ချိတ်ဆက်ပြီး" },
        gdrive_not_connected: { en: "Not Connected", mm: "မချိတ်ဆက်ရသေး" },
        label_local_json_backup: { en: "Offline JSON Backup File:", mm: "စက်ထဲသို့ Backup ဖိုင်ဖြင့် သိမ်းရန်:" },
        btn_export_json: { en: "Export Backup file", mm: "Backup file ထုတ်မည်" },
        btn_import_json: { en: "Import Backup file", mm: "Backup file ပြန်သွင်းမည်" },
        alert_enter_gdrive_client_id: { en: "Please enter your Google OAuth 2.0 Client ID first.", mm: "ကျေးဇူးပြု၍ Google OAuth 2.0 Client ID ကို ဦးစွာထည့်သွင်းပါ။" },
        alert_gdrive_sdk_missing: { en: "Google Sign-In library failed to load. Please ensure you have an active internet connection for Google Drive.", mm: "Google Sign-In စနစ် ချိတ်ဆက်၍မရပါ။ Google Drive သုံးရန် အင်တာနက်ချိတ်ဆက်မှု ရှိမရှိ စစ်ဆေးပါ။" },
        alert_gdrive_backup_success: { en: "Database backed up to Google Drive (FFPOS_Backup.json) successfully!", mm: "ဒေတာအားလုံးကို Google Drive သို့ အောင်မြင်စွာ Backup သိမ်းဆည်းပြီးပါပြီ။" },
        alert_gdrive_no_backup: { en: "No FFPOS_Backup.json file found in your Google Drive.", mm: "သင်၏ Google Drive ထဲတွင် FFPOS_Backup.json ဖိုင် မတွေ့ရှိပါ။" },
        confirm_gdrive_restore_msg: { en: "Are you sure you want to restore from backup ({date})? This will overwrite all current local data.", mm: "Backup ဖိုင် ({date}) မှ ဒေတာများကို ပြန်သွင်းမှာ သေချာပါသလား? လက်ရှိဒေတာများ အစားထိုးသွားပါမည်။" },
        alert_gdrive_restore_success: { en: "All data has been restored successfully!", mm: "ဒေတာအားလုံးကို အောင်မြင်စွာ ပြန်လည်ထည့်သွင်းပြီးပါပြီ။" },
        alert_invalid_backup_file: { en: "Invalid FFPOS backup JSON file.", mm: "FFPOS Backup ဖိုင်ပုံစံ မှားယွင်းနေပါသည်။" },

        title_delete_sample_data: { en: "Delete Sample / Demo Data", mm: "နမူနာဒေတာများ ဖျက်ပစ်မည်" },
        desc_delete_sample_data: { en: "Remove default sample products, purchases, household and HR entries.", mm: "စနစ်စတင်ချိန်တွင် ပါရှိသော နမူနာဒေတာများကိုသာ ရွေးချယ်ဖျက်ပစ်မည်" },
        btn_delete_sample_data: { en: "Delete Sample Data", mm: "နမူနာဒေတာများ ဖျက်မည်" },
        confirm_delete_sample_data_msg: { en: "Are you sure you want to remove all sample/demo records? Your custom data will be preserved.", mm: "နမူနာဒေတာများအားလုံးကို ဖျက်ထုတ်ပစ်မှာ သေချာပါသလား? သင်ကိုယ်တိုင်ထည့်ထားသော စာရင်းများ ပျက်ပြယ်မည်မဟုတ်ပါ။" },
        alert_sample_data_deleted: { en: "All sample data has been successfully removed!", mm: "နမူနာဒေတာများကို အောင်မြင်စွာ ဖျက်ပစ်ပြီးပါပြီ။" },
        label_delete_by_month: { en: "Delete Data by Month:", mm: "လအလိုက် Data ဖျက်ရန်:" },
        btn_delete_data_month: { en: "Delete Data for Month", mm: "လအတွက် Data ဖျက်မည်" },
        confirm_delete_data_for_month_msg: { en: "Are you sure you want to delete all sales and purchase records for {monthName} {year}? This action cannot be undone.", mm: "{year} ခုနှစ်၊ {monthName} လအတွက် အရောင်းနှင့်အဝယ်မှတ်တမ်းအားလုံးကို ဖျက်မှာသေချာလား? ဤလုပ်ဆောင်ချက်ကိုပြန်ပြင်၍မရပါ။" },
        alert_data_deleted_for_month: { en: "All sales and purchase data for {monthName} {year} has been deleted.", mm: "{year} ခုနှစ်၊ {monthName} လအတွက် အရောင်းနှင့်အဝယ်ဒေတာအားလုံးကို ဖျက်ပြီးပါပြီ။" },
        title_expiring_soon_products: { en: "Expiring Soon Products", mm: "ကုန်ဆုံးရက်နီး ကုန်ပစ္စည်းများ" },
        label_expiry_date: { en: "Expiration Date", mm: "ကုန်ဆုံးရက်" },
        label_show_expiring_in: { en: "Show expiring in (days):", mm: "ရက်အတွင်းကုန်ဆုံးမည့်:" },
        table_expiry_date: { en: "Expiry Date", mm: "ကုန်ဆုံးရက်" },
        empty_no_expiring_items: { en: "No items are expiring soon.", mm: "ကုန်ဆုံးရက်နီး ပစ္စည်းများ မရှိပါ။" },
        empty_no_expiring_items_for_filter: { en: "No expiring items match your filter.", mm: "သင်၏ရှာဖွေမှုနှင့်ကိုက်ညီသော ကုန်ဆုံးရက်နီးပစ္စည်းမရှိပါ။" },
        label_expiring_soon: { en: "Expiring Soon", mm: "ကုန်ဆုံးတော့မည်" },
        about_version: { en: "Version 01", mm: "Version 01" },
        about_description: {
            en: "A streamlined and efficient Point of Sale (POS) system built for modern retail businesses, stores, and individual record keeping.",
            mm: "ခေတ်မီလက်လီဆိုင်များ၊ ကုန်စုံဆိုင်များနှင့် ကိုယ်ပိုင်မှတ်တမ်းထားရှိသူများအတွက် ရိုးရှင်းလျင်မြန်စွာ အသုံးပြုနိုင်ရန် ဖန်တီးထားသော စနစ်ဖြစ်ပါသည်။"
        },
        orders_add_items: { en: "Add Items", mm: "ပစ္စည်းထည့်ရန်" },
        label_sale: { en: "Sale", mm: "အရောင်း" },
        label_subtotal: { en: "Subtotal", mm: "စုစုပေါင်း" },
        label_discount: { en: "Discount", mm: "လျှော့ဈေး" },
        label_tax_rate_value: { en: "Tax ({rate}%)", mm: "အခွန် ({rate}%)" },
        label_grand_total: { en: "Grand Total", mm: "ကျသင့်ငွေ" },
        table_image: { en: "Image", mm: "ပုံ" },
        table_name: { en: "Name", mm: "အမည်" },
        table_category: { en: "Category", mm: "အမျိုးအစား" },
        table_price: { en: "Price", mm: "ဈေးနှုန်း" },
        table_actions: { en: "Actions", mm: "လုပ်ဆောင်ချက်" },
        table_product_count: { en: "Product Count", mm: "ပစ္စည်းအရေအတွက်" },
        table_product_name: { en: "Product Name", mm: "ကုန်ပစ္စည်းအမည်" },
        table_supplier: { en: "Supplier", mm: "ပစ္စည်းသွင်းသူ" },
        table_quantity: { en: "Quantity", mm: "အရေအတွက်" },
        table_unit_cost: { en: "Unit Cost", mm: "တစ်ခုချင်းကုန်ကျစရိတ်" },
        table_total_cost: { en: "Total Cost", mm: "စုစုပေါင်းကုန်ကျစရိတ်" },
        table_date: { en: "Date", mm: "ရက်စွဲ" },
        table_product: { en: "Product", mm: "ကုန်ပစ္စည်း" },
        table_low_threshold: { en: "Low Threshold", mm: "အနည်းဆုံးသတ်မှတ်ချက်" },
        table_status: { en: "Status", mm: "အခြေအနေ" },
        table_sale_id: { en: "Sale ID", mm: "အရောင်း ID" },
        table_items_count: { en: "Items", mm: "ပစ္စည်းများ" },
        about_developer_title: { en: "Developer/Founder", mm: "Developer/Founder" },
        modal_sale_completed_title: { en: "Sale Completed", mm: "အရောင်းပြီးမြောက်ပါသည်" },
        empty_no_sales_found: { en: "No sales records found.", mm: "အရောင်းမှတ်တမ်းများ မတွေ့ပါ။" },
        btn_export_csv_short: { en: "CSV", mm: "CSV" },
        btn_export_pdf_short: { en: "PDF", mm: "PDF" },
        label_language: { en: "Language", mm: "ဘာသာစကား" },
        title_data_management: { en: "Data Management", mm: "ဒေတာစီမံခန့်ခွဲမှု" },
        title_generate_reports: { en: "Generate Reports", mm: "အစီရင်ခံစာထုတ်ရန်" },
        title_daily_report: { en: "Daily Report", mm: "နေ့စဉ်အစီရင်ခံစာ" },
        label_select_date: { en: "Select Date:", mm: "ရက်စွဲရွေးပါ:" },
        title_monthly_report: { en: "Monthly Report", mm: "လစဉ်အစီရင်ခံစာ" },
        label_select_month: { en: "Select Month:", mm: "လရွေးပါ:" },
        label_select_year: { en: "Select Year:", mm: "နှစ်ရွေးပါ:" },
        modal_add_product_title: { en: "Add Product", mm: "ပစ္စည်းအသစ်ထည့်ရန်" },
        modal_edit_product_title: { en: "Edit Product", mm: "ပစ္စည်းအချက်အလက်ပြင်ရန်" },
        modal_add_category_title: { en: "Add Category", mm: "အမျိုးအစားသစ်ထည့်ရန်" },
        modal_edit_category_title: { en: "Edit Category", mm: "အမျိုးအစားအမည်ပြင်ရန်" },
        modal_add_purchase_title: { en: "Add Purchase / Stock", mm: "အဝယ်စာရင်း/ကုန်ပစ္စည်းထည့်ရန်" },
        title_report: { en: "Report", mm: "အစီရင်ခံစာ" },
        label_product_name: { en: "Product Name", mm: "ပစ္စည်းအမည်" },
        label_category: { en: "Category", mm: "အမျိုးအစား" },
        label_price: { en: "Price", mm: "ဈေးနှုန်း" },
        label_product_image: { en: "Product Image", mm: "ပစ္စည်းပုံ" },
        label_category_name: { en: "Category Name", mm: "အမျိုးအစားအမည်" },
        label_product: { en: "Product", mm: "ကုန်ပစ္စည်း" },
        label_supplier_optional: { en: "Supplier (Optional)", mm: "ပစ္စည်းသွင်းသူ (ထည့်လိုလျှင်)" },
        label_quantity: { en: "Quantity", mm: "အရေအတွက်" },
        label_unit_cost: { en: "Unit Cost", mm: "တစ်ခုချင်းကုန်ကျစရိတ်" },
        label_total_cost: { en: "Total Cost", mm: "စုစုပေါင်းကုန်ကျစရိတ်" },
        label_date_time: { en: "Purchase Date & Time", mm: "အဝယ် ရက်စွဲနှင့်အချိန်" },
        btn_add_product: { en: "Add Product", mm: "ပစ္စည်းထည့်ရန်" },
        btn_add_category: { en: "Add Category", mm: "အမျိုးအစားထည့်ရန်" },
        btn_add_purchase: { en: "Add Purchase", mm: "အဝယ်ထည့်ရန်" },
        btn_complete: { en: "Complete", mm: "ပြီးပြီ" },
        btn_cancel: { en: "Cancel", mm: "မလုပ်တော့ပါ" },
        btn_confirm: { en: "Confirm", mm: "အတည်ပြုသည်" },
        btn_save_settings: { en: "Save Settings", mm: "ဆက်တင်များသိမ်းမည်" },
        btn_reset_all_data: { en: "Reset All Data", mm: "အားလုံးပြန်ဖျက်မည်" },
        btn_generate_daily_report: { en: "Generate Daily Report", mm: "နေ့စဉ် Report ထုတ်မည်" },
        btn_generate_monthly_report: { en: "Generate Monthly Report", mm: "လစဉ် Report ထုတ်မည်" },
        btn_delete: { en: "Delete", mm: "ဖျက်မည်" },
        btn_save_product: { en: "Save Product", mm: "ပစ္စည်းသိမ်းမည်" },
        btn_save: { en: "Save", mm: "သိမ်းမည်" },
        btn_save_purchase: { en: "Save Purchase", mm: "အဝယ်သိမ်းမည်" },
        btn_close: { en: "Close", mm: "ပိတ်မည်" },
        btn_share_receipt: { en: "Share Receipt", mm: "ဘောင်ချာမျှဝေမည်" },
        btn_save_image: { en: "Save Image", mm: "ပုံသိမ်းမည်" },
        placeholder_search_products: { en: "Search products...", mm: "ပစ္စည်းများရှာရန်..." },
        placeholder_search_stock: { en: "Search products in stock...", mm: "လက်ကျန်ရှိပစ္စည်းရှာရန်..." },
        placeholder_select_category: { en: "Select Category", mm: "အမျိုးအစားရွေးပါ" },
        placeholder_select_category_first: { en: "Select Category First", mm: "ဦးစွာအမျိုးအစားရွေးပါ" },
        placeholder_select_product: { en: "Select a Product", mm: "ပစ္စည်းတစ်ခုရွေးပါ" },
        empty_select_table: { en: "Select an item to begin", mm: "စတင်ရန် ပစ္စည်းတစ်ခုရွေးပါ" },
        empty_no_items_added: { en: "No items added", mm: "ပစ္စည်းမထည့်ရသေးပါ" },
        empty_no_products_yet: { en: "No products exist yet. Add one to get started!", mm: "ကုန်ပစ္စည်းများ မရှိသေးပါ။ စတင်ရန် တစ်ခုထည့်ပါ။" },
        empty_no_products_match: { en: "No products match your search.", mm: "သင်၏ရှာဖွေမှုနှင့် ကိုက်ညီသော ကုန်ပစ္စည်းမရှိပါ။" },
        empty_no_categories: { en: "No categories found", mm: "အမျိုးအစားများမတွေ့ပါ" },
        empty_no_purchases: { en: "No purchases found", mm: "အဝယ်စာရင်းများမတွေ့ပါ" },
        empty_no_stock: { en: "No stock records found", mm: "ကုန်လက်ကျန်မှတ်တမ်းမတွေ့ပါ" },
        empty_no_products_in_category: { en: "No products in this category", mm: "ဤအမျိုးအစားတွင် ပစ္စည်းမရှိပါ" },
        empty_no_purchases_for_filter: { en: "No purchases found for the selected filter.", mm: "ရှာဖွေမှုနှင့်ကိုက်ညီသော အဝယ်စာရင်းမတွေ့ပါ။" },
        empty_no_stock_for_filter: { en: "No stock records found for this filter", mm: "ရှာဖွေမှုနှင့်ကိုက်ညီသော ကုန်လက်ကျန်မတွေ့ပါ။" },
        warning_reset_data: { en: "Warning: Resetting data will delete all products, sales, and purchases and cannot be undone.", mm: "သတိပေးချက်- ဒေတာအားလုံးကိုပြန်ဖျက်ခြင်းသည် ကုန်ပစ္စည်း၊ အရောင်းနှင့် အဝယ်စာရင်းအားလုံးကို ဖျက်ပစ်မည်ဖြစ်ပြီး ပြန်လည်ရယူနိုင်မည်မဟုတ်ပါ။" },
        alert_out_of_stock: { en: "{productName} is out of stock!", mm: "{productName} ကုန်ပစ္စည်း ကုန်သွားပါပြီ!" },
        alert_not_enough_stock: { en: "Not enough stock!", mm: "ပစ္စည်းလက်ကျန်မလုံလောက်ပါ!" },
        confirm_complete_order_title: { en: "Complete Sale", mm: "အရောင်းပြီးမြောက်ရန်" },
        confirm_complete_order_msg: { en: "Are you sure you want to complete and process this sale?", mm: "ဤအရောင်းကို ပြီးမြောက်ကြောင်း အတည်ပြုမှာလား?" },
        alert_order_complete_fail: { en: "Failed to complete sale.", mm: "အရောင်းပြီးမြောက်ရန်မအောင်မြင်ပါ။" },
        alert_fill_all_fields: { en: "Please fill all required fields.", mm: "လိုအပ်သောကွက်လပ်အားလုံးကို ဖြည့်စွက်ပေးပါ။" },
        alert_enter_category_name: { en: "Please enter a category name.", mm: "အမျိုးအစားအမည်ကို ထည့်ပေးပါ။" },
        alert_save_category_fail: { en: "Failed to save category.", mm: "အမျိုးအစားသိမ်းဆည်းရန် မအောင်မြင်ပါ။" },
        alert_invalid_tax_rate: { en: "Please enter a valid, non-negative tax rate.", mm: "မှန်ကန်သော အခွန်နှုန်းထည့်ပါ။" },
        alert_empty_receipt_title: { en: "Receipt title cannot be empty.", mm: "ဘောင်ချာခေါင်းစဉ်အလွတ်မဖြစ်ရပါ။" },
        alert_settings_saved: { en: "Settings saved successfully!", mm: "ဆက်တင်များအောင်မြင်စွာသိမ်းလိုက်ပါပြီ။" },
        receipt_share_title: { en: "Your Receipt", mm: "သင်၏ဘောင်ချာ" },
        receipt_share_text: { en: "Here is your receipt.", mm: "ဤသည်မှာ သင်၏ဘောင်ချာဖြစ်ပါသည်။" },
        confirm_delete_item_title: { en: "Confirm Deletion", mm: "ဖျက်ရန်အတည်ပြုပါ" },
        confirm_delete_item_msg: { en: "Are you sure you want to delete this {type}? This action cannot be undone.", mm: "ဤ {type} ကိုဖျက်မှာသေချာလား? ဤလုပ်ဆောင်ချက်ကိုပြန်ပြင်၍မရပါ။" },
        entity_product: { en: "product", mm: "ကုန်ပစ္စည်း" },
        entity_category: { en: "category", mm: "အမျိုးအစား" },
        entity_purchase: { en: "purchase record", mm: "အဝယ်မှတ်တမ်း" },
        entity_sale: { en: "sale record", mm: "အရောင်းမှတ်တမ်း" },
        alert_cannot_delete_category: { en: "Cannot delete category. It has {count} product(s) assigned to it.", mm: "ဤအမျိုးအစားကိုဖျက်၍မရပါ။ ပစ္စည်း {count} ခုတွင်အသုံးပြုနေပါသည်။" },
        alert_delete_fail: { en: "Failed to delete item.", mm: "ဖျက်ရန်မအောင်မြင်ပါ။" },
        confirm_reset_all_data_title: { en: "Reset All Data", mm: "ဒေတာအားလုံးဖျက်မည်" },
        prompt_reset_all_data_msg: { en: "This will ERASE ALL DATA. To confirm, type \"DELETE\" below.", mm: "ဤလုပ်ဆောင်ချက်သည် ဒေတာအားလုံးကို ဖျက်ပစ်ပါမည်။ အတည်ပြုရန် \"DELETE\" ဟု ရိုက်ထည့်ပါ။" },
        prompt_reset_confirm_word: { en: "DELETE", mm: "DELETE" },
        alert_reset_cancelled: { en: "Reset cancelled.", mm: "ဖျက်ခြင်းကိုပယ်ဖျက်လိုက်သည်။" },
        alert_all_data_reset: { en: "All data has been reset.", mm: "ဒေတာအားလုံးကို ပြန်ဖျက်ပြီးပါပြီ။" },
        filter_all_categories: { en: "All Categories", mm: "အမျိုးအစားအားလုံး" },
        filter_all: { en: "All", mm: "အားလုံး" },
        filter_by_date: { en: "By Date", mm: "ရက်စွဲအလိုက်" },
        filter_by_month: { en: "By Month", mm: "လအလိုက်" },
        label_filter_by: { en: "Filter by:", mm: "စစ်ထုတ်ရန်:" },
        label_date: { en: "Date:", mm: "ရက်စွဲ:" },
        label_month: { en: "Month:", mm: "လ:" },
        label_year: { en: "Year:", mm: "နှစ်:" },
        btn_apply_filter: { en: "Apply Filter", mm: "စစ်ထုတ်မည်" },
        btn_clear_filter: { en: "Clear Filter", mm: "ပြန်စမည်" },
        label_uncategorized: { en: "Uncategorized", mm: "အမျိုးအစားမခွဲထား" },
        label_out_of_stock: { en: "Out of Stock", mm: "ကုန်ပစ္စည်းမရှိ" },
        label_low_stock: { en: "Low Stock", mm: "ကုန်တော့မည်" },
        label_in_stock: { en: "In Stock", mm: "ပစ္စည်းရှိ" },
        label_low_stock_only: { en: "Low Stock Only", mm: "လက်ကျန်နည်းတာပဲကြည့်မည်" },
        receipt_sale_id: { en: "Sale ID", mm: "အရောင်းနံပါတ်" },
        receipt_date: { en: "Date", mm: "ရက်စွဲ" },
        receipt_thank_you: { en: "Thank you for your purchase!", mm: "ဝယ်ယူအားပေးမှုအတွက် ကျေးဇူးတင်ပါသည်။" },
        table_item: { en: "Item", mm: "ပစ္စည်း" },
        table_qty: { en: "Qty", mm: "အရေအတွက်" },
        table_total: { en: "Total", mm: "စုစုပေါင်း" },
        label_total: { en: "Total", mm: "စုစုပေါင်း" },
        stat_total_revenue: { en: "Total Revenue", mm: "စုစုပေါင်းဝင်ငွေ" },
        stat_total_cost: { en: "Total Cost", mm: "စုစုပေါင်းကုန်ကျငွေ" },
        stat_net_profit: { en: "Net Profit", mm: "အသားတင်အမြတ်" },
        pagination_info: { en: "Page {current} of {total}", mm: "စာမျက်နှာ {total} ခုမှ {current}" },
        label_payment_method: { en: "Payment Method", mm: "ငွေပေးချေမှုပုံစံ" },
        stat_cash_sales: { en: "Cash Sales", mm: "လက်ငင်းရောင်းရငွေ" },
        stat_kbz_sales: { en: "KBZ Pay Sales", mm: "KBZ Pay ရောင်းရငွေ" },

        label_new_selling_price: { en: "New Selling Price (Optional)", mm: "ရောင်းဈေးအသစ် (ပြောင်းလိုပါက)" },
        label_current_price: { en: "Current Price:", mm: "လက်ရှိရောင်းဈေး:" },

        hh_this_month_income: { en: "This Month Income", mm: "ဒီလ စုစုပေါင်းဝင်ငွေ" },
        hh_this_month_expenses: { en: "This Month Expenses", mm: "ဒီလ စုစုပေါင်းအသုံးစရိတ်" },
        hh_recent_trans: { en: "Recent Transactions", mm: "မကြာသေးမီ ငွေစာရင်းများ" },
        hh_add_trans: { en: "Add Transaction", mm: "စာရင်းသစ်ထည့်မည်" },
        hh_type: { en: "Type", mm: "အမျိုးအစား" },
        hh_category: { en: "Category", mm: "ကဏ္ဍ" },
        hh_amount: { en: "Amount", mm: "ငွေပမာဏ" },
        hh_no_trans: { en: "No transactions yet.", mm: "ငွေစာရင်းမှတ်တမ်းများ မရှိသေးပါ။" },
        hh_type_expense: { en: "Expense", mm: "အသုံးစရိတ်" },
        hh_type_income: { en: "Income", mm: "ဝင်ငွေ" },
        hh_modal_add_trans: { en: "Add Household Transaction", mm: "အိမ်သုံးစရိတ်/ဝင်ငွေ စာရင်းထည့်ရန်" },

        hr_total_staff: { en: "Total Staff", mm: "ဝန်ထမ်း စုစုပေါင်း" },
        hr_active_staff: { en: "Active Staff", mm: "လက်ရှိဝန်ထမ်း" },
        hr_today_present: { en: "Today Present", mm: "ယနေ့ရုံးတက်" },
        hr_month_salary_paid: { en: "This Month Salary", mm: "ဒီလထုတ်ပေးပြီးလစာ" },
        hr_add_employee: { en: "Add Employee", mm: "ဝန်ထမ်းသစ်ထည့်ရန်" },
        hr_mark_attendance: { en: "Mark Attendance", mm: "ရုံးတက်မှတ်ရန်" },
        hr_pay_salary: { en: "Pay Salary", mm: "လစာထုတ်ပေးမည်" },
        hr_employees_tab: { en: "Employees", mm: "ဝန်ထမ်းများ" },
        hr_attendance_tab: { en: "Attendance", mm: "ရုံးတက်မှတ်တမ်း" },
        hr_payroll_tab: { en: "Payroll / Salary", mm: "လစာရှင်းတမ်း" },
        hr_emp_name: { en: "Employee Name", mm: "ဝန်ထမ်းအမည်" },
        hr_position: { en: "Role / Position", mm: "ရာထူး/တာဝန်" },
        hr_phone: { en: "Phone", mm: "ဖုန်းနံပါတ်" },
        hr_basic_salary: { en: "Basic Salary", mm: "အခြေခံလစာ" },
        hr_join_date: { en: "Join Date", mm: "စတင်ဝင်ရောက်သည့်ရက်" },
        hr_notes: { en: "Remarks / Reason", mm: "မှတ်ချက် / အကြောင်းပြချက်" },
        hr_bonus_allowance: { en: "Bonus / Allowance", mm: "အပိုဆုကြေး/စရိတ်" },
        hr_deductions: { en: "Deduction", mm: "ဖြတ်တောက်ငွေ" },
        hr_net_paid: { en: "Net Paid", mm: "အသားတင်ပေးငွေ" },
        hr_no_employees: { en: "No employees added yet.", mm: "ဝန်ထမ်းမှတ်တမ်းများ မရှိသေးပါ။" },
        hr_no_attendance: { en: "No attendance records found for this date.", mm: "ရွေးချယ်ထားသောရက်အတွက် ရုံးတက်မှတ်တမ်း မရှိပါ။" },
        hr_no_payroll: { en: "No payroll records found.", mm: "လစာပေးချေမှု မှတ်တမ်းမရှိသေးပါ။" },
        hr_modal_add_employee: { en: "Add Employee", mm: "ဝန်ထမ်းအသစ်ထည့်သွင်းရန်" },
        hr_modal_mark_attendance: { en: "Mark Attendance", mm: "ရုံးတက်/ခွင့် မှတ်တမ်းတင်ရန်" },
        hr_modal_pay_salary: { en: "Record Salary Payment", mm: "လစာထုတ်ပေးမှု မှတ်တမ်းတင်ရန်" },
        hr_select_employee: { en: "Select Employee", mm: "ဝန်ထမ်းရွေးချယ်ပါ" },
        hr_confirm_pay: { en: "Confirm & Pay", mm: "ငွေပေးချေမှုအတည်ပြုမည်" },

        menu_todo: { en: "To Do List", mm: "လုပ်ဆောင်ရန်စာရင်း" },
        todo_placeholder: { en: "Add a new task...", mm: "လုပ်ဆောင်စရာအသစ်တစ်ခု ထည့်ရန်..." },
        btn_add: { en: "Add", mm: "ထည့်မည်" },
        todo_empty: { en: "No tasks found. Yay!", mm: "လုပ်ဆောင်ရန်အလုပ်များ မရှိပါ။" },
        todo_btn_reminder: { en: "Reminders", mm: "သတိပေးချက်" },
        todo_status_pending: { en: "Pending", mm: "လုပ်ဆဲ" },
        todo_status_completed: { en: "Completed", mm: "ပြီးစီး" },
        todo_overdue: { en: "Overdue", mm: "ရက်ကျော်လွန်" },
        todo_due_soon: { en: "Due Soon", mm: "နီးကပ်နေပြီ" },
        todo_label_category: { en: "Category", mm: "အမျိုးအစား" },
        todo_label_priority: { en: "Priority", mm: "ဦးစားပေးအဆင့်" },
        todo_label_due_date: { en: "Due Date & Time", mm: "ပြီးဆုံးရမည့် ရက်စွဲ/အချိန်" },
        todo_label_title: { en: "Task Title", mm: "လုပ်ဆောင်ရန်အကြောင်းအရာ" },
        todo_modal_edit_title: { en: "Edit Task", mm: "လုပ်ဆောင်ရန်စာရင်း ပြင်ဆင်မည်" },
        todo_cat_shop: { en: "Shop", mm: "ဆိုင်အတွက်" },
        todo_cat_finance: { en: "Finance", mm: "ငွေစာရင်း" },
        todo_cat_inventory: { en: "Inventory", mm: "ကုန်ပစ္စည်း" },
        todo_cat_general: { en: "General", mm: "အထွေထွေ" },
        todo_prio_high: { en: "High", mm: "အရေးကြီး" },
        todo_prio_medium: { en: "Medium", mm: "သာမန်" },
        todo_prio_low: { en: "Low", mm: "နောက်မှ" },
        todo_search_placeholder: { en: "Search tasks...", mm: "စာရင်းရှာရန်..." },
        todo_drag_hint: { en: "Drag & drop tasks or use arrow buttons to reorder.", mm: "အလုပ်များကို ဖိဆွဲ၍ (Drag & Drop) သို့မဟုတ် မြှားခလုတ်များဖြင့် အစဉ်လိုက် နေရာရွှေ့နိုင်ပါသည်။" },
        todo_subtask_placeholder: { en: "Add subtask...", mm: "အလုပ်ငယ် (Subtask) ထည့်ရန်..." },
        todo_add_subtask: { en: "Subtask", mm: "ထည့်" },
        todo_overdue_warning_msg: { en: "Warning: You have {count} overdue task(s)!", mm: "သတိပေးချက်- သတ်မှတ်ရက် ကျော်လွန်နေသော အလုပ် {count} ခု ရှိနေပါသည်။" },
        todo_notif_unsupported: { en: "Browser notifications are not supported on this device.", mm: "ဤစက်တွင် Browser Notification စနစ်ကို ပံ့ပိုးမထားပါ။" },
        todo_notif_enabled: { en: "Task reminders enabled!", mm: "သတိပေးချက်စနစ်ကို ဖွင့်လှစ်ပြီးပါပြီ။" },
        todo_notif_denied: { en: "Notification permission was denied.", mm: "Notification ခွင့်ပြုချက် ပိတ်ထားပါသည်။" },

        month_names: {
            en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
            mm: ["ဇန်နဝါရီ", "ဖေဖော်ဝါရီ", "မတ်", "ဧပြီ", "မေ", "ဇွန်", "ဇူလိုင်", "ဩဂုတ်", "စက်တင်ဘာ", "အောက်တိုဘာ", "နိုဝင်ဘာ", "ဒီဇင်ဘာ"]
        }
    };

    function getTranslation(key, replacements = {}) {
        const lang = state.currentLanguage;
        let text = translations[key]?.[lang] || translations[key]?.['en'] || key;
        if (typeof text === 'string') {
            for (const placeholder in replacements) {
                text = text.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), replacements[placeholder]);
            }
        }
        return text;
    }

    function translateUI(lang) {
        document.documentElement.lang = lang;
        document.querySelectorAll('[data-translate]').forEach(el => {
            const key = el.dataset.translate;
            const translationType = el.dataset.translateType;
            const text = getTranslation(key);
            if (translationType === 'list') el.innerHTML = text;
            else el.textContent = text;
        });
        document.querySelectorAll('[data-translate-placeholder]').forEach(el => {
            const key = el.dataset.translatePlaceholder;
            el.placeholder = getTranslation(key);
        });
        updateSyncStatusUI();
        updateGDriveAuthUI();
    }

    async function setLanguage(lang) {
        state.currentLanguage = lang;
        document.getElementById('language-select').value = lang;
        await db.put('settings', { key: 'language', value: lang });
        await populateFilterDropdowns();
        populateDynamicFilters();
        await renderReportsPage();
        await renderSettingsPage();
        translateUI(lang);
        if (state.currentSection === 'todo') {
            await renderTodoPage();
        }
        if (state.currentSection === 'user-guide') {
            renderUserGuidePage();
        }
    }

    function setupEventListeners() {
        UIElements.sidebarLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navigateTo(e.currentTarget.dataset.section);
                if (window.innerWidth < 992) UIElements.sidebar.classList.remove('show');
            });
        });

        document.getElementById('header-sync-badge').addEventListener('click', () => {
            navigateTo('settings');
            switchSettingsTab('sync');
        });

        document.querySelectorAll('.home-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.targetSection;
                if (target) navigateTo(target);
            });
        });

        UIElements.menuToggle.addEventListener('click', () => UIElements.sidebar.classList.toggle('show'));
        document.getElementById('add-new-product-btn').addEventListener('click', () => openProductModal());
        document.getElementById('add-new-category-btn').addEventListener('click', () => openCategoryModal());
        document.getElementById('add-new-purchase-btn').addEventListener('click', () => openPurchaseModal());
        
        document.getElementById('products-search-input').addEventListener('input', () => { state.productsPage = 1; renderProductsPage(); });
        document.getElementById('product-category-filter').addEventListener('change', () => { state.productsPage = 1; renderProductsPage(); });
        document.getElementById('prev-page-btn').addEventListener('click', () => { if(state.productsPage > 1) { state.productsPage--; renderProductsPage(); } });
        document.getElementById('next-page-btn').addEventListener('click', () => { state.productsPage++; renderProductsPage(); });
        
        document.getElementById('stock-search-input').addEventListener('input', () => { state.stockPage = 1; renderStockPage(); });
        document.getElementById('stock-category-filter').addEventListener('change', () => { state.stockPage = 1; renderStockPage(); });
        document.getElementById('stock-low-filter').addEventListener('change', () => { state.stockPage = 1; renderStockPage(); });
        document.getElementById('stock-prev-page-btn').addEventListener('click', () => { if(state.stockPage > 1) { state.stockPage--; renderStockPage(); } });
        document.getElementById('stock-next-page-btn').addEventListener('click', () => { state.stockPage++; renderStockPage(); });
        document.getElementById('stock-table').addEventListener('change', handleStockThresholdChange);
        
        document.getElementById('prev-category-page-btn').addEventListener('click', () => { if(state.categoriesPage > 1) { state.categoriesPage--; renderCategoriesPage(); } });
        document.getElementById('next-category-page-btn').addEventListener('click', () => { state.categoriesPage++; renderCategoriesPage(); });
        
        document.getElementById('expiring-soon-search-input').addEventListener('input', () => { state.expiringSoonPage = 1; renderExpiringSoonPage(); });
        document.getElementById('expiring-soon-category-filter').addEventListener('change', () => { state.expiringSoonPage = 1; renderExpiringSoonPage(); });
        document.getElementById('expiring-days-filter').addEventListener('change', () => { state.expiringSoonPage = 1; renderExpiringSoonPage(); });
        document.getElementById('expiring-soon-prev-page-btn').addEventListener('click', () => { if(state.expiringSoonPage > 1) { state.expiringSoonPage--; renderExpiringSoonPage(); } });
        document.getElementById('expiring-soon-next-page-btn').addEventListener('click', () => { state.expiringSoonPage++; renderExpiringSoonPage(); });
        
        document.getElementById('category-tabs').addEventListener('click', e => { if (e.target.matches('.akmcategory-tab')) renderProductsGrid(e.target.dataset.id); });
        document.getElementById('products-grid').addEventListener('click', e => { const card = e.target.closest('.akmproduct-card:not(.disabled)'); if (card) addProductToOrder(card.dataset.id); });
        document.getElementById('order-items-list').addEventListener('click', handleOrderItemQuantityChange);
        document.getElementById('order-discount').addEventListener('input', renderCurrentOrder); 
        document.getElementById('order-payment-method').addEventListener('change', (e) => {
            if(state.currentOrder) state.currentOrder.paymentMethod = e.target.value;
        });
        document.getElementById('product-search').addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val.length > 2) findProductByBarcodeAndAdd(val);
            renderProductsGrid(document.querySelector('.akmcategory-tab.active')?.dataset.id || 'all');
        });
        document.getElementById('product-search').addEventListener('keypress', (e) => {
             if (e.key === 'Enter') {
                 const val = e.target.value.trim();
                 if(val) findProductByBarcodeAndAdd(val, true);
             }
        });

        document.getElementById('complete-order-btn').addEventListener('click', handleCompleteOrder);
        document.getElementById('cancel-order-btn').addEventListener('click', handleCancelOrder);
        
        document.getElementById('purchase-category').addEventListener('change', handlePurchaseCategoryChange);
        document.getElementById('purchase-product').addEventListener('change', handlePurchaseProductChange);
        setupPurchaseCostCalculators();
        
        document.getElementById('purchase-filter-type').addEventListener('change', () => {
            const type = document.querySelector('input[name="purchase-filter-type"]:checked').value;
            document.getElementById('purchase-date-filter-group').style.display = type === 'date' ? 'flex' : 'none';
            document.getElementById('purchase-month-filter-group').style.display = type === 'month' ? 'flex' : 'none';
        });
        document.getElementById('apply-purchase-filter-btn').addEventListener('click', renderPurchasesPage);
        document.getElementById('clear-purchase-filter-btn').addEventListener('click', () => {
            document.getElementById('filter-all-purchases').checked = true;
            document.getElementById('purchase-date-filter-group').style.display = 'none';
            document.getElementById('purchase-month-filter-group').style.display = 'none';
            renderPurchasesPage();
        });
        document.getElementById('export-purchases-pdf-btn').addEventListener('click', handleExportPurchasesPDF);
        document.getElementById('export-purchases-csv-btn').addEventListener('click', handleExportPurchasesCSV);
        
        document.getElementById('sale-history-filter-type').addEventListener('change', () => {
            const type = document.querySelector('input[name="sale-filter-type"]:checked').value;
            document.getElementById('sale-history-date-filter-group').style.display = type === 'date' ? 'flex' : 'none';
            document.getElementById('sale-history-month-filter-group').style.display = type === 'month' ? 'flex' : 'none';
        });
        document.getElementById('apply-sale-history-filter-btn').addEventListener('click', renderSaleHistoryPage);
        document.getElementById('clear-sale-history-filter-btn').addEventListener('click', () => {
            document.getElementById('filter-all-sales').checked = true;
            document.getElementById('sale-history-date-filter-group').style.display = 'none';
            document.getElementById('sale-history-month-filter-group').style.display = 'none';
            renderSaleHistoryPage();
        });
        document.getElementById('sale-history-prev-page-btn').addEventListener('click', () => { if(state.saleHistoryPage > 1) { state.saleHistoryPage--; renderSaleHistoryPage(); } });
        document.getElementById('sale-history-next-page-btn').addEventListener('click', () => { state.saleHistoryPage++; renderSaleHistoryPage(); });
        document.getElementById('export-sales-pdf-btn').addEventListener('click', handleExportSalesPDF);
        document.getElementById('export-sales-csv-btn').addEventListener('click', handleExportSalesCSV);
        
        document.getElementById('language-select').addEventListener('change', (e) => setLanguage(e.target.value));
        document.getElementById('app-mode-select').addEventListener('change', handleAppModeChange);
        document.getElementById('theme-select').addEventListener('change', async (e) => {
            await db.put('settings', { key: 'theme', value: e.target.value });
            await applyTheme();
        });
        document.getElementById('delete-data-by-month-btn').addEventListener('click', handleDeleteDataByMonth);
        document.getElementById('reset-data-btn').addEventListener('click', handleResetAllData);
        document.getElementById('delete-sample-data-btn').addEventListener('click', handleDeleteSampleData);

        document.getElementById('sync-role-select').addEventListener('change', async (e) => {
            state.syncRole = e.target.value;
            await db.put('settings', { key: 'syncRole', value: state.syncRole });
            disconnectAllRtc();
            updateSyncPanelVisibility();
            updateSyncStatusUI();
            appendSyncLog(`Role changed to: ${state.syncRole}.`);
        });
        document.getElementById('rtc-create-offer-btn').addEventListener('click', createRtcOffer);
        document.getElementById('rtc-scan-offer-btn').addEventListener('click', () => startScanner('rtc-offer-scan'));
        document.getElementById('rtc-scan-answer-btn').addEventListener('click', () => startScanner('rtc-answer-scan'));
        document.getElementById('rtc-accept-offer-btn').addEventListener('click', () => acceptRtcOfferAndCreateAnswer());
        document.getElementById('rtc-accept-answer-btn').addEventListener('click', () => acceptRtcAnswerOnServer());
        document.getElementById('rtc-sync-now-btn').addEventListener('click', manualSyncNow);
        document.getElementById('rtc-disconnect-btn').addEventListener('click', disconnectAllRtc);
        document.getElementById('rtc-copy-local-btn').addEventListener('click', async () => {
            const val = document.getElementById('rtc-local-sdp').value;
            if (!val) return;
            try {
                await navigator.clipboard.writeText(val);
                appendSyncLog('Connection code copied to clipboard.');
            } catch {
                document.getElementById('rtc-local-sdp').select();
                document.execCommand('copy');
            }
        });

        document.getElementById('gdrive-signin-btn').addEventListener('click', signInGoogleDrive);
        document.getElementById('gdrive-signin-btn').addEventListener('click', signInGoogleDrive);
        document.getElementById('gdrive-backup-btn').addEventListener('click', handleBackupToGoogleDrive);
        document.getElementById('gdrive-restore-btn').addEventListener('click', handleRestoreFromGoogleDrive);
        document.getElementById('local-backup-export-btn').addEventListener('click', handleLocalJsonExport);
        document.getElementById('local-backup-import-btn').addEventListener('click', () => document.getElementById('local-backup-file-input').click());
        document.getElementById('local-backup-file-input').addEventListener('change', handleLocalJsonImportFile);

        document.getElementById('connect-bt-printer-btn').addEventListener('click', connectBluetoothPrinter);
        document.getElementById('test-print-btn').addEventListener('click', () => {
            const testOrder = {
                id: 'test-12345678',
                items: [{ name: 'Test Product 1', quantity: 2, price: 1500 }],
                subtotal: 3000,
                discount: 0,
                tax: 0,
                total: 3000,
                paymentMethod: 'Cash'
            };
            printReceiptThermal(testOrder);
        });
        document.getElementById('print-receipt-btn').addEventListener('click', () => {
            if (state.lastCompletedOrder) printReceiptThermal(state.lastCompletedOrder);
        });
        document.getElementById('print-sale-details-btn').addEventListener('click', () => {
            if (state.lastCompletedOrder) printReceiptThermal(state.lastCompletedOrder);
        });

        document.getElementById('save-product-btn').addEventListener('click', handleSaveProduct);
        document.getElementById('save-category-btn').addEventListener('click', handleSaveCategory);
        document.getElementById('save-purchase-btn').addEventListener('click', handleSavePurchase);
        document.getElementById('save-settings-btn').addEventListener('click', handleSaveSettings);
        document.getElementById('generate-report-btn').addEventListener('click', generateDailyReport);
        document.getElementById('generate-monthly-report-btn').addEventListener('click', generateMonthlyReport);
        
        document.querySelectorAll('.akm-modal-close').forEach(btn => btn.addEventListener('click', (e) => closeModal(e.target.closest('.akm-modal').id)));
        document.getElementById('ad-modal-close-btn').addEventListener('click', () => {
            adDismissedInSession = true;
            closeModal('ad-popup-modal');
        });
        document.body.addEventListener('click', handleBodyClick);
        document.getElementById('confirm-modal-cancel-btn').addEventListener('click', () => closeModal('confirm-modal'));
        document.getElementById('delete-product-btn').addEventListener('click', () => {
            const id = document.getElementById('product-id').value;
            if(id) openDeleteModal(id, 'product', true);
        });
        document.getElementById('delete-category-btn').addEventListener('click', () => {
            const id = document.getElementById('category-id').value;
            if(id) openDeleteModal(id, 'category', true);
        });
        document.getElementById('share-receipt-btn').addEventListener('click', handleShareReceipt);
        document.getElementById('save-receipt-img-btn').addEventListener('click', handleSaveReceiptImage);
        
        const todoInput = document.getElementById('new-todo-input');
        if (todoInput) {
            todoInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') addTodo();
            });
        }

        setupImageUploadListeners();
    }
    
    window.stopScanner = async function() {
        if (html5QrCode) {
            try {
                if (html5QrCode.isScanning) {
                    await html5QrCode.stop();
                }
                html5QrCode.clear();
            } catch (err) {
                console.warn("Scanner stop issue:", err);
            }
            html5QrCode = null;
        }
        closeModal('scanner-modal');
    };

    window.startScanner = function(targetInputId) {
        openModal('scanner-modal');

        const readerContainer = document.getElementById("scanner-reader");
        if (readerContainer) {
            readerContainer.innerHTML = '<div style="color:#ffffff; text-align:center; padding:50px 10px;"><i class="fas fa-spinner fa-spin fa-2x"></i><br><br>ကင်မရာ ဖွင့်နေပါသည်...</div>';
        }

        setTimeout(async () => {
            try {
                if (html5QrCode) {
                    try {
                        if (html5QrCode.isScanning) await html5QrCode.stop();
                        html5QrCode.clear();
                    } catch(e) {}
                    html5QrCode = null;
                }

                if (readerContainer) readerContainer.innerHTML = '';

                let formats = undefined;
                if (typeof Html5QrcodeSupportedFormats !== 'undefined') {
                    formats = Object.values(Html5QrcodeSupportedFormats);
                } else if (window.Html5QrcodeSupportedFormats) {
                    formats = Object.values(window.Html5QrcodeSupportedFormats);
                }

                const config = {
                    verbose: false
                };
                if (formats && formats.length > 0) {
                    config.formatsToSupport = formats;
                }

                html5QrCode = new Html5Qrcode("scanner-reader", config);

                const qrboxFunction = (viewfinderWidth, viewfinderHeight) => {
                    const width = Math.floor(viewfinderWidth * 0.85);
                    const height = Math.floor(Math.min(viewfinderHeight * 0.55, 180));
                    return {
                        width: Math.max(width, 240),
                        height: Math.max(height, 120)
                    };
                };

                const scanConfig = {
                    fps: 15,
                    qrbox: qrboxFunction,
                    disableFlip: false
                };

                await html5QrCode.start(
                    { facingMode: "environment" },
                    scanConfig,
                    (decodedText) => {
                        window.stopScanner();

                        const targetEl = document.getElementById(targetInputId);
                        if (targetEl) {
                            targetEl.value = decodedText;
                            targetEl.dispatchEvent(new Event('input'));
                        }

                        if (targetInputId === 'product-search') {
                            findProductByBarcodeAndAdd(decodedText, true);
                        } else if (targetInputId === 'rtc-offer-scan') {
                            document.getElementById('rtc-remote-sdp').value = decodedText;
                            acceptRtcOfferAndCreateAnswer(decodedText);
                        } else if (targetInputId === 'rtc-answer-scan') {
                            document.getElementById('rtc-remote-sdp').value = decodedText;
                            acceptRtcAnswerOnServer(decodedText);
                        }
                    },
                    (errorMessage) => {
                        // scanning frame မတွေ့သေးသည့် သာမန် log များ
                    }
                );
            } catch (err) {
                console.error("Camera Open Error:", err);
                alert("ကင်မရာဖွင့်၍ မရပါ။ ကျေးဇူးပြု၍ Browser Settings တွင် Camera Permission ခွင့်ပြုပေးထားခြင်း ရှိမရှိ စစ်ဆေးပါ။");
                closeModal('scanner-modal');
            }
        }, 300);
    };
    
    async function findProductByBarcodeAndAdd(barcode, autoAdd = false) {
        const allProducts = await db.getAll('products');
        const product = allProducts.find(p => p.barcode === barcode);
        if (product && autoAdd) {
            addProductToOrder(product.id);
            document.getElementById('product-search').value = '';
            renderProductsGrid(document.querySelector('.akmcategory-tab.active')?.dataset.id || 'all');
        }
    }

    function handleBodyClick(e) {
        const button = e.target.closest('button');
        const image = e.target.closest('.akmproduct-table-image');
        if (button) {
            const { action, id } = button.dataset;
            if (!action || !id) return;
            switch(action) {
                case 'edit-product': openProductModal(id); break;
                case 'delete-product': openDeleteModal(id, 'product'); break;
                case 'edit-category': openCategoryModal(id); break;
                case 'delete-category': openDeleteModal(id, 'category'); break;
                case 'delete-purchase': openDeleteModal(id, 'purchase'); break;
                case 'delete-sale': openDeleteModal(id, 'sale'); break;
                case 'view-sale': showSaleDetails(id); break;
            }
        }
        if (image) viewFullImage(image.src);
    }

    async function showSaleDetails(saleId) {
        const sale = await db.get('orders', saleId);
        if (!sale) return;
        state.lastCompletedOrder = sale;

        const modalTitle = document.getElementById('sale-details-title');
        const modalBody = document.getElementById('sale-details-body');
        modalTitle.textContent = `${getTranslation('label_sale')} #${sale.id.slice(-8)}`;
        
        const itemsHtml = sale.items.map(item => `
            <tr>
                <td>${item.name}</td>
                <td>${item.quantity}</td>
                <td style="text-align:right;">${formatCurrency(item.price)}</td>
                <td style="text-align:right;">${formatCurrency(item.price * item.quantity)}</td>
            </tr>
        `).join('');

        modalBody.innerHTML = `
            <p><strong>${getTranslation('table_date')}:</strong> ${sale.date}</p>
            <p><strong>${getTranslation('label_payment_method')}:</strong> ${sale.paymentMethod || 'Cash'}</p>
            <div class="akmtable-responsive">
                <table class="akmtable">
                    <thead>
                        <tr>
                            <th>${getTranslation('table_item')}</th>
                            <th>${getTranslation('table_qty')}</th>
                            <th style="text-align:right;">${getTranslation('table_price')}</th>
                            <th style="text-align:right;">${getTranslation('table_total')}</th>
                        </tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
            </div>
            <div class="akmorder-summary" style="margin-top: 15px; border-top: 1px solid var(--border-color);">
                <div class="akmsummary-row">
                    <span class="akmsummary-label">${getTranslation('label_subtotal')}:</span>
                    <span class="akmsummary-value">${formatCurrency(sale.subtotal)}</span>
                </div>
                <div class="akmsummary-row">
                    <span class="akmsummary-label">${getTranslation('label_discount')}:</span>
                    <span class="akmsummary-value">${formatCurrency(sale.discount)}</span>
                </div>
                <div class="akmsummary-row">
                    <span class="akmsummary-label">${getTranslation('label_tax_rate_value', { rate: state.taxRate })}:</span>
                    <span class="akmsummary-value">${formatCurrency(sale.tax)}</span>
                </div>
                <div class="akmsummary-row akmgrand-total">
                    <span class="akmsummary-label">${getTranslation('label_grand_total')}:</span>
                    <span class="akmsummary-value">${formatCurrency(sale.total)}</span>
                </div>
            </div>
        `;
        openModal('sale-details-modal');
    }

    async function handleStockThresholdChange(e) {
        if (e.target.classList.contains('akmstock-threshold-input')) {
            const productId = e.target.dataset.productId;
            const newThreshold = parseInt(e.target.value, 10);
            if (productId && !isNaN(newThreshold) && newThreshold >= 0) {
                try {
                    const stockItem = await db.get('stock', productId);
                    stockItem.lowThreshold = newThreshold;
                    await db.put('stock', stockItem);
                    e.target.style.borderColor = 'var(--success-color)';
                    setTimeout(() => { e.target.style.borderColor = '' }, 2000 );
                    await renderStockPage();
                    await syncBroadcastSnapshotIfServer();
                } catch (error) {
                    console.error('Failed to update threshold:', error);
                    e.target.style.borderColor = 'var(--danger-color)';
                }
            }
        }
    }

    function handleOrderItemQuantityChange(e) {
        const button = e.target.closest('button');
        if(!button) return;
        const action = button.dataset.action;
        const productId = button.dataset.id;
        if (action === 'increase-qty') updateOrderItemQuantity(productId, 1);
        else if (action === 'decrease-qty') updateOrderItemQuantity(productId, -1);
    }

    async function handleAppModeChange(e) {
        const newMode = e.target.value;
        await db.put('settings', { key: 'appMode', value: newMode });
        applyAppMode(newMode);
    }

    function setupImageUploadListeners() {
        const imageUpload = document.getElementById('product-image-upload');
        const imagePreview = document.getElementById('product-image-preview');
        const removeImageBtn = document.getElementById('remove-image-btn');
        imageUpload.addEventListener('change', () => {
            const file = imageUpload.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    imagePreview.src = e.target.result;
                    imagePreview.style.display = 'block';
                    removeImageBtn.style.display = 'inline-flex';
                };
                reader.readAsDataURL(file);
            }
        });
        removeImageBtn.addEventListener('click', () => {
            imagePreview.src = '';
            imagePreview.style.display = 'none';
            removeImageBtn.style.display = 'none';
            imageUpload.value = '';
        });
    }

    function createNewOrderObject() {
        state.currentOrder = {
            id: `ord-${Date.now()}`,
            date: new Date().toISOString().slice(0, 10),
            status: 'active',
            items: [],
            subtotal: 0, 
            discount: 0,
            tax: 0, 
            total: 0,
            paymentMethod: document.getElementById('order-payment-method').value || 'Cash'
        };
        document.getElementById('order-discount').value = '';
    }

    async function addProductToOrder(productId) {
        if (!state.currentOrder) createNewOrderObject();
        const [product, stock] = await Promise.all([db.get('products', productId), db.get('stock', productId)]);
        const existingItem = state.currentOrder.items.find(item => item.productId === productId);
        if (stock.quantity <= (existingItem ? existingItem.quantity : 0)) {
            alert(getTranslation('alert_out_of_stock', { productName: product.name }));
            return;
        }
        if (existingItem) existingItem.quantity++;
        else state.currentOrder.items.push({ productId: product.id, name: product.name, price: product.price, quantity: 1 });
        renderCurrentOrder();
    }

    async function updateOrderItemQuantity(productId, change) {
        const item = state.currentOrder.items.find(i => i.productId === productId);
        if (!item) return;
        if (change > 0) {
            const stock = await db.get('stock', productId);
            if (item.quantity + change > stock.quantity) {
                alert(getTranslation('alert_not_enough_stock'));
                return;
            }
        }
        item.quantity += change;
        if (item.quantity <= 0) state.currentOrder.items = state.currentOrder.items.filter(i => i.productId !== productId);
        renderCurrentOrder();
    }

    function handleCompleteOrder() {
        if (!state.currentOrder || state.currentOrder.items.length === 0) return;
        showConfirmation({
            title: getTranslation('confirm_complete_order_title'),
            message: getTranslation('confirm_complete_order_msg'),
            isDanger: false,
            okText: 'btn_complete',
            async onConfirm() {
                try {
                    for (const item of state.currentOrder.items) {
                        const stockItem = await db.get('stock', item.productId);
                        if (stockItem) {
                            stockItem.quantity = Math.max(0, stockItem.quantity - item.quantity);
                            await db.put('stock', stockItem);
                        }
                    }
                    state.currentOrder.status = 'completed';
                    state.currentOrder.paymentMethod = document.getElementById('order-payment-method').value;
                    const completedOrder = { ...state.currentOrder };
                    await db.add('orders', completedOrder);
                    state.currentOrder = null;
                    state.lastCompletedOrder = completedOrder;
                    closeModal('confirm-modal');
                    await syncAfterOrderCompleted(completedOrder);
                    await renderOrdersPage();
                    await showReceiptModal(completedOrder);
                } catch (error) {
                    console.error('Error completing order:', error);
                    alert(getTranslation('alert_order_complete_fail'));
                    closeModal('confirm-modal');
                }
            }
        });
    }

    function handleCancelOrder() {
        if (!state.currentOrder) return;
        state.currentOrder = null;
        renderOrdersPage();
    }

    async function openProductModal(productId = null) {
        document.getElementById('product-form').reset();
        document.getElementById('product-image-preview').style.display = 'none';
        document.getElementById('remove-image-btn').style.display = 'none';
        const catSelect = document.getElementById('product-category');
        catSelect.innerHTML = `<option value="">${getTranslation('placeholder_select_category')}</option>` + 
            (await db.getAll('categories')).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        const title = document.getElementById('product-modal-title');
        const delBtn = document.getElementById('delete-product-btn');
        const idInput = document.getElementById('product-id');
        if (productId) {
            const product = await db.get('products', productId);
            title.textContent = getTranslation('modal_edit_product_title');
            delBtn.style.display = 'inline-flex';
            idInput.value = product.id;
            document.getElementById('product-name').value = product.name;
            document.getElementById('product-price').value = product.price;
            document.getElementById('product-barcode').value = product.barcode || '';
            catSelect.value = product.categoryId;
            if (product.image) {
                document.getElementById('product-image-preview').src = product.image;
                document.getElementById('product-image-preview').style.display = 'block';
                document.getElementById('remove-image-btn').style.display = 'inline-flex';
            }
        } else {
            title.textContent = getTranslation('modal_add_product_title');
            delBtn.style.display = 'none';
            idInput.value = '';
        }
        openModal('product-modal');
    }

    async function handleSaveProduct() {
        const id = document.getElementById('product-id').value;
        const name = document.getElementById('product-name').value.trim();
        const price = parseFloat(document.getElementById('product-price').value);
        const categoryId = document.getElementById('product-category').value;
        const barcode = document.getElementById('product-barcode').value.trim();
        const imageSrc = document.getElementById('product-image-preview').src;
        const image = imageSrc.startsWith('data:image') ? imageSrc : null;
        if (!name || isNaN(price) || !categoryId) { alert(getTranslation('alert_fill_all_fields')); return; }
        try {
            if (id) {
                const product = await db.get('products', id);
                await db.put('products', { ...product, name, price, categoryId, image, barcode });
            } else {
                const newId = `prod-${Date.now()}`;
                await db.add('products', { id: newId, name, price, categoryId, image, barcode });
                await db.add('stock', { productId: newId, quantity: 0, lowThreshold: 10 });
            }
            await renderProductsPage();
            await renderStockPage();
            await syncBroadcastSnapshotIfServer();
            closeModal('product-modal');
        } catch (error) {
            console.error('Error saving product:', error);
        }
    }

    async function openCategoryModal(categoryId = null) {
        document.getElementById('category-form').reset();
        const title = document.getElementById('category-modal-title');
        const delBtn = document.getElementById('delete-category-btn');
        const idInput = document.getElementById('category-id');
        if (categoryId) {
            const category = await db.get('categories', categoryId);
            title.textContent = getTranslation('modal_edit_category_title');
            delBtn.style.display = 'inline-flex';
            idInput.value = category.id;
            document.getElementById('category-name').value = category.name;
        } else {
            title.textContent = getTranslation('modal_add_category_title');
            delBtn.style.display = 'none';
            idInput.value = '';
        }
        openModal('category-modal');
    }

    async function handleSaveCategory() {
        const id = document.getElementById('category-id').value;
        const name = document.getElementById('category-name').value.trim();
        if (!name) { alert(getTranslation('alert_enter_category_name')); return; }
        try {
            if (id) await db.put('categories', { id, name });
            else await db.add('categories', { id: `cat-${Date.now()}`, name });
            await renderCategoriesPage();
            await populateFilterDropdowns();
            await syncBroadcastSnapshotIfServer();
            closeModal('category-modal');
        } catch (error) {
            console.error('Error saving category:', error);
            alert(getTranslation('alert_save_category_fail'));
        }
    }

    async function openPurchaseModal() {
        document.getElementById('purchase-form').reset();
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('purchase-date').value = now.toISOString().slice(0, 16);
        const categories = await db.getAll('categories');
        document.getElementById('purchase-category').innerHTML = `<option value="">${getTranslation('placeholder_select_category_first')}</option>` + 
            categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        document.getElementById('purchase-product').innerHTML = `<option value="">${getTranslation('placeholder_select_product')}</option>`;
        document.getElementById('purchase-product').disabled = true;
        document.getElementById('current-price-hint').textContent = '';
        openModal('purchase-modal');
    }

    async function handlePurchaseCategoryChange() {
        const categoryId = document.getElementById('purchase-category').value;
        document.getElementById('current-price-hint').textContent = '';
        document.getElementById('purchase-new-price').value = '';

        if (!categoryId) {
            document.getElementById('purchase-product').innerHTML = `<option value="">${getTranslation('placeholder_select_product')}</option>`;
            document.getElementById('purchase-product').disabled = true;
            return;
        }
        const allProducts = await db.getAll('products');
        const filteredProducts = allProducts.filter(p => p.categoryId === categoryId);
        if(filteredProducts.length > 0) {
            document.getElementById('purchase-product').innerHTML = `<option value="" disabled selected>${getTranslation('placeholder_select_product')}</option>` + filteredProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            document.getElementById('purchase-product').disabled = false;
        } else {
            document.getElementById('purchase-product').innerHTML = `<option value="">${getTranslation('empty_no_products_in_category')}</option>`;
            document.getElementById('purchase-product').disabled = true;
        }
    }

    async function handlePurchaseProductChange() {
        const productId = document.getElementById('purchase-product').value;
        const hintEl = document.getElementById('current-price-hint');
        document.getElementById('purchase-new-price').value = '';
        if (!productId) { hintEl.textContent = ''; return; }
        try {
            const product = await db.get('products', productId);
            if (product) hintEl.textContent = `${getTranslation('label_current_price')} ${formatCurrency(product.price)}`;
        } catch (err) {
            hintEl.textContent = '';
        }
    }

    function setupPurchaseCostCalculators() {
        const quantityInput = document.getElementById('purchase-quantity');
        const unitCostInput = document.getElementById('purchase-unit-cost');
        const totalCostInput = document.getElementById('purchase-total-cost');
        const calculateTotal = () => {
            const quantity = parseFloat(quantityInput.value) || 0;
            const unitCost = parseFloat(unitCostInput.value) || 0;
            if (quantity > 0 && unitCost > 0) totalCostInput.value = (quantity * unitCost).toFixed(2);
        };
        const calculateUnit = () => {
            const quantity = parseFloat(quantityInput.value) || 0;
            const totalCost = parseFloat(totalCostInput.value) || 0;
            if (quantity > 0 && totalCost > 0) unitCostInput.value = (totalCost / quantity).toFixed(2);
        };
        quantityInput.addEventListener('input', calculateTotal);
        unitCostInput.addEventListener('input', calculateTotal);
        totalCostInput.addEventListener('input', calculateUnit);
    }

    async function handleSavePurchase() {
        const productId = document.getElementById('purchase-product').value;
        const quantity = parseInt(document.getElementById('purchase-quantity').value);
        const unitCost = parseFloat(document.getElementById('purchase-unit-cost').value);
        const totalCost = parseFloat(document.getElementById('purchase-total-cost').value);
        const supplier = document.getElementById('purchase-supplier').value.trim();
        const dateTime = document.getElementById('purchase-date').value;
        const expiryDate = document.getElementById('purchase-expiry-date').value;
        const newSellingPrice = document.getElementById('purchase-new-price').value;

        if (!productId || !quantity || (!unitCost && !totalCost) || !dateTime) { 
            alert(getTranslation('alert_fill_all_fields')); 
            return; 
        }
        if (state.appMode === 'bakery' && !expiryDate) {
            alert(getTranslation('alert_fill_all_fields'));
            return;
        }
        try {
            const finalUnitCost = unitCost || totalCost / quantity;
            const finalTotalCost = totalCost || unitCost * quantity;
            const product = await db.get('products', productId);
            const purchase = {
                id: `pch-${Date.now()}`,
                productId,
                productName: product.name,
                supplier,
                quantity,
                unitCost: finalUnitCost,
                totalCost: finalTotalCost,
                dateTime,
                ...(state.appMode === 'bakery' && { expiryDate: expiryDate })
            };
            await db.add('purchases', purchase);
            
            const stockItem = await db.get('stock', productId);
            stockItem.quantity += quantity;
            await db.put('stock', stockItem);

            if (newSellingPrice !== '') {
                const parsedNewPrice = parseFloat(newSellingPrice);
                if (!isNaN(parsedNewPrice) && parsedNewPrice >= 0) {
                    product.price = parsedNewPrice;
                    await db.put('products', product);
                }
            }

            await Promise.all([renderPurchasesPage(), renderStockPage(), renderProductsPage()]);
            if (state.appMode === 'bakery' && state.currentSection === 'expiring-soon') await renderExpiringSoonPage();
            await syncBroadcastSnapshotIfServer();
            closeModal('purchase-modal');
        } catch (error) {
            console.error('Error saving purchase:', error);
        }
    }

    async function handleSaveSettings() {
        const newTaxRate = parseFloat(document.getElementById('tax-rate-setting').value);
        const newReceiptTitle = document.getElementById('receipt-title-setting').value.trim();
        const newTheme = document.getElementById('theme-select').value;
        const newPrinterType = document.getElementById('printer-type-select').value;
        const newSyncRole = document.getElementById('sync-role-select').value;
        const newGdriveClientId = document.getElementById('gdrive-client-id').value.trim();

        if (isNaN(newTaxRate) || newTaxRate < 0) {
            alert(getTranslation('alert_invalid_tax_rate'));
            return;
        }
        if (!newReceiptTitle) {
            alert(getTranslation('alert_empty_receipt_title'));
            return;
        }
        try {
            await Promise.all([
                db.put('settings', { key: 'taxRate', value: newTaxRate }),
                db.put('settings', { key: 'receiptTitle', value: newReceiptTitle }),
                db.put('settings', { key: 'theme', value: newTheme }),
                db.put('settings', { key: 'printerType', value: newPrinterType }),
                db.put('settings', { key: 'syncRole', value: newSyncRole }),
                db.put('settings', { key: 'gdriveClientId', value: newGdriveClientId })
            ]);
            state.taxRate = newTaxRate;
            state.printerType = newPrinterType;
            state.syncRole = newSyncRole;
            await applyTheme();
            alert(getTranslation('alert_settings_saved'));
        } catch (error) {
            console.error("Error saving settings:", error);
        }
    }

    async function showReceiptModal(order) {
        state.lastCompletedOrder = order;
        const receiptTitleSetting = await db.get('settings', 'receiptTitle');
        const receiptTitle = receiptTitleSetting?.value || 'Free Free POS!';
        const receiptContent = document.getElementById('receipt-content');
        receiptContent.innerHTML = `
            <h4>${receiptTitle}</h4>
            <p>${getTranslation('receipt_sale_id')}: ${order.id.slice(-8)}</p>
            <p>${getTranslation('receipt_date')}: ${new Date().toLocaleString()}</p>
            <p>${getTranslation('label_payment_method')}: ${order.paymentMethod || 'Cash'}</p>
            <div class="receipt-divider"></div>
            <table>
                <thead>
                    <tr><th>${getTranslation('table_item')}</th><th>${getTranslation('table_qty')}</th><th class="text-right">${getTranslation('table_total')}</th></tr>
                </thead>
                <tbody>
                    ${order.items.map(i => `<tr><td>${i.name}</td><td>${i.quantity}</td><td class="text-right">${formatCurrency(i.quantity * i.price)}</td></tr>`).join('')}
                </tbody>
            </table>
            <div class="receipt-divider"></div>
            <div class="total-section">
                <p style="display:flex; justify-content:space-between;"><span>${getTranslation('label_subtotal')}:</span> <span>${formatCurrency(order.subtotal)}</span></p>
                <p style="display:flex; justify-content:space-between;"><span>${getTranslation('label_discount')}:</span> <span>-${formatCurrency(order.discount)}</span></p>
                <p style="display:flex; justify-content:space-between;"><span>${getTranslation('label_tax_rate_value', { rate: state.taxRate })}:</span> <span>${formatCurrency(order.tax)}</span></p>
                <div class="receipt-divider"></div>
                <h4 style="display:flex; justify-content:space-between;"><span>${getTranslation('label_total')}:</span> <span>${formatCurrency(order.total)}</span></h4>
            </div>
            <p class="footer-text">${getTranslation('receipt_thank_you')}</p>
        `;
        openModal('receipt-modal');
    }

    async function handleShareReceipt() { await captureAndDownload(true); }
    async function handleSaveReceiptImage() { await captureAndDownload(false); }

    async function captureAndDownload(shareMode = false) {
        const receiptElement = document.getElementById('receipt-content');
        const shareBtn = document.getElementById('share-receipt-btn');
        const saveBtn = document.getElementById('save-receipt-img-btn');
        const activeBtn = shareMode ? shareBtn : saveBtn;

        activeBtn.disabled = true;
        const originalText = activeBtn.innerHTML;
        activeBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing...`;

        try {
            const canvas = await html2canvas(receiptElement, {
                backgroundColor: document.body.classList.contains('dark-mode') ? '#242526' : '#FFFFFF'
            });
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const file = new File([blob], `receipt-${Date.now()}.png`, { type: 'image/png' });

            if (shareMode && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: getTranslation('receipt_share_title'),
                    text: getTranslation('receipt_share_text')
                });
            } else {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(file);
                link.download = file.name;
                link.click();
            }
        } catch (err) {
            console.error('Operation failed:', err);
        } finally {
            activeBtn.disabled = false;
            activeBtn.innerHTML = originalText;
        }
    }

    function viewFullImage(src) {
        if (!src) return;
        document.getElementById('full-size-image').src = src;
        openModal('image-viewer-modal');
    }

    function openDeleteModal(id, type, fromModal = false) {
        itemToDelete = { id, type, fromModal };
        const typeName = getTranslation(`entity_${type}`);
        showConfirmation({
            title: getTranslation('confirm_delete_item_title'),
            message: getTranslation('confirm_delete_item_msg', { type: typeName }),
            okText: 'btn_delete',
            onConfirm: handleDelete
        });
    }

    async function handleDelete() {
        if (!itemToDelete) return;
        const { id, type, fromModal } = itemToDelete;
        try {
            if (type === 'product') {
                await db.delete('products', id);
                await db.delete('stock', id);
                const purchases = await db.getAll('purchases', 'productId', IDBKeyRange.only(id));
                for(const p of purchases) await db.delete('purchases', p.id);
                await renderProductsPage();
                await renderStockPage();
                await renderPurchasesPage();
                await syncBroadcastSnapshotIfServer();
            } else if (type === 'category') {
                const productCount = await db.count('products', 'categoryId', IDBKeyRange.only(id));
                if (productCount > 0) {
                    alert(getTranslation('alert_cannot_delete_category', { count: productCount }));
                    closeModal('confirm-modal');
                    return;
                }
                await db.delete('categories', id);
                await renderCategoriesPage();
                await populateFilterDropdowns();
                await syncBroadcastSnapshotIfServer();
            } else if (type === 'purchase') {
                const purchase = await db.get('purchases', id);
                const stockItem = await db.get('stock', purchase.productId);
                if (stockItem) {
                    stockItem.quantity = Math.max(0, stockItem.quantity - purchase.quantity);
                    await db.put('stock', stockItem);
                }
                await db.delete('purchases', id);
                await Promise.all([renderPurchasesPage(), renderStockPage()]);
                await syncBroadcastSnapshotIfServer();
            } else if (type === 'sale') {
                await db.delete('orders', id);
                await renderSaleHistoryPage();
                await syncBroadcastSnapshotIfServer();
            }
            closeModal('confirm-modal');
            if (fromModal) closeModal(`${type}-modal`);
        } catch (error) {
            console.error("Deletion failed:", error);
            alert(getTranslation('alert_delete_fail'));
        } finally {
            itemToDelete = null;
        }
    }

    function deleteByCursorRange(storeName, indexName, range) {
        return new Promise((resolve, reject) => {
            const tx = dbInstance.transaction(storeName, 'readwrite');
            const index = tx.objectStore(storeName).index(indexName);
            const req = index.openCursor(range);
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async function handleDeleteDataByMonth() {
        const month = document.getElementById('delete-data-month').value;
        const year = parseInt(document.getElementById('delete-data-year').value, 10);
        const monthName = getTranslation('month_names')[month - 1];
        if (!month || isNaN(year) || year < 1) {
            alert(getTranslation('alert_fill_all_fields'));
            return;
        }

        showConfirmation({
            title: getTranslation('label_delete_by_month'),
            message: getTranslation('confirm_delete_data_for_month_msg', { monthName, year }),
            async onConfirm() {
                try {
                    const monthPadded = month.toString().padStart(2, '0');
                    const yearPadded = year.toString().padStart(4, '0');
                    const startDate = `${yearPadded}-${monthPadded}-01`;
                    const lastDayOfMonth = new Date(year, month, 0).getDate();
                    const endDate = `${yearPadded}-${monthPadded}-${lastDayOfMonth}`;
                    await deleteByCursorRange('orders', 'date', IDBKeyRange.bound(startDate, endDate));
                    await deleteByCursorRange('purchases', 'dateTime', IDBKeyRange.bound(`${startDate}T00:00`, `${endDate}T23:59:59`));
                    alert(getTranslation('alert_data_deleted_for_month', { monthName, year }));
                    closeModal('confirm-modal');
                } catch (error) {
                    console.error('Error deleting data by month:', error);
                    closeModal('confirm-modal');
                }
            }
        });
    }

    function handleResetAllData() {
        const confirmWord = getTranslation('prompt_reset_confirm_word');
        showConfirmation({
            title: getTranslation('confirm_reset_all_data_title'),
            message: getTranslation('prompt_reset_all_data_msg'),
            requiresInput: true,
            inputPlaceholder: getTranslation('prompt_reset_confirm_word'),
            async onConfirm(inputValue) {
                if (inputValue !== confirmWord) {
                    alert(getTranslation('alert_reset_cancelled'));
                    closeModal('confirm-modal');
                    return;
                }
                try {
                    const storeNames = ['products', 'categories', 'stock', 'purchases', 'orders', 'hh_transactions', 'hr_employees', 'hr_attendance', 'hr_payroll', 'todos'];
                    const tx = dbInstance.transaction(storeNames, 'readwrite');
                    for (const storeName of storeNames) tx.objectStore(storeName).clear();
                    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = event => reject(event.target.error); });
                    alert(getTranslation('alert_all_data_reset'));
                    await initSampleData();
                    await populateFilterDropdowns();
                    navigateTo('home');
                } catch (error) {
                    console.error('Failed to reset data:', error);
                } finally {
                    closeModal('confirm-modal');
                }
            }
        });
    }

    async function generateDailyReport() {
        const date = document.getElementById('report-date').value;
        if (!date) return;
        try {
            const range = IDBKeyRange.only(date);
            const orders = (await db.getAll('orders', 'date', range)).filter(o => o.status === 'completed');
            const purchases = (await db.getAll('purchases')).filter(p => p.dateTime.startsWith(date));
            const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
            const totalCost = purchases.reduce((sum, p) => sum + p.totalCost, 0);
            const netProfit = totalRevenue - totalCost;
            const cashSales = orders.filter(o => !o.paymentMethod || o.paymentMethod === 'Cash').reduce((sum, o) => sum + o.total, 0);
            const kbzSales = orders.filter(o => o.paymentMethod === 'KBZ Pay').reduce((sum, o) => sum + o.total, 0);

            const reportTitle = `${getTranslation('title_daily_report')} - ${date}`;
            const summaryData = [
                { label: getTranslation('stat_total_revenue'), value: totalRevenue },
                { label: getTranslation('stat_total_cost'), value: totalCost },
                { label: getTranslation('stat_net_profit'), value: netProfit },
                { label: getTranslation('stat_cash_sales'), value: cashSales },
                { label: getTranslation('stat_kbz_sales'), value: kbzSales }
            ];
            let reportHtml = `<h4>${reportTitle}</h4>
                <div class="akmstats-grid">
                    ${summaryData.map(item => `<div class="akmstat-card"><span class="akmstat-title">${item.label}</span><span class="akmstat-value">${formatCurrency(item.value)}</span></div>`).join('')}
                </div>`;
            document.getElementById('report-content').innerHTML = reportHtml;
            document.getElementById('report-date-title').textContent = date;
            openModal('report-modal');
        } catch(e) {
            console.error("Report generation failed:", e);
        }
    }

    async function generateMonthlyReport() {
        const month = document.getElementById('report-month').value;
        const year = parseInt(document.getElementById('report-year').value, 10);
        if (!month || isNaN(year) || year < 1) {
            alert(getTranslation('alert_fill_all_fields'));
            return;
        }
        try {
            const monthPadded = month.toString().padStart(2, '0');
            const yearPadded = year.toString().padStart(4, '0');
            const startDate = `${yearPadded}-${monthPadded}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endDate = `${yearPadded}-${monthPadded}-${lastDay}`;
            const monthNames = getTranslation('month_names');
            const monthName = monthNames[month - 1];
            const reportTitleText = `${monthName} ${year}`;
            
            const orderRange = IDBKeyRange.bound(startDate, endDate);
            const orders = (await db.getAll('orders', 'date', orderRange)).filter(o => o.status === 'completed');
            
            const purchaseStartDate = `${startDate}T00:00`;
            const purchaseEndDate = `${endDate}T23:59:59`;
            const purchaseRange = IDBKeyRange.bound(purchaseStartDate, purchaseEndDate);
            const purchases = await db.getAll('purchases', 'dateTime', purchaseRange);
            
            const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
            const totalCost = purchases.reduce((sum, p) => sum + p.totalCost, 0);
            const netProfit = totalRevenue - totalCost;
            const cashSales = orders.filter(o => !o.paymentMethod || o.paymentMethod === 'Cash').reduce((sum, o) => sum + o.total, 0);
            const kbzSales = orders.filter(o => o.paymentMethod === 'KBZ Pay').reduce((sum, o) => sum + o.total, 0);

            const reportTitle = `${getTranslation('title_monthly_report')} - ${reportTitleText}`;
            const summaryData = [
                { label: getTranslation('stat_total_revenue'), value: totalRevenue },
                { label: getTranslation('stat_total_cost'), value: totalCost },
                { label: getTranslation('stat_net_profit'), value: netProfit },
                { label: getTranslation('stat_cash_sales'), value: cashSales },
                { label: getTranslation('stat_kbz_sales'), value: kbzSales }
            ];
            let reportHtml = `<h4>${reportTitle}</h4>
                <div class="akmstats-grid">
                    ${summaryData.map(item => `<div class="akmstat-card"><span class="akmstat-title">${item.label}</span><span class="akmstat-value">${formatCurrency(item.value)}</span></div>`).join('')}
                </div>`;
            document.getElementById('report-content').innerHTML = reportHtml;
            document.getElementById('report-date-title').textContent = reportTitleText;
            openModal('report-modal');
        } catch(e) {
            console.error("Monthly report generation failed:", e);
        }
    }

    async function exportToPDF(elementSelector, filename) {
        const { jsPDF } = window.jspdf;
        const content = document.querySelector(elementSelector);
        if (!content) return;
        try {
            const canvas = await html2canvas(content, { scale: 2, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'p',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });
            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(filename);
        } catch (error) {
            console.error("PDF Export Error:", error);
        }
    }

    function handleExportPurchasesPDF() {
        exportToPDF('#purchases-section .akmcard', `purchases-report-${Date.now()}.pdf`);
    }
    function handleExportSalesPDF() {
        exportToPDF('#sale-history-section .akmcard', `sales-history-${Date.now()}.pdf`);
    }
    function handleExportPurchasesCSV() {
        let csvContent = "data:text/csv;charset=utf-8,";
        const isBakery = state.appMode === 'bakery';
        csvContent += `Product Name,Supplier,Quantity,Unit Cost,Total Cost,Date${isBakery ? ',Expiry Date' : ''}\n`;
        state.filteredPurchases.forEach(p => {
            csvContent += `"${p.productName}","${p.supplier || ''}",${p.quantity},${p.unitCost},${p.totalCost},"${new Date(p.dateTime).toLocaleString()}"${isBakery ? ',' + (p.expiryDate || '') : ''}\n`;
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `purchases-report-${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function handleExportSalesCSV() {
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Sale ID,Date,Item Count,Payment Method,Subtotal,Discount,Tax,Grand Total\n";
        state.filteredSales.forEach(s => {
            csvContent += `#${s.id.slice(-8)},${s.date},${s.items.length},${s.paymentMethod || 'Cash'},${s.subtotal},${s.discount || 0},${s.tax},${s.total}\n`;
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `sales-history-${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    const SUPABASE_URL = 'https://xjgjpfvxamlwkxsexjeo.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_J0flir1jm-bHzWpLTc7dZA_gSsw4rNP';

    async function trackVisitToSupabase() {
        let activePingStarted = false;
        function startActiveUserHeartbeat() {
            if (activePingStarted) return;
            activePingStarted = true;

            setInterval(async () => {
                if (!navigator.onLine || document.hidden || typeof window.supabase === 'undefined') return;
                if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT_ID') || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') return;

                try {
                    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                        auth: { persistSession: false }
                    });
                    await sb.rpc('ping_pos_active', { p_device_id: DEVICE_ID });
                } catch (err) {
                }
            }, 120000);
        }

        if (!navigator.onLine || typeof window.supabase === 'undefined') return;
        if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT_ID') || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') return;

        try {
            const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: { persistSession: false }
            });
            await sb.rpc('track_pos_visit', {
                p_device_id: DEVICE_ID,
                p_version: '4.9',
                p_lang: state.currentLanguage,
                p_mode: state.appMode
            });
            startActiveUserHeartbeat();
        } catch (err) {
            console.debug('Supabase visit tracking skipped:', err.message);
        }
    }
    
    async function init() {
        try {
            await openDatabase();
            await initSampleData();
            populateYearDatalist();
            
            const [tax, language, appMode, printerType, syncRole] = await Promise.all([
                db.get('settings', 'taxRate'),
                db.get('settings', 'language'),
                db.get('settings', 'appMode'),
                db.get('settings', 'printerType'),
                db.get('settings', 'syncRole')
            ]);
            state.currentLanguage = language ? language.value : 'mm';
            state.printerType = printerType ? printerType.value : 'bluetooth';
            state.syncRole = syncRole ? syncRole.value : 'standalone';

            await applyTheme();
            await setLanguage(state.currentLanguage);
            applyAppMode(appMode ? appMode.value : 'retail');
            state.taxRate = tax ? tax.value : 0;
            
            setupEventListeners();
            navigateTo('home');
            openModal('data-notice-modal');
            trackVisitToSupabase();
            checkTodoReminders();
            setInterval(() => {
                checkTodoReminders();
                if (state.currentSection === 'todo') renderTodoPage();
            }, 60000);
            
            console.log('Free Free POS! App v4.9 Initialized');
        } catch (error) {
            console.error('Initialization error:', error);
            alert('Failed to initialize application. Please refresh the page.');
        }
    }
    
    init();
});
