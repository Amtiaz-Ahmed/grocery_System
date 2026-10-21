const express = require('express');
const mysql = require('mysql');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

dotenv.config({ path: './.env' });

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'grocery-inventory-secret';

const ALLOWED_UNITS = [
    'kg', 'g', 'oz', 'lb', 'liter', 'litre', 'ml', 'l', 'each', 'pack', 'box',
    'dozen', 'bunch', 'bottle', 'can', 'cup', 'packet', '300 ml', '500 ml',
    '1 liter', '1.5 liter', '2 liter', '500 g', '1 kg'
];

function normalizeUnit(rawUnit) {
    if (typeof rawUnit !== 'string') return null;
    const unit = rawUnit.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!unit || unit.length > 20 || !/^[a-z0-9]+(?:[ .-][a-z0-9]+)*$/i.test(unit)) return null;
    return unit;
}

app.use(cookieParser());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(morgan('dev'));

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.log('Error connecting to database: ' + err);
    } else {
        console.log('Connected to database');
        bootstrapSchema();
    }
});

function bootstrapSchema() {
    const statements = [
        `CREATE TABLE IF NOT EXISTS admin (
            id int(10) NOT NULL AUTO_INCREMENT,
            password varchar(255) NOT NULL,
            name varchar(50) NOT NULL,
            pnumber bigint(20) NOT NULL,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS customers (
            id int(11) NOT NULL AUTO_INCREMENT,
            name varchar(100) NOT NULL,
            phone_number varchar(15) NOT NULL,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS products (
            id int(11) NOT NULL AUTO_INCREMENT,
            name varchar(100) NOT NULL,
            price decimal(10,2) NOT NULL,
            unit varchar(20) NOT NULL,
            category varchar(50) NOT NULL,
            stock decimal(10,2) NOT NULL DEFAULT 0,
            low_stock_threshold decimal(10,2) NOT NULL DEFAULT 10,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS categories (
            id int(11) NOT NULL AUTO_INCREMENT,
            name varchar(50) NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY category_name_unique (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS inventory_units (
            id int(11) NOT NULL AUTO_INCREMENT,
            name varchar(20) NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY inventory_unit_name_unique (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS orders (
            id int(11) NOT NULL AUTO_INCREMENT,
            cust_id int(11) NOT NULL,
            admin_id int(10) DEFAULT NULL,
            total_amount decimal(10,2) NOT NULL,
            order_date timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            buyer_name varchar(100) DEFAULT 'Walk-in',
            buyer_phone varchar(15) DEFAULT NULL,
            PRIMARY KEY (id),
            KEY cust_id (cust_id),
            CONSTRAINT orders_cust_fk FOREIGN KEY (cust_id) REFERENCES customers (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS order_items (
            id int(11) NOT NULL AUTO_INCREMENT,
            order_id int(11) NOT NULL,
            product_id int(11) NOT NULL,
            quantity decimal(10,2) NOT NULL,
            unit_price decimal(10,2) NOT NULL,
            unit varchar(20) NOT NULL,
            PRIMARY KEY (id),
            KEY order_id (order_id),
            KEY product_id (product_id),
            CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
            CONSTRAINT order_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS stock_audit (
            id int(11) NOT NULL AUTO_INCREMENT,
            product_id int(11) NOT NULL,
            change_qty decimal(10,2) NOT NULL,
            stock_after decimal(10,2) NOT NULL,
            reason enum('sale','restock','adjustment','new_product','edit') NOT NULL,
            reference_id int(11) DEFAULT NULL,
            admin_id int(10) DEFAULT NULL,
            note varchar(255) DEFAULT NULL,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY product_id (product_id),
            CONSTRAINT stock_audit_product_fk FOREIGN KEY (product_id) REFERENCES products (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ];
    statements.forEach((sql) => db.query(sql, (e) => { if (e) console.log('Schema bootstrap:', e.message); }));
    db.query(
        `INSERT IGNORE INTO categories (name)
         SELECT DISTINCT TRIM(category) FROM products WHERE TRIM(category) <> ''`,
        (err) => { if (err) console.log('Category migration:', err.message); }
    );
    db.query(
        'INSERT IGNORE INTO inventory_units (name) VALUES ?',
        [ALLOWED_UNITS.map((unit) => [unit])],
        (err) => {
            if (err) {
                console.log('Unit migration:', err.message);
                return;
            }
            db.query(
                `INSERT IGNORE INTO inventory_units (name)
                 SELECT DISTINCT LOWER(TRIM(unit)) FROM products WHERE TRIM(unit) <> ''`,
                (migrationErr) => { if (migrationErr) console.log('Existing unit migration:', migrationErr.message); }
            );
        }
    );

    // Auto-migrate: add columns if missing
    const migrations = [
        { table: 'products', column: 'stock', alter: 'ADD COLUMN stock decimal(10,2) NOT NULL DEFAULT 0' },
        { table: 'products', column: 'low_stock_threshold', alter: 'ADD COLUMN low_stock_threshold decimal(10,2) NOT NULL DEFAULT 10' },
        { table: 'orders', column: 'admin_id', alter: 'ADD COLUMN admin_id int(10) DEFAULT NULL' },
        { table: 'orders', column: 'buyer_name', alter: "ADD COLUMN buyer_name varchar(100) DEFAULT 'Walk-in'" },
        { table: 'orders', column: 'buyer_phone', alter: "ADD COLUMN buyer_phone varchar(15) DEFAULT NULL" },
    ];
    migrations.forEach(({ table, column, alter }) => {
        db.query(
            `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [table, column],
            (err, rows) => {
                if (!err && rows[0].c === 0) {
                    db.query(`ALTER TABLE ${table} ${alter}`, (e) => {
                        if (e) console.log(`Migration ${table}.${column}:`, e.message);
                        else console.log(`Added ${table}.${column}`);
                    });
                }
            }
        );
    });
}

function requireAdmin(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ message: 'Not authenticated' });
    }
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ message: 'Session expired' });
    }
}

function logStockAudit(productId, changeQty, stockAfter, reason, referenceId, adminId, note, callback) {
    const sql = `INSERT INTO stock_audit (product_id, change_qty, stock_after, reason, reference_id, admin_id, note)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.query(sql, [productId, changeQty, stockAfter, reason, referenceId || null, adminId || null, note || null], callback);
}

// ── Auth ──

app.post('/admin/login', (req, res) => {
    const { id, password } = req.body;

    if (!id || !password) {
        return res.status(400).json({ message: 'Please fill all fields' });
    }

    db.query('SELECT * FROM admin WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).send('Internal Server Error');
        }

        if (results.length === 0) {
            const message = 'Invalid ID';
            return res.redirect(`/adminlogin.html?message=${encodeURIComponent(message)}`);
        }

        const user = results[0];

        if (user.password !== password) {
            const message = 'Invalid password';
            return res.redirect(`/adminlogin.html?message=${encodeURIComponent(message)}`);
        }

        const token = jwt.sign({ id: user.id, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 8 * 3600000,
            sameSite: 'Strict',
        });

        res.cookie('id', user.id, { maxAge: 8 * 3600000, sameSite: 'Strict' });

        const message = 'Logged in successfully';
        return res.redirect(`/dashboard.html?message=${encodeURIComponent(message)}`);
    });
});

// ── Units ──

function normalizeUnitName(value) {
    return normalizeUnit(value);
}

app.get('/api/units', requireAdmin, (req, res) => {
    db.query('SELECT id, name FROM inventory_units ORDER BY name', (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to fetch units' });
        }
        res.json(results);
    });
});

app.post('/api/units', requireAdmin, (req, res) => {
    const name = normalizeUnitName(req.body.name);
    if (!name) {
        return res.status(400).json({ message: 'Unit name is required and must be 20 characters or fewer.' });
    }
    db.query('INSERT INTO inventory_units (name) VALUES (?)', [name], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That unit already exists.' });
            console.error(err);
            return res.status(500).json({ message: 'Failed to add unit' });
        }
        res.status(201).json({ id: result.insertId, name });
    });
});

app.put('/api/units/:unitId', requireAdmin, (req, res) => {
    const unitId = Number(req.params.unitId);
    const name = normalizeUnitName(req.body.name);
    if (!Number.isInteger(unitId) || unitId <= 0) {
        return res.status(400).json({ message: 'Invalid unit.' });
    }
    if (!name) {
        return res.status(400).json({ message: 'Unit name is required and must be 20 characters or fewer.' });
    }

    db.beginTransaction((transactionErr) => {
        if (transactionErr) {
            console.error(transactionErr);
            return res.status(500).json({ message: 'Failed to update unit' });
        }
        db.query('SELECT name FROM inventory_units WHERE id = ?', [unitId], (selectErr, rows) => {
            if (selectErr || rows.length === 0) {
                return db.rollback(() => {
                    if (selectErr) {
                        console.error(selectErr);
                        return res.status(500).json({ message: 'Failed to update unit' });
                    }
                    res.status(404).json({ message: 'Unit not found' });
                });
            }

            const previousName = rows[0].name;
            db.query('UPDATE inventory_units SET name = ? WHERE id = ?', [name, unitId], (updateErr) => {
                if (updateErr) {
                    return db.rollback(() => {
                        if (updateErr.code === 'ER_DUP_ENTRY') {
                            return res.status(409).json({ message: 'That unit already exists.' });
                        }
                        console.error(updateErr);
                        res.status(500).json({ message: 'Failed to update unit' });
                    });
                }
                db.query('UPDATE products SET unit = ? WHERE unit = ?', [name, previousName], (productsErr) => {
                    if (productsErr) {
                        return db.rollback(() => {
                            console.error(productsErr);
                            res.status(500).json({ message: 'Failed to update products for this unit' });
                        });
                    }
                    db.commit((commitErr) => {
                        if (commitErr) {
                            return db.rollback(() => {
                                console.error(commitErr);
                                res.status(500).json({ message: 'Failed to update unit' });
                            });
                        }
                        res.json({ id: unitId, name });
                    });
                });
            });
        });
    });
});

app.delete('/api/units/:unitId', requireAdmin, (req, res) => {
    const unitId = Number(req.params.unitId);
    if (!Number.isInteger(unitId) || unitId <= 0) {
        return res.status(400).json({ message: 'Invalid unit.' });
    }
    db.query('SELECT name FROM inventory_units WHERE id = ?', [unitId], (selectErr, rows) => {
        if (selectErr) {
            console.error(selectErr);
            return res.status(500).json({ message: 'Failed to delete unit' });
        }
        if (rows.length === 0) return res.status(404).json({ message: 'Unit not found' });
        db.query('SELECT COUNT(*) AS count FROM products WHERE unit = ?', [rows[0].name], (countErr, countRows) => {
            if (countErr) {
                console.error(countErr);
                return res.status(500).json({ message: 'Failed to delete unit' });
            }
            if (countRows[0].count > 0) {
                return res.status(409).json({ message: 'Change the unit on products using it before deleting this unit.' });
            }
            db.query('DELETE FROM inventory_units WHERE id = ?', [unitId], (deleteErr, result) => {
                if (deleteErr) {
                    console.error(deleteErr);
                    return res.status(500).json({ message: 'Failed to delete unit' });
                }
                if (result.affectedRows === 0) return res.status(404).json({ message: 'Unit not found' });
                res.json({ message: 'Unit deleted' });
            });
        });
    });
});

// ── Categories ──

function normalizeCategoryName(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim().replace(/\s+/g, ' ');
    return name && name.length <= 50 ? name : null;
}

app.get('/api/categories', requireAdmin, (req, res) => {
    db.query('SELECT id, name FROM categories ORDER BY name', (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to fetch categories' });
        }
        res.json(results);
    });
});

app.post('/api/categories', requireAdmin, (req, res) => {
    const name = normalizeCategoryName(req.body.name);
    if (!name) {
        return res.status(400).json({ message: 'Category name is required and must be 50 characters or fewer.' });
    }

    db.query('INSERT INTO categories (name) VALUES (?)', [name], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: 'That category already exists.' });
            }
            console.error(err);
            return res.status(500).json({ message: 'Failed to add category' });
        }
        res.status(201).json({ id: result.insertId, name });
    });
});

app.put('/api/categories/:categoryId', requireAdmin, (req, res) => {
    const categoryId = Number(req.params.categoryId);
    const name = normalizeCategoryName(req.body.name);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).json({ message: 'Invalid category.' });
    }
    if (!name) {
        return res.status(400).json({ message: 'Category name is required and must be 50 characters or fewer.' });
    }

    db.beginTransaction((transactionErr) => {
        if (transactionErr) {
            console.error(transactionErr);
            return res.status(500).json({ message: 'Failed to update category' });
        }
        db.query('SELECT name FROM categories WHERE id = ?', [categoryId], (selectErr, rows) => {
            if (selectErr || rows.length === 0) {
                return db.rollback(() => {
                    if (selectErr) {
                        console.error(selectErr);
                        return res.status(500).json({ message: 'Failed to update category' });
                    }
                    res.status(404).json({ message: 'Category not found' });
                });
            }

            const previousName = rows[0].name;
            db.query('UPDATE categories SET name = ? WHERE id = ?', [name, categoryId], (updateErr) => {
                if (updateErr) {
                    return db.rollback(() => {
                        if (updateErr.code === 'ER_DUP_ENTRY') {
                            return res.status(409).json({ message: 'That category already exists.' });
                        }
                        console.error(updateErr);
                        res.status(500).json({ message: 'Failed to update category' });
                    });
                }
                db.query('UPDATE products SET category = ? WHERE category = ?', [name, previousName], (productsErr) => {
                    if (productsErr) {
                        return db.rollback(() => {
                            console.error(productsErr);
                            res.status(500).json({ message: 'Failed to update products for this category' });
                        });
                    }
                    db.commit((commitErr) => {
                        if (commitErr) {
                            return db.rollback(() => {
                                console.error(commitErr);
                                res.status(500).json({ message: 'Failed to update category' });
                            });
                        }
                        res.json({ id: categoryId, name });
                    });
                });
            });
        });
    });
});

app.delete('/api/categories/:categoryId', requireAdmin, (req, res) => {
    const categoryId = Number(req.params.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).json({ message: 'Invalid category.' });
    }

    db.query('SELECT name FROM categories WHERE id = ?', [categoryId], (selectErr, rows) => {
        if (selectErr) {
            console.error(selectErr);
            return res.status(500).json({ message: 'Failed to delete category' });
        }
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Category not found' });
        }
        db.query('SELECT COUNT(*) AS count FROM products WHERE category = ?', [rows[0].name], (countErr, countRows) => {
            if (countErr) {
                console.error(countErr);
                return res.status(500).json({ message: 'Failed to delete category' });
            }
            if (countRows[0].count > 0) {
                return res.status(409).json({ message: 'Move or delete this category’s products before deleting the category.' });
            }
            db.query('DELETE FROM categories WHERE id = ?', [categoryId], (deleteErr, result) => {
                if (deleteErr) {
                    console.error(deleteErr);
                    return res.status(500).json({ message: 'Failed to delete category' });
                }
                if (result.affectedRows === 0) {
                    return res.status(404).json({ message: 'Category not found' });
                }
                res.json({ message: 'Category deleted' });
            });
        });
    });
});

function normalizePrice(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const priceText = String(value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(priceText)) return null;
    const price = Number(priceText);
    return Number.isFinite(price) && price < 100000000 ? price : null;
}

function requireExistingUnit(unit, callback) {
    db.query('SELECT id FROM inventory_units WHERE name = ?', [unit], (err, rows) => {
        if (err) return callback(err);
        callback(null, rows.length > 0);
    });
}

// ── Products ──

app.get('/api/products', requireAdmin, (req, res) => {
    db.query('SELECT * FROM products ORDER BY name', (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch products' });
        }
        res.json(results);
    });
});

app.post('/api/products', requireAdmin, (req, res) => {
    const { name, price, unit, category, stock, low_stock_threshold } = req.body;
    const adminId = req.cookies.id;

    if (!name || price === undefined || !unit || !category) {
        return res.status(400).json({ message: 'Name, price, unit, and category are required' });
    }
    if (/[+]/.test(String(name))) {
        return res.status(400).json({ message: 'Product name cannot contain a + sign.' });
    }
    const safePrice = normalizePrice(price);
    if (safePrice === null) {
        return res.status(400).json({ message: 'Price must be a number with up to two decimal places.' });
    }
    const normalizedUnit = normalizeUnit(unit);
    if (!normalizedUnit) {
        return res.status(400).json({ message: 'Invalid unit name. Use up to 20 letters, numbers, spaces, periods, or hyphens.' });
    }

    requireExistingUnit(normalizedUnit, (unitErr, unitExists) => {
        if (unitErr) {
            console.error(unitErr);
            return res.status(500).json({ message: 'Failed to validate product unit' });
        }
        if (!unitExists) return res.status(400).json({ message: 'Choose a unit from the unit list or add it first.' });

        const initialStock = Number(stock) || 0;
        const threshold = Number(low_stock_threshold) || 10;
        const sql = `INSERT INTO products (name, price, unit, category, stock, low_stock_threshold)
                     VALUES (?, ?, ?, ?, ?, ?)`;
        db.query(sql, [name.trim(), safePrice, normalizedUnit, category, initialStock, threshold], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: 'Failed to add product' });
            }
            const productId = result.insertId;
            if (initialStock > 0) {
                logStockAudit(productId, initialStock, initialStock, 'new_product', null, adminId, 'Initial stock', () => {});
            }
            res.status(201).json({ id: productId, message: 'Product added' });
        });
    });
});

app.put('/api/products/:productId', requireAdmin, (req, res) => {
    const productId = req.params.productId;
    const { name, price, unit, category, stock, low_stock_threshold } = req.body;
    const adminId = req.cookies.id;

    if (!name || price === undefined || !unit || !category) {
        return res.status(400).json({ message: 'Name, price, unit, and category are required' });
    }
    if (/[+]/.test(String(name))) {
        return res.status(400).json({ message: 'Product name cannot contain a + sign.' });
    }
    const safePrice = normalizePrice(price);
    if (safePrice === null) {
        return res.status(400).json({ message: 'Price must be a number with up to two decimal places.' });
    }
    const normalizedUnit = normalizeUnit(unit);
    if (!normalizedUnit) {
        return res.status(400).json({ message: 'Invalid unit name. Use up to 20 letters, numbers, spaces, periods, or hyphens.' });
    }

    requireExistingUnit(normalizedUnit, (unitErr, unitExists) => {
        if (unitErr) {
            console.error(unitErr);
            return res.status(500).json({ message: 'Failed to validate product unit' });
        }
        if (!unitExists) return res.status(400).json({ message: 'Choose a unit from the unit list or add it first.' });

        db.query('SELECT stock FROM products WHERE id = ?', [productId], (fetchErr, rows) => {
            if (fetchErr) {
                console.error(fetchErr);
                return res.status(500).json({ message: 'Failed to fetch product' });
            }
            if (rows.length === 0) return res.status(404).json({ message: 'Product not found' });

            const currentStock = Number(rows[0].stock) || 0;
            const requestedStock = Number(stock);
            const updatedStock = Number.isFinite(requestedStock) ? requestedStock : currentStock;
            const threshold = Number(low_stock_threshold) || 10;
            const stockDelta = updatedStock - currentStock;

            db.query(
                'UPDATE products SET name = ?, price = ?, unit = ?, category = ?, stock = ?, low_stock_threshold = ? WHERE id = ?',
                [name.trim(), safePrice, normalizedUnit, category, updatedStock, threshold, productId],
                (err, result) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ message: 'Failed to update product' });
                    }
                    if (result.affectedRows === 0) {
                        return res.status(404).json({ message: 'Product not found' });
                    }
                    if (stockDelta !== 0) {
                        logStockAudit(productId, stockDelta, updatedStock, 'edit', null, adminId, 'Product stock adjusted in edit', () => {});
                    }
                    res.json({ message: 'Product updated' });
                }
            );
        });
    });
});

app.delete('/api/products/:productId', requireAdmin, (req, res) => {
    const productId = req.params.productId;

    db.query('DELETE FROM products WHERE id = ?', [productId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to delete product. It may be referenced by existing orders.' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json({ message: 'Product deleted' });
    });
});

app.patch('/api/products/:productId/stock', requireAdmin, (req, res) => {
    const productId = req.params.productId;
    const { stockChange, note } = req.body;
    const adminId = req.cookies.id;

    if (stockChange === undefined) {
        return res.status(400).json({ message: 'stockChange is required' });
    }

    db.query('SELECT stock FROM products WHERE id = ?', [productId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const currentStock = parseFloat(results[0].stock);
        const newStock = currentStock + parseFloat(stockChange);

        if (newStock < 0) {
            return res.status(400).json({ message: 'Insufficient stock', currentStock });
        }

        db.query('UPDATE products SET stock = ? WHERE id = ?', [newStock, productId], (err2) => {
            if (err2) {
                return res.status(500).json({ message: 'Failed to update stock' });
            }
            const reason = parseFloat(stockChange) >= 0 ? 'restock' : 'adjustment';
            logStockAudit(productId, stockChange, newStock, reason, null, adminId, note || null, () => {});
            res.json({ message: 'Stock updated', stock: newStock });
        });
    });
});

// ── Orders (owner-created sales) ──

app.post('/api/orders/complete', requireAdmin, (req, res) => {
    const { customerId, buyer_name, buyer_phone, items, total } = req.body;
    const adminId = req.cookies.id;

    if (!items || !items.length || total === undefined) {
        return res.status(400).json({ message: 'Items and total are required' });
    }

    const name = (buyer_name || '').trim() || 'Walk-in';
    const phone = (buyer_phone || '').trim() || null;

    db.beginTransaction((err) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to start transaction' });
        }

        const ensureCustomer = (callback) => {
            const normalizedCustomerId = customerId !== undefined && customerId !== null ? Number(customerId) : null;

            if (normalizedCustomerId) {
                return db.query('SELECT id FROM customers WHERE id = ?', [normalizedCustomerId], (selectErr, customerRows) => {
                    if (selectErr) {
                        return callback(selectErr);
                    }
                    if (customerRows.length > 0) {
                        return callback(null, customerRows[0].id);
                    }

                    db.query(
                        'INSERT INTO customers (name, phone_number) VALUES (?, ?)',
                        [name, phone || 'N/A'],
                        (insertErr, customerResult) => {
                            if (insertErr) {
                                return callback(insertErr);
                            }
                            callback(null, customerResult.insertId);
                        }
                    );
                });
            }

            db.query(
                'INSERT INTO customers (name, phone_number) VALUES (?, ?)',
                [name, phone || 'N/A'],
                (customerErr, customerResult) => {
                    if (customerErr) {
                        return callback(customerErr);
                    }
                    callback(null, customerResult.insertId);
                }
            );
        };

        ensureCustomer((customerErr, resolvedCustomerId) => {
            if (customerErr) {
                return db.rollback(() => res.status(500).json({ message: 'Failed to resolve customer' }));
            }

            const orderDate = new Date();
            db.query(
                'INSERT INTO orders (cust_id, admin_id, buyer_name, buyer_phone, total_amount, order_date) VALUES (?, ?, ?, ?, ?, ?)',
                [resolvedCustomerId, adminId, name, phone, total, orderDate],
                (err2, orderResult) => {
                    if (err2) {
                        return db.rollback(() => res.status(500).json({ message: 'Failed to create order' }));
                    }

                    const orderId = orderResult.insertId;

                    const processItem = (index) => {
                        if (index >= items.length) {
                            db.commit((errCommit) => {
                                if (errCommit) {
                                    return db.rollback(() => res.status(500).json({ message: 'Failed to complete order' }));
                                }
                                res.json({ success: true, orderId, customerId: resolvedCustomerId });
                            });
                            return;
                        }

                        const item = items[index];
                        db.query('SELECT stock, unit FROM products WHERE id = ?', [item.product_id], (err3, prodRows) => {
                            if (err3 || prodRows.length === 0) {
                                return db.rollback(() => res.status(400).json({ message: `Product ${item.product_id} not found` }));
                            }

                            const stock = parseFloat(prodRows[0].stock);
                            const qty = parseFloat(item.quantity);
                            if (stock < qty) {
                                return db.rollback(() =>
                                    res.status(400).json({ message: `Insufficient stock for ${item.name || 'product'}` })
                                );
                            }

                            const newStock = stock - qty;
                            db.query(
                                'UPDATE products SET stock = ? WHERE id = ?',
                                [newStock, item.product_id],
                                (err4) => {
                                    if (err4) {
                                        return db.rollback(() => res.status(500).json({ message: 'Stock update failed' }));
                                    }

                                    logStockAudit(
                                        item.product_id,
                                        -qty,
                                        newStock,
                                        'sale',
                                        orderId,
                                        adminId,
                                        `Order #${orderId}`,
                                        () => {}
                                    );

                                    db.query(
                                        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, unit)
                                         VALUES (?, ?, ?, ?, ?)`,
                                        [orderId, item.product_id, qty, item.price, prodRows[0].unit],
                                        (err5) => {
                                            if (err5) {
                                                return db.rollback(() => res.status(500).json({ message: 'Failed to save order line items' }));
                                            }
                                            processItem(index + 1);
                                        }
                                    );
                                }
                            );
                        });
                    };

                    processItem(0);
                }
            );
        });
    });
});

app.get('/api/orders', requireAdmin, (req, res) => {
    const sql = `
        SELECT id, total_amount, order_date, buyer_name, buyer_phone
        FROM orders
        ORDER BY order_date DESC
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to fetch orders' });
        }
        res.json(results);
    });
});

app.get('/api/orders/:orderId', requireAdmin, (req, res) => {
    const orderId = req.params.orderId;
    db.query(
        'SELECT * FROM orders WHERE id = ?',
        [orderId],
        (err, orders) => {
            if (err || orders.length === 0) {
                return res.status(404).json({ message: 'Order not found' });
            }
            db.query(
                `SELECT oi.*, p.name AS product_name
                 FROM order_items oi JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = ?`,
                [orderId],
                (err2, items) => {
                    if (err2) {
                        return res.status(500).json({ message: 'Failed to fetch order items' });
                    }
                    res.json({ order: orders[0], items });
                }
            );
        }
    );
});

// ── Reports ──

app.get('/api/reports/summary', requireAdmin, (req, res) => {
    const sql = `
        SELECT
            (SELECT COALESCE(SUM(total_amount), 0) FROM orders) AS total_sales,
            (SELECT COUNT(*) FROM orders) AS order_count,
            (SELECT COUNT(*) FROM products WHERE stock <= low_stock_threshold) AS low_stock_count,
            (SELECT COUNT(*) FROM products) AS product_count
    `;
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to load summary' });
        }
        res.json(results[0]);
    });
});

app.get('/api/reports/sales-orders', requireAdmin, (req, res) => {
    const month = req.query.month;
    const params = [];
    let dateFilter = '';

    if (month !== undefined) {
        if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            return res.status(400).json({ message: 'Month must be in YYYY-MM format' });
        }
        dateFilter = 'WHERE o.order_date >= ? AND o.order_date < DATE_ADD(?, INTERVAL 1 MONTH)';
        params.push(`${month}-01`, `${month}-01`);
    }

    const sql = `
        SELECT
            o.id AS order_id,
            o.order_date,
            o.buyer_name,
            o.buyer_phone,
            o.total_amount AS order_total,
            oi.product_id,
            p.name AS product_name,
            oi.quantity,
            oi.unit,
            oi.unit_price
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        ${dateFilter}
        ORDER BY o.order_date, o.id, oi.id
    `;

    db.query(sql, params, (err, rows) => {
        if (err) {
            console.error('Failed to load sales export:', err);
            return res.status(500).json({ message: 'Failed to load sales export' });
        }
        res.json(rows);
    });
});

app.get('/api/audit/stock', requireAdmin, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const sql = `
        SELECT sa.*, p.name AS product_name, p.unit
        FROM stock_audit sa
        JOIN products p ON sa.product_id = p.id
        ORDER BY sa.created_at DESC
        LIMIT ?
    `;
    db.query(sql, [limit], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to fetch audit log' });
        }
        res.json(results);
    });
});

// ── Static / routes ──

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'adminlogin.html'));
});

app.use(express.static(path.join(__dirname, './public')));

app.listen(PORT, () => {
    console.log(`Inventory server running on port ${PORT}`);
});
