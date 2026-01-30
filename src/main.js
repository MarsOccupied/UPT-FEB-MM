import * as d3 from 'd3';

// Basic setup for the mind map
const svg = d3.select('#app')
  .append('svg')
  .attr('width', window.innerWidth)
  .attr('height', window.innerHeight);

// viewport group for zoom/pan
const viewport = svg.append('g').attr('class', 'viewport');

// enable zoom & pan
svg.call(d3.zoom()
  .scaleExtent([0.2, 4])
  .on('zoom', (event) => viewport.attr('transform', event.transform)));

const nodes = [
  { id: 'root', name: 'Life', x: window.innerWidth / 2, y: window.innerHeight / 2 }
];

const links = [];

// --- history (undo / redo) ---
let _history = [];
let _future = [];
let _isApplyingHistory = false;

function deepCopyState() {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    links: links.map(l => ({ source: (l.source && l.source.id) || l.source, target: (l.target && l.target.id) || l.target }))
  };
}

function pushHistory() {
  if (_isApplyingHistory) return;
  _history.push(deepCopyState());
  if (_history.length > 200) _history.shift();
  _future.length = 0;
  updateUndoRedoButtons();
}

function applySnapshot(snap) {
  _isApplyingHistory = true;
  nodes.length = 0;
  snap.nodes.forEach(n => nodes.push({ ...n }));
  links.length = 0;
  snap.links.forEach(l => links.push({ ...l }));
  update();
  _isApplyingHistory = false;
}

function undo() {
  if (_history.length <= 1) return;
  const current = _history.pop();
  _future.push(current);
  const last = _history[_history.length - 1];
  applySnapshot(last);
  updateUndoRedoButtons();
}

function redo() {
  if (_future.length === 0) return;
  const snap = _future.pop();
  _history.push(snap);
  applySnapshot(snap);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = _history.length <= 1;
  if (redoBtn) redoBtn.disabled = _future.length === 0;
}

function commitChange() {
  update();
  pushHistory();
  // debounced autosave
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(autosave, 1200);
}

let linkMode = false;
let linkSource = null;

const simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(80))
  .force('charge', d3.forceManyBody().strength(-300))
  .force('center', d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2));

let link = viewport.append('g')
  .attr('class', 'links')
  .selectAll('path')
  .data(links)
  .enter().append('path');

let node = viewport.append('g')
  .attr('class', 'nodes')
  .selectAll('g')
  .data(nodes)
  .enter().append('g')
  .attr('class', 'node');

node.append('circle')
  .attr('r', 20)
  .attr('fill', d => d.color || null)
  .call(d3.drag()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended))
  .on('click', (event, d) => { event.stopPropagation(); handleNodeClick(event, d); })
  .on('dblclick', addChild);

node.append('image')
  .attr('class', 'node-image')
  .attr('x', -16)
  .attr('y', -16)
  .attr('width', 32)
  .attr('height', 32)
  .attr('preserveAspectRatio', 'xMidYMid slice')
  .attr('visibility', d => d.image ? 'visible' : 'hidden')
  .attr('href', d => d.image || null);

node.append('title')
  .text(d => d.name);

node.append('text')
  .attr('dx', 0)
  .attr('dy', '.35em')
  .attr('text-anchor', 'middle')
  .style('font-size', '12px')
  .text(d => d.name);

// selection model: multi-select + primary
let selectedNodes = new Set();
let primarySelection = null; // single node object (for single-node actions)
let searchQuery = '';

// drag group state for multi-drag
let dragGroup = null;
let dragOrigins = null;

// link styling
let linkStyle = 'line'; // 'line' | 'curve' | 'orthogonal'

// clipboard for copy/paste
let _clipboard = null; // { nodes: [], links: [] }

simulation.on('tick', () => {
  link.attr('d', d => linkPath(d));
  node.attr('transform', d => `translate(${d.x},${d.y})`);
});

function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  // if dragging a selected node, start group drag
  if (selectedNodes.size > 1 && selectedNodes.has(d.id)) {
    dragGroup = Array.from(selectedNodes);
    dragOrigins = {};
    dragGroup.forEach(id => {
      const n = nodes.find(x => x.id === id);
      dragOrigins[id] = { x: n.x, y: n.y };
      n.fx = n.x; n.fy = n.y;
    });
  } else {
    dragGroup = null;
    d.fx = d.x;
    d.fy = d.y;
  }
}

function dragged(event, d) {
  if (dragGroup && dragOrigins && dragOrigins[d.id]) {
    const dx = event.x - dragOrigins[d.id].x;
    const dy = event.y - dragOrigins[d.id].y;
    dragGroup.forEach(id => {
      const n = nodes.find(x => x.id === id);
      if (!n) return;
      n.fx = dragOrigins[id].x + dx;
      n.fy = dragOrigins[id].y + dy;
    });
  } else {
    d.fx = event.x;
    d.fy = event.y;
  }
}

function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  if (dragGroup) {
    dragGroup.forEach(id => {
      const n = nodes.find(x => x.id === id);
      if (!n) return;
      n.fx = null; n.fy = null;
    });
    dragGroup = null;
    dragOrigins = null;
    commitChange();
    return;
  }
  d.fx = null;
  d.fy = null;
  commitChange();
}

function addChild(event, d) {
  const newNode = { id: Date.now().toString(), name: 'New Node', x: d.x + 50, y: d.y + 50 };
  nodes.push(newNode);
  links.push({ source: d.id, target: newNode.id });
  // auto-select the newly created node
  selectedNodes.clear(); selectedNodes.add(newNode.id); primarySelection = newNode;
  commitChange();
}

function update() {
  // Update links
  link = link.data(links);
  link.exit().remove();
  link = link.enter().append('path').merge(link);

  // Update nodes
  node = node.data(nodes);
  node.exit().remove();
  const nodeEnter = node.enter().append('g')
    .attr('class', 'node');

  nodeEnter.append('circle')
    .attr('r', 20)
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended))
    .on('click', (event, d) => { event.stopPropagation(); selectNode(d); })
    .on('dblclick', addChild);

  nodeEnter.append('title')
    .text(d => d.name);

  nodeEnter.append('text')
    .attr('dx', 0)
    .attr('dy', '.35em')
    .attr('text-anchor', 'middle')
    .style('font-size', '12px')
    .text(d => d.name);

  node = nodeEnter.merge(node);

  // keep visual props in sync (color / image)
  node.select('circle').attr('fill', d => d.color || null);
  node.select('image').attr('href', d => d.image || null).attr('visibility', d => d.image ? 'visible' : 'hidden');

  // search highlighting / dim non-matches
  node.classed('search-match', d => matchesSearch(d));
  node.classed('dim', d => searchQuery && !matchesSearch(d));

  // hide nodes/links that are descendants of collapsed nodes
  node.style('display', d => isHiddenNode(d) ? 'none' : null);
  link.style('display', l => {
    const s = (typeof l.source === 'object') ? l.source : nodes.find(n=>n.id===l.source);
    const t = (typeof l.target === 'object') ? l.target : nodes.find(n=>n.id===l.target);
    if (!s || !t) return null;
    return (isHiddenNode(s) || isHiddenNode(t)) ? 'none' : null;
  });

  simulation.nodes(nodes);
  simulation.force('link').links(links);
  simulation.alpha(1).restart();
}

// ----- selection, editing, delete, save/load, export -----
function selectNode(d, { add = false, toggle = false } = {}) {
  if (!d) {
    selectedNodes.clear();
    primarySelection = null;
  } else if (add) {
    selectedNodes.add(d.id);
    primarySelection = d;
  } else if (toggle) {
    if (selectedNodes.has(d.id)) {
      selectedNodes.delete(d.id);
      if (primarySelection && primarySelection.id === d.id) primarySelection = null;
    } else {
      selectedNodes.add(d.id);
      primarySelection = d;
    }
  } else {
    selectedNodes.clear();
    selectedNodes.add(d.id);
    primarySelection = d;
  }

  node.classed('selected', dd => selectedNodes.has(dd.id));
  const colorPicker = document.getElementById('colorPicker');
  if (colorPicker) colorPicker.value = primarySelection && primarySelection.color ? primarySelection.color : '#69b3a2';
  updateTagsUI();
}

function handleNodeClick(event, d) {
  if (linkMode) {
    if (!linkSource) {
      linkSource = d;
      node.classed('link-source', dd => dd.id === d.id);
      return;
    }
    if (linkSource.id === d.id) { linkSource = null; node.classed('link-source', false); return; }

    const exists = links.some(l => {
      const s = (typeof l.source === 'object') ? l.source.id : l.source;
      const t = (typeof l.target === 'object') ? l.target.id : l.target;
      return (s === linkSource.id && t === d.id) || (s === d.id && t === linkSource.id);
    });
    if (!exists) {
      links.push({ source: linkSource.id, target: d.id });
      commitChange();
    }
    linkSource = null;
    toggleLinkMode(false);
    node.classed('link-source', false);
    return;
  }

  // multi-select support: Shift = add, Ctrl/Cmd = toggle
  if (event.shiftKey) return selectNode(d, { add: true });
  if (event.ctrlKey || event.metaKey) return selectNode(d, { toggle: true });
  selectNode(d);
}

function toggleLinkMode(force) {
  linkMode = (typeof force === 'boolean') ? force : !linkMode;
  const btn = document.getElementById('linkBtn');
  if (btn) btn.classList.toggle('active', linkMode);
  if (!linkMode) { linkSource = null; node.classed('link-source', false); }
}

function showInlineEditor(d) {
  const existing = document.getElementById('inline-editor');
  if (existing) existing.remove();
  const input = document.createElement('input');
  input.id = 'inline-editor';
  input.value = d.name || '';
  document.body.appendChild(input);
  const svgRect = svg.node().getBoundingClientRect();
  const t = d3.zoomTransform(svg.node());
  const x = svgRect.left + (d.x * t.k + t.x);
  const y = svgRect.top + (d.y * t.k + t.y);
  input.style.left = `${x - 70}px`;
  input.style.top = `${y - 14}px`;
  input.style.width = '160px';
  input.focus();
  input.select();
  function commit() { d.name = input.value || d.name; input.remove(); commitChange(); }
  function cancel() { input.remove(); }
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') cancel(); });
  input.addEventListener('blur', commit);
}

function attachImagePrompt() {
  const target = primarySelection;
  if (!target) return alert('Select a single node to attach an image.');
  const url = window.prompt('Enter image URL (or leave empty to cancel):');
  if (!url) return;
  target.image = url;
  commitChange();
}

function importImageFile(e) {
  const f = e.target.files && e.target.files[0];
  const target = primarySelection;
  if (!f || !target) return;
  const reader = new FileReader();
  reader.onload = () => { target.image = reader.result; commitChange(); };
  reader.readAsDataURL(f);
  e.target.value = '';
}

function importProjectFromFile(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      nodes.length = 0;
      links.length = 0;
      parsed.nodes.forEach(n => nodes.push({ ...n }));
      parsed.links.forEach(l => links.push({ ...l }));
      commitChange();
    } catch (err) {
      alert('Invalid JSON file: ' + err.message);
    }
  };
  reader.readAsText(f);
  e.target.value = '';
}

function exportSVG() {
  const serializer = new XMLSerializer();
  const svgNode = svg.node();
  const clone = svgNode.cloneNode(true);
  const styleEl = document.querySelector('style');
  if (styleEl) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.innerHTML = styleEl.innerHTML;
    defs.appendChild(style);
    clone.insertBefore(defs, clone.firstChild);
  }
  const str = serializer.serializeToString(clone);
  const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mindmap.svg';
  a.click();
  URL.revokeObjectURL(url);
}

function exportPNG() {
  const serializer = new XMLSerializer();
  const svgNode = svg.node();
  const clone = svgNode.cloneNode(true);
  const styleEl = document.querySelector('style');
  if (styleEl) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.innerHTML = styleEl.innerHTML;
    defs.appendChild(style);
    clone.insertBefore(defs, clone.firstChild);
  }
  const str = serializer.serializeToString(clone);
  const img = new Image();
  const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = svgNode.clientWidth;
    canvas.height = svgNode.clientHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const png = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = png;
    a.download = 'mindmap.png';
    a.click();
  };
  img.src = svg64;
}

function deleteSelectedNode() {
  if (selectedNodes.size === 0) return;
  // prevent deleting root
  const idsToDelete = Array.from(selectedNodes).filter(id => id !== 'root');
  if (idsToDelete.length === 0) return alert('Cannot delete the root node.');

  for (const id of idsToDelete) {
    const idx = nodes.findIndex(n => n.id === id);
    if (idx !== -1) nodes.splice(idx, 1);
  }

  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    const sId = typeof l.source === 'object' ? l.source.id : l.source;
    const tId = typeof l.target === 'object' ? l.target.id : l.target;
    if (idsToDelete.includes(sId) || idsToDelete.includes(tId)) links.splice(i, 1);
  }

  selectedNodes.clear();
  primarySelection = null;
  commitChange();
}

function editSelectedNode() {
  if (!primarySelection) return;
  showInlineEditor(primarySelection);
}

function saveProject() {
  const data = { nodes, links };
  localStorage.setItem('mindmap-project-v1', JSON.stringify(data));
  alert('Project saved to localStorage.');
}

function loadProject() {
  const raw = localStorage.getItem('mindmap-project-v1');
  if (!raw) return alert('No saved project found.');
  try {
    const parsed = JSON.parse(raw);
    nodes.length = 0;
    links.length = 0;
    parsed.nodes.forEach(n => nodes.push({ ...n }));
    parsed.links.forEach(l => links.push({ ...l }));
    commitChange();
  } catch (err) {
    alert('Failed to load project: ' + err.message);
  }
}

function exportProject() {
  const data = JSON.stringify({ nodes, links }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mindmap.json';
  a.click();
  URL.revokeObjectURL(url);
}

function clearProject() {
  nodes.length = 0;
  links.length = 0;
  nodes.push({ id: 'root', name: 'Life', x: window.innerWidth / 2, y: window.innerHeight / 2 });
  selectedNodes.clear();
  primarySelection = null;
  commitChange();
}

function applyTheme(theme) {
  if (theme === 'dark') document.body.classList.add('dark');
  else document.body.classList.remove('dark');
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('mindmap-theme', isDark ? 'dark' : 'light');
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = isDark ? 'Light' : 'Dark';
} 

// ---------- collapse / expand ----------
function buildParentMap() {
  const map = {};
  for (const l of links) {
    const s = (typeof l.source === 'object') ? l.source.id : l.source;
    const t = (typeof l.target === 'object') ? l.target.id : l.target;
    map[t] = s;
  }
  return map;
}

function hasCollapsedAncestor(node) {
  const parentMap = buildParentMap();
  let cur = node.id;
  while (parentMap[cur]) {
    const pId = parentMap[cur];
    const p = nodes.find(n => n.id === pId);
    if (p && p.collapsed) return true;
    cur = pId;
  }
  return false;
}

function isHiddenNode(node) {
  return hasCollapsedAncestor(node);
}

function toggleCollapseSelected() {
  if (!primarySelection) return alert('Select a node to collapse/expand');
  primarySelection.collapsed = !primarySelection.collapsed;
  commitChange();
}

// ---------- link rendering (line / curve / orthogonal) ----------
function linkPath(d) {
  const s = d.source;
  const t = d.target;
  const sx = s.x, sy = s.y, tx = t.x, ty = t.y;
  if (linkStyle === 'line') return `M${sx},${sy}L${tx},${ty}`;
  if (linkStyle === 'curve') return `M${sx},${sy}C${sx},${(sy+ty)/2} ${tx},${(sy+ty)/2} ${tx},${ty}`;
  // orthogonal
  const midY = (sy + ty) / 2;
  return `M${sx},${sy}L${sx},${midY}L${tx},${midY}L${tx},${ty}`;
}

function cycleLinkStyle() {
  const styles = ['line', 'curve', 'orthogonal'];
  const idx = styles.indexOf(linkStyle);
  linkStyle = styles[(idx + 1) % styles.length];
  const btn = document.getElementById('linkStyleBtn');
  if (btn) btn.textContent = 'Link: ' + (linkStyle === 'orthogonal' ? 'Orth' : linkStyle.charAt(0).toUpperCase() + linkStyle.slice(1));
  update();
}

// ---------- clipboard (copy / paste) ----------
function copySelected() {
  if (selectedNodes.size === 0) return alert('Select node(s) to copy');
  const sel = Array.from(selectedNodes);
  const nodesCopy = sel.map(id => JSON.parse(JSON.stringify(nodes.find(n => n.id === id))));
  const linksCopy = links.filter(l => {
    const s = (typeof l.source === 'object') ? l.source.id : l.source;
    const t = (typeof l.target === 'object') ? l.target.id : l.target;
    return sel.includes(s) && sel.includes(t);
  }).map(l => ({ source: (typeof l.source === 'object') ? l.source.id : l.source, target: (typeof l.target === 'object') ? l.target.id : l.target }));
  _clipboard = { nodes: nodesCopy, links: linksCopy };
  alert(`Copied ${nodesCopy.length} node(s)`);
}

function pasteClipboard() {
  if (!_clipboard) return alert('Clipboard empty');
  const idMap = {};
  const offset = 30;
  _clipboard.nodes.forEach(orig => {
    const newId = Date.now().toString() + Math.random().toString(36).slice(2,6);
    idMap[orig.id] = newId;
    const newNode = { ...orig, id: newId, x: (orig.x || window.innerWidth/2) + offset, y: (orig.y || window.innerHeight/2) + offset };
    nodes.push(newNode);
  });
  _clipboard.links.forEach(l => {
    const s = idMap[l.source];
    const t = idMap[l.target];
    if (s && t) links.push({ source: s, target: t });
  });
  // select pasted nodes
  selectedNodes.clear();
  const pastedIds = Object.values(idMap);
  pastedIds.forEach(id => selectedNodes.add(id));
  primarySelection = nodes.find(n => n.id === pastedIds[0]);
  commitChange();
}

// ---------- search & tags ----------
function matchesSearch(d) {
  if (!searchQuery) return true;
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  if (q.startsWith('#')) {
    const tag = q.slice(1);
    return (d.tags || []).some(t => t.toLowerCase().includes(tag));
  }
  return (d.name || '').toLowerCase().includes(q) || (d.tags || []).some(t => t.toLowerCase().includes(q));
}

function updateTagsUI() {
  const container = document.getElementById('tagsContainer');
  if (!container) return;
  container.innerHTML = '';
  if (!primarySelection || !primarySelection.tags) return;
  for (const tag of primarySelection.tags) {
    const el = document.createElement('button');
    el.className = 'tag-badge';
    el.textContent = tag + ' ×';
    el.title = 'Remove tag';
    el.addEventListener('click', () => {
      primarySelection.tags = (primarySelection.tags || []).filter(t => t !== tag);
      commitChange();
      updateTagsUI();
    });
    container.appendChild(el);
  }
}

// ---------- projects (persistent project list) ----------
function _getProjects() {
  const raw = localStorage.getItem('mindmap-projects-v1');
  return raw ? JSON.parse(raw) : {};
}

function saveProjectAs(name) {
  if (!name) return;
  const projects = _getProjects();
  projects[name] = { name, data: { nodes: JSON.parse(JSON.stringify(nodes)), links: JSON.parse(JSON.stringify(links)) }, ts: Date.now() };
  localStorage.setItem('mindmap-projects-v1', JSON.stringify(projects));
  alert('Saved project: ' + name);
}

function loadProjectByName(name) {
  const projects = _getProjects();
  if (!projects[name]) return alert('Project not found: ' + name);
  const p = projects[name].data;
  nodes.length = 0; links.length = 0;
  p.nodes.forEach(n => nodes.push({ ...n }));
  p.links.forEach(l => links.push({ ...l }));
  commitChange();
}

function deleteProjectByName(name) {
  const projects = _getProjects();
  if (!projects[name]) return;
  delete projects[name];
  localStorage.setItem('mindmap-projects-v1', JSON.stringify(projects));
  showProjectsPanel();
}

function showProjectsPanel() {
  const existing = document.getElementById('project-panel');
  if (existing) return existing.remove();
  const projects = _getProjects();
  const panel = document.createElement('div');
  panel.id = 'project-panel';
  panel.style.position = 'fixed';
  panel.style.right = '12px';
  panel.style.top = '12px';
  panel.style.background = 'var(--toolbar-bg)';
  panel.style.border = '1px solid var(--toolbar-border)';
  panel.style.padding = '12px';
  panel.style.borderRadius = '8px';
  panel.style.zIndex = 50;
  panel.style.minWidth = '260px';
  panel.innerHTML = `
    <strong>Projects</strong>
    <div id="projects-list" style="margin:8px 0; max-height:220px; overflow:auto"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="saveAsName" placeholder="project name" style="flex:1;padding:6px;border:1px solid var(--toolbar-border);border-radius:6px;background:transparent;color:var(--text-color)" />
      <button id="saveAsDo">Save</button>
    </div>
    <div style="text-align:right;margin-top:8px"><button id="closeProjects">Close</button></div>
  `;
  document.body.appendChild(panel);
  const listEl = panel.querySelector('#projects-list');
  const names = Object.keys(projects).sort((a,b)=>projects[b].ts-projects[a].ts);
  if (names.length === 0) listEl.innerHTML = '<em>No saved projects</em>';
  for (const name of names) {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = '6px 0';
    item.innerHTML = `
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
      <div style="display:flex;gap:6px">
        <button data-load="${name}">Load</button>
        <button data-delete="${name}">Delete</button>
      </div>
    `;
    listEl.appendChild(item);
  }
  panel.querySelector('#closeProjects').addEventListener('click', () => panel.remove());
  panel.querySelector('#saveAsDo').addEventListener('click', () => {
    const name = panel.querySelector('#saveAsName').value.trim();
    if (!name) return alert('Enter a name');
    saveProjectAs(name);
    panel.remove();
  });
  panel.querySelectorAll('[data-load]')?.forEach(btn => btn.addEventListener('click', (ev) => {
    const name = ev.currentTarget.getAttribute('data-load');
    if (confirm('Load project "' + name + '"? Unsaved changes will be lost.')) loadProjectByName(name);
  }));
  panel.querySelectorAll('[data-delete]')?.forEach(btn => btn.addEventListener('click', (ev) => {
    const name = ev.currentTarget.getAttribute('data-delete');
    if (confirm('Delete project "' + name + '"?')) deleteProjectByName(name);
  }));
}

// ---------- autosave (debounced) ----------
let _autosaveTimer = null;
function autosave() {
  localStorage.setItem('mindmap-autosave-v1', JSON.stringify({ nodes: JSON.parse(JSON.stringify(nodes)), links: JSON.parse(JSON.stringify(links)), ts: Date.now() }));
}


// UI + keyboard wiring
svg.on('click', () => { selectNode(null); toggleLinkMode(false); });
window.addEventListener('keydown', (e) => {
  // global shortcuts
  if (e.key === 'l') { toggleLinkMode(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { redo(); return; }
  if (e.key === 'Escape') { toggleLinkMode(false); const ed = document.getElementById('inline-editor'); if (ed) ed.remove(); return; }

  if (!selectedNode) return;
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelectedNode();
  if (e.key === 'Enter' || e.key.toLowerCase() === 'e') editSelectedNode();
});

document.getElementById('undoBtn')?.addEventListener('click', undo);
document.getElementById('redoBtn')?.addEventListener('click', redo);
document.getElementById('linkBtn')?.addEventListener('click', () => toggleLinkMode());
document.getElementById('attachImgBtn')?.addEventListener('click', attachImagePrompt);
document.getElementById('imgFile')?.addEventListener('change', importImageFile);
document.getElementById('exportPngBtn')?.addEventListener('click', exportPNG);
document.getElementById('exportSvgBtn')?.addEventListener('click', exportSVG);
document.getElementById('importBtn')?.addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile')?.addEventListener('change', importProjectFromFile);

document.getElementById('saveBtn')?.addEventListener('click', saveProject);
document.getElementById('loadBtn')?.addEventListener('click', loadProject);
document.getElementById('exportBtn')?.addEventListener('click', exportProject);
document.getElementById('clearBtn')?.addEventListener('click', clearProject);
document.getElementById('colorPicker')?.addEventListener('input', (ev) => { if (selectedNodes.size === 0) return; selectedNodes.forEach(id => { const n = nodes.find(x => x.id === id); if (n) n.color = ev.target.value; }); commitChange(); });

document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);

// search + tags
const si = document.getElementById('searchInput');
let _searchTimer = null;
if (si) si.addEventListener('input', (ev) => { clearTimeout(_searchTimer); _searchTimer = setTimeout(() => { searchQuery = ev.target.value; update(); }, 160); });
if (si) si.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const found = nodes.find(n => matchesSearch(n)); if (found) { selectNode(found); const svgEl = svg.node(); const t = d3.zoomTransform(svgEl); const width = svgEl.clientWidth, height = svgEl.clientHeight; svg.transition().call(d3.zoom().transform, d3.zoomIdentity.translate(width/2 - found.x, height/2 - found.y)); } } });

const ti = document.getElementById('tagInput');
if (ti) ti.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const v = ti.value.trim(); if (!v) return; if (!primarySelection) return alert('Select a node to tag'); primarySelection.tags = primarySelection.tags || []; if (!primarySelection.tags.includes(v)) primarySelection.tags.push(v); ti.value = ''; commitChange(); updateTagsUI(); } });

document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);

// apply saved theme
(function initTheme() {
  const saved = localStorage.getItem('mindmap-theme') || 'light';
  applyTheme(saved);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = saved === 'dark' ? 'Light' : 'Dark';
})();

// ensure nothing selected at start
selectNode(null);
// initialize history
pushHistory();
updateUndoRedoButtons();