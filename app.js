'use strict';
/* Mi Petshop — app web instalable, sin dependencias.
   Todo se guarda en el celular (IndexedDB). Funciona sin internet. */
(function () {
  // ------------------------------------------------------------ utilidades
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
  const fq = n => String(r3(n)).replace('.', ','); // cantidad con coma decimal
  const money = n => '$ ' + r2(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const num = s => { const v = parseFloat(String(s == null ? '' : s).replace(',', '.')); return isNaN(v) ? 0 : v; };
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const d2 = n => String(n).padStart(2, '0');
  const fmtDate = ts => { const d = new Date(ts); return d2(d.getDate()) + '/' + d2(d.getMonth() + 1) + '/' + d.getFullYear(); };
  const fmtDT = ts => { const d = new Date(ts); return fmtDate(ts) + ' ' + d2(d.getHours()) + ':' + d2(d.getMinutes()); };
  const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const DAY = 864e5;
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

  const CATS = ['Perro', 'Gato', 'Higiene', 'Accesorios', 'Otros'];
  const UNITS = ['Unidad', 'Bolsa', 'Kg', 'Litro', 'Caja'];
  const METHODS = { efectivo: 'Efectivo', transferencia: 'Transferencia', cc: 'Cuenta corriente' };

  const PAW = '<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="16.5" rx="5" ry="4.2"/><circle cx="5.2" cy="11" r="2.1"/><circle cx="9" cy="6.5" r="2.1"/><circle cx="15" cy="6.5" r="2.1"/><circle cx="18.8" cy="11" r="2.1"/></svg>';
  const ICONS = {
    inicio: '<svg viewBox="0 0 24 24"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg>',
    venta: '<svg viewBox="0 0 24 24"><path d="M7 4h-3v2h2l3 9h9l2-7H8zM9 19a1.6 1.6 0 1 0 .01 0zm8 0a1.6 1.6 0 1 0 .01 0z"/></svg>',
    productos: '<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4zm9-1.8L6.2 7.7 12 10.3l5.8-2.6zM5 9.4v6.3l6 2.7v-6.3zm14 0l-6 2.7v6.3l6-2.7z"/></svg>',
    clientes: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg>',
    mas: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>'
  };

  // ------------------------------------------------------- base de datos local
  const STORES = ['products', 'customers', 'sales', 'payments', 'stockMoves', 'config'];
  let DB = null;

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('petshop', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        STORES.forEach(s => {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id', autoIncrement: s !== 'config' });
        });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const txDone = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  const getAll = s => req(DB.transaction(s).objectStore(s).getAll());
  const getOne = (s, id) => req(DB.transaction(s).objectStore(s).get(id));
  const putOne = (s, o) => req(DB.transaction(s, 'readwrite').objectStore(s).put(o));
  const delOne = (s, id) => req(DB.transaction(s, 'readwrite').objectStore(s).delete(id));

  async function getConfig() {
    const c = await getOne('config', 'main');
    return Object.assign({ id: 'main', bizName: 'Mi Petshop', lastBackup: 0 }, c || {});
  }
  async function setConfig(patch) { const c = await getConfig(); return putOne('config', Object.assign(c, patch)); }

  // Guarda la venta y descuenta el stock en una sola operación.
  async function saveSale(sale) {
    const prods = {};
    (await getAll('products')).forEach(p => { prods[p.id] = p; });
    const tx = DB.transaction(['sales', 'products'], 'readwrite');
    const done = txDone(tx);
    sale.items.forEach(it => {
      const p = prods[it.pid];
      if (p) { p.stock = r3((p.stock || 0) - it.qty); tx.objectStore('products').put(p); }
    });
    const idReq = tx.objectStore('sales').add(sale);
    const id = await req(idReq);
    await done;
    return id;
  }

  async function voidSale(id) {
    const sale = await getOne('sales', id);
    if (!sale) return;
    const prods = {};
    (await getAll('products')).forEach(p => { prods[p.id] = p; });
    const tx = DB.transaction(['sales', 'products'], 'readwrite');
    const done = txDone(tx);
    sale.items.forEach(it => {
      const p = prods[it.pid];
      if (p) { p.stock = r3((p.stock || 0) + it.qty); tx.objectStore('products').put(p); }
    });
    tx.objectStore('sales').delete(id);
    await done;
  }

  async function saveStockEntry(lines, supplier, mode) {
    const prods = {};
    (await getAll('products')).forEach(p => { prods[p.id] = p; });
    const tx = DB.transaction(['stockMoves', 'products'], 'readwrite');
    const done = txDone(tx);
    const ts = Date.now();
    lines.forEach(l => {
      const p = prods[l.pid];
      if (!p) return;
      const qty = mode === 'ajuste' ? -Math.abs(l.qty) : Math.abs(l.qty);
      p.stock = r3((p.stock || 0) + qty);
      if (mode === 'ingreso' && l.cost > 0) p.cost = l.cost;
      tx.objectStore('products').put(p);
      tx.objectStore('stockMoves').add({ ts, pid: p.id, name: p.name, qty, cost: l.cost || 0, supplier: supplier || '', type: mode });
    });
    await done;
  }

  // Saldo de cada cliente = ventas en cuenta corriente - pagos registrados.
  async function computeBalances() {
    const [sales, pays] = await Promise.all([getAll('sales'), getAll('payments')]);
    const bal = {}; const last = {};
    sales.forEach(s => {
      if (s.customerId) { last[s.customerId] = Math.max(last[s.customerId] || 0, s.ts); }
      if (s.method === 'cc' && s.customerId) bal[s.customerId] = r2((bal[s.customerId] || 0) + s.total);
    });
    pays.forEach(p => { bal[p.customerId] = r2((bal[p.customerId] || 0) - p.amount); });
    return { bal, last, sales, pays };
  }

  // -------------------------------------------------------------- WhatsApp
  function normalizePhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('54')) return d;
    d = d.replace(/^0+/, '');
    d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2'); // quita el "15"
    return '549' + d;
  }
  function openWhatsApp(phone, text) {
    const n = normalizePhone(phone);
    const url = (n ? 'https://wa.me/' + n : 'https://wa.me/') + '?text=' + encodeURIComponent(text);
    window.open(url, '_blank');
  }
  function receiptText(sale, biz, balance) {
    const L = [];
    L.push('*' + biz + '*');
    L.push('Comprobante de venta N° ' + sale.id);
    L.push(fmtDT(sale.ts));
    if (sale.customerName) L.push('Cliente: ' + sale.customerName);
    L.push('--------------------');
    sale.items.forEach(i => {
      const q = i.loose ? fq(i.qty) + ' ' + (i.unit || 'kg') : fq(i.qty) + ' x';
      L.push(q + ' ' + i.name + '  ' + money(i.price * i.qty));
    });
    L.push('--------------------');
    L.push('*TOTAL: ' + money(sale.total) + '*');
    L.push('Pago: ' + METHODS[sale.method]);
    if (sale.method === 'cc' && balance != null) L.push('Saldo de tu cuenta: ' + money(balance));
    L.push('¡Gracias por tu compra!');
    return L.join('\n');
  }

  // ---------------------------------------------------------------- estado
  const newCart = () => ({ items: [], customerId: null, customerName: '', method: 'efectivo', q: '' });
  const state = {
    view: 'inicio', params: {}, stack: [], cart: newCart(),
    pq: '', pfilter: 'Todos', cq: '', cfilter: 'Todos',
    stockLines: [], stockMode: 'ingreso', supplier: '', sq: ''
  };
  let renderTok = 0;

  function tab(v, p) { state.stack = []; state.view = v; state.params = p || {}; return render(); }
  function go(v, p) { state.stack.push({ view: state.view, params: state.params }); state.view = v; state.params = p || {}; window.scrollTo(0, 0); return render(); }
  function back() {
    const s = state.stack.pop();
    if (s) { state.view = s.view; state.params = s.params; } else { state.view = 'inicio'; state.params = {}; }
    return render();
  }

  // ------------------------------------------------------------- interfaz
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  let modalHandlers = {};
  function openModal(html, handlers) { modalHandlers = handlers || {}; const m = $('#modal'); m.innerHTML = '<div class="sheet">' + html + '</div>'; m.classList.remove('hidden'); }
  function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; modalHandlers = {}; }

  function askNumber(title, initial, hint) {
    return new Promise(res => {
      openModal('<h3>' + esc(title) + '</h3>' + (hint ? '<p class="muted sm" style="margin-top:-6px">' + esc(hint) + '</p>' : '') +
        '<input id="mnum" type="text" inputmode="decimal" value="' + esc(initial == null ? '' : initial) + '">' +
        '<div class="btnrow"><button class="btn ghost" data-act="m-cancel">Cancelar</button><button class="btn" data-act="m-ok">Aceptar</button></div>', {
        ok: () => { const v = num($('#mnum').value); closeModal(); res(v > 0 ? v : null); },
        cancel: () => { closeModal(); res(null); }
      });
      setTimeout(() => { const i = $('#mnum'); if (i) { i.focus(); i.select(); } }, 60);
    });
  }

  function navHtml(active) {
    const items = [['inicio', 'Inicio'], ['venta', 'Venta'], ['productos', 'Productos'], ['clientes', 'Clientes'], ['mas', 'Más']];
    return '<nav class="nav">' + items.map(i => '<button class="' + (i[0] === active ? 'on' : '') + '" data-act="tab" data-v="' + i[0] + '"><span class="ic">' + ICONS[i[0]] + '</span>' + i[1] + '</button>').join('') + '</nav>';
  }
  function netBadge() {
    const on = navigator.onLine !== false;
    return '<span class="netbadge ' + (on ? '' : 'off') + '" id="net"><i></i>' + (on ? 'En línea' : 'Sin conexión') + '</span>';
  }
  function shell(o) {
    return '<header class="bar">' + (o.back ? '<button class="back" data-act="back" aria-label="Volver">‹</button>' : '') +
      '<h1>' + esc(o.title) + '</h1>' + (o.action ? '<button class="baract" data-act="' + o.action.act + '">' + esc(o.action.label) + '</button>' : netBadge()) + '</header>' +
      '<main class="content ' + (o.footer ? 'hasfooter' : '') + (o.fab ? ' hasfab' : '') + '">' + o.body + '</main>' +
      (o.footer ? '<div class="footer-bar ' + (o.footerClass || '') + '">' + o.footer + '</div>' : '') +
      (o.fab ? '<button class="fab" data-act="' + o.fab.act + '">' + esc(o.fab.label) + '</button>' : '') +
      (o.nav ? navHtml(o.nav) : '');
  }
  const thumb = p => '<div class="thumb t-' + esc(p.category || 'Otros') + '">' + PAW + '</div>';
  const stockChip = p => {
    const low = (p.stock || 0) <= (p.minStock || 0);
    const cls = (p.stock || 0) <= 0 ? 'red' : (low ? 'amber' : 'green');
    const lbl = (p.stock || 0) <= 0 ? 'Sin stock' : 'Stock ' + fq(p.stock);
    return '<span class="chip ' + (low && (p.stock || 0) > 0 ? 'amber' : cls) + '">' + lbl + '</span>';
  };
  const activeProducts = async () => (await getAll('products')).filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const matchProd = (p, q) => { const n = norm(q); return !n || norm(p.name).includes(n) || norm(p.brand).includes(n) || String(p.barcode || '') === q.trim() || norm(p.barcode).includes(n); };

  // ---------------------------------------------------------------- vistas
  const views = {};
  const partials = {};

  // ---- Inicio
  views.inicio = async () => {
    const [prods, cfg, data] = await Promise.all([activeProducts(), getConfig(), computeBalances()]);
    const now = Date.now(), t0 = startOfDay(now);
    const mo = new Date(); const m0 = new Date(mo.getFullYear(), mo.getMonth(), 1).getTime();
    const today = data.sales.filter(s => s.ts >= t0);
    const month = data.sales.filter(s => s.ts >= m0);
    const sum = a => r2(a.reduce((x, s) => x + s.total, 0));
    const profit = r2(today.reduce((x, s) => x + s.items.reduce((y, i) => y + (i.price - (i.cost || 0)) * i.qty, 0), 0));
    const low = prods.filter(p => (p.stock || 0) <= (p.minStock || 0) && (p.minStock > 0 || p.stock <= 0)).slice(0, 5);
    const days = cfg.lastBackup ? Math.floor((now - cfg.lastBackup) / DAY) : null;
    const backupAlert = (days === null || days >= 7)
      ? '<div class="alert"><span class="grow">' + (days === null ? 'Todavía no hiciste ninguna copia de seguridad' : 'Última copia de seguridad: hace ' + days + ' días') + '</span><button data-act="backup">Guardar copia</button></div>' : '';
    const body = backupAlert +
      '<div class="hero"><small>Ventas de hoy</small><div class="big">' + money(sum(today)) + '</div><small>' + today.length + (today.length === 1 ? ' venta' : ' ventas') + (today.length ? ' · Ticket prom. ' + money(sum(today) / today.length) : '') + '</small></div>' +
      '<div class="minis"><div class="card"><small>Este mes</small><b>' + money(sum(month)) + '</b></div><div class="card"><small>Ganancia hoy</small><b style="color:var(--primary)">' + money(profit) + '</b></div></div>' +
      '<h2>Stock bajo <a data-act="lowstock">Ver todo</a></h2>' +
      (low.length ? low.map(p => '<div class="card row" data-act="edit-prod" data-id="' + p.id + '">' + thumb(p) + '<div class="grow"><div class="name">' + esc(p.name) + '</div>' + stockChip(p) + '</div></div>').join('')
        : '<div class="card muted sm">' + (prods.length ? 'Todo en orden: ningún producto por debajo del mínimo.' : 'Todavía no cargaste productos.') + '</div>') +
      '<h2>Accesos rápidos</h2><div class="minis">' +
      '<button class="card" data-act="tab" data-v="venta"><b>+</b><br><span class="sm">Nueva venta</span></button>' +
      '<button class="card" data-act="new-stock"><b>+</b><br><span class="sm">Ingresar stock</span></button>' +
      '<button class="card" data-act="debtors"><b>$</b><br><span class="sm">Cobrar deuda</span></button></div>';
    return shell({ title: cfg.bizName, body, nav: 'inicio' });
  };

  // ---- Nueva venta
  const cartTotal = () => r2(state.cart.items.reduce((s, i) => s + i.price * i.qty, 0));
  partials.venta = async () => {
    const c = state.cart;
    if (c.q) {
      const prods = (await activeProducts()).filter(p => matchProd(p, c.q)).slice(0, 25);
      if (!prods.length) return '<div class="empty"><b>Sin resultados</b>No hay productos que coincidan con "' + esc(c.q) + '".</div>';
      return prods.map(p => '<div class="card row" data-act="add-cart" data-id="' + p.id + '">' + thumb(p) + '<div class="grow"><div class="name">' + esc(p.name) + '</div><div class="muted sm">' + esc(p.brand || '') + '</div>' + stockChip(p) + '</div><div class="bold">' + money(p.price) + '</div></div>').join('');
    }
    if (!c.items.length) return '<div class="empty"><b>Carrito vacío</b>Buscá un producto o escaneá su código de barras.</div>';
    return '<h2 style="margin-top:4px">Carrito (' + c.items.length + ')</h2>' + c.items.map((i, k) =>
      '<div class="card row"><div class="grow"><div class="name">' + esc(i.name) + '</div><div class="muted sm">' + money(i.price) + (i.loose ? ' por ' + esc(i.unit || 'kg') : ' c/u') + ' · <b>' + money(i.price * i.qty) + '</b></div></div>' +
      '<div class="stepper"><button data-act="dec" data-i="' + k + '">–</button><span data-act="qty" data-i="' + k + '">' + fq(i.qty) + '</span><button data-act="inc" data-i="' + k + '">+</button></div></div>').join('');
  };
  views.venta = async () => {
    const c = state.cart;
    const body = '<div class="search"><input id="vq" placeholder="Buscar producto o código" value="' + esc(c.q) + '" autocomplete="off"><button data-act="scan-cart">Escanear</button></div>' +
      '<div id="list">' + await partials.venta() + '</div>' +
      (c.q ? '' : '<div class="card row" data-act="pick-customer" style="margin-top:6px"><span class="muted grow">Cliente</span><b>' + (c.customerName ? esc(c.customerName) : 'Sin cliente') + '</b></div>' +
        '<div class="bold sm" style="margin:10px 0 0">Forma de pago</div><div class="pays">' +
        Object.keys(METHODS).map(k => '<button class="pill ' + (c.method === k ? 'on' : '') + '" data-act="method" data-m="' + k + '">' + METHODS[k] + '</button>').join('') + '</div>');
    const footer = '<div class="tot"><small>Total</small><b>' + money(cartTotal()) + '</b></div><button class="btn accent big" data-act="checkout">Cobrar</button>';
    return shell({ title: 'Nueva venta', body, footer, nav: 'venta', action: { act: 'clear-cart', label: 'Vaciar' } });
  };

  // ---- Productos
  partials.productos = async () => {
    let prods = await activeProducts();
    if (state.pfilter === 'Stock bajo') prods = prods.filter(p => (p.stock || 0) <= (p.minStock || 0));
    else if (state.pfilter !== 'Todos') prods = prods.filter(p => p.category === state.pfilter);
    prods = prods.filter(p => matchProd(p, state.pq));
    if (!prods.length) return '<div class="empty"><b>Sin productos</b>Tocá "+ Producto" para cargar el primero.</div>';
    return prods.map(p => '<div class="card row" data-act="edit-prod" data-id="' + p.id + '">' + thumb(p) + '<div class="grow"><div class="name">' + esc(p.name) + '</div><div class="muted sm">' + esc([p.brand, p.unit].filter(Boolean).join(' · ')) + '</div>' + stockChip(p) + '</div><div class="bold">' + money(p.price) + '</div></div>').join('');
  };
  views.productos = async () => {
    const filters = ['Todos'].concat(CATS, ['Stock bajo']);
    const body = '<div class="search"><input id="pq" placeholder="Buscar producto" value="' + esc(state.pq) + '" autocomplete="off"></div>' +
      '<div class="chips">' + filters.map(f => '<button class="pill ' + (state.pfilter === f ? 'on' : '') + '" data-act="pfilter" data-f="' + f + '">' + f + '</button>').join('') + '</div>' +
      '<div id="list">' + await partials.productos() + '</div>';
    return shell({ title: 'Productos', body, fab: { act: 'new-prod', label: '+  Producto' }, nav: 'productos' });
  };

  views.producto = async () => {
    const id = state.params.id;
    const p = id ? await getOne('products', id) : { name: '', category: 'Perro', brand: '', barcode: '', cost: '', price: '', stock: 0, minStock: 0, unit: 'Unidad', loose: false };
    const margin = p.cost > 0 && p.price > 0 ? Math.round((p.price - p.cost) / p.price * 100) : 0;
    const body = '<div class="field"><label>Nombre</label><input id="pf-name" value="' + esc(p.name) + '" placeholder="Ej: Alimento perro adulto 15 kg"></div>' +
      '<div class="field"><label>Categoría</label><select id="pf-cat">' + CATS.map(c => '<option ' + (p.category === c ? 'selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Marca</label><input id="pf-brand" value="' + esc(p.brand) + '"></div>' +
      '<div class="inline"><div class="field"><label>Código de barras</label><input id="pf-bar" inputmode="numeric" value="' + esc(p.barcode) + '"></div><button data-act="scan-field">Escanear</button></div>' +
      '<div class="fgrid"><div class="field"><label>Costo</label><input id="pf-cost" inputmode="decimal" value="' + esc(p.cost) + '"></div>' +
      '<div class="field"><label>Precio de venta' + (p.loose ? ' (por unidad suelta)' : '') + '</label><input id="pf-price" inputmode="decimal" value="' + esc(p.price) + '"></div>' +
      '<div class="field green"><label>Margen</label><input id="pf-margin" value="' + margin + ' %" disabled></div></div>' +
      '<div class="fgrid"><div class="field ' + ((p.stock || 0) <= (p.minStock || 0) && id ? 'red' : '') + '"><label>Stock actual</label><input id="pf-stock" inputmode="decimal" value="' + esc(p.stock) + '"></div>' +
      '<div class="field"><label>Stock mínimo</label><input id="pf-min" inputmode="decimal" value="' + esc(p.minStock) + '"></div>' +
      '<div class="field"><label>Unidad</label><select id="pf-unit">' + UNITS.map(u => '<option ' + (p.unit === u ? 'selected' : '') + '>' + u + '</option>').join('') + '</select></div></div>' +
      '<label class="switch">Permitir venta suelta (por kilo)<input id="pf-loose" type="checkbox" ' + (p.loose ? 'checked' : '') + '></label>' +
      (id ? '<div class="btnrow"><button class="btn ghost" data-act="stock-for" data-id="' + id + '">Ingresar stock</button><button class="btn" data-act="sell-prod" data-id="' + id + '">Vender</button></div>' +
        '<button class="btn danger block" data-act="del-prod" data-id="' + id + '" style="margin-top:6px">Eliminar producto</button>' : '');
    return shell({ title: id ? 'Producto' : 'Nuevo producto', back: true, body, action: { act: 'save-prod', label: 'Guardar' } });
  };

  // ---- Clientes
  partials.clientes = async () => {
    const [custs, data] = await Promise.all([getAll('customers'), computeBalances()]);
    let list = custs.filter(c => c.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (state.cfilter === 'Con deuda') list = list.filter(c => (data.bal[c.id] || 0) > 0);
    const n = norm(state.cq);
    if (n) list = list.filter(c => norm(c.name).includes(n) || norm(c.pet).includes(n) || String(c.phone || '').includes(n));
    if (!list.length) return '<div class="empty"><b>Sin clientes</b>' + (state.cfilter === 'Con deuda' ? 'Nadie tiene deuda pendiente.' : 'Tocá "+ Cliente" para agregar el primero.') + '</div>';
    return list.map(c => {
      const b = data.bal[c.id] || 0;
      const rp = repurchaseDays(c, data.last[c.id]);
      return '<div class="card row" data-act="open-cust" data-id="' + c.id + '"><div class="avatar">' + esc(initials(c.name)) + '</div><div class="grow"><div class="name">' + esc(c.name) + '</div><div class="muted sm">' + esc(c.pet || '') + '</div>' +
        (rp !== null && rp <= 5 ? '<span class="chip amber">' + (rp < 0 ? 'Recompra vencida' : rp === 0 ? 'Recompra hoy' : 'Recompra en ' + rp + ' días') + '</span>' : '') + '</div>' +
        (b > 0 ? '<span class="chip red">' + money(b) + '</span>' : '<span class="chip green">Al día</span>') + '</div>';
    }).join('');
  };
  function repurchaseDays(c, lastTs) {
    if (!c.repurchaseDays || !lastTs) return null;
    return Math.ceil((lastTs + c.repurchaseDays * DAY - Date.now()) / DAY);
  }
  views.clientes = async () => {
    const body = '<div class="search"><input id="cq" placeholder="Buscar cliente o mascota" value="' + esc(state.cq) + '" autocomplete="off"></div>' +
      '<div class="chips">' + ['Todos', 'Con deuda'].map(f => '<button class="pill ' + (state.cfilter === f ? 'on' : '') + '" data-act="cfilter" data-f="' + f + '">' + f + '</button>').join('') + '</div>' +
      '<div id="list">' + await partials.clientes() + '</div>';
    return shell({ title: 'Clientes', body, fab: { act: 'new-cust', label: '+  Cliente' }, nav: 'clientes' });
  };

  views.cliente = async () => {
    const id = state.params.id;
    const c = await getOne('customers', id);
    const [data, cfg] = await Promise.all([computeBalances(), getConfig()]);
    const b = data.bal[id] || 0;
    const rp = repurchaseDays(c, data.last[id]);
    const hist = data.sales.filter(s => s.customerId === id).map(s => ({ ts: s.ts, kind: 'sale', s }))
      .concat(data.pays.filter(p => p.customerId === id).map(p => ({ ts: p.ts, kind: 'pay', p }))).sort((a, b) => b.ts - a.ts);
    const body = '<div class="card"><div class="card row" style="padding:0;margin:0"><div class="avatar big">' + esc(initials(c.name)) + '</div><div class="grow"><div class="bold" style="font-size:15px">' + esc(c.name) + '</div><div class="muted sm">' + esc(c.pet || 'Sin mascota cargada') + '</div>' + (c.phone ? '<div class="muted sm">' + esc(c.phone) + '</div>' : '') + '</div></div>' +
      '<div style="border-top:1px solid var(--line);margin:12px 0"></div><div class="muted sm">Saldo cuenta corriente</div>' +
      '<div class="row" style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b style="font-size:22px;color:' + (b > 0 ? 'var(--red)' : 'var(--primary)') + '">' + money(b) + '</b>' +
      '<button class="btn sm" data-act="pay" data-id="' + id + '">Registrar pago</button></div>' +
      (rp !== null && rp <= 5 ? '<div style="margin-top:8px"><span class="chip amber">' + (rp < 0 ? 'Recompra vencida' : 'Recompra en ' + rp + ' días') + '</span></div>' : '') + '</div>' +
      '<div class="btnrow"><button class="btn ghost sm" data-act="edit-cust" data-id="' + id + '">Editar</button>' +
      (b > 0 ? '<button class="btn ghost sm" data-act="remind-debt" data-id="' + id + '">Avisar deuda</button>' : '') +
      '<button class="btn sm" data-act="sell-cust" data-id="' + id + '">Vender</button></div>' +
      '<h2>Movimientos</h2>' + (hist.length ? hist.map(h => h.kind === 'sale'
        ? '<div class="card row" data-act="sale-detail" data-id="' + h.s.id + '"><div class="grow"><div class="name">Venta N° ' + h.s.id + '</div><div class="muted sm">' + fmtDT(h.ts) + ' · ' + METHODS[h.s.method] + '</div></div><b>' + money(h.s.total) + '</b></div>'
        : '<div class="card row"><div class="grow"><div class="name">Pago recibido</div><div class="muted sm">' + fmtDT(h.ts) + ' · ' + esc(METHODS[h.p.method] || '') + '</div></div><b style="color:var(--primary)">– ' + money(h.p.amount) + '</b></div>').join('')
        : '<div class="card muted sm">Sin movimientos todavía.</div>');
    return shell({ title: 'Cliente', back: true, body });
  };

  views.clienteForm = async () => {
    const id = state.params.id;
    const c = id ? await getOne('customers', id) : { name: '', phone: '', pet: '', repurchaseDays: '', notes: '' };
    const body = '<div class="field"><label>Nombre</label><input id="cf-name" value="' + esc(c.name) + '"></div>' +
      '<div class="field"><label>Teléfono / WhatsApp (con código de área, sin 0 ni 15)</label><input id="cf-phone" inputmode="tel" value="' + esc(c.phone) + '" placeholder="Ej: 3875123456"></div>' +
      '<div class="field"><label>Mascota (nombre, especie, tamaño)</label><input id="cf-pet" value="' + esc(c.pet) + '" placeholder="Ej: Toby, perro labrador"></div>' +
      '<div class="field"><label>Aviso de recompra cada (días)</label><input id="cf-rep" inputmode="numeric" value="' + esc(c.repurchaseDays) + '" placeholder="Ej: 30"></div>' +
      '<div class="field"><label>Notas</label><textarea id="cf-notes">' + esc(c.notes) + '</textarea></div>' +
      (id ? '<button class="btn danger block" data-act="del-cust" data-id="' + id + '" style="margin-top:6px">Eliminar cliente</button>' : '');
    return shell({ title: id ? 'Editar cliente' : 'Nuevo cliente', back: true, body, action: { act: 'save-cust', label: 'Guardar' } });
  };

  // ---- Ingresar stock
  partials.stock = async () => {
    if (state.sq) {
      const prods = (await activeProducts()).filter(p => matchProd(p, state.sq)).slice(0, 15);
      return prods.length ? prods.map(p => '<div class="card row" data-act="stock-add" data-id="' + p.id + '">' + thumb(p) + '<div class="grow"><div class="name">' + esc(p.name) + '</div>' + stockChip(p) + '</div></div>').join('') : '<div class="empty">Sin resultados</div>';
    }
    return '';
  };
  views.stock = async () => {
    const prods = {}; (await getAll('products')).forEach(p => { prods[p.id] = p; });
    const mode = state.stockMode;
    const lines = state.stockLines.map((l, i) => {
      const p = prods[l.pid]; const cur = p ? p.stock || 0 : 0;
      const after = r3(cur + (mode === 'ajuste' ? -Math.abs(l.qty) : Math.abs(l.qty)));
      return '<div class="card"><div class="row" style="display:flex;gap:10px"><div class="grow"><div class="name">' + esc(l.name) + '</div><div class="sm" style="color:var(--primary);font-weight:500">Stock ' + fq(cur) + ' → ' + fq(after) + '</div></div><button class="muted" data-act="stock-del" data-i="' + i + '" style="font-size:20px">×</button></div>' +
        '<div class="fgrid" style="margin-top:8px"><div class="field" style="background:var(--bg)"><label>' + (mode === 'ajuste' ? 'Cantidad perdida' : 'Cantidad recibida') + '</label><input data-sl="qty" data-i="' + i + '" inputmode="decimal" value="' + esc(l.qty) + '"></div>' +
        (mode === 'ingreso' ? '<div class="field" style="background:var(--bg)"><label>Costo unitario</label><input data-sl="cost" data-i="' + i + '" inputmode="decimal" value="' + esc(l.cost) + '"></div>' : '') + '</div></div>';
    }).join('');
    const body = '<div class="chips"><button class="pill ' + (mode === 'ingreso' ? 'on' : '') + '" data-act="smode" data-m="ingreso">Ingreso de mercadería</button><button class="pill ' + (mode === 'ajuste' ? 'on' : '') + '" data-act="smode" data-m="ajuste">Ajuste / merma</button></div>' +
      '<div class="search"><input id="sq" placeholder="Buscar producto para agregar" value="' + esc(state.sq) + '" autocomplete="off"><button data-act="scan-stock">Escanear</button></div>' +
      '<div id="list">' + await partials.stock() + '</div>' +
      (state.sq ? '' : (lines || '<div class="empty"><b>Sin productos agregados</b>Buscá o escaneá los productos recibidos.</div>') +
        '<div class="field" style="margin-top:8px"><label>' + (mode === 'ingreso' ? 'Proveedor (opcional)' : 'Motivo (vencimiento, rotura, etc.)') + '</label><input id="sup" value="' + esc(state.supplier) + '"></div>');
    return shell({ title: mode === 'ingreso' ? 'Ingresar stock' : 'Ajuste de stock', back: true, body, footer: '<button class="btn accent big block" data-act="stock-confirm">' + (mode === 'ingreso' ? 'Confirmar ingreso' : 'Confirmar ajuste') + '</button>' });
  };

  // ---- Más / historial
  views.mas = async () => {
    const cfg = await getConfig();
    const body = '<div class="menu">' +
      '<button class="card" data-act="go-hist"><div>Historial de ventas<span>Ver, reenviar por WhatsApp o anular</span></div><i>›</i></button>' +
      '<button class="card" data-act="biz"><div>Datos del negocio<span>Nombre que aparece en los comprobantes</span></div><i>›</i></button>' +
      '<button class="card" data-act="backup"><div>Guardar copia de seguridad<span>' + (cfg.lastBackup ? 'Última: ' + fmtDT(cfg.lastBackup) : 'Todavía no hiciste ninguna') + '</span></div><i>›</i></button>' +
      '<button class="card" data-act="restore"><div>Restaurar copia de seguridad<span>Reemplaza todos los datos actuales</span></div><i>›</i></button>' +
      '<button class="card" data-act="sample"><div>Cargar productos de ejemplo<span>Para probar la app</span></div><i>›</i></button>' +
      '<button class="card" data-act="wipe"><div style="color:var(--red)">Borrar todos los datos<span>Empezar de cero</span></div><i>›</i></button></div>' +
      '<p class="muted sm" style="text-align:center;margin-top:18px">Los datos se guardan en este celular. Hacé una copia de seguridad seguido y no borres los datos del navegador.</p>' +
      '<input id="restore-file" type="file" accept="application/json,.json" style="display:none">';
    return shell({ title: 'Más', body, nav: 'mas' });
  };

  views.historial = async () => {
    const sales = (await getAll('sales')).sort((a, b) => b.ts - a.ts).slice(0, 100);
    const body = sales.length ? sales.map(s => '<div class="card row" data-act="sale-detail" data-id="' + s.id + '"><div class="grow"><div class="name">Venta N° ' + s.id + (s.customerName ? ' · ' + esc(s.customerName) : '') + '</div><div class="muted sm">' + fmtDT(s.ts) + ' · ' + METHODS[s.method] + '</div></div><b>' + money(s.total) + '</b></div>').join('')
      : '<div class="empty"><b>Sin ventas</b>Las ventas que registres van a aparecer acá.</div>';
    return shell({ title: 'Historial de ventas', back: true, body });
  };

  async function render() {
    const tok = ++renderTok;
    const html = await views[state.view]();
    if (tok !== renderTok) return;
    $('#app').innerHTML = html;
  }
  async function renderList() {
    const f = partials[state.view]; const el = $('#list');
    if (f && el) el.innerHTML = await f();
  }

  // ------------------------------------------------------- escáner de códigos
  function scanBarcode() {
    return new Promise(async res => {
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { toast('Este navegador no permite escanear. Escribí el código.'); return res(null); }
      let stream, stop = false;
      const finish = v => { stop = true; if (stream) stream.getTracks().forEach(t => t.stop()); closeModal(); res(v); };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch (e) { toast('No se pudo abrir la cámara (permiso denegado).'); return res(null); }
      openModal('<h3>Escaneá el código de barras</h3><video id="scanvid" class="video" playsinline muted></video><div class="btnrow"><button class="btn ghost" data-act="m-cancel">Cancelar</button></div>', { cancel: () => finish(null) });
      const v = $('#scanvid'); v.srcObject = stream; await v.play().catch(() => { });
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] });
      const loop = async () => {
        if (stop) return;
        try { const r = await det.detect(v); if (r.length) return finish(r[0].rawValue); } catch (e) { }
        setTimeout(loop, 250);
      };
      loop();
    });
  }

  // -------------------------------------------------------- copia de seguridad
  async function makeBackup() {
    const data = { app: 'petshop', version: 1, exportedAt: Date.now(), stores: {} };
    for (const s of STORES) data.stores[s] = await getAll(s);
    const text = JSON.stringify(data);
    const name = 'petshop-copia-' + new Date().toISOString().slice(0, 10) + '.json';
    const file = new File([text], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Copia de seguridad Mi Petshop' }); }
      else throw new Error('noshare');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
    await setConfig({ lastBackup: Date.now() });
    toast('Copia guardada');
    if (state.view === 'inicio' || state.view === 'mas') render();
  }
  async function restoreBackup(text) {
    const data = JSON.parse(text);
    if (!data || data.app !== 'petshop' || !data.stores) throw new Error('El archivo no es una copia válida de Mi Petshop');
    const tx = DB.transaction(STORES, 'readwrite'); const done = txDone(tx);
    STORES.forEach(s => { const os = tx.objectStore(s); os.clear(); (data.stores[s] || []).forEach(o => os.put(o)); });
    await done;
  }
  async function wipeAll() {
    const tx = DB.transaction(STORES, 'readwrite'); const done = txDone(tx);
    STORES.forEach(s => tx.objectStore(s).clear()); await done;
  }
  async function loadSamples() {
    const S = [
      ['Alimento perro adulto 15 kg', 'Perro', 'Marca A', 29000, 38900, 2, 4, 'Bolsa', 1], ['Alimento gato castrado 7,5 kg', 'Gato', 'Marca B', 21000, 29400, 9, 4, 'Bolsa', 1],
      ['Piedras sanitarias 10 kg', 'Gato', 'Marca C', 8200, 11800, 3, 5, 'Bolsa', 0], ['Shampoo antipulgas 250 ml', 'Higiene', 'Marca D', 4300, 6700, 14, 4, 'Unidad', 0],
      ['Correa reforzada mediana', 'Accesorios', 'Marca E', 5900, 8900, 6, 2, 'Unidad', 0], ['Snacks dentales x 7', 'Perro', 'Marca F', 2700, 4200, 5, 6, 'Unidad', 0]
    ];
    for (const s of S) await putOne('products', { name: s[0], category: s[1], brand: s[2], barcode: '', cost: s[3], price: s[4], stock: s[5], minStock: s[6], unit: s[7], loose: !!s[8], active: true });
  }

  // ---------------------------------------------------------------- acciones
  const A = {
    tab: d => tab(d.v),
    back: () => back(),
    'm-ok': () => modalHandlers.ok && modalHandlers.ok(),
    'm-cancel': () => modalHandlers.cancel ? modalHandlers.cancel() : closeModal(),
    'm-close': () => closeModal(),

    // inicio
    lowstock: () => { state.pfilter = 'Stock bajo'; state.pq = ''; return tab('productos'); },
    debtors: () => { state.cfilter = 'Con deuda'; state.cq = ''; return tab('clientes'); },
    'new-stock': () => { state.stockLines = []; state.sq = ''; state.stockMode = 'ingreso'; state.supplier = ''; return go('stock'); },

    // venta
    'add-cart': async d => {
      const p = await getOne('products', Number(d.id)); if (!p) return;
      let qty = 1;
      if (p.loose) { const v = await askNumber('Cantidad de ' + p.name + ' (' + (p.unit || 'kg') + ')', 1, 'Podés usar decimales, por ejemplo 0,5'); if (!v) return; qty = v; }
      const ex = state.cart.items.find(i => i.pid === p.id);
      if (ex) ex.qty = r3(ex.qty + qty); else state.cart.items.push({ pid: p.id, name: p.name, price: p.price, cost: p.cost || 0, qty, loose: !!p.loose, unit: p.unit });
      state.cart.q = ''; return render();
    },
    inc: d => { const i = state.cart.items[d.i]; i.qty = r3(i.qty + (i.loose ? 0.5 : 1)); return render(); },
    dec: d => { const i = state.cart.items[d.i]; i.qty = r3(i.qty - (i.loose ? 0.5 : 1)); if (i.qty <= 0) state.cart.items.splice(d.i, 1); return render(); },
    qty: async d => { const i = state.cart.items[d.i]; const v = await askNumber('Cantidad de ' + i.name, i.qty); if (v) { i.qty = v; render(); } },
    method: d => { state.cart.method = d.m; return render(); },
    'clear-cart': () => { state.cart = newCart(); return render(); },
    'scan-cart': async () => { const code = await scanBarcode(); if (code) { state.cart.q = code; await autoAddBarcode(code); render(); } },
    'pick-customer': async () => {
      const cs = (await getAll('customers')).filter(c => c.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'es'));
      openModal('<h3>Elegir cliente</h3><button class="listrow" data-act="cart-cust" data-id="0"><b>Sin cliente</b></button>' +
        cs.map(c => '<button class="listrow" data-act="cart-cust" data-id="' + c.id + '"><span>' + esc(c.name) + '</span><span class="muted sm">' + esc(c.pet || '') + '</span></button>').join('') +
        '<div class="btnrow"><button class="btn ghost" data-act="cart-newcust">+ Nuevo cliente</button></div>');
    },
    'cart-cust': async d => {
      closeModal();
      if (Number(d.id) === 0) { state.cart.customerId = null; state.cart.customerName = ''; if (state.cart.method === 'cc') state.cart.method = 'efectivo'; }
      else { const c = await getOne('customers', Number(d.id)); state.cart.customerId = c.id; state.cart.customerName = c.name; }
      return render();
    },
    'cart-newcust': () => { closeModal(); return go('clienteForm', { fromSale: true }); },
    checkout: async () => {
      const c = state.cart;
      if (!c.items.length) return toast('El carrito está vacío');
      if (c.method === 'cc' && !c.customerId) return toast('Elegí un cliente para vender en cuenta corriente');
      const prods = {}; (await getAll('products')).forEach(p => { prods[p.id] = p; });
      for (const i of c.items) {
        const p = prods[i.pid];
        if (p && i.qty > (p.stock || 0) && !confirm(p.name + ': stock ' + fq(p.stock || 0) + ', vendés ' + fq(i.qty) + '. ¿Continuar igual?')) return;
      }
      const sale = { ts: Date.now(), items: c.items.map(i => ({ pid: i.pid, name: i.name, price: i.price, cost: i.cost, qty: i.qty, loose: i.loose, unit: i.unit })), total: cartTotal(), method: c.method, customerId: c.customerId, customerName: c.customerName };
      sale.id = await saveSale(sale);
      state.cart = newCart();
      await render();
      showSaleDone(sale);
    },

    // productos
    pfilter: d => { state.pfilter = d.f; return render(); },
    'new-prod': () => go('producto', {}),
    'edit-prod': d => go('producto', { id: Number(d.id) }),
    'scan-field': async () => { const code = await scanBarcode(); if (code) $('#pf-bar').value = code; },
    'save-prod': async () => {
      const name = $('#pf-name').value.trim();
      if (!name) return toast('Escribí el nombre del producto');
      const price = num($('#pf-price').value);
      if (price <= 0) return toast('Poné el precio de venta');
      const id = state.params.id;
      const old = id ? await getOne('products', id) : {};
      const p = Object.assign({}, old, { name, category: $('#pf-cat').value, brand: $('#pf-brand').value.trim(), barcode: $('#pf-bar').value.trim(), cost: num($('#pf-cost').value), price, stock: num($('#pf-stock').value), minStock: num($('#pf-min').value), unit: $('#pf-unit').value, loose: $('#pf-loose').checked, active: true });
      if (id) p.id = id;
      await putOne('products', p);
      toast('Producto guardado'); return back();
    },
    'del-prod': async d => { if (!confirm('¿Eliminar este producto? Las ventas anteriores se conservan.')) return; const p = await getOne('products', Number(d.id)); p.active = false; await putOne('products', p); toast('Producto eliminado'); return back(); },
    'stock-for': async d => { const p = await getOne('products', Number(d.id)); state.stockLines = [{ pid: p.id, name: p.name, qty: 1, cost: p.cost || 0 }]; state.sq = ''; state.stockMode = 'ingreso'; state.supplier = ''; return go('stock'); },
    'sell-prod': async d => { state.stack = []; state.view = 'venta'; state.params = {}; await A['add-cart']({ id: d.id }); return render(); },

    // clientes
    cfilter: d => { state.cfilter = d.f; return render(); },
    'new-cust': () => go('clienteForm', {}),
    'open-cust': d => go('cliente', { id: Number(d.id) }),
    'edit-cust': d => go('clienteForm', { id: Number(d.id) }),
    'save-cust': async () => {
      const name = $('#cf-name').value.trim();
      if (!name) return toast('Escribí el nombre del cliente');
      const id = state.params.id;
      const old = id ? await getOne('customers', id) : {};
      const c = Object.assign({}, old, { name, phone: $('#cf-phone').value.trim(), pet: $('#cf-pet').value.trim(), repurchaseDays: num($('#cf-rep').value) || '', notes: $('#cf-notes').value.trim(), active: true });
      if (id) c.id = id;
      const key = await putOne('customers', c);
      if (state.params.fromSale) { state.cart.customerId = key; state.cart.customerName = name; }
      toast('Cliente guardado'); return back();
    },
    'del-cust': async d => { if (!confirm('¿Eliminar este cliente? Se conserva su historial de ventas.')) return; const c = await getOne('customers', Number(d.id)); c.active = false; await putOne('customers', c); state.stack = []; return tab('clientes'); },
    'sell-cust': async d => { const c = await getOne('customers', Number(d.id)); state.cart.customerId = c.id; state.cart.customerName = c.name; return tab('venta'); },
    pay: async d => {
      const id = Number(d.id); const { bal } = await computeBalances();
      openModal('<h3>Registrar pago</h3><p class="muted sm" style="margin-top:-6px">Saldo actual: ' + money(bal[id] || 0) + '</p><input id="pay-amt" type="text" inputmode="decimal" value="' + (bal[id] > 0 ? bal[id] : '') + '" placeholder="Monto"><select id="pay-m"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option></select>' +
        '<div class="btnrow"><button class="btn ghost" data-act="m-cancel">Cancelar</button><button class="btn" data-act="m-ok">Registrar</button></div>', {
        ok: async () => {
          const amt = num($('#pay-amt').value); if (amt <= 0) return toast('Ingresá un monto');
          await putOne('payments', { ts: Date.now(), customerId: id, amount: r2(amt), method: $('#pay-m').value });
          closeModal(); toast('Pago registrado'); render();
        }
      });
    },
    'remind-debt': async d => {
      const id = Number(d.id); const [c, { bal }, cfg] = await Promise.all([getOne('customers', id), computeBalances(), getConfig()]);
      openWhatsApp(c.phone, 'Hola ' + c.name + ', te escribimos de ' + cfg.bizName + '. Tu saldo pendiente es de ' + money(bal[id] || 0) + '. ¡Gracias!');
    },

    // stock
    smode: d => { state.stockMode = d.m; return render(); },
    'stock-add': async d => {
      const p = await getOne('products', Number(d.id));
      const ex = state.stockLines.find(l => l.pid === p.id);
      if (ex) ex.qty = r3(ex.qty + 1); else state.stockLines.push({ pid: p.id, name: p.name, qty: 1, cost: p.cost || 0 });
      state.sq = ''; return render();
    },
    'stock-del': d => { state.stockLines.splice(d.i, 1); return render(); },
    'scan-stock': async () => {
      const code = await scanBarcode(); if (!code) return;
      const p = (await activeProducts()).find(x => x.barcode === code);
      if (p) return A['stock-add']({ id: p.id }); toast('No hay ningún producto con ese código');
    },
    'stock-confirm': async () => {
      if (!state.stockLines.length) return toast('Agregá al menos un producto');
      if (state.stockLines.some(l => !(l.qty > 0))) return toast('Revisá las cantidades');
      await saveStockEntry(state.stockLines, state.supplier, state.stockMode);
      state.stockLines = []; state.supplier = ''; toast(state.stockMode === 'ingreso' ? 'Ingreso registrado' : 'Ajuste registrado'); return back();
    },

    // más
    'go-hist': () => go('historial'),
    'sale-detail': async d => {
      const s = await getOne('sales', Number(d.id)); if (!s) return;
      openModal('<h3>Venta N° ' + s.id + '</h3><div class="muted sm" style="margin:-6px 0 8px">' + fmtDT(s.ts) + (s.customerName ? ' · ' + esc(s.customerName) : '') + ' · ' + METHODS[s.method] + '</div>' +
        s.items.map(i => '<div class="sale-line"><span>' + fq(i.qty) + ' x ' + esc(i.name) + '</span><b>' + money(i.price * i.qty) + '</b></div>').join('') +
        '<div class="sale-line" style="border-top:1px solid var(--line);margin-top:6px;padding-top:10px;font-size:16px"><b>Total</b><b>' + money(s.total) + '</b></div>' +
        '<div class="btnrow"><button class="btn" data-act="wa-sale" data-id="' + s.id + '">WhatsApp</button><button class="btn danger" data-act="void-sale" data-id="' + s.id + '">Anular</button></div><button class="btn ghost block" data-act="m-close">Cerrar</button>');
    },
    'wa-sale': async d => {
      const s = await getOne('sales', Number(d.id)); const cfg = await getConfig();
      let phone = ''; let bal = null;
      if (s.customerId) { const c = await getOne('customers', s.customerId); phone = c ? c.phone : ''; bal = (await computeBalances()).bal[s.customerId] || 0; }
      openWhatsApp(phone, receiptText(s, cfg.bizName, bal));
    },
    'void-sale': async d => { if (!confirm('¿Anular esta venta? Se devuelve el stock y se quita del saldo del cliente.')) return; await voidSale(Number(d.id)); closeModal(); toast('Venta anulada'); return render(); },
    biz: async () => {
      const cfg = await getConfig();
      openModal('<h3>Datos del negocio</h3><input id="biz-name" type="text" value="' + esc(cfg.bizName) + '"><div class="btnrow"><button class="btn ghost" data-act="m-cancel">Cancelar</button><button class="btn" data-act="m-ok">Guardar</button></div>', {
        ok: async () => { const n = $('#biz-name').value.trim() || 'Mi Petshop'; await setConfig({ bizName: n }); closeModal(); toast('Guardado'); render(); }
      });
    },
    backup: () => makeBackup(),
    restore: () => { const f = $('#restore-file'); if (f) f.click(); },
    sample: async () => { if (!confirm('¿Cargar 6 productos de ejemplo?')) return; await loadSamples(); toast('Productos de ejemplo cargados'); },
    wipe: async () => { if (!confirm('Esto borra TODOS los productos, clientes y ventas de este celular. ¿Seguro?')) return; if (!confirm('Última confirmación: no se puede deshacer (salvo que tengas una copia de seguridad).')) return; await wipeAll(); state.cart = newCart(); toast('Datos borrados'); return render(); }
  };

  async function autoAddBarcode(code) {
    const p = (await activeProducts()).find(x => x.barcode && x.barcode === code);
    if (p) await A['add-cart']({ id: p.id });
  }

  function showSaleDone(sale) {
    openModal('<h3>Venta registrada</h3><div style="font-size:28px;font-weight:700;margin:4px 0 4px">' + money(sale.total) + '</div><div class="muted sm">Venta N° ' + sale.id + ' · ' + METHODS[sale.method] + (sale.customerName ? ' · ' + esc(sale.customerName) : '') + '</div>' +
      '<div class="btnrow"><button class="btn" data-act="wa-sale" data-id="' + sale.id + '">Enviar por WhatsApp</button></div><button class="btn ghost block" data-act="m-close">Listo</button>');
  }

  // ---------------------------------------------------------------- eventos
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (!el) { if (e.target.id === 'modal') (modalHandlers.cancel || closeModal)(); return; }
    const h = A[el.dataset.act];
    if (!h) return;
    try { await h(el.dataset, el); } catch (err) { console.error(err); toast('Error: ' + err.message); }
  });
  document.addEventListener('input', async e => {
    const t = e.target;
    if (t.dataset && t.dataset.sl) { const l = state.stockLines[t.dataset.i]; if (l) { l[t.dataset.sl] = num(t.value); } return; }
    switch (t.id) {
      case 'vq': state.cart.q = t.value; if (t.value && t.value.length >= 6) { const p = (await activeProducts()).find(x => x.barcode && x.barcode === t.value.trim()); if (p) { await A['add-cart']({ id: p.id }); return; } } return renderList();
      case 'pq': state.pq = t.value; return renderList();
      case 'cq': state.cq = t.value; return renderList();
      case 'sq': state.sq = t.value; return renderList();
      case 'sup': state.supplier = t.value; return;
      case 'pf-cost': case 'pf-price': { const c = num($('#pf-cost').value), p = num($('#pf-price').value); $('#pf-margin').value = (c > 0 && p > 0 ? Math.round((p - c) / p * 100) : 0) + ' %'; return; }
    }
  });
  document.addEventListener('change', async e => {
    if (e.target.id === 'restore-file' && e.target.files[0]) {
      const f = e.target.files[0];
      try {
        if (!confirm('Se van a reemplazar todos los datos actuales por los de la copia. ¿Continuar?')) return;
        await restoreBackup(await f.text()); toast('Copia restaurada'); state.cart = newCart(); tab('inicio');
      } catch (err) { toast('No se pudo restaurar: ' + err.message); }
      e.target.value = '';
    }
  });
  window.addEventListener('online', () => { const n = $('#net'); if (n) n.outerHTML = netBadge(); });
  window.addEventListener('offline', () => { const n = $('#net'); if (n) n.outerHTML = netBadge(); });

  // ----------------------------------------------------------------- inicio
  const ready = (async () => {
    DB = await openDB();
    if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) { } }
    await render();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') { try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('SW', e); } }
  })();

  // para pruebas automáticas
  window.App = { ready, state, A, go, tab, back, render, getAll, getOne, putOne, saveSale, voidSale, saveStockEntry, computeBalances, receiptText, normalizePhone, money, wipeAll, makeBackup, restoreBackup };
})();
