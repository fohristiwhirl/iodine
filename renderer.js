"use strict";

const app = require("electron").remote.app;
const child_process = require("child_process");
const fs = require("fs");
const ipcRenderer = require("electron").ipcRenderer;
const path = require("path");
const read_prefs = require("./modules/preferences").read_prefs;
const readline = require("readline");

const colours = ["#c5ec98", "#ff9999", "#ffbe00", "#66cccc"];
const explosion_colour = "#ff0000";

const canvas = document.getElementById("canvas");
const infobox = document.getElementById("infobox");
const context = canvas.getContext("2d");

function make_token_parser() {

	let o = Object.create(null);

	let tokens = [];		// Private

	o.receive = (line) => {
		let new_tokens = line.split(" ").map(s => s.trim()).filter(t => t.length > 0);
		tokens = tokens.concat(new_tokens);
	};

	o.count = () => {
		return tokens.length;
	};

	o.token = () => {
		return tokens.shift();
	};

	o.int = () => {
		return parseInt(tokens.shift(), 10);
	};

	o.peek_int = (n) => {
		return parseInt(tokens[n], 10);
	};

	return o;
}

function make_dropoff(pid, x, y, factory_flag) {
	let dropoff = Object.create(null);
	dropoff.pid = pid;
	dropoff.x = x;
	dropoff.y = y;
	dropoff.factory = factory_flag;
	return dropoff;
}

function make_ship(pid, sid, x, y, halite) {
	let ship = Object.create(null);
	ship.pid = pid;
	ship.sid = sid;
	ship.x = x;
	ship.y = y;
	ship.halite = halite;
	return ship;
}

function make_game() {

	let game = Object.create(null);

	game.clean = false;		// Can be rendered?

	game.players = null;
	game.pid = null;
	game.width = null;
	game.height = null;
	game.turn = null;

	game.budgets = Object.create(null);
	game.ships = [];
	game.dropoffs = [];
	game.halite = null;

	game.init_map = () => {
		game.halite = [];
		console.log(`Making map : ${game.width} ${game.height}`);
		for (let x = 0; x < game.width; x++) {
			game.halite.push([]);
			for (let y = 0; y < game.height; y++) {
				game.halite[x].push(0);
			}
		}
	}

	return game;
}

function make_renderer() {

	let renderer = Object.create(null);
	renderer.game = make_game();

	renderer.offset_x = 0;
	renderer.offset_y = 0;

	renderer.prefs = read_prefs(app);

	// --------------------------------------------------------------

	renderer.get_json_line = () => {

		if (tp.count() === 0) {
			setTimeout(renderer.get_json_line, 1);
			return;
		}

		tp.token()

		renderer.pre_parse();
	};

	renderer.pre_parse = () => {

		if (tp.count() < 2) {
			setTimeout(renderer.pre_parse, 1);
			return;
		}

		renderer.game.players = tp.int();
		renderer.game.pid = tp.int();

		renderer.parse_factories();
	};

	renderer.parse_factories = () => {

		let tokens_needed = renderer.game.players * 3;

		if (tp.count() < tokens_needed) {
			setTimeout(renderer.parse_factories, 1);
			return;
		}

		for (let n = 0; n < renderer.game.players; n++) {
			let pid = tp.int();
			let x = tp.int();
			let y = tp.int();
			let factory = make_dropoff(pid, x, y, true);
			renderer.game.dropoffs.push(factory);
		}

		renderer.parse_width_height();
	};

	renderer.parse_width_height = () => {

		if (tp.count() < 2) {
			setTimeout(renderer.parse_width_height, 1);
			return;
		}

		renderer.game.width = tp.int();
		renderer.game.height = tp.int();

		renderer.parse_map();
	};

	renderer.parse_map = () => {

		let tokens_needed = renderer.game.width * renderer.game.height;

		if (tp.count() < tokens_needed) {
			setTimeout(renderer.parse_map, 1);
			return;
		}

		renderer.game.init_map();

		for (let y = 0; y < renderer.game.height; y++) {
			for (let x = 0; x < renderer.game.width; x++) {
				renderer.game.halite[x][y] = tp.int();
			}
		}

		setTimeout(renderer.loop, 0);		// Eh, it's nice to clear the stack.
	};

	// --------------------------------------------------------------

	renderer.loop = () => {

		// bare_min_tokens_needed is the absolute bare minimum number
		// of tokens that might be capable of forming the frame, given
		// what we actually know. It is updated as we gain more info.

		let bare_min_tokens_needed = 1 + (renderer.game.players * 4) + 1;

		if (tp.count() < bare_min_tokens_needed) {
			setTimeout(renderer.loop, 1);
			return;
		}

		// --------------------

		let info_index = 1;

		for (let z = 0; z < renderer.game.players; z++) {

			let pid = tp.peek_int(info_index + 0);
			let ships = tp.peek_int(info_index + 1);
			let dropoffs = tp.peek_int(info_index + 2);

			// Update our bare minimums and check...

			bare_min_tokens_needed += ships * 4;
			bare_min_tokens_needed += dropoffs * 3;

			if (tp.count() < bare_min_tokens_needed) {
				setTimeout(renderer.loop, 1);
				return;
			}

			info_index += 4 + (ships * 4) + (dropoffs * 3);

		}

		let map_updates = tp.peek_int(info_index);

		bare_min_tokens_needed += map_updates * 3;

		if (tp.count() < bare_min_tokens_needed) {
			setTimeout(renderer.loop, 1);
			return;
		}

		// --------------------
		// The tokens exist!

		renderer.game.ships = [];

		// Clear the dropoffs but save the factories...
		renderer.game.dropoffs = renderer.game.dropoffs.slice(0, renderer.game.players);

		renderer.game.turn = tp.int();

		for (let n = 0; n < renderer.game.players; n++) {

			let pid = tp.int();
			let ships = tp.int();
			let dropoffs = tp.int();

			renderer.game.budgets[pid] = tp.int();

			for (let i = 0; i < ships; i++) {

				let sid = tp.int();
				let x = tp.int();
				let y = tp.int();
				let halite = tp.int();

				renderer.game.ships.push(make_ship(pid, sid, x, y, halite));
			}

			for (let i = 0; i < dropoffs; i++) {

				tp.int();			// sid
				let x = tp.int();
				let y = tp.int();

				renderer.game.dropoffs.push(make_dropoff(pid, x, y));
			}
		}

		map_updates = tp.int();

		for (let n = 0; n < map_updates; n++) {

			let x = tp.int();
			let y = tp.int();
			let val = tp.int();

			renderer.game.halite[x][y] = val;
		}

		renderer.game.clean = true;

		renderer.draw()

		setTimeout(renderer.loop, 1);
	};

	// --------------------------------------------------------------

	renderer.go = () => {

		let settings;

		try {
			let f = fs.readFileSync("settings.json");
			settings = JSON.parse(f);
		} catch (err) {
			console.log("Couldn't load settings: ", err.message);
		}

		let engine = settings.engine;
		let bots = settings.bots;
		let seed = settings.seed;
		let size = settings.size;

		let args = ["--viewer"];

		if (seed !== undefined && seed !== null) {
			args.push("-s");
			args.push(seed.toString());
		}

		if (size !== undefined && size !== null) {
			args.push("--width");
			args.push(size.toString());
			args.push("--height");
			args.push(size.toString());
		}

		args = args.concat(bots);

		let exe = child_process.spawn(engine, args);

		let scanner = readline.createInterface({
			input: exe.stdout,
			output: undefined,
			terminal: false			// What is this?
		});

		scanner.on("line", (line) => {
			tp.receive(line.toString());
		});

		setTimeout(renderer.get_json_line, 0);
	}

	// --------------------------------------------------------------

	renderer.right = (n) => {
		renderer.offset_x += n;
		renderer.draw();
	};

	renderer.down = (n) => {
		renderer.offset_y += n;
		renderer.draw();
	};

	renderer.set = (attrname, value) => {
		renderer[attrname] = value;
		renderer.draw();
	};

	// --------------------------------------------------------------

	renderer.offset_adjust = (x, y, undo_flag) => {

		// Given coords x, y, return x, y adjusted by current offset.

		if (!renderer.game) return [x, y];

		if (!undo_flag) {
			x += renderer.offset_x;
			y += renderer.offset_y;
		} else {
			x -= renderer.offset_x;
			y -= renderer.offset_y;
		}

		// Sneaky modulo method which works for negative numbers too...
		// https://dev.to/maurobringolf/a-neat-trick-to-compute-modulo-of-negative-numbers-111e

		x = (x % renderer.game.width + renderer.game.width) % renderer.game.width;
		y = (y % renderer.game.height + renderer.game.height) % renderer.game.height;

		return [x, y];
	};

	// --------------------------------------------------------------

	renderer.clear = () => {

		if (!renderer.game) {
			context.clearRect(0, 0, canvas.width, canvas.height);
			return;
		}

		let desired_size;

		if (!renderer.prefs.integer_box_sizes) {
			desired_size = Math.max(1 * renderer.game.height, window.innerHeight - 1);
		} else {
			desired_size = renderer.game.height * Math.max(1, Math.floor((window.innerHeight - 1) / renderer.game.height));
		}

		if (desired_size !== canvas.width || desired_size !== canvas.height) {
			canvas.width = desired_size;
			canvas.height = desired_size;
		}

		context.clearRect(0, 0, canvas.width, canvas.height);
	};

	renderer.draw = () => {

		renderer.clear();

		if (!renderer.game || !renderer.game.clean) {
			return;
		}

		renderer.draw_grid();
		renderer.draw_structures();
		renderer.draw_ships();

		renderer.write_infobox();
	};

	renderer.draw_grid = () => {

		let box_width = renderer.box_width();
		let box_height = renderer.box_height();

		for (let x = 0; x < renderer.game.width; x++) {

			for (let y = 0; y < renderer.game.height; y++) {

				let val;

				switch (renderer.prefs.grid_aesthetic) {
					case 0:
						val = 0;
						break;
					case 1:
						val = renderer.game.halite[x][y] / 4;
						break;
					case 2:
						val = 255 * Math.sqrt(renderer.game.halite[x][y] / 2048);
						break;
					case 3:
						val = 255 * Math.sqrt(renderer.game.halite[x][y] / 1024);
						break;
				}

				val = Math.floor(val);
				val = Math.min(255, val);

				context.fillStyle = `rgb(${val},${val},${val})`;

				let [i, j] = renderer.offset_adjust(x, y);
				context.fillRect(i * box_width, j * box_height, box_width, box_height);
			}
		}
	};

	renderer.draw_structures = () => {

		let box_width = renderer.box_width();
		let box_height = renderer.box_height();

		for (let dropoff of renderer.game.dropoffs) {

			let x = dropoff.x;
			let y = dropoff.y;
			let pid = dropoff.pid;

			context.fillStyle = colours[pid];
			let [i, j] = renderer.offset_adjust(x, y);
			context.fillRect(i * box_width, j * box_height, box_width, box_height);
		}
	};

	renderer.draw_ships = () => {

		let box_width = renderer.box_width();
		let box_height = renderer.box_height();

		for (let ship of renderer.game.ships) {

			let pid = ship.pid;
			let x = ship.x;
			let y = ship.y;

			let colour = colours[pid];
			let opacity = ship.halite / 1000;

			let [i, j] = renderer.offset_adjust(x, y);

			let a = 0.1;
			let b = 0.5;
			let c = 1 - a;

			context.strokeStyle = colour;
			context.beginPath();
			context.arc((i + b) * box_width, (j + b) * box_height, 0.35 * box_width, 0, 2 * Math.PI, false);
			context.fillStyle = "#000000";
			context.fill();
			context.globalAlpha = opacity;
			context.fillStyle = colour;
			context.fill();
			context.globalAlpha = 1;
			context.stroke();
		}
	};

	renderer.box_width = () => {
		if (renderer.game.width <= 0) return 1;
		return Math.max(1, canvas.width / renderer.game.width);
	};

	renderer.box_height = () => {
		if (renderer.game.height <= 0) return 1;
		return Math.max(1, canvas.height / renderer.game.height);
	};

	// --------------------------------------------------------------

	renderer.write_infobox = () => {
		let lines = [];
		lines.push(`<p>TODO...</p>`);
		infobox.innerHTML = lines.join("");
	};

	return renderer;
}

let tp = make_token_parser();
let renderer = make_renderer();

ipcRenderer.on("right", (event, n) => {
	renderer.right(n);
});

ipcRenderer.on("down", (event, n) => {
	renderer.down(n);
});

ipcRenderer.on("set", (event, foo) => {
	renderer.set(foo[0], foo[1]);               // Format is [attrname, value]
});

ipcRenderer.on("prefs_changed", (event, prefs) => {
	renderer.set("prefs", prefs);
});

ipcRenderer.on("log", (event, msg) => {
	console.log(msg);
});

ipcRenderer.on("receive", (event, msg) => {
	tp.receive(msg);
});

renderer.clear();

// Give the window and canvas a little time to settle... (may prevent sudden jerk during load).

setTimeout(() => {
	ipcRenderer.send("renderer_ready", null);
}, 200);

renderer.go();