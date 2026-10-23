const navButtons = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');

const inventoryTableBody = document.getElementById('inventory-table-body');
const auditTableBody = document.getElementById('audit-table-body');
const ordersTableBody = document.getElementById('orders-table-body');
const productForm = document.getElementById('product-form');
const productUnitSelect = document.getElementById('product-unit');
const productCostInput = document.getElementById('product-cost');
const newUnitInput = document.getElementById('new-unit');
const addUnitBtn = document.getElementById('add-unit-btn');
const updateUnitBtn = document.getElementById('update-unit-btn');
const deleteUnitBtn = document.getElementById('delete-unit-btn');
const productCategorySelect = document.getElementById('product-category');
const productEditId = document.getElementById('product-edit-id');
const productCancelEdit = document.getElementById('product-cancel-edit');
const productSubmitBtn = document.getElementById('product-submit-btn');
const inventorySearchInput = document.getElementById('inventory-search');
const orderSearchInput = document.getElementById('orderSearch');
const newCategoryInput = document.getElementById('new-category');
const addCategoryBtn = document.getElementById('add-category-btn');
const updateCategoryBtn = document.getElementById('update-category-btn');
const deleteCategoryBtn = document.getElementById('delete-category-btn');
const orderBuyerNameInput = document.getElementById('order-buyer-name');
const orderProductSelect = document.getElementById('order-product-select');
const orderProductGrid = document.getElementById('order-product-grid');
const orderProductSearchInput = document.getElementById('order-product-search');
const orderQtyInput = document.getElementById('order-qty');
const orderItemsBody = document.getElementById('order-items-body');
const addOrderItemBtn = document.getElementById('add-order-item-btn');
const createOrderBtn = document.getElementById('create-order-btn');
const orderTotalAmount = document.getElementById('order-total-amount');
const orderDateFromInput = document.getElementById('order-date-from');
const orderDateToInput = document.getElementById('order-date-to');
const orderMonthFilterInput = document.getElementById('order-month-filter');
const clearOrderFiltersBtn = document.getElementById('clear-order-filters-btn');
const orderDetailsModal = document.getElementById('order-details-modal');
const orderDetailsContent = document.getElementById('order-details-content');
const closeOrderDetailsBtn = document.getElementById('close-order-details');
const auditSearchInput = document.getElementById('audit-search');
const auditReasonFilter = document.getElementById('audit-reason-filter');
const auditMonthFilter = document.getElementById('audit-month-filter');
const auditDownloadBtn = document.getElementById('download-audit-btn');
const salesDownloadBtn = document.getElementById('download-sales-btn');
const auditMonthlySummary = document.getElementById('audit-monthly-summary');
const profitMonthFilter = document.getElementById('profit-month-filter');
const inventoryImportFile = document.getElementById('inventory-import-file');
const inventoryImportBtn = document.getElementById('inventory-import-btn');
const inventoryImportStatus = document.getElementById('inventory-import-status');

let allProducts = [];
let allOrders = [];
let inventoryState = { page: 1, rowsPerPage: 8 };
let ordersState = { page: 1, rowsPerPage: 8 };
let auditState = { page: 1, rowsPerPage: 10 };
let categoryList = [];
let unitList = [];
let orderCart = [];

async function apiFetch(url, options = {}) {
    return fetch(url, options);
}

document.addEventListener('DOMContentLoaded', () => {
    if (profitMonthFilter && !profitMonthFilter.value) {
        const now = new Date();
        profitMonthFilter.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    loadUnits();
    loadProducts();
    loadSummary();
    loadProfitReport();
    loadStock();
    loadAudit();
    setupEventListeners();
    switchPage('overview');
});

function setupEventListeners() {
    navButtons.forEach((button) => {
        button.addEventListener('click', () => switchPage(button.dataset.page));
    });

    if (productForm) productForm.addEventListener('submit', handleProductSubmit);
    if (productCancelEdit) productCancelEdit.addEventListener('click', resetProductForm);
    if (addCategoryBtn) addCategoryBtn.addEventListener('click', addCategoryFromInput);
    if (updateCategoryBtn) updateCategoryBtn.addEventListener('click', updateCategoryFromInput);
    if (deleteCategoryBtn) deleteCategoryBtn.addEventListener('click', deleteSelectedCategory);
    if (productCategorySelect) productCategorySelect.addEventListener('change', updateCategoryControls);
    if (addUnitBtn) addUnitBtn.addEventListener('click', addUnitFromInput);
    if (updateUnitBtn) updateUnitBtn.addEventListener('click', updateUnitFromInput);
    if (deleteUnitBtn) deleteUnitBtn.addEventListener('click', deleteSelectedUnit);
    if (productUnitSelect) productUnitSelect.addEventListener('change', updateUnitControls);
    if (inventorySearchInput) inventorySearchInput.addEventListener('input', () => {
        inventoryState.page = 1;
        renderInventoryTable(allProducts);
    });
    if (orderSearchInput) orderSearchInput.addEventListener('input', searchOrders);
    if (orderProductSearchInput) orderProductSearchInput.addEventListener('input', () => renderOrderProductGrid());
    if (orderDateFromInput) orderDateFromInput.addEventListener('input', () => { ordersState.page = 1; renderOrders(); });
    if (orderDateToInput) orderDateToInput.addEventListener('input', () => { ordersState.page = 1; renderOrders(); });
    if (orderMonthFilterInput) orderMonthFilterInput.addEventListener('input', () => { ordersState.page = 1; renderOrders(); });
    if (clearOrderFiltersBtn) clearOrderFiltersBtn.addEventListener('click', () => {
        if (orderDateFromInput) orderDateFromInput.value = '';
        if (orderDateToInput) orderDateToInput.value = '';
        if (orderMonthFilterInput) orderMonthFilterInput.value = '';
        ordersState.page = 1;
        renderOrders();
    });
    if (addOrderItemBtn) addOrderItemBtn.addEventListener('click', () => addOrderItemToCart());
    if (createOrderBtn) createOrderBtn.addEventListener('click', createSalesOrder);
    if (closeOrderDetailsBtn) closeOrderDetailsBtn.addEventListener('click', () => {
        if (orderDetailsModal) orderDetailsModal.style.display = 'none';
    });
    if (orderDetailsModal) orderDetailsModal.addEventListener('click', (event) => {
        if (event.target === orderDetailsModal) orderDetailsModal.style.display = 'none';
    });
    if (auditSearchInput) auditSearchInput.addEventListener('input', () => {
        auditState.page = 1;
        renderAuditTable();
    });
    if (auditReasonFilter) auditReasonFilter.addEventListener('change', () => {
        auditState.page = 1;
        renderAuditTable();
    });
    if (auditMonthFilter) auditMonthFilter.addEventListener('input', () => {
        auditState.page = 1;
        renderAuditTable();
    });
    if (auditDownloadBtn) auditDownloadBtn.addEventListener('click', exportAuditCsv);
    if (salesDownloadBtn) salesDownloadBtn.addEventListener('click', exportSalesCsv);
    if (profitMonthFilter) profitMonthFilter.addEventListener('change', () => loadProfitReport());
    if (inventoryImportBtn) inventoryImportBtn.addEventListener('click', importInventoryFile);
}

function switchPage(pageId) {
    pages.forEach((p) => { p.style.display = 'none'; p.classList.remove('active'); });
    navButtons.forEach((b) => b.classList.remove('active'));
    const page = document.getElementById(`${pageId}-page`);
    if (page) {
        page.style.display = 'block';
        page.classList.add('active');
    }
    const navBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
    if (navBtn) navBtn.classList.add('active');

    if (pageId === 'overview') {
        loadSummary();
        loadProfitReport();
    }
    if (pageId === 'inventory') { loadProducts(); loadUnits(); }
    if (pageId === 'orders') { loadOrders(); }
    if (pageId === 'audit') loadAudit();
}

async function loadUnits() {
    try {
        const res = await apiFetch('/api/units');
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'Failed to load units');
        }
        const units = await res.json();
        const selected = productUnitSelect?.value;
        unitList = units;
        refreshUnitList(selected);
    } catch (error) {
        console.error(error);
        alert(error.message || 'Failed to load units.');
    }
}

function refreshUnitList(selectedName) {
    if (!productUnitSelect) return;
    const current = selectedName || productUnitSelect.value;
    productUnitSelect.innerHTML = '<option value="">Choose a unit</option>' + unitList
        .map((unit) => `<option value="${escapeHtml(unit.name)}">${escapeHtml(unit.name)}</option>`)
        .join('');
    if (unitList.some((unit) => unit.name === current)) productUnitSelect.value = current;
    updateUnitControls();
}

function updateUnitControls() {
    const selectedUnit = unitList.find((unit) => unit.name === productUnitSelect?.value);
    if (updateUnitBtn) updateUnitBtn.disabled = !selectedUnit;
    if (deleteUnitBtn) deleteUnitBtn.disabled = !selectedUnit;
}

async function createUnit(name) {
    const clean = name.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!clean) throw new Error('Enter a unit name.');
    const existing = unitList.find((unit) => unit.name.toLowerCase() === clean);
    if (existing) {
        productUnitSelect.value = existing.name;
        return existing;
    }
    const response = await apiFetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to add unit');
    unitList.push(data);
    unitList.sort((a, b) => a.name.localeCompare(b.name));
    refreshUnitList(data.name);
    return data;
}

async function addUnitFromInput() {
    const value = (newUnitInput?.value || '').trim();
    if (!value) return;
    try {
        await createUnit(value);
        newUnitInput.value = '';
    } catch (error) {
        alert(error.message);
    }
}

async function updateUnitFromInput() {
    const selectedUnit = unitList.find((unit) => unit.name === productUnitSelect?.value);
    const name = (newUnitInput?.value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!selectedUnit || !name) {
        alert('Choose a unit and enter its new name.');
        return;
    }
    try {
        const response = await apiFetch(`/api/units/${selectedUnit.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to update unit');
        if (newUnitInput) newUnitInput.value = '';
        await loadUnits();
        if (productUnitSelect) productUnitSelect.value = data.name;
        updateUnitControls();
        await loadProducts();
    } catch (error) {
        alert(error.message);
    }
}

async function deleteSelectedUnit() {
    const selectedUnit = unitList.find((unit) => unit.name === productUnitSelect?.value);
    if (!selectedUnit || !window.confirm(`Delete unit "${selectedUnit.name}"?`)) return;
    try {
        const response = await apiFetch(`/api/units/${selectedUnit.id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to delete unit');
        if (newUnitInput) newUnitInput.value = '';
        await loadUnits();
    } catch (error) {
        alert(error.message);
    }
}

async function loadSummary() {
    try {
        const res = await apiFetch('/api/reports/summary');
        const data = await res.json();
        document.getElementById('stat-sales').textContent = `Rs. ${parseFloat(data.total_sales).toFixed(2)}`;
        document.getElementById('stat-orders').textContent = data.order_count;
        document.getElementById('stat-products').textContent = data.product_count;
        document.getElementById('stat-low').textContent = data.low_stock_count;
    } catch (e) {
        console.error(e);
    }
}

async function loadProfitReport() {
    const note = document.getElementById('profit-report-note');
    const month = profitMonthFilter?.value || '';
    const query = month ? `?month=${encodeURIComponent(month)}` : '';
    try {
        const response = await apiFetch(`/api/reports/profit${query}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to load profit report.');

        const summary = data.summary;
        document.getElementById('profit-sales').textContent = `Rs. ${formatPrice(summary.total_sales)}`;
        document.getElementById('profit-tracked-sales').textContent = `Rs. ${formatPrice(summary.tracked_sales)}`;
        document.getElementById('profit-cogs').textContent = `Rs. ${formatPrice(summary.cost_of_goods_sold)}`;
        document.getElementById('profit-gross').textContent = summary.gross_profit === null
            ? '—'
            : `Rs. ${formatPrice(summary.gross_profit)}`;
        document.getElementById('profit-roi').textContent = summary.roi_percent === null
            ? '—'
            : `${Number(summary.roi_percent).toFixed(2)}%`;

        if (note) {
            note.textContent = Number(summary.uncosted_sales) > 0
                ? `Profit and ROI only include sales with a recorded purchase cost. Rs. ${formatPrice(summary.uncosted_sales)} in sales have no cost recorded and are excluded.`
                : 'Gross profit is tracked sales minus cost of goods sold. ROI is gross profit divided by tracked cost.';
        }

        const productBody = document.getElementById('profit-products-body');
        if (productBody) {
            productBody.innerHTML = data.products.length
                ? data.products.map((product) => `
                    <tr>
                        <td>${escapeHtml(product.product_name)}</td>
                        <td>${formatPrice(product.quantity_sold)} ${escapeHtml(product.unit)}</td>
                        <td>Rs. ${formatPrice(product.total_sales)}</td>
                        <td>${product.tracked_lines ? `Rs. ${formatPrice(product.cost_of_goods_sold)}` : '—'}</td>
                        <td>${product.gross_profit === null ? '—' : `Rs. ${formatPrice(product.gross_profit)}`}</td>
                        <td>${product.roi_percent === null ? '—' : `${Number(product.roi_percent).toFixed(2)}%`}</td>
                    </tr>
                `).join('')
                : '<tr><td colspan="6" class="muted-text">No sales recorded for this month.</td></tr>';
        }
    } catch (error) {
        console.error(error);
        if (note) note.textContent = error.message || 'Failed to load profit report.';
    }
}

async function importInventoryFile() {
    const file = inventoryImportFile?.files?.[0];
    if (!file) {
        if (inventoryImportStatus) inventoryImportStatus.textContent = 'Choose a CSV or XLSX file first.';
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    inventoryImportBtn.disabled = true;
    if (inventoryImportStatus) inventoryImportStatus.textContent = 'Importing inventory...';
    try {
        const response = await apiFetch('/api/products/import', { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok) {
            const details = Array.isArray(result.errors) ? ` ${result.errors.join(' ')}` : '';
            throw new Error(`${result.message || 'Inventory import failed.'}${details}`);
        }

        if (inventoryImportStatus) {
            inventoryImportStatus.textContent = `${result.total} rows imported: ${result.created} new products and ${result.updated} existing products restocked.`;
        }
        inventoryImportFile.value = '';
        await Promise.all([loadProducts(), loadStock(), loadSummary(), loadAudit(), loadProfitReport()]);
    } catch (error) {
        if (inventoryImportStatus) inventoryImportStatus.textContent = error.message || 'Inventory import failed.';
    } finally {
        inventoryImportBtn.disabled = false;
    }
}

async function loadProducts() {
    try {
        const response = await apiFetch('/api/products');
        if (!response.ok) throw new Error('Failed to fetch products');
        allProducts = await response.json();
        await loadCategories();
        refreshCategoryList();
        renderInventoryTable(allProducts);
        populateOrderProductSelect();
    } catch (error) {
        console.error(error);
        alert('Failed to load products.');
    }
}

function getAvailableProductsForSale() {
    return allProducts.filter((product) => Number(product.stock) > 0);
}

function populateOrderProductSelect() {
    const availableProducts = getAvailableProductsForSale();
    renderOrderProductGrid(availableProducts);

    if (!orderProductSelect) return;
    if (!availableProducts.length) {
        orderProductSelect.innerHTML = '<option value="">No products available</option>';
        return;
    }
    orderProductSelect.innerHTML = availableProducts.map((product) => `
        <option value="${product.id}">${escapeHtml(product.name)} (${escapeHtml(product.unit)}) - Rs. ${formatPrice(product.price)} - ${product.stock} left</option>
    `).join('');
}

function renderOrderProductGrid(products = getAvailableProductsForSale()) {
    if (!orderProductGrid) return;
    const filtered = (orderProductSearchInput?.value || '').trim().toLowerCase()
        ? products.filter((product) => `${product.name} ${product.category} ${product.unit}`.toLowerCase().includes((orderProductSearchInput?.value || '').trim().toLowerCase()))
        : products;

    if (!filtered.length) {
        orderProductGrid.innerHTML = '<div class="empty-product-card">No products available for sale.</div>';
        return;
    }

    orderProductGrid.innerHTML = filtered.map((product) => `
        <button type="button" class="product-card" data-product-id="${product.id}">
            <span class="product-card-name">${escapeHtml(product.name)}</span>
            <span class="product-card-meta">${escapeHtml(product.category)}</span>
            <span class="product-card-meta">${escapeHtml(product.unit)}</span>
            <span class="product-card-price">Rs. ${formatPrice(product.price)}</span>
            <span class="product-card-stock">Stock: ${product.stock}</span>
        </button>
    `).join('');

    orderProductGrid.querySelectorAll('.product-card').forEach((card) => {
        card.addEventListener('click', () => addOrderItemToCart(card.dataset.productId));
    });
}

function addOrderItemToCart(productIdOverride) {
    if (!orderQtyInput || !orderItemsBody) return;
    const selectedProductId = productIdOverride ?? orderProductSelect?.value;
    const qty = Number(orderQtyInput.value);
    if (!selectedProductId || !Number.isFinite(qty) || qty <= 0) {
        return;
    }

    const product = allProducts.find((item) => String(item.id) === String(selectedProductId));
    if (!product || Number(product.stock) <= 0) return;

    const existingItem = orderCart.find((item) => String(item.product_id) === String(selectedProductId));
    const updatedQuantity = (existingItem?.quantity || 0) + qty;
    if (updatedQuantity > Number(product.stock)) {
        alert(`Only ${product.stock} ${product.unit} in stock for ${product.name}.`);
        return;
    }

    if (existingItem) {
        existingItem.quantity = updatedQuantity;
    } else {
        orderCart.push({
            product_id: product.id,
            name: product.name,
            price: Number(product.price),
            unit: product.unit,
            quantity: qty,
        });
    }

    renderOrderCart();
    orderQtyInput.value = '1';
}

function renderOrderCart() {
    if (!orderItemsBody) return;
    if (!orderCart.length) {
        orderItemsBody.innerHTML = '<tr><td colspan="5">No items added yet</td></tr>';
        if (orderTotalAmount) orderTotalAmount.textContent = 'Rs. 0.00';
        return;
    }

    let total = 0;
    orderItemsBody.innerHTML = orderCart.map((item) => {
        const lineTotal = item.price * item.quantity;
        total += lineTotal;
        return `
            <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>
                    <input
                        type="number"
                        class="order-item-quantity"
                        data-product-id="${item.product_id}"
                        value="${item.quantity}"
                        min="0.01"
                        max="${Number(allProducts.find((product) => String(product.id) === String(item.product_id))?.stock || 0)}"
                        step="0.01"
                        aria-label="Quantity for ${escapeHtml(item.name)}"
                    >
                    ${escapeHtml(item.unit)}
                </td>
                <td>Rs. ${formatPrice(item.price)}</td>
                <td>Rs. ${formatPrice(lineTotal)}</td>
                <td><button type="button" class="btn-secondary" data-remove-product="${item.product_id}">Remove</button></td>
            </tr>
        `;
    }).join('');

    if (orderTotalAmount) orderTotalAmount.textContent = `Rs. ${formatPrice(total)}`;
    orderItemsBody.querySelectorAll('.order-item-quantity').forEach((input) => {
        input.addEventListener('change', () => updateOrderItemQuantity(input));
    });
    orderItemsBody.querySelectorAll('[data-remove-product]').forEach((button) => {
        button.addEventListener('click', () => {
            const id = button.dataset.removeProduct;
            orderCart = orderCart.filter((item) => String(item.product_id) !== String(id));
            renderOrderCart();
        });
    });
}

function updateOrderItemQuantity(input) {
    const productId = input.dataset.productId;
    const item = orderCart.find((cartItem) => String(cartItem.product_id) === String(productId));
    const product = allProducts.find((productItem) => String(productItem.id) === String(productId));
    if (!item || !product) return;

    const quantity = Number(input.value);
    const availableStock = Number(product.stock);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        alert('Quantity must be greater than zero.');
        renderOrderCart();
        return;
    }
    if (quantity > availableStock) {
        alert(`Only ${product.stock} ${product.unit} in stock for ${product.name}.`);
        renderOrderCart();
        return;
    }

    item.quantity = quantity;
    renderOrderCart();
}

async function createSalesOrder() {
    if (!orderCart.length) {
        return;
    }

    const total = orderCart.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
    const autoBuyerName = `User-${new Date().getTime().toString().slice(-6)}`;
    const payload = {
        buyer_name: (orderBuyerNameInput?.value || '').trim() || autoBuyerName,
        total,
        items: orderCart.map((item) => ({
            product_id: item.product_id,
            name: item.name,
            quantity: Number(item.quantity),
            price: Number(item.price),
        })),
    };

    try {
        const res = await apiFetch('/api/orders/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to create order');
        orderCart = [];
        renderOrderCart();
        if (orderBuyerNameInput) orderBuyerNameInput.value = '';
        loadProducts();
        loadStock();
        loadOrders();
        loadSummary();
        loadProfitReport();
        loadAudit();
    } catch (error) {
        console.error(error);
    }
}

async function loadCategories(selectedName) {
    const response = await apiFetch('/api/categories');
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch categories');
    }
    categoryList = await response.json();
    categoryList.sort((a, b) => a.name.localeCompare(b.name));
    refreshCategoryList(selectedName);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character]);
}

function refreshCategoryList(selectedName) {
    if (!productCategorySelect) return;
    const current = selectedName || productCategorySelect.value;
    productCategorySelect.innerHTML = '<option value="">Choose a category</option>' + categoryList
        .map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`)
        .join('');
    if (categoryList.some((category) => category.name === current)) {
        productCategorySelect.value = current;
    }
    updateCategoryControls();
}

async function createCategory(name) {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) throw new Error('Enter a category name.');
    const existing = categoryList.find((category) => category.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
        productCategorySelect.value = existing.name;
        return existing;
    }

    const response = await apiFetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to add category');
    categoryList.push(data);
    categoryList.sort((a, b) => a.name.localeCompare(b.name));
    refreshCategoryList(data.name);
    return data;
}

async function addCategoryFromInput() {
    const value = (newCategoryInput?.value || '').trim();
    if (!value) return;
    try {
        await createCategory(value);
        newCategoryInput.value = '';
    } catch (error) {
        alert(error.message);
    }
}

function updateCategoryControls() {
    const selectedCategory = categoryList.find((category) => category.name === productCategorySelect?.value);
    if (updateCategoryBtn) updateCategoryBtn.disabled = !selectedCategory || !selectedCategory.id;
    if (deleteCategoryBtn) deleteCategoryBtn.disabled = !selectedCategory || !selectedCategory.id;
}

async function updateCategoryFromInput() {
    const selectedCategory = categoryList.find((category) => category.name === productCategorySelect?.value);
    const name = (newCategoryInput?.value || '').trim().replace(/\s+/g, ' ');
    if (!selectedCategory || !name) {
        alert('Choose a category and enter its new name.');
        return;
    }
    try {
        const response = await apiFetch(`/api/categories/${selectedCategory.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to update category');
        if (newCategoryInput) newCategoryInput.value = '';
        await loadProducts();
        if (productCategorySelect) productCategorySelect.value = data.name;
        updateCategoryControls();
    } catch (error) {
        alert(error.message);
    }
}

async function deleteSelectedCategory() {
    const selectedCategory = categoryList.find((category) => category.name === productCategorySelect?.value);
    if (!selectedCategory || !window.confirm(`Delete category "${selectedCategory.name}"?`)) return;
    try {
        const response = await apiFetch(`/api/categories/${selectedCategory.id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to delete category');
        if (newCategoryInput) newCategoryInput.value = '';
        await loadCategories();
    } catch (error) {
        alert(error.message);
    }
}

function formatPrice(price) {
    return parseFloat(price).toFixed(2);
}

function validateProductInput(name, price) {
    const cleanName = String(name || '').trim();
    if (!cleanName) {
        throw new Error('Product name is required.');
    }
    if (/[+]/.test(cleanName)) {
        throw new Error('Product name cannot contain a + sign.');
    }

    const priceText = String(price ?? '').trim();
    const normalizedPrice = Number(priceText);
    if (!/^\d+(?:\.\d{1,2})?$/.test(priceText) || !Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
        throw new Error('Price must be a number with up to two decimal places.');
    }

    return { cleanName, normalizedPrice };
}

function renderProducts(products) {
    const billingItemsTable = document.getElementById('billing-items');
    if (!billingItemsTable) return;
    billingItemsTable.innerHTML = products.map((product) => `
        <tr>
            <td>${escapeHtml(product.name)}</td>
            <td>Rs. ${formatPrice(product.price)}</td>
            <td>${escapeHtml(product.unit)}</td>
            <td>${product.stock} ${escapeHtml(product.unit)}</td>
            <td><button type="button" class="btn-add" data-product-id="${product.id}">Add</button></td>
        </tr>
    `).join('');

    billingItemsTable.querySelectorAll('.btn-add').forEach((btn) => {
        btn.addEventListener('click', addToCart);
    });
}

function renderInventoryTable(products) {
    if (!inventoryTableBody) return;

    const searchTerm = (inventorySearchInput?.value || '').trim().toLowerCase();
    const filtered = searchTerm
        ? products.filter((p) => `${p.name} ${p.category} ${p.unit}`.toLowerCase().includes(searchTerm))
        : products;

    const totalPages = Math.max(1, Math.ceil(filtered.length / inventoryState.rowsPerPage));
    if (inventoryState.page > totalPages) inventoryState.page = totalPages;

    const start = (inventoryState.page - 1) * inventoryState.rowsPerPage;
    const pageItems = filtered.slice(start, start + inventoryState.rowsPerPage);

    inventoryTableBody.innerHTML = pageItems.map((p, index) => `
        <tr>
            <td>${start + index + 1}</td>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.category)}</td>
            <td>Rs. ${formatPrice(p.price)}</td>
            <td>${escapeHtml(p.unit)}</td>
            <td>${p.stock}</td>
            <td>
                <button type="button" class="btn-secondary btn-edit" data-id="${p.id}">Edit</button>
                <button type="button" class="btn-secondary btn-restock-inline" data-restock-id="${p.id}">Restock</button>
            </td>
        </tr>
    `).join('');

    inventoryTableBody.querySelectorAll('.btn-edit').forEach((btn) => {
        btn.addEventListener('click', () => startEditProduct(btn.dataset.id));
    });
    inventoryTableBody.querySelectorAll('.btn-restock-inline').forEach((btn) => {
        btn.addEventListener('click', () => promptRestock(btn.dataset.restockId));
    });

    renderPagination('inventory-pagination', totalPages, inventoryState.page, (page) => {
        inventoryState.page = page;
        renderInventoryTable(products);
    });
}

function renderPagination(containerId, totalPages, currentPage, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
        pages.push(`<button type="button" class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`);
    }

    container.innerHTML = pages.join('');
    container.querySelectorAll('.page-btn').forEach((btn) => {
        btn.addEventListener('click', () => onPageChange(Number(btn.dataset.page)));
    });
}

function startEditProduct(id) {
    const p = allProducts.find((x) => String(x.id) === String(id));
    if (!p) return;
    productEditId.value = p.id;
    document.getElementById('product-name').value = p.name;
    if (productCategorySelect) {
        const options = Array.from(productCategorySelect.options).map((opt) => opt.value);
        if (!categoryList.some((category) => category.name === p.category)) {
            categoryList.push({ id: null, name: p.category });
            categoryList.sort((a, b) => a.name.localeCompare(b.name));
            refreshCategoryList(p.category);
        } else {
            productCategorySelect.value = p.category;
        }
    }
    document.getElementById('product-price').value = p.price;
    if (productCostInput) productCostInput.value = p.cost_price ?? '';
    productUnitSelect.value = p.unit;
    document.getElementById('product-threshold').value = p.low_stock_threshold ?? 10;
    document.getElementById('product-stock').value = p.stock ?? 0;
    document.getElementById('product-stock').disabled = true;
    document.getElementById('product-stock').title = 'Stock is tracked by sales and restock actions only';
    productSubmitBtn.textContent = 'Save changes';
    productCancelEdit.classList.remove('hidden');
}

function resetProductForm() {
    productEditId.value = '';
    productForm.reset();
    if (productCostInput) productCostInput.value = '';
    document.getElementById('product-stock').disabled = false;
    document.getElementById('product-stock').title = '';
    document.getElementById('product-threshold').value = 10;
    productSubmitBtn.textContent = 'Add product';
    productCancelEdit.classList.add('hidden');
}

async function handleProductSubmit(e) {
    e.preventDefault();
    const editId = productEditId.value;
    const selectedCategory = productCategorySelect ? productCategorySelect.value.trim() : '';
    const customCategory = (newCategoryInput?.value || '').trim();
    let category = customCategory || selectedCategory;
    const rawName = document.getElementById('product-name').value;
    const rawPrice = document.getElementById('product-price').value;

    try {
        const { cleanName, normalizedPrice } = validateProductInput(rawName, rawPrice);
        if (!category) {
            throw new Error('Please choose or add a category.');
        }
        if (customCategory) {
            const existingCategory = categoryList.find((item) => item.name.toLowerCase() === customCategory.toLowerCase());
            const categoryRecord = existingCategory || await createCategory(customCategory);
            category = categoryRecord.name;
        }
        const productStockInput = document.getElementById('product-stock');
        const productStockValue = Number(productStockInput.value || 0);
        const costPriceValue = productCostInput?.value.trim() || '';
        if (!editId && productStockValue > 0 && !costPriceValue) {
            throw new Error('Enter the purchase cost per unit when adding initial stock.');
        }
        const payload = {
            name: cleanName,
            category,
            price: normalizedPrice,
            cost_price: costPriceValue || null,
            unit: productUnitSelect.value,
            stock: editId ? (allProducts.find((item) => String(item.id) === String(editId))?.stock ?? productStockValue) : productStockValue,
            low_stock_threshold: document.getElementById('product-threshold').value,
        };

        if (editId) {
            const res = await apiFetch(`/api/products/${editId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || 'Update failed');
            }
        } else {
            const res = await apiFetch('/api/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || 'Add failed');
            }
        }
        if (newCategoryInput) newCategoryInput.value = '';
        resetProductForm();
        switchPage('inventory');
        loadProducts();
        loadSummary();
        loadAudit();
    } catch (err) {
        alert(err.message);
    }
}

async function handleCustomerSubmission() {
    const name = customerNameInput.value.trim() || 'Walk-in';
    const phone = customerNumberInput.value.trim() || 'N/A';

    try {
        const response = await apiFetch('/api/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone }),
        });
        if (!response.ok) throw new Error('Failed to start sale');
        const data = await response.json();
        currentCustomerId = data.customerId;
        submitCustomerBtn.disabled = true;
        customerNameInput.disabled = true;
        customerNumberInput.disabled = true;
        alert('Sale started. Add items to the bill.');
    } catch (error) {
        alert('Could not start sale.');
    }
}

async function addToCart(event) {
    if (!currentCustomerId) {
        alert('Click "Start sale" first');
        return;
    }
    const productId = event.target.dataset.productId;
    const product = allProducts.find((p) => String(p.id) === String(productId));
    if (!product) return;

    const existingItem = cartItems.find((item) => String(item.product_id) === String(productId));

    try {
        const response = await apiFetch('/api/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: currentCustomerId,
                productId,
                quantity: 1,
            }),
        });
        if (!response.ok) throw new Error('Failed to add');

        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            cartItems.push({
                product_id: productId,
                name: product.name,
                price: parseFloat(product.price),
                unit: product.unit,
                quantity: 1,
            });
        }
        updateCartDisplay();
    } catch (error) {
        alert('Failed to add item.');
    }
}

function updateCartDisplay() {
    const billTotalWrap = document.querySelector('.bill-total');
    if (cartItems.length === 0) {
        emptyCartDiv.style.display = 'flex';
        billTable.style.display = 'none';
        billTotalWrap.style.display = 'none';
        completeBillBtn.style.display = 'none';
        return;
    }

    emptyCartDiv.style.display = 'none';
    billTable.style.display = 'table';
    billTotalWrap.style.display = 'block';
    completeBillBtn.style.display = 'block';

    let total = 0;
    billItemsBody.innerHTML = cartItems.map((item) => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        return `
            <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>
                    <div class="quantity-control">
                        <button type="button" class="quantity-btn" data-product-id="${item.product_id}" data-action="decrease">-</button>
                        <span class="quantity-value">${item.quantity}</span>
                        <button type="button" class="quantity-btn" data-product-id="${item.product_id}" data-action="increase">+</button>
                    </div>
                </td>
                <td>${escapeHtml(item.unit)}</td>
                <td>Rs. ${formatPrice(item.price)}</td>
                <td>Rs. ${formatPrice(itemTotal)}</td>
                <td><button type="button" class="btn-remove" data-product-id="${item.product_id}">Remove</button></td>
            </tr>
        `;
    }).join('');

    document.getElementById('bill-total-amount').textContent = formatPrice(total);

    billItemsBody.querySelectorAll('.quantity-btn').forEach((b) => b.addEventListener('click', handleQuantityChange));
    billItemsBody.querySelectorAll('.btn-remove').forEach((b) => b.addEventListener('click', removeFromCart));
}

async function handleQuantityChange(event) {
    const productId = event.target.dataset.productId;
    const action = event.target.dataset.action;
    const item = cartItems.find((i) => String(i.product_id) === String(productId));
    if (!item) return;

    if (action === 'decrease' && item.quantity <= 1) {
        await removeFromCart({ target: { dataset: { productId } } });
        return;
    }

    const delta = action === 'increase' ? 1 : -1;
    try {
        const response = await apiFetch('/api/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: currentCustomerId,
                productId,
                quantity: delta,
            }),
        });
        if (!response.ok) throw new Error();
        item.quantity += delta;
        updateCartDisplay();
    } catch {
        alert('Failed to update quantity.');
    }
}

async function removeFromCart(event) {
    const productId = event.target.dataset.productId;
    try {
        const response = await apiFetch(`/api/cart/${currentCustomerId}/${productId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error();
        cartItems = cartItems.filter((i) => String(i.product_id) !== String(productId));
        updateCartDisplay();
    } catch {
        alert('Failed to remove item.');
    }
}

async function completeOrder() {
    if (!cartItems.length || !currentCustomerId) return;

    completeBillBtn.disabled = true;
    const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

    try {
        const response = await apiFetch('/api/orders/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: currentCustomerId,
                items: cartItems,
                total,
            }),
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Failed');
        }

        cartItems = [];
        updateCartDisplay();
        currentCustomerId = null;
        customerNameInput.value = '';
        customerNumberInput.value = '';
        submitCustomerBtn.disabled = false;
        customerNameInput.disabled = false;
        customerNumberInput.disabled = false;

        loadProducts();
        loadStock();
        loadOrders();
        loadSummary();
        loadProfitReport();
        loadAudit();
        alert('Sale completed.');
    } catch (error) {
        alert(error.message);
    } finally {
        completeBillBtn.disabled = false;
    }
}

async function loadStock() {
    try {
        const response = await apiFetch('/api/products');
        const products = await response.json();
        renderStock(products);
    } catch (e) {
        console.error(e);
    }
}

function renderStock(products) {
    if (!stockTableBody) return;

    const searchTerm = (stockSearchInput?.value || '').trim().toLowerCase();
    const filtered = searchTerm
        ? products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(searchTerm))
        : products;

    const totalPages = Math.max(1, Math.ceil(filtered.length / stockState.rowsPerPage));
    if (stockState.page > totalPages) stockState.page = totalPages;

    const start = (stockState.page - 1) * stockState.rowsPerPage;
    const pageItems = filtered.slice(start, start + stockState.rowsPerPage);

    stockTableBody.innerHTML = pageItems.map((product) => {
        const threshold = parseFloat(product.low_stock_threshold ?? 10);
        const stock = parseFloat(product.stock);
        const low = stock <= threshold;
        return `
            <tr class="${low ? 'row-low-stock' : ''}">
                <td>${escapeHtml(product.name)}</td>
                <td>${escapeHtml(product.category)}</td>
                <td>${stock}</td>
                <td>${escapeHtml(product.unit)}</td>
                <td>${low ? 'Low stock' : 'OK'}</td>
                <td>
                    <button type="button" class="btn-secondary btn-restock" data-id="${product.id}">+ Restock</button>
                </td>
            </tr>
        `;
    }).join('');

    stockTableBody.querySelectorAll('.btn-restock').forEach((btn) => {
        btn.addEventListener('click', () => promptRestock(btn.dataset.id));
    });

    renderPagination('stock-pagination', totalPages, stockState.page, (page) => {
        stockState.page = page;
        renderStock(products);
    });
}

async function promptRestock(productId) {
    const product = allProducts.find((item) => String(item.id) === String(productId));
    const currentStock = product ? Number(product.stock) : 0;
    const qty = prompt(`Add stock for ${product ? product.name : 'this product'}\nCurrent stock: ${currentStock}\nEnter amount to add (example: 50 or -5).`);
    if (qty === null || qty === '') return;
    const parsedQty = Number(qty);
    if (!Number.isFinite(parsedQty) || !/^-?\d+(?:\.\d{1,2})?$/.test(qty.trim())) {
        alert('Enter a valid quantity with up to two decimal places.');
        return;
    }
    let unitCost;
    if (parsedQty > 0) {
        const currentCost = product?.cost_price === null || product?.cost_price === undefined
            ? ''
            : Number(product.cost_price).toFixed(2);
        const rawCost = prompt('Purchase cost per unit (Rs.) for this stock batch:', currentCost);
        if (rawCost === null || !/^\d+(?:\.\d{1,2})?$/.test(rawCost.trim())) {
            alert('Enter a valid purchase cost per unit to record this restock.');
            return;
        }
        unitCost = Number(rawCost);
    }
    const note = prompt('Reason for restock (optional)') || 'Restock';
    try {
        const res = await apiFetch(`/api/products/${productId}/stock`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stockChange: parsedQty, unitCost, note }),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message);
        }
        await Promise.all([loadStock(), loadProducts(), loadSummary(), loadAudit(), loadProfitReport()]);
    } catch (e) {
        alert(e.message);
    }
}

async function loadOrders() {
    try {
        const response = await apiFetch('/api/orders');
        allOrders = await response.json();
        ordersState.page = 1;
        renderOrders(allOrders);
    } catch (e) {
        console.error(e);
    }
}

function getFilteredOrders() {
    const term = (orderSearchInput?.value || '').toLowerCase();
    const fromValue = orderDateFromInput?.value;
    const toValue = orderDateToInput?.value;
    const monthValue = orderMonthFilterInput?.value;

    return allOrders.filter((order) => {
        const rowText = `${order.id} ${order.buyer_name || ''} ${order.buyer_phone || ''}`.toLowerCase();
        if (term && !rowText.includes(term)) return false;

        const orderDate = new Date(order.order_date);
        if (fromValue) {
            const fromDate = new Date(`${fromValue}T00:00:00`);
            if (orderDate < fromDate) return false;
        }
        if (toValue) {
            const toDate = new Date(`${toValue}T23:59:59`);
            if (orderDate > toDate) return false;
        }
        if (monthValue) {
            const orderMonth = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}`;
            if (orderMonth !== monthValue) return false;
        }
        return true;
    });
}

function renderOrders(orders = getFilteredOrders()) {
    if (!ordersTableBody) return;
    const filteredOrders = Array.isArray(orders) ? orders : getFilteredOrders();

    if (!filteredOrders.length) {
        ordersTableBody.innerHTML = '<tr><td colspan="7" class="no-orders">No sales yet</td></tr>';
        renderPagination('orders-pagination', 1, 1, () => {});
        return;
    }

    const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ordersState.rowsPerPage));
    if (ordersState.page > totalPages) ordersState.page = totalPages;

    const start = (ordersState.page - 1) * ordersState.rowsPerPage;
    const pageItems = filteredOrders.slice(start, start + ordersState.rowsPerPage);

    ordersTableBody.innerHTML = pageItems.map((order, index) => `
        <tr>
            <td>${start + index + 1}</td>
            <td>${order.id}</td>
            <td>${order.buyer_name || `User-${order.id}`}</td>
            <td>${new Date(order.order_date).toLocaleString()}</td>
            <td>Rs. ${formatPrice(order.total_amount)}</td>
            <td><button type="button" class="btn-secondary btn-view-order" data-order-id="${order.id}">View</button></td>
        </tr>
    `).join('');

    ordersTableBody.querySelectorAll('.btn-view-order').forEach((btn) => {
        btn.addEventListener('click', viewOrderDetails);
    });

    renderPagination('orders-pagination', totalPages, ordersState.page, (page) => {
        ordersState.page = page;
        renderOrders();
    });
}

function searchOrders() {
    ordersState.page = 1;
    renderOrders(getFilteredOrders());
}

async function viewOrderDetails(event) {
    const orderId = event.target.dataset.orderId;
    try {
        const res = await apiFetch(`/api/orders/${orderId}`);
        const data = await res.json();
        const o = data.order;
        if (!orderDetailsContent || !orderDetailsModal) return;

        orderDetailsContent.innerHTML = `
            <h3>Sale #${o.id}</h3>
            <p><strong>Buyer:</strong> ${escapeHtml(o.buyer_name || 'Walk-in')} ${o.buyer_phone ? `(${escapeHtml(o.buyer_phone)})` : ''}</p>
            <p><strong>Date:</strong> ${new Date(o.order_date).toLocaleString()}</p>
            <table class="data-table">
                <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Price</th></tr></thead>
                <tbody>
                    ${data.items.map((i) => `
                        <tr>
                            <td>${escapeHtml(i.product_name)}</td>
                            <td>${i.quantity}</td>
                            <td>${escapeHtml(i.unit)}</td>
                            <td>Rs. ${formatPrice(i.unit_price)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p class="order-total"><strong>Total:</strong> Rs. ${formatPrice(o.total_amount)}</p>
        `;
        orderDetailsModal.style.display = 'block';
    } catch (error) {
        console.error(error);
    }
}

let auditRowsCache = [];

async function loadAudit() {
    try {
        const res = await apiFetch('/api/audit/stock?limit=500');
        auditRowsCache = await res.json();
        renderAuditTable();
        renderMonthlyMovement(auditRowsCache);
    } catch (e) {
        console.error(e);
    }
}

function getFilteredAuditRows() {
    const term = (auditSearchInput?.value || '').trim().toLowerCase();
    const reason = auditReasonFilter?.value || 'all';
    const month = auditMonthFilter?.value || '';

    return auditRowsCache.filter((row) => {
        const matchesTerm = !term || `${row.product_name || ''} ${row.note || ''}`.toLowerCase().includes(term);
        const matchesReason = reason === 'all' || row.reason === reason;
        const matchesMonth = !month || new Date(row.created_at).toISOString().slice(0, 7) === month;
        return matchesTerm && matchesReason && matchesMonth;
    });
}

function renderAuditTable() {
    if (!auditTableBody) return;
    const filteredRows = getFilteredAuditRows();

    if (!filteredRows.length) {
        auditTableBody.innerHTML = '<tr><td colspan="7" class="no-orders">No inventory activity yet</td></tr>';
        renderPagination('audit-pagination', 1, 1, () => {});
        return;
    }

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / auditState.rowsPerPage));
    if (auditState.page > totalPages) auditState.page = totalPages;

    const start = (auditState.page - 1) * auditState.rowsPerPage;
    const pageItems = filteredRows.slice(start, start + auditState.rowsPerPage);

    auditTableBody.innerHTML = pageItems.map((r, index) => {
        const movement = Number(r.change_qty || 0);
        const sign = movement >= 0 ? '+' : '-';
        return `
            <tr>
                <td>${start + index + 1}</td>
                <td>${new Date(r.created_at).toLocaleString()}</td>
                <td>${escapeHtml(r.product_name)}</td>
                <td>${sign}${Math.abs(movement)} ${escapeHtml(r.unit)}</td>
                <td>${r.stock_after} ${escapeHtml(r.unit)}</td>
                <td>${r.purchase_unit_cost === null ? '—' : `Rs. ${formatPrice(r.purchase_unit_cost)}`}</td>
                <td>${escapeHtml(r.reason)}</td>
                <td>${escapeHtml(r.note || '—')}</td>
            </tr>
        `;
    }).join('');

    renderPagination('audit-pagination', totalPages, auditState.page, (page) => {
        auditState.page = page;
        renderAuditTable();
    });
}

function renderMonthlyMovement(rows) {
    const monthTarget = document.getElementById('monthly-movement');
    if (!monthTarget) return;

    const monthMap = {};
    rows.forEach((row) => {
        const month = new Date(row.created_at).toLocaleString('en-US', { month: 'short', year: 'numeric' });
        const key = month;
        if (!monthMap[key]) {
            monthMap[key] = { month, in: 0, out: 0 };
        }
        const change = Number(row.change_qty || 0);
        if (change > 0) monthMap[key].in += change;
        if (change < 0) monthMap[key].out += Math.abs(change);
    });

    const entries = Object.values(monthMap)
        .map((entry) => ({
            ...entry,
            net: entry.in - entry.out,
        }))
        .sort((a, b) => new Date(b.month) - new Date(a.month))
        .slice(0, 6);

    if (!entries.length) {
        monthTarget.innerHTML = '<p class="muted-text">No inventory activity recorded yet.</p>';
        return;
    }

    monthTarget.innerHTML = entries.map((entry) => `
        <div class="movement-row">
            <span class="movement-month-label">${entry.month}</span>
            <div class="movement-values">
                <span class="movement-in">Added +${entry.in}</span>
                <span class="movement-out">Used -${entry.out}</span>
                <span class="movement-net ${entry.net >= 0 ? 'positive' : 'negative'}">Net ${entry.net >= 0 ? '+' : '-'}${Math.abs(entry.net)}</span>
            </div>
        </div>
    `).join('');

    const lowStockList = document.getElementById('low-stock-list');
    if (lowStockList) {
        const low = allProducts.filter((p) => Number(p.stock) <= Number(p.low_stock_threshold || 10));
        lowStockList.innerHTML = low.length
            ? low.slice(0, 5).map((p) => `
                <div class="low-stock-row">
                    <span>${escapeHtml(p.name)}</span>
                    <strong>${p.stock} ${escapeHtml(p.unit)}</strong>
                </div>
            `).join('')
            : '<p class="muted-text">No low stock items.</p>';
    }
}

function exportAuditCsv() {
    const rows = getFilteredAuditRows();
    if (!rows.length) return;

    const header = ['Date', 'Product', 'Movement', 'Stock After', 'Purchase Cost per Unit (Rs.)', 'Reason', 'Note'];
    const csvRows = rows.map((row) => {
        const movement = Number(row.change_qty || 0);
        const direction = movement >= 0 ? '+' : '-';
        return [
            new Date(row.created_at).toISOString(),
            row.product_name || '',
            `${direction}${Math.abs(movement)} ${row.unit || ''}`,
            `${row.stock_after || 0} ${row.unit || ''}`,
            row.purchase_unit_cost ?? '',
            row.reason || '',
            (row.note || '').replace(/\n/g, ' '),
        ];
    });

    const csv = [header, ...csvRows]
        .map((line) => line.map(escapeCsvCell).join(','))
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'inventory-audit.csv';
    anchor.click();
    URL.revokeObjectURL(url);
}

async function exportSalesCsv() {
    try {
        const month = auditMonthFilter?.value;
        const query = month ? `?month=${encodeURIComponent(month)}` : '';
        const response = await apiFetch(`/api/reports/sales-orders${query}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to load sales');

        const headers = [
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
        ];
        const lines = [headers];
        let grandTotal = 0;
        let currentOrderId = null;

        result.forEach((row) => {
            const isFirstOrderLine = String(row.order_id) !== String(currentOrderId);
            if (isFirstOrderLine) {
                currentOrderId = row.order_id;
                grandTotal += Number(row.order_total || 0);
            }

            const hasProduct = row.product_id !== null;
            const quantity = hasProduct ? Number(row.quantity || 0) : '';
            const unitPrice = hasProduct ? Number(row.unit_price || 0) : '';
            const lineTotal = hasProduct ? Number(row.quantity || 0) * Number(row.unit_price || 0) : '';
            const orderDate = row.order_date instanceof Date
                ? row.order_date.toISOString()
                : new Date(row.order_date).toISOString();

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
                isFirstOrderLine ? Number(row.order_total || 0).toFixed(2) : '',
            ]);
        });

        lines.push([]);
        lines.push(['', '', '', '', '', '', '', '', 'TOTAL SALES (Rs.)', grandTotal.toFixed(2)]);

        const csv = lines
            .map((line) => line.map(escapeCsvCell).join(','))
            .join('\r\n');
        const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `sales${month ? `-${month}` : ''}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error(error);
        alert(`Sales export could not be downloaded: ${error.message}`);
    }
}

function escapeCsvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}
