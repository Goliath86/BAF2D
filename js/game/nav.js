// Navigazione sulla griglia dei tile per l'IA: percorsi A* (8 direzioni, niente tagli d'angolo),
// visita in ampiezza a distanza limitata (ricerca di coperture/posizioni), linea di vista.
// I tile non solidi sono percorribili: i soldati (hitbox 10x10) passano in varchi larghi un tile (16 px).

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Coda di priorità minima (heap binario) di indici con priorità float. */
class Heap {
  constructor() {
    this.items = [];
    this.prio = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, p) {
    const a = this.items;
    const q = this.prio;
    let i = a.length;
    a.push(item);
    q.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent] <= p) break;
      a[i] = a[parent];
      q[i] = q[parent];
      i = parent;
    }
    a[i] = item;
    q[i] = p;
  }

  pop() {
    const a = this.items;
    const q = this.prio;
    const top = a[0];
    const lastItem = a.pop();
    const lastP = q.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && q[r] < q[l] ? r : l;
        if (q[c] >= lastP) break;
        a[i] = a[c];
        q[i] = q[c];
        i = c;
      }
      a[i] = lastItem;
      q[i] = lastP;
    }
    return top;
  }
}

export class Nav {
  constructor(map) {
    this.map = map;
    this.cols = map.cols;
    this.rows = map.rows;
    this.size = map.size;
    const n = this.cols * this.rows;
    this.walk = new Uint8Array(n);
    this.clear = new Uint8Array(n);
    this.refresh();
    this._minClear = 1; // spazio minimo richiesto durante una ricerca (findPath con minClear)
    // buffer riutilizzati da A* e BFS
    this._g = new Float32Array(n);
    this._from = new Int32Array(n);
    this._stamp = new Uint32Array(n);
    this._closed = new Uint32Array(n);
    this._run = 0;
  }

  /** Ricalcola tile percorribili e spazio libero dalla mappa (all'inizio e quando un tile viene distrutto). */
  refresh() {
    const map = this.map;
    const n = this.cols * this.rows;
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) this.walk[ty * this.cols + tx] = map.isSolidTile(tx, ty) ? 0 : 1;
    }
    // spazio libero: distanza (in tile, Chebyshev) dal tile solido più vicino o dal bordo;
    // 0 = solido, 1 = confina con un solido, 2 = c'è almeno un tile libero tutto attorno (mezzi), ...
    // visita in ampiezza: prima i solidi (0), poi i bordi (1), così ogni tile entra in coda una volta sola
    const queue = (this._queue ||= new Int32Array(n * 2));
    let len = 0;
    for (let i = 0; i < n; i++) {
      const tx = i % this.cols;
      const ty = Math.floor(i / this.cols);
      const border = tx === 0 || ty === 0 || tx === this.cols - 1 || ty === this.rows - 1;
      if (!this.walk[i]) {
        this.clear[i] = 0;
        queue[len++] = i;
      } else this.clear[i] = border ? 1 : 255;
    }
    for (let i = 0; i < n; i++) {
      const tx = i % this.cols;
      const ty = Math.floor(i / this.cols);
      if (this.walk[i] && (tx === 0 || ty === 0 || tx === this.cols - 1 || ty === this.rows - 1)) queue[len++] = i;
    }
    for (let q = 0; q < len; q++) {
      const i = queue[q];
      const tx = i % this.cols;
      const ty = Math.floor(i / this.cols);
      for (const [dx, dy] of DIRS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const j = ny * this.cols + nx;
        if (this.clear[j] > this.clear[i] + 1) {
          this.clear[j] = this.clear[i] + 1;
          queue[len++] = j;
        }
      }
    }
  }

  index(tx, ty) {
    return ty * this.cols + tx;
  }

  tileOf(x, y) {
    const tx = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.size)));
    const ty = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.size)));
    return ty * this.cols + tx;
  }

  center(i) {
    return { x: ((i % this.cols) + 0.5) * this.size, y: (Math.floor(i / this.cols) + 0.5) * this.size };
  }

  walkable(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows && this.walk[ty * this.cols + tx] === 1;
  }

  /** true se il tile i confina (anche in diagonale) con un tile solido: buono per ripararsi. */
  nearWall(i) {
    const tx = i % this.cols;
    const ty = Math.floor(i / this.cols);
    for (const [dx, dy] of DIRS) if (!this.walkable(tx + dx, ty + dy)) return true;
    return false;
  }

  /** Spazio libero minimo (vedi clear) per un'unità di semi-larghezza hw px: 1 per i soldati, 2+ per i mezzi. */
  clearanceFor(hw) {
    const half = this.size / 2;
    return hw <= half ? 1 : 1 + Math.ceil((hw - half) / this.size);
  }

  /** Tile percorribile (con almeno minClear di spazio) più vicino a (x, y) entro r tile (o -1). */
  nearestWalkable(x, y, r = 4, minClear = 1) {
    const i0 = this.tileOf(x, y);
    if (this.clear[i0] >= minClear) return i0;
    const tx0 = i0 % this.cols;
    const ty0 = Math.floor(i0 / this.cols);
    let best = -1;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!this.walkable(tx0 + dx, ty0 + dy) || this.clear[this.index(tx0 + dx, ty0 + dy)] < minClear) continue;
        const c = this.center(this.index(tx0 + dx, ty0 + dy));
        const d = Math.hypot(c.x - x, c.y - y);
        if (d < bestD) {
          bestD = d;
          best = this.index(tx0 + dx, ty0 + dy);
        }
      }
    }
    return best;
  }

  _neighbors(i, fn) {
    const tx = i % this.cols;
    const ty = Math.floor(i / this.cols);
    for (const [dx, dy, cost] of DIRS) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (!this.walkable(nx, ny) || this.clear[ny * this.cols + nx] < this._minClear) continue;
      // in diagonale solo se entrambi i tile ortogonali sono liberi (niente tagli d'angolo)
      if (dx && dy && (!this.walkable(tx + dx, ty) || !this.walkable(tx, ty + dy))) continue;
      fn(ny * this.cols + nx, cost);
    }
  }

  /**
   * Visita in ampiezza (Dijkstra a costi 1 / √2) dal punto (x, y) fino a maxDist tile.
   * Restituisce { list: [indici raggiunti], dist(i) -> distanza in tile o Infinity }.
   */
  reach(x, y, maxDist) {
    const start = this.nearestWalkable(x, y, 2);
    const run = ++this._run;
    const g = this._g;
    const stamp = this._stamp;
    const list = [];
    if (start < 0) return { list, dist: () => Infinity };
    const heap = new Heap();
    g[start] = 0;
    stamp[start] = run;
    heap.push(start, 0);
    const closed = this._closed;
    while (heap.size) {
      const i = heap.pop();
      if (closed[i] === run) continue;
      closed[i] = run;
      list.push(i);
      this._neighbors(i, (j, cost) => {
        const d = g[i] + cost;
        if (d > maxDist) return;
        if (stamp[j] === run && g[j] <= d) return;
        stamp[j] = run;
        g[j] = d;
        heap.push(j, d);
      });
    }
    // distanze lette dai buffer: valide finché non parte un'altra ricerca (reach/findPath)
    return { list, dist: (i) => (closed[i] === run && this._run === run ? g[i] : Infinity) };
  }

  /**
   * Percorso da (x0, y0) a (x1, y1): lista di punti { x, y } (centri dei tile, già "tirati" dove
   * il passaggio è libero per un soldato di semi-dimensioni hw). [] se già arrivati, null se irraggiungibile.
   */
  findPath(x0, y0, x1, y1, hw = 5, maxNodes = Math.max(4000, this.cols * this.rows), minClear = 1) {
    let start = this.nearestWalkable(x0, y0, 2, minClear);
    if (start < 0) start = this.nearestWalkable(x0, y0, 2);
    const goal = this.nearestWalkable(x1, y1, 4, minClear);
    if (start < 0 || goal < 0) return null;
    this._minClear = minClear;
    try {
      return this._findPath(start, goal, x0, y0, x1, y1, hw, maxNodes);
    } finally {
      this._minClear = 1;
    }
  }

  _findPath(start, goal, x0, y0, x1, y1, hw, maxNodes) {
    if (start === goal) return [this._goalPoint(goal, x1, y1)];
    const run = ++this._run;
    const g = this._g;
    const from = this._from;
    const stamp = this._stamp;
    const closed = this._closed;
    const gx = goal % this.cols;
    const gy = Math.floor(goal / this.cols);
    const h = (i) => {
      const dx = Math.abs((i % this.cols) - gx);
      const dy = Math.abs(Math.floor(i / this.cols) - gy);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };
    const heap = new Heap();
    g[start] = 0;
    from[start] = -1;
    stamp[start] = run;
    heap.push(start, h(start));
    let found = false;
    let visited = 0;
    while (heap.size && visited < maxNodes) {
      const i = heap.pop();
      if (closed[i] === run) continue;
      closed[i] = run;
      visited++;
      if (i === goal) {
        found = true;
        break;
      }
      this._neighbors(i, (j, cost) => {
        if (closed[j] === run) return;
        const d = g[i] + cost;
        if (stamp[j] === run && g[j] <= d) return;
        stamp[j] = run;
        g[j] = d;
        from[j] = i;
        heap.push(j, d + h(j));
      });
    }
    if (!found) return null;
    const tiles = [];
    for (let i = goal; i !== -1; i = from[i]) tiles.push(i);
    tiles.reverse();
    const pts = tiles.map((i) => this.center(i));
    pts[pts.length - 1] = this._goalPoint(goal, x1, y1);
    return this._smooth(x0, y0, pts, hw);
  }

  /** Punto finale: la destinazione esatta se sta nel tile d'arrivo, altrimenti il centro del tile. */
  _goalPoint(goal, x, y) {
    return this.tileOf(x, y) === goal ? { x, y } : this.center(goal);
  }

  /** "Tira" il percorso: salta i punti intermedi quando il tragitto diretto è libero. */
  _smooth(x0, y0, pts, hw) {
    const out = [];
    let ax = x0;
    let ay = y0;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clearPath(ax, ay, pts[j].x, pts[j].y, hw)) j--;
      out.push(pts[j]);
      ax = pts[j].x;
      ay = pts[j].y;
      i = j + 1;
    }
    return out;
  }

  /** Un soldato di semi-dimensioni hw può andare in linea retta da (x0,y0) a (x1,y1) senza urtare. */
  clearPath(x0, y0, x1, y1, hw) {
    const r = hw + 1;
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / 4));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (this.map.rectHitsSolid(x - r, y - r, r * 2, r * 2)) return false;
    }
    return true;
  }

  /** Linea di vista tra due punti (passi di 3 px). */
  los(x0, y0, x1, y1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.map.blocksShotAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }
}
