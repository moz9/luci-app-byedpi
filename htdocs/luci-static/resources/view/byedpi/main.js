"use strict";
"require view";
"require fs";
"require poll";
"require ui";

const HELPER = "/usr/libexec/byedpi-luci";
const STATUS_NODE_ID = "byedpi-status";
const DIAGNOSTICS_NODE_ID = "byedpi-diagnostics";
const RESULTS_NODE_ID = "byedpi-test-results";
const LOG_NODE_ID = "byedpi-test-log";
const TEST_PROGRESS_NODE_ID = "byedpi-test-progress";

let strategies = [];
let activeTab = "settings";
let testing = false;
let stopRequested = false;
let lastProgressKey = "";

function injectStyles() {
	if (document.getElementById("byedpi-luci-style"))
		return;

	document.head.appendChild(E("style", { id: "byedpi-luci-style" }, `
		.byedpi-page {
			display: grid;
			gap: 14px;
		}

		.byedpi-tabs {
			display: flex;
			gap: 8px;
			flex-wrap: wrap;
			border-bottom: 1px solid var(--border-color-low, #ddd);
			padding-bottom: 8px;
		}

		.byedpi-tabs button {
			min-width: 120px;
		}

		.byedpi-tabs button.active {
			font-weight: 700;
		}

		.byedpi-tab {
			display: none;
		}

		.byedpi-tab.active {
			display: grid;
			gap: 14px;
		}

		.byedpi-grid {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(280px, 0.45fr);
			gap: 14px;
			align-items: start;
		}

		@media (max-width: 900px) {
			.byedpi-grid {
				grid-template-columns: 1fr;
			}
		}

		.byedpi-panel {
			border: 1px solid var(--border-color-low, #d8d8d8);
			border-radius: 4px;
			padding: 12px;
			display: grid;
			gap: 10px;
		}

		.byedpi-panel h3 {
			margin: 0;
		}

		.byedpi-row {
			display: grid;
			gap: 6px;
		}

		.byedpi-inline {
			display: flex;
			gap: 8px;
			align-items: center;
			flex-wrap: wrap;
		}

		.byedpi-inline input[type="number"] {
			width: 90px;
		}

		.byedpi-status-line {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
		}

		.byedpi-badge {
			display: inline-block;
			padding: 2px 8px;
			border-radius: 4px;
			border: 1px solid var(--border-color-medium, #8a8a8a);
			font-weight: 600;
		}

		.byedpi-badge.ok {
			color: var(--success-color-medium, #2e7d32);
			border-color: var(--success-color-medium, #2e7d32);
		}

		.byedpi-badge.bad {
			color: var(--error-color-medium, #b3261e);
			border-color: var(--error-color-medium, #b3261e);
		}

		.byedpi-badge.warn {
			color: var(--warn-color-medium, #b26a00);
			border-color: var(--warn-color-medium, #b26a00);
		}

		.byedpi-command,
		.byedpi-log {
			margin: 0;
			white-space: pre-wrap;
			word-break: break-word;
			font-size: 12px;
		}

		.byedpi-log {
			min-height: 140px;
			max-height: 340px;
			overflow: auto;
			border: 1px solid var(--border-color-low, #ddd);
			border-radius: 4px;
			padding: 8px;
			background: var(--background-color-high, #fff);
		}

		.byedpi-table {
			width: 100%;
			border-collapse: collapse;
		}

		.byedpi-table th,
		.byedpi-table td {
			border-bottom: 1px solid var(--border-color-low, #ddd);
			padding: 7px 6px;
			vertical-align: top;
		}

		.byedpi-table th {
			text-align: left;
		}

		.byedpi-table td.actions {
			white-space: nowrap;
			width: 1%;
		}

		.byedpi-muted {
			color: var(--text-color-medium, #666);
		}

		.byedpi-progress {
			display: grid;
			gap: 4px;
			padding: 8px 10px;
			border: 1px solid var(--border-color-low, #ddd);
			border-radius: 4px;
		}
	`));
}

function withTimeout(promise, timeoutMs, label) {
	let timeoutId;
	const timeout = new Promise(function(_resolve, reject) {
		timeoutId = window.setTimeout(function() {
			reject(new Error(label || _("Операция заняла слишком много времени")));
		}, timeoutMs);
	});

	return Promise.race([ promise, timeout ]).finally(function() {
		window.clearTimeout(timeoutId);
	});
}

function execJson(args, timeoutMs) {
	return withTimeout(fs.exec(HELPER, args), timeoutMs || 15000).then(function(res) {
		if (res.code !== 0)
			throw new Error(res.stderr || res.stdout || _("Команда завершилась с ошибкой"));

		try {
			return JSON.parse(res.stdout || "{}");
		}
		catch (err) {
			throw new Error(_("Не удалось разобрать ответ helper-скрипта"));
		}
	});
}

function notify(message, level) {
	ui.addNotification(null, E("p", {}, message), level || "info");
}

function normalizeStrategy(value) {
	return (value || "").trim().replace(/\s+/g, " ");
}

function scorePercent(score) {
	const parts = String(score || "").split("/");
	const success = parseInt(parts[0], 10);
	const total = parseInt(parts[1], 10);
	return total > 0 ? success / total : -1;
}

function sortedStrategies() {
	return strategies.slice().sort(function(a, b) {
		const delta = scorePercent(b.score) - scorePercent(a.score);
		return delta !== 0 ? delta : a.id - b.id;
	});
}

function getStrategyTextarea() {
	return document.getElementById("byedpi-strategy");
}

function getEnabledInput() {
	return document.getElementById("byedpi-enabled");
}

function getPresetSelect(id) {
	return document.getElementById(id || "byedpi-preset");
}

function optionLabel(item) {
	const score = item.score ? item.score + " · " : "";
	return "#" + item.id + " · " + score + item.value;
}

function renderStrategyOptions(selectedValue) {
	return sortedStrategies().map(function(item) {
		return E("option", {
			value: item.value,
			selected: item.value === selectedValue ? "selected" : null
		}, optionLabel(item));
	});
}

function setActiveTab(name) {
	activeTab = name;

	document.querySelectorAll(".byedpi-tabs button").forEach(function(button) {
		button.classList.toggle("active", button.dataset.tab === name);
	});

	document.querySelectorAll(".byedpi-tab").forEach(function(tab) {
		tab.classList.toggle("active", tab.dataset.tab === name);
	});
}

function renderStatus(data) {
	const node = document.getElementById(STATUS_NODE_ID);

	if (!node)
		return;

	const running = !!data.running;
	const command = Array.isArray(data.command) ? data.command.join(" ") : "";

	node.replaceChildren(E("div", { class: "byedpi-panel" }, [
		E("div", { class: "byedpi-status-line" }, [
			E("span", { class: "byedpi-badge " + (running ? "ok" : "bad") }, running ? _("Запущен") : _("Остановлен")),
			data.pid ? E("span", {}, "PID: " + data.pid) : "",
			data.enabled ? E("span", { class: "byedpi-badge ok" }, _("Автозапуск включен")) : E("span", { class: "byedpi-badge warn" }, _("Автозапуск выключен"))
		]),
		E("pre", { class: "byedpi-command" }, command || _("Команда запуска недоступна"))
	]));
}

function updateStatus() {
	return execJson([ "status" ], 10000).then(function(data) {
		renderStatus(data);

		const strategy = getStrategyTextarea();
		const enabled = getEnabledInput();

		if (strategy && document.activeElement !== strategy)
			strategy.value = data.current_strategy || "";

		if (enabled)
			enabled.checked = !!data.enabled;
	}).catch(function(err) {
		const node = document.getElementById(STATUS_NODE_ID);
		if (node)
			node.replaceChildren(E("div", { class: "alert-message warning" }, err.message || err));
	});
}

function renderDiagnostics(data) {
	const node = document.getElementById(DIAGNOSTICS_NODE_ID);

	if (!node)
		return;

	const checks = Array.isArray(data.checks) ? data.checks : [];

	node.replaceChildren(E("div", { class: "byedpi-panel" }, [
		E("h3", {}, _("Диагностика")),
		E("table", { class: "byedpi-table" }, [
			E("thead", {}, E("tr", {}, [
				E("th", {}, _("Проверка")),
				E("th", {}, _("Статус")),
				E("th", {}, _("Детали"))
			])),
			E("tbody", {}, checks.map(function(check) {
				return E("tr", {}, [
					E("td", {}, check.name || ""),
					E("td", {}, E("span", { class: "byedpi-badge " + (check.ok ? "ok" : "bad") }, check.ok ? "OK" : _("Ошибка"))),
					E("td", {}, check.detail || "")
				]);
			}))
		])
	]));
}

function refreshDiagnostics() {
	const node = document.getElementById(DIAGNOSTICS_NODE_ID);
	if (node)
		node.replaceChildren(E("div", { class: "byedpi-muted" }, _("Проверяю...")));

	return execJson([ "diagnostics" ], 20000).then(renderDiagnostics).catch(function(err) {
		if (node)
			node.replaceChildren(E("div", { class: "alert-message warning" }, err.message || err));
	});
}

function logLine(text) {
	const node = document.getElementById(LOG_NODE_ID);

	if (!node)
		return;

	node.textContent += text + "\n";
	node.scrollTop = node.scrollHeight;
}

function clearLog() {
	const node = document.getElementById(LOG_NODE_ID);
	if (node)
		node.textContent = "";
}

function delay(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, ms);
	});
}

function renderTestProgress(status) {
	const node = document.getElementById(TEST_PROGRESS_NODE_ID);
	if (!node)
		return;

	if (!status || !status.active) {
		node.replaceChildren(E("span", { class: "byedpi-muted" }, _("Тест не запущен")));
		return;
	}

	const tested = parseInt(status.tested, 10) || 0;
	const totalDomains = parseInt(status.total_domains, 10) || 0;
	const result = status.result || "0/0";
	const current = status.current_domain || "";
	const finished = !!status.finished;
	const stopped = !!status.stopped;

	let stateText = _("Идет тест");
	let badgeClass = "warn";
	if (finished && stopped) {
		stateText = _("Остановлено");
		badgeClass = "bad";
	}
	else if (finished) {
		stateText = _("Готово");
		badgeClass = "ok";
	}

	node.replaceChildren(E("div", { class: "byedpi-progress" }, [
		E("div", { class: "byedpi-status-line" }, [
			E("span", { class: "byedpi-badge " + badgeClass }, stateText),
			E("span", {}, _("Домены: ") + tested + "/" + totalDomains),
			E("span", {}, _("Итог: ") + result)
		]),
		current ? E("span", { class: "byedpi-muted" }, _("Сейчас: ") + current) : "",
		status.message ? E("span", { class: "byedpi-muted" }, status.message) : ""
	]));
}

function logProgress(status) {
	const key = [
		status && status.tested,
		status && status.total_domains,
		status && status.result,
		status && status.current_domain,
		status && status.finished,
		status && status.stopped
	].join("|");

	if (key === lastProgressKey)
		return;

	lastProgressKey = key;

	if (!status || !status.active)
		return;

	if (status.finished)
		return;

	logLine(_("Прогресс: ") + (status.tested || 0) + "/" + (status.total_domains || 0) + " · " + (status.result || "0/0") + (status.current_domain ? " · " + status.current_domain : ""));
}

function appendResult(result) {
	const table = document.getElementById(RESULTS_NODE_ID);
	if (!table)
		return;

	const tbody = table.querySelector("tbody");
	const row = E("tr", {}, [
		E("td", {}, result.strategy || ""),
		E("td", {}, result.result || ""),
		E("td", {}, (result.domains || []).map(function(item) {
			return E("div", {}, [
				E("span", { class: "byedpi-badge " + (item.success > 0 ? "ok" : "bad") }, item.success + "/" + item.total),
				" ",
				item.domain
			]);
		})),
		E("td", { class: "actions" }, [
			E("button", {
				class: "btn cbi-button cbi-button-apply",
				click: function() {
					const strategy = getStrategyTextarea();
					if (strategy)
						strategy.value = result.strategy || "";
					setActiveTab("settings");
				}
			}, _("Вставить"))
		])
	]);

	tbody.appendChild(row);
}

function selectedStrategy(selectId) {
	const select = getPresetSelect(selectId);
	return normalizeStrategy(select ? select.value : "");
}

function currentStrategy() {
	const textarea = getStrategyTextarea();
	return normalizeStrategy(textarea ? textarea.value : "");
}

function setButtonDisabled(id, disabled) {
	const button = document.getElementById(id);
	if (button)
		button.disabled = !!disabled;
}

function setControlDisabled(id, disabled) {
	const control = document.getElementById(id);
	if (control)
		control.disabled = !!disabled;
}

function setTestingState(isTesting) {
	testing = !!isTesting;

	[
		"byedpi-test-selected",
		"byedpi-test-current",
		"byedpi-test-top",
		"byedpi-test-all",
		"byedpi-clear-results"
	].forEach(function(id) {
		setButtonDisabled(id, testing);
	});

	[
		"byedpi-test-preset",
		"byedpi-test-limit",
		"byedpi-test-requests"
	].forEach(function(id) {
		setControlDisabled(id, testing);
	});

	setButtonDisabled("byedpi-test-stop", !testing || stopRequested);
}

async function waitForStrategyTest() {
	while (testing) {
		const status = await execJson([ "test-status" ], 10000);
		renderTestProgress(status);
		logProgress(status);

		if (status.finished)
			return status;

		await delay(1500);
	}

	return execJson([ "test-status" ], 10000);
}

function runStrategyTest(strategy) {
	const limitInput = document.getElementById("byedpi-test-limit");
	const requestsInput = document.getElementById("byedpi-test-requests");
	const limit = limitInput ? limitInput.value : "8";
	const requests = requestsInput ? requestsInput.value : "1";

	if (!strategy) {
		notify(_("Стратегия пустая"), "warning");
		return Promise.resolve();
	}

	logLine(_("Тестирую: ") + strategy);
	lastProgressKey = "";

	return execJson([ "start-test", strategy, limit, requests ], 10000).then(function(status) {
		renderTestProgress(status);
		return waitForStrategyTest();
	}).then(function(result) {
		appendResult(result);
		if (result.stopped)
			logLine(_("Остановлено: ") + (result.result || "0/0") + " · " + strategy);
		else
			logLine((result.result || "0/0") + " · " + strategy);

		return !result.stopped;
	}).catch(function(err) {
		if (stopRequested) {
			logLine(_("Остановлено"));
			return false;
		}

		const message = err.message || err;
		logLine(_("Ошибка: ") + message);
		notify(message, "error");
		return false;
	}).finally(function() {
		updateStatus();
	});
}

async function runStrategyQueue(items) {
	if (testing)
		return;

	const queue = items.map(function(item) {
		return normalizeStrategy(item && item.value ? item.value : item);
	}).filter(function(item) {
		return !!item;
	});

	if (!queue.length) {
		notify(_("Нет стратегий для теста"), "warning");
		return;
	}

	clearLog();
	renderTestProgress(null);
	stopRequested = false;
	setTestingState(true);

	try {
		for (let i = 0; i < queue.length; i++) {
			if (stopRequested)
				break;

			const keepGoing = await runStrategyTest(queue[i]);
			if (!keepGoing)
				break;
		}

		if (stopRequested)
			logLine(_("Тесты остановлены"));
	}
	finally {
		stopRequested = false;
		setTestingState(false);
		updateStatus();
	}
}

function stopTests() {
	if (!testing || stopRequested)
		return Promise.resolve();

	stopRequested = true;
	setTestingState(true);
	logLine(_("Останавливаю тесты..."));

	return execJson([ "stop-test" ], 10000).then(renderTestProgress).catch(function(err) {
		const message = err.message || err;
		logLine(_("Ошибка остановки: ") + message);
		notify(message, "error");
		stopRequested = false;
		setTestingState(true);
	}).finally(updateStatus);
}

function saveAndRestart(strategy, enabled) {
	strategy = normalizeStrategy(strategy);

	if (!strategy) {
		notify(_("Стратегия пустая"), "warning");
		return Promise.resolve();
	}

	return execJson([ "apply", strategy, enabled ? "1" : "0" ], 30000).then(function(data) {
		notify(_("Настройки сохранены"), "info");
		renderStatus(data);
	}).catch(function(err) {
		notify(err.message || err, "error");
	});
}

function serviceAction(action) {
	return execJson([ "service", action ], 30000).then(function(data) {
		renderStatus(data);
	}).catch(function(err) {
		notify(err.message || err, "error");
	});
}

function bindHandlers() {
	document.querySelectorAll(".byedpi-tabs button").forEach(function(button) {
		button.addEventListener("click", function() {
			setActiveTab(button.dataset.tab);
		});
	});

	const preset = getPresetSelect("byedpi-preset");
	if (preset)
		preset.addEventListener("change", function() {
			const textarea = getStrategyTextarea();
			if (textarea)
				textarea.value = preset.value;
		});

	const testPreset = getPresetSelect("byedpi-test-preset");
	if (testPreset)
		testPreset.addEventListener("change", function() {
			logLine(_("Выбрана стратегия: ") + testPreset.value);
		});

	const saveButton = document.getElementById("byedpi-save-restart");
	if (saveButton)
		saveButton.addEventListener("click", function() {
			saveAndRestart(currentStrategy(), getEnabledInput() ? getEnabledInput().checked : true);
		});

	const refreshDiagnosticsButton = document.getElementById("byedpi-refresh-diagnostics");
	if (refreshDiagnosticsButton)
		refreshDiagnosticsButton.addEventListener("click", refreshDiagnostics);

	const testSelectedButton = document.getElementById("byedpi-test-selected");
	if (testSelectedButton)
		testSelectedButton.addEventListener("click", function() {
			runStrategyQueue([ selectedStrategy("byedpi-test-preset") ]);
		});

	const testCurrentButton = document.getElementById("byedpi-test-current");
	if (testCurrentButton)
		testCurrentButton.addEventListener("click", function() {
			runStrategyQueue([ currentStrategy() ]);
		});

	const testTopButton = document.getElementById("byedpi-test-top");
	if (testTopButton)
		testTopButton.addEventListener("click", function() {
			runStrategyQueue(sortedStrategies().slice(0, 10));
		});

	const testAllButton = document.getElementById("byedpi-test-all");
	if (testAllButton)
		testAllButton.addEventListener("click", function() {
			runStrategyQueue(sortedStrategies());
		});

	const testStopButton = document.getElementById("byedpi-test-stop");
	if (testStopButton)
		testStopButton.addEventListener("click", stopTests);

	const clearResultsButton = document.getElementById("byedpi-clear-results");
	if (clearResultsButton)
		clearResultsButton.addEventListener("click", function() {
			const tbody = document.querySelector("#" + RESULTS_NODE_ID + " tbody");
			if (tbody)
				tbody.replaceChildren();
			clearLog();
		});

	[ "start", "restart", "stop" ].forEach(function(action) {
		const button = document.getElementById("byedpi-service-" + action);
		if (button)
			button.addEventListener("click", function() {
				serviceAction(action);
			});
	});

	setTestingState(false);
}

function renderSettings(status) {
	const current = status.current_strategy || "";

	return E("div", { class: "byedpi-tab active", "data-tab": "settings" }, [
		E("div", { class: "byedpi-grid" }, [
			E("div", { class: "byedpi-panel" }, [
				E("h3", {}, _("Стратегия")),
				E("label", { class: "byedpi-inline" }, [
					E("input", { id: "byedpi-enabled", type: "checkbox", checked: status.enabled ? "checked" : null }),
					_("Включить ByeDPI")
				]),
				E("div", { class: "byedpi-row" }, [
					E("label", { for: "byedpi-preset" }, _("Готовая стратегия")),
					E("select", { id: "byedpi-preset" }, renderStrategyOptions(current))
				]),
				E("div", { class: "byedpi-row" }, [
					E("label", { for: "byedpi-strategy" }, _("Аргументы ciadpi")),
					E("textarea", {
						id: "byedpi-strategy",
						rows: "5",
						spellcheck: "false"
					}, current),
					E("span", { class: "byedpi-muted" }, _("Сохраняется в byedpi.main.cmd_opts."))
				]),
				E("div", { class: "byedpi-inline" }, [
					E("button", { id: "byedpi-save-restart", class: "btn cbi-button cbi-button-apply" }, _("Сохранить и перезапустить")),
					E("button", { id: "byedpi-service-start", class: "btn cbi-button cbi-button-apply" }, _("Запустить")),
					E("button", { id: "byedpi-service-restart", class: "btn cbi-button cbi-button-reload" }, _("Перезапустить")),
					E("button", { id: "byedpi-service-stop", class: "btn cbi-button cbi-button-remove" }, _("Остановить"))
				])
			]),
			E("div", { id: STATUS_NODE_ID }, E("div", { class: "byedpi-muted" }, _("Загрузка...")))
		])
	]);
}

function renderDiagnosticsTab() {
	return E("div", { class: "byedpi-tab", "data-tab": "diagnostics" }, [
		E("div", { class: "byedpi-inline" }, [
			E("button", { id: "byedpi-refresh-diagnostics", class: "btn cbi-button cbi-button-reload" }, _("Обновить диагностику"))
		]),
		E("div", { id: DIAGNOSTICS_NODE_ID }, E("div", { class: "byedpi-muted" }, _("Загрузка...")))
	]);
}

function renderTesterTab(status) {
	const current = status.current_strategy || "";

	return E("div", { class: "byedpi-tab", "data-tab": "tester" }, [
		E("div", { class: "byedpi-panel" }, [
			E("h3", {}, _("Тестер стратегий")),
			E("div", { class: "byedpi-row" }, [
				E("label", { for: "byedpi-test-preset" }, _("Стратегия для теста")),
				E("select", { id: "byedpi-test-preset" }, renderStrategyOptions(current))
			]),
			E("div", { class: "byedpi-inline" }, [
				E("label", {}, [
					_("Доменов: "),
					E("input", { id: "byedpi-test-limit", type: "number", min: "1", max: "32", value: "8" })
				]),
				E("label", {}, [
					_("Запросов на домен: "),
					E("input", { id: "byedpi-test-requests", type: "number", min: "1", max: "5", value: "1" })
				])
			]),
			E("div", { class: "byedpi-inline" }, [
				E("button", { id: "byedpi-test-selected", class: "btn cbi-button cbi-button-apply" }, _("Тестировать выбранную")),
				E("button", { id: "byedpi-test-current", class: "btn cbi-button cbi-button-reload" }, _("Тестировать текущую")),
				E("button", { id: "byedpi-test-top", class: "btn cbi-button" }, _("Тестировать топ-10")),
				E("button", { id: "byedpi-test-all", class: "btn cbi-button" }, _("Тестировать все")),
				E("button", { id: "byedpi-test-stop", class: "btn cbi-button cbi-button-remove", disabled: "disabled" }, _("Стоп")),
				E("button", { id: "byedpi-clear-results", class: "btn cbi-button" }, _("Очистить"))
			]),
			E("div", { id: TEST_PROGRESS_NODE_ID }, E("span", { class: "byedpi-muted" }, _("Тест не запущен"))),
			E("p", { class: "byedpi-muted" }, _("Во время теста ByeDPI временно перезапускается с проверяемой стратегией, затем возвращается прежняя стратегия."))
		]),
		E("div", { class: "byedpi-grid" }, [
			E("div", { class: "byedpi-panel" }, [
				E("h3", {}, _("Результаты")),
				E("table", { id: RESULTS_NODE_ID, class: "byedpi-table" }, [
					E("thead", {}, E("tr", {}, [
						E("th", {}, _("Стратегия")),
						E("th", {}, _("Итог")),
						E("th", {}, _("Домены")),
						E("th", {}, "")
					])),
					E("tbody", {})
				])
			]),
			E("div", { class: "byedpi-panel" }, [
				E("h3", {}, _("Лог")),
				E("pre", { id: LOG_NODE_ID, class: "byedpi-log" }, "")
			])
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			execJson([ "list-strategies" ], 15000),
			execJson([ "status" ], 10000),
			execJson([ "diagnostics" ], 20000).catch(function() { return { checks: [] }; })
		]);
	},

	render: function(data) {
		injectStyles();

		strategies = Array.isArray(data[0].strategies) ? data[0].strategies : [];
		const status = data[1] || {};
		const diagnostics = data[2] || { checks: [] };

		const page = E("div", { class: "byedpi-page" }, [
			E("h2", {}, _("Настройки ByeDPI")),
			E("div", { class: "byedpi-tabs" }, [
				E("button", { class: "btn cbi-button active", "data-tab": "settings" }, _("Настройки")),
				E("button", { class: "btn cbi-button", "data-tab": "diagnostics" }, _("Диагностика")),
				E("button", { class: "btn cbi-button", "data-tab": "tester" }, _("Тестер"))
			]),
			renderSettings(status),
			renderDiagnosticsTab(),
			renderTesterTab(status)
		]);

		window.setTimeout(function() {
			bindHandlers();
			renderStatus(status);
			renderDiagnostics(diagnostics);
			setActiveTab(activeTab);
			poll.add(updateStatus);
		}, 0);

		return page;
	}
});
