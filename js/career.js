// Career persistence (localStorage) and the station contract board.

const SAVE_KEY = 'sableRift.save.v1';

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function loadSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    return d && d.v === 1 ? d : null;
  } catch { return null; }
}

// Saved whenever you dock or launch, so dying sends you back to your last station.
export function saveGame(game, stationIndex) {
  const p = game.player;
  const data = {
    v: 1,
    savedAt: Date.now(),
    station: stationIndex,
    credits: game.credits, cargo: game.cargo, kills: game.kills,
    upgrades: game.upgrades, missions: game.missions, navIndex: game.navIndex,
    missiles: p.missiles, decoys: p.decoys, armorFrac: p.armor / p.armorMax, abFuel: p.abFuel,
    missionSeq: game.missionSeq,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable: play without saving */ }
}

const pick = a => a[(Math.random() * a.length) | 0];
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const CLIENTS = ['Meridian Militia', 'Tolvar Mining Guild', 'Highport Traders Union', 'Independent Haulers Co-op', 'Rift Survey Office'];
const CRATES = ['sealed medical crates', 'reactor parts', 'survey instruments', 'diplomatic pouches', 'cryo-stored seed stock', 'machine spares'];

// Offers available at a station. Bounty targets are non-station nav points;
// deliveries go to the other station.
export function generateOffers(game, stationIndex) {
  const offers = [];
  const huntNavs = game.navs.map((n, i) => [n, i]).filter(([n]) => n.kind !== 'station');
  const n = ri(3, 4);
  for (let k = 0; k < n; k++) {
    const id = ++game.missionSeq;
    if (Math.random() < 0.55) {
      const [nav, navIndex] = pick(huntNavs);
      const count = ri(2, 4);
      const heavy = count >= 3 && Math.random() < 0.6 ? 1 : 0;
      const reward = Math.round((700 * count + heavy * 900 + (nav.kind === 'beacon' ? 800 : 0) + Math.random() * 500) / 50) * 50;
      offers.push({
        id, type: 'bounty', client: pick(CLIENTS), navIndex, count, heavy, killed: 0, spawned: false, reward,
        title: `Bounty: ${count} raiders at ${nav.name}`,
        desc: `Ashfang raiders${heavy ? ', including a Marauder,' : ''} have been ambushing traffic near ${nav.name}. Destroy all ${count}.`,
      });
    } else {
      const dest = game.world.stations.findIndex((s, i) => i !== stationIndex);
      const qty = ri(4, 10);
      const reward = Math.round((110 * qty + 700 + Math.random() * 500) / 50) * 50;
      const what = pick(CRATES);
      offers.push({
        id, type: 'delivery', client: pick(CLIENTS), dest, qty, reward, what,
        title: `Delivery: ${qty} t of ${what} to ${game.world.stations[dest].name}`,
        desc: `Carry ${qty} units of ${what} to ${game.world.stations[dest].name}. Raiders watch the trade lanes, so expect company.`,
      });
    }
  }
  return offers;
}

export function missionSummary(game, m) {
  if (m.type === 'bounty') return `${game.navs[m.navIndex].name}: ${m.killed}/${m.count} raiders`;
  return `${m.qty} t ${m.what} → ${game.world.stations[m.dest].name}`;
}
