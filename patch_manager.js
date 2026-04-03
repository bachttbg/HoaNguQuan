// ============================================================
//  PATCH CHO manager.html
//  Thay các hàm đọc/ghi localStorage bằng API calls thật
//
//  CÁCH ÁP DỤNG:
//  1. Thêm <script src="api-client.js"></script> cuối <body>
//  2. Thay các hàm được đánh dấu bên dưới
// ============================================================


// ── Thay hàm doLogin() ──
async function doLogin() {
    const u   = document.getElementById('loginUsername').value.trim().toLowerCase();
    const p   = document.getElementById('loginPassword').value;
    const err = document.getElementById('loginError');

    try {
        const staff = await loginWithDB(u, p);

        err.style.display = 'none';
        currentManager = { username: u, ...staff };

        document.getElementById('managerName').textContent   = staff.fullName;
        document.getElementById('managerRole').textContent   = staff.role;
        document.getElementById('managerAvatar').textContent = staff.avatar;
        document.getElementById('loginPage').style.display   = 'none';
        document.getElementById('dashboard').style.display   = 'block';

        loadAll();
        startClock();
        setInterval(loadAll, 15000);   // refresh mỗi 15 giây

    } catch (e) {
        err.style.display = 'block';
        err.textContent   = 'Sai tên đăng nhập hoặc mật khẩu!';
        document.getElementById('loginPassword').value = '';
    }
}


// ── Thay hàm loadAll() ──
async function loadAll() {
    await Promise.all([
        loadStats(),
        loadOrders(),
        loadReservationsList(),
        loadHistory(),
    ]);
    loadOverview();
    updatePendingBadge();
}


// ── Thay hàm loadStats() ──
async function loadStats() {
    try {
        const s = await fetchStatsFromDB();
        document.getElementById('statTotal').textContent   = s.totalOrders;
        document.getElementById('statPending').textContent = s.pendingOrders;
        document.getElementById('statDone').textContent    = s.completedOrders;

        // Hiển thị TỔNG doanh thu (totalRevenue), fallback sang todayRevenue nếu không có
        const revenue = parseFloat(s.totalRevenue || s.todayRevenue || 0);
        document.getElementById('statRevenue').textContent =
            revenue.toLocaleString('vi-VN') + ' ₫';
    } catch (e) {
        console.error('loadStats error:', e.message);
    }
}


// ── Thay hàm loadOrders() ──
let _cachedOrders = [];   // cache để loadOverview dùng lại

async function loadOrders() {
    try {
        const orders = await fetchOrdersFromDB();

        // Chuyển trạng thái DB → trạng thái hiển thị manager
        const mapped = orders.map(o => ({
            ...o,
            status: STATUS_REVERSE[o.status] || o.status,
        }));

        _cachedOrders = mapped;

        const filtered = currentFilter === 'all'
            ? mapped
            : mapped.filter(o => o.status === currentFilter);

        const list = document.getElementById('ordersList');
        list.innerHTML = filtered.length === 0
            ? `<div class="empty-state"><div class="icon">📭</div><p>Không có đơn nào</p></div>`
            : filtered.map(renderCard).join('');

    } catch (e) {
        console.error('loadOrders error:', e.message);
    }
}


// ── Thay hàm updateOrder() ──
async function updateOrder(id, uiStatus) {
    try {
        // Lấy DB OrderID từ id dạng "HNQ-000001" hoặc số nguyên
        const dbId = typeof id === 'string' && id.startsWith('HNQ-')
            ? parseInt(id.replace('HNQ-', ''), 10)
            : parseInt(id, 10);

        // Map trạng thái UI → DB
        const dbStatus = STATUS_MAP[uiStatus] || uiStatus;

        await updateOrderStatusDB(dbId, dbStatus);

        const msgs = {
            confirmed: '✓ Đã xác nhận đơn hàng!',
            preparing: '👨‍🍳 Bắt đầu chuẩn bị!',
            done:      '🎉 Đơn hàng hoàn thành!',
            cancelled: '✕ Đã huỷ đơn hàng',
        };
        showToast(msgs[uiStatus] || 'Đã cập nhật',
                  uiStatus === 'cancelled' ? 'warning' : 'success');

        await loadAll();
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message, 'warning');
    }
}


// ── Thay hàm loadReservationsList() ──
async function loadReservationsList() {
    try {
        const res = await fetchReservationsFromDB();
        document.getElementById('reservationsList').innerHTML =
            res.length === 0
                ? `<div class="empty-state"><div class="icon">🪑</div><p>Chưa có đặt bàn</p></div>`
                : res.map(r => `
                    <div class="order-card ${r.status}" style="grid-template-columns:60px 1fr auto auto">
                        <div><div class="order-num">#${r.id}</div><div class="order-num-label">Bàn</div></div>
                        <div class="order-info">
                            <h4>${r.user} ${r.phone ? '· 📞 ' + r.phone : ''}</h4>
                            <p>📅 ${r.date} · 👥 ${r.guests} khách</p>
                            ${r.note ? `<p style="font-size:0.75rem;color:var(--text-dim)">📝 ${r.note}</p>` : ''}
                            <div style="margin-top:5px">
                                <span class="status-badge ${r.status}">
                                    ${STATUS_LABEL[r.status] || r.status}
                                </span>
                            </div>
                        </div>
                        <div></div>
                        <div class="order-actions">
                            ${r.status === 'pending'
                                ? `<button class="action-btn btn-confirm" onclick="updateRes(${r.id},'confirmed')">✓ Xác nhận</button>
                                   <button class="action-btn btn-cancel"  onclick="updateRes(${r.id},'cancelled')">✕ Huỷ</button>`
                                : r.status === 'confirmed'
                                ? `<span style="color:var(--green);font-size:0.8rem">✓ Đã xác nhận</span>`
                                : `<span style="color:var(--red);font-size:0.8rem">✕ Đã huỷ</span>`
                            }
                        </div>
                    </div>`).join('');
    } catch (e) {
        console.error('loadReservationsList error:', e.message);
    }
}


// ── Thay hàm updateRes() ──
async function updateRes(id, status) {
    try {
        await updateReservationStatusDB(id, status);
        showToast(
            status === 'confirmed' ? '✓ Đã xác nhận đặt bàn!' : '✕ Đã huỷ đặt bàn',
            status === 'confirmed' ? 'success' : 'warning'
        );
        await loadAll();
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message, 'warning');
    }
}


// ── Thay hàm loadHistory() ──
async function loadHistory() {
    try {
        const all  = await fetchOrdersFromDB();
        const done = all
            .filter(o => o.status === 'completed' || o.status === 'cancelled')
            .map(o => ({ ...o, status: STATUS_REVERSE[o.status] || o.status }));

        document.getElementById('historyList').innerHTML =
            done.length === 0
                ? `<div class="empty-state"><div class="icon">📜</div><p>Chưa có lịch sử</p></div>`
                : done.map(renderCard).join('');
    } catch (e) {
        console.error('loadHistory error:', e.message);
    }
}


// ── Thay hàm loadOverview() ──
function loadOverview() {
    const recent = _cachedOrders.slice(0, 4);
    document.getElementById('overviewOrdersList').innerHTML =
        recent.length === 0
            ? `<div class="empty-state"><div class="icon">📭</div><p>Chưa có đơn hàng</p></div>`
            : recent.map(renderCard).join('');
}


// ── Thay hàm updatePendingBadge() ──
function updatePendingBadge() {
    const n = _cachedOrders.filter(o => o.status === 'pending').length;
    const badge = document.getElementById('pendingBadge');
    badge.textContent    = n;
    badge.style.display  = n > 0 ? 'inline' : 'none';
    const bb = document.getElementById('bnavBadge');
    if (bb) { bb.textContent = n; bb.style.display = n > 0 ? 'inline' : 'none'; }
    if (n > lastPendingCount) {
        document.getElementById('newOrderBadge').style.display = 'block';
        setTimeout(() => document.getElementById('newOrderBadge').style.display = 'none', 5000);
    }
    lastPendingCount = n;
}