const { spawn } = require('child_process');
const path = require('path');

const HOST = 'http://localhost';
const PORT = 4001;
const BASE = `${HOST}:${PORT}`;
const ADMIN_ID = process.env.TEST_ADMIN_ID || '101';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  throw new Error('Set TEST_ADMIN_PASSWORD before running this test.');
}

const cookieJar = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setCookieFromResponse(response) {
  const raw = response.headers.get('set-cookie');
  if (!raw) return;
  const parts = Array.isArray(raw) ? raw : [raw];
  for (const entry of parts) {
    const [cookiePart] = entry.split(';');
    const [name, ...rest] = cookiePart.split('=');
    if (!name || !rest.length) continue;
    cookieJar.set(name.trim(), rest.join('=').trim());
  }
}

function buildCookieHeader() {
  if (!cookieJar.size) return '';
  return Array.from(cookieJar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function request(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  const cookieHeader = buildCookieHeader();
  if (cookieHeader) headers.Cookie = cookieHeader;

  const response = await fetch(url, {
    method,
    headers,
    body: options.body,
    redirect: options.redirect || 'manual',
  });

  setCookieFromResponse(response);
  return response;
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/adminlogin.html`, { redirect: 'manual' });
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

  results.push(await runSingleCheck('Admin login page loads', async () => {
    const res = await request(`${BASE}/adminlogin.html`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const text = await res.text();
    if (!text.includes('login')) throw new Error('Login page HTML did not load correctly');
  }));

  results.push(await runSingleCheck('Admin login works', async () => {
    const formBody = `id=${encodeURIComponent(ADMIN_ID)}&password=${encodeURIComponent(ADMIN_PASSWORD)}`;
    const res = await request(`${BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
      redirect: 'manual',
    });

    if (res.status !== 302 && res.status !== 200) {
      throw new Error(`Expected redirect/login success, got ${res.status}`);
    }

    const cookieHeader = buildCookieHeader();
    if (!cookieHeader.includes('token=')) {
      throw new Error('Login did not set auth cookie');
    }
  }));

  results.push(await runSingleCheck('Dashboard loads with auth', async () => {
    const res = await request(`${BASE}/dashboard.html`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const text = await res.text();
    if (!text.includes('Inventory Management')) throw new Error('Dashboard HTML not served');
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
  results.push(await runSingleCheck('Create product works', async () => {
    const payload = { name: 'QA Test Product', price: 11.25, unit: unitName, category: categoryName, stock: 12, low_stock_threshold: 5 };
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
    if (!product || product.category !== updatedCategoryName || Number(product.price) !== 11.25) {
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

  results.push(await runSingleCheck('Audit log endpoint works', async () => {
    const res = await request(`${BASE}/api/audit/stock?limit=10`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Audit log response is not an array');
  }));

  results.push(await runSingleCheck('Unauthenticated API is blocked', async () => {
    const jar = new Map();
    const noAuthResponse = await fetch(`${BASE}/api/products`, { redirect: 'manual' });
    if (noAuthResponse.status !== 401) {
      throw new Error(`Expected 401, got ${noAuthResponse.status}`);
    }
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
