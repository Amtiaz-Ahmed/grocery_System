const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { parseInventoryFile } = require('./inventory_import');

async function createWorkbookBuffer(rows) {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Inventory').addRows(rows);
    return workbook.xlsx.writeBuffer();
}

test('parses CSV headers and optional stock threshold', async () => {
    const file = Buffer.from(
        'Name,Category,Selling Price,Purchase Cost,Unit,Stock\nTissue Box,Paper,190,150,box,10\n',
        'utf8'
    );
    const result = await parseInventoryFile(file, 'inventory.csv');

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.rows, [{
        name: 'Tissue Box',
        category: 'Paper',
        price: 190,
        cost_price: 150,
        unit: 'box',
        stock: 10,
        low_stock_threshold: 10,
    }]);
});

test('parses Excel files and supports common header aliases', async () => {
    const file = await createWorkbookBuffer([
        ['name', 'category', 'price', 'cost_price', 'unit', 'stock', 'threshold'],
        ['Tissue Box', 'Paper', 190, 150, 'box', 10, 2],
    ]);
    const result = await parseInventoryFile(file, 'inventory.xlsx');

    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0].price, 190);
    assert.equal(result.rows[0].cost_price, 150);
    assert.equal(result.rows[0].low_stock_threshold, 2);
});

test('rejects duplicate products and invalid values', async () => {
    const file = Buffer.from([
        'name,category,selling_price,purchase_cost,unit,stock',
        'Tissue Box,Paper,190,150,box,10',
        'tissue box,Paper,-1,150,box,10',
    ].join('\n'), 'utf8');
    const result = await parseInventoryFile(file, 'inventory.csv');

    assert.equal(result.rows.length, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /selling_price/);
    assert.match(result.errors[0], /duplicated/);
});

test('rejects unsupported file extensions and missing required headers', async () => {
    assert.match((await parseInventoryFile(Buffer.from(''), 'inventory.xls')).errors[0], /\.csv or \.xlsx/);
    const result = await parseInventoryFile(
        Buffer.from('name,price\nTissue Box,190\n', 'utf8'),
        'inventory.csv'
    );
    assert.match(result.errors[0], /purchase_cost/);
    assert.equal(result.rows.length, 0);
});
