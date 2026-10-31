// RECUR SMS - Frontend Client Engine
const API_BASE = '/api';

let state = {
  token: localStorage.getItem('recur_token') || null,
  user: JSON.parse(localStorage.getItem('recur_user') || 'null'),
  currentView: 'guest',
  activePaymentInvoiceId: null,
  selectedPayMethod: 'UPI',
  cache: {
    products: [],
    plans: [],
    customers: [],
    invoices: []
  }
};

// ================= Notification Toast =================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ================= API Client =================
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// ================= Navigation & UI Render =================
function updateNavbar() {
  const navContainer = document.getElementById('main-nav-links');
  const profileContainer = document.getElementById('user-profile-section');
  navContainer.innerHTML = '';

  if (!state.user) {
    profileContainer.innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="openAuthModal('login')">Sign In</button>
    `;
    navigateTo('guest');
    return;
  }

  // User Profile Pill
  profileContainer.innerHTML = `
    <div style="text-align: right;">
      <div style="font-size: 0.85rem; font-weight: 600;">${state.user.email}</div>
      <span class="role-badge role-${state.user.role}">${state.user.role}</span>
    </div>
    <button class="btn btn-secondary btn-sm" onclick="handleLogout()">Sign Out</button>
  `;

  // Role-based Nav Links
  if (state.user.role === 'ADMIN') {
    navContainer.innerHTML = `
      <button class="nav-btn admin-special" id="nav-btn-admin-autoinvoice" onclick="navigateTo('admin-autoinvoice')">
        ⚡ Automated Invoicing Engine
      </button>
      <button class="nav-btn" id="nav-btn-admin-products" onclick="navigateTo('admin-products')">Products & Plans</button>
      <button class="nav-btn" id="nav-btn-admin-discounts" onclick="navigateTo('admin-discounts')">Discounts & Taxes</button>
      <button class="nav-btn" id="nav-btn-admin-staff" onclick="navigateTo('admin-staff')">Staff</button>
      <button class="nav-btn" id="nav-btn-subscriptions" onclick="navigateTo('subscriptions')">Subscriptions</button>
      <button class="nav-btn" id="nav-btn-invoices" onclick="navigateTo('invoices')">Invoices</button>
      <button class="nav-btn" id="nav-btn-finance" onclick="navigateTo('finance')">Finance Analytics</button>
      <button class="nav-btn" id="nav-btn-email-logs" onclick="navigateTo('email-logs')">📧 Email Logs</button>
    `;
    if (state.currentView === 'guest') navigateTo('admin-autoinvoice');
  } else if (state.user.role === 'STAFF') {
    navContainer.innerHTML = `
      <button class="nav-btn" id="nav-btn-subscriptions" onclick="navigateTo('subscriptions')">Quotes & Subscriptions</button>
      <button class="nav-btn" id="nav-btn-invoices" onclick="navigateTo('invoices')">Invoices</button>
      <button class="nav-btn" id="nav-btn-finance" onclick="navigateTo('finance')">Finance Summary</button>
      <button class="nav-btn" id="nav-btn-email-logs" onclick="navigateTo('email-logs')">📧 Email Logs</button>
    `;
    if (state.currentView === 'guest') navigateTo('subscriptions');
  } else {
    // Customer
    navContainer.innerHTML = `
      <button class="nav-btn" id="nav-btn-customer" onclick="navigateTo('customer')">My Portal</button>
    `;
    navigateTo('customer');
  }
}

function navigateTo(viewId) {
  state.currentView = viewId;
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewId}`);
  if (targetView) targetView.classList.add('active');

  const targetBtn = document.getElementById(`nav-btn-${viewId}`);
  if (targetBtn) targetBtn.classList.add('active');

  // Trigger data load
  switch (viewId) {
    case 'admin-autoinvoice': loadAutomatedInvoicingMetrics(); break;
    case 'admin-staff': loadStaffList(); break;
    case 'admin-products': loadProductsAndPlans(); break;
    case 'admin-discounts': loadDiscountsAndTaxes(); break;
    case 'subscriptions': loadSubscriptionsList(); break;
    case 'invoices': loadInvoicesList(); break;
    case 'finance': loadFinanceAnalytics(); break;
    case 'email-logs': loadEmailLogs(); break;
    case 'customer': loadCustomerPortal(); break;
  }
}

// ================= Modals =================
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function openAuthModal(mode) {
  openModal('modal-auth');
  showAuthMode(mode);
}

function showAuthMode(mode) {
  document.getElementById('form-login').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('form-register').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('form-forgot').style.display = mode === 'forgot' ? 'block' : 'none';
  document.getElementById('auth-modal-title').innerText = 
    mode === 'login' ? 'Sign In to RECUR SMS' : (mode === 'register' ? 'Create Customer Account' : 'Reset Password');
}

// ================= Auth Handlers =================
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const data = await apiCall('/auth/login', 'POST', { email, password });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('recur_token', data.token);
    localStorage.setItem('recur_user', JSON.stringify(data.user));

    closeModal('modal-auth');
    showToast(`Welcome back, ${data.user.email}!`, 'success');
    updateNavbar();
  } catch (err) {}
}

async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;

  try {
    const data = await apiCall('/auth/register', 'POST', { email, password });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('recur_token', data.token);
    localStorage.setItem('recur_user', JSON.stringify(data.user));

    closeModal('modal-auth');
    showToast('Account created successfully!', 'success');
    updateNavbar();
  } catch (err) {}
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value;
  try {
    const data = await apiCall('/auth/forgot-password', 'POST', { email });
    const display = document.getElementById('reset-link-display');
    display.style.display = 'block';
    display.innerHTML = `
      <strong>Demo Reset Link Generated:</strong><br>
      <a href="${data.demo_reset_link}" target="_blank" style="color: var(--primary);">${data.demo_reset_link}</a>
    `;
    showToast(data.message, 'success');
  } catch (err) {}
}

function handleLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('recur_token');
  localStorage.removeItem('recur_user');
  updateNavbar();
  showToast('Signed out cleanly.', 'info');
}

// ================= ADMIN: Automated Invoicing Window =================
async function loadAutomatedInvoicingMetrics() {
  try {
    const data = await apiCall('/admin/automated-invoicing/metrics');
    document.getElementById('ai-engine-status').innerText = data.engine_status;
    document.getElementById('ai-due-count').innerText = data.due_subscriptions_count;
    document.getElementById('ai-total-invoices').innerText = data.total_invoices_generated;
    document.getElementById('ai-total-billed').innerText = `$${Number(data.total_amount_billed).toFixed(2)}`;

    const tbody = document.getElementById('ai-batch-logs-tbody');
    if (data.recent_batches.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8;">No batches run yet. Subscriptions are billed automatically or on demand.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.recent_batches.map(b => `
      <tr>
        <td><strong>${b.id}</strong></td>
        <td>${new Date(b.run_timestamp).toLocaleString()}</td>
        <td><span class="status-pill status-Active">${b.invoices_created} Invoices</span></td>
        <td><strong>$${Number(b.total_billed).toFixed(2)}</strong></td>
        <td style="font-size: 0.85rem; color: #64748b;">${b.details}</td>
      </tr>
    `).join('');
  } catch (err) {}
}

async function triggerAutoBillingRun() {
  try {
    const res = await apiCall('/admin/automated-invoicing/run-batch', 'POST');
    showToast(`Batch completed: ${res.result.invoicesCreated} invoices created.`, 'success');
    loadAutomatedInvoicingMetrics();
  } catch (err) {}
}

// ================= ADMIN: Staff Management =================
async function loadStaffList() {
  try {
    const data = await apiCall('/admin/staff');
    const tbody = document.getElementById('staff-table-tbody');
    if (data.staff.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #94a3b8;">No staff members added yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.staff.map(s => `
      <tr>
        <td><strong>${s.email}</strong></td>
        <td><span class="role-badge role-STAFF">STAFF</span></td>
        <td><span class="status-pill status-Active">Active</span></td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="handleRemoveStaff('${s.email}')">Revoke Staff Access</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {}
}

async function handleAddStaff(e) {
  e.preventDefault();
  const email = document.getElementById('staff-input-email').value;
  try {
    const res = await apiCall('/admin/staff', 'POST', { email });
    showToast(res.message, 'success');
    closeModal('modal-add-staff');
    document.getElementById('staff-input-email').value = '';
    loadStaffList();
  } catch (err) {}
}

async function handleRemoveStaff(email) {
  if (!confirm(`Are you sure you want to revoke staff access for ${email}?`)) return;
  try {
    const res = await apiCall(`/admin/staff/${encodeURIComponent(email)}`, 'DELETE');
    showToast(res.message, 'info');
    loadStaffList();
  } catch (err) {}
}

// ================= ADMIN: Products & Plans =================
async function loadProductsAndPlans() {
  try {
    const [prodData, planData] = await Promise.all([
      apiCall('/admin/products'),
      apiCall('/admin/plans')
    ]);

    state.cache.products = prodData.products;
    state.cache.plans = planData.plans;

    // Render Products Table
    const prodTbody = document.getElementById('products-table-tbody');
    prodTbody.innerHTML = prodData.products.length ? prodData.products.map(p => `
      <tr>
        <td><strong>${p.name}</strong></td>
        <td>${p.type}</td>
        <td>$${Number(p.sales_price).toFixed(2)}</td>
        <td>$${Number(p.cost_price).toFixed(2)}</td>
        <td>
          ${p.variants && p.variants.length 
            ? p.variants.map(v => `<span class="brand-badge">${v.variant_name} (+$${v.price_adjustment})</span>`).join(' ') 
            : '<span style="color:#94a3b8;">Base Only</span>'}
        </td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="handleDeleteProduct('${p.id}')">Delete</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="6" style="text-align: center; color: #94a3b8;">No products defined yet.</td></tr>`;

    // Render Plans Table
    const planTbody = document.getElementById('plans-table-tbody');
    planTbody.innerHTML = planData.plans.length ? planData.plans.map(pl => `
      <tr>
        <td><strong>${pl.name}</strong></td>
        <td><span class="brand-badge">${pl.billing_interval.toUpperCase()}</span></td>
        <td><strong>$${Number(pl.cost).toFixed(2)}</strong></td>
        <td>${pl.min_quantity} seat(s)</td>
        <td style="font-size: 0.8rem; color: #64748b;">
          ${pl.auto_close_on_end ? '• Auto-closes on end<br>' : ''}
          ${pl.allow_early_close ? '• Early close allowed<br>' : ''}
          ${pl.allow_pause ? '• Pause allowed<br>' : ''}
          ${pl.allow_renewal ? '• Renewal allowed' : ''}
        </td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="handleDeletePlan('${pl.id}')">Delete</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="6" style="text-align: center; color: #94a3b8;">No plans defined yet.</td></tr>`;
  } catch (err) {}
}

async function handleAddProduct(e) {
  e.preventDefault();
  const name = document.getElementById('prod-name').value;
  const type = document.getElementById('prod-type').value;
  const sales_price = document.getElementById('prod-sales-price').value;
  const cost_price = document.getElementById('prod-cost-price').value;
  const notes = document.getElementById('prod-notes').value;
  const varName = document.getElementById('prod-var-name').value;
  const varAdj = document.getElementById('prod-var-adj').value;

  const variants = [];
  if (varName) {
    variants.push({ variant_name: varName, price_adjustment: varAdj || 0 });
  }

  try {
    await apiCall('/admin/products', 'POST', { name, type, sales_price, cost_price, notes, variants });
    showToast('Product added successfully', 'success');
    closeModal('modal-add-product');
    loadProductsAndPlans();
  } catch (err) {}
}

async function handleDeleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  try {
    await apiCall(`/admin/products/${id}`, 'DELETE');
    showToast('Product removed', 'info');
    loadProductsAndPlans();
  } catch (err) {}
}

async function handleAddPlan(e) {
  e.preventDefault();
  const body = {
    name: document.getElementById('plan-name').value,
    cost: document.getElementById('plan-cost').value,
    billing_interval: document.getElementById('plan-interval').value,
    min_quantity: document.getElementById('plan-min-qty').value,
    available_from: document.getElementById('plan-avail-from').value,
    available_to: document.getElementById('plan-avail-to').value,
    auto_close_on_end: document.getElementById('plan-auto-close').checked,
    allow_early_close: document.getElementById('plan-allow-early').checked,
    allow_pause: document.getElementById('plan-allow-pause').checked,
    allow_renewal: document.getElementById('plan-allow-renewal').checked
  };

  try {
    await apiCall('/admin/plans', 'POST', body);
    showToast('Plan created successfully', 'success');
    closeModal('modal-add-plan');
    loadProductsAndPlans();
  } catch (err) {}
}

async function handleDeletePlan(id) {
  if (!confirm('Delete this plan?')) return;
  try {
    await apiCall(`/admin/plans/${id}`, 'DELETE');
    showToast('Plan deleted', 'info');
    loadProductsAndPlans();
  } catch (err) {}
}

// ================= ADMIN: Discounts & Taxes =================
async function loadDiscountsAndTaxes() {
  try {
    const [discData, taxData] = await Promise.all([
      apiCall('/admin/discounts'),
      apiCall('/admin/taxes')
    ]);

    const discTbody = document.getElementById('discounts-table-tbody');
    discTbody.innerHTML = discData.discounts.length ? discData.discounts.map(d => `
      <tr>
        <td><strong>${d.code}</strong></td>
        <td>${d.discount_type === 'PERCENTAGE' ? `${d.value}% Off` : `$${d.value} Off`}</td>
        <td>Min Spend: $${d.min_purchase_amount}</td>
        <td>${d.scope}</td>
        <td>${d.times_used} / ${d.max_usage_limit > 0 ? d.max_usage_limit : 'Unlimited'}</td>
        <td><button class="btn btn-danger btn-sm" onclick="handleDeleteDiscount('${d.id}')">Delete</button></td>
      </tr>
    `).join('') : `<tr><td colspan="6" style="text-align: center; color: #94a3b8;">No discount rules created yet.</td></tr>`;

    const taxTbody = document.getElementById('taxes-table-tbody');
    taxTbody.innerHTML = taxData.taxes.length ? taxData.taxes.map(t => `
      <tr>
        <td><strong>${t.name}</strong></td>
        <td>${t.rate_percentage}%</td>
        <td><span class="status-pill status-Active">Active</span></td>
        <td><button class="btn btn-danger btn-sm" onclick="handleDeleteTax('${t.id}')">Delete</button></td>
      </tr>
    `).join('') : `<tr><td colspan="4" style="text-align: center; color: #94a3b8;">No tax rules created yet.</td></tr>`;
  } catch (err) {}
}

async function handleAddDiscount(e) {
  e.preventDefault();
  const body = {
    code: document.getElementById('disc-code').value,
    discount_type: document.getElementById('disc-type').value,
    value: document.getElementById('disc-val').value,
    scope: document.getElementById('disc-scope').value,
    min_purchase_amount: document.getElementById('disc-min-spend').value,
    max_usage_limit: document.getElementById('disc-max-limit').value
  };

  try {
    await apiCall('/admin/discounts', 'POST', body);
    showToast('Discount rule saved', 'success');
    closeModal('modal-add-discount');
    loadDiscountsAndTaxes();
  } catch (err) {}
}

async function handleDeleteDiscount(id) {
  if (!confirm('Delete discount?')) return;
  try {
    await apiCall(`/admin/discounts/${id}`, 'DELETE');
    loadDiscountsAndTaxes();
  } catch (err) {}
}

async function handleAddTax(e) {
  e.preventDefault();
  const name = document.getElementById('tax-name').value;
  const rate_percentage = document.getElementById('tax-rate').value;

  try {
    await apiCall('/admin/taxes', 'POST', { name, rate_percentage });
    showToast('Tax rule added', 'success');
    closeModal('modal-add-tax');
    loadDiscountsAndTaxes();
  } catch (err) {}
}

async function handleDeleteTax(id) {
  if (!confirm('Delete tax rule?')) return;
  try {
    await apiCall(`/admin/taxes/${id}`, 'DELETE');
    loadDiscountsAndTaxes();
  } catch (err) {}
}

// ================= SUBSCRIPTIONS & QUOTATIONS =================
async function loadSubscriptionsList() {
  try {
    const [subData, custData, prodData, planData] = await Promise.all([
      apiCall('/staff/subscriptions'),
      apiCall('/staff/customers'),
      apiCall('/admin/products'),
      apiCall('/admin/plans')
    ]);

    state.cache.customers = custData.customers;
    state.cache.products = prodData.products;
    state.cache.plans = planData.plans;

    // Populate Modal Dropdowns
    const custSelect = document.getElementById('sub-customer');
    custSelect.innerHTML = custData.customers.map(c => `<option value="${c.id}">${c.email}</option>`).join('');

    const planSelect = document.getElementById('sub-plan');
    planSelect.innerHTML = planData.plans.map(p => `<option value="${p.id}">${p.name} ($${p.cost}/${p.billing_interval})</option>`).join('');

    const prodSelect = document.getElementById('sub-item-prod');
    prodSelect.innerHTML = prodData.products.map(pr => `<option value="${pr.id}">${pr.name} ($${pr.sales_price})</option>`).join('');
    if (prodData.products.length) updateVariantOptions(prodData.products[0].id);

    document.getElementById('sub-start-date').value = new Date().toISOString().split('T')[0];

    // Render Subscriptions Table
    const tbody = document.getElementById('subscriptions-table-tbody');
    tbody.innerHTML = subData.subscriptions.length ? subData.subscriptions.map(s => `
      <tr>
        <td><strong>${s.subscription_number}</strong></td>
        <td>${s.customer_email}</td>
        <td>${s.plan_name} <span class="brand-badge">${s.billing_interval}</span></td>
        <td>${s.start_date || 'N/A'}</td>
        <td><strong>${s.next_billing_date || 'N/A'}</strong></td>
        <td><span class="status-pill status-${s.status}">${s.status}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="downloadQuotationPDF('${s.id}')" title="Download Official Quote/Agreement PDF" style="margin-right: 4px;">📄 Quote PDF</button>
          <select onchange="updateSubscriptionStatus('${s.id}', this.value)" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">
            <option value="">Transition &rarr;</option>
            <option value="Draft" ${s.status === 'Draft' ? 'disabled' : ''}>Draft</option>
            <option value="Quotation" ${s.status === 'Quotation' ? 'disabled' : ''}>Quotation</option>
            <option value="Confirmed" ${s.status === 'Confirmed' ? 'disabled' : ''}>Confirmed</option>
            <option value="Active" ${s.status === 'Active' ? 'disabled' : ''}>Active</option>
            <option value="Closed" ${s.status === 'Closed' ? 'disabled' : ''}>Closed</option>
          </select>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7" style="text-align: center; color: #94a3b8;">No subscriptions or quotations recorded yet.</td></tr>`;
  } catch (err) {}
}

function updateVariantOptions(productId) {
  const product = state.cache.products.find(p => p.id === productId);
  const varSelect = document.getElementById('sub-item-var');
  varSelect.innerHTML = '<option value="">Base Product (No Variant)</option>';
  if (product && product.variants) {
    product.variants.forEach(v => {
      varSelect.innerHTML += `<option value="${v.id}">${v.variant_name} (+ $${v.price_adjustment})</option>`;
    });
  }
}

async function handleAddSubscription(e) {
  e.preventDefault();
  const customer_id = document.getElementById('sub-customer').value;
  const plan_id = document.getElementById('sub-plan').value;
  const start_date = document.getElementById('sub-start-date').value;
  const payment_terms = document.getElementById('sub-terms').value;
  const product_id = document.getElementById('sub-item-prod').value;
  const variant_id = document.getElementById('sub-item-var').value || null;
  const quantity = document.getElementById('sub-item-qty').value;

  const product = state.cache.products.find(p => p.id === product_id);
  const variant = product?.variants?.find(v => v.id === variant_id);
  const unit_price = Number(product?.sales_price || 0) + Number(variant?.price_adjustment || 0);

  const items = [{
    product_id,
    variant_id,
    quantity,
    unit_price
  }];

  try {
    const res = await apiCall('/staff/subscriptions', 'POST', {
      customer_id, plan_id, start_date, payment_terms, items
    });
    showToast(`Quotation ${res.subscription_number} initialized in Draft`, 'success');
    closeModal('modal-add-subscription');
    loadSubscriptionsList();
  } catch (err) {}
}

async function updateSubscriptionStatus(id, newStatus) {
  if (!newStatus) return;
  try {
    await apiCall(`/staff/subscriptions/${id}/status`, 'PATCH', { status: newStatus });
    showToast(`Status updated to ${newStatus}`, 'success');
    loadSubscriptionsList();
  } catch (err) {}
}

// ================= INVOICES & PAYMENTS =================
async function loadInvoicesList() {
  try {
    const data = await apiCall('/staff/invoices');
    state.cache.invoices = data.invoices;

    const tbody = document.getElementById('invoices-table-tbody');
    tbody.innerHTML = data.invoices.length ? data.invoices.map(inv => `
      <tr>
        <td><strong>${inv.invoice_number}</strong></td>
        <td>${inv.customer_email}</td>
        <td>${inv.due_date}</td>
        <td>$${Number(inv.subtotal).toFixed(2)}</td>
        <td style="font-size: 0.8rem; color: #64748b;">
          Disc: -$${Number(inv.discount_total).toFixed(2)}<br>
          Tax: +$${Number(inv.tax_total).toFixed(2)}
        </td>
        <td><strong>$${Number(inv.total_amount).toFixed(2)}</strong></td>
        <td style="color: #16a34a;">$${Number(inv.paid_amount).toFixed(2)}</td>
        <td><span class="status-pill status-${inv.status}">${inv.status}</span></td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="downloadInvoicePDF('${inv.id}')" title="Download Official Invoice PDF">📄 PDF</button>
          <button class="btn btn-secondary btn-sm" onclick="printInvoice('${inv.id}')" title="Printable HTML Invoice">🖨️ Print</button>
          ${inv.status === 'Draft' ? `<button class="btn btn-primary btn-sm" onclick="updateInvoiceStatus('${inv.id}', 'Confirmed')">Confirm</button>` : ''}
          ${inv.status !== 'Paid' && inv.status !== 'Cancelled' ? `<button class="btn btn-danger btn-sm" onclick="updateInvoiceStatus('${inv.id}', 'Cancelled')">Cancel</button>` : ''}
          ${inv.status === 'Confirmed' ? `<button class="btn btn-warning btn-sm" onclick="sendInvoiceReminder('${inv.id}')" title="Send Dunning Notice Email">📧 Remind</button>` : ''}
        </td>
      </tr>
    `).join('') : `<tr><td colspan="9" style="text-align: center; color: #94a3b8;">No invoices created yet. Billing days generate them automatically.</td></tr>`;

    // Populate Record Payment Invoice dropdown
    const paySelect = document.getElementById('pay-invoice-select');
    const unpaidInvoices = data.invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
    paySelect.innerHTML = unpaidInvoices.length 
      ? unpaidInvoices.map(i => `<option value="${i.id}">${i.invoice_number} (${i.customer_email}) - Due: $${(i.total_amount - i.paid_amount).toFixed(2)}</option>`).join('')
      : '<option value="">No pending invoices</option>';
    if (unpaidInvoices.length) updateInvoicePayAmount(unpaidInvoices[0].id);
  } catch (err) {}
}

function updateInvoicePayAmount(invId) {
  const inv = state.cache.invoices.find(i => i.id === invId);
  if (inv) {
    document.getElementById('pay-amount').value = (inv.total_amount - inv.paid_amount).toFixed(2);
  }
}

async function updateInvoiceStatus(id, status) {
  try {
    await apiCall(`/staff/invoices/${id}/status`, 'PATCH', { status });
    showToast(`Invoice updated to ${status}`, 'success');
    loadInvoicesList();
  } catch (err) {}
}

async function handleRecordPayment(e) {
  e.preventDefault();
  const invoice_id = document.getElementById('pay-invoice-select').value;
  const payment_method = document.getElementById('pay-method').value;
  const amount = document.getElementById('pay-amount').value;
  const note = document.getElementById('pay-note').value;

  try {
    const res = await apiCall('/staff/payments', 'POST', { invoice_id, payment_method, amount, note });
    showToast(`Payment recorded. Ref: ${res.transaction_reference}`, 'success');
    closeModal('modal-record-payment');
    loadInvoicesList();
  } catch (err) {}
}

function downloadInvoicePDF(id, isCustomer = false) {
  const url = isCustomer 
    ? '/api/customer/my-invoices/' + id + '/pdf?token=' + encodeURIComponent(state.token)
    : '/api/staff/invoices/' + id + '/pdf?token=' + encodeURIComponent(state.token);
  window.open(url, '_blank');
}

function downloadQuotationPDF(id, isCustomer = false) {
  const url = isCustomer 
    ? '/api/customer/my-subscriptions/' + id + '/pdf?token=' + encodeURIComponent(state.token)
    : '/api/staff/quotations/' + id + '/pdf?token=' + encodeURIComponent(state.token);
  window.open(url, '_blank');
}

function printInvoice(id) {
  const inv = (state.cache.invoices || []).find(i => i.id === id);
  if (!inv) return;

  const today = new Date().toISOString().split('T')[0];
  const isPaid = inv.status === 'Paid';
  const isOverdue = !isPaid && inv.due_date && inv.due_date < today;
  const statusLabel = isPaid ? 'PAID' : (isOverdue ? 'OVERDUE' : inv.status.toUpperCase());
  const statusColor = isPaid ? '#10b981' : (isOverdue ? '#ef4444' : '#0284c7');
  const balanceDue = Math.max(0, inv.total_amount - (inv.paid_amount || 0));

  const itemsHtml = (inv.items && inv.items.length ? inv.items : [{ product_name: 'Subscription Plan Services', quantity: 1, unit_price: inv.subtotal, total_amount: inv.total_amount }]).map(it => `
    <tr>
      <td><strong>${it.product_name}</strong></td>
      <td style="text-align: center;">${it.quantity || 1}</td>
      <td style="text-align: right;">$${Number(it.unit_price || 0).toFixed(2)}</td>
      <td style="text-align: right; color: #64748b;">
        ${it.discount_amount > 0 ? '-$' + Number(it.discount_amount).toFixed(2) : (it.tax_amount > 0 ? '+$' + Number(it.tax_amount).toFixed(2) : '$0.00')}
      </td>
      <td style="text-align: right; font-weight: 700;">$${Number(it.total_amount || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  const discountRow = inv.discount_total > 0 ? `
    <div class="summary-line" style="color: #10b981;">
      <span>Discount:</span>
      <span>-$${Number(inv.discount_total).toFixed(2)}</span>
    </div>
  ` : '';

  const taxRow = inv.tax_total > 0 ? `
    <div class="summary-line">
      <span>Tax (GST/VAT):</span>
      <span>+$${Number(inv.tax_total).toFixed(2)}</span>
    </div>
  ` : '';

  const w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Invoice ${inv.invoice_number} — RECUR SMS</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; padding: 2.5rem; margin: 0; background: #fff; }
          .header-row { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 1.5rem; margin-bottom: 1.5rem; }
          .brand { font-size: 1.75rem; font-weight: 800; color: #0284c7; }
          .subbrand { font-size: 0.85rem; color: #64748b; margin-top: 0.2rem; }
          .badge { background: ${statusColor}; color: #fff; font-weight: 700; font-size: 0.85rem; padding: 6px 16px; border-radius: 9999px; text-transform: uppercase; }
          .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem; font-size: 0.9rem; }
          .meta-box h4 { font-size: 0.75rem; text-transform: uppercase; color: #64748b; margin: 0 0 0.5rem 0; letter-spacing: 0.5px; }
          .meta-box p { margin: 0.25rem 0; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
          th { background: #0f172a; color: #fff; font-size: 0.75rem; text-transform: uppercase; padding: 10px 12px; }
          td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 0.9rem; }
          tr:nth-child(even) { background: #f8fafc; }
          .summary-card { width: 280px; margin-left: auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; }
          .summary-line { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 4px 0; color: #64748b; }
          .summary-total { display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 800; color: #0284c7; border-top: 1px solid #cbd5e1; margin-top: 8px; padding-top: 8px; }
          .summary-balance { display: flex; justify-content: space-between; font-size: 0.9rem; font-weight: 700; color: ${balanceDue > 0 ? '#ef4444' : '#10b981'}; margin-top: 4px; }
          .footer { margin-top: 3rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; font-size: 0.75rem; color: #94a3b8; line-height: 1.5; }
          .print-actions { background: #f1f5f9; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; display: flex; gap: 1rem; align-items: center; }
          @media print {
            .print-actions { display: none !important; }
            body { padding: 0 !important; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          }
        </style>
      </head>
      <body>
        <div class="print-actions">
          <button onclick="window.print()" style="background: #0284c7; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 600; cursor: pointer;">🖨️ Print / Save as PDF</button>
          <span style="font-size: 0.85rem; color: #64748b;">(Or use your browser's Print dialog to export as PDF)</span>
        </div>

        <div class="header-row">
          <div>
            <div class="brand">⚡ RECUR SMS</div>
            <div class="subbrand">Subscription Management & Recurring Billing Platform</div>
            <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 4px;">Brightloop Software Inc. • billing@recursms.com</div>
          </div>
          <div style="text-align: right;">
            <span class="badge">${statusLabel}</span>
            <div style="font-size: 1.15rem; font-weight: 800; color: #0f172a; margin-top: 0.6rem;">${inv.invoice_number}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-box">
            <h4>Billed To</h4>
            <p><strong>${inv.customer_email || 'Customer'}</strong></p>
            <p style="color: #64748b;">Customer ID: ${inv.customer_id}</p>
            ${inv.subscription_number ? '<p style="color: #64748b;">Subscription: ' + inv.subscription_number + '</p>' : ''}
            ${inv.billing_cycle_start ? '<p style="color: #64748b;">Cycle: ' + inv.billing_cycle_start + ' to ' + inv.billing_cycle_end + '</p>' : ''}
          </div>
          <div class="meta-box" style="text-align: right;">
            <h4>Invoice Details</h4>
            <p><strong>Issue Date:</strong> ${inv.issue_date}</p>
            <p><strong>Due Date:</strong> ${inv.due_date}</p>
            <p style="color: #64748b;">Terms: Immediate / Net 7</p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="text-align: left;">Item Description</th>
              <th style="text-align: center; width: 60px;">Qty</th>
              <th style="text-align: right; width: 100px;">Unit Price</th>
              <th style="text-align: right; width: 90px;">Tax / Disc</th>
              <th style="text-align: right; width: 110px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="summary-card">
          <div class="summary-line">
            <span>Subtotal:</span>
            <span>$${Number(inv.subtotal || inv.total_amount).toFixed(2)}</span>
          </div>
          ${discountRow}
          ${taxRow}
          <div class="summary-total">
            <span>Total Due:</span>
            <span>$${Number(inv.total_amount).toFixed(2)}</span>
          </div>
          <div class="summary-balance">
            <span>Balance Due:</span>
            <span>$${balanceDue.toFixed(2)}</span>
          </div>
        </div>

        <div class="footer">
          <strong>Payment Remittance:</strong> Silicon Valley Commercial Bank &bull; Routing: 121000358 &bull; Account: 9876543210<br>
          Please include invoice number in wire details. Thank you for your partnership with Brightloop RECUR SMS.
        </div>
      </body>
    </html>
  `);
  w.document.close();
}

// Chart instances cache
let financeChartInstances = {
  revenue: null,
  subscriptions: null
};

// ================= FINANCE LEAD DASHBOARD =================
async function loadFinanceAnalytics() {
  try {
    const data = await apiCall('/finance/summary');
    const m = data.metrics;

    document.getElementById('fin-active-subs').innerText = m.active_subscriptions;
    document.getElementById('fin-revenue').innerText = `$${Number(m.total_revenue_collected).toFixed(2)}`;
    document.getElementById('fin-receivables').innerText = `$${Number(m.total_receivables_owed).toFixed(2)}`;
    document.getElementById('fin-overdue-count').innerText = m.overdue_invoices_count;
    document.getElementById('fin-overdue-amt').innerText = `Amount: $${Number(m.overdue_amount).toFixed(2)}`;

    // SLA benchmark verification badge
    const slaPill = document.getElementById('finance-sla-pill');
    slaPill.innerText = `Query SLA: ${data.performance.execution_time_ms} ms (${data.performance.sla_status})`;

    // Render Visual Charts with Chart.js
    renderFinanceCharts(data.charts);

    // Overdue list
    const overdueTbody = document.getElementById('fin-overdue-tbody');
    overdueTbody.innerHTML = data.overdue_invoices.length ? data.overdue_invoices.map(o => `
      <tr>
        <td><strong>${o.invoice_number}</strong></td>
        <td>${o.customer_email}</td>
        <td><span style="color: #ef4444; font-weight: 600;">${o.due_date}</span></td>
        <td><strong>$${Number(o.amount_due).toFixed(2)}</strong></td>
      </tr>
    `).join('') : `<tr><td colspan="4" style="text-align: center; color: #16a34a;">No overdue invoices! Accounts in healthy standing.</td></tr>`;

    // Payments list
    const payTbody = document.getElementById('fin-payments-tbody');
    payTbody.innerHTML = data.recent_payments.length ? data.recent_payments.map(p => `
      <tr>
        <td><strong>${p.transaction_reference}</strong></td>
        <td>${p.invoice_number}</td>
        <td>${p.customer_email}</td>
        <td><span class="brand-badge">${p.payment_method}</span></td>
        <td style="color: #16a34a; font-weight: 600;">$${Number(p.amount).toFixed(2)}</td>
        <td>${new Date(p.payment_date).toLocaleString()}</td>
      </tr>
    `).join('') : `<tr><td colspan="6" style="text-align: center; color: #94a3b8;">No payment transactions recorded yet.</td></tr>`;
  } catch (err) {}
}

function renderFinanceCharts(chartsData) {
  if (typeof Chart === 'undefined') return;

  // 1. Revenue Allocation & Aging Doughnut Chart
  const ctxRev = document.getElementById('chart-revenue-split');
  if (ctxRev) {
    if (financeChartInstances.revenue) {
      financeChartInstances.revenue.destroy();
    }

    const split = chartsData.revenue_split || { collected: 0, pending: 0, overdue: 0 };
    const hasData = (split.collected + split.pending + split.overdue) > 0;

    financeChartInstances.revenue = new Chart(ctxRev, {
      type: 'doughnut',
      data: {
        labels: ['Realized Revenue', 'Pending Current', 'Overdue Risk'],
        datasets: [{
          data: hasData ? [split.collected, split.pending, split.overdue] : [1, 0, 0],
          backgroundColor: hasData ? ['#10b981', '#f59e0b', '#ef4444'] : ['#e2e8f0'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return ` $${Number(context.raw || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
              }
            }
          }
        },
        cutout: '65%'
      }
    });
  }

  // 2. Subscriptions Lifecycle Status Bar Chart
  const ctxSubs = document.getElementById('chart-subscription-status');
  if (ctxSubs) {
    if (financeChartInstances.subscriptions) {
      financeChartInstances.subscriptions.destroy();
    }

    const subDist = chartsData.subscription_distribution || [];
    const labels = subDist.map(d => d.status);
    const counts = subDist.map(d => d.count);

    financeChartInstances.subscriptions = new Chart(ctxSubs, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['No Subscriptions'],
        datasets: [{
          label: 'Subscriptions Count',
          data: counts.length ? counts : [0],
          backgroundColor: '#3b82f6',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, precision: 0 }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });
  }
}

// ================= CUSTOMER SELF-SERVICE PORTAL =================
async function loadCustomerPortal() {
  try {
    const [subData, invData] = await Promise.all([
      apiCall('/customer/my-subscriptions'),
      apiCall('/customer/my-invoices')
    ]);

    state.cache.invoices = invData.invoices;
    state.cache.subscriptions = subData.subscriptions;

    // Render Subscriptions
    const subTbody = document.getElementById('customer-subs-tbody');
    subTbody.innerHTML = subData.subscriptions.length ? subData.subscriptions.map(s => `
      <tr>
        <td><strong>${s.subscription_number}</strong></td>
        <td>${s.plan_name}</td>
        <td><span class="brand-badge">${s.billing_interval}</span></td>
        <td><strong>${s.next_billing_date || 'N/A'}</strong></td>
        <td><span class="status-pill status-${s.status}">${s.status}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="downloadQuotationPDF('${s.id}', true)" title="Download Agreement PDF" style="margin-right: 4px;">📄 Agreement</button> ${s.status === 'Active' && s.allow_pause ? `<button class="btn btn-secondary btn-sm" onclick="handleCustomerSubAction('${s.id}', 'pause')">Pause</button>` : ''}
          ${s.status === 'Draft' ? `<button class="btn btn-primary btn-sm" onclick="handleCustomerSubAction('${s.id}', 'resume')">Resume</button>` : ''}
          ${s.allow_early_close && s.status !== 'Closed' ? `<button class="btn btn-danger btn-sm" onclick="handleCustomerSubAction('${s.id}', 'cancel')">Cancel</button>` : ''}
        </td>
      </tr>
    `).join('') : `<tr><td colspan="6" style="text-align: center; color: #94a3b8;">You do not have any subscriptions yet.</td></tr>`;

    // Render Invoices
    const invTbody = document.getElementById('customer-invoices-tbody');
    invTbody.innerHTML = invData.invoices.length ? invData.invoices.map(inv => `
      <tr>
        <td><strong>${inv.invoice_number}</strong></td>
        <td>${inv.issue_date}</td>
        <td>${inv.due_date}</td>
        <td><strong>$${Number(inv.total_amount).toFixed(2)}</strong></td>
        <td>$${Number(inv.paid_amount).toFixed(2)}</td>
        <td><span class="status-pill status-${inv.status}">${inv.status}</span></td>
        <td>
          ${inv.status !== 'Paid' && inv.status !== 'Cancelled' 
            ? `<button class="btn btn-primary btn-sm" onclick="openDemoPayment('${inv.id}', '${inv.invoice_number}', ${(inv.total_amount - inv.paid_amount)})">Pay Now</button>`
            : `<button class="btn btn-primary btn-sm" onclick="downloadInvoicePDF('${inv.id}', true)" title="Download Official Invoice PDF">📄 PDF</button> <button class="btn btn-secondary btn-sm" onclick="printInvoice('${inv.id}')">Receipt</button>`}
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7" style="text-align: center; color: #94a3b8;">No invoices issued yet.</td></tr>`;
  } catch (err) {}
}

async function handleCustomerSubAction(id, action) {
  if (!confirm(`Confirm action: ${action} subscription?`)) return;
  try {
    const res = await apiCall(`/customer/my-subscriptions/${id}/action`, 'POST', { action });
    showToast(res.message, 'success');
    loadCustomerPortal();
  } catch (err) {}
}

// ================= DEMO PAYMENT GATEWAY =================
function openDemoPayment(invId, invNum, balance) {
  state.activePaymentInvoiceId = invId;
  document.getElementById('demo-pay-inv-num').innerText = invNum;
  document.getElementById('demo-pay-amount').innerText = `$${Number(balance).toFixed(2)}`;
  selectPaymentMethod('UPI');
  openModal('modal-customer-pay');
}

function selectPaymentMethod(method) {
  state.selectedPayMethod = method;
  document.querySelectorAll('.payment-tab').forEach(t => t.classList.remove('selected'));

  const tabId = method === 'UPI' ? 'tab-pay-upi' : (method === 'QR' ? 'tab-pay-qr' : (method === 'CARD' ? 'tab-pay-card' : 'tab-pay-net'));
  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add('selected');

  const view = document.getElementById('pay-method-view');
  if (method === 'UPI') {
    view.innerHTML = `
      <div class="form-group" style="text-align: left;">
        <label>Enter Virtual Payment Address (UPI ID)</label>
        <input type="text" value="customer@okhdfcbank" id="demo-upi-id" placeholder="yourname@upi">
      </div>
      <p style="font-size: 0.8rem; color: #64748b;">A collect request will be simulated on your UPI app.</p>
    `;
  } else if (method === 'QR') {
    view.innerHTML = `
      <div class="qr-code-placeholder">[ QR CODE PLACEHOLDER ]</div>
      <p style="font-size: 0.85rem; font-weight: 600;">Scan with GPay / PhonePe / Paytm</p>
      <p style="font-size: 0.75rem; color: #64748b;">recursms.billing@icici</p>
    `;
  } else if (method === 'CARD') {
    view.innerHTML = `
      <div class="form-group" style="text-align: left;">
        <label>Card Number</label>
        <input type="text" value="4532 •••• •••• 8892" placeholder="4532 0000 0000 0000">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; text-align: left;">
        <div class="form-group">
          <label>Expiry</label>
          <input type="text" value="12/28">
        </div>
        <div class="form-group">
          <label>CVV</label>
          <input type="password" value="•••">
        </div>
      </div>
    `;
  } else {
    // NETBANKING
    view.innerHTML = `
      <div class="form-group" style="text-align: left;">
        <label>Select Bank</label>
        <select>
          <option>HDFC Bank</option>
          <option>ICICI Bank</option>
          <option>State Bank of India</option>
          <option>Axis Bank</option>
        </select>
      </div>
      <p style="font-size: 0.8rem; color: #64748b;">You will be simulated to your bank's secure netbanking portal.</p>
    `;
  }
}

async function executeDemoPayment() {
  if (!state.activePaymentInvoiceId) return;

  try {
    const res = await apiCall(`/customer/pay/${state.activePaymentInvoiceId}`, 'POST', {
      payment_method: state.selectedPayMethod,
      note: `Customer checkout simulation (${state.selectedPayMethod})`
    });

    showToast(`Payment successful! Ref: ${res.payment.reference}`, 'success');
    closeModal('modal-customer-pay');
    loadCustomerPortal();
  } catch (err) {}
}

// ================= Transactional Email Logs & Reminders =================
async function loadEmailLogs() {
  const tbody = document.getElementById('email-logs-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">Loading logs...</td></tr>';

  try {
    const res = await apiCall('/admin/email-logs');
    if (!res.email_logs || res.email_logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">No transactional emails dispatched yet. Trigger an action (password reset, billing run, or payment) to view records.</td></tr>';
      return;
    }

    tbody.innerHTML = res.email_logs.map(log => `
      <tr>
        <td style="font-weight: 600; color: #1e293b;">${escapeHtml(log.recipient)}</td>
        <td><span class="role-badge role-ADMIN" style="font-size: 0.75rem;">${log.template}</span></td>
        <td style="color: #475569;">${escapeHtml(log.subject)}</td>
        <td>
          <span class="status-pill status-${log.status === 'SENT' ? 'Active' : 'Cancelled'}">${log.status}</span>
        </td>
        <td style="font-size: 0.85rem; color: #64748b;">${new Date(log.created_at).toLocaleString()}</td>
        <td>
          ${log.preview_url ? `<a href="${log.preview_url}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none;">🔍 View Email</a>` : '<span style="color: #94a3b8; font-size: 0.8rem;">Logged via SMTP</span>'}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color: #ef4444; text-align: center;">Failed loading email logs: ${err.message}</td></tr>`;
  }
}

async function sendInvoiceReminder(invId) {
  try {
    const res = await apiCall(`/staff/invoices/${invId}/send-dunning`, 'POST');
    showToast(res.message, 'success');
  } catch (err) {
    showToast('Failed to dispatch reminder: ' + err.message, 'error');
  }
}

// Initial Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  updateNavbar();
});
