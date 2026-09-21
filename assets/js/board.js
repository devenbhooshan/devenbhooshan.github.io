(() => {
	"use strict";

	const root = document.documentElement;
	const canvas = document.getElementById("board");
	const ctx = canvas.getContext("2d");
	const toastEl = document.getElementById("toast");
	const drawers = [...document.querySelectorAll(".pane--drawer")];
	const navLinks = [...document.querySelectorAll('.moves-nav a[href^="#"]')];
	const reduce = matchMedia("(prefers-reduced-motion: reduce)");

	const C = {
		last: "rgba(240, 201, 74, 0.34)",
		glow: "240, 201, 74",
		dot: "rgba(236, 230, 208, 0.28)",
		ring: "rgba(236, 230, 208, 0.5)",
		hover: "rgba(236, 230, 208, 0.16)",
		piece: "#efe9d4",
		pieceLine: "#142219"
	};
	const JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
	const HOP_MS = 260;
	const RING_S = 0.085;
	const RINGS = 9;

	let cell = 56, vw = 0, vh = 0, dpr = 1, cols = 0, rows = 0, mobile = false;
	let rects = [];
	let knight = null;
	let last = null;
	let hop = null;
	let ripple = null;
	let hover = null;
	let pointer = null;
	let blunders = 0;
	let queued = false;
	let toastTimer = 0;

	/* ---------- geometry ---------- */

	function layout() {
		vw = innerWidth;
		vh = innerHeight;
		mobile = vw < 760;
		cell = mobile ? vw / 8 : Math.max(44, Math.min(64, Math.floor(vw / 21)));
		root.style.setProperty("--cell", cell + "px");
		cols = Math.ceil(vw / cell);
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(vw * dpr);
		canvas.height = Math.round(vh * dpr);
		snapPanes();
		measure();
	}

	// Round every pane up to a whole number of squares so the next one lands on the grid.
	function snapPanes() {
		for (const pane of document.querySelectorAll(".pane")) {
			const inner = pane.firstElementChild;
			if (!inner) continue;
			pane.style.minHeight = Math.ceil(inner.offsetHeight / cell) * cell + "px";
		}
	}

	function measure() {
		const sy = scrollY;
		rects = [...document.querySelectorAll(".pane")]
			.filter(p => p.offsetParent !== null)
			.map(p => {
				const b = p.getBoundingClientRect();
				return { x: b.left, y: b.top + sy, r: b.right, b: b.bottom + sy };
			});
		rows = Math.ceil(document.documentElement.scrollHeight / cell);
	}

	const same = (a, b) => a && b && a.i === b.i && a.j === b.j;

	function free(sq) {
		if (sq.i < 0 || sq.j < 0 || sq.i >= cols || sq.j >= rows) return false;
		if ((sq.i + 1) * cell > vw + 1) return false;
		const cx = (sq.i + 0.5) * cell, cy = (sq.j + 0.5) * cell;
		return !rects.some(r => cx > r.x && cx < r.r && cy > r.y && cy < r.b);
	}

	function targets(from) {
		return JUMPS.map(([di, dj]) => ({ i: from.i + di, j: from.j + dj })).filter(free);
	}

	const legal = to => knight && targets(knight).some(t => same(t, to));

	function squareAt(clientX, clientY) {
		return { i: Math.floor(clientX / cell), j: Math.floor((clientY + scrollY) / cell) };
	}

	// Knight-move distance from a square, over the rows near the viewport.
	function knightDistances(from) {
		const top = Math.max(0, Math.floor(scrollY / cell) - 6);
		const bottom = Math.ceil((scrollY + vh) / cell) + 6;
		const dist = new Map([[from.i + "," + from.j, 0]]);
		const queue = [from];
		while (queue.length) {
			const q = queue.shift();
			const d = dist.get(q.i + "," + q.j);
			if (d >= RINGS) continue;
			for (const [di, dj] of JUMPS) {
				const n = { i: q.i + di, j: q.j + dj };
				const k = n.i + "," + n.j;
				if (n.i < 0 || n.i >= cols || n.j < top || n.j > bottom || dist.has(k)) continue;
				dist.set(k, d + 1);
				queue.push(n);
			}
		}
		return dist;
	}

	function nearestFree(from) {
		const seen = new Set([from.i + "," + from.j]);
		const queue = [from];
		while (queue.length) {
			const q = queue.shift();
			if (free(q)) return q;
			for (const [di, dj] of JUMPS) {
				const n = { i: q.i + di, j: q.j + dj };
				const k = n.i + "," + n.j;
				if (n.i < -2 || n.i > cols + 2 || n.j < 0 || n.j > rows || seen.has(k)) continue;
				seen.add(k);
				queue.push(n);
			}
		}
		return null;
	}

	function squareName(sq) {
		let n = sq.i, file = "";
		do { file = String.fromCharCode(97 + (n % 26)) + file; n = Math.floor(n / 26) - 1; } while (n >= 0);
		return file + (sq.j + 1);
	}

	/* ---------- moving ---------- */

	function move(to, { speak = true } = {}) {
		if (!knight || same(knight, to)) return;
		const wasLegal = legal(to);
		const from = knight;
		knight = to;
		last = { from, to };
		const now = performance.now();
		if (!reduce.matches) {
			hop = { from, to, t0: now };
			ripple = { at: to, t0: now + HOP_MS * 0.6, dist: knightDistances(to) };
		}
		if (speak) {
			if (wasLegal) {
				say(`Knight to ${squareName(to)}.`);
			} else {
				blunders++;
				const lines = [
					"Knights move in an L. I know.",
					`That's blunder number ${blunders}. Told you I'm bad at this.`,
					"Illegal, but it's my board, so it stands."
				];
				say(`<b>??</b> Knight to ${squareName(to)}. ${lines[(blunders - 1) % lines.length]}`);
			}
		}
		invalidate();
	}

	function relocate() {
		if (!knight || free(knight)) return;
		const to = nearestFree(knight);
		if (to) move(to, { speak: false });
	}

	function say(html) {
		toastEl.innerHTML = html;
		toastEl.classList.add("is-on");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 3200);
	}

	/* ---------- drawing ---------- */

	function invalidate() {
		if (queued) return;
		queued = true;
		requestAnimationFrame(draw);
	}

	const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

	function fillSquare(sq, style, sy) {
		const x0 = Math.round(sq.i * cell), x1 = Math.round((sq.i + 1) * cell);
		const y0 = Math.round(sq.j * cell - sy), y1 = Math.round((sq.j + 1) * cell - sy);
		ctx.fillStyle = style;
		ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
	}

	function draw(now) {
		queued = false;
		let animating = false;
		const sy = scrollY;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, vw, vh);

		if (last) {
			fillSquare(last.from, C.last, sy);
			fillSquare(last.to, C.last, sy);
		}

		if (ripple) {
			const t = (now - ripple.t0) / 1000;
			if (t > RINGS * RING_S + 0.4) {
				ripple = null;
			} else {
				animating = true;
				if (t > -0.05) {
					for (const [k, d] of ripple.dist) {
						if (d === 0) continue;
						const a = Math.exp(-(((t - d * RING_S) / 0.11) ** 2)) * (1 - d / (RINGS + 1));
						if (a < 0.02) continue;
						const [i, j] = k.split(",").map(Number);
						fillSquare({ i, j }, `rgba(${C.glow}, ${(a * 0.5).toFixed(3)})`, sy);
					}
				}
			}
		}

		if (hover && !same(hover, knight) && !legal(hover)) {
			const x = Math.round(hover.i * cell), y = Math.round(hover.j * cell - sy);
			ctx.strokeStyle = C.hover;
			ctx.lineWidth = 2;
			ctx.strokeRect(x + 1, y + 1, Math.round(cell) - 2, Math.round(cell) - 2);
		}

		let p = 1;
		if (hop) {
			p = Math.min(1, (now - hop.t0) / HOP_MS);
			if (p >= 1) hop = null; else animating = true;
		}

		if (knight && !hop) {
			for (const t of targets(knight)) {
				const cx = (t.i + 0.5) * cell, cy = (t.j + 0.5) * cell - sy;
				ctx.beginPath();
				if (same(t, hover)) {
					ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
					ctx.strokeStyle = C.ring;
					ctx.lineWidth = cell * 0.08;
					ctx.stroke();
				} else {
					ctx.arc(cx, cy, cell * 0.15, 0, Math.PI * 2);
					ctx.fillStyle = C.dot;
					ctx.fill();
				}
			}
		}

		if (knight) {
			let ci = knight.i, cj = knight.j, lift = 0;
			if (hop) {
				const e = ease(p);
				ci = hop.from.i + (hop.to.i - hop.from.i) * e;
				cj = hop.from.j + (hop.to.j - hop.from.j) * e;
				lift = Math.sin(Math.PI * p);
			}
			drawKnight((ci + 0.5) * cell, (cj + 0.5) * cell - sy, 1 + lift * 0.18, lift);
		}

		if (animating) invalidate();
	}

	const PIECE_FONT = '"Apple Symbols", "Segoe UI Symbol", "DejaVu Sans", "Noto Sans Symbols 2", serif';

	function drawKnight(x, y, scale, lift) {
		const size = cell * 1.02 * scale;
		ctx.save();
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.font = `${size}px ${PIECE_FONT}`;
		if (lift > 0) {
			ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
			ctx.shadowBlur = 14 * lift;
			ctx.shadowOffsetY = 10 * lift;
		}
		// A white piece: the solid silhouette in ivory, then the outline glyph on top.
		ctx.fillStyle = C.piece;
		ctx.fillText("♞︎", x, y + size * 0.04);
		ctx.shadowColor = "transparent";
		ctx.fillStyle = C.pieceLine;
		ctx.fillText("♘︎", x, y + size * 0.04);
		ctx.restore();
	}

	/* ---------- routing between panes ---------- */

	function route({ initial = false } = {}) {
		const id = location.hash.slice(1);
		const target = drawers.find(d => d.id === id) || null;
		for (const d of drawers) {
			d.classList.toggle("is-open", d === target);
			d.classList.remove("is-opening");
		}
		for (const a of navLinks) {
			if (target && a.getAttribute("href") === "#" + target.id) a.setAttribute("aria-current", "true");
			else a.removeAttribute("aria-current");
		}
		if (target && !initial) {
			if (!reduce.matches) {
				void target.offsetWidth;
				target.classList.add("is-opening");
			}
			const heading = target.querySelector("h2");
			if (mobile) target.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
			heading.focus({ preventScroll: true });
		}
		snapPanes();
		measure();
		relocate();
		invalidate();
	}

	function go(hash) {
		history.pushState(null, "", hash || location.pathname + location.search);
		route();
	}

	/* ---------- events ---------- */

	document.addEventListener("click", e => {
		const a = e.target.closest('a[href^="#"]');
		if (a && a.getAttribute("href").length > 1 && drawers.some(d => "#" + d.id === a.getAttribute("href"))) {
			e.preventDefault();
			go(a.getAttribute("href"));
			return;
		}
		const close = e.target.closest(".close");
		if (close) {
			const link = navLinks.find(l => l.getAttribute("href") === "#" + close.closest(".pane").id);
			go("");
			if (link) link.focus();
		}
	});

	document.addEventListener("keydown", e => {
		if (e.key === "Escape" && drawers.some(d => d.classList.contains("is-open"))) go("");
	});

	addEventListener("popstate", () => route());

	document.addEventListener("pointerdown", e => {
		if (e.button !== 0 || e.target.closest("a, button, .pane, .toast")) return;
		const sq = squareAt(e.clientX, e.clientY);
		if (!free(sq)) return;
		move(sq);
	});

	function updateHover() {
		let next = null;
		if (pointer) {
			const sq = squareAt(pointer.x, pointer.y);
			if (free(sq)) next = sq;
		}
		if (!same(next, hover)) {
			hover = next;
			document.body.style.cursor = hover ? "pointer" : "";
			invalidate();
		}
	}

	document.addEventListener("pointermove", e => {
		if (e.pointerType !== "mouse") return;
		pointer = e.target.closest(".pane, .toast") ? null : { x: e.clientX, y: e.clientY };
		updateHover();
	});

	document.addEventListener("pointerleave", () => { pointer = null; updateHover(); });

	addEventListener("scroll", () => { updateHover(); invalidate(); }, { passive: true });

	let resizeTimer = 0;
	addEventListener("resize", () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => { layout(); relocate(); invalidate(); }, 60);
	});

	for (const btn of document.querySelectorAll("[data-knight-move]")) {
		btn.addEventListener("click", () => {
			if (!knight) return;
			const options = targets(knight);
			const to = options.length ? options[Math.floor(Math.random() * options.length)] : nearestFree(knight);
			if (to) move(to);
			if (mobile && to) {
				const y = to.j * cell;
				if (y < scrollY || y > scrollY + vh - cell) scrollTo({ top: Math.max(0, y - cell), behavior: reduce.matches ? "auto" : "smooth" });
			}
		});
	}

	if ("ResizeObserver" in window) {
		const ro = new ResizeObserver(() => { snapPanes(); measure(); relocate(); invalidate(); });
		for (const p of document.querySelectorAll(".pane__in")) ro.observe(p);
	}

	/* ---------- start ---------- */

	layout();
	route({ initial: true });
	knight = nearestFree(mobile ? { i: 5, j: 1 } : { i: Math.min(cols - 2, 13), j: 4 });
	if (knight && !reduce.matches) {
		ripple = { at: knight, t0: performance.now() + 250, dist: knightDistances(knight) };
	}
	invalidate();

	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(() => { snapPanes(); measure(); relocate(); invalidate(); });
	}
})();
