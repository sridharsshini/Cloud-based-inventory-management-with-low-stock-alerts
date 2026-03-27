(() => {
  const { useState, useEffect, useMemo } = React;

  if (window.Auth && typeof window.Auth.init === 'function') {
    window.Auth.init();
  }

  const cfg = window.APP_CONFIG || {};
  const API_BASE_URL = cfg.API_BASE_URL || '';

  const initialShopId = 'demo-shop-001';

  function classNames(...args) {
    return args.filter(Boolean).join(' ');
  }

  async function apiFetch(path, options = {}) {
    if (!API_BASE_URL) {
      throw new Error('API_BASE_URL is not configured. Edit config.js.');
    }
    const url = API_BASE_URL.replace(/\/$/, '') + path;
    const headers = Object.assign(
      {
        'Content-Type': 'application/json'
      },
      options.headers || {}
    );
    var token = window.Auth && typeof window.Auth.getToken === 'function' ? window.Auth.getToken() : null;
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let data;
      try {
      data = text ? JSON.parse(text) : null;
      } catch (e) {
      data = text;
      }
    if (!res.ok) {
      const msg = data && data.message ? data.message : `Request failed with ${res.status}`;
      const error = new Error(msg);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function App() {
    const [shopId, setShopId] = useState(initialShopId);
    const [shops, setShops] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [lowStockOnly, setLowStockOnly] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [creatingProduct, setCreatingProduct] = useState(false);
    const [createForm, setCreateForm] = useState({
      name: '',
      sku: '',
      category: '',
      unit: 'pcs',
      reorderThreshold: 10,
      currentStock: 0
    });
    const [adjusting, setAdjusting] = useState(false);
    const [adjustForm, setAdjustForm] = useState({
      quantity: -1,
      note: ''
    });

    const [lastSync, setLastSync] = useState(null);

    const lowStockCount = useMemo(
      () => products.filter((p) => typeof p.reorderThreshold === 'number' && p.currentStock <= p.reorderThreshold).length,
      [products]
    );

    const totalSkus = products.length;
    const totalUnits = products.reduce((sum, p) => sum + (p.currentStock || 0), 0);

    const filteredProducts = useMemo(() => {
      const q = search.trim().toLowerCase();
      return products.filter((p) => {
        if (lowStockOnly && !(typeof p.reorderThreshold === 'number' && p.currentStock <= p.reorderThreshold)) {
          return false;
        }
        if (categoryFilter !== 'all' && p.category !== categoryFilter) {
          return false;
        }
        if (!q) return true;
        return (
          (p.name || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q)
        );
      });
    }, [products, search, categoryFilter, lowStockOnly]);

    const categories = useMemo(() => {
      const set = new Set();
      products.forEach((p) => {
        if (p.category) set.add(p.category);
      });
      return Array.from(set);
    }, [products]);

    const apiConfigured = !!API_BASE_URL;

    useEffect(() => {
      if (apiConfigured) {
        loadShops();
      }
    }, [apiConfigured]);

    useEffect(() => {
      if (apiConfigured) {
        loadProducts();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shopId, apiConfigured]);

    async function loadShops() {
      try {
        var data = await apiFetch('/shops');
        setShops(data.items || []);
      } catch (e) {
        setShops([]);
      }
    }

    async function loadProducts() {
      setLoading(true);
      setError('');
      try {
        const data = await apiFetch(`/shops/${encodeURIComponent(shopId)}/products`);
        setProducts(data.items || []);
        setLastSync(new Date());
      } catch (e) {
        console.error(e);
        setError(e.message || 'Failed to load products');
      } finally {
        setLoading(false);
      }
    }

    async function loadHistory(product) {
      if (!product) return;
      setHistoryLoading(true);
      setHistory([]);
      try {
        const data = await apiFetch(`/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(product.productId)}/transactions?limit=20`);
        setHistory(data.items || []);
      } catch (e) {
        console.error(e);
      } finally {
        setHistoryLoading(false);
      }
    }

    function handleCreateFieldChange(field, value) {
      setCreateForm((prev) => ({
        ...prev,
        [field]: field === 'reorderThreshold' || field === 'currentStock'
          ? Number(value)
          : value
      }));
    }

    async function handleCreateProduct(e) {
      e.preventDefault();
      if (!createForm.name.trim()) return;
      setCreatingProduct(true);
      setError('');
      try {
        const payload = {
          name: createForm.name.trim(),
          sku: createForm.sku.trim() || undefined,
          category: createForm.category.trim() || 'General',
          unit: createForm.unit || 'pcs',
          reorderThreshold: Number.isFinite(createForm.reorderThreshold)
            ? createForm.reorderThreshold
            : 10,
          currentStock: Number.isFinite(createForm.currentStock)
            ? createForm.currentStock
            : 0
        };
        const created = await apiFetch(`/shops/${encodeURIComponent(shopId)}/products`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setProducts((prev) => [...prev, created]);
        setCreateForm({
          name: '',
          sku: '',
          category: '',
          unit: 'pcs',
          reorderThreshold: 10,
          currentStock: 0
        });
      } catch (e) {
        console.error(e);
        setError(e.message || 'Failed to create product');
      } finally {
        setCreatingProduct(false);
      }
    }

    function openAdjustModal(product, direction) {
      setSelectedProduct(product);
      setAdjustForm({
        quantity: direction === 'sale' ? -1 : 1,
        note: direction === 'sale' ? 'Sale' : 'Restock'
      });
      loadHistory(product);
    }

    async function handleAdjustStock(e) {
      e.preventDefault();
      if (!selectedProduct) return;
      const qty = Number(adjustForm.quantity);
      if (!Number.isFinite(qty) || qty === 0) return;

      setAdjusting(true);
      setError('');
      try {
        const payload = {
          quantity: qty,
          note: adjustForm.note || null
        };
        const result = await apiFetch(`/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(selectedProduct.productId)}/adjust-stock`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const updated = result.product;
        setProducts((prev) =>
          prev.map((p) => (p.productId === updated.productId ? updated : p))
        );
        await loadHistory(updated);
      } catch (e) {
        console.error(e);
        setError(e.message || 'Failed to adjust stock');
      } finally {
        setAdjusting(false);
      }
    }

    async function handleDeleteProduct(product) {
      if (!window.confirm(`Delete product "${product.name}"? This cannot be undone.`)) return;
      try {
        await apiFetch(`/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(product.productId)}`, {
          method: 'DELETE'
        });
        setProducts((prev) => prev.filter((p) => p.productId !== product.productId));
        if (selectedProduct && selectedProduct.productId === product.productId) {
          setSelectedProduct(null);
          setHistory([]);
        }
      } catch (e) {
        console.error(e);
        setError(e.message || 'Failed to delete product');
      }
    }

    const selectedLow = selectedProduct &&
      typeof selectedProduct.reorderThreshold === 'number' &&
      selectedProduct.currentStock <= selectedProduct.reorderThreshold;

    return React.createElement(
      'div',
      { className: 'shell' },
      React.createElement(
        'div',
        { className: 'shell-header' },
        React.createElement(
          'div',
          { className: 'traffic-dots' },
          React.createElement('div', { className: 'dot red' }),
          React.createElement('div', { className: 'dot amber' }),
          React.createElement('div', { className: 'dot green' })
        ),
        React.createElement('div', { className: 'shell-title' }, 'inventory/live-dashboard.js')
      ),
      React.createElement(
        'div',
        { className: 'app' },
        React.createElement(
          'div',
          { className: 'top-bar' },
          React.createElement(
            'div',
            { className: 'brand' },
            React.createElement('div', { className: 'brand-logo' }, 'In'),
            React.createElement(
              'div',
              null,
              React.createElement('div', { className: 'brand-text-title' }, 'Cloud Inventory'),
              React.createElement(
                'div',
                { className: 'brand-text-subtitle' },
                'Real-time stock for local retailers'
              )
            ),
            React.createElement(
              'div',
              { className: 'pill' },
              React.createElement('span', { className: 'pill-dot' }),
              React.createElement('span', { className: 'pill-label' }, 'Serverless · DynamoDB · SNS')
            )
          ),
          React.createElement(
            'div',
            { className: 'top-bar-right' },
            React.createElement(
              'div',
              { className: 'user-pill' },
              React.createElement('div', { className: 'avatar' }),
              React.createElement(
                'div',
                null,
                React.createElement(
                  'div',
                  { className: 'user-name' },
                  window.Auth && window.Auth.isLoggedIn() ? (window.Auth.getEmail() || 'Shop Owner') : 'Guest'
                ),
                React.createElement(
                  'div',
                  { className: 'user-meta' },
                  window.Auth && window.Auth.isLoggedIn() ? 'Signed in' : (cfg.COGNITO_USER_POOL_ID ? 'Sign in with Cognito' : 'Cognito not configured')
                )
              )
            ),
            window.Auth && window.Auth.isLoggedIn()
              ? React.createElement(
                  'button',
                  { className: 'btn-ghost', onClick: function () { window.Auth.logout(); } },
                  'Logout'
                )
              : React.createElement(
                  'button',
                  {
                    className: 'btn-ghost',
                    onClick: function () {
                      if (window.Auth && window.Auth.login) window.Auth.login();
                      else alert('Cognito not configured.');
                    }
                  },
                  React.createElement('span', null, 'Login'),
                  React.createElement('span', { style: { fontSize: 10, opacity: 0.8 } }, '↗')
                )
          )
        ),
        React.createElement(
          'div',
          { className: 'main-layout' },
          React.createElement(
            'div',
            { className: 'card' },
            React.createElement(
              'div',
              { className: 'card-header' },
              React.createElement(
                'div',
                { className: 'card-title-row' },
                React.createElement('div', { className: 'card-title' }, 'Inventory'),
                React.createElement(
                  'div',
                  { className: 'card-subtitle' },
                  'Live stock levels & alerts'
                )
              ),
              React.createElement(
                'div',
                { className: 'badge-soft' },
                apiConfigured ? 'API: connected' : 'API: configure config.js'
              )
            ),
            React.createElement(
              'div',
              { className: 'filters-row' },
              React.createElement(
                'select',
                {
                  className: 'select',
                  value: shopId,
                  onChange: (e) => setShopId(e.target.value)
                },
                shops.length > 0
                  ? shops.map(function (s) {
                      return React.createElement(
                        'option',
                        { key: s.shopId, value: s.shopId },
                        s.name || s.shopId
                      );
                    })
                  : [
                      React.createElement('option', { key: 'd1', value: 'demo-shop-001' }, 'Demo Shop · Small'),
                      React.createElement('option', { key: 'd2', value: 'demo-shop-002' }, 'Demo Shop · Medium'),
                      React.createElement('option', { key: 'd3', value: 'demo-shop-003' }, 'Demo Shop · Multi-branch')
                    ]
              ),
              React.createElement('input', {
                className: 'input',
                placeholder: 'Search by name or SKU…',
                value: search,
                onChange: (e) => setSearch(e.target.value)
              }),
              React.createElement(
                'select',
                {
                  className: 'select',
                  value: categoryFilter,
                  onChange: (e) => setCategoryFilter(e.target.value)
                },
                React.createElement('option', { value: 'all' }, 'All categories'),
                categories.map((cat) =>
                  React.createElement(
                    'option',
                    { key: cat, value: cat },
                    cat
                  )
                )
              ),
              React.createElement(
                'div',
                { className: 'segmented' },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: lowStockOnly ? '' : 'active',
                    onClick: () => setLowStockOnly(false)
                  },
                  'All'
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: lowStockOnly ? 'active' : '',
                    onClick: () => setLowStockOnly(true)
                  },
                  'Low stock'
                )
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'btn-xs',
                  onClick: () => loadProducts(),
                  disabled: !apiConfigured || loading
                },
                loading ? 'Refreshing…' : 'Refresh'
              )
            ),
            error &&
              React.createElement(
                'div',
                { className: 'alert-banner' },
                React.createElement('strong', null, 'Error: '),
                error
              ),
            React.createElement(
              'div',
              { className: 'table-wrapper' },
              filteredProducts.length === 0
                ? React.createElement(
                    'div',
                    { className: 'empty-state' },
                    apiConfigured
                      ? React.createElement(
                          React.Fragment,
                          null,
                          'No products yet. ',
                          React.createElement('span', null, 'Create one on the right to get started.')
                        )
                      : React.createElement(
                          React.Fragment,
                          null,
                          'Configure ',
                          React.createElement('span', null, 'API_BASE_URL'),
                          ' in config.js, then refresh.'
                        )
                  )
                : React.createElement(
                    'table',
                    null,
                    React.createElement(
                      'thead',
                      null,
                      React.createElement(
                        'tr',
                        null,
                        React.createElement('th', null, 'Product'),
                        React.createElement('th', null, 'SKU / Category'),
                        React.createElement('th', null, 'Stock'),
                        React.createElement('th', null, 'Threshold'),
                        React.createElement('th', null, 'Alerts'),
                        React.createElement('th', null, 'Actions')
                      )
                    ),
                    React.createElement(
                      'tbody',
                      null,
                      filteredProducts.map((p) => {
                        const low =
                          typeof p.reorderThreshold === 'number' &&
                          p.currentStock <= p.reorderThreshold;
                        const isSelected =
                          selectedProduct && selectedProduct.productId === p.productId;
                        return React.createElement(
                          'tr',
                          { key: p.productId || p.sku },
                          React.createElement(
                            'td',
                            null,
                            React.createElement(
                              'div',
                              null,
                              React.createElement(
                                'div',
                                { style: { fontWeight: 500 } },
                                p.name || '(Unnamed product)'
                              ),
                              React.createElement(
                                'div',
                                { style: { fontSize: 11, color: '#9ca3af' } },
                                p.unit || 'pcs'
                              )
                            )
                          ),
                          React.createElement(
                            'td',
                            null,
                            React.createElement(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                              React.createElement(
                                'span',
                                { style: { fontSize: 12 } },
                                p.sku || '—'
                              ),
                              React.createElement(
                                'span',
                                { className: classNames('tag', 'category') },
                                p.category || 'General'
                              )
                            )
                          ),
                          React.createElement(
                            'td',
                            null,
                            React.createElement(
                              'div',
                              { className: classNames('stock-chip', low ? 'low' : 'ok') },
                              React.createElement(
                                'span',
                                { className: 'stock-chip-label' },
                                p.currentStock ?? 0
                              ),
                              React.createElement(
                                'span',
                                { className: 'stock-chip-pill' },
                                low ? 'Needs attention' : 'Healthy'
                              )
                            )
                          ),
                          React.createElement(
                            'td',
                            null,
                            React.createElement(
                              'span',
                              { className: 'tag' },
                              p.reorderThreshold ?? '—'
                            )
                          ),
                          React.createElement(
                            'td',
                            null,
                            React.createElement(
                              'span',
                              { className: classNames('tag', low ? 'low' : '') },
                              low
                                ? 'Low stock · SNS alert'
                                : 'Above threshold'
                            )
                          ),
                          React.createElement(
                            'td',
                            null,
                            React.createElement(
                              'div',
                              { className: 'actions-cell' },
                              React.createElement(
                                'button',
                                {
                                  className: 'btn-xs primary',
                                  type: 'button',
                                  onClick: () => openAdjustModal(p, 'sale'),
                                  disabled: !apiConfigured
                                },
                                'Record sale'
                              ),
                              React.createElement(
                                'button',
                                {
                                  className: 'btn-xs',
                                  type: 'button',
                                  onClick: () => openAdjustModal(p, 'restock'),
                                  disabled: !apiConfigured
                                },
                                'Restock'
                              ),
                              React.createElement(
                                'button',
                                {
                                  className: classNames('btn-xs', isSelected && 'primary'),
                                  type: 'button',
                                  onClick: () => {
                                    setSelectedProduct(p);
                                    loadHistory(p);
                                  }
                                },
                                'History'
                              ),
                              React.createElement(
                                'button',
                                {
                                  className: 'btn-xs danger',
                                  type: 'button',
                                  onClick: () => handleDeleteProduct(p),
                                  disabled: !apiConfigured
                                },
                                'Delete'
                              )
                            )
                          )
                        );
                      })
                    )
                  )
            )
          ),
          React.createElement(
            'div',
            { className: 'secondary-column' },
            React.createElement(
              'div',
              { className: 'card' },
              React.createElement(
                'div',
                { className: 'card-header' },
                React.createElement(
                  'div',
                  { className: 'card-title-row' },
                  React.createElement('div', { className: 'card-title' }, 'Live overview'),
                  React.createElement(
                    'div',
                    { className: 'card-subtitle' },
                    'Per-shop inventory health'
                  )
                ),
                React.createElement(
                  'div',
                  { className: 'badge-soft' },
                  'Demo only · connect to QuickSight for deep analytics'
                )
              ),
              React.createElement(
                'div',
                { className: 'stats-row' },
                React.createElement(
                  'div',
                  { className: 'metric-card' },
                  React.createElement('div', { className: 'metric-label' }, 'SKUs'),
                  React.createElement('div', { className: 'metric-value' }, totalSkus),
                  React.createElement(
                    'div',
                    { className: 'metric-badge' },
                    lowStockCount,
                    ' low-stock'
                  )
                ),
                React.createElement(
                  'div',
                  { className: 'metric-card' },
                  React.createElement('div', { className: 'metric-label' }, 'Units on hand'),
                  React.createElement('div', { className: 'metric-value' }, totalUnits),
                  React.createElement(
                    'div',
                    { className: 'metric-badge' },
                    'Serverless · pay-per-request'
                  )
                ),
                React.createElement(
                  'div',
                  { className: 'metric-card' },
                  React.createElement('div', { className: 'metric-label' }, 'Low stock coverage'),
                  React.createElement(
                    'div',
                    { className: 'metric-value' },
                    totalSkus === 0 ? '—' : `${Math.round((1 - lowStockCount / Math.max(totalSkus, 1)) * 100)}%`
                  ),
                  React.createElement(
                    'div',
                    {
                      className: classNames(
                        'metric-badge',
                        totalSkus > 0 && lowStockCount / totalSkus > 0.4 && 'negative'
                      )
                    },
                    totalSkus === 0
                      ? 'Add SKUs to see coverage'
                      : lowStockCount / totalSkus > 0.4
                      ? 'Consider restocking strategy'
                      : 'Healthy stock mix'
                  )
                )
              ),
              React.createElement(
                'div',
                { className: 'status-row' },
                React.createElement(
                  'div',
                  { className: 'status-text' },
                  'Last sync: ',
                  React.createElement(
                    'span',
                    null,
                    lastSync ? lastSync.toLocaleTimeString() : 'not yet'
                  )
                ),
                React.createElement(
                  'div',
                  { className: 'badge-live' },
                  React.createElement('div', { className: 'dot-pulse' }),
                  'SNS alerts fire when stock drops below threshold'
                )
              )
            ),
            React.createElement(
              'div',
              { className: 'card' },
              React.createElement(
                'div',
                { className: 'card-header' },
                React.createElement(
                  'div',
                  { className: 'card-title-row' },
                  React.createElement('div', { className: 'card-title' }, 'New product'),
                  React.createElement(
                    'div',
                    { className: 'card-subtitle' },
                    'Add items to your catalog'
                  )
                ),
                React.createElement(
                  'div',
                  { className: 'badge-soft' },
                  'Threshold drives low-stock SNS alerts'
                )
              ),
              React.createElement(
                'form',
                { className: 'form-grid', onSubmit: handleCreateProduct },
                React.createElement(
                  'div',
                  { className: 'field' },
                  React.createElement('label', null, 'Name'),
                  React.createElement('input', {
                    className: 'input',
                    value: createForm.name,
                    onChange: (e) => handleCreateFieldChange('name', e.target.value),
                    placeholder: 'e.g. Whole wheat bread'
                  })
                ),
                React.createElement(
                  'div',
                  { className: 'field' },
                  React.createElement('label', null, 'SKU'),
                  React.createElement('input', {
                    className: 'input',
                    value: createForm.sku,
                    onChange: (e) => handleCreateFieldChange('sku', e.target.value),
                    placeholder: 'Optional SKU code'
                  })
                ),
                React.createElement(
                  'div',
                  { className: 'field' },
                  React.createElement('label', null, 'Category'),
                  React.createElement('input', {
                    className: 'input',
                    value: createForm.category,
                    onChange: (e) => handleCreateFieldChange('category', e.target.value),
                    placeholder: 'Snacks, Beverages, Dairy…'
                  })
                ),
                React.createElement(
                  'div',
                  { className: 'field' },
                  React.createElement('label', null, 'Unit'),
                  React.createElement('input', {
                    className: 'input',
                    value: createForm.unit,
                    onChange: (e) => handleCreateFieldChange('unit', e.target.value),
                    placeholder: 'pcs, kg, box…'
                  })
                ),
                React.createElement(
                  'div',
                  { className: 'field' },
                  React.createElement('label', null, 'Reorder threshold'),
                  React.createElement('input', {
                    className: 'input',
                    type: 'number',
                    value: createForm.reorderThreshold,
                    onChange: (e) => handleCreateFieldChange('reorderThreshold', e.target.value)
                  })
                ),
                React.createElement(
                  'div',
                  { className: 'field' },
                  React.createElement('label', null, 'Starting stock'),
                  React.createElement('input', {
                    className: 'input',
                    type: 'number',
                    value: createForm.currentStock,
                    onChange: (e) => handleCreateFieldChange('currentStock', e.target.value)
                  })
                ),
                React.createElement(
                  'div',
                  { className: 'field', style: { gridColumn: '1 / -1', marginTop: 4 } },
                  React.createElement(
                    'button',
                    {
                      className: 'btn-primary',
                      type: 'submit',
                      disabled: creatingProduct || !apiConfigured
                    },
                    creatingProduct ? 'Saving…' : 'Save product',
                    React.createElement('span', { style: { fontSize: 11, opacity: 0.9 } }, '⏎')
                  )
                )
              )
            ),
            React.createElement(
              'div',
              { className: 'card' },
              React.createElement(
                'div',
                { className: 'card-header' },
                React.createElement(
                  'div',
                  { className: 'card-title-row' },
                  React.createElement('div', { className: 'card-title' }, 'Stock activity'),
                  React.createElement(
                    'div',
                    { className: 'card-subtitle' },
                    selectedProduct
                      ? `History for ${selectedProduct.name || selectedProduct.sku}`
                      : 'Select a product to see its feed'
                  )
                ),
                React.createElement(
                  'div',
                  { className: 'badge-soft' },
                  'Sales, restocks & adjustments'
                )
              ),
              selectedProduct &&
                React.createElement(
                  'form',
                  { className: 'field', onSubmit: handleAdjustStock },
                  React.createElement(
                    'div',
                    { className: 'field-inline' },
                    React.createElement('label', null, 'Adjust stock'),
                    React.createElement('input', {
                      className: 'input',
                      style: { maxWidth: 90 },
                      type: 'number',
                      value: adjustForm.quantity,
                      onChange: (e) =>
                        setAdjustForm((prev) => ({
                          ...prev,
                          quantity: e.target.value
                        }))
                    }),
                    React.createElement(
                      'span',
                      { style: { fontSize: 11, color: '#9ca3af' } },
                      '(negative = sale, positive = restock)'
                    )
                  ),
                  React.createElement(
                    'div',
                    { className: 'field', style: { marginTop: 6 } },
                    React.createElement('label', null, 'Note'),
                    React.createElement('textarea', {
                      className: 'textarea',
                      value: adjustForm.note,
                      onChange: (e) =>
                        setAdjustForm((prev) => ({
                          ...prev,
                          note: e.target.value
                        })),
                      placeholder: 'Optional context (invoice, supplier, promotion…)'
                    })
                  ),
                  React.createElement(
                    'div',
                    { className: 'field', style: { marginTop: 8 } },
                    React.createElement(
                      'button',
                      {
                        className: 'btn-primary',
                        type: 'submit',
                        disabled: adjusting || !apiConfigured
                      },
                      adjusting ? 'Recording…' : 'Record movement'
                    )
                  ),
                  selectedLow &&
                    React.createElement(
                      'div',
                      { className: 'alert-banner' },
                      React.createElement(
                        'strong',
                        null,
                        'Low-stock: '
                      ),
                      'SNS alert will fire when this movement pushes stock below threshold.'
                    )
                ),
              React.createElement(
                'div',
                { className: 'history-list' },
                historyLoading
                  ? React.createElement(
                      'div',
                      { className: 'empty-state' },
                      'Loading history…'
                    )
                  : !selectedProduct
                  ? React.createElement(
                      'div',
                      { className: 'empty-state' },
                      'Select a product from the table to see its timeline.'
                    )
                  : history.length === 0
                  ? React.createElement(
                      'div',
                      { className: 'empty-state' },
                      'No transactions recorded yet for this product.'
                    )
                  : history.map((tx) =>
                      React.createElement(
                        'div',
                        { key: tx.transactionId, className: 'history-item' },
                        React.createElement(
                          'div',
                          { className: 'history-main' },
                          React.createElement(
                            'div',
                            { className: 'history-type' },
                            React.createElement(
                              'span',
                              {
                                className: classNames(
                                  'pill-type',
                                  tx.type === 'SALE'
                                    ? 'sale'
                                    : tx.type === 'RESTOCK'
                                    ? 'restock'
                                    : 'adjustment'
                                )
                              },
                              tx.type
                            )
                          ),
                          React.createElement(
                            'div',
                            null,
                            'Qty ',
                            tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity
                          ),
                          tx.note &&
                            React.createElement(
                              'div',
                              { className: 'history-note' },
                              tx.note
                            )
                        ),
                        React.createElement(
                          'div',
                          { className: 'history-meta' },
                          React.createElement(
                            'div',
                            null,
                            'Bal: ',
                            tx.balanceAfter
                          ),
                          React.createElement(
                            'div',
                            null,
                            new Date(tx.createdAt).toLocaleString()
                          )
                        )
                      )
                    )
              )
            )
          )
        )
      )
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();

