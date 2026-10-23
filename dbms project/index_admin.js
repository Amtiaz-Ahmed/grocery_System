const express = require('express');
const mysql = require('mysql');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');
const morgan = require('morgan');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { startScheduledJobs } = require('./scheduled_jobs');
const { parseInventoryFile } = require('./inventory_import');

dotenv.config({ path: './.env' });

const PORT = process.env.PORT || 4000;

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

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(morgan('dev'));

const databaseConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME
};
const db = mysql.createConnection(databaseConfig);

db.connect((err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
        process.exit(1);
    } else {
        console.log('Connected to database');
        bootstrapSchema()
            .then(() => {
                startScheduledJobs(db, () => mysql.createConnection(databaseConfig));
                startServer();
            })
            .catch((schemaErr) => {
                console.error('Failed to initialize database schema:', schemaErr);
                process.exit(1);
            });
    }
});

function queryDatabase(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

async function bootstrapSchema() {
    const statements = [
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
            cost_price decimal(10,2) DEFAULT NULL,
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
            unit_cost decimal(10,2) DEFAULT NULL,
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
            purchase_unit_cost decimal(10,2) DEFAULT NULL,
            note varchar(255) DEFAULT NULL,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY product_id (product_id),
            CONSTRAINT stock_audit_product_fk FOREIGN KEY (product_id) REFERENCES products (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ];
    for (const sql of statements) await queryDatabase(sql);

    await queryDatabase(
        `INSERT IGNORE INTO categories (name)
         SELECT DISTINCT TRIM(category) FROM products WHERE TRIM(category) <> ''`
    );
    await queryDatabase(
        'INSERT IGNORE INTO inventory_units (name) VALUES ?',
        [ALLOWED_UNITS.map((unit) => [unit])]
    );
    await queryDatabase(
        `INSERT IGNORE INTO inventory_units (name)
         SELECT DISTINCT LOWER(TRIM(unit)) FROM products WHERE TRIM(unit) <> ''`
    );

    const migrations = [
        { table: 'products', column: 'stock', alter: 'ADD COLUMN stock decimal(10,2) NOT NULL DEFAULT 0' },
        { table: 'products', column: 'low_stock_threshold', alter: 'ADD COLUMN low_stock_threshold decimal(10,2) NOT NULL DEFAULT 10' },
        { table: 'products', column: 'cost_price', alter: 'ADD COLUMN cost_price decimal(10,2) DEFAULT NULL' },
        { table: 'order_items', column: 'unit_cost', alter: 'ADD COLUMN unit_cost decimal(10,2) DEFAULT NULL' },
        { table: 'stock_audit', column: 'purchase_unit_cost', alter: 'ADD COLUMN purchase_unit_cost decimal(10,2) DEFAULT NULL' },
        { table: 'orders', column: 'admin_id', alter: 'ADD COLUMN admin_id int(10) DEFAULT NULL' },
        { table: 'orders', column: 'buyer_name', alter: "ADD COLUMN buyer_name varchar(100) DEFAULT 'Walk-in'" },
        { table: 'orders', column: 'buyer_phone', alter: "ADD COLUMN buyer_phone varchar(15) DEFAULT NULL" },
    ];
    for (const { table, column, alter } of migrations) {
        const rows = await queryDatabase(
            `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [table, column]
        );
        if (Number(rows[0].c) === 0) {
            await queryDatabase(`ALTER TABLE ${table} ${alter}`);
            console.log(`Added ${table}.${column}`);
        }
    }
}

function requireLocalhost(req, res, next) {
    const address = req.socket.remoteAddress;
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') {
        return res.sendStatus(403);
    }
    next();
}

function logStockAudit(productId, changeQty, stockAfter, reason, referenceId, adminId, note, callback, purchaseUnitCost = null) {
    const sql = `INSERT INTO stock_audit
                 (product_id, change_qty, stock_after, reason, reference_id, admin_id, purchase_unit_cost, note)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(
        sql,
        [productId, changeQty, stockAfter, reason, referenceId || null, adminId || null, purchaseUnitCost, note || null],
        callback
    );
}

// ── Units ──

function normalizeUnitName(value) {
    return normalizeUnit(value);
}

app.get('/api/units', requireLocalhost, (req, res) => {
    db.query('SELECT id, name FROM inventory_units ORDER BY name', (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to fetch units' });
        }
        res.json(results);
    });
});

app.post('/api/units', requireLocalhost, (req, res) => {
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

app.put('/api/units/:unitId', requireLocalhost, (req, res) => {
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

app.delete('/api/units/:unitId', requireLocalhost, (req, res) => {
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

app.get('/api/categories', requireLocalhost, (req, res) => {
    db.query('SELECT id, name FROM categories ORDER BY name', (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to fetch categories' });
        }
        res.json(results);
    });
});

app.post('/api/categories', requireLocalhost, (req, res) => {
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

app.put('/api/categories/:categoryId', requireLocalhost, (req, res) => {
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

app.delete('/api/categories/:categoryId', requireLocalhost, (req, res) => {
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

const inventoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

app.get('/api/products', requireLocalhost, (req, res) => {
    db.query('SELECT * FROM products ORDER BY name', (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch products' });
        }
        res.json(results);
    });
});

app.post('/api/products', requireLocalhost, (req, res) => {
    const { name, price, unit, category, stock, low_stock_threshold, cost_price } = req.body;
    const adminId = null;

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
    const safeCostPrice = cost_price === undefined || cost_price === null || String(cost_price).trim() === ''
        ? null
        : normalizePrice(cost_price);
    if (cost_price !== undefined && cost_price !== null && String(cost_price).trim() !== '' && safeCostPrice === null) {
        return res.status(400).json({ message: 'Purchase cost must be a non-negative amount with up to two decimal places.' });
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

        const initialStock = stock === undefined || stock === null || String(stock).trim() === '' ? 0 : normalizePrice(stock);
        if (initialStock === null) {
            return res.status(400).json({ message: 'Stock must be a non-negative quantity with up to two decimal places.' });
        }
        if (initialStock > 0 && safeCostPrice === null) {
            return res.status(400).json({ message: 'Enter the purchase cost per unit when adding initial stock.' });
        }
        const threshold = Number(low_stock_threshold) || 10;
        const sql = `INSERT INTO products (name, price, unit, category, stock, low_stock_threshold, cost_price)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`;
        db.query(sql, [name.trim(), safePrice, normalizedUnit, category, initialStock, threshold, safeCostPrice], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: 'Failed to add product' });
            }
            const productId = result.insertId;
            if (initialStock > 0) {
                logStockAudit(productId, initialStock, initialStock, 'new_product', null, adminId, 'Initial stock', () => {}, safeCostPrice);
            }
            res.status(201).json({ id: productId, message: 'Product added' });
        });
    });
});

app.put('/api/products/:productId', requireLocalhost, (req, res) => {
    const productId = req.params.productId;
    const { name, price, unit, category, stock, low_stock_threshold, cost_price } = req.body;
    const adminId = null;

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
    const hasCostPrice = Object.prototype.hasOwnProperty.call(req.body, 'cost_price');
    const safeCostPrice = !hasCostPrice || cost_price === null || String(cost_price).trim() === ''
        ? null
        : normalizePrice(cost_price);
    if (hasCostPrice && cost_price !== null && String(cost_price).trim() !== '' && safeCostPrice === null) {
        return res.status(400).json({ message: 'Purchase cost must be a non-negative amount with up to two decimal places.' });
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

        db.query('SELECT stock, cost_price FROM products WHERE id = ?', [productId], (fetchErr, rows) => {
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
            const updatedCostPrice = hasCostPrice ? safeCostPrice : rows[0].cost_price;
            const previousCostPrice = rows[0].cost_price === null ? null : Number(rows[0].cost_price);
            const costChanged = hasCostPrice
                && (updatedCostPrice === null
                    ? previousCostPrice !== null
                    : previousCostPrice === null || Number(updatedCostPrice) !== previousCostPrice);

            db.query(
                'UPDATE products SET name = ?, price = ?, unit = ?, category = ?, stock = ?, low_stock_threshold = ?, cost_price = ? WHERE id = ?',
                [name.trim(), safePrice, normalizedUnit, category, updatedStock, threshold, updatedCostPrice, productId],
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
                    if (costChanged) {
                        logStockAudit(
                            productId,
                            0,
                            updatedStock,
                            'edit',
                            null,
                            adminId,
                            'Purchase cost updated',
                            () => {},
                            updatedCostPrice
                        );
                    }
                    res.json({ message: 'Product updated' });
                }
            );
        });
    });
});

app.get('/api/products/import-template', requireLocalhost, (req, res) => {
    const format = req.query.format || 'csv';
    const headers = ['name', 'category', 'selling_price', 'purchase_cost', 'unit', 'stock', 'low_stock_threshold'];
    const filename = `inventory-template.${format}`;

    if (format === 'csv') {
        res.type('text/csv');
        res.set('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(`${headers.join(',')}\r\n`);
    }
    if (format !== 'xlsx') {
        return res.status(400).json({ message: 'Template format must be csv or xlsx.' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Inventory').addRow(headers);
    workbook.xlsx.writeBuffer()
        .then((buffer) => {
            res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.set('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(Buffer.from(buffer));
        })
        .catch((error) => {
            console.error('Failed to create Excel inventory template:', error);
            res.status(500).json({ message: 'Failed to create Excel template.' });
        });
});

app.post('/api/products/import', requireLocalhost, (req, res) => {
    inventoryUpload.single('file')(req, res, (uploadErr) => {
        if (uploadErr) {
            const message = uploadErr.code === 'LIMIT_FILE_SIZE'
                ? 'File must be 5 MB or smaller.'
                : 'Upload one CSV or XLSX file.';
            return res.status(400).json({ message });
        }
        if (!req.file) return res.status(400).json({ message: 'Choose a CSV or XLSX file to upload.' });

        parseInventoryFile(req.file.buffer, req.file.originalname).then((parsed) => {
            if (parsed.errors.length) {
                return res.status(400).json({
                    message: 'The inventory file has errors. No products were imported.',
                    errors: parsed.errors,
                });
            }

            db.beginTransaction((transactionErr) => {
            if (transactionErr) {
                console.error(transactionErr);
                return res.status(500).json({ message: 'Failed to start inventory import.' });
            }

            let created = 0;
            let updated = 0;
            const rollbackWithError = (error, status = 500, message = 'Inventory import failed. No products were imported.') => {
                db.rollback(() => {
                    console.error('Inventory import failed:', error);
                    res.status(status).json({ message });
                });
            };

            const importRow = (index) => {
                if (index >= parsed.rows.length) {
                    return db.commit((commitErr) => {
                        if (commitErr) return rollbackWithError(commitErr);
                        res.json({ message: 'Inventory imported successfully.', created, updated, total: parsed.rows.length });
                    });
                }

                const row = parsed.rows[index];
                db.query('INSERT IGNORE INTO categories (name) VALUES (?)', [row.category], (categoryErr) => {
                    if (categoryErr) return rollbackWithError(categoryErr);
                    db.query('INSERT IGNORE INTO inventory_units (name) VALUES (?)', [row.unit], (unitErr) => {
                        if (unitErr) return rollbackWithError(unitErr);
                        db.query(
                            'SELECT id, stock, cost_price FROM products WHERE LOWER(name) = LOWER(?) LIMIT 2 FOR UPDATE',
                            [row.name],
                            (productErr, products) => {
                                if (productErr) return rollbackWithError(productErr);
                                if (products.length > 1) {
                                    return rollbackWithError(
                                        new Error(`Multiple existing products match "${row.name}".`),
                                        409,
                                        `More than one existing product matches "${row.name}". Resolve duplicate names before importing.`
                                    );
                                }
                                if (!products.length) {
                                    db.query(
                                        `INSERT INTO products
                                         (name, price, unit, category, stock, low_stock_threshold, cost_price)
                                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                        [
                                            row.name,
                                            row.price,
                                            row.unit,
                                            row.category,
                                            row.stock,
                                            row.low_stock_threshold,
                                            row.cost_price,
                                        ],
                                        (insertErr, result) => {
                                            if (insertErr) return rollbackWithError(insertErr);
                                            created += 1;
                                            const auditNewProduct = (callback) => {
                                                if (row.stock <= 0) return callback();
                                                db.query(
                                                    `INSERT INTO stock_audit
                                                     (product_id, change_qty, stock_after, reason, purchase_unit_cost, note)
                                                     VALUES (?, ?, ?, 'new_product', ?, ?)`,
                                                    [result.insertId, row.stock, row.stock, row.cost_price, 'Initial stock from bulk import'],
                                                    callback
                                                );
                                            };
                                            auditNewProduct((auditErr) => {
                                                if (auditErr) return rollbackWithError(auditErr);
                                                importRow(index + 1);
                                            });
                                        }
                                    );
                                    return;
                                }

                                const product = products[0];
                                const oldStock = Number(product.stock) || 0;
                                const newStock = oldStock + row.stock;
                                let weightedCost = product.cost_price === null ? null : Number(product.cost_price);
                                if (oldStock === 0) {
                                    weightedCost = row.cost_price;
                                } else if (weightedCost !== null && newStock > 0) {
                                    weightedCost = Math.round(
                                        ((oldStock * weightedCost + row.stock * row.cost_price) / newStock) * 100
                                    ) / 100;
                                }

                                db.query(
                                    `UPDATE products SET name = ?, price = ?, unit = ?, category = ?,
                                     stock = ?, low_stock_threshold = ?, cost_price = ? WHERE id = ?`,
                                    [
                                        row.name,
                                        row.price,
                                        row.unit,
                                        row.category,
                                        newStock,
                                        row.low_stock_threshold,
                                        weightedCost,
                                        product.id,
                                    ],
                                    (updateErr) => {
                                        if (updateErr) return rollbackWithError(updateErr);
                                        updated += 1;
                                        const auditRestock = (callback) => {
                                            if (row.stock <= 0) return callback();
                                            db.query(
                                                `INSERT INTO stock_audit
                                                 (product_id, change_qty, stock_after, reason, purchase_unit_cost, note)
                                                 VALUES (?, ?, ?, 'restock', ?, ?)`,
                                                [product.id, row.stock, newStock, row.cost_price, 'Stock received from bulk import'],
                                                callback
                                            );
                                        };
                                        auditRestock((auditErr) => {
                                            if (auditErr) return rollbackWithError(auditErr);
                                            importRow(index + 1);
                                        });
                                    }
                                );
                            }
                        );
                    });
                });
            };

                importRow(0);
            });
        }).catch((parseErr) => {
            console.error('Failed to parse inventory upload:', parseErr);
            res.status(400).json({ message: 'The file could not be read as a valid spreadsheet.' });
        });
    });
});

app.delete('/api/products/:productId', requireLocalhost, (req, res) => {
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

app.patch('/api/products/:productId/stock', requireLocalhost, (req, res) => {
    const productId = req.params.productId;
    const { stockChange, unitCost, note } = req.body;
    const adminId = null;

    if (stockChange === undefined) {
        return res.status(400).json({ message: 'stockChange is required' });
    }
    const parsedChange = Number(stockChange);
    if (!Number.isFinite(parsedChange)
        || Math.abs(parsedChange) >= 100000000
        || !/^-?\d+(?:\.\d{1,2})?$/.test(String(stockChange).trim())) {
        return res.status(400).json({ message: 'stockChange must be a valid quantity.' });
    }
    const safeUnitCost = unitCost === undefined || unitCost === null || String(unitCost).trim() === ''
        ? null
        : normalizePrice(unitCost);
    if (unitCost !== undefined && unitCost !== null && String(unitCost).trim() !== '' && safeUnitCost === null) {
        return res.status(400).json({ message: 'Purchase cost must be a non-negative amount with up to two decimal places.' });
    }

    db.query('SELECT stock, cost_price FROM products WHERE id = ?', [productId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to load product stock.' });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const currentStock = parseFloat(results[0].stock);
        const newStock = currentStock + parsedChange;

        if (newStock < 0) {
            return res.status(400).json({ message: 'Insufficient stock', currentStock });
        }

        let updatedCost = results[0].cost_price === null ? null : Number(results[0].cost_price);
        if (parsedChange > 0 && safeUnitCost !== null) {
            updatedCost = currentStock === 0
                ? safeUnitCost
                : updatedCost === null
                    ? null
                    : Math.round(((currentStock * updatedCost + parsedChange * safeUnitCost) / newStock) * 100) / 100;
        }

        db.query('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?', [newStock, updatedCost, productId], (err2) => {
            if (err2) {
                console.error(err2);
                return res.status(500).json({ message: 'Failed to update stock' });
            }
            const reason = parsedChange >= 0 ? 'restock' : 'adjustment';
            logStockAudit(
                productId,
                parsedChange,
                newStock,
                reason,
                null,
                adminId,
                note || null,
                () => {},
                parsedChange > 0 ? safeUnitCost : null
            );
            res.json({ message: 'Stock updated', stock: newStock });
        });
    });
});

// ── Orders (owner-created sales) ──

app.post('/api/orders/complete', requireLocalhost, (req, res) => {
    const { customerId, buyer_name, buyer_phone, items, total } = req.body;
    const adminId = null;

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
                        db.query('SELECT stock, unit, cost_price FROM products WHERE id = ?', [item.product_id], (err3, prodRows) => {
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
                                        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, unit, unit_cost)
                                         VALUES (?, ?, ?, ?, ?, ?)`,
                                        [orderId, item.product_id, qty, item.price, prodRows[0].unit, prodRows[0].cost_price],
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

app.get('/api/orders', requireLocalhost, (req, res) => {
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

app.get('/api/orders/:orderId', requireLocalhost, (req, res) => {
    const orderId = req.params.orderId;
    db.query(
        'SELECT * FROM orders WHERE id = ?',
        [orderId],
        (err, orders) => {
            if (err || orders.length === 0) {
                return res.status(404).json({ message: 'Order not found' });
            }
            db.query(
                `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.unit_price, oi.unit, p.name AS product_name
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

app.get('/api/reports/summary', requireLocalhost, (req, res) => {
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

app.get('/api/reports/profit', requireLocalhost, (req, res) => {
    const month = req.query.month;
    let dateFilter = '';
    const params = [];
    if (month !== undefined) {
        if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            return res.status(400).json({ message: 'Month must be in YYYY-MM format.' });
        }
        dateFilter = 'WHERE o.order_date >= ? AND o.order_date < DATE_ADD(?, INTERVAL 1 MONTH)';
        params.push(`${month}-01`, `${month}-01`);
    }

    const summarySql = `
        SELECT
            COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_sales,
            COALESCE(SUM(CASE WHEN oi.unit_cost IS NOT NULL
                THEN oi.quantity * oi.unit_price ELSE 0 END), 0) AS tracked_sales,
            COALESCE(SUM(CASE WHEN oi.unit_cost IS NOT NULL
                THEN oi.quantity * oi.unit_cost ELSE 0 END), 0) AS cost_of_goods_sold,
            COALESCE(SUM(CASE WHEN oi.unit_cost IS NULL
                THEN oi.quantity * oi.unit_price ELSE 0 END), 0) AS uncosted_sales,
            SUM(CASE WHEN oi.unit_cost IS NULL THEN 1 ELSE 0 END) AS uncosted_lines,
            SUM(CASE WHEN oi.unit_cost IS NOT NULL THEN 1 ELSE 0 END) AS tracked_lines
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        ${dateFilter}
    `;
    db.query(summarySql, params, (summaryErr, summaryRows) => {
        if (summaryErr) {
            console.error('Failed to load profit summary:', summaryErr);
            return res.status(500).json({ message: 'Failed to load profit report.' });
        }

        const productSql = `
            SELECT
                oi.product_id,
                p.name AS product_name,
                oi.unit,
                SUM(oi.quantity) AS quantity_sold,
                SUM(oi.quantity * oi.unit_price) AS total_sales,
                SUM(CASE WHEN oi.unit_cost IS NOT NULL
                    THEN oi.quantity * oi.unit_price ELSE 0 END) AS tracked_sales,
                SUM(CASE WHEN oi.unit_cost IS NOT NULL
                    THEN oi.quantity * oi.unit_cost ELSE 0 END) AS cost_of_goods_sold,
                SUM(CASE WHEN oi.unit_cost IS NULL
                    THEN oi.quantity * oi.unit_price ELSE 0 END) AS uncosted_sales,
                SUM(CASE WHEN oi.unit_cost IS NOT NULL THEN 1 ELSE 0 END) AS tracked_lines
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            JOIN products p ON p.id = oi.product_id
            ${dateFilter}
            GROUP BY oi.product_id, p.name, oi.unit
            ORDER BY quantity_sold DESC, total_sales DESC
        `;
        db.query(productSql, params, (productsErr, productRows) => {
            if (productsErr) {
                console.error('Failed to load product profit report:', productsErr);
                return res.status(500).json({ message: 'Failed to load profit report.' });
            }

            const summaryRow = summaryRows[0];
            const trackedSales = Number(summaryRow.tracked_sales) || 0;
            const costOfGoodsSold = Number(summaryRow.cost_of_goods_sold) || 0;
            const trackedLines = Number(summaryRow.tracked_lines) || 0;
            const summary = {
                total_sales: Number(summaryRow.total_sales) || 0,
                tracked_sales: trackedSales,
                cost_of_goods_sold: costOfGoodsSold,
                gross_profit: trackedLines > 0 ? trackedSales - costOfGoodsSold : null,
                tracked_lines: trackedLines,
                roi_percent: costOfGoodsSold > 0
                    ? ((trackedSales - costOfGoodsSold) / costOfGoodsSold) * 100
                    : null,
                uncosted_sales: Number(summaryRow.uncosted_sales) || 0,
                uncosted_lines: Number(summaryRow.uncosted_lines) || 0,
            };
            const products = productRows.map((row) => {
                const productTrackedSales = Number(row.tracked_sales) || 0;
                const productCost = Number(row.cost_of_goods_sold) || 0;
                return {
                    ...row,
                    quantity_sold: Number(row.quantity_sold) || 0,
                    total_sales: Number(row.total_sales) || 0,
                    tracked_sales: productTrackedSales,
                    cost_of_goods_sold: productCost,
                    tracked_lines: Number(row.tracked_lines) || 0,
                    gross_profit: Number(row.tracked_lines) > 0 ? productTrackedSales - productCost : null,
                    roi_percent: productCost > 0
                        ? ((productTrackedSales - productCost) / productCost) * 100
                        : null,
                    uncosted_sales: Number(row.uncosted_sales) || 0,
                };
            });
            res.json({ month: month || null, summary, products });
        });
    });
});

app.get('/api/reports/sales-orders', requireLocalhost, (req, res) => {
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

app.get('/api/audit/stock', requireLocalhost, (req, res) => {
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
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.use(express.static(path.join(__dirname, './public')));

function startServer() {
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`Inventory server running on port ${PORT}`);
    });
}
