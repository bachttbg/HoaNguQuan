const express = require('express');
const sql     = require('mssql');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ============================================================
//  KET NOI SQL SERVER
// ============================================================
const dbConfig = {
    server:   'NHUNG-IN',
    database: 'HoaNguQuan',
    user:     'sa',
    password: '24092007',
    port:     1433,
    options: {
        encrypt:                false,
        trustServerCertificate: true,
        enableArithAbort:       true,
    },
    pool: { max:10, min:0, idleTimeoutMillis:30000 }
};

let pool;
async function getPool() {
    if (!pool) {
        console.log('Dang ket noi SQL Server...');
        pool = await sql.connect(dbConfig);
        console.log('Ket noi SQL Server THANH CONG!');
    }
    return pool;
}

function ok(res, data)           { res.json({ success:true, data }); }
function err(res, msg, code=500) { res.status(code).json({ success:false, message:msg }); }

// "19:00" / "9:00" / "19:00:00" → luôn trả về "HH:MM:SS" hợp lệ
function normalizeTime(t) {
    if (!t) return '00:00:00';
    t = String(t).trim();

    // Đã đúng format HH:MM:SS
    if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;

    // Format H:MM hoặc HH:MM
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return m[1].padStart(2, '0') + ':' + m[2] + ':00';

    // Edge case "900" hoặc "1900" không có dấu ":"
    if (/^\d{3,4}$/.test(t)) {
        const s = t.padStart(4, '0');
        return s.slice(0,2) + ':' + s.slice(2) + ':00';
    }

    return '00:00:00'; // fallback an toàn
}

// Map zalopay/bank → transfer (tránh vi phạm CHECK constraint)
function normalizePayment(p) {
    const allowed = ['cash','visa','atm','momo','transfer'];
    const v = (p || 'cash').toLowerCase();
    return allowed.includes(v) ? v : 'transfer';
}

// ============================================================
//  MENU
// ============================================================
app.get('/api/menu', async (req, res) => {
    try {
        const db = await getPool();
        const result = await db.request().query(`
            SELECT mi.LegacyID AS id, mc.CategoryKey, mc.CategoryName, mc.ItemType,
                    mi.ItemName AS name, mi.Description AS desc, mi.Price AS price,
                    mi.Unit AS unit, mi.Badge AS badge, mi.IsFeatured AS featured,
                    mi.ImageURL AS img, mi.IsAvailable AS available
            FROM dbo.MenuItems mi
            JOIN dbo.MenuCategories mc ON mc.CategoryID = mi.CategoryID
            WHERE mi.IsAvailable = 1 AND mc.ItemType = 'food'
            ORDER BY mc.SortOrder, mi.LegacyID`);
        const grouped = {};
        result.recordset.forEach(row => {
            if (!grouped[row.CategoryKey]) grouped[row.CategoryKey] = [];
            grouped[row.CategoryKey].push({
                id:row.id, name:row.name, desc:row.desc,
                price:Number(row.price), unit:row.unit,
                badge:row.badge, featured:!!row.featured,
                img:row.img || '/api/placeholder/300/210',
            });
        });
        ok(res, grouped);
    } catch(e) { console.error(e.message); err(res, e.message); }
});

// ============================================================
//  DRINKS
// ============================================================
app.get('/api/drinks', async (req, res) => {
    try {
        const db = await getPool();
        const result = await db.request().query(`
            SELECT mi.LegacyID AS id, mc.CategoryKey,
                    mi.ItemName AS name, mi.Description AS desc,
                    mi.Price AS price, mi.Unit AS unit,
                    mi.Badge AS badge, mi.ImageURL AS img
            FROM dbo.MenuItems mi
            JOIN dbo.MenuCategories mc ON mc.CategoryID = mi.CategoryID
            WHERE mc.ItemType = 'drink' AND mi.IsAvailable = 1
            ORDER BY mc.SortOrder, mi.LegacyID`);
        const grouped = {};
        result.recordset.forEach(row => {
            if (!grouped[row.CategoryKey]) grouped[row.CategoryKey] = [];
            grouped[row.CategoryKey].push({
                id:row.id, name:row.name, desc:row.desc,
                price:Number(row.price), unit:row.unit,
                badge:row.badge, img:row.img || '/api/placeholder/240/180',
            });
        });
        ok(res, grouped);
    } catch(e) { console.error(e.message); err(res, e.message); }
});

// ============================================================
//  TABLES
// ============================================================
app.get('/api/tables', async (req, res) => {
    try {
        const db   = await getPool();
        const req2 = db.request();
        let query  = `SELECT TableID AS id, TableName AS name,
                            Location AS location, Capacity AS capacity, Status AS status
                        FROM dbo.Tables`;
        if (req.query.location) {
            query += ` WHERE Location = @loc`;
            req2.input('loc', sql.NVarChar, req.query.location);
        }
        const result = await req2.query(query + ' ORDER BY TableID');
        ok(res, result.recordset);
    } catch(e) { err(res, e.message); }
});

// ============================================================
//  ORDERS
// ============================================================
app.get('/api/orders', async (req, res) => {
    try {
        const db   = await getPool();
        const req2 = db.request().input('lim', sql.Int, Number(req.query.limit || 100));
        let where  = '';
        if (req.query.status && req.query.status !== 'all') {
            where = `WHERE o.Status = @status`;
            req2.input('status', sql.NVarChar(20), req.query.status);
        }
        const result = await req2.query(`
            SELECT TOP (@lim)
                o.OrderID,
                'HNQ-'+RIGHT('000000'+CAST(o.OrderID AS VARCHAR),6) AS id,
                ISNULL(o.GuestName, c.FullName) AS customer,
                ISNULL(o.GuestPhone, c.Phone)   AS phone,
                t.TableName AS [table],
                o.OrderType AS type, o.PaymentMethod AS payment,
                o.TotalAmount AS total, o.Status AS status,
                o.Note AS note, o.DeliveryAddress AS address,
                o.CreatedAt AS [time],
                (SELECT STRING_AGG(mi.ItemName+' x'+CAST(oi2.Quantity AS VARCHAR),', ')
                FROM dbo.OrderItems oi2
                JOIN dbo.MenuItems mi ON mi.ItemID=oi2.ItemID
                WHERE oi2.OrderID=o.OrderID) AS itemsSummary,
                (SELECT COUNT(*) FROM dbo.OrderItems oi3 WHERE oi3.OrderID=o.OrderID) AS itemCount
            FROM dbo.Orders o
            LEFT JOIN dbo.Customers c ON c.CustomerID=o.CustomerID
            LEFT JOIN dbo.Tables    t ON t.TableID=o.TableID
            ${where}
            ORDER BY o.CreatedAt DESC`);
        ok(res, result.recordset);
    } catch(e) { err(res, e.message); }
});

app.post('/api/orders', async (req, res) => {
    const { customerId, customerName, customerPhone, orderType, paymentMethod,
            tableLocation, deliveryAddress, deliveryPhone,
            note, promoCode, items } = req.body;

    if (!items || items.length === 0) return err(res, 'Gio hang trong', 400);
    if (!customerName)                return err(res, 'Thieu ten khach hang', 400);

    try {
        const db = await getPool();

        let tableID = null;
        if (orderType === 'dinein' && tableLocation) {
            const t = await db.request()
                .input('tname', sql.NVarChar(80), tableLocation)
                .query(`SELECT TOP 1 TableID FROM dbo.Tables
                        WHERE TableName LIKE '%'+@tname+'%' OR Location=@tname`);
            if (t.recordset.length > 0) tableID = t.recordset[0].TableID;
        }

        let promoID = null;
        if (promoCode) {
            const p = await db.request()
                .input('code', sql.VarChar(30), promoCode)
                .query(`SELECT PromoID FROM dbo.Promotions
                        WHERE PromoCode=@code AND IsActive=1
                            AND CAST(GETDATE() AS DATE) BETWEEN StartDate AND EndDate`);
            if (p.recordset.length > 0) promoID = p.recordset[0].PromoID;
        }

        const subTotal    = items.reduce((s, i) => s + i.price * i.qty, 0);
        const deliveryFee = orderType === 'takeout' ? 15000 : 0;
        const totalAmount = subTotal + deliveryFee;

        const orderRes = await db.request()
            .input('CustomerID',      sql.Int,           customerId ? Number(customerId) : null)
            .input('TableID',         sql.Int,           tableID)
            .input('OrderType',       sql.VarChar(10),   orderType || 'dinein')
            .input('PaymentMethod',   sql.VarChar(20),   normalizePayment(paymentMethod))
            .input('PromoID',         sql.Int,           promoID)
            .input('SubTotal',        sql.Decimal(12,0), subTotal)
            .input('DiscountAmount',  sql.Decimal(12,0), 0)
            .input('TotalAmount',     sql.Decimal(12,0), totalAmount)
            .input('GuestName',       sql.NVarChar(100), customerName)
            .input('GuestPhone',      sql.VarChar(20),   customerPhone || deliveryPhone || null)
            .input('DeliveryAddress', sql.NVarChar(300), deliveryAddress || null)
            .input('Note',            sql.NVarChar(300), note || null)
            .query(`INSERT INTO dbo.Orders
                        (CustomerID,TableID,OrderType,PaymentMethod,PromoID,
                        SubTotal,DiscountAmount,TotalAmount,
                        GuestName,GuestPhone,DeliveryAddress,Note,Status)
                    OUTPUT INSERTED.OrderID
                    VALUES (@CustomerID,@TableID,@OrderType,@PaymentMethod,@PromoID,
                            @SubTotal,@DiscountAmount,@TotalAmount,
                            @GuestName,@GuestPhone,@DeliveryAddress,@Note,'pending')`);

        const orderID = orderRes.recordset[0].OrderID;

        for (const item of items) {
            const itemRes = await db.request()
                .input('lid', sql.Int, item.legacyId)
                .query(`SELECT ItemID FROM dbo.MenuItems WHERE LegacyID=@lid`);
            if (!itemRes.recordset.length) continue;
            await db.request()
                .input('OrderID',   sql.Int,           orderID)
                .input('ItemID',    sql.Int,            itemRes.recordset[0].ItemID)
                .input('Quantity',  sql.SmallInt,       item.qty)
                .input('UnitPrice', sql.Decimal(12,0),  item.price)
                .input('Note',      sql.NVarChar(200),  item.note || null)
                .query(`INSERT INTO dbo.OrderItems (OrderID,ItemID,Quantity,UnitPrice,Note)
                        VALUES (@OrderID,@ItemID,@Quantity,@UnitPrice,@Note)`);
        }

        if (tableID && orderType === 'dinein') {
            await db.request().input('tid', sql.Int, tableID)
                .query(`UPDATE dbo.Tables SET Status='occupied' WHERE TableID=@tid`);
        }

        ok(res, {
            orderId:   `HNQ-${String(orderID).padStart(6,'0')}`,
            dbOrderID: orderID,
            totalAmount
        });
    } catch(e) { console.error('POST /api/orders:', e.message); err(res, e.message); }
});

app.patch('/api/orders/:id/status', async (req, res) => {
    const allowed = ['pending','confirmed','preparing','ready','serving','completed','cancelled'];
    if (!allowed.includes(req.body.status)) return err(res, 'Trang thai khong hop le', 400);
    try {
        const db = await getPool();
        await db.request()
            .input('id',     sql.Int,          Number(req.params.id))
            .input('status', sql.NVarChar(20), req.body.status)
            .query(`UPDATE dbo.Orders SET Status=@status,UpdatedAt=GETDATE() WHERE OrderID=@id`);
        if (['completed','cancelled'].includes(req.body.status)) {
            await db.request().input('id', sql.Int, Number(req.params.id))
                .query(`UPDATE dbo.Tables SET Status='available'
                        WHERE TableID=(SELECT TableID FROM dbo.Orders WHERE OrderID=@id)
                            AND Status='occupied'`);
        }
        ok(res, { updated:true });
    } catch(e) { err(res, e.message); }
});

// ============================================================
//  RESERVATIONS
// ============================================================
app.post('/api/reservations', async (req, res) => {
    const { guestName, guestPhone, guestCount, tableId, date, time, note } = req.body;
    if (!guestName || !guestPhone || !date || !time) return err(res, 'Thieu thong tin', 400);
    try {
        const db = await getPool();
        const result = await db.request()
            .input('GuestName',  sql.NVarChar(100), guestName)
            .input('GuestPhone', sql.VarChar(20),   guestPhone)
            .input('GuestCount', sql.TinyInt,        parseInt(guestCount) || 2)
            .input('TableID',    sql.Int,             tableId || null)
            .input('Date',       sql.Date,            date)
            .input('Time',       sql.VarChar(8),      normalizeTime(time))
            .input('Note',       sql.NVarChar(300),   note || null)
            .query(`INSERT INTO dbo.Reservations
                        (GuestName,GuestPhone,GuestCount,TableID,ReservedDate,ReservedTime,Note,Status)
                    OUTPUT INSERTED.ReservationID
                    VALUES (@GuestName,@GuestPhone,@GuestCount,@TableID,@Date,
                            CAST(@Time AS TIME),@Note,'pending')`);
        ok(res, { reservationId:result.recordset[0].ReservationID });
    } catch(e) { err(res, e.message); }
});

app.get('/api/reservations', async (req, res) => {
    try {
        const db = await getPool();
        const result = await db.request().query(`
            SELECT ReservationID AS id, GuestName AS [user], GuestPhone AS phone,
                    GuestCount AS guests,
                    CONVERT(VARCHAR(16),ReservedDate,120)+' '+LEFT(CAST(ReservedTime AS VARCHAR),5) AS [date],
                    Status AS status, Note AS note
            FROM dbo.Reservations ORDER BY ReservedDate ASC,ReservedTime ASC`);
        ok(res, result.recordset);
    } catch(e) { err(res, e.message); }
});

app.patch('/api/reservations/:id/status', async (req, res) => {
    const allowed = ['pending','confirmed','seated','cancelled','no-show'];
    if (!allowed.includes(req.body.status)) return err(res, 'Trang thai khong hop le', 400);
    try {
        const db = await getPool();
        await db.request()
            .input('id',     sql.Int,          Number(req.params.id))
            .input('status', sql.NVarChar(20), req.body.status)
            .query(`UPDATE dbo.Reservations SET Status=@status WHERE ReservationID=@id`);
        ok(res, { updated:true });
    } catch(e) { err(res, e.message); }
});

// ============================================================
//  CUSTOMER AUTH & DATA
// ============================================================
app.post('/api/customer/register', async (req, res) => {
    const { name, phone, email, address, password } = req.body;
    if (!name || !phone || !email || !password) return err(res, 'Thieu thong tin bat buoc', 400);
    try {
        const db = await getPool();
        const check = await db.request()
            .input('phone', sql.VarChar(20),  phone)
            .input('email', sql.VarChar(150), email)
            .query(`SELECT CustomerID FROM dbo.Customers WHERE Phone=@phone OR Email=@email`);
        if (check.recordset.length > 0)
            return err(res, 'So dien thoai hoac email da duoc dang ky', 409);
        const result = await db.request()
            .input('FullName', sql.NVarChar(100), name)
            .input('Phone',    sql.VarChar(20),   phone)
            .input('Email',    sql.VarChar(150),  email)
            .input('Address',  sql.NVarChar(255), address || null)
            .query(`INSERT INTO dbo.Customers (FullName,Phone,Email,Address)
                    OUTPUT INSERTED.CustomerID,INSERTED.FullName,INSERTED.Phone,INSERTED.Email
                    VALUES (@FullName,@Phone,@Email,@Address)`);
        const c = result.recordset[0];
        ok(res, { customerId:c.CustomerID, name:c.FullName, phone:c.Phone, email:c.Email, role:'customer' });
    } catch(e) { console.error('register:', e.message); err(res, e.message); }
});

app.post('/api/customer/login', async (req, res) => {
    const { email, phone } = req.body;
    if (!email && !phone) return err(res, 'Vui long nhap email hoac so dien thoai', 400);
    try {
        const db   = await getPool();
        const req2 = db.request();
        let query  = `SELECT CustomerID,FullName,Phone,Email,Address,LoyaltyPoint FROM dbo.Customers WHERE `;
        if (email) { query += 'Email=@val'; req2.input('val', sql.VarChar(150), email); }
        else        { query += 'Phone=@val'; req2.input('val', sql.VarChar(20),  phone); }
        const result = await req2.query(query);
        if (!result.recordset.length)
            return err(res, 'Khong tim thay tai khoan. Vui long dang ky truoc.', 404);
        const c = result.recordset[0];
        ok(res, { customerId:c.CustomerID, name:c.FullName, phone:c.Phone,
                    email:c.Email, address:c.Address, loyaltyPoint:c.LoyaltyPoint, role:'customer' });
    } catch(e) { console.error('customer/login:', e.message); err(res, e.message); }
});

app.get('/api/customer/:id/orders', async (req, res) => {
    try {
        const db = await getPool();
        const result = await db.request()
            .input('cid', sql.Int, Number(req.params.id))
            .query(`SELECT TOP 20
                        'HNQ-'+RIGHT('000000'+CAST(o.OrderID AS VARCHAR),6) AS id,
                        o.TotalAmount AS total, o.Status AS status,
                        o.OrderType AS type, o.CreatedAt AS date,
                        (SELECT STRING_AGG(mi.ItemName+' x'+CAST(oi2.Quantity AS VARCHAR),', ')
                        FROM dbo.OrderItems oi2
                        JOIN dbo.MenuItems mi ON mi.ItemID=oi2.ItemID
                        WHERE oi2.OrderID=o.OrderID) AS items
                    FROM dbo.Orders o WHERE o.CustomerID=@cid
                    ORDER BY o.CreatedAt DESC`);
        ok(res, result.recordset);
    } catch(e) { err(res, e.message); }
});

app.get('/api/customer/:id/reservations', async (req, res) => {
    try {
        const db = await getPool();
        const result = await db.request()
            .input('cid', sql.Int, Number(req.params.id))
            .query(`SELECT ReservationID AS id,
                            CONVERT(VARCHAR(16),ReservedDate,120)+' '+LEFT(CAST(ReservedTime AS VARCHAR),5) AS date,
                            GuestCount AS guests, Status AS status, Note AS note
                    FROM dbo.Reservations WHERE CustomerID=@cid
                    ORDER BY ReservedDate DESC`);
        ok(res, result.recordset);
    } catch(e) { err(res, e.message); }
});

app.post('/api/customer/reservation', async (req, res) => {
    let { customerId, guestName, guestPhone, guestCount, date, time, note } = req.body;
    
    // Xử lý khi date chứa cả "2025-08-15 19:00" (từ prompt cũ trong index.html)
    if (date && date.includes(' ') && !time) {
        const parts = date.trim().split(' ');
        date = parts[0];
        time = parts[1] || '18:00';
    }
    // Hoặc khi time chứa cả "2025-08-15 19:00"
    if (time && time.includes(' ')) {
        const parts = time.trim().split(' ');
        date = date || parts[0];
        time = parts[1] || '18:00';
    }
    
    if (!guestName || !date || !time) return err(res, 'Thieu thong tin bat buoc', 400);
    try {
        const db = await getPool();
        const result = await db.request()
            .input('CID',        sql.Int,            customerId ? Number(customerId) : null)
            .input('GuestName',  sql.NVarChar(100),  guestName)
            .input('GuestPhone', sql.VarChar(20),    guestPhone || '0000000000')
            .input('GuestCount', sql.TinyInt,        parseInt(guestCount) || 2)
            .input('Date',       sql.Date,            date)
            .input('Time',       sql.VarChar(8),      normalizeTime(time))
            .input('Note',       sql.NVarChar(300),   note || null)
            .query(`INSERT INTO dbo.Reservations
                        (CustomerID,GuestName,GuestPhone,GuestCount,ReservedDate,ReservedTime,Note,Status)
                    OUTPUT INSERTED.ReservationID
                    VALUES (@CID,@GuestName,@GuestPhone,@GuestCount,@Date,
                            CAST(@Time AS TIME),@Note,'pending')`);
        ok(res, { reservationId:result.recordset[0].ReservationID });
    } catch(e) { console.error('customer/reservation:', e.message); err(res, e.message); }
});

// ============================================================
//  STATS
// ============================================================
app.get('/api/stats', async (req, res) => {
    try {
        const db = await getPool();
        const result = await db.request().query(`
            SELECT COUNT(*) AS totalOrders,
                    SUM(CASE WHEN Status='pending'   THEN 1 ELSE 0 END) AS pendingOrders,
                    SUM(CASE WHEN Status='completed' THEN 1 ELSE 0 END) AS completedOrders,
                    SUM(CASE WHEN Status='cancelled' THEN 1 ELSE 0 END) AS cancelledOrders,
                    ISNULL(SUM(CASE WHEN Status='completed' THEN TotalAmount ELSE 0 END),0) AS totalRevenue,
                    ISNULL(SUM(CASE WHEN Status='completed'
                                    AND CAST(CreatedAt AS DATE)=CAST(GETDATE() AS DATE)
                                THEN TotalAmount ELSE 0 END),0) AS todayRevenue
            FROM dbo.Orders`);
        ok(res, result.recordset[0]);
    } catch(e) { err(res, e.message); }
});

// ============================================================
//  MANAGER LOGIN
// ============================================================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return err(res, 'Thieu thong tin dang nhap', 400);
    const ACCOUNTS = {
        manager: { password:'manager123', fullName:'Anh Hieu', role:'Chu Nha Hang' },
        owner:   { password:'owner123',   fullName:'Chi Nga',  role:'Quan Ly Ca'   },
    };
    const acc = ACCOUNTS[username.toLowerCase()];
    if (!acc || acc.password !== password)
        return err(res, 'Sai ten dang nhap hoac mat khau', 401);
    ok(res, {
        fullName: acc.fullName,
        role:     acc.role,
        avatar:   acc.fullName.charAt(acc.fullName.lastIndexOf(' ') + 1),
    });
});

// ============================================================
//  START
// ============================================================
app.listen(PORT, () => {
    console.log('======================================');
    console.log('  HOA NGU QUAN - API Server v2.0');
    console.log('  http://localhost:' + PORT);
    console.log('  DB: NHUNG-IN | HoaNguQuan');
    console.log('  normalizeTime: OK');
    console.log('  customer endpoints: OK');
    console.log('======================================');
});