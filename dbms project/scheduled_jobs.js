'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKUP_ROOT = path.join(os.homedir(), 'Desktop', 'GroceryBackups');
const DAILY_REPORT_DIR = path.join(BACKUP_ROOT, 'DailySales');
const MONTHLY_REPORT_DIR = path.join(BACKUP_ROOT, 'MonthlySales');
const DATABASE_BACKUP_DIR = path.join(BACKUP_ROOT, 'Database');
const STATE_FILE = path.join(BACKUP_ROOT, 'scheduler-state.json');
const CHECK_INTERVAL_MS = 60 * 1000;

function isValidDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function query(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, results) => {
            if (error) reject(error);
            else resolve(results);
        });
    });
}

function connect(db) {
    return new Promise((resolve, reject) => {
        db.connect((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function endConnection(db) {
    return new Promise((resolve, reject) => {
        db.end((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function monthKey(date) {
    return dateKey(date).slice(0, 7);
}

function previousDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

function previousMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

function nextDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function nextMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) {
        text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
}

function buildSalesCsv(rows) {
    const lines = [[
        'Order ID',
        'Date',
        'Buyer',
        'Phone',
        'Product',
        'Quantity',
        'Unit',
        'Unit Price (Rs.)',
        'Line Total (Rs.)',
        'Order Total (Rs.)',
    ]];
    let grandTotal = 0;
    let currentOrderId = null;

    rows.forEach((row) => {
        const firstOrderLine = String(row.order_id) !== String(currentOrderId);
        if (firstOrderLine) {
            currentOrderId = row.order_id;
            grandTotal += Number(row.order_total || 0);
        }

        const hasProduct = row.product_id !== null;
        const quantity = hasProduct ? Number(row.quantity || 0) : '';
        const unitPrice = hasProduct ? Number(row.unit_price || 0) : '';
        const lineTotal = hasProduct ? Number(row.quantity || 0) * Number(row.unit_price || 0) : '';
        const orderDate = row.order_date instanceof Date
            ? row.order_date.toISOString()
            : String(row.order_date || '');

        lines.push([
            row.order_id,
            orderDate,
            row.buyer_name || 'Walk-in',
            row.buyer_phone || '',
            hasProduct ? (row.product_name || `Product #${row.product_id}`) : 'No line items',
            quantity,
            hasProduct ? row.unit : '',
            hasProduct ? unitPrice.toFixed(2) : '',
            hasProduct ? lineTotal.toFixed(2) : '',
            firstOrderLine ? Number(row.order_total || 0).toFixed(2) : '',
        ]);
    });

    lines.push([]);
    lines.push(['', '', '', '', '', '', '', '', 'TOTAL SALES (Rs.)', grandTotal.toFixed(2)]);
    return `\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}`;
}

async function writeAtomically(filePath, contents) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
        await fs.promises.writeFile(temporaryPath, contents, 'utf8');
        await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
        await fs.promises.rm(temporaryPath, { force: true }).catch((cleanupError) => {
            console.error(`Could not remove temporary backup ${temporaryPath}:`, cleanupError.message);
        });
        throw error;
    }
}

async function readState() {
    try {
        const state = JSON.parse(await fs.promises.readFile(STATE_FILE, 'utf8'));
        if (state.lastDailyReport && !isValidDateKey(state.lastDailyReport)) {
            throw new Error('Backup scheduler state has an invalid lastDailyReport date');
        }
        if (state.lastMonthlyReport && !/^\d{4}-(0[1-9]|1[0-2])$/.test(state.lastMonthlyReport)) {
            throw new Error('Backup scheduler state has an invalid lastMonthlyReport month');
        }
        return state;
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        throw error;
    }
}

async function saveState(state) {
    await writeAtomically(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

async function exportSales(db, start, end, filePath) {
    const rows = await query(db, `
        SELECT
            o.id AS order_id,
            DATE_FORMAT(o.order_date, '%Y-%m-%d %H:%i:%s') AS order_date,
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
        WHERE o.order_date >= ? AND o.order_date < ?
        ORDER BY o.order_date, o.id, oi.id
    `, [start, end]);

    await writeAtomically(filePath, buildSalesCsv(rows));
}

function sqlIdentifier(identifier) {
    return `\`${String(identifier).replace(/`/g, '``')}\``;
}

function tableNamesFromRows(rows) {
    return rows
        .map((row) => {
            const nameColumn = Object.keys(row).find((key) => key !== 'Table_type');
            return nameColumn ? row[nameColumn] : null;
        })
        .filter((name) => typeof name === 'string' && name.length > 0);
}

function sqlValue(value) {
    if (value === null || value === undefined) return 'NULL';
    if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (value instanceof Date) {
        const formatted = [
            value.getFullYear(),
            String(value.getMonth() + 1).padStart(2, '0'),
            String(value.getDate()).padStart(2, '0'),
        ].join('-') + ` ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`;
        return `'${formatted}'`;
    }
    return `'${String(value)
        .replace(/\\/g, '\\\\')
        .replace(/\0/g, '\\0')
        .replace(/\x08/g, '\\b')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\x1a/g, '\\Z')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')}'`;
}

async function exportDatabase(createBackupConnection, databaseName, filePath) {
    const statements = [
        `-- Database backup: ${databaseName}`,
        '-- Generated automatically by Grocery Store Management System.',
        `USE ${sqlIdentifier(databaseName)};`,
        'SET NAMES utf8mb4;',
        "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
        'SET FOREIGN_KEY_CHECKS = 0;',
    ];
    const backupDb = createBackupConnection();
    await connect(backupDb);

    try {
        const tableRows = await query(backupDb, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
        const viewRows = await query(backupDb, "SHOW FULL TABLES WHERE Table_type = 'VIEW'");
        const listedTables = tableNamesFromRows(tableRows);
        const viewNames = tableNamesFromRows(viewRows);
        const tableSet = new Set(listedTables);
        await query(backupDb, 'START TRANSACTION WITH CONSISTENT SNAPSHOT');
        const foreignKeys = await query(backupDb, `
            SELECT TABLE_NAME, REFERENCED_TABLE_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
        `);
        const dependencies = new Map(listedTables.map((name) => [name, new Set()]));
        foreignKeys.forEach(({ TABLE_NAME, REFERENCED_TABLE_NAME }) => {
            if (tableSet.has(TABLE_NAME) && tableSet.has(REFERENCED_TABLE_NAME)) {
                dependencies.get(TABLE_NAME).add(REFERENCED_TABLE_NAME);
            }
        });
        const tableNames = [];
        const remaining = new Set(listedTables);
        while (remaining.size > 0) {
            const ready = Array.from(remaining).filter((name) =>
                Array.from(dependencies.get(name)).every((dependency) => !remaining.has(dependency))
            );
            if (ready.length === 0) {
                throw new Error('Could not order database tables for backup because of circular foreign keys');
            }
            ready.forEach((name) => {
                tableNames.push(name);
                remaining.delete(name);
            });
        }

        for (const name of viewNames) {
            const result = await query(backupDb, `SHOW CREATE TABLE ${sqlIdentifier(name)}`);
            const definition = result[0] && (result[0]['Create View'] || result[0]['Create Table']);
            if (definition) statements.push(`DROP VIEW IF EXISTS ${sqlIdentifier(name)};`);
        }
        for (const name of tableNames) {
            statements.push(`DROP TABLE IF EXISTS ${sqlIdentifier(name)};`);
        }

        for (const name of tableNames) {
            const definitionRows = await query(backupDb, `SHOW CREATE TABLE ${sqlIdentifier(name)}`);
            const definition = definitionRows[0] && definitionRows[0]['Create Table'];
            if (!definition) throw new Error(`Could not read the schema for table ${name}`);
            statements.push(`${definition};`);

            const columns = await query(backupDb, `SHOW FULL COLUMNS FROM ${sqlIdentifier(name)}`);
            const insertableColumns = columns
                .filter((column) => !String(column.Extra || '').toLowerCase().includes('generated'))
                .map((column) => column.Field);
            if (insertableColumns.length === 0) continue;

            const rows = await query(
                backupDb,
                `SELECT ${insertableColumns.map(sqlIdentifier).join(', ')} FROM ${sqlIdentifier(name)}`
            );
            for (const row of rows) {
                const values = insertableColumns.map((column) => sqlValue(row[column]));
                statements.push(
                    `INSERT INTO ${sqlIdentifier(name)} (${insertableColumns.map(sqlIdentifier).join(', ')}) VALUES (${values.join(', ')});`
                );
            }
        }

        for (const name of viewNames) {
            const result = await query(backupDb, `SHOW CREATE TABLE ${sqlIdentifier(name)}`);
            const definition = result[0] && (result[0]['Create View'] || result[0]['Create Table']);
            if (definition) statements.push(`${definition};`);
        }

        await query(backupDb, 'COMMIT');
    } catch (error) {
        await query(backupDb, 'ROLLBACK').catch((rollbackError) => {
            console.error('Could not close database backup snapshot:', rollbackError.message);
        });
        throw error;
    } finally {
        await endConnection(backupDb);
    }

    statements.push('SET FOREIGN_KEY_CHECKS = 1;');
    await writeAtomically(filePath, `${statements.join('\n\n')}\n`);
}

function incrementDay(day) {
    const [year, month, date] = day.split('-').map(Number);
    return dateKey(new Date(year, month - 1, date + 1));
}

function incrementMonth(month) {
    const [year, number] = month.split('-').map(Number);
    return monthKey(new Date(year, number, 1));
}

async function runDueJobs(db, databaseName, createBackupConnection) {
    if (!databaseName) throw new Error('DB_NAME is required to create scheduled database backups');
    const now = new Date();
    const yesterday = previousDay(now);
    const latestDailyReport = dateKey(yesterday);
    const latestMonthlyReport = monthKey(previousMonth(now));
    const state = await readState();

    let nextDayToReport = state.lastDailyReport
        ? incrementDay(state.lastDailyReport)
        : latestDailyReport;
    while (nextDayToReport <= latestDailyReport) {
        const nextDate = new Date(`${nextDayToReport}T00:00:00`);
        const followingDate = nextDay(nextDate);
        const filePath = path.join(DAILY_REPORT_DIR, `sales-${nextDayToReport}.csv`);
        await exportSales(db, `${nextDayToReport} 00:00:00`, `${dateKey(followingDate)} 00:00:00`, filePath);
        state.lastDailyReport = nextDayToReport;
        await saveState(state);
        console.log(`Saved daily sales report: ${filePath}`);
        nextDayToReport = incrementDay(nextDayToReport);
    }

    let nextMonthToReport = state.lastMonthlyReport
        ? incrementMonth(state.lastMonthlyReport)
        : latestMonthlyReport;
    while (nextMonthToReport <= latestMonthlyReport) {
        const [year, month] = nextMonthToReport.split('-').map(Number);
        const start = new Date(year, month - 1, 1);
        const end = nextMonth(start);
        const filePath = path.join(MONTHLY_REPORT_DIR, `sales-${nextMonthToReport}.csv`);
        await exportSales(
            db,
            `${nextMonthToReport}-01 00:00:00`,
            `${dateKey(end)} 00:00:00`,
            filePath
        );
        state.lastMonthlyReport = nextMonthToReport;
        await saveState(state);
        console.log(`Saved monthly sales report: ${filePath}`);
        nextMonthToReport = incrementMonth(nextMonthToReport);
    }

    const databaseBackupPath = path.join(DATABASE_BACKUP_DIR, `database-${dateKey(now)}.sql`);
    if (!fs.existsSync(databaseBackupPath)) {
        await exportDatabase(createBackupConnection, databaseName, databaseBackupPath);
        console.log(`Saved database backup: ${databaseBackupPath}`);
    }
}

function startScheduledJobs(db, createBackupConnection) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            await runDueJobs(db, process.env.DB_NAME, createBackupConnection);
        } catch (error) {
            console.error('Scheduled report or database backup failed:', error);
        } finally {
            running = false;
        }
    };

    run();
    setInterval(run, CHECK_INTERVAL_MS);
}

module.exports = { startScheduledJobs, buildSalesCsv, tableNamesFromRows };
