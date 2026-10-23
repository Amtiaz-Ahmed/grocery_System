'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { tableNamesFromRows } = require('./scheduled_jobs');

test('reads table names from MySQL SHOW FULL TABLES rows', () => {
    assert.deepEqual(tableNamesFromRows([
        { Tables_in_grocery_db: 'products', Table_type: 'BASE TABLE' },
        { Tables_in_grocery_db: 'orders', Table_type: 'BASE TABLE' },
    ]), ['products', 'orders']);
});

test('reads view names and ignores rows without a table name', () => {
    assert.deepEqual(tableNamesFromRows([
        { Tables_in_grocery_db: 'sales_summary', Table_type: 'VIEW' },
        { Table_type: 'VIEW' },
    ]), ['sales_summary']);
});
