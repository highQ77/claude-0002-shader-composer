'use strict';
/* =========================================================================
 * 編輯器主程式：節點圖 UI、互動、屬性面板、預覽、存檔
 * ========================================================================= */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  /**
   * 自訂下拉選單。root 內需有 .dd-trigger 與 .dd-list；若 trigger 內有 .dd-label 則顯示目前選取的項目
   * entries: [{ value, label, group?, title? }]
   */
  function createDropdown(root, entries, onPick) {
    const btn = root.querySelector('.dd-trigger'), list = root.querySelector('.dd-list');
    const labelEl = btn.querySelector('.dd-label');
    const items = [];
    let active = -1, current = null, lastGroup = null;

    for (const en of entries) {
      if (en.group && en.group !== lastGroup) list.append(h('li', 'dd-group', (lastGroup = en.group)));
      const li = h('li', 'dd-item', en.label);
      li.setAttribute('role', 'option');
      if (en.title) li.title = en.title;
      list.append(li);
      items.push(li);
    }

    const setActive = i => {
      items[active]?.classList.remove('active');
      active = i;
      if (items[i]) { items[i].classList.add('active'); items[i].scrollIntoView({ block: 'nearest' }); }
    };
    const open = () => {
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      setActive(entries.findIndex(en => en.value === current));
    };
    const close = () => {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    const pick = i => {
      close();
      btn.focus();
      if (entries[i]) onPick(entries[i].value);
    };
    const indexOf = target => items.indexOf(target.closest('.dd-item'));

    btn.addEventListener('click', () => (list.hidden ? open() : close()));
    list.addEventListener('pointermove', e => { const i = indexOf(e.target); if (i >= 0 && i !== active) setActive(i); });
    list.addEventListener('click', e => { const i = indexOf(e.target); if (i >= 0) pick(i); });
    addEventListener('pointerdown', e => { if (!list.hidden && !root.contains(e.target)) close(); });
    root.addEventListener('keydown', e => {
      e.stopPropagation(); // 不觸發全域快捷鍵（空白鍵開節點選單等）
      const n = items.length;
      if (list.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); open();
          if (active < 0) setActive(e.key === 'ArrowUp' ? n - 1 : 0);
        }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % n); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + n) % n); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(n - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); active >= 0 ? pick(active) : close(); }
      else if (e.key === 'Escape' || e.key === 'Tab') close();
    });

    return {
      setValue(v) {
        if (!labelEl) return;
        current = v;
        items.forEach((li, i) => li.setAttribute('aria-selected', String(entries[i].value === v)));
        const en = entries.find(x => x.value === v);
        if (en) labelEl.textContent = en.label;
      },
    };
  }

  const graphEl = $('#graph'), layerEl = $('#layer'), linksG = $('#links'), tempWire = $('#temp-wire'), nodesEl = $('#nodes');
  const menuEl = $('#menu'), menuInput = $('#menu-input'), menuList = $('#menu-list');
  const previewCanvas = $('#preview'), errorEl = $('#error'), codeEl = $('#code');
  const propsEl = $('#tab-props');

  const STORAGE_KEY = 'shader-node-editor/v1';
  const THUMB_PX = 192;
  const LIGHT_DIR = (() => { const v = [0.45, 0.75, 0.5], l = Math.hypot(...v); return v.map(x => x / l); })();

  let graph = { nodes: [], links: [], nextId: 1 };
  let view = { x: 0, y: 0, scale: 1 };
  const selected = new Set();
  const nodeEls = new Map();      // id -> { el, ports, thumb, ctx, entry }
  let controls = [];              // 綁定到節點值的輸入元件（節點上 + 屬性面板，用來同步）
  let portTypes = {};
  const undoStack = [], redoStack = [];
  const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  let lastSrc = '';
  let zTop = 1;
  const assets = {};              // 圖片資源 id -> dataURL（不放進 undo 快照，避免佔用大量記憶體）
  const assetURL = id => (id && assets[id]) || '';

  /* ======================= 圖資料操作 ======================= */
  const getNode = id => graph.nodes.find(n => n.id === id);
  const snapshot = () => JSON.stringify(graph);
  const linkInto = (id, port) => graph.links.find(l => l.to === id && l.toPort === port);

  function pushUndo(before) {
    if (before === snapshot()) return;
    undoStack.push(before);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  function mutate(fn) {
    const before = snapshot();
    fn();
    pushUndo(before);
    changed();
  }
  function restore(json) {
    graph = JSON.parse(json);
    for (const id of [...selected]) if (!getNode(id)) selected.delete(id);
    changed();
  }
  function undo() { if (!undoStack.length) return toast('沒有可復原的動作'); redoStack.push(snapshot()); restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }

  /** 結構性變更：重建 DOM、連線、重新編譯、存檔 */
  function changed() {
    renderNodes();
    drawWires();
    renderPanel();
    scheduleCompile();
    scheduleSave();
  }

  function createNode(type, x, y, opts = {}) {
    const def = NODE_DEFS[type];
    const n = { id: graph.nextId++, type, x: Math.round(x), y: Math.round(y), values: {}, params: {}, preview: true };
    for (const i of def.inputs) if (i.default !== undefined) n.values[i.name] = i.default;
    for (const p of def.params) n.params[p.name] = p.default;
    Object.assign(n.values, opts.values || {});
    Object.assign(n.params, opts.params || {});
    graph.nodes.push(n);
    return n;
  }

  /** a 的上游是否包含 b */
  function upstreamHas(a, b) {
    const stack = [a], seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === b) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const l of graph.links) if (l.to === cur) stack.push(l.from);
    }
    return false;
  }

  function connect(from, fromPort, to, toPort) {
    if (from === to || upstreamHas(from, to)) { toast('不能建立循環連線'); return false; }
    graph.links = graph.links.filter(l => !(l.to === to && l.toPort === toPort));
    graph.links.push({ from, fromPort, to, toPort });
    return true;
  }

  function deleteNodes(ids) {
    const s = new Set(ids);
    graph.nodes = graph.nodes.filter(n => !s.has(n.id));
    graph.links = graph.links.filter(l => !s.has(l.from) && !s.has(l.to));
    ids.forEach(id => selected.delete(id));
  }

  function duplicateSelection() {
    if (!selected.size) return;
    mutate(() => {
      const map = new Map();
      for (const id of selected) {
        const n = getNode(id);
        if (!n || NODE_DEFS[n.type].unique) continue;
        const c = JSON.parse(JSON.stringify(n));
        c.id = graph.nextId++; c.x += 40; c.y += 40;
        graph.nodes.push(c);
        map.set(id, c.id);
      }
      for (const l of [...graph.links]) {
        if (!map.has(l.to)) continue;
        graph.links.push({ from: map.get(l.from) ?? l.from, fromPort: l.fromPort, to: map.get(l.to), toPort: l.toPort });
      }
      selected.clear();
      map.forEach(v => selected.add(v));
    });
  }

  function normalizeGraph(g) {
    if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.links)) throw new Error('格式不正確');
    const nodes = g.nodes.filter(n => NODE_DEFS[n.type]).map(n => {
      const def = NODE_DEFS[n.type];
      const values = {}, params = {};
      for (const i of def.inputs) if (i.default !== undefined) values[i.name] = i.default;
      for (const p of def.params) params[p.name] = p.default;
      return { id: +n.id, type: n.type, x: +n.x || 0, y: +n.y || 0,
        values: Object.assign(values, n.values), params: Object.assign(params, n.params), preview: n.preview !== false };
    });
    const ids = new Set(nodes.map(n => n.id));
    const links = g.links.filter(l => ids.has(l.from) && ids.has(l.to));
    return { nodes, links, nextId: Math.max(0, ...nodes.map(n => n.id)) + 1 };
  }

  /* ======================= 節點 DOM ======================= */
  function bindEdit(el, nodeId, key, apply) {
    controls.push({ nodeId, key, el });
    let before = null;
    el.addEventListener('input', () => {
      if (before === null) before = snapshot();
      if (apply(el.value) === false) return;
      syncControls(nodeId, key, el);
      scheduleCompile(); scheduleSave();
    });
    el.addEventListener('change', () => {
      apply(el.value);
      syncControls(nodeId, key, el);
      if (before !== null) { pushUndo(before); before = null; }
      scheduleCompile(); scheduleSave();
    });
  }
  function syncControls(nodeId, key, src) {
    controls = controls.filter(c => c.el.isConnected);
    for (const c of controls) if (c.nodeId === nodeId && c.key === key && c.el !== src) c.el.value = src.value;
  }

  function imageControl(n) {
    const wrap = h('div', 'img-ctl');
    wrap.append(h('span', 'img-name', n.params.image ? '自訂圖片' : '內建 UV 格線'));
    const pick = h('button', 'btn small', '選擇…');
    pick.title = '上傳圖片（也可以直接把圖檔拖進節點圖）';
    pick.onclick = () => pickImage(n.id);
    wrap.append(pick);
    if (n.params.image) {
      const reset = h('button', 'btn small', '✕');
      reset.title = '改回內建 UV 格線';
      reset.onclick = () => mutate(() => { n.params.image = ''; });
      wrap.append(reset);
    }
    return wrap;
  }

  function paramControl(n, p) {
    if (p.kind === 'image') return imageControl(n);
    let ctl;
    if (p.kind === 'select') {
      ctl = document.createElement('select');
      for (const [v, l] of p.options) ctl.append(new Option(l, v));
    } else {
      ctl = document.createElement('input');
      ctl.type = p.kind === 'color' ? 'color' : 'number';
      if (p.kind === 'number') ctl.step = p.step || 0.1;
    }
    ctl.value = n.params[p.name];
    bindEdit(ctl, n.id, 'param:' + p.name, v => {
      if (p.kind === 'number') { const f = parseFloat(v); if (isNaN(f)) return false; n.params[p.name] = f; }
      else n.params[p.name] = v;
    });
    return ctl;
  }
  function valueControl(n, inp) {
    const ctl = document.createElement('input');
    ctl.type = 'number';
    ctl.step = 0.1;
    ctl.value = n.values[inp.name] ?? inp.default ?? 0;
    bindEdit(ctl, n.id, 'in:' + inp.name, v => {
      const f = parseFloat(v);
      if (isNaN(f)) return false;
      n.values[inp.name] = f;
    });
    return ctl;
  }

  function makePort(nodeId, dir, name) {
    const p = h('span', 'port');
    p.dataset.node = nodeId; p.dataset.dir = dir; p.dataset.port = name;
    return p;
  }

  function buildNodeEl(n) {
    const def = NODE_DEFS[n.type];
    const cat = CATEGORY_MAP[def.category];
    const el = h('div', 'node' + (selected.has(n.id) ? ' selected' : ''));
    el.dataset.id = n.id;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.setProperty('--cat', cat.color);

    const head = h('div', 'node-head');
    head.append(h('span', 'node-title', def.title));
    if (def.outputs.length) {
      const t = h('button', 'icon-btn', n.preview !== false ? '▾' : '▸');
      t.title = '顯示 / 隱藏預覽';
      t.onclick = () => mutate(() => { n.preview = n.preview === false; });
      head.append(t);
    }
    const del = h('button', 'icon-btn', '✕');
    del.title = '刪除節點';
    del.onclick = () => mutate(() => deleteNodes([n.id]));
    head.append(del);
    el.append(head);

    const body = h('div', 'node-body');
    const ports = {};
    for (const o of def.outputs) {
      const row = h('div', 'row out');
      const port = makePort(n.id, 'out', o.name);
      row.append(h('label', '', o.name), port);
      body.append(row);
      ports['out:' + o.name] = port;
    }
    let thumb = null, ctx = null;
    if (def.outputs.length && n.preview !== false) {
      thumb = h('canvas', 'thumb');
      thumb.width = thumb.height = THUMB_PX;
      ctx = thumb.getContext('2d');
      body.append(thumb);
    }
    for (const p of def.params) {
      const row = h('div', 'row param');
      if (p.kind !== 'color' || def.params.length > 1) row.append(h('label', '', p.label || p.name));
      row.append(paramControl(n, p));
      body.append(row);
    }
    for (const inp of def.inputs) {
      const row = h('div', 'row in');
      const port = makePort(n.id, 'in', inp.name);
      row.append(port, h('label', '', inp.name));
      if (!linkInto(n.id, inp.name)) {
        if (inp.expr) row.append(h('span', 'tag', inp.exprLabel));
        else row.append(valueControl(n, inp));
      }
      body.append(row);
      ports['in:' + inp.name] = port;
    }
    el.append(body);
    return { el, ports, thumb, ctx };
  }

  function renderNodes() {
    const prevEntries = new Map([...nodeEls].map(([id, ne]) => [id, ne.entry]));
    nodesEl.textContent = '';
    nodeEls.clear();
    for (const n of graph.nodes) {
      const ne = buildNodeEl(n);
      ne.entry = prevEntries.get(n.id) || null;
      nodeEls.set(n.id, ne);
      nodesEl.append(ne.el);
    }
    applyPortColors();
  }

  function refreshSelection() {
    for (const [id, ne] of nodeEls) ne.el.classList.toggle('selected', selected.has(id));
    renderPanel();
  }

  function applyPortColors() {
    for (const [id, ne] of nodeEls) {
      for (const key in ne.ports) {
        const [dir, name] = key.split(':');
        const t = portTypes[id + ':' + dir + ':' + name];
        ne.ports[key].style.setProperty('--pc', TYPE_COLOR[t] || '#777');
        ne.ports[key].title = t || '';
      }
    }
  }

  /* ======================= 連線 ======================= */
  function portPos(nodeId, dir, port) {
    const ne = nodeEls.get(nodeId), n = getNode(nodeId);
    if (!ne || !n) return null;
    const p = ne.ports[dir + ':' + port];
    if (!p) return null;
    let x = p.offsetWidth / 2, y = p.offsetHeight / 2, el = p;
    while (el && el !== ne.el) {
      x += el.offsetLeft; y += el.offsetTop;
      const op = el.offsetParent;
      if (op) { x += op.clientLeft; y += op.clientTop; }
      el = op;
    }
    return { x: n.x + x, y: n.y + y };
  }

  function curve(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }

  function drawWires() {
    let html = '';
    for (const l of graph.links) {
      const a = portPos(l.from, 'out', l.fromPort), b = portPos(l.to, 'in', l.toPort);
      if (!a || !b) continue;
      const d = curve(a, b);
      const color = TYPE_COLOR[portTypes[l.from + ':out:' + l.fromPort]] || '#999';
      html += `<path class="wire-hit" d="${d}" data-to="${l.to}" data-port="${l.toPort}"><title>雙擊刪除</title></path>` +
              `<path class="wire" d="${d}" stroke="${color}"/>`;
    }
    linksG.innerHTML = html;
  }

  /* ======================= 視圖 ======================= */
  function applyView() {
    layerEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    const g = 24 * view.scale;
    graphEl.style.backgroundSize = `${g}px ${g}px`;
    graphEl.style.backgroundPosition = `${view.x}px ${view.y}px`;
    $('#zoom-label').textContent = Math.round(view.scale * 100) + '%';
  }
  function toWorld(cx, cy) {
    const r = graphEl.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.scale, y: (cy - r.top - view.y) / view.scale };
  }
  function frameAll() {
    if (!graph.nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of graph.nodes) {
      const ne = nodeEls.get(n.id);
      const w = ne ? ne.el.offsetWidth : 160, ht = ne ? ne.el.offsetHeight : 100;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + ht);
    }
    const r = graphEl.getBoundingClientRect(), pad = 50;
    const s = Math.min(1.1, Math.max(0.2, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
    view.scale = s;
    view.x = (r.width - (x1 - x0) * s) / 2 - x0 * s;
    view.y = (r.height - (y1 - y0) * s) / 2 - y0 * s;
    applyView();
    scheduleSave();
  }

  /* ======================= 互動：節點圖 ======================= */
  graphEl.addEventListener('pointerdown', e => {
    const port = e.target.closest('.port');
    if (port && e.button === 0) return startWire(port, e);
    if (e.target.closest('input, select, button, textarea')) return;
    const nodeEl = e.target.closest('.node');
    if (nodeEl && e.button === 0) return startNodeDrag(nodeEl, e);
    if (e.button === 0 || e.button === 1) startPan(e);
  });

  function startWire(portEl, e) {
    e.preventDefault();
    const before = snapshot();
    let dir = portEl.dataset.dir, nodeId = +portEl.dataset.node, port = portEl.dataset.port;
    // 從已連接的輸入拖曳 → 拔起原本的連線
    if (dir === 'in') {
      const l = linkInto(nodeId, port);
      if (l) {
        graph.links = graph.links.filter(x => x !== l);
        dir = 'out'; nodeId = l.from; port = l.fromPort;
        changed();
      }
    }
    const color = dir === 'out' ? TYPE_COLOR[portTypes[nodeId + ':out:' + port]] : '#ccd';
    tempWire.setAttribute('stroke', color || '#ccd');
    const move = ev => {
      const a = portPos(nodeId, dir, port);
      if (!a) return;
      const p = toWorld(ev.clientX, ev.clientY);
      tempWire.setAttribute('d', dir === 'out' ? curve(a, p) : curve(p, a));
      tempWire.style.display = '';
    };
    const up = ev => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      tempWire.style.display = 'none';
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = hit && hit.closest('.port');
      if (target && target.dataset.dir !== dir) {
        const tn = +target.dataset.node, tp = target.dataset.port;
        if (dir === 'out') connect(nodeId, port, tn, tp); else connect(tn, tp, nodeId, port);
        pushUndo(before);
        changed();
      } else {
        pushUndo(before);
        if (!target && hit && graphEl.contains(hit) && !hit.closest('.node')) {
          openMenu(ev.clientX, ev.clientY, { dir, nodeId, port });
        }
      }
    };
    move(e);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  function startNodeDrag(nodeEl, e) {
    const id = +nodeEl.dataset.id;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
    } else if (!selected.has(id)) {
      selected.clear(); selected.add(id);
    }
    refreshSelection();
    nodeEl.style.zIndex = ++zTop;
    const before = snapshot();
    const sx = e.clientX, sy = e.clientY;
    const origin = [...selected].map(i => getNode(i)).filter(Boolean).map(n => ({ n, x: n.x, y: n.y }));
    const move = ev => {
      const dx = (ev.clientX - sx) / view.scale, dy = (ev.clientY - sy) / view.scale;
      for (const o of origin) {
        o.n.x = Math.round(o.x + dx); o.n.y = Math.round(o.y + dy);
        const ne = nodeEls.get(o.n.id);
        if (ne) { ne.el.style.left = o.n.x + 'px'; ne.el.style.top = o.n.y + 'px'; }
      }
      drawWires();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      pushUndo(before);
      scheduleSave();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  function startPan(e) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, vx = view.x, vy = view.y;
    let moved = false;
    graphEl.classList.add('panning');
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      view.x = vx + dx; view.y = vy + dy;
      applyView();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      graphEl.classList.remove('panning');
      if (!moved && e.button === 0 && selected.size) { selected.clear(); refreshSelection(); }
      scheduleSave();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  graphEl.addEventListener('wheel', e => {
    e.preventDefault();
    const r = graphEl.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const ns = Math.min(2.5, Math.max(0.2, view.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    view.x = mx - (mx - view.x) * (ns / view.scale);
    view.y = my - (my - view.y) * (ns / view.scale);
    view.scale = ns;
    applyView();
    drawWires();
    scheduleSave();
  }, { passive: false });

  graphEl.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(e.clientX, e.clientY); });
  graphEl.addEventListener('dblclick', e => {
    const hit = e.target.closest('.wire-hit');
    if (hit) {
      const to = +hit.dataset.to, port = hit.dataset.port;
      return mutate(() => { graph.links = graph.links.filter(l => !(l.to === to && l.toPort === port)); });
    }
    if (!e.target.closest('.node')) openMenu(e.clientX, e.clientY);
  });

  // 從節點庫拖曳進來
  graphEl.addEventListener('dragover', e => {
    const t = e.dataTransfer.types;
    if (t.includes('application/x-shader-node') || t.includes('Files')) {
      e.preventDefault(); graphEl.classList.add('drop-target');
    }
  });
  // 避免圖檔掉在節點圖以外時，瀏覽器直接開啟該檔案
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => e.preventDefault());
  graphEl.addEventListener('dragleave', () => graphEl.classList.remove('drop-target'));
  graphEl.addEventListener('drop', async e => {
    e.preventDefault();
    graphEl.classList.remove('drop-target');
    const p = toWorld(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (files.length) {
      // 拖到 Texture 節點上 → 替換它的圖片；否則建立新的 Texture 節點
      const hitEl = e.target.closest && e.target.closest('.node');
      const hitNode = hitEl && getNode(+hitEl.dataset.id);
      for (const [k, f] of files.entries()) {
        const id = await importImage(f);
        if (!id) continue;
        if (k === 0 && hitNode && hitNode.type === 'texture') mutate(() => { hitNode.params.image = id; });
        else addNode('texture', p.x - 70 + k * 30, p.y - 16 + k * 30, null, { params: { image: id } });
      }
      return;
    }
    const type = e.dataTransfer.getData('application/x-shader-node');
    if (type) addNode(type, p.x - 70, p.y - 16);
  });

  /* ======================= 圖片資源 ======================= */
  function hashString(str) {
    let x = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 7) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    return (x >>> 0).toString(36) + str.length.toString(36);
  }

  /** 讀取圖檔、縮到最長邊 1024px，存成 dataURL 資源；回傳資源 id */
  async function importImage(file) {
    try {
      const url = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error('無法讀取檔案'));
        r.readAsDataURL(file);
      });
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('不支援的圖片格式'));
        i.src = url;
      });
      const s = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const keepAlpha = /png|webp|gif|svg/.test(file.type);
      const data = c.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.9);
      const id = 'img_' + hashString(data);
      assets[id] = data;
      return id;
    } catch (err) {
      toast('圖片載入失敗：' + err.message);
      return null;
    }
  }

  function pickImage(nodeId) {
    const input = $('#image-input');
    input.onchange = async () => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      const id = await importImage(f);
      const n = getNode(nodeId);
      if (id && n) mutate(() => { n.params.image = id; });
    };
    input.click();
  }

  function textureBindings(ids) {
    return (ids || []).map(id => {
      const n = getNode(id);
      return { uniform: 'u_tex' + id, url: assetURL(n && n.params.image), wrap: (n && n.params.wrap) || 'repeat' };
    });
  }

  addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });

  function addNode(type, x, y, pending = null, opts = {}) {
    if (NODE_DEFS[type].unique && graph.nodes.some(n => n.type === type)) { toast(`每張圖只能有一個 ${NODE_DEFS[type].title}`); return; }
    mutate(() => {
      const def = NODE_DEFS[type];
      const n = createNode(type, x, y, opts);
      selected.clear(); selected.add(n.id);
      if (pending) {
        if (pending.dir === 'out' && def.inputs.length) {
          const target = def.inputs.find(i => !i.expr) || def.inputs[0];
          connect(pending.nodeId, pending.port, n.id, target.name);
        } else if (pending.dir === 'in' && def.outputs.length) {
          n.x -= 190;
          connect(n.id, def.outputs[0].name, pending.nodeId, pending.port);
        }
      }
    });
  }

  function graphCenterWorld() {
    const r = graphEl.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  /* ======================= 新增節點選單 ======================= */
  let menuState = null, menuActive = 0;

  function matchDef(d, q) {
    if (!q) return true;
    const hay = (d.title + ' ' + d.type + ' ' + (d.desc || '') + ' ' + (d.keywords || '') + ' ' + CATEGORY_MAP[d.category].label).toLowerCase();
    return q.split(/\s+/).every(t => hay.includes(t));
  }

  function openMenu(cx, cy, pending = null) {
    const r = graphEl.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    menuState = { world: toWorld(cx, cy), pending };
    menuEl.hidden = false;
    menuEl.style.left = Math.min(cx, innerWidth - 280) + 'px';
    menuEl.style.top = Math.min(cy, innerHeight - 410) + 'px';
    menuInput.value = '';
    menuActive = 0;
    renderMenu();
    menuInput.focus();
  }
  function closeMenu() { menuEl.hidden = true; menuState = null; }

  function renderMenu() {
    const q = menuInput.value.trim().toLowerCase();
    const p = menuState && menuState.pending;
    menuList.textContent = '';
    let idx = 0;
    for (const cat of CATEGORIES) {
      const defs = Object.values(NODE_DEFS).filter(d => d.category === cat.id && matchDef(d, q) &&
        (!p || (p.dir === 'out' ? d.inputs.length : d.outputs.length)));
      if (!defs.length) continue;
      menuList.append(h('li', 'menu-cat', cat.label));
      for (const d of defs) {
        const li = h('li', 'menu-item' + (idx === menuActive ? ' active' : ''));
        li.dataset.type = d.type;
        li.dataset.idx = idx++;
        li.append(h('span', '', d.title), h('small', '', d.desc || ''));
        menuList.append(li);
      }
    }
    if (!idx) menuList.append(h('li', 'menu-cat', '找不到符合的節點'));
    const act = menuList.querySelector('.menu-item.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }

  function pickMenu(type) {
    if (!menuState) return;
    const { world, pending } = menuState;
    closeMenu();
    addNode(type, world.x, world.y - 16, pending);
  }

  menuInput.addEventListener('input', () => { menuActive = 0; renderMenu(); });
  menuInput.addEventListener('keydown', e => {
    const items = [...menuList.querySelectorAll('.menu-item')];
    if (e.key === 'Escape') { closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); menuActive = Math.min(items.length - 1, menuActive + 1); renderMenu(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); menuActive = Math.max(0, menuActive - 1); renderMenu(); }
    else if (e.key === 'Enter') { const it = items[menuActive]; if (it) pickMenu(it.dataset.type); }
    e.stopPropagation();
  });
  menuList.addEventListener('pointermove', e => {
    const it = e.target.closest('.menu-item');
    if (it && +it.dataset.idx !== menuActive) {
      menuList.querySelector('.menu-item.active')?.classList.remove('active');
      it.classList.add('active');
      menuActive = +it.dataset.idx;
    }
  });
  menuList.addEventListener('click', e => { const it = e.target.closest('.menu-item'); if (it) pickMenu(it.dataset.type); });
  document.addEventListener('pointerdown', e => { if (!menuEl.hidden && !menuEl.contains(e.target)) closeMenu(); }, true);

  /* ======================= 節點庫（左側） ======================= */
  const paletteEl = $('#palette'), paletteSearch = $('#palette-search');
  function renderPalette() {
    const q = paletteSearch.value.trim().toLowerCase();
    paletteEl.textContent = '';
    for (const cat of CATEGORIES) {
      const defs = Object.values(NODE_DEFS).filter(d => d.category === cat.id && matchDef(d, q));
      if (!defs.length) continue;
      const det = h('details', 'pal-cat');
      det.open = true;
      const sum = h('summary');
      const dot = h('span', 'cat-dot'); dot.style.background = cat.color;
      sum.append(dot, cat.label);
      det.append(sum);
      for (const d of defs) {
        const it = h('div', 'pal-item');
        it.draggable = true;
        it.title = d.desc || '';
        it.append(h('span', '', d.title), h('small', '', d.desc || ''));
        it.addEventListener('dragstart', e => {
          e.dataTransfer.setData('application/x-shader-node', d.type);
          e.dataTransfer.effectAllowed = 'copy';
        });
        it.addEventListener('dblclick', () => { const c = graphCenterWorld(); addNode(d.type, c.x - 70, c.y - 40); });
        det.append(it);
      }
      paletteEl.append(det);
    }
  }
  paletteSearch.addEventListener('input', renderPalette);

  /* ======================= 屬性面板（右側） ======================= */
  function typeDot(t) {
    const d = h('span', 'type-dot');
    d.style.background = TYPE_COLOR[t] || '#777';
    d.title = t || '';
    return d;
  }

  function renderPanel() {
    propsEl.textContent = '';
    const wrap = h('div', 'props');
    propsEl.append(wrap);

    if (selected.size === 1) {
      const n = getNode([...selected][0]);
      if (!n) return;
      const def = NODE_DEFS[n.type], cat = CATEGORY_MAP[def.category];
      wrap.style.setProperty('--cat', cat.color);
      const title = h('h3', '', def.title);
      title.append(h('span', 'chip', cat.label));
      wrap.append(title, h('div', 'desc', def.desc || ''));

      if (def.params.length) {
        const sec = h('section');
        sec.append(h('div', 'sec-title', '參數'));
        for (const p of def.params) {
          const row = h('div', 'prop-row');
          row.append(h('span', '', p.label || p.name), paramControl(n, p));
          sec.append(row);
        }
        wrap.append(sec);
      }
      if (def.inputs.length) {
        const sec = h('section');
        sec.append(h('div', 'sec-title', '輸入'));
        for (const inp of def.inputs) {
          const row = h('div', 'prop-row');
          const lab = h('span');
          lab.append(typeDot(portTypes[n.id + ':in:' + inp.name]), inp.name);
          row.append(lab);
          const l = linkInto(n.id, inp.name);
          if (l) {
            const src = getNode(l.from);
            row.append(h('span', 'linked', `← ${src ? NODE_DEFS[src.type].title : '?'}.${l.fromPort}`));
          } else if (inp.expr) row.append(h('span', 'muted', `預設：${inp.exprLabel}`));
          else row.append(valueControl(n, inp));
          sec.append(row);
        }
        wrap.append(sec);
      }
      if (def.outputs.length) {
        const sec = h('section');
        sec.append(h('div', 'sec-title', '輸出'));
        for (const o of def.outputs) {
          const row = h('div', 'prop-row');
          const lab = h('span');
          const t = portTypes[n.id + ':out:' + o.name];
          lab.append(typeDot(t), o.name);
          row.append(lab, h('span', 'muted mono', t || ''));
          sec.append(row);
        }
        wrap.append(sec);
      }
      return;
    }

    if (selected.size > 1) {
      wrap.append(h('h3', '', `已選取 ${selected.size} 個節點`),
        h('div', 'desc', '拖曳可一起移動，Delete 刪除，⌘/Ctrl+D 複製。'));
      return;
    }

    // 無選取：顯示總覽
    wrap.append(h('h3', '', '節點圖'));
    const stat = h('div', 'stat');
    const s1 = h('div'); s1.append(h('b', '', graph.nodes.length), h('span', 'muted', '節點'));
    const s2 = h('div'); s2.append(h('b', '', graph.links.length), h('span', 'muted', '連線'));
    stat.append(s1, s2);
    wrap.append(h('div', 'desc', '點選節點以編輯屬性。'), stat);

    const legend = h('section');
    legend.append(h('div', 'sec-title', '資料型別'));
    const lg = h('div', 'legend');
    for (const t of Object.keys(TYPE_COLOR)) { const s = h('span'); s.append(typeDot(t), t); lg.append(s); }
    legend.append(lg, h('div', 'desc', '型別不同時會自動轉換：float 會擴展成向量，向量會截取前幾個分量。數學節點的輸出維度取決於輸入中最大的那個。'));
    wrap.append(legend);

    const keys = h('section');
    keys.append(h('div', 'sec-title', '快捷鍵'));
    const ul = h('ul', 'keys');
    [
      ['新增節點', 'Space / 右鍵'], ['刪除', 'Delete'], ['複製', '⌘/Ctrl + D'], ['全選', '⌘/Ctrl + A'],
      ['復原 / 重做', '⌘/Ctrl + Z / ⇧Z'], ['全部置中', 'F'], ['多選', 'Shift + 點擊'],
    ].forEach(([a, b]) => {
      const li = h('li');
      li.append(h('span', '', a));
      const k = h('span');
      b.split(' / ').forEach((x, i) => { if (i) k.append(' / '); k.append(h('kbd', '', x)); });
      li.append(k);
      ul.append(li);
    });
    keys.append(ul);
    wrap.append(keys);
  }

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    $('#tab-props').hidden = t.dataset.tab !== 'props';
    $('#tab-code').hidden = t.dataset.tab !== 'code';
  }));

  /* ======================= 鍵盤 ======================= */
  addEventListener('keydown', e => {
    const tag = e.target.tagName;
    const editing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !editing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y' && !editing) { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); save(); toast('已儲存到瀏覽器'); return; }
    if (editing || !menuEl.hidden) return;
    if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); }
    else if (mod && k === 'a') { e.preventDefault(); graph.nodes.forEach(n => selected.add(n.id)); refreshSelection(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selected.size) { e.preventDefault(); mutate(() => deleteNodes([...selected])); }
    }
    else if (e.key === ' ' || e.key === 'Tab') { e.preventDefault(); openMenu(mouse.x, mouse.y); }
    else if (k === 'f' && !mod) frameAll();
    else if (e.key === 'Escape') { selected.clear(); refreshSelection(); }
  });

  /* ======================= 編譯 ======================= */
  let compileTimer = 0;
  let mainEntry = null;
  let mainBindings = [];
  function scheduleCompile() { clearTimeout(compileTimer); compileTimer = setTimeout(compileAll, 40); }

  function compileAll() {
    portTypes = analyzeTypes(graph);
    applyPortColors();
    drawWires();

    const res = buildShader(graph, null);
    if (res.error) {
      mainEntry = null;
      showError(res.error);
      lastSrc = '';
      codeEl.textContent = '// ' + res.error;
    } else {
      lastSrc = '// ===== Vertex Shader =====\n' + res.vs + '\n// ===== Fragment Shader =====\n' + res.fs;
      renderCode(res);
      const entry = mainR ? mainR.program(res) : null;
      if (entry && entry.error) showError('Shader 編譯錯誤 — ' + entry.error);
      else { mainEntry = entry; mainBindings = textureBindings(res.textures); showError(''); }
    }

    if (thumbR) {
      for (const [id, ne] of nodeEls) {
        if (!ne.thumb) { ne.entry = null; continue; }
        const n = getNode(id), def = NODE_DEFS[n.type];
        const r = buildShader(graph, { nodeId: id, port: def.outputs[0].name });
        const entry = r.error ? null : thumbR.program(r);
        ne.entry = entry && !entry.error ? entry : null;
        ne.textures = r.error ? [] : textureBindings(r.textures);
      }
    }
    // 屬性面板中的型別圓點需要更新
    if (selected.size === 1 && !propsEl.contains(document.activeElement)) renderPanel();
  }

  function showError(msg) { errorEl.textContent = msg; }

  function renderCode(res) {
    codeEl.textContent = '';
    const frag = document.createDocumentFragment();
    for (const [title, src] of [['Vertex Shader', res.vs], ['Fragment Shader', res.fs]]) {
      frag.append(h('span', 'code-title', `// ===== ${title} =====\n`));
      src.split('\n').forEach((line, i) => {
        frag.append(h('span', 'ln', String(i + 1).padStart(3) + '  '), line + '\n');
      });
      frag.append('\n');
    }
    codeEl.append(frag);
  }

  /* ======================= 預覽 ======================= */
  let mainR = null, thumbR = null;
  try {
    mainR = new GLRenderer(previewCanvas);
    const tc = document.createElement('canvas');
    tc.width = tc.height = THUMB_PX;
    thumbR = new GLRenderer(tc);
  } catch (err) {
    showError(err.message);
  }

  const cam = { yaw: 0.7, pitch: 0.35, dist: 3.4, auto: true, mesh: 'sphere' };
  const uMouse = [0.5, 0.5];
  let time = 0, paused = false, lastT = performance.now();

  const meshDropdown = createDropdown($('#mesh-dd'), [
    { value: 'sphere', label: '球體' },
    { value: 'cube', label: '立方體' },
    { value: 'torus', label: '圓環' },
    { value: 'plane', label: '平面 3D' },
    { value: 'quad', label: '平面 2D' },
  ], setMesh);
  meshDropdown.setValue(cam.mesh);
  function setMesh(m) {
    cam.mesh = m;
    meshDropdown.setValue(m);
    $('#preview-wrap').classList.toggle('flat', m === 'quad');
    scheduleSave();
  }

  previewCanvas.addEventListener('pointerdown', e => {
    previewCanvas.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    const move = ev => {
      if (cam.mesh !== 'quad') {
        cam.yaw -= (ev.clientX - lx) * 0.01;
        cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + (ev.clientY - ly) * 0.01));
      }
      lx = ev.clientX; ly = ev.clientY;
    };
    const up = () => {
      previewCanvas.removeEventListener('pointermove', move);
      previewCanvas.removeEventListener('pointerup', up);
    };
    previewCanvas.addEventListener('pointermove', move);
    previewCanvas.addEventListener('pointerup', up);
  });
  previewCanvas.addEventListener('pointermove', e => {
    const r = previewCanvas.getBoundingClientRect();
    uMouse[0] = (e.clientX - r.left) / r.width;
    uMouse[1] = 1 - (e.clientY - r.top) / r.height;
  });
  previewCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dist = Math.max(1.8, Math.min(8, cam.dist * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });

  const rotateBtn = $('#btn-rotate');
  rotateBtn.classList.toggle('active', cam.auto);
  rotateBtn.onclick = () => { cam.auto = !cam.auto; rotateBtn.classList.toggle('active', cam.auto); };
  $('#btn-pause').onclick = e => { paused = !paused; e.currentTarget.textContent = paused ? '▶' : '⏸'; };
  $('#btn-shot').onclick = () => previewCanvas.toBlob(b => download(b, 'shader-preview.png'));
  $('#btn-full').onclick = () => {
    const p = $('#preview-panel');
    document.fullscreenElement ? document.exitFullscreen() : p.requestFullscreen?.();
  };

  const IDENTITY = Mat4.identity();
  const timeLabel = $('#time-label');

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.1, (now - lastT) / 1000));
    lastT = now;
    if (!paused) time += dt;
    timeLabel.textContent = time.toFixed(1) + 's';
    if (!mainR) return;

    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(previewCanvas.clientWidth * dpr));
    const ht = Math.max(1, Math.round(previewCanvas.clientHeight * dpr));
    if (previewCanvas.width !== w || previewCanvas.height !== ht) { previewCanvas.width = w; previewCanvas.height = ht; }

    let viewProj, camPos, aspect;
    if (cam.mesh === 'quad') {
      viewProj = IDENTITY; camPos = [0, 0, 3]; aspect = w / ht;
    } else {
      if (cam.auto) cam.yaw += dt * 0.35;
      const cp = Math.cos(cam.pitch);
      camPos = [cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch), cam.dist * cp * Math.cos(cam.yaw)];
      viewProj = Mat4.multiply(Mat4.perspective(0.75, w / ht, 0.1, 50), Mat4.lookAt(camPos, [0, 0, 0], [0, 1, 0]));
      aspect = 1;
    }
    if (mainEntry) {
      mainR.draw(mainEntry, { w, h: ht, mesh: cam.mesh, viewProj, model: IDENTITY, camPos, lightDir: LIGHT_DIR, time, mouse: uMouse, aspect, textures: mainBindings });
    } else mainR.clear();

    // 節點縮圖：共用一個離屏 context，畫完再複製到各節點的 2D canvas
    for (const ne of nodeEls.values()) {
      if (!ne.entry || !ne.ctx) continue;
      thumbR.draw(ne.entry, { w: THUMB_PX, h: THUMB_PX, mesh: 'quad', viewProj: IDENTITY, model: IDENTITY,
        camPos: [0, 0, 3], lightDir: LIGHT_DIR, time, mouse: uMouse, aspect: 1, textures: ne.textures });
      ne.ctx.clearRect(0, 0, THUMB_PX, THUMB_PX);
      ne.ctx.drawImage(thumbR.canvas, 0, 0);
    }
  }

  /* ======================= 存檔 / 匯入匯出 ======================= */
  let saveTimer = 0;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }
  function usedAssets() {
    const o = {};
    for (const n of graph.nodes) {
      const id = n.params && n.params.image;
      if (id && assets[id]) o[id] = assets[id];
    }
    return o;
  }
  let quotaWarned = false;
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ graph, view, mesh: cam.mesh })); } catch (e) { /* 無痕模式等 */ }
    try { localStorage.setItem(STORAGE_KEY + '/assets', JSON.stringify(usedAssets())); }
    catch (e) {
      if (!quotaWarned) { quotaWarned = true; toast('圖片太大，無法存到瀏覽器；請用「匯出 JSON」保存'); }
    }
  }
  function load() {
    try { Object.assign(assets, JSON.parse(localStorage.getItem(STORAGE_KEY + '/assets')) || {}); } catch (e) { /* ignore */ }
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!s) return false;
      graph = normalizeGraph(s.graph);
      if (s.view && isFinite(s.view.scale)) view = s.view;
      if (s.mesh && MESHES[s.mesh]) setMesh(s.mesh);
      return true;
    } catch (e) { return false; }
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#btn-export').onclick = () => {
    const data = JSON.stringify({ format: 'shader-node-editor', version: 2, graph, assets: usedAssets() }, null, 2);
    download(new Blob([data], { type: 'application/json' }), 'shader-graph.json');
  };
  /* ---------- 輸出 ZIP：GLSL + 節點圖 + 預覽 PNG + 獨立播放頁 ---------- */
  const objectSource = (name, obj) => `const ${name} = {\n${Object.entries(obj).map(([k, fn]) => {
    const s = fn.toString();
    return s.startsWith(k) ? s : `${k}: ${s}`;
  }).join(',\n')}\n};`;

  function rendererSource() {
    return ["'use strict';", objectSource('Mat4', Mat4), gridMesh.toString(), objectSource('MESHES', MESHES),
      'let _uvGrid = null;', builtinUVGrid.toString(), GLRenderer.toString()].join('\n\n');
  }

  function playerRuntime() {
    const C = PLAYER_CONFIG, canvas = document.getElementById('c'), errEl = document.getElementById('err');
    let r;
    try { r = new GLRenderer(canvas); } catch (e) { errEl.textContent = e.message; return; }
    const entry = r.program({ vs: C.vs, fs: C.fs });
    if (entry.error) { errEl.textContent = entry.error; return; }
    const cam = C.camera, mouse = [0.5, 0.5], I = Mat4.identity();
    let time = 0, last = performance.now();

    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      let lx = e.clientX, ly = e.clientY;
      const move = ev => {
        cam.yaw -= (ev.clientX - lx) * 0.01;
        cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + (ev.clientY - ly) * 0.01));
        lx = ev.clientX; ly = ev.clientY;
      };
      const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
    });
    canvas.addEventListener('pointermove', e => {
      mouse[0] = e.clientX / innerWidth;
      mouse[1] = 1 - e.clientY / innerHeight;
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      cam.dist = Math.max(1.8, Math.min(8, cam.dist * Math.exp(e.deltaY * 0.001)));
    }, { passive: false });

    (function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now; time += dt;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      let viewProj = I, camPos = [0, 0, 3], aspect = w / h;
      if (cam.mesh !== 'quad') {
        if (cam.auto) cam.yaw += dt * 0.35;
        const cp = Math.cos(cam.pitch);
        camPos = [cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch), cam.dist * cp * Math.cos(cam.yaw)];
        viewProj = Mat4.multiply(Mat4.perspective(0.75, w / h, 0.1, 50), Mat4.lookAt(camPos, [0, 0, 0], [0, 1, 0]));
        aspect = 1;
      }
      r.draw(entry, { w, h, mesh: cam.mesh, viewProj, model: I, camPos, lightDir: C.lightDir, time, mouse, aspect, textures: C.textures });
    })(last);
  }

  function playerHTML(res) {
    const config = {
      vs: res.vs, fs: res.fs, lightDir: LIGHT_DIR, textures: textureBindings(res.textures),
      camera: { mesh: cam.mesh, yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, auto: cam.auto },
    };
    const json = JSON.stringify(config).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shader Composer Export</title>
<style>
  html, body { margin: 0; height: 100%; background: #14161b; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; touch-action: none; }
  #err { position: fixed; inset: 16px; color: #ff6b6b; font: 13px/1.5 ui-monospace, monospace; white-space: pre-wrap; pointer-events: none; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="err"></div>
<script>
${rendererSource()}

const PLAYER_CONFIG = ${json};
(${playerRuntime.toString()})();
</script>
</body>
</html>
`;
  }

  $('#btn-bundle').onclick = async () => {
    const res = buildShader(graph, null);
    if (res.error) return toast('無法輸出：' + res.error);
    if (mainR) {
      const entry = mainR.program(res);
      if (entry.error) return toast('無法輸出：Shader 編譯錯誤');
    }
    try {
      const png = await new Promise(resolve => previewCanvas.toBlob(resolve, 'image/png'));
      const files = [
        { name: 'index.html', data: playerHTML(res) },
        { name: 'shader.vert', data: res.vs },
        { name: 'shader.frag', data: res.fs },
        { name: 'shader-graph.json', data: JSON.stringify({ format: 'shader-node-editor', version: 2, graph, assets: usedAssets() }, null, 2) },
      ];
      if (png) files.push({ name: 'preview.png', data: png });
      download(await createZip(files), 'shader-export.zip');
      toast('已輸出 shader-export.zip');
    } catch (err) { toast('輸出失敗：' + err.message); }
  };

  $('#btn-import').onclick = () => $('#file-input').click();
  $('#file-input').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.assets && typeof data.assets === 'object') Object.assign(assets, data.assets);
      const g = normalizeGraph(data.graph || data);
      mutate(() => { graph = g; selected.clear(); });
      frameAll();
      toast('已匯入 ' + f.name);
    } catch (err) { toast('匯入失敗：' + err.message); }
  });
  $('#btn-copy').onclick = () => {
    if (!lastSrc) return toast('目前沒有可複製的程式碼');
    navigator.clipboard.writeText(lastSrc).then(() => toast('已複製 GLSL'), () => toast('複製失敗'));
  };
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-frame').onclick = frameAll;
  $('#btn-clear').onclick = () => {
    if (!confirm('確定要清空節點圖？（可用復原還原）')) return;
    loadExample('blank');
  };

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800 + msg.length * 40);
  }

  /* ======================= 範例（定義在 js/examples.js） ======================= */
  function buildExample(name) {
    const ex = EXAMPLES.find(e => e.id === name) || EXAMPLES.find(e => e.id === 'blank');
    const g = { nodes: [], links: [], nextId: 1 };
    const saved = graph;
    graph = g; // createNode 會寫入目前的 graph
    try {
      ex.build(
        (type, x, y, opts) => createNode(type, x, y, opts).id,
        (a, ap, b, bp) => g.links.push({ from: a, fromPort: ap, to: b, toPort: bp }));
    } finally {
      graph = saved;
    }
    return g;
  }

  function loadExample(name) {
    const ex = EXAMPLES.find(e => e.id === name);
    const g = buildExample(name);
    mutate(() => { graph = g; selected.clear(); });
    if (ex && ex.mesh) setMesh(ex.mesh);
    frameAll();
    if (ex && ex.desc) toast(`${ex.label}：${ex.desc}`);
  }

  createDropdown($('#example-dd'),
    EXAMPLES.map(ex => ({ value: ex.id, label: ex.label, group: ex.group, title: ex.desc })),
    loadExample);

  /* ======================= 啟動 ======================= */
  renderPalette();
  const restored = load();
  if (!restored) graph = buildExample('rings');
  changed();
  applyView();
  if (!restored) frameAll();
  setMesh(cam.mesh);
  compileAll();
  requestAnimationFrame(frame);
})();
