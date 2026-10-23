const path = require('path');
const { Readable } = require('node:stream');
const ExcelJS = require('exceljs');

const MAX_IMPORT_ROWS = 500;
const MAX_MONEY = 100000000;
const HEADER_ALIASES = {
    price: 'selling_price',
    sale_price: 'selling_price',
    cost_price: 'purchase_cost',
    purchase_price: 'purchase_cost',
    threshold: 'low_stock_threshold',
};

function normalizeHeader(value) {
    const header = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return HEADER_ALIASES[header] || header;
}

function parseAmount(value, allowZero = true) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const text = String(value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount >= MAX_MONEY || (!allowZero && amount <= 0)) return null;
    return amount;
}

function excelCellValue(value) {
    if (value && typeof value === 'object') {
        if (value.formula || value.sharedFormula) return '#UNSUPPORTED_FORMULA#';
        if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
        if (value.text !== undefined) return value.text;
        if (value.result !== undefined) return excelCellValue(value.result);
        return '';
    }
    return value ?? '';
}

async function parseInventoryFile(buffer, filename) {
    const extension = path.extname(filename || '').toLowerCase();
    if (!['.csv', '.xlsx'].includes(extension)) {
        return { rows: [], errors: ['Choose a .csv or .xlsx file.'] };
    }

    const workbook = new ExcelJS.Workbook();
    try {
        if (extension === '.csv') {
            await workbook.csv.read(Readable.from([buffer]));
        } else {
            await workbook.xlsx.load(buffer);
        }
    } catch (error) {
        return { rows: [], errors: ['The file could not be read as a valid spreadsheet.'] };
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount === 0) return { rows: [], errors: ['The file is empty.'] };

    const headerValues = worksheet.getRow(1).values.slice(1).map(excelCellValue);
    while (headerValues.length && String(headerValues[headerValues.length - 1]).trim() === '') headerValues.pop();
    const headers = headerValues.map(normalizeHeader);
    const requiredHeaders = ['name', 'category', 'selling_price', 'purchase_cost', 'unit', 'stock'];
    const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
    if (missingHeaders.length) {
        return {
            rows: [],
            errors: [`Missing required columns: ${missingHeaders.join(', ')}.`],
        };
    }
    if (new Set(headers).size !== headers.length) {
        return { rows: [], errors: ['The file contains duplicate column names.'] };
    }

    const dataRows = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const values = worksheet.getRow(rowNumber).values.slice(1, headers.length + 1).map(excelCellValue);
        if (values.some((value) => String(value ?? '').trim() !== '')) {
            dataRows.push({ rowNumber, values });
        }
    }
    if (!dataRows.length) return { rows: [], errors: ['Add at least one inventory row.'] };
    if (dataRows.length > MAX_IMPORT_ROWS) {
        return { rows: [], errors: [`Upload no more than ${MAX_IMPORT_ROWS} products at a time.`] };
    }

    const rows = [];
    const errors = [];
    const seenNames = new Set();

    dataRows.forEach(({ rowNumber, values }) => {
        const record = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
        const name = String(record.name ?? '').trim();
        const category = String(record.category ?? '').trim().replace(/\s+/g, ' ');
        const unit = String(record.unit ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
        const sellingPrice = parseAmount(record.selling_price);
        const purchaseCost = parseAmount(record.purchase_cost);
        const stock = parseAmount(record.stock);
        const threshold = String(record.low_stock_threshold ?? '').trim() === ''
            ? 10
            : parseAmount(record.low_stock_threshold);
        const rowErrors = [];

        if (!name || name.length > 100 || name.includes('+')) {
            rowErrors.push('name must be 1-100 characters and cannot contain +');
        }
        if (!category || category.length > 50) rowErrors.push('category must be 1-50 characters');
        if (!/^[a-z0-9]+(?:[ .-][a-z0-9]+)*$/i.test(unit) || unit.length > 20) {
            rowErrors.push('unit must be a valid unit name of at most 20 characters');
        }
        if (sellingPrice === null) rowErrors.push('selling_price must be a non-negative amount with up to 2 decimals');
        if (purchaseCost === null) rowErrors.push('purchase_cost must be a non-negative amount with up to 2 decimals');
        if (stock === null) rowErrors.push('stock must be a non-negative quantity with up to 2 decimals');
        if (threshold === null) rowErrors.push('low_stock_threshold must be a non-negative amount with up to 2 decimals');

        const normalizedName = name.toLocaleLowerCase();
        if (name && seenNames.has(normalizedName)) rowErrors.push('product name is duplicated in this file');
        if (name) seenNames.add(normalizedName);

        if (rowErrors.length) {
            errors.push(`Row ${rowNumber}: ${rowErrors.join('; ')}.`);
            return;
        }

        rows.push({
            name,
            category,
            price: sellingPrice,
            cost_price: purchaseCost,
            unit,
            stock,
            low_stock_threshold: threshold,
        });
    });

    return { rows, errors };
}

module.exports = { MAX_IMPORT_ROWS, parseInventoryFile };
