// Career persistence (localStorage), reputation, the contract board and jump routing.
import { SYSTEMS } from './world.js';

const SAVE_KEY = 'sableRift.save.v2';

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function loadSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    return d && d.v === 2 ? d : null;
  } catch { return null; }
}

// Saved whenever you dock or launch, so dying sends you back to your last station.
export function saveGame(game, stationIndex) {
  const p = game.player;
  const data = {
    v: 2, savedAt: Date.now(), sys: game.sys, station: stationIndex,
    credits: game.credits, cargo: game.cargo, kills: game.kills, rep: game.rep,
    upgrades: game.upgrades, missions: game.missions, missionSeq: game.missionSeq, navIndex: game.navIndex,
    story: game.story, ammo: p.ammo, missileType: p.missileType, decoys: p.decoys,
    armorFrac: p.armor / p.armorMax, abFuel: p.abFuel,
    hull: game.hull, wing: game.wing, sysHealth: p.sys, score: game.score,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable: play without saving */ }
}

// ---------------------------------------------------------------- pilot rank
export const RANKS = [
  { name: 'Cadet', at: 0 }, { name: 'Pilot Officer', at: 10 }, { name: 'Flight Lieutenant', at: 30 },
  { name: 'Veteran', at: 65 }, { name: 'Squadron Leader', at: 120 }, { name: 'Ace', at: 200 }, { name: 'Legend', at: 320 },
];
export function rankOf(score) { let r = 0; RANKS.forEach((x, i) => { if (score >= x.at) r = i; }); return r; }
// Each rank adds 5% to bounty and contract pay.
export const rankBonus = score => 1 + 0.05 * rankOf(score);

// ---------------------------------------------------------------- reputation
export const REP_WANTED = -25;
export function repLabel(v) {
  if (v <= -60) return 'Hated';
  if (v <= REP_WANTED) return 'Wanted';
  if (v < -5) return 'Suspect';
  if (v < 10) return 'Neutral';
  if (v < 30) return 'Trusted';
  return 'Honored';
}
export function changeRep(game, faction, delta) {
  const before = game.rep[faction];
  game.rep[faction] = Math.max(-100, Math.min(100, before + delta));
  return { before, after: game.rep[faction] };
}

// ------------------------------------------------------------------- routing
export function navName(sys, i) {
  const n = SYSTEMS[sys].navs[i];
  return n.station !== undefined ? SYSTEMS[sys].stations[n.station].name : n.name;
}
export function stationNav(sys, stationIndex) {
  return SYSTEMS[sys].navs.findIndex(n => n.station === stationIndex);
}
// Index (in `from`) of the jump gate that leads toward system `to`, or -1.
export function gateToward(from, to) {
  if (from === to) return -1;
  const prev = { [from]: null }, q = [from];
  while (q.length) {
    const s = q.shift();
    for (const n of SYSTEMS[s].navs) if (n.kind === 'jump' && !(n.to in prev)) { prev[n.to] = s; q.push(n.to); }
  }
  if (!(to in prev)) return -1;
  let step = to;
  while (prev[step] !== from) step = prev[step];
  return SYSTEMS[from].navs.findIndex(n => n.kind === 'jump' && n.to === step);
}
export function jumpsBetween(a, b) {
  if (a === b) return 0;
  const dist = { [a]: 0 }, q = [a];
  while (q.length) {
    const s = q.shift();
    for (const n of SYSTEMS[s].navs) if (n.kind === 'jump' && !(n.to in dist)) { dist[n.to] = dist[s] + 1; q.push(n.to); }
  }
  return dist[b] ?? 9;
}

// ----------------------------------------------------------------- contracts
const pick = a => a[(Math.random() * a.length) | 0];
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const round50 = v => Math.round(v / 50) * 50;

const CLIENTS = ['Meridian Militia', 'Tolvar Mining Guild', 'Highport Traders Union', 'Independent Haulers Co-op', 'Rift Survey Office', 'Corvane Admiralty', 'Port Lys Agricultural Board'];
const SHADY = ['a man called Oskel', 'the Gallows quartermaster', 'an Ashfang fixer', 'a nervous broker'];
const CRATES = ['sealed medical crates', 'reactor parts', 'survey instruments', 'diplomatic pouches', 'cryo-stored seed stock', 'machine spares'];

function legalStations() {
  const out = [];
  for (const [sys, d] of Object.entries(SYSTEMS)) d.stations.forEach((st, i) => { if (!st.outpost) out.push({ sys, i, name: st.name }); });
  return out;
}

export function generateOffers(game, station) {
  const here = game.sys;
  const offers = [];
  const repBonus = 1 + Math.max(0, game.rep.authority) / 200;
  const n = ri(3, 4);
  for (let k = 0; k < n; k++) {
    const id = ++game.missionSeq;
    if (station.outpost) {
      // Smuggling: carry contraband to a legal station; police scans will find it.
      const dest = pick(legalStations());
      const qty = ri(3, 8);
      const reward = round50((420 * qty + 900 * jumpsBetween(here, dest.sys)) * (1 + Math.max(0, game.rep.ashfang) / 150));
      offers.push({
        id, type: 'delivery', illegal: true, client: pick(SHADY), sys: dest.sys, dest: dest.i, qty, reward, what: 'unmarked crates',
        title: `Smuggling: ${qty} t to ${dest.name}`,
        desc: `No questions. Deliver to ${dest.name} (${SYSTEMS[dest.sys].name}). Authority patrols scan cargo: if they find this, you pay.`,
      });
      continue;
    }
    if (Math.random() < 0.55) {
      // Bounty in this system or a neighbouring one.
      const systems = [here, ...SYSTEMS[here].navs.filter(x => x.kind === 'jump').map(x => x.to)];
      const sys = Math.random() < 0.65 ? here : pick(systems);
      const huntNavs = SYSTEMS[sys].navs.map((nv, i) => [nv, i]).filter(([nv]) => nv.station === undefined && nv.kind !== 'jump');
      const [nav, navIndex] = pick(huntNavs);
      const count = ri(2, 4) + (sys === 'hollow' ? 1 : 0);
      const heavy = count >= 3 && Math.random() < 0.6 ? 1 : 0;
      const reward = round50((700 * count + heavy * 900 + (nav.kind === 'beacon' || nav.kind === 'lair' ? 900 : 0) + 800 * jumpsBetween(here, sys) + Math.random() * 500) * repBonus);
      offers.push({
        id, type: 'bounty', client: pick(CLIENTS), sys, navIndex, count, heavy, killed: 0, spawned: false, reward,
        title: `Bounty: ${count} raiders at ${navName(sys, navIndex)}${sys !== here ? ` (${SYSTEMS[sys].name})` : ''}`,
        desc: `Ashfang raiders${heavy ? ', including a Marauder,' : ''} have been ambushing traffic near ${navName(sys, navIndex)}. Destroy all ${count}.`,
      });
    } else {
      const choices = legalStations().filter(d => !(d.sys === here && d.i === station.index));
      const dest = pick(choices);
      const qty = ri(4, 10);
      const reward = round50((110 * qty + 700 + 1100 * jumpsBetween(here, dest.sys) + Math.random() * 500) * repBonus);
      const what = pick(CRATES);
      offers.push({
        id, type: 'delivery', client: pick(CLIENTS), sys: dest.sys, dest: dest.i, qty, reward, what,
        title: `Delivery: ${qty} t of ${what} to ${dest.name}${dest.sys !== here ? ` (${SYSTEMS[dest.sys].name})` : ''}`,
        desc: `Carry ${qty} units of ${what} to ${dest.name}. Raiders watch the trade lanes, so expect company.`,
      });
    }
  }
  return offers;
}

export function missionSummary(game, m) {
  const where = m.sys !== game.sys ? ` [${SYSTEMS[m.sys].name}]` : '';
  if (m.type === 'bounty') return `${navName(m.sys, m.navIndex)}: ${m.killed}/${m.count} raiders${where}`;
  return `${m.qty} t ${m.illegal ? 'contraband' : m.what} → ${SYSTEMS[m.sys].stations[m.dest].name}${where}`;
}
