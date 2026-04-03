// ============================================================
//  PATCH CHO order.html
//  Thay hàm finalizeOrder() bằng phiên bản gọi API thật
//  
//  CÁCH ÁP DỤNG:
//  Mở order.html, tìm hàm finalizeOrder() và thay toàn bộ
//  bằng code bên dưới. Đồng thời thêm 2 dòng script ở cuối.
// ============================================================

// ── BƯỚC 1: Thêm vào cuối <body> của order.html ──
// <script src="api-client.js"></script>

// ── BƯỚC 2: Thay hàm finalizeOrder() bằng code sau ──

async function finalizeOrder() {
    const btn = document.getElementById('placeOrderBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Đang gửi đơn...';

    try {
        const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
        const fee      = orderType === 'takeout' ? DELIVERY_FEE : 0;

        // Chuẩn bị payload cho API
        const orderPayload = {
            customerName:    document.getElementById('customerName').value.trim(),
            customerPhone:   orderType === 'takeout'
                                ? document.getElementById('deliveryTel').value.trim()
                                : '',
            orderType,
            paymentMethod:   payment,
            tableLocation:   orderType === 'dinein'
                                ? document.getElementById('tableSelect').value
                                : null,
            guestCount:      orderType === 'dinein'
                                ? document.getElementById('guestCount').value
                                : null,
            deliveryAddress: orderType === 'takeout'
                                ? document.getElementById('deliveryAddr').value.trim()
                                : null,
            deliveryPhone:   orderType === 'takeout'
                                ? document.getElementById('deliveryTel').value.trim()
                                : null,
            note: document.getElementById('orderNote').value,

            // Map cart items sang format API
            items: cart.map(i => ({
                legacyId: i.id,         // id gốc từ menuData / drinksData
                name:     i.name,
                qty:      i.qty,
                price:    i.price,
                note:     i.note || ''
            }))
        };

        // Gửi lên server → SQL Server
        const result = await submitOrderToDB(orderPayload);

        // Xoá giỏ hàng
        cart = [];
        localStorage.removeItem('hnq_cart');
        updateCartBadgeGlobal();

        // Hiển thị màn hình thành công
        document.getElementById('orderLayout').style.display = 'none';
        document.getElementById('orderIdBox').textContent = 'MÃ ĐƠN: #' + result.orderId;
        document.getElementById('successScreen').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (e) {
        alert('❌ Không thể đặt hàng: ' + e.message + '\nVui lòng thử lại.');
        btn.disabled = false;
        btn.textContent = '✓  Xác Nhận Đặt Hàng';
    }
}