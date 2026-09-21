/* The board in 3D: a chessboard at night under a desk lamp, with a carved ivory knight.
   Squares are real tiles, so a landing sends a wave through the board in knight-move rings.
   start() throws when WebGL isn't available, and the page falls back to the 2D board. */
import * as THREE from "three";

// Phones and tablets get a lighter scene: fewer tiles, softer shadows, simpler materials.
const LITE = matchMedia("(max-width: 759px), (pointer: coarse)").matches;
const W = LITE ? 36 : 72, H = 140;  // tiles across and down; more than any screen shows
const OX = 10, OZ = 14;         // columns off the left edge, rows above the top of the page
const JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const HOP_MS = 520;
const DROP_MS = 760;
const RING_S = 0.075;
const RINGS = 7;
const FOV = 32;
const KS = 1.2;          // piece scale: a little over a square tall
const FS = 1.05;         // the other side's pieces
const MOTES = LITE ? 70 : 180;
const NAP_MS = 20000;    // with no input for this long, the scene goes still and stops drawing

const COLORS = {
	dark: 0x243c2d,
	light: 0x30503b,
	night: 0x142219,
	ivory: 0xefe9d4,
	eye: 0x142219,
	ebony: 0x2a302b,
	hi: 0xf0c94a,
	blunder: 0xc0392f,
	lamp: 0xffe2a6
};

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const clamp01 = t => Math.min(1, Math.max(0, t));
const same = (a, b) => a && b && a.i === b.i && a.j === b.j;

function lerpAngle(a, b, t) {
	let d = (b - a) % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return a + d * t;
}

/* ---------- the piece ---------- */

function lathe(points, segments = 48) {
	return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

function knightGeometry() {
	// Staunton base, turned on a lathe: [radius, height].
	const base = lathe([
		[0, 0], [0.37, 0], [0.385, 0.03], [0.37, 0.06], [0.33, 0.08], [0.32, 0.11],
		[0.28, 0.13], [0.23, 0.17], [0.215, 0.2], [0.25, 0.215], [0.25, 0.24], [0.2, 0.26], [0, 0.26]
	]);

	// The head in profile, facing +x: chest, jaw, muzzle, ear, then a scalloped mane down the back.
	const s = new THREE.Shape();
	s.moveTo(-0.21, 0);
	s.lineTo(0.2, 0);
	s.bezierCurveTo(0.25, 0.1, 0.21, 0.2, 0.12, 0.27);
	s.bezierCurveTo(0.2, 0.33, 0.33, 0.36, 0.43, 0.4);
	s.bezierCurveTo(0.51, 0.43, 0.51, 0.53, 0.45, 0.56);
	s.bezierCurveTo(0.37, 0.6, 0.27, 0.66, 0.21, 0.72);
	s.lineTo(0.19, 0.9);
	s.lineTo(0.09, 0.79);
	const mane = [[0.09, 0.79], [0.0, 0.81], [-0.1, 0.76], [-0.18, 0.67], [-0.24, 0.56], [-0.27, 0.44], [-0.28, 0.31]];
	for (let n = 1; n < mane.length; n++) {
		const [px, py] = mane[n - 1], [qx, qy] = mane[n];
		const dx = qx - px, dy = qy - py, len = Math.hypot(dx, dy);
		s.quadraticCurveTo((px + qx) / 2 + (dy / len) * 0.04, (py + qy) / 2 - (dx / len) * 0.04, qx, qy);
	}
	s.bezierCurveTo(-0.29, 0.18, -0.25, 0.08, -0.21, 0);
	// A thin extrusion with a deep bevel, so the head is rounded rather than a slab from the front.
	const depth = 0.1;
	const head = new THREE.ExtrudeGeometry(s, {
		depth,
		curveSegments: 16,
		bevelEnabled: true,
		bevelThickness: 0.11,
		bevelSize: 0.05,
		bevelSegments: 6
	});
	head.translate(0, 0.25, -depth / 2);

	const collar = new THREE.TorusGeometry(0.2, 0.03, 12, 48);
	collar.rotateX(Math.PI / 2);
	collar.translate(0, 0.27, 0);

	return { base, head, collar, eye: new THREE.SphereGeometry(0.042, 14, 10), nostril: new THREE.SphereGeometry(0.018, 10, 6) };
}

// The other side's pieces, in ebony: lathe profiles plus a few carved extras.
function foeGeometry() {
	const pawn = [
		lathe([[0, 0], [0.3, 0], [0.31, 0.04], [0.26, 0.08], [0.2, 0.1], [0.14, 0.14], [0.11, 0.33], [0.18, 0.36], [0.18, 0.39], [0.1, 0.41], [0, 0.41]]),
		new THREE.SphereGeometry(0.14, 24, 16).translate(0, 0.52, 0)
	];
	const rook = [lathe([
		[0, 0], [0.33, 0], [0.34, 0.05], [0.29, 0.09], [0.23, 0.12], [0.19, 0.2], [0.18, 0.5],
		[0.24, 0.54], [0.24, 0.74], [0.17, 0.74], [0.17, 0.68], [0, 0.68]
	])];
	for (let n = 0; n < 4; n++) {
		const a = (n / 4) * Math.PI * 2 + Math.PI / 4;
		rook.push(new THREE.BoxGeometry(0.1, 0.08, 0.1).translate(Math.cos(a) * 0.2, 0.78, Math.sin(a) * 0.2));
	}
	const bishop = [
		lathe([
			[0, 0], [0.31, 0], [0.32, 0.04], [0.27, 0.08], [0.2, 0.11], [0.13, 0.18], [0.09, 0.52],
			[0.17, 0.55], [0.17, 0.58], [0.09, 0.6], [0.14, 0.7], [0.14, 0.8], [0.08, 0.9], [0, 0.93]
		]),
		new THREE.SphereGeometry(0.045, 12, 8).translate(0, 0.96, 0)
	];
	return { pawn, rook, bishop };
}

function gloss(color, roughness, coat) {
	if (LITE) return new THREE.MeshStandardMaterial({ color, roughness: roughness * 0.8 });
	return new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: coat, clearcoatRoughness: 0.2 });
}

function makeKnight(geo, body, detailMat) {
	const outer = new THREE.Group();   // position and heading
	const inner = new THREE.Group();   // tilt, wobble and squash
	outer.add(inner);
	const parts = [new THREE.Mesh(geo.base, body), new THREE.Mesh(geo.head, body), new THREE.Mesh(geo.collar, body)];
	if (detailMat) {
		for (const z of [-1, 1]) {
			const eye = new THREE.Mesh(geo.eye, detailMat);
			eye.position.set(0.26, 0.87, z * 0.15);
			const nostril = new THREE.Mesh(geo.nostril, detailMat);
			nostril.position.set(0.47, 0.73, z * 0.1);
			parts.push(eye, nostril);
		}
	}
	for (const p of parts) {
		p.castShadow = true;
		inner.add(p);
	}
	// An ink outline round the body, so ivory still reads on a lamp-lit square.
	if (detailMat) {
		for (const g of [geo.base, geo.head, geo.collar]) {
			const line = new THREE.Mesh(g, outlineMaterial());
			line.renderOrder = -1;
			inner.add(line);
		}
	}
	inner.scale.setScalar(KS);
	return { outer, inner };
}

// Back faces pushed out along their normals: the classic inverted-hull outline.
let outline = null;
function outlineMaterial() {
	if (outline) return outline;
	outline = new THREE.MeshBasicMaterial({ color: COLORS.night, side: THREE.BackSide });
	outline.onBeforeCompile = shader => {
		shader.vertexShader = shader.vertexShader.replace(
			"#include <begin_vertex>",
			"vec3 transformed = position + normal * 0.022;"
		);
	};
	return outline;
}

// Knights are drawn side-on; after a hop the piece turns its profile to the camera.
const profileOf = yaw => (Math.cos(yaw) >= 0 ? 0 : Math.PI);

// A soft round dot for the dust in the lamp light.
function moteTexture() {
	const c = document.createElement("canvas");
	c.width = c.height = 32;
	const g = c.getContext("2d");
	const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
	r.addColorStop(0, "rgba(255,255,255,1)");
	r.addColorStop(1, "rgba(255,255,255,0)");
	g.fillStyle = r;
	g.fillRect(0, 0, 32, 32);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

// A move's annotation (!!, ?! …) as a little tag that floats over its piece, in the list's colours.
function badgeTexture(text, bg, fg) {
	const c = document.createElement("canvas");
	c.width = 128;
	c.height = 88;
	const g = c.getContext("2d");
	g.fillStyle = bg;
	g.beginPath();
	g.roundRect(4, 4, 120, 80, 14);
	g.fill();
	g.fillStyle = fg;
	g.font = '800 54px "Bricolage Grotesque", system-ui, sans-serif';
	g.textAlign = "center";
	g.textBaseline = "middle";
	g.fillText(text, 64, 47);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

/* ---------- the board ---------- */

export function start() {
	const deck = window.deck;
	const reduce = deck.reduce;
	const canvas = document.getElementById("board");

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE || (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" });
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.15;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(COLORS.night);
	scene.fog = new THREE.Fog(COLORS.night, 20, 60);

	const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);

	scene.add(new THREE.HemisphereLight(0xd8e6d4, 0x0a130d, 1.5));
	const fill = new THREE.DirectionalLight(0xcfe3ff, 0.35);
	fill.position.set(8, 10, 6);
	scene.add(fill);

	// The lamp hangs over the knight and drifts after it.
	const lamp = new THREE.SpotLight(COLORS.lamp, 5, 0, 0.5, 0.85, 0);
	lamp.castShadow = true;
	lamp.shadow.mapSize.setScalar(LITE ? 512 : 1024);
	lamp.shadow.camera.near = 2;
	lamp.shadow.camera.far = 30;
	lamp.shadow.bias = -0.0004;
	lamp.shadow.normalBias = 0.02;
	scene.add(lamp, lamp.target);
	const lampAt = new THREE.Vector3();

	// Tiles sit in a dark tray; the gaps between them read as grooves.
	const tray = new THREE.Mesh(
		new THREE.PlaneGeometry(W + 40, H + 40),
		new THREE.MeshStandardMaterial({ color: COLORS.night, roughness: 1 })
	);
	tray.rotation.x = -Math.PI / 2;
	tray.position.set(W / 2, -0.3, H / 2);
	scene.add(tray);

	const tileGeo = new THREE.BoxGeometry(0.965, 0.3, 0.965);
	tileGeo.translate(0, -0.15, 0);
	const tiles = new THREE.InstancedMesh(
		tileGeo,
		new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.05 }),
		W * H
	);
	tiles.receiveShadow = true;
	const baseColor = [];
	const dark = new THREE.Color(COLORS.dark), light = new THREE.Color(COLORS.light);
	const m4 = new THREE.Matrix4();
	for (let j = 0; j < H; j++) {
		for (let i = 0; i < W; i++) {
			const k = j * W + i;
			// Top-left square of the page is dark, like the CSS board underneath.
			const c = (i - OX + j - OZ) % 2 === 0 ? dark : light;
			baseColor[k] = c;
			tiles.setMatrixAt(k, m4.makeTranslation(i + 0.5, 0, j + 0.5));
			tiles.setColorAt(k, c);
		}
	}
	scene.add(tiles);

	const geo = knightGeometry();
	const ivory = gloss(COLORS.ivory, 0.36, 0.7);
	const piece = makeKnight(geo, ivory, new THREE.MeshStandardMaterial({ color: COLORS.eye, roughness: 0.2 }));
	scene.add(piece.outer);

	const ghostMat = new THREE.MeshBasicMaterial({ color: COLORS.ivory, transparent: true, opacity: 0, depthWrite: false });
	const ghost = makeKnight(geo, ghostMat, null);
	ghost.outer.visible = false;
	for (const m of ghost.inner.children) m.castShadow = false;
	scene.add(ghost.outer);

	const dotGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.02, 32);
	const dotMat = new THREE.MeshBasicMaterial({ color: COLORS.ivory, transparent: true, opacity: 0.4, depthWrite: false });
	const dots = JUMPS.map(() => {
		const d = new THREE.Mesh(dotGeo, dotMat);
		d.visible = false;
		scene.add(d);
		return d;
	});
	const ring = new THREE.Mesh(
		new THREE.RingGeometry(0.33, 0.42, 48),
		new THREE.MeshBasicMaterial({ color: COLORS.ivory, transparent: true, opacity: 0.6, depthWrite: false })
	);
	ring.rotation.x = -Math.PI / 2;
	ring.visible = false;
	scene.add(ring);

	// Capturable squares get a gold ring instead of a dot.
	const takeMat = new THREE.MeshBasicMaterial({ color: COLORS.hi, transparent: true, opacity: 0.85, depthWrite: false });
	const takeGeo = new THREE.RingGeometry(0.4, 0.47, 48).rotateX(-Math.PI / 2);
	const takes = JUMPS.map(() => {
		const r = new THREE.Mesh(takeGeo, takeMat);
		r.visible = false;
		scene.add(r);
		return r;
	});

	const foeGeo = foeGeometry();
	const ebony = gloss(COLORS.ebony, 0.3, 1);

	// Dust hanging in the lamp light, drifting up through the beam.
	const moteGeo = new THREE.BufferGeometry();
	const motePos = new Float32Array(MOTES * 3);
	const moteSeed = [];
	for (let n = 0; n < MOTES; n++) {
		const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 2.8;
		moteSeed.push({ a, r, y: Math.random() * 5, v: 0.05 + Math.random() * 0.12, w: 0.2 + Math.random() * 0.5, ph: Math.random() * 6.3 });
	}
	moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
	const dust = new THREE.Points(moteGeo, new THREE.PointsMaterial({
		color: COLORS.lamp, map: moteTexture(), size: 0.1, transparent: true, opacity: 0.75,
		depthWrite: false, blending: THREE.AdditiveBlending
	}));
	dust.frustumCulled = false;
	scene.add(dust);

	/* ---------- state ---------- */

	let vw = 0, vh = 0, cell = 56, mobile = false;
	let across = 21, dist = 20, pitch = 0.9, zPerPx = 0.02;
	let rects = [];
	let knight = null, yaw = 0;
	let last = null, hop = null, land = null, ripple = null, flash = null, fade = null;
	let hover = null, pointer = null, blunders = 0;
	let intro = 0;
	let foes = [], respawns = [];
	let settledAt = 0, idleNow = 0, turn = null;
	let activeAt = performance.now();
	const aim = { yaw: 0, pitch: 0 }, cam = { yaw: 0, pitch: 0 };
	const target = new THREE.Vector3();

	// The same knight button as in the bio, standing on the board over the piece.
	const moveBtn = document.createElement("button");
	moveBtn.type = "button";
	moveBtn.className = "board-move is-hidden";
	moveBtn.setAttribute("aria-label", "Make a move for me");
	moveBtn.innerHTML = '<span class="board-move__kn" aria-hidden="true">&#9822;&#xFE0E;</span>Your move';
	document.body.append(moveBtn);

	/* ---------- camera and geometry ---------- */

	function layout() {
		vw = innerWidth;
		vh = innerHeight;
		cell = deck.cell;
		mobile = deck.mobile;
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LITE ? 1.5 : 2));
		renderer.setSize(vw, vh, false);
		camera.aspect = vw / vh;
		camera.updateProjectionMatrix();
		across = vw / cell;
		pitch = mobile ? 0.98 : 0.84;
		// Far enough back that the board is `across` squares wide where the camera looks.
		dist = across / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect);
		zPerPx = 1 / (cell * Math.sin(pitch));
		scene.fog.near = dist * 1.05;
		scene.fog.far = dist * 2.1;
		measure();
		placeCamera(0);
	}

	function measure() {
		const sy = scrollY;
		rects = [...document.querySelectorAll(".pane")]
			.filter(p => p.offsetParent !== null)
			.map(p => {
				const b = p.getBoundingClientRect();
				return { x: b.left, y: b.top + sy, r: b.right, b: b.bottom + sy };
			});
	}

	function placeCamera(rise) {
		const p = pitch + cam.pitch + rise;
		const d = dist * (1 + rise * 0.6);
		target.set(OX + across / 2, 0, OZ + (vh / cell) / 2 * Math.sin(pitch) + scrollY * zPerPx);
		camera.position.set(
			target.x + d * Math.cos(p) * Math.sin(cam.yaw),
			d * Math.sin(p),
			target.z + d * Math.cos(p) * Math.cos(cam.yaw)
		);
		camera.lookAt(target);
		camera.updateMatrixWorld();
	}

	const v3 = new THREE.Vector3();
	function toScreen(x, y, z) {
		v3.set(x, y, z).project(camera);
		return { x: (v3.x + 1) / 2 * vw, y: (1 - v3.y) / 2 * vh };
	}

	const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
	const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
	function squareAt(x, y) {
		ndc.set(x / vw * 2 - 1, 1 - y / vh * 2);
		ray.setFromCamera(ndc, camera);
		if (!ray.ray.intersectPlane(ground, hit)) return null;
		return { i: Math.floor(hit.x), j: Math.floor(hit.z) };
	}

	const onBoard = sq => sq.i >= 0 && sq.j >= 0 && sq.i < W && sq.j < H;

	// A square is playable when the knight standing on it would be on screen and not under a pane.
	function free(sq) {
		if (!sq || !onBoard(sq)) return false;
		const p = toScreen(sq.i + 0.5, 0.3, sq.j + 0.5);
		const m = cell * 0.35;
		if (p.x < m || p.x > vw - m || p.y < m || p.y > vh - m) return false;
		// Keep the knight's head on screen too, not just its base.
		if (toScreen(sq.i + 0.5, 1.4, sq.j + 0.5).y < 4) return false;
		const y = p.y + scrollY;
		return !rects.some(r => p.x > r.x - 4 && p.x < r.r + 4 && y > r.y - 4 && y < r.b + 4);
	}

	const targets = from => JUMPS.map(([di, dj]) => ({ i: from.i + di, j: from.j + dj })).filter(free);
	const legal = to => knight && targets(knight).some(t => same(t, to));

	// Open board with room either side, not a one-square gap between two panes.
	const roomy = sq => free(sq) && free({ i: sq.i - 1, j: sq.j }) && free({ i: sq.i + 1, j: sq.j });

	function knightDistances(from) {
		const dist = new Map([[from.i + "," + from.j, 0]]);
		const queue = [from];
		while (queue.length) {
			const q = queue.shift();
			const d = dist.get(q.i + "," + q.j);
			if (d >= RINGS) continue;
			for (const [di, dj] of JUMPS) {
				const n = { i: q.i + di, j: q.j + dj };
				const k = n.i + "," + n.j;
				if (!onBoard(n) || Math.abs(n.i - from.i) > 16 || Math.abs(n.j - from.j) > 16 || dist.has(k)) continue;
				dist.set(k, d + 1);
				queue.push(n);
			}
		}
		return dist;
	}

	function nearestFree(from, elsewhere = false, ok = free) {
		const seen = new Set([from.i + "," + from.j]);
		const queue = [from];
		while (queue.length) {
			const q = queue.shift();
			if (ok(q) && !(elsewhere && same(q, from))) return q;
			for (const [di, dj] of JUMPS) {
				const n = { i: q.i + di, j: q.j + dj };
				const k = n.i + "," + n.j;
				if (!onBoard(n) || seen.has(k)) continue;
				seen.add(k);
				queue.push(n);
			}
		}
		return null;
	}

	function squareName(sq) {
		let n = sq.i - OX, file = "";
		if (n < 0) n += W;
		do { file = String.fromCharCode(97 + (n % 26)) + file; n = Math.floor(n / 26) - 1; } while (n >= 0);
		return file + (sq.j - OZ + 1 > 0 ? sq.j - OZ + 1 : sq.j + 1);
	}

	/* ---------- the other side ---------- */

	// The black pieces are the moves from "The game so far": take one and it tells you its story.
	const KIND = { "!!": "rook", "!": "bishop", "!?": "bishop", "?!": "pawn", "??": "pawn" };
	const moves = [...document.querySelectorAll(".game li")].map((li, n) => {
		const nag = li.querySelector(".nag");
		const title = li.querySelector("h3").cloneNode(true);
		title.querySelector(".nag")?.remove();
		const look = getComputedStyle(nag);
		return {
			n: n + 1,
			li,
			title: title.textContent.trim(),
			nag: nag.textContent.trim(),
			nagClass: nag.className,
			text: li.querySelector("p").textContent.trim(),
			year: li.querySelector("time")?.textContent.trim() || "",
			kind: KIND[nag.textContent.trim()] || "pawn",
			badge: badgeTexture(nag.textContent.trim(), look.backgroundColor, look.color),
			taken: false
		};
	});
	const HEIGHT = { pawn: 0.66, bishop: 0.99, rook: 0.82 };

	const foeAt = sq => foes.find(f => !f.fall && same(f.sq, sq));

	// The next move to put on the board: one not yet taken and not already standing somewhere.
	function nextMove() {
		const open = moves.filter(m => !m.taken && !foes.some(f => f.move === m));
		return open.length ? open[Math.floor(Math.random() * open.length)] : null;
	}

	function spawnFoe(now) {
		const move = nextMove();
		if (!move) return;
		// First choice: one or two knight moves away, so there's always something to take.
		const reach = knight ? [...knightDistances(knight)].filter(([, d]) => d === 1 || d === 2).map(([k]) => {
			const [i, j] = k.split(",").map(Number);
			return { i, j };
		}) : [];
		for (let n = 0; n < 160; n++) {
			// Then squares near the knight, where the lamp can find them, then anywhere on screen.
			const sq = n < 40 && reach.length ? reach[Math.floor(Math.random() * reach.length)] : knight && n < 120
				? { i: knight.i + Math.round((Math.random() - 0.5) * 10), j: knight.j + Math.round((Math.random() - 0.5) * 10) }
				: squareAt(cell + Math.random() * (vw - 2 * cell), cell + Math.random() * (vh - 2 * cell));
			if (!roomy(sq) || foeAt(sq) || (knight && Math.max(Math.abs(sq.i - knight.i), Math.abs(sq.j - knight.j)) < 2)) continue;
			const kind = move.kind;
			const group = new THREE.Group();
			const mat = ebony.clone();
			for (const g of foeGeo[kind]) {
				const m = new THREE.Mesh(g, mat);
				m.castShadow = true;
				group.add(m);
			}
			const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: move.badge, transparent: true, depthWrite: false, toneMapped: false }));
			tag.scale.set(0.42, 0.29, 1);
			tag.position.y = HEIGHT[kind] + 0.3;
			group.add(tag);
			group.scale.setScalar(FS);
			group.rotation.y = Math.random() * Math.PI * 2;
			scene.add(group);
			foes.push({ kind, move, sq, group, mat, tag, t0: now, fall: null });
			return;
		}
	}

	function dropFoe(f) {
		scene.remove(f.group);
		f.mat.dispose();
		f.tag.material.dispose();
		foes = foes.filter(x => x !== f);
	}

	function tidyFoes(now) {
		for (const f of [...foes]) if (!f.fall && !roomy(f.sq)) dropFoe(f);
		const want = mobile ? 2 : 4;
		const pending = respawns.length;
		for (let n = foes.filter(f => !f.fall).length + pending; n < want; n++) spawnFoe(now);
	}

	/* ---------- the capture card ---------- */

	// When a move is taken, its story opens on the board beside the square, on the same paper as the panes.
	const card = document.createElement("aside");
	card.className = "capture";
	card.setAttribute("role", "status");
	card.innerHTML =
		'<button class="capture__close" type="button" aria-label="Close">' +
		'<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg></button>' +
		'<p class="capture__kicker"></p><h3 class="capture__title"></h3><p class="capture__text"></p>' +
		'<ol class="capture__progress" aria-hidden="true"></ol><p class="capture__done"></p>';
	document.body.append(card);
	let cardTimer = 0;

	function hideCapture() {
		card.classList.remove("is-on");
		clearTimeout(cardTimer);
	}
	card.querySelector(".capture__close").addEventListener("click", hideCapture);

	function showCapture(m, sq, wasLegal, done) {
		card.querySelector(".capture__kicker").textContent =
			`Knight takes move ${m.n} of ${moves.length}` + (m.year ? ` · ${m.year}` : "") +
			(wasLegal ? "" : ". Illegal, but a capture is a capture");
		card.classList.toggle("is-blunder", !wasLegal);
		const title = card.querySelector(".capture__title");
		title.textContent = m.title + " ";
		const nag = document.createElement("span");
		nag.className = m.nagClass;
		nag.textContent = m.nag;
		title.append(nag);
		// The list's own sentence, links and all.
		const text = card.querySelector(".capture__text");
		text.replaceChildren(...[...m.li.querySelector("p").childNodes].map(n => n.cloneNode(true)));
		card.querySelector(".capture__progress").replaceChildren(...moves.map(x => {
			const li = document.createElement("li");
			if (x.taken) li.className = "is-taken";
			if (x === m) li.className = "is-taken is-now";
			return li;
		}));
		card.querySelector(".capture__done").textContent = done ? "That's the whole game so far. Thanks for playing." : "";
		card.classList.toggle("is-done", done);

		card.classList.remove("is-on");
		card.style.transform = "";
		void card.offsetWidth;
		if (!mobile) {
			// Beside the square, on whichever side has room and stays clear of the panes.
			const p = toScreen(sq.i + 0.5, 0.5, sq.j + 0.5);
			const w = card.offsetWidth, h = card.offsetHeight, gap = cell * 0.9;
			const y = Math.min(vh - h - 16, Math.max(16, p.y - h / 2));
			const clear = x => x >= 16 && x + w <= vw - 16 &&
				!rects.some(r => x < r.r && x + w > r.x && y + scrollY < r.b && y + h + scrollY > r.y);
			const x = [p.x + gap, p.x - gap - w].find(clear) ?? vw - w - cell * 0.5;
			const yy = clear(x) ? y : vh - h - cell * 0.5;
			card.style.transform = `translate(${Math.round(x)}px, ${Math.round(yy)}px)`;
		}
		card.classList.add("is-on");
		document.getElementById("toast")?.classList.remove("is-on");
		clearTimeout(cardTimer);
		cardTimer = setTimeout(hideCapture, done ? 12000 : 9000);
	}

	/* ---------- moving ---------- */

	function headingTo(from, to) {
		return Math.atan2(-(to.j - from.j), to.i - from.i);
	}

	function move(to, { speak = true } = {}) {
		if (!knight || same(knight, to)) return;
		const wasLegal = legal(to);
		const from = knight;
		hideCapture();
		knight = to;
		last = { from, to };
		const now = performance.now();
		const toYaw = headingTo(from, to);
		const prey = foeAt(to);
		yaw += idleNow;
		idleNow = 0;
		if (prey) {
			const dx = to.i - from.i, dz = to.j - from.j, len = Math.hypot(dx, dz);
			prey.fall = { t0: reduce.matches ? now - 2000 : now + HOP_MS * 0.82, dx: dx / len, dz: dz / len };
			prey.move.taken = true;
			prey.move.li.classList.add("is-taken");
			respawns.push(now + 1600);
		}
		turn = null;
		if (reduce.matches) {
			yaw = profileOf(toYaw);
			if (!wasLegal && speak) flash = { sq: to, t0: now };
		} else {
			hop = { from, to, t0: now, fromYaw: yaw, toYaw, blunder: speak && !wasLegal };
			fade = { t0: now };
			ghost.outer.position.copy(piece.outer.position);
			ghost.outer.rotation.y = yaw;
			ghost.outer.visible = true;
		}
		if (prey) {
			const done = moves.every(x => x.taken);
			const show = () => showCapture(prey.move, to, wasLegal, done);
			if (reduce.matches) show(); else setTimeout(show, HOP_MS * 0.85);
			if (!wasLegal) blunders++;
			// Once every move is taken, the game starts over.
			if (done) {
				setTimeout(() => {
					for (const x of moves) { x.taken = false; x.li.classList.remove("is-taken"); }
					tidyFoes(performance.now());
					kick();
				}, 2400);
			}
		} else if (speak) {
			if (wasLegal) {
				deck.say(`Knight to ${squareName(to)}.`);
			} else {
				blunders++;
				const lines = [
					"Knights move in an L. I know.",
					`That's blunder number ${blunders}. Told you I'm bad at this.`,
					"Illegal, but it's my board, so it stands."
				];
				deck.say(`<b>??</b> Knight to ${squareName(to)}. ${lines[(blunders - 1) % lines.length]}`);
			}
		}
		kick();
	}

	// When the panes change, walk the knight out to open board; a squeezed-in square only if that's all there is.
	function relocate() {
		if (!knight || roomy(knight)) return;
		const open = sq => !foeAt(sq);
		const to = nearestFree(knight, false, sq => roomy(sq) && open(sq)) ||
			(free(knight) ? null : nearestFree(knight, false, sq => free(sq) && open(sq)));
		if (to) move(to, { speak: false });
	}

	/* ---------- frame ---------- */

	let raf = 0, lastT = 0;
	function kick() {
		if (!raf) raf = requestAnimationFrame(frame);
	}

	const mods = new Map();
	let dirty = new Set();
	const tmp = new THREE.Color(), HI = new THREE.Color(COLORS.hi), RED = new THREE.Color(COLORS.blunder);

	function mod(sq) {
		if (!onBoard(sq)) return null;
		const k = sq.j * W + sq.i;
		let m = mods.get(k);
		if (!m) { m = { lift: 0, glow: 0, red: 0, lit: 0 }; mods.set(k, m); }
		return m;
	}

	function liftAt(sq) {
		const m = mods.get(sq.j * W + sq.i);
		return m ? m.lift : 0;
	}

	function frame(now) {
		raf = 0;
		const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
		lastT = now;
		let busy = false;

		// Camera: ease toward the pointer's parallax, and sweep down on arrival.
		const k = 1 - Math.exp(-dt * 5);
		cam.yaw += (aim.yaw - cam.yaw) * k;
		cam.pitch += (aim.pitch - cam.pitch) * k;
		if (Math.abs(aim.yaw - cam.yaw) + Math.abs(aim.pitch - cam.pitch) > 1e-4) busy = true;
		let rise = 0;
		if (intro) {
			const p = clamp01((now - intro) / 1800);
			rise = (1 - easeOut(p)) * 0.45;
			if (p < 1) busy = true; else intro = 0;
		}
		placeCamera(rise);

		mods.clear();

		// The knight in flight.
		let kx = knight.i + 0.5, kz = knight.j + 0.5, ky = 0, tilt = 0;
		if (hop) {
			const drop = !hop.from;
			const p = clamp01((now - hop.t0) / (drop ? DROP_MS : HOP_MS));
			if (drop) {
				ky = 7 * (1 - p * p);
				yaw = hop.toYaw;
			} else {
				const e = ease(p);
				kx = hop.from.i + 0.5 + (hop.to.i - hop.from.i) * e;
				kz = hop.from.j + 0.5 + (hop.to.j - hop.from.j) * e;
				const span = Math.hypot(hop.to.i - hop.from.i, hop.to.j - hop.from.j);
				ky = (0.8 + span * 0.12) * 4 * p * (1 - p);
				yaw = lerpAngle(hop.fromYaw, hop.toYaw, ease(Math.min(1, p / 0.4)));
				tilt = 0.3 * Math.sin(2 * Math.PI * p);
			}
			busy = true;
			if (p >= 1) {
				land = { t0: now, blunder: hop.blunder, hard: drop };
				ripple = { t0: now, dist: knightDistances(hop.to) };
				if (hop.blunder) flash = { sq: hop.to, t0: now };
				if (!drop) turn = { from: yaw, to: profileOf(yaw), t0: now + 120 };
				hop = null;
				settledAt = now;
			}
		}

		if (turn) {
			const p = clamp01((now - turn.t0) / 420);
			yaw = lerpAngle(turn.from, turn.to, ease(p));
			if (p >= 1) turn = null;
			busy = true;
		}

		let squash = 0, wobble = 0;
		if (land) {
			const t = (now - land.t0) / 1000;
			squash = (land.hard ? 0.22 : 0.14) * Math.exp(-t * 9) * Math.cos(t * 26);
			if (land.blunder) wobble = 0.38 * Math.exp(-t * 3.2) * Math.sin(t * 15);
			const m = mod(knight);
			if (m) m.lift -= (land.hard ? 0.12 : 0.07) * Math.exp(-t * 8) * Math.cos(t * 20);
			if (t > 1.6) land = null; else busy = true;
		}

		// The wave: each ring is one more knight move away.
		if (ripple) {
			const t = (now - ripple.t0) / 1000;
			if (t > RINGS * RING_S + 0.5) {
				ripple = null;
			} else {
				busy = true;
				for (const [key, d] of ripple.dist) {
					if (d === 0) continue;
					const fall = 1 - d / (RINGS + 1);
					const a = Math.exp(-(((t - d * RING_S) / 0.1) ** 2)) * fall;
					if (a < 0.01) continue;
					const [i, j] = key.split(",").map(Number);
					const m = mod({ i, j });
					m.lift += a * 0.26;
					m.glow += a * 0.22;
				}
			}
		}

		if (flash) {
			const t = (now - flash.t0) / 1000;
			const m = mod(flash.sq);
			if (m) m.red = Math.max(m.red, 0.85 * Math.exp(-t * 2.4));
			if (t > 1.8) flash = null; else busy = true;
		}

		if (last) {
			for (const sq of [last.from, last.to]) {
				const m = mod(sq);
				if (m) m.glow += 0.18;
			}
		}

		const showTargets = !hop && knight;
		const legalNow = showTargets ? targets(knight) : [];
		if (hover && !same(hover, knight)) {
			const m = mod(hover);
			if (m && !legalNow.some(t => same(t, hover))) { m.lift += 0.05; m.lit += 0.035; }
		}

		// Write only the tiles that changed since last frame.
		for (const k of dirty) {
			if (mods.has(k)) continue;
			const i = k % W, j = (k - i) / W;
			tiles.setMatrixAt(k, m4.makeTranslation(i + 0.5, 0, j + 0.5));
			tiles.setColorAt(k, baseColor[k]);
		}
		for (const [k, m] of mods) {
			const i = k % W, j = (k - i) / W;
			tiles.setMatrixAt(k, m4.makeTranslation(i + 0.5, m.lift, j + 0.5));
			tmp.copy(baseColor[k]).lerp(HI, Math.min(0.85, m.glow)).lerp(RED, m.red);
			if (m.lit) tmp.offsetHSL(0, 0, m.lit);
			tiles.setColorAt(k, tmp);
		}
		if (dirty.size || mods.size) {
			tiles.instanceMatrix.needsUpdate = true;
			tiles.instanceColor.needsUpdate = true;
		}
		dirty = new Set(mods.keys());

		// Place the piece on top of whatever its tile is doing.
		if (!hop) ky += liftAt(knight);
		piece.outer.position.set(kx, ky, kz);
		piece.outer.rotation.y = yaw;
		piece.inner.rotation.set(wobble, 0, tilt);
		piece.inner.scale.set(KS * (1 + squash * 0.5), KS * (1 - squash), KS * (1 + squash * 0.5));

		// Keep the button over the knight's head, and out of the way while it flies or hides under a pane.
		const head = toScreen(kx, ky + 1.9, kz);
		const bw = moveBtn.offsetWidth, bh = moveBtn.offsetHeight;
		const bx = head.x - bw / 2, by = head.y - bh;
		const blocked = hop || bx < 4 || by < 4 || bx + bw > vw - 4 ||
			rects.some(r => bx < r.r && bx + bw > r.x && by + scrollY < r.b && by + bh + scrollY > r.y);
		moveBtn.classList.toggle("is-hidden", !!blocked);
		moveBtn.style.transform = `translate(${Math.round(bx)}px, ${Math.round(by)}px)`;

		// The other side: rising out of their squares, or tumbling off the board when taken.
		while (respawns.length && respawns[0] <= now) {
			respawns.shift();
			spawnFoe(now);
		}
		if (respawns.length) busy = true;
		for (const f of [...foes]) {
			const x = f.sq.i + 0.5, z = f.sq.j + 0.5;
			if (f.fall) {
				const t = (now - f.fall.t0) / 1000;
				if (t < 0) {
					f.group.position.set(x, liftAt(f.sq), z);
				} else if (t > 1.1) {
					dropFoe(f);
					continue;
				} else {
					const d = t * 2.2;
					f.group.position.set(x + f.fall.dx * d, 0.35 + 3.2 * t - 9.8 * t * t, z + f.fall.dz * d);
					f.group.rotation.set(f.fall.dz * t * 7, f.group.rotation.y, -f.fall.dx * t * 7);
					f.mat.transparent = true;
					f.mat.opacity = f.tag.material.opacity = 1 - clamp01((t - 0.5) / 0.6);
				}
				busy = true;
			} else {
				const p = reduce.matches ? 1 : clamp01((now - f.t0) / 700);
				if (p < 1) busy = true;
				f.group.position.set(x, (easeOut(p) - 1) * 1.1 + liftAt(f.sq), z);
			}
		}

		// Fades the ambient motion out over the last two seconds before the scene naps.
		const awake = reduce.matches ? 0 : clamp01((NAP_MS - (now - activeAt)) / 2000);

		// The knight fidgets once it's been still for a while, looking around the board.
		if (!hop && !reduce.matches) {
			const s = now / 1000, amt = clamp01((now - settledAt - 1800) / 2500) * awake;
			idleNow = amt * (0.22 * Math.sin(s * 0.55) + 0.07 * Math.sin(s * 1.7));
			piece.outer.rotation.y = yaw + idleNow;
			piece.inner.scale.y *= 1 + 0.012 * Math.sin(s * 2.2);
		}

		if (awake > 0) {
			const s = now / 1000;
			moteSeed.forEach((m, n) => {
				m.y = (m.y + m.v * dt) % 5;
				const a = m.a + Math.sin(s * m.w + m.ph) * 0.3;
				motePos[n * 3] = lampAt.x + Math.cos(a) * m.r;
				motePos[n * 3 + 1] = 0.15 + m.y;
				motePos[n * 3 + 2] = lampAt.z + Math.sin(a) * m.r;
			});
			moteGeo.attributes.position.needsUpdate = true;
		}
		dust.visible = awake > 0;
		dust.material.opacity = 0.75 * awake;

		if (fade) {
			const t = (now - fade.t0) / 700;
			ghostMat.opacity = 0.35 * (1 - clamp01(t));
			if (t >= 1) { fade = null; ghost.outer.visible = false; } else busy = true;
		}

		dots.forEach(d => (d.visible = false));
		takes.forEach(d => (d.visible = false));
		ring.visible = false;
		legalNow.forEach((t, n) => {
			const y = liftAt(t) + 0.012;
			if (foeAt(t)) {
				takes[n].position.set(t.i + 0.5, y, t.j + 0.5);
				takes[n].visible = true;
			} else if (same(t, hover)) {
				ring.position.set(t.i + 0.5, y, t.j + 0.5);
				ring.visible = true;
			} else {
				dots[n].position.set(t.i + 0.5, y, t.j + 0.5);
				dots[n].visible = true;
			}
		});

		// The lamp drifts after the knight, a beat behind.
		const lk = reduce.matches ? 1 : 1 - Math.exp(-dt * 2.6);
		const dx = kx - lampAt.x, dz = kz - lampAt.z;
		lampAt.x += dx * lk;
		lampAt.z += dz * lk;
		if (Math.abs(dx) + Math.abs(dz) > 0.002) busy = true;
		lamp.position.set(lampAt.x - 2.5, 9, lampAt.z - 1.5);
		lamp.target.position.set(lampAt.x, 0, lampAt.z);

		renderer.render(scene, camera);
		// The dust keeps the scene drawing until it naps; any input wakes it.
		if (busy || awake > 0) kick(); else lastT = 0;
	}

	/* ---------- events ---------- */

	function poke() {
		activeAt = performance.now();
		kick();
	}

	for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
		addEventListener(type, poke, { passive: true });
	}

	document.addEventListener("pointerdown", e => {
		if (e.button !== 0 || e.target.closest("a, button, .pane, .toast, .capture")) return;
		const sq = foeUnder(e.clientX, e.clientY) || squareAt(e.clientX, e.clientY);
		if (!free(sq)) return;
		move(sq);
	});

	// A click on a piece's body means its square, not the square behind it.
	function foeUnder(x, y) {
		const live = foes.filter(f => !f.fall);
		if (!live.length) return null;
		ndc.set(x / vw * 2 - 1, 1 - y / vh * 2);
		ray.setFromCamera(ndc, camera);
		const hitFoe = ray.intersectObjects(live.map(f => f.group), true)[0];
		return hitFoe ? live.find(f => f.group === hitFoe.object.parent).sq : null;
	}

	function updateHover() {
		let next = null;
		if (pointer) {
			const sq = foeUnder(pointer.x, pointer.y) || squareAt(pointer.x, pointer.y);
			if (free(sq)) next = sq;
		}
		if (!same(next, hover)) {
			hover = next;
			document.body.style.cursor = hover ? "pointer" : "";
			kick();
		}
	}

	document.addEventListener("pointermove", e => {
		if (e.pointerType !== "mouse") return;
		if (!reduce.matches) {
			aim.yaw = -(e.clientX / vw - 0.5) * 0.09;
			aim.pitch = (e.clientY / vh - 0.5) * 0.06;
			kick();
		}
		pointer = e.target.closest(".pane, .toast, .capture") ? null : { x: e.clientX, y: e.clientY };
		updateHover();
	});

	document.addEventListener("pointerleave", () => {
		pointer = null;
		aim.yaw = aim.pitch = 0;
		updateHover();
		kick();
	});

	addEventListener("scroll", () => { placeCamera(0); updateHover(); poke(); }, { passive: true });

	addEventListener("deck:change", () => { layout(); relocate(); tidyFoes(performance.now()); kick(); });

	// A move for the visitor: a capture if one's in reach, otherwise any legal square.
	function autoMove() {
		if (!knight || hop) return;
		const options = targets(knight);
		const prey = options.filter(foeAt);
		const pool = prey.length ? prey : options;
		// Boxed in with no legal move: hop to the nearest open square instead.
		const to = pool.length ? pool[Math.floor(Math.random() * pool.length)] : nearestFree(knight, true);
		if (to) move(to);
	}

	for (const btn of document.querySelectorAll("[data-knight-move]")) btn.addEventListener("click", autoMove);
	moveBtn.addEventListener("click", autoMove);

	/* ---------- start ---------- */

	layout();
	const home = squareAt(mobile ? 5.5 * cell : Math.min(across - 2, 13.5) * cell, mobile ? 2.5 * cell : vh * 0.45);
	knight = (home && nearestFree(home)) || nearestFree({ i: OX + 4, j: OZ + 4 });
	if (!knight) throw new Error("No free square for the knight");
	yaw = Math.PI;  // facing left, towards the name
	lampAt.set(knight.i + 0.5, 0, knight.j + 0.5);
	if (!reduce.matches) {
		intro = performance.now();
		hop = { from: null, to: knight, t0: intro + 350, fromYaw: yaw, toYaw: yaw, blunder: false };
	}
	// The other side arrives once the knight has landed.
	const t0 = performance.now() + (reduce.matches ? 0 : 1300);
	for (let n = 0; n < (mobile ? 2 : 4); n++) respawns.push(t0 + n * 220);
	document.documentElement.classList.add("three");
	kick();
}
