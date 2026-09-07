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
let testStatusBusy = false;
let lastTestReport = "";
let settingsDirty = false;

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

function sortedStrategies() {
	return strategies.slice().sort(function(a, b) { return a.id - b.id; });
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
	return "#" + item.id + " · " + item.value;
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

		if (strategy && !settingsDirty && document.activeElement !== strategy)
			strategy.value = data.current_strategy || "";

		if (enabled && !settingsDirty)
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

function setTestingState(isTesting) {
	testing = !!isTesting;
	[ "byedpi-auto-start", "byedpi-test-current", "byedpi-test-duration",
	  "byedpi-save-restart", "byedpi-service-start", "byedpi-service-restart", "byedpi-service-stop" ].forEach(function(id) {
		const node = document.getElementById(id);
		if (node) node.disabled = testing;
	});
	const stop = document.getElementById("byedpi-test-stop");
	if (stop) stop.disabled = !testing || stopRequested;
}

function currentStrategy() {
	const input = getStrategyTextarea();
	return normalizeStrategy(input ? input.value : "");
}

function renderTestProgress(status) {
	const node = document.getElementById(TEST_PROGRESS_NODE_ID);
	if (!node) return;
	const serialized = JSON.stringify(status || {});
	if (serialized === lastTestReport && testing === !!(status && status.active && status.state === "running")) return;
	lastTestReport = serialized;
	if (!status || !status.active) {
		node.replaceChildren(E("span", { class: "byedpi-muted" }, _("Подбор ещё не запускался на этом роутере.")));
		setTestingState(false);
		return;
	}
	const running = status.state === "running";
	if (!running) stopRequested = false;
	setTestingState(running);
	const duration = document.getElementById("byedpi-test-duration");
	if (running && duration && status.duration_minutes) duration.value = String(status.duration_minutes);
	const elapsed = Math.max(0, Math.floor(((status.checked_at || 0) - (status.started || 0)) / 60));
	const stage = status.stage === "resolve" ? _("Подготовка адресов") : status.stage === "screen" ? _("Первичный отбор") : _("Повторная проверка");
	const states = { complete: _("Завершено"), stopped: _("Остановлено"), interrupted: _("Прервано"), failed: _("Ошибка подготовки") };
	const summary = running ? stage + " · " + elapsed + _(" мин с начала подбора") : (states[status.state] || status.state);
	node.replaceChildren(E("div", { class: "byedpi-progress" }, [
		E("b", {}, summary),
		E("span", {}, status.message || ""),
		running && status.stage !== "resolve" ? E("span", { class: "byedpi-muted" }, status.stage === "screen"
			? _("Стратегия ") + status.current_id + "/" + status.candidate_count
			: _("Круг ") + status.round + _(" · стратегия ") + status.current_id) : "",
		status.state === "complete" && !status.recommended_id ? E("span", { class: "byedpi-muted" }, _("Ни одна стратегия не прошла критерии стабильности. Автоматически применять здесь нечего.")) : ""
	]));
	const table = document.getElementById(RESULTS_NODE_ID);
	if (!table) return;
	const body = table.querySelector("tbody");
	body.replaceChildren.apply(body, (status.ranking || []).map(function(item) {
		const recommended = String(item.id) === String(status.recommended_id);
		const webEndpoints = (item.endpoints || []).filter(function(e) { return e.kind === "youtube" || e.kind === "google"; });
		const webOnlyPassed = status.state === "complete" && !item.eligible && item.rounds >= 3 && item.p95_ms < 1500 &&
			webEndpoints.length === 2 && webEndpoints.every(function(e) { return e.total >= 6 && e.failed === 0; });
		return E("tr", {}, [
			E("td", {}, [ E("b", {}, (recommended ? _("Рекомендуется · ") : "") + (item.id === 1 ? _("Текущая при запуске") : _("Кандидат ") + item.id)),
				E("details", {}, [ E("summary", {}, _("Аргументы")), E("pre", { class: "byedpi-command" }, item.strategy) ]),
				webOnlyPassed ? E("div", {class:"byedpi-muted"}, _("Короткие запросы YouTube/Google без ошибок. Передача данных не подтверждена.")) : "" ]),
			E("td", {}, [ E("div", {}, _("Ошибок: ") + item.failed + "/" + item.total),
				...(item.endpoints || []).map(function(endpoint) {
					const labels = { youtube: "YouTube", google: "Google", download: "Cloudflare", start: _("Запуск прокси") };
					return E("div", {}, (labels[endpoint.kind] || endpoint.kind) + ": " + endpoint.failed + "/" + endpoint.total);
				}),
				E("div", {}, _("Задержек ≥1,5 с: ") + item.slow), E("div", {}, _("Кругов: ") + item.rounds) ]),
			E("td", {}, item.median_ms === 999999 ? "—" : [
				E("div", {}, item.median_ms + _(" мс обычно")), E("div", {}, item.p95_ms + _(" мс в 95% запросов")),
				E("div", {}, _("Разброс: ") + item.jitter_ms + _(" мс")) ]),
			E("td", {}, [item.min_rate ? (item.min_rate * 8 / 1000000).toFixed(1) + _(" Мбит/с") : _("Полная загрузка не подтверждена"),
				...(item.endpoints || []).filter(function(e) { return e.kind === "download" && e.failed; }).map(function(e) {
					return E("div", {class:"byedpi-muted"}, _("Макс. получено: ") + Math.round(e.max_bytes / 1024) + _(" КиБ из 1024") +
						(e.timeouts ? _(" · таймаутов: ") + e.timeouts : "") + (e.http_errors ? _(" · ошибок HTTP: ") + e.http_errors : ""));
				})]),
			E("td", {}, E("button", {
				class: "btn cbi-button" + (recommended ? " cbi-button-apply" : ""), disabled: running ? "disabled" : null,
				click: function() {
					const strategy = getStrategyTextarea();
					if (strategy) strategy.value = item.strategy;
					settingsDirty = true;
					getPresetSelect().value = item.strategy;
					setActiveTab("settings");
					strategy.focus();
				}
			}, _("Выбрать")))
		]);
	}));
}

async function refreshTestStatus() {
	if (testStatusBusy) return;
	testStatusBusy = true;
	try {
		const status = await execJson([ "test-status" ], 10000);
		renderTestProgress(status);
		const key = [ status.state, status.stage, status.current_id, status.round ].join("|");
		if (status.active && key !== lastProgressKey) {
			lastProgressKey = key;
			logLine(status.message || "");
		}
	} catch (err) {
		// Keep the busy state on RPC failure: the background job may still run.
		lastTestReport = "";
		const node = document.getElementById(TEST_PROGRESS_NODE_ID);
		if (node) node.replaceChildren(E("span", {}, _("Не удалось обновить состояние: ") + err.message));
	} finally { testStatusBusy = false; }
}

async function startTests(mode) {
	if (testing) return;
	const strategy = currentStrategy();
	if (!strategy) { notify(_("Сначала укажите текущую стратегию."), "warning"); return; }
	const duration = document.getElementById("byedpi-test-duration");
	const args = mode === "auto" ? [ "start-autotest", strategy, duration ? duration.value : "15" ] : [ "start-test", strategy ];
	clearLog(); stopRequested = false; setTestingState(true);
	try {
		renderTestProgress(await execJson(args, 15000));
	} catch (err) {
		notify(err.message || err, "error");
		await refreshTestStatus();
	}
}

async function stopTests() {
	if (!testing || stopRequested) return;
	stopRequested = true; setTestingState(true);
	try { renderTestProgress(await execJson([ "stop-test" ], 10000)); }
	catch (err) { stopRequested = false; setTestingState(true); notify(err.message, "error"); }
}

function saveAndRestart(strategy, enabled) {
	strategy = normalizeStrategy(strategy);

	if (!strategy) {
		notify(_("Стратегия пустая"), "warning");
		return Promise.resolve();
	}

	return execJson([ "apply", strategy, enabled ? "1" : "0" ], 30000).then(function(data) {
		settingsDirty = false;
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
			settingsDirty = true;
		});

	getStrategyTextarea().addEventListener("input", function() { settingsDirty = true; });
	getEnabledInput().addEventListener("change", function() { settingsDirty = true; });

	const saveButton = document.getElementById("byedpi-save-restart");
	if (saveButton) saveButton.addEventListener("click", function() {
		saveAndRestart(currentStrategy(), getEnabledInput().checked);
	});
	const diagnosticsButton = document.getElementById("byedpi-refresh-diagnostics");
	if (diagnosticsButton) diagnosticsButton.addEventListener("click", refreshDiagnostics);
	document.getElementById("byedpi-auto-start").addEventListener("click", function() { startTests("auto"); });
	document.getElementById("byedpi-test-current").addEventListener("click", function() { startTests("single"); });
	document.getElementById("byedpi-test-stop").addEventListener("click", stopTests);

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

function renderTesterTab() {
	return E("div", { class: "byedpi-tab", "data-tab": "tester" }, [
		E("div", { class: "byedpi-panel" }, [
			E("h3", {}, _("Подбор стабильной стратегии")),
			E("p", {}, _("Сначала проверяются все стратегии и текущая настройка. Затем до трёх лучших кандидатов проходят повторные проверки по очереди. Рабочий ByeDPI продолжает работать.")),
			E("p", { class: "byedpi-muted" }, _("Рейтинг строится на этом роутере через его провайдера. Результаты других роутеров не используются.")),
			E("label", { class: "byedpi-inline" }, [ _("Повторная проверка после отбора: "),
				E("select", { id: "byedpi-test-duration" }, [
					E("option", { value: "5" }, _("5 минут — быстрая")),
					E("option", { value: "15", selected: "selected" }, _("15 минут — обычная")),
					E("option", { value: "60" }, _("60 минут — длительная"))
				])
			]),
			E("div", { class: "byedpi-inline" }, [
				E("button", { id: "byedpi-auto-start", class: "btn cbi-button cbi-button-apply" }, _("Подобрать стратегию")),
				E("button", { id: "byedpi-test-current", class: "btn cbi-button" }, _("Проверить текущую · 5 минут")),
				E("button", { id: "byedpi-test-stop", class: "btn cbi-button cbi-button-remove", disabled: "disabled" }, _("Остановить"))
			]),
			E("div", { id: TEST_PROGRESS_NODE_ID }),
			E("p", { class: "byedpi-muted" }, _("Подбор продолжается при закрытии страницы. Выбор результата переносит аргументы в настройки; сохранение перезапустит рабочий ByeDPI.")),
			E("p", { class: "byedpi-muted" }, _("Проверяются ответы YouTube и Google и загрузка тестовых данных Cloudflare (до 24 МБ плюс служебный трафик). Это проверка HTTPS через прокси; просмотр видео и маршрут Podkop нужно дополнительно проверить на устройстве."))
		]),
		E("div", { class: "byedpi-panel", style: "overflow-x:auto" }, [
			E("h3", {}, _("Результаты этого запуска")),
			E("table", { id: RESULTS_NODE_ID, class: "byedpi-table" }, [
				E("thead", {}, E("tr", {}, [ _("Стратегия"), _("Надёжность"), _("Задержка HTTPS"), _("Мин. скорость загрузки"), "" ].map(function(t) { return E("th", {}, t); }))),
				E("tbody", {})
			])
		]),
		E("details", { class: "byedpi-panel" }, [ E("summary", {}, _("Ход проверки")), E("pre", { id: LOG_NODE_ID, class: "byedpi-log" }, "") ])
	]);
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,
	load: function() {
		return Promise.all([
			execJson([ "list-strategies" ], 15000),
			execJson([ "status" ], 10000),
			execJson([ "diagnostics" ], 20000).catch(function() { return { checks: [] }; }),
			execJson([ "test-status" ], 10000).catch(function() { return { active: false }; })
		]);
	},

	render: function(data) {
		injectStyles();

		strategies = Array.isArray(data[0].strategies) ? data[0].strategies : [];
		const status = data[1] || {};
		const diagnostics = data[2] || { checks: [] };

		const page = E("div", { class: "byedpi-page" }, [
			E("h2", {}, [ _("Настройки ByeDPI"), E("small", { class: "byedpi-muted", style: "margin-left:12px;font-size:13px" }, "0.2.1") ]),
			E("div", { class: "byedpi-tabs" }, [
				E("button", { class: "btn cbi-button active", "data-tab": "settings" }, _("Настройки")),
				E("button", { class: "btn cbi-button", "data-tab": "diagnostics" }, _("Диагностика")),
				E("button", { class: "btn cbi-button", "data-tab": "tester" }, _("Автоподбор"))
			]),
			renderSettings(status),
			renderDiagnosticsTab(),
			renderTesterTab(status)
		]);

		window.setTimeout(function() {
			bindHandlers();
			renderStatus(status);
			renderDiagnostics(diagnostics);
			renderTestProgress(data[3]);
			setActiveTab(activeTab);
			poll.add(updateStatus);
			poll.add(refreshTestStatus, 3);
		}, 0);

		return page;
	}
});
