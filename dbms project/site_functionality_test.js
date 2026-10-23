const { spawn } = require('child_process');
const path = require('path');

const HOST = 'http://localhost';
const PORT = 4001;
const BASE = `${HOST}:${PORT}`;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  return fetch(url, {
    method,
    headers,
    body: options.body,
    redirect: options.redirect || 'manual',
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`, { redirect: 'manual' });
      if (res.status < 500) return true;
    } catch (err) {
      // server not ready yet
    }
    await sleep(500);
  }
  throw new Error('Server did not become ready on time.');
}

function ensureAppServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT), DB_HOST: process.env.DB_HOST || 'localhost', DB_USER: process.env.DB_USER || 'root', DB_PASSWORD: process.env.DB_PASSWORD || '', DB_NAME: process.env.DB_NAME || 'grocery_db' };
    const child = spawn(process.execPath, ['index_admin.js'], {
      cwd: __dirname,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes('Inventory server running on port')) {
        resolve(child);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (code !== 0 && !output.includes('Inventory server running on port')) {
        reject(new Error(`Server exited early with code ${code}. Output:\n${output}`));
      }
    });

    setTimeout(() => {
      if (!child.killed && output.includes('Inventory server running on port')) return;
      if (!child.killed && output.length > 0) {
        resolve(child);
      }
    }, 5000);
  });
}

async function runSingleCheck(name, fn) {
  try {
    const result = await fn();
    console.log(`PASS - ${name}`);
    return { name, passed: true, result };
  } catch (err) {
    console.log(`FAIL - ${name}`);
    console.log(`  ${err.message}`);
    return { name, passed: false, error: err.message };
  }
}

async function main() {
  const server = await ensureAppServer();
  await waitForServer();

  const results = [];

  results.push(await runSingleCheck('Home route opens the dashboard', async () => {
    const res = await request(`${BASE}/`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const page = await res.text();
    if (!page.includes('Inventory Management')) throw new Error('Dashboard did not load');
  }));

  results.push(await runSingleCheck('Dashboard file loads directly', async () => {
    const res = await request(`${BASE}/dashboard.html`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const page = await res.text();
    if (!page.includes('Inventory Management')) throw new Error('Dashboard HTML not served');
  }));

  results.push(await runSingleCheck('Units API returns valid units', async () => {
    const res = await request(`${BASE}/api/units`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('Units list is empty');
  }));

  const unitName = `u${Date.now().toString().slice(-8)}`;
  let unitId = null;
  let updatedUnitName = null;
  results.push(await runSingleCheck('Create unit works', async () => {
    const res = await request(`${BASE}/api/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: unitName }),
    });
    const data = await res.json();
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}. Body: ${JSON.stringify(data)}`);
    unitId = data.id;
    if (!unitId || data.name !== unitName) throw new Error('Unit create response is invalid');
  }));

  results.push(await runSingleCheck('Products API returns a list', async () => {
    const res = await request(`${BASE}/api/products`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Products response is not an array');
  }));

  const categoryName = `QA Category ${Date.now()}`;
  let categoryId = null;
  let updatedCategoryName = null;
  results.push(await runSingleCheck('Create category works', async () => {
    const res = await request(`${BASE}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: categoryName }),
    });
    const data = await res.json();
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}. Body: ${JSON.stringify(data)}`);
    categoryId = data.id;
    if (!categoryId) throw new Error('Category create response missing id');
  }));

  results.push(await runSingleCheck('Invalid product data is rejected', async () => {
    const payload = { name: 'Tom+Tom', price: 10.5, unit: 'kg', category: 'Test', stock: 5, low_stock_threshold: 2 };
    const res = await request(`${BASE}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status !== 400) {
      const text = await res.text();
      throw new Error(`Expected 400, got ${res.status}. Body: ${text}`);
    }
  }));

  let createdId = null;
  let bulkProductId = null;
  results.push(await runSingleCheck('Create product works', async () => {
    const payload = { name: 'QA Test Product', price: 11.25, cost_price: 8.5, unit: unitName, category: categoryName, stock: 12, low_stock_threshold: 5 };
    const res = await request(`${BASE}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}. Body: ${text}`);
    const data = JSON.parse(text);
    if (!data.id) throw new Error('Product create response missing id');
    createdId = data.id;
  }));

  results.push(await runSingleCheck('Inventory upload templates are available', async () => {
    const csvResponse = await request(`${BASE}/api/products/import-template?format=csv`);
    if (csvResponse.status !== 200 || !(await csvResponse.text()).includes('purchase_cost')) {
      throw new Error('CSV template is missing purchase cost headers');
    }
    const excelResponse = await request(`${BASE}/api/products/import-template?format=xlsx`);
    if (excelResponse.status !== 200 || !excelResponse.headers.get('content-type')?.includes('spreadsheetml')) {
      throw new Error(`Excel template request failed with status ${excelResponse.status}`);
    }
  }));

  results.push(await runSingleCheck('Bulk upload adds stock and recalculates weighted cost', async () => {
    const bulkProductName = `QA Bulk Product ${Date.now()}`;
    const uploadCsv = async (quantity, purchaseCost) => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([
          `name,category,selling_price,purchase_cost,unit,stock,low_stock_threshold\n${bulkProductName},${categoryName},20,${purchaseCost},${unitName},${quantity},2\n`,
        ], { type: 'text/csv' }),
        'inventory.csv'
      );
      const response = await request(`${BASE}/api/products/import`, { method: 'POST', body: form });
      const text = await response.text();
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}. Body: ${text}`);
    };

    await uploadCsv(4, 10);
    let productsResponse = await request(`${BASE}/api/products`);
    let product = (await productsResponse.json()).find((item) => item.name === bulkProductName);
    if (!product) throw new Error('Bulk upload did not create a product');
    bulkProductId = product.id;

    await uploadCsv(3, 14);
    productsResponse = await request(`${BASE}/api/products`);
    product = (await productsResponse.json()).find((item) => String(item.id) === String(bulkProductId));
    if (!product || Number(product.stock) !== 7 || Number(product.cost_price) !== 11.71) {
      throw new Error(`Unexpected stock or weighted cost: ${JSON.stringify(product)}`);
    }
    const auditResponse = await request(`${BASE}/api/audit/stock?limit=100`);
    const auditRows = await auditResponse.json();
    const latestReceipt = auditRows.find((row) => String(row.product_id) === String(bulkProductId) && row.reason === 'restock');
    if (!latestReceipt || Number(latestReceipt.purchase_unit_cost) !== 14) {
      throw new Error('Bulk restock purchase cost was not saved in the inventory audit');
    }
  }));

  results.push(await runSingleCheck('Update category renames associated products', async () => {
    if (!categoryId || !createdId) throw new Error('Category or product was not created');
    updatedCategoryName = `${categoryName} Updated`;
    const res = await request(`${BASE}/api/categories/${categoryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: updatedCategoryName }),
    });
    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`Expected 200, got ${res.status}. Body: ${text}`);
    }
    const productsResponse = await request(`${BASE}/api/products`);
    const products = await productsResponse.json();
    const product = products.find((item) => String(item.id) === String(createdId));
    if (!product || product.category !== updatedCategoryName || Number(product.price) !== 11.25 || Number(product.cost_price) !== 8.5) {
      throw new Error('Renaming the category or storing decimal prices did not update the test product');
    }
  }));

  results.push(await runSingleCheck('Update unit renames associated products', async () => {
    if (!unitId || !createdId) throw new Error('Unit or product was not created');
    updatedUnitName = `r${Date.now().toString().slice(-8)}`;
    const res = await request(`${BASE}/api/units/${unitId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: updatedUnitName }),
    });
    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`Expected 200, got ${res.status}. Body: ${text}`);
    }
    const productsResponse = await request(`${BASE}/api/products`);
    const products = await productsResponse.json();
    const product = products.find((item) => String(item.id) === String(createdId));
    if (!product || product.unit !== updatedUnitName) throw new Error('Renaming the unit did not update the test product');
  }));

  results.push(await runSingleCheck('Update product works', async () => {
    if (!createdId) throw new Error('No created product id for update test');
    const payload = { name: 'QA Test Product Updated', price: 14.75, unit: updatedUnitName, category: updatedCategoryName, stock: 20, low_stock_threshold: 7 };
    const res = await request(`${BASE}/api/products/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}. Body: ${text}`);
  }));

  results.push(await runSingleCheck('Unit deletion is blocked while products use it', async () => {
    if (!unitId) throw new Error('Unit was not created');
    const res = await request(`${BASE}/api/units/${unitId}`, { method: 'DELETE' });
    if (res.status !== 409) {
      const text = await res.text();
      throw new Error(`Expected 409, got ${res.status}. Body: ${text}`);
    }
  }));

  results.push(await runSingleCheck('Category deletion is blocked while products use it', async () => {
    if (!categoryId || !createdId) throw new Error('Category or product was not created');
    const res = await request(`${BASE}/api/categories/${categoryId}`, { method: 'DELETE' });
    if (res.status !== 409) {
      const text = await res.text();
      throw new Error(`Expected 409, got ${res.status}. Body: ${text}`);
    }
  }));

  results.push(await runSingleCheck('Stock adjustment works', async () => {
    if (!createdId) throw new Error('No created product id for stock test');
    const payload = { stockChange: 3, note: 'QA restock' };
    const res = await request(`${BASE}/api/products/${createdId}/stock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}. Body: ${text}`);
    const data = JSON.parse(text);
    if (typeof data.stock !== 'number') throw new Error('Stock update response missing stock value');
  }));

  results.push(await runSingleCheck('Summary endpoint works', async () => {
    const res = await request(`${BASE}/api/reports/summary`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (typeof data.total_sales === 'undefined') throw new Error('Summary missing total_sales');
  }));

  results.push(await runSingleCheck('Monthly profit report includes tracked costs', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const res = await request(`${BASE}/api/reports/profit?month=${month}`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!data.summary || typeof data.summary.cost_of_goods_sold === 'undefined' || !Array.isArray(data.products)) {
      throw new Error('Profit report response is missing cost or product data');
    }
  }));

  results.push(await runSingleCheck('Audit log endpoint works', async () => {
    const res = await request(`${BASE}/api/audit/stock?limit=10`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Audit log response is not an array');
  }));

  results.push(await runSingleCheck('API works without a login', async () => {
    const response = await fetch(`${BASE}/api/products`, { redirect: 'manual' });
    if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
  }));

  if (createdId) {
    results.push(await runSingleCheck('Cleanup deletes the test product', async () => {
      const res = await request(`${BASE}/api/products/${createdId}`, { method: 'DELETE' });
      if (res.status !== 200) {
        const text = await res.text();
        throw new Error(`Expected 200, got ${res.status}. Body: ${text}`);
      }
    }));
  }

  if (bulkProductId) {
    results.push(await runSingleCheck('Cleanup deletes the bulk-imported product', async () => {
      const res = await request(`${BASE}/api/products/${bulkProductId}`, { method: 'DELETE' });
      if (res.status !== 200) {
        const text = await res.text();
        throw new Error(`Expected 200, got ${res.status}. Body: ${text}`);
      }
    }));
  }

  if (unitId) {
    results.push(await runSingleCheck('Cleanup deletes the test unit', async () => {
      const res = await request(`${BASE}/api/units/${unitId}`, { method: 'DELETE' });
      if (res.status !== 200) {
        const text = await res.text();
        throw new Error(`Expected 200, got ${res.status}. Body: ${text}`);
      }
    }));
  }

  if (categoryId) {
    results.push(await runSingleCheck('Cleanup deletes the test category', async () => {
      const res = await request(`${BASE}/api/categories/${categoryId}`, { method: 'DELETE' });
      if (res.status !== 200) {
        const text = await res.text();
        throw new Error(`Expected 200, got ${res.status}. Body: ${text}`);
      }
    }));
  }

  const failed = results.filter((r) => !r.passed);
  console.log('\n=== TEST SUMMARY ===');
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('Failed checks:');
    failed.forEach((item) => console.log(`- ${item.name}: ${item.error}`));
    process.exitCode = 1;
  } else {
    console.log('All checks passed.');
  }

  server.kill('SIGTERM');
}

main().catch((err) => {
  console.error('Unhandled test runner failure:', err);
  process.exit(1);
});
