// ============================================================
//  api-client.js  —  Hoả Ngư Quán
//  Nhúng file này vào TẤT CẢ các trang HTML (trước </body>)
//  Nó ghi đè các hàm localStorage để dùng API thật
// ============================================================

const API = 'http://localhost:3000/api';

// ── Helper gọi API ──
async function apiFetch(path, options = {}) {
    try {
        const res  = await fetch(API + path, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Lỗi server');
        return data.data;
    } catch (e) {
        console.error('API Error:', e.message);
        throw e;
    }
}

// ============================================================
//  MENU — tải thực đơn từ database thay vì hardcode trong JS
// ============================================================
async function loadMenuFromDB() {
    try {
        const data = await apiFetch('/menu');
        // Gán vào biến menuData toàn cục (dùng trong menu.html)
        if (typeof menuData !== 'undefined') {
            Object.assign(menuData, data);
        }
        return data;
    } catch (e) {
        console.warn('Không tải được thực đơn từ DB, dùng dữ liệu tĩnh.');
    }
}

async function loadDrinksFromDB() {
    try {
        const data = await apiFetch('/drinks');
        if (typeof drinksData !== 'undefined') {
            Object.assign(drinksData, data);
        }
        return data;
    } catch (e) {
        console.warn('Không tải được đồ uống từ DB, dùng dữ liệu tĩnh.');
    }
}

// ============================================================
//  CART — vẫn dùng localStorage nhưng gắn legacyId đúng
// ============================================================
function getCart() {
    try { return JSON.parse(localStorage.getItem('hnq_cart') || '[]'); }
    catch(e) { return []; }
}
function saveCartLocal(cart) {
    localStorage.setItem('hnq_cart', JSON.stringify(cart));
}

// ============================================================
//  ORDER — gửi đơn hàng lên database
// ============================================================
async function submitOrderToDB(orderData) {
    /*  orderData shape (từ order.html finalizeOrder):
        {
            customerName, customerPhone,
            orderType,    paymentMethod,
            tableLocation, guestCount,
            deliveryAddress, deliveryPhone,
            note,
            items: [{ legacyId, name, qty, price, note }]
        }
    */
    const result = await apiFetch('/orders', {
        method: 'POST',
        body:   JSON.stringify(orderData),
    });
    return result;   // { orderId: 'HNQ-000001', totalAmount: ... }
}

// ============================================================
//  RESERVATIONS — gửi đặt bàn lên database
// ============================================================
async function submitReservationToDB(resData) {
    return apiFetch('/reservations', {
        method: 'POST',
        body:   JSON.stringify(resData),
    });
}

// ============================================================
//  MANAGER — lấy đơn hàng & đặt bàn từ database
// ============================================================
async function fetchOrdersFromDB(status = 'all') {
    return apiFetch(`/orders?status=${status}&limit=200`);
}

async function fetchReservationsFromDB() {
    return apiFetch('/reservations');
}

async function updateOrderStatusDB(dbOrderId, newStatus) {
    return apiFetch(`/orders/${dbOrderId}/status`, {
        method: 'PATCH',
        body:   JSON.stringify({ status: newStatus }),
    });
}

async function updateReservationStatusDB(id, newStatus) {
    return apiFetch(`/reservations/${id}/status`, {
        method: 'PATCH',
        body:   JSON.stringify({ status: newStatus }),
    });
}

async function fetchStatsFromDB() {
    return apiFetch('/stats');
}

async function loginWithDB(username, password) {
    return apiFetch('/login', {
        method: 'POST',
        body:   JSON.stringify({ username, password }),
    });
}

// ============================================================
//  MAP trạng thái manager.html → SQL Server
// ============================================================
const STATUS_MAP = {
    // manager.html  →  SQL Server
    'confirmed':  'confirmed',
    'preparing':  'preparing',
    'done':       'completed',
    'cancelled':  'cancelled',
};
const STATUS_REVERSE = {
    'confirmed':  'confirmed',
    'preparing':  'preparing',
    'completed':  'done',
    'cancelled':  'cancelled',
    'pending':    'pending',
};

console.log('%c[HNQ API Client] ✓ Loaded', 'color:#e8b84b;font-weight:bold');