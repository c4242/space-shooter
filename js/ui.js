import { COMMODITIES } from './world.js';
import { forwardOf, UPGRADES, holdFor } from './ships.js';
import { generateOffers, missionSummary, hasSave } from './career.js';
import { fmtDist } from './hud.js';
import { audio } from './audio.js';

export class UI {
  constructor(game) {
    this.g = game;
    this.mapEl = document.getElementById('map');
    this.mapCanvas = document.getElementById('mapCanvas');
    this.tradeEl = document.getElementById('trade');
    this.panel = document.getElementById('tradePanel');
    this.menuEl = document.getElementById('menu');
    this.hover = -1;

    this.mapCanvas.addEventListener('mousemove', e => {
      const h = this.navAt(e.clientX, e.clientY);
      if (h !== this.hover) { this.hover = h; this.drawMap(); }
    });
    this.mapCanvas.addEventListener('click', e => {
      const i = this.navAt(e.clientX, e.clientY);
      if (i >= 0) {
        this.g.navIndex = i;
        audio.blip();
        this.g.hud.msg(`Nav set: ${this.g.navs[i].name}`, '#7fd8ff');
        this.drawMap();
      }
    });
    this.panel.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      this.tradeAction(b.dataset.a, b.dataset.id, b.dataset.n);
    });
  }

  // ---------------------------------------------------------------- Nav map
  openMap() {
    this.g.state = 'map';
    this.mapEl.classList.remove('hidden');
    this.layoutMap();
    this.drawMap();
  }

  closeMap() {
    this.mapEl.classList.add('hidden');
    if (this.g.state === 'map') this.g.state = 'flight';
  }

  layoutMap() {
    const g = this.g, w = g.world;
    const pts = [...w.planets.map(p => p.pos), ...g.navs.map(n => n.pos), w.blackHole.pos, g.player.pos];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const pad = 20000;
    minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
    const W = this.mapCanvas.clientWidth, H = this.mapCanvas.clientHeight;
    const s = Math.min((W - 60) / (maxX - minX), (H - 150) / (maxZ - minZ));
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    this.ms = s;
    this.mp = v => [W / 2 + (v.x - cx) * s, H / 2 + 10 + (v.z - cz) * s];
  }

  navAt(x, y) {
    if (!this.mp) return -1;
    let best = -1, bd = 22;
    this.g.navs.forEach((n, i) => {
      const [px, py] = this.mp(n.pos);
      const d = Math.hypot(px - x, py - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  drawMap() {
    const g = this.g, w = g.world, cv = this.mapCanvas;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mp = this.mp, s = this.ms;

    const bg = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#071425'); bg.addColorStop(1, '#010309');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);

    // Grid (20 km)
    c.strokeStyle = 'rgba(80,140,200,0.07)'; c.lineWidth = 1;
    const step = 20000 * s;
    const [ox, oy] = mp({ x: 0, z: 0 });
    for (let x = ox % step; x < W; x += step) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = oy % step; y < H; y += step) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }

    // Orbits
    c.strokeStyle = 'rgba(120,170,220,0.12)';
    for (const p of w.planets) {
      if (p.star) continue;
      c.beginPath(); c.arc(ox, oy, Math.hypot(p.pos.x, p.pos.z) * s, 0, Math.PI * 2); c.stroke();
    }

    c.font = '12px "Share Tech Mono", monospace';
    c.textAlign = 'center';

    // Black hole and its danger zones
    const [bx, by] = mp(w.blackHole.pos);
    c.setLineDash([6, 6]);
    c.strokeStyle = 'rgba(255,180,60,0.5)';
    c.beginPath(); c.arc(bx, by, 23700 * s, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,60,60,0.8)';
    c.beginPath(); c.arc(bx, by, 7300 * s, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    const bhg = c.createRadialGradient(bx, by, 0, bx, by, 9500 * s);
    bhg.addColorStop(0, '#000'); bhg.addColorStop(0.15, '#000'); bhg.addColorStop(0.2, 'rgba(255,220,170,0.9)');
    bhg.addColorStop(0.45, 'rgba(255,120,50,0.45)'); bhg.addColorStop(1, 'rgba(120,20,80,0)');
    c.fillStyle = bhg; c.beginPath(); c.arc(bx, by, 9500 * s, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ff9a8a';
    c.fillText('SABLE RIFT (black hole)', bx, by + 9500 * s + 14);
    c.fillStyle = 'rgba(255,180,60,0.8)';
    c.fillText('gravity well', bx, by - 23700 * s - 6);

    // Asteroid belt
    const [ax, ay] = mp(w.belt.center);
    c.fillStyle = 'rgba(190,160,130,0.5)';
    for (let i = 0; i < 160; i++) {
      const a = i * 2.39996, r = (2500 + (i * 37 % 75) * 100) * s;
      c.fillRect(ax + Math.cos(a) * r, ay + Math.sin(a) * r, 1.5, 1.5);
    }

    // Planets & sun
    for (const p of w.planets) {
      const [x, y] = mp(p.pos);
      const r = Math.max(p.star ? 9 : 5, p.radius * s);
      if (p.star) {
        const sg = c.createRadialGradient(x, y, 0, x, y, r * 3);
        sg.addColorStop(0, 'rgba(255,230,160,1)'); sg.addColorStop(0.35, 'rgba(255,190,90,0.6)'); sg.addColorStop(1, 'rgba(255,150,50,0)');
        c.fillStyle = sg; c.beginPath(); c.arc(x, y, r * 3, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = p.mapColor;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      if (p.rings) {
        c.strokeStyle = 'rgba(214,180,140,0.6)';
        c.beginPath(); c.ellipse(x, y, r * 2.2, r * 0.7, -0.4, 0, Math.PI * 2); c.stroke();
      }
      c.fillStyle = 'rgba(200,220,240,0.75)';
      c.fillText(p.name, x, y + r + 14);
    }

    // Stations
    for (const st of w.stations) {
      const [x, y] = mp(st.pos);
      c.strokeStyle = '#6dff9a'; c.lineWidth = 1.5;
      c.strokeRect(x - 5, y - 5, 10, 10);
    }

    // Route line
    const nav = g.navs[g.navIndex];
    const [px, py] = mp(g.player.pos);
    if (nav) {
      const [nx, ny] = mp(nav.pos);
      c.strokeStyle = 'rgba(127,216,255,0.6)'; c.setLineDash([4, 5]); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(px, py); c.lineTo(nx, ny); c.stroke(); c.setLineDash([]);
    }

    // Nav points
    g.navs.forEach((n, i) => {
      const [x, y] = mp(n.pos);
      const sel = i === g.navIndex, hov = i === this.hover;
      const r = sel ? 11 : hov ? 10 : 8;
      c.strokeStyle = sel ? '#7fd8ff' : hov ? '#ffffff' : 'rgba(127,216,255,0.6)';
      c.fillStyle = sel ? 'rgba(127,216,255,0.25)' : 'rgba(0,0,0,0)';
      c.lineWidth = sel ? 2.2 : 1.4;
      c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath();
      c.fill(); c.stroke();
      c.fillStyle = sel ? '#bfeaff' : hov ? '#fff' : 'rgba(170,220,255,0.75)';
      c.textAlign = 'left';
      c.fillText(`${i + 1}. ${n.name}`, x + r + 6, y - 2);
      c.fillStyle = 'rgba(170,220,255,0.5)';
      c.fillText(fmtDist(n.pos.distanceTo(g.player.pos)), x + r + 6, y + 12);
      c.textAlign = 'center';
    });

    // Contract markers
    c.font = 'bold 13px "Share Tech Mono", monospace';
    for (const m of g.missions) {
      const pos = m.type === 'bounty' ? g.navs[m.navIndex].pos : w.stations[m.dest].pos;
      const [x, y] = mp(pos);
      c.fillStyle = '#ffd36b';
      c.beginPath(); c.arc(x - 16, y - 16, 8, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1a1200'; c.textAlign = 'center';
      c.fillText(m.type === 'bounty' ? '✕' : '▣', x - 16, y - 12);
    }
    c.font = '12px "Share Tech Mono", monospace';
    if (g.missions.length) {
      c.textAlign = 'left'; c.fillStyle = '#ffd36b';
      g.missions.forEach((m, i) => c.fillText(`● ${missionSummary(g, m)}`, 24, 84 + i * 16));
    }

    // Hostiles on sensors
    for (const sh of g.ships) {
      if (!sh.alive || sh.isPlayer || sh.pos.distanceTo(g.player.pos) > 25000) continue;
      const [x, y] = mp(sh.pos);
      c.fillStyle = sh.team === 'civ' ? '#ffd36b' : '#ff5a4a'; c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill();
    }

    // Player arrow
    const f = forwardOf(g.player.obj);
    const a = Math.atan2(f.z, f.x);
    c.save(); c.translate(px, py); c.rotate(a);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(10, 0); c.lineTo(-6, -6); c.lineTo(-3, 0); c.lineTo(-6, 6); c.closePath(); c.fill();
    c.restore();

    // Header & help
    c.textAlign = 'left';
    c.font = '20px "Orbitron", sans-serif';
    c.fillStyle = '#dff3ff';
    c.fillText('SABLE RIFT SYSTEM — NAV MAP', 24, 38);
    c.font = '13px "Share Tech Mono", monospace';
    c.fillStyle = 'rgba(170,220,255,0.75)';
    c.fillText('Click a nav point to plot a course · N cycles · A engages autopilot · M / Esc closes', 24, 60);
    c.textAlign = 'right';
    c.fillStyle = 'rgba(170,220,255,0.6)';
    c.fillText('◆ nav point   □ station   ● hostile   ▸ you   - - - danger zones', W - 24, H - 20);
  }

  // ------------------------------------------------------------- Docked screen
  openTrade(station) {
    const g = this.g;
    this.station = station;
    station.prices = {};
    for (const cm of COMMODITIES) {
      const buy = Math.max(5, Math.round(cm.base * station.market[cm.id] * (0.92 + Math.random() * 0.16)));
      station.prices[cm.id] = { buy, sell: Math.round(buy * 0.9) };
    }
    station.offers = generateOffers(g, g.world.stations.indexOf(station));
    this.tab = this.tab || 'market';
    g.state = 'trade';
    this.tradeEl.classList.remove('hidden');
    this.renderTrade();
  }

  closeTrade() { this.tradeEl.classList.add('hidden'); }

  renderTrade() {
    const g = this.g, st = this.station;
    const used = g.cargoUsed();
    const tabs = [['market', 'MARKET'], ['contracts', `CONTRACTS${g.missions.length ? ` (${g.missions.length})` : ''}`], ['shipyard', 'SHIPYARD'], ['services', 'SERVICES']];
    const body = { market: () => this.marketHTML(), contracts: () => this.contractsHTML(), shipyard: () => this.shipyardHTML(), services: () => this.servicesHTML() }[this.tab]();
    this.panel.innerHTML = `
      <button class="launch" data-a="launch">LAUNCH ▸</button>
      <h2>${st.name.toUpperCase()}</h2>
      <div class="sub">Docking bay 3 · your progress is saved whenever you dock or launch</div>
      <div class="stats">
        <span>Credits: <b>${g.credits.toLocaleString()}</b> cr</span>
        <span>Cargo: <b>${used}/${g.cargoCap}</b></span>
        <span>Kills: <b>${g.kills}</b></span>
      </div>
      <div class="tabs">${tabs.map(([id, t]) => `<button data-a="tab" data-id="${id}" class="${this.tab === id ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${body}
      <div class="dim foot">1–4 switch tabs · L / Esc to launch</div>`;
  }

  marketHTML() {
    const g = this.g, st = this.station;
    const free = g.cargoCap - g.cargoUsed();
    let rows = '';
    for (const cm of COMMODITIES) {
      const pr = st.prices[cm.id];
      const held = g.cargo[cm.id]?.qty || 0;
      const avg = held ? Math.round(g.cargo[cm.id].cost / held) : 0;
      const profit = held ? pr.sell - avg : 0;
      const canBuy = free > 0 && g.credits >= pr.buy;
      rows += `<tr>
        <td>${cm.name}</td>
        <td class="num">${pr.buy}</td>
        <td class="num">${pr.sell}</td>
        <td class="num">${held}${held ? ` <span class="dim">@${avg}</span> <span class="${profit >= 0 ? 'good' : 'bad'}">${profit >= 0 ? '+' : ''}${profit}</span>` : ''}</td>
        <td><button data-a="buy" data-id="${cm.id}" data-n="1" ${canBuy ? '' : 'disabled'}>BUY 1</button><button data-a="buy" data-id="${cm.id}" data-n="5" ${canBuy ? '' : 'disabled'}>5</button><button data-a="buy" data-id="${cm.id}" data-n="max" ${canBuy ? '' : 'disabled'}>MAX</button></td>
        <td><button data-a="sell" data-id="${cm.id}" data-n="1" ${held ? '' : 'disabled'}>SELL 1</button><button data-a="sell" data-id="${cm.id}" data-n="all" ${held ? '' : 'disabled'}>ALL</button></td>
      </tr>`;
    }
    const contract = g.cargo.contract?.qty || 0;
    const other = g.world.stations.find(s => s !== st);
    return `<div class="sub">Prices at ${other.name} differ: buy low here, sell there.</div>
      <table>
        <tr><th>Commodity</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">In hold</th><th></th><th></th></tr>
        ${rows}
      </table>
      ${contract ? `<div class="dim">Contract cargo in hold: ${contract} t (not for sale)</div>` : ''}`;
  }

  contractsHTML() {
    const g = this.g, st = this.station;
    const free = g.cargoCap - g.cargoUsed();
    const active = g.missions.map(m => `<tr>
        <td><b>${m.title}</b><br><span class="dim">${missionSummary(g, m)} · ${m.client}</span></td>
        <td class="num good">${m.reward.toLocaleString()} cr</td>
        <td><button data-a="abandon" data-id="${m.id}">ABANDON</button></td></tr>`).join('');
    const offers = st.offers.map(m => {
      const full = g.missions.length >= 3;
      const noRoom = m.type === 'delivery' && m.qty > free;
      return `<tr>
        <td><b>${m.title}</b><br><span class="dim">${m.desc} · ${m.client}</span></td>
        <td class="num good">${m.reward.toLocaleString()} cr</td>
        <td><button data-a="accept" data-id="${m.id}" ${full || noRoom ? 'disabled' : ''}>ACCEPT</button>${noRoom ? '<br><span class="bad">no room</span>' : ''}</td></tr>`;
    }).join('');
    return `<h3>ACTIVE CONTRACTS (${g.missions.length}/3)</h3>
      ${active ? `<table>${active}</table>` : '<p class="dim">None. Contracts pay far better than hauling cargo.</p>'}
      <h3>CONTRACT BOARD</h3>
      ${offers ? `<table>${offers}</table>` : '<p class="dim">No more work today. Check back after your next launch.</p>'}`;
  }

  shipyardHTML() {
    const g = this.g;
    let rows = '';
    for (const [id, u] of Object.entries(UPGRADES)) {
      const lvl = g.upgrades[id];
      const max = lvl >= u.costs.length;
      const cost = max ? 0 : u.costs[lvl];
      const pips = u.levels.map((_, i) => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('');
      rows += `<tr>
        <td><b>${u.name}</b><br><span class="dim">Installed: ${u.levels[lvl]}</span></td>
        <td><span class="pips">${pips}</span></td>
        <td>${max ? '<span class="dim">Fully upgraded</span>' : `Next: ${u.levels[lvl + 1]}`}</td>
        <td class="num">${max ? '' : cost.toLocaleString() + ' cr'}</td>
        <td>${max ? '' : `<button data-a="upgrade" data-id="${id}" ${g.credits >= cost ? '' : 'disabled'}>INSTALL</button>`}</td></tr>`;
    }
    return `<div class="sub">Better guns hit harder and faster, shields soak more and recharge faster, the engine adds speed and agility, and a bigger hold means bigger trade runs.</div><table>${rows}</table>`;
  }

  servicesHTML() {
    const g = this.g, p = g.player;
    const repairCost = Math.ceil((p.armorMax - p.armor) * 4);
    const fuelCost = Math.ceil((100 - p.abFuel) * 2);
    const svc = [
      ['repair', `Repair armor (${Math.round(p.armor)}/${p.armorMax})`, repairCost, p.armor < p.armorMax - 0.5],
      ['fuel', `Refuel afterburner (${Math.round(p.abFuel)}%)`, fuelCost, p.abFuel < 99.5],
      ['missile', `Seeker missile (${p.missiles}/${p.maxMissiles})`, 200, p.missiles < p.maxMissiles],
      ['decoy', `Decoy (${p.decoys}/${p.maxDecoys})`, 40, p.decoys < p.maxDecoys],
    ];
    let rows = '';
    for (const [id, lbl, cost, avail] of svc) {
      rows += `<tr><td>${lbl}</td><td class="num">${avail ? cost + ' cr' : '—'}</td><td><button data-a="svc" data-id="${id}" ${avail && g.credits >= cost && cost > 0 ? '' : 'disabled'}>${id === 'repair' || id === 'fuel' ? 'SERVICE' : 'BUY'}</button></td></tr>`;
    }
    return `<table>${rows}</table>`;
  }

  tradeAction(a, id, n) {
    const g = this.g, st = this.station, p = g.player;
    if (a === 'launch') { g.launchFromStation(st); return; }
    if (a === 'tab') { this.tab = id; audio.click(); this.renderTrade(); return; }
    if (a === 'buy') {
      const pr = st.prices[id].buy;
      const free = g.cargoCap - g.cargoUsed();
      let qty = n === 'max' ? Infinity : +n;
      qty = Math.min(qty, free, Math.floor(g.credits / pr));
      if (qty <= 0) { audio.denied(); return; }
      g.credits -= qty * pr;
      const c = g.cargo[id] || (g.cargo[id] = { qty: 0, cost: 0 });
      c.qty += qty; c.cost += qty * pr;
      audio.click();
    } else if (a === 'sell') {
      const c = g.cargo[id];
      if (!c || !c.qty) return;
      const qty = n === 'all' ? c.qty : Math.min(+n, c.qty);
      const avg = c.cost / c.qty;
      g.credits += qty * st.prices[id].sell;
      c.qty -= qty; c.cost -= avg * qty;
      if (c.qty <= 0) delete g.cargo[id];
      audio.cash();
    } else if (a === 'svc') {
      if (id === 'repair') { g.credits -= Math.ceil((p.armorMax - p.armor) * 4); p.armor = p.armorMax; }
      if (id === 'fuel') { g.credits -= Math.ceil((100 - p.abFuel) * 2); p.abFuel = 100; }
      if (id === 'missile') { g.credits -= 200; p.missiles++; }
      if (id === 'decoy') { g.credits -= 40; p.decoys++; }
      audio.cash();
    } else if (a === 'upgrade') {
      const u = UPGRADES[id], lvl = g.upgrades[id], cost = u.costs[lvl];
      if (cost === undefined || g.credits < cost) { audio.denied(); return; }
      g.credits -= cost;
      g.upgrades[id]++;
      g.applyUpgrades();
      audio.chime();
    } else if (a === 'accept') {
      const i = st.offers.findIndex(m => m.id === +id);
      if (i < 0) return;
      const m = st.offers[i];
      if (m.type === 'delivery') {
        const c = g.cargo.contract || (g.cargo.contract = { qty: 0, cost: 0 });
        c.qty += m.qty;
      } else {
        g.navIndex = m.navIndex;
      }
      st.offers.splice(i, 1);
      g.missions.push(m);
      audio.chime();
    } else if (a === 'abandon') {
      const i = g.missions.findIndex(m => m.id === +id);
      if (i < 0) return;
      g.abandonMission(g.missions[i]);
      audio.denied();
    }
    this.renderTrade();
  }

  // -------------------------------------------------------------------- Menu
  showMenu(kind, text = '') {
    const title = document.getElementById('menuTitle');
    const sub = document.getElementById('menuText');
    const btn = document.getElementById('menuBtn');
    const btn2 = document.getElementById('menuBtn2');
    const hint = document.getElementById('menuHint');
    this.menuEl.classList.remove('hidden');
    btn2.classList.add('hidden');
    if (kind === 'start') {
      if (hasSave()) {
        btn.textContent = 'CONTINUE';
        btn2.textContent = 'NEW PILOT';
        btn2.classList.remove('hidden');
      } else btn.textContent = 'LAUNCH';
    } else if (kind === 'paused') {
      title.textContent = 'PAUSED';
      sub.textContent = 'Controls';
      btn.textContent = 'RESUME';
      hint.textContent = 'P / Esc to resume · U toggles music · K mutes all sound';
    } else if (kind === 'dead') {
      title.textContent = 'SHIP LOST';
      sub.textContent = text;
      if (hasSave()) {
        btn.textContent = 'RELOAD SAVE';
        btn2.textContent = 'NEW PILOT';
        btn2.classList.remove('hidden');
        hint.textContent = `Reload returns you to the last station you docked at. Kills this run: ${this.g.kills}`;
      } else {
        btn.textContent = 'NEW PILOT';
        hint.textContent = `Credits: ${this.g.credits.toLocaleString()} · Kills: ${this.g.kills}`;
      }
    }
    this.menuKind = kind;
  }

  hideMenu() { this.menuEl.classList.add('hidden'); }
}
