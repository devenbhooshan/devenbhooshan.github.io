/* The deck: pane sizing, drawer routing and the toast. Whichever board draws
   behind it (2D canvas or 3D) listens for "deck:change" and reads window.deck. */
(() => {
	"use strict";

	const root = document.documentElement;
	const toastEl = document.getElementById("toast");
	const drawers = [...document.querySelectorAll(".pane--drawer")];
	const navLinks = [...document.querySelectorAll('.moves-nav a[href^="#"]')];
	const reduce = matchMedia("(prefers-reduced-motion: reduce)");

	const deck = { cell: 56, mobile: false, reduce, say };
	let toastTimer = 0;

	function size() {
		const vw = innerWidth;
		deck.mobile = vw < 760;
		deck.cell = deck.mobile ? vw / 8 : Math.max(44, Math.min(64, Math.floor(vw / 21)));
		root.style.setProperty("--cell", deck.cell + "px");
		snapPanes();
	}

	// Round every pane up to a whole number of squares so the next one lands on the grid.
	function snapPanes() {
		for (const pane of document.querySelectorAll(".pane")) {
			const inner = pane.firstElementChild;
			if (!inner) continue;
			pane.style.minHeight = Math.ceil(inner.offsetHeight / deck.cell) * deck.cell + "px";
		}
	}

	const changed = () => dispatchEvent(new Event("deck:change"));

	function say(html, ms = 3200) {
		if (!toastEl) return;
		toastEl.innerHTML = html;
		toastEl.classList.add("is-on");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), ms);
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
			if (deck.mobile) target.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
			heading.focus({ preventScroll: true });
		}
		snapPanes();
		changed();
	}

	function go(hash) {
		history.pushState(null, "", hash || location.pathname + location.search);
		route();
	}

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

	let resizeTimer = 0;
	addEventListener("resize", () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => { size(); changed(); }, 60);
	});

	if ("ResizeObserver" in window) {
		const ro = new ResizeObserver(() => { snapPanes(); changed(); });
		for (const p of document.querySelectorAll(".pane__in")) ro.observe(p);
	}

	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(() => { snapPanes(); changed(); });
	}

	window.deck = deck;
	size();
	route({ initial: true });
})();
