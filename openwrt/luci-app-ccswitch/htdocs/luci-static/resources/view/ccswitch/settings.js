'use strict';
'require view';
'require uci';
'require rpc';

var DEFAULT_TOKEN_FIELD = 'ANTHROPIC_AUTH_TOKEN';
var ALT_TOKEN_FIELD = 'ANTHROPIC_API_KEY';
var CODEX_TOKEN_FIELD = 'OPENAI_API_KEY';
var GEMINI_TOKEN_FIELD = 'GEMINI_API_KEY';
var APP_STORAGE_KEY = 'ccswitch-openwrt-selected-app';
var SHARED_PROVIDER_UI_GLOBAL_KEY = '__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__';
var SHARED_PROVIDER_UI_SCRIPT_ID = 'ccswitch-openwrt-shared-provider-ui-bundle';
var SHARED_PROVIDER_UI_STYLE_ID = 'ccswitch-openwrt-shared-provider-ui-styles';
var HOST_PAGE_STYLE_ID = 'ccswitch-openwrt-host-page-shell-styles';
var SHARED_PROVIDER_UI_BUNDLE_PATH = '/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js';
var SHARED_PROVIDER_UI_STYLE_PATH = '/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.css';
var BANNER_COLORS = {
	success: '#256f3a',
	warning: '#d97706',
	error: '#b91c1c',
	info: '#1d4ed8'
};

function createPreset(id, providerName, baseUrl, tokenField, model, options) {
	var meta = options || {};

	return {
		id: id,
		label: meta.label || providerName,
		providerName: providerName,
		baseUrl: baseUrl,
		tokenField: tokenField,
		model: model || '',
		description: meta.description || ''
	};
}

/*
 * Mirrors the shared preset catalog, limited to providers that fit the
 * OpenWrt CRUD payload: { name, baseUrl, tokenField, model }.
 */
var PRESET_CATALOG = {
	claude: [
		createPreset('claude-official', 'Claude Official', 'https://api.anthropic.com', DEFAULT_TOKEN_FIELD, '', {
			label: _('Claude Official'),
			description: _('Official Anthropic Claude endpoint.')
		}),
		createPreset('claude-deepseek', 'DeepSeek', 'https://api.deepseek.com/anthropic', DEFAULT_TOKEN_FIELD, 'DeepSeek-V3.2', {
			description: _('DeepSeek Claude-compatible endpoint.')
		}),
		createPreset('claude-zhipu-glm', 'Zhipu GLM', 'https://open.bigmodel.cn/api/anthropic', DEFAULT_TOKEN_FIELD, 'glm-5'),
		createPreset('claude-zhipu-glm-en', 'Zhipu GLM en', 'https://api.z.ai/api/anthropic', DEFAULT_TOKEN_FIELD, 'glm-5'),
		createPreset('claude-bailian', 'Bailian', 'https://dashscope.aliyuncs.com/apps/anthropic', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-bailian-coding', 'Bailian For Coding', 'https://coding.dashscope.aliyuncs.com/apps/anthropic', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-kimi', 'Kimi', 'https://api.moonshot.cn/anthropic', DEFAULT_TOKEN_FIELD, 'kimi-k2.5', {
			description: _('Moonshot Kimi Claude-compatible endpoint.')
		}),
		createPreset('claude-kimi-coding', 'Kimi For Coding', 'https://api.kimi.com/coding/', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-modelscope', 'ModelScope', 'https://api-inference.modelscope.cn', DEFAULT_TOKEN_FIELD, 'ZhipuAI/GLM-5'),
		createPreset('claude-longcat', 'Longcat', 'https://api.longcat.chat/anthropic', DEFAULT_TOKEN_FIELD, 'LongCat-Flash-Chat'),
		createPreset('claude-minimax', 'MiniMax', 'https://api.minimaxi.com/anthropic', DEFAULT_TOKEN_FIELD, 'MiniMax-M2.7', {
			description: _('MiniMax Claude-compatible endpoint.')
		}),
		createPreset('claude-minimax-en', 'MiniMax en', 'https://api.minimax.io/anthropic', DEFAULT_TOKEN_FIELD, 'MiniMax-M2.7'),
		createPreset('claude-doubaoseed', 'DouBaoSeed', 'https://ark.cn-beijing.volces.com/api/coding', DEFAULT_TOKEN_FIELD, 'doubao-seed-2-0-code-preview-latest'),
		createPreset('claude-bailing', 'BaiLing', 'https://api.tbox.cn/api/anthropic', DEFAULT_TOKEN_FIELD, 'Ling-2.5-1T'),
		createPreset('claude-aihubmix', 'AiHubMix', 'https://aihubmix.com', ALT_TOKEN_FIELD, ''),
		createPreset('claude-siliconflow', 'SiliconFlow', 'https://api.siliconflow.cn', DEFAULT_TOKEN_FIELD, 'Pro/MiniMaxAI/MiniMax-M2.7'),
		createPreset('claude-siliconflow-en', 'SiliconFlow en', 'https://api.siliconflow.com', DEFAULT_TOKEN_FIELD, 'MiniMaxAI/MiniMax-M2.7'),
		createPreset('claude-dmxapi', 'DMXAPI', 'https://www.dmxapi.cn', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-packycode', 'PackyCode', 'https://www.packyapi.com', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-cubence', 'Cubence', 'https://api.cubence.com', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-aigocode', 'AIGoCode', 'https://api.aigocode.com', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-rightcode', 'RightCode', 'https://www.right.codes/claude', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-aicodemirror', 'AICodeMirror', 'https://api.aicodemirror.com/api/claudecode', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-aicoding', 'AICoding', 'https://api.aicoding.sh', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-crazyrouter', 'CrazyRouter', 'https://crazyrouter.com', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-sssaicode', 'SSSAiCode', 'https://node-hk.sssaicode.com/api', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-compshare', 'Compshare', 'https://api.modelverse.cn', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-micu', 'Micu', 'https://www.openclaudecode.cn', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-x-code-api', 'X-Code API', 'https://x-code.cc', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-ctok', 'CTok.ai', 'https://api.ctok.ai', DEFAULT_TOKEN_FIELD, ''),
		createPreset('claude-openrouter', 'OpenRouter', 'https://openrouter.ai/api', DEFAULT_TOKEN_FIELD, 'anthropic/claude-sonnet-4.6'),
		createPreset('claude-novita-ai', 'Novita AI', 'https://api.novita.ai/anthropic', DEFAULT_TOKEN_FIELD, 'zai-org/glm-5'),
		createPreset('claude-xiaomi-mimo', 'Xiaomi MiMo', 'https://api.xiaomimimo.com/anthropic', DEFAULT_TOKEN_FIELD, 'mimo-v2-pro')
	],
	codex: [
		createPreset('codex-openai-official', 'OpenAI Official', 'https://api.openai.com/v1', CODEX_TOKEN_FIELD, 'gpt-5.4', {
			label: _('OpenAI Official'),
			description: _('Official OpenAI Responses endpoint for Codex.')
		}),
		createPreset('codex-azure-openai', 'Azure OpenAI', 'https://YOUR_RESOURCE_NAME.openai.azure.com/openai', CODEX_TOKEN_FIELD, 'gpt-5.4', {
			label: _('Azure OpenAI'),
			description: _('Azure OpenAI Codex endpoint template. Replace YOUR_RESOURCE_NAME before saving.')
		}),
		createPreset('codex-aihubmix', 'AiHubMix', 'https://aihubmix.com/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-dmxapi', 'DMXAPI', 'https://www.dmxapi.cn/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-packycode', 'PackyCode', 'https://www.packyapi.com/v1', CODEX_TOKEN_FIELD, 'gpt-5.4', {
			description: _('PackyCode Codex-compatible endpoint.')
		}),
		createPreset('codex-cubence', 'Cubence', 'https://api.cubence.com/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-aigocode', 'AIGoCode', 'https://api.aigocode.com', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-rightcode', 'RightCode', 'https://right.codes/codex/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-aicodemirror', 'AICodeMirror', 'https://api.aicodemirror.com/api/codex/backend-api/codex', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-aicoding', 'AICoding', 'https://api.aicoding.sh', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-crazyrouter', 'CrazyRouter', 'https://crazyrouter.com/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-sssaicode', 'SSSAiCode', 'https://node-hk.sssaicode.com/api/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-compshare', 'Compshare', 'https://api.modelverse.cn/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-micu', 'Micu', 'https://www.openclaudecode.cn/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-x-code-api', 'X-Code API', 'https://x-code.cc/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-ctok', 'CTok.ai', 'https://api.ctok.ai/v1', CODEX_TOKEN_FIELD, 'gpt-5.4'),
		createPreset('codex-openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', CODEX_TOKEN_FIELD, 'gpt-5.4', {
			description: _('OpenRouter Responses-compatible endpoint for Codex.')
		})
	],
	gemini: [
		createPreset('gemini-google-official', 'Google Official', 'https://generativelanguage.googleapis.com/v1beta', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro', {
			label: _('Google Official'),
			description: _('Official Google Gemini API endpoint.')
		}),
		createPreset('gemini-packycode', 'PackyCode', 'https://www.packyapi.com', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro', {
			description: _('PackyCode Gemini-compatible endpoint.')
		}),
		createPreset('gemini-cubence', 'Cubence', 'https://api.cubence.com', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro'),
		createPreset('gemini-aigocode', 'AIGoCode', 'https://api.aigocode.com', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro'),
		createPreset('gemini-aicodemirror', 'AICodeMirror', 'https://api.aicodemirror.com/api/gemini', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro'),
		createPreset('gemini-aicoding', 'AICoding', 'https://api.aicoding.sh', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro'),
		createPreset('gemini-crazyrouter', 'CrazyRouter', 'https://crazyrouter.com', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro'),
		createPreset('gemini-sssaicode', 'SSSAiCode', 'https://node-hk.sssaicode.com/api', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro'),
		createPreset('gemini-ctok', 'CTok.ai', 'https://api.ctok.ai/v1beta', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro', {
			description: _('CTok Gemini-compatible endpoint.')
		}),
		createPreset('gemini-openrouter', 'OpenRouter', 'https://openrouter.ai/api', GEMINI_TOKEN_FIELD, 'gemini-3.1-pro', {
			description: _('OpenRouter Gemini-compatible endpoint.')
		})
	]
};
var CLAUDE_PRESETS = PRESET_CATALOG.claude;
var CODEX_PRESETS = PRESET_CATALOG.codex;
var GEMINI_PRESETS = PRESET_CATALOG.gemini;
var APP_OPTIONS = [
	{
		id: 'claude',
		label: 'Claude',
		providerLabel: _('Claude Providers'),
		activeProviderLabel: _('Active Claude Provider'),
		manageDescription: _('Manage saved Claude-compatible providers for this router. Service settings, outbound proxy routing, and restart actions stay in LuCI.'),
		baseUrlDescription: _('Claude-compatible API endpoint.'),
		baseUrlPlaceholder: 'https://api.anthropic.com',
		tokenDescription: _('Choose which Anthropic token env key this provider should use.'),
		tokenLabel: _('Token'),
		tokenFieldChoices: [DEFAULT_TOKEN_FIELD, ALT_TOKEN_FIELD],
		modelDescription: _('Optional. Leave blank to avoid a forced model override.'),
		modelPlaceholder: _('Optional model override'),
		summaryRunning: _('The active Claude provider is ready to route traffic with the current outbound proxy settings.'),
		summaryInactive: _('Save a Claude-compatible provider below, then activate it when you are ready to route Claude traffic.'),
		newProviderExample: _('Example: Claude Provider'),
		editorNameDescription: _('Display name for this Claude-compatible provider.'),
		tokenRequiredMessage: _('Token is required for the first save.'),
		presets: CLAUDE_PRESETS
	},
	{
		id: 'codex',
		label: 'Codex',
		providerLabel: _('Codex Providers'),
		activeProviderLabel: _('Active Codex Provider'),
		manageDescription: _('Manage saved Codex / OpenAI Responses providers for this router. Service settings, outbound proxy routing, and restart actions stay in LuCI.'),
		baseUrlDescription: _('OpenAI-compatible Responses endpoint for Codex traffic.'),
		baseUrlPlaceholder: 'https://api.openai.com/v1',
		tokenDescription: _('Codex providers use OPENAI_API_KEY.'),
		tokenLabel: _('API Key'),
		tokenFieldChoices: [CODEX_TOKEN_FIELD],
		modelDescription: _('Optional. Leave blank to keep the current or default Codex model.'),
		modelPlaceholder: 'gpt-5.4',
		summaryRunning: _('The active Codex provider is ready to route traffic with the current outbound proxy settings.'),
		summaryInactive: _('Save a Codex provider below, then activate it when you are ready to route Codex traffic.'),
		newProviderExample: _('Example: Codex Provider'),
		editorNameDescription: _('Display name for this Codex provider.'),
		tokenRequiredMessage: _('API key is required for the first save.'),
		presets: CODEX_PRESETS
	},
	{
		id: 'gemini',
		label: 'Gemini',
		providerLabel: _('Gemini Providers'),
		activeProviderLabel: _('Active Gemini Provider'),
		manageDescription: _('Manage saved Gemini-compatible providers for this router. Service settings, outbound proxy routing, and restart actions stay in LuCI.'),
		baseUrlDescription: _('Gemini-compatible API endpoint.'),
		baseUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
		tokenDescription: _('Gemini providers use GEMINI_API_KEY. This can also hold OAuth access-token JSON when needed.'),
		tokenLabel: _('Credential'),
		tokenFieldChoices: [GEMINI_TOKEN_FIELD],
		modelDescription: _('Optional. Leave blank to keep the current or default Gemini model.'),
		modelPlaceholder: 'gemini-3.1-pro',
		summaryRunning: _('The active Gemini provider is ready to route traffic with the current outbound proxy settings.'),
		summaryInactive: _('Save a Gemini provider below, then activate it when you are ready to route Gemini traffic.'),
		newProviderExample: _('Example: Gemini Provider'),
		editorNameDescription: _('Display name for this Gemini provider.'),
		tokenRequiredMessage: _('Credential is required for the first save.'),
		presets: GEMINI_PRESETS
	}
];

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

var callGetActiveProvider = rpc.declare({
	object: 'ccswitch',
	method: 'get_active_provider',
	params: ['app'],
	expect: { '': {} }
});

var callGetRuntimeStatus = rpc.declare({
	object: 'ccswitch',
	method: 'get_runtime_status',
	expect: { '': {} }
});

var callGetAppRuntimeStatus = rpc.declare({
	object: 'ccswitch',
	method: 'get_app_runtime_status',
	params: ['app'],
	expect: { '': {} }
});

var callGetAvailableFailoverProviders = rpc.declare({
	object: 'ccswitch',
	method: 'get_available_failover_providers',
	params: ['app'],
	expect: { '': {} }
});

var callGetProviderFailover = rpc.declare({
	object: 'ccswitch',
	method: 'get_provider_failover',
	params: ['app', 'provider_id'],
	expect: { '': {} }
});

var callAddToFailoverQueue = rpc.declare({
	object: 'ccswitch',
	method: 'add_to_failover_queue',
	params: ['app', 'provider_id'],
	expect: { '': {} }
});

var callRemoveFromFailoverQueue = rpc.declare({
	object: 'ccswitch',
	method: 'remove_from_failover_queue',
	params: ['app', 'provider_id'],
	expect: { '': {} }
});

var callSetAutoFailoverEnabled = rpc.declare({
	object: 'ccswitch',
	method: 'set_auto_failover_enabled',
	params: ['app', 'enabled'],
	expect: { '': {} }
});

var callReorderFailoverQueue = rpc.declare({
	object: 'ccswitch',
	method: 'reorder_failover_queue',
	params: ['app', 'provider_ids'],
	expect: { '': {} }
});

var callSetMaxRetries = rpc.declare({
	object: 'ccswitch',
	method: 'set_max_retries',
	params: ['app', 'value'],
	expect: { '': {} }
});

var callListProviders = rpc.declare({
	object: 'ccswitch',
	method: 'list_providers',
	params: ['app'],
	expect: { '': {} }
});

var callUpsertActiveProvider = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_active_provider',
	params: ['app', 'provider'],
	expect: { '': {} }
});

var callUpsertProvider = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_provider',
	params: ['app', 'provider'],
	expect: { '': {} }
});

var callUpsertProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_provider',
	params: ['app', 'provider_id', 'provider'],
	expect: { '': {} }
});

var callDeleteProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'delete_provider',
	params: ['app', 'provider_id'],
	expect: { '': {} }
});

var callActivateProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'activate_provider',
	params: ['app', 'provider_id'],
	expect: { '': {} }
});

var callRestartService = rpc.declare({
	object: 'ccswitch',
	method: 'restart_service',
	expect: { '': {} }
});

var callGetHostConfig = rpc.declare({
	object: 'ccswitch',
	method: 'get_host_config',
	expect: { '': {} }
});

var callGetUsageSummary = rpc.declare({
	object: 'ccswitch',
	method: 'get_usage_summary',
	params: ['app'],
	expect: { '': {} }
});

var callGetProviderStats = rpc.declare({
	object: 'ccswitch',
	method: 'get_provider_stats',
	params: ['app'],
	expect: { '': {} }
});

var callGetRecentActivity = rpc.declare({
	object: 'ccswitch',
	method: 'get_recent_activity',
	params: ['app'],
	expect: { '': {} }
});

var callSetHostConfig = rpc.declare({
	object: 'ccswitch',
	method: 'set_host_config',
	params: ['host'],
	expect: { '': {} }
});

function createDaemonAdminUnavailableError(message) {
	var error = new Error(message || 'OpenWrt daemon admin API unavailable');

	error.ccswitchDaemonAdminUnavailable = true;
	return error;
}

function isDaemonAdminUnavailableError(error) {
	return !!(error && error.ccswitchDaemonAdminUnavailable === true);
}

function getDaemonAdminBaseUrl() {
	var hostname;
	var override;

	if (typeof window === 'undefined' || !window.location || window.location.protocol !== 'http:')
		return null;

	override = window.__CCSWITCH_OPENWRT_DAEMON_ADMIN_BASE_URL__;
	if (typeof override === 'string' && override)
		return override.replace(/\/+$/, '');

	hostname = window.location.hostname;
	if (!hostname)
		return null;

	if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
		return null;

	if (hostname.indexOf(':') >= 0 && hostname.charAt(0) !== '[')
		hostname = '[' + hostname + ']';

	return 'http://' + hostname + ':15721/openwrt/admin';
}

function readDaemonAdminJson(response) {
	if (!response || typeof response.json !== 'function')
		return Promise.reject(createDaemonAdminUnavailableError('OpenWrt daemon admin API returned an invalid response object.'));

	if (response.ok !== true)
		return Promise.reject(createDaemonAdminUnavailableError('OpenWrt daemon admin API responded with HTTP ' + response.status + '.'));

	return response.json().then(function (payload) {
		if (!payload || typeof payload !== 'object')
			throw createDaemonAdminUnavailableError('OpenWrt daemon admin API returned invalid JSON.');

		return payload;
	});
}

function callDaemonAdminJson(path, options) {
	var baseUrl = getDaemonAdminBaseUrl();
	var request = options || {};
	var headers = {
		Accept: 'application/json'
	};
	var key;

	if (!baseUrl)
		return Promise.reject(createDaemonAdminUnavailableError('OpenWrt daemon admin API disabled for this page origin.'));

	if (typeof fetch !== 'function')
		return Promise.reject(createDaemonAdminUnavailableError('Browser fetch API is unavailable.'));

	if (request.headers && typeof request.headers === 'object') {
		for (key in request.headers)
			headers[key] = request.headers[key];
	}

	if (request.body != null && headers['Content-Type'] == null)
		headers['Content-Type'] = 'application/json';

	return fetch(baseUrl + path, {
		method: request.method || 'GET',
		headers: headers,
		body: request.body != null ? JSON.stringify(request.body) : undefined
	}).then(function (response) {
		return readDaemonAdminJson(response);
	}).catch(function (error) {
		if (isDaemonAdminUnavailableError(error))
			throw error;

		throw createDaemonAdminUnavailableError((error && error.message) || String(error));
	});
}

function daemonAdminOrFallback(apiCall, fallbackCall) {
	return Promise.resolve().then(apiCall).catch(function (error) {
		if (isDaemonAdminUnavailableError(error))
			return fallbackCall();

		throw error;
	});
}

function callOpenWrtRuntimeStatus() {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/runtime');
	}, function () {
		return L.resolveDefault(callGetRuntimeStatus(), { ok: false });
	});
}

function callOpenWrtAppRuntimeStatus(appId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/runtime');
	}, function () {
		return L.resolveDefault(callGetAppRuntimeStatus(appId), { ok: false });
	});
}

function callOpenWrtUsageSummary(appId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/usage-summary');
	}, function () {
		return L.resolveDefault(callGetUsageSummary(appId), { ok: false });
	});
}

function callOpenWrtProviderStats(appId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/provider-stats');
	}, function () {
		return L.resolveDefault(callGetProviderStats(appId), { ok: false });
	});
}

function callOpenWrtRecentActivity(appId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/recent-activity');
	}, function () {
		return L.resolveDefault(callGetRecentActivity(appId), { ok: false });
	});
}

function callOpenWrtListProviders(appId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/providers');
	}, function () {
		return L.resolveDefault(callListProviders(appId), null);
	});
}

function callOpenWrtGetActiveProvider(appId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/providers/active');
	}, function () {
		return L.resolveDefault(callGetActiveProvider(appId), { ok: false });
	});
}

function callOpenWrtGetProviderFailover(appId, providerId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/providers/' + encodeURIComponent(providerId) + '/failover');
	}, function () {
		return L.resolveDefault(callGetProviderFailover(appId, providerId), { ok: false });
	});
}

function callOpenWrtGetAvailableFailoverProviders(appId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/failover/providers/available');
	}, function () {
		return L.resolveDefault(callGetAvailableFailoverProviders(appId), { ok: false });
	});
}

function callOpenWrtCreateProvider(appId, providerPayload) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/providers', {
			method: 'POST',
			body: providerPayload
		});
	}, function () {
		return L.resolveDefault(callUpsertProvider(appId, providerPayload), { ok: false });
	});
}

function callOpenWrtUpdateProvider(appId, providerId, providerPayload) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/providers/' + encodeURIComponent(providerId), {
			method: 'PUT',
			body: providerPayload
		});
	}, function () {
		return L.resolveDefault(callUpsertProviderByProviderId(appId, providerId, providerPayload), { ok: false });
	});
}

function callOpenWrtSaveActiveProvider(appId, providerPayload) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/providers/active', {
			method: 'POST',
			body: providerPayload
		});
	}, function () {
		return L.resolveDefault(callUpsertActiveProvider(appId, providerPayload), { ok: false });
	});
}

function callOpenWrtDeleteProvider(appId, providerId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/providers/' + encodeURIComponent(providerId), {
			method: 'DELETE'
		});
	}, function () {
		return L.resolveDefault(callDeleteProviderByProviderId(appId, providerId), { ok: false });
	});
}

function callOpenWrtActivateProvider(appId, providerId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/providers/' + encodeURIComponent(providerId) + '/activate', {
			method: 'POST'
		});
	}, function () {
		return L.resolveDefault(callActivateProviderByProviderId(appId, providerId), { ok: false });
	});
}

function callOpenWrtAddToFailoverQueue(appId, providerId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/failover/providers/' + encodeURIComponent(providerId), {
			method: 'POST'
		});
	}, function () {
		return L.resolveDefault(callAddToFailoverQueue(appId, providerId), { ok: false });
	});
}

function callOpenWrtRemoveFromFailoverQueue(appId, providerId) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/failover/providers/' + encodeURIComponent(providerId), {
			method: 'DELETE'
		});
	}, function () {
		return L.resolveDefault(callRemoveFromFailoverQueue(appId, providerId), { ok: false });
	});
}

function callOpenWrtReorderFailoverQueue(appId, providerIds) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/failover/queue', {
			method: 'PUT',
			body: {
				providerIds: providerIds
			}
		});
	}, function () {
		return L.resolveDefault(callReorderFailoverQueue(appId, providerIds), { ok: false });
	});
}

function callOpenWrtSetAutoFailoverEnabled(appId, enabled) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/failover/auto-enabled', {
			method: 'PUT',
			body: {
				enabled: enabled
			}
		});
	}, function () {
		return L.resolveDefault(callSetAutoFailoverEnabled(appId, enabled), { ok: false });
	});
}

function callOpenWrtSetMaxRetries(appId, value) {
	return daemonAdminOrFallback(function () {
		return callDaemonAdminJson('/apps/' + encodeURIComponent(appId) + '/failover/max-retries', {
			method: 'PUT',
			body: {
				value: value
			}
		});
	}, function () {
		return L.resolveDefault(callSetMaxRetries(appId, value), { ok: false });
	});
}

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function () {
		return Promise.all([
			this.loadHostConfigSnapshot(),
			L.resolveDefault(callServiceList('ccswitch'), {}),
			callOpenWrtRuntimeStatus()
		]);
	},

	parseServiceState: function (serviceStatus) {
		try {
			return !!(serviceStatus.ccswitch &&
				serviceStatus.ccswitch.instances &&
				Object.keys(serviceStatus.ccswitch.instances).length);
		} catch (e) {
			return false;
		}
	},

	getSelectedApp: function () {
		var saved = localStorage.getItem(APP_STORAGE_KEY);

		return this.isSupportedApp(saved) ? saved : 'claude';
	},

	saveSelectedApp: function (appId) {
		if (this.isSupportedApp(appId))
			localStorage.setItem(APP_STORAGE_KEY, appId);
	},

	isSupportedApp: function (appId) {
		var i;

		for (i = 0; i < APP_OPTIONS.length; i++) {
			if (APP_OPTIONS[i].id === appId)
				return true;
		}

		return false;
	},

	getAppMeta: function (appId) {
		var i;

		for (i = 0; i < APP_OPTIONS.length; i++) {
			if (APP_OPTIONS[i].id === appId)
				return APP_OPTIONS[i];
		}

		return APP_OPTIONS[0];
	},

	getPresetOptions: function (appId) {
		var appMeta = this.getAppMeta(appId);

		return Array.isArray(appMeta.presets) ? appMeta.presets : [];
	},

	getPresetById: function (appId, presetId) {
		var presets = this.getPresetOptions(appId);
		var i;

		for (i = 0; i < presets.length; i++) {
			if (presets[i].id === presetId)
				return presets[i];
		}

		return null;
	},

	inferPresetIdFromPayload: function (appId, payload) {
		var presets = this.getPresetOptions(appId);
		var normalizedBaseUrl = (payload && payload.baseUrl ? payload.baseUrl : '').trim().replace(/\/+$/, '');
		var normalizedTokenField = payload && payload.tokenField ? payload.tokenField : '';
		var i;

		for (i = 0; i < presets.length; i++) {
			var presetBaseUrl = (presets[i].baseUrl || '').trim().replace(/\/+$/, '');
			if (presetBaseUrl === normalizedBaseUrl &&
				(!normalizedTokenField || presets[i].tokenField === normalizedTokenField))
				return presets[i].id;
		}

		return 'custom';
	},

	updatePresetDescription: function (node, appId, presetId) {
		var preset = this.getPresetById(appId, presetId);

		if (!node)
			return;

		node.textContent = preset
			? preset.description || _('Preset selected. You can still adjust the fields below before saving.')
			: _('Use a preset to prefill the fields below. You can continue editing after selection.');
	},

	applyPresetToInputs: function (appId, presetId, refs) {
		var preset = this.getPresetById(appId, presetId);

		this.updatePresetDescription(refs.presetDescriptionNode, appId, presetId);

		if (!preset)
			return;

		refs.nameInput.value = preset.providerName || preset.label || '';
		refs.baseUrlInput.value = preset.baseUrl || '';
		refs.tokenFieldSelect.value = preset.tokenField || this.getAppMeta(appId).tokenFieldChoices[0];
		refs.modelInput.value = preset.model || '';
	},

	emptyProviderView: function (appId) {
		var appMeta = this.getAppMeta(appId || this.getSelectedApp());

		return {
			configured: false,
			providerId: null,
			name: '',
			baseUrl: '',
			tokenField: appMeta.tokenFieldChoices[0],
			tokenConfigured: false,
			tokenMasked: '',
			model: '',
			notes: '',
			active: false
		};
	},

	emptyEditorPayload: function (appId) {
		var appMeta = this.getAppMeta(appId || this.getSelectedApp());

		return {
			name: '',
			baseUrl: '',
			tokenField: appMeta.tokenFieldChoices[0],
			token: '',
			model: '',
			notes: ''
		};
	},

	parseJsonString: function (payload) {
		var text;
		var start;

		if (typeof payload !== 'string')
			return null;

		text = payload.trim();

		try {
			return JSON.parse(text);
		} catch (e) {
			start = text.indexOf('{');

			if (start > 0) {
				try {
					return JSON.parse(text.substring(start));
				} catch (ignored) {
				}
			}

			return null;
		}
	},

	parseRuntimeStatusPayload: function (response) {
		var parsed = null;
		var service;

		if (response && response.ok === true && response.result_json)
			parsed = this.parseJsonString(response.result_json);

		if (!parsed && response && response.status_json)
			parsed = this.parseJsonString(response.status_json);

		if (!parsed && response && typeof response === 'object' && response.service)
			parsed = response;

		service = parsed && parsed.service && typeof parsed.service === 'object' ? parsed.service : null;

		return {
			running: !!(service && service.running),
			reachable: !!(service && service.reachable),
			listenAddress: service && service.listenAddress ? String(service.listenAddress) : '',
			listenPort: service && service.listenPort != null ? String(service.listenPort) : '',
			proxyEnabled: !!(service && service.proxyEnabled),
			enableLogging: !!(service && service.enableLogging),
			statusSource: service && service.statusSource ? String(service.statusSource) : ''
		};
	},

	defaultHostConfigSnapshot: function () {
		return {
			enabled: false,
			listenAddr: '',
			listenPort: '',
			httpProxy: '',
			httpsProxy: '',
			logLevel: 'info'
		};
	},

	normalizeHostConfigSnapshot: function (response) {
		var fallback = this.defaultHostConfigSnapshot();
		var payload = response && typeof response === 'object' ? response : {};
		var enabled = payload.enabled;

		if (payload && payload.ok === true)
			payload = response;

		if (enabled !== true && enabled !== false)
			enabled = fallback.enabled;

		return {
			enabled: enabled === true,
			listenAddr: payload.listenAddr != null ? String(payload.listenAddr) : fallback.listenAddr,
			listenPort: payload.listenPort != null ? String(payload.listenPort) : fallback.listenPort,
			httpProxy: payload.httpProxy != null ? String(payload.httpProxy) : fallback.httpProxy,
			httpsProxy: payload.httpsProxy != null ? String(payload.httpsProxy) : fallback.httpsProxy,
			logLevel: payload.logLevel != null ? String(payload.logLevel) : fallback.logLevel
		};
	},

	setHostConfigSnapshot: function (response) {
		this.hostConfigSnapshot = this.normalizeHostConfigSnapshot(response);
		return this.getHostConfigSnapshot();
	},

	getHostConfigSnapshot: function () {
		if (!this.hostConfigSnapshot)
			this.hostConfigSnapshot = this.defaultHostConfigSnapshot();

		return Object.assign({}, this.hostConfigSnapshot);
	},

	loadHostConfigSnapshot: function () {
		var fallback = this.getHostConfigSnapshot();

		return L.resolveDefault(callGetHostConfig(), fallback).then(L.bind(function (response) {
			if (!response || response.ok === false)
				return fallback;

			return this.setHostConfigSnapshot(response);
		}, this));
	},

	isStaticPrototypeValidIpv4Address: function (value) {
		var parts;
		var i;

		if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))
			return false;

		parts = value.split('.');

		for (i = 0; i < parts.length; i++) {
			if (parts[i].length > 1 && parts[i].charAt(0) === '0')
				return false;
			if (+parts[i] < 0 || +parts[i] > 255)
				return false;
		}

		return true;
	},

	isStaticPrototypeValidIpv6Address: function (value) {
		var parts;
		var emptyIndex;
		var hasIpv4Tail;
		var segmentCount;
		var ipv4Part;
		var compressedParts;
		var i;

		if (!/^[0-9A-Fa-f:.]+$/.test(value) || value.indexOf(':::') >= 0)
			return false;

		hasIpv4Tail = value.indexOf('.') >= 0;
		ipv4Part = null;

		if (hasIpv4Tail) {
			ipv4Part = value.substring(value.lastIndexOf(':') + 1);
			if (!this.isStaticPrototypeValidIpv4Address(ipv4Part))
				return false;

			value = value.substring(0, value.lastIndexOf(':')) + ':ipv4';
		}

		parts = value.split('::');
		if (parts.length > 2)
			return false;

		emptyIndex = value.indexOf('::');
		if (emptyIndex < 0) {
			compressedParts = value.split(':');
			segmentCount = compressedParts.length;
			if (hasIpv4Tail)
				segmentCount += 1;
			if (segmentCount !== 8)
				return false;
		} else {
			compressedParts = (parts[0] ? parts[0].split(':') : []).concat(parts[1] ? parts[1].split(':') : []);
			segmentCount = compressedParts.length;
			if (hasIpv4Tail)
				segmentCount += 1;
			if (segmentCount >= 8)
				return false;
		}

		for (i = 0; i < compressedParts.length; i++) {
			if (!compressedParts[i])
				return false;
			if (compressedParts[i] === 'ipv4')
				continue;
			if (!/^[0-9A-Fa-f]{1,4}$/.test(compressedParts[i]))
				return false;
		}

		return true;
	},

	isStaticPrototypeValidIpAddress: function (value) {
		if (typeof value !== 'string' || !value)
			return false;

		return this.isStaticPrototypeValidIpv4Address(value) || this.isStaticPrototypeValidIpv6Address(value);
	},

	isStaticPrototypeValidPort: function (value) {
		if (typeof value !== 'string' || !/^\d+$/.test(value))
			return false;

		value = +value;
		return value >= 1 && value <= 65535;
	},

	normalizeStaticPrototypeHostPayload: function (payload, currentSnapshot) {
		var snapshot = currentSnapshot || this.getHostConfigSnapshot();
		var listenAddr = payload && payload.listenAddr != null ? String(payload.listenAddr).trim() : snapshot.listenAddr || '';
		var listenPort = payload && payload.listenPort != null ? String(payload.listenPort).trim() : snapshot.listenPort || '';
		var logLevel = payload && typeof payload.logLevel === 'string'
			? String(payload.logLevel).toLowerCase()
			: (snapshot.logLevel || 'info');
		var allowedLogLevels = {
			error: true,
			warn: true,
			info: true,
			debug: true,
			trace: true
		};

		if (!allowedLogLevels[logLevel])
			logLevel = snapshot.logLevel || 'info';

		if (!this.isStaticPrototypeValidIpAddress(listenAddr))
			listenAddr = snapshot.listenAddr || '';

		if (!this.isStaticPrototypeValidPort(listenPort))
			listenPort = snapshot.listenPort || '';

		return {
			listenAddr: listenAddr,
			listenPort: listenPort,
			httpProxy: payload && payload.httpProxy != null ? String(payload.httpProxy) : snapshot.httpProxy || '',
			httpsProxy: payload && payload.httpsProxy != null ? String(payload.httpsProxy) : snapshot.httpsProxy || '',
			logLevel: logLevel
		};
	},

	saveStaticPrototypeHostConfig: function (payload) {
		return this.loadHostConfigSnapshot().then(L.bind(function (current) {
			var next = this.normalizeStaticPrototypeHostPayload(payload, current);
			var host = {
				enabled: current.enabled,
				listenAddr: next.listenAddr,
				listenPort: next.listenPort,
				httpProxy: next.httpProxy,
				httpsProxy: next.httpsProxy,
				logLevel: next.logLevel
			};

			return Promise.resolve(callSetHostConfig(host)).then(L.bind(function (response) {
				if (!response || response.ok === false)
					throw new Error(this.rpcFailureMessage(response) || _('Failed to save host settings.'));

				this.setHostConfigSnapshot(response);
				return next;
			}, this));
		}, this));
	},

	loadStaticPrototypeHostBindings: function () {
		return Promise.all([
			this.loadHostConfigSnapshot(),
			L.resolveDefault(callServiceList('ccswitch'), {}),
			callOpenWrtRuntimeStatus()
		]).then(L.bind(function (results) {
			return this.getStaticPrototypeBindings([
				results[0],
				results[1],
				results[2]
			]);
		}, this));
	},

	loadStaticPrototypeHostBindingsAfterRestart: function () {
		var self = this;
		var attempts = 0;
		var maxAttempts = 6;
		var delayMs = 500;

		var tryLoad = function () {
			return self.loadStaticPrototypeHostBindings().then(function (hostBindings) {
				if (hostBindings && hostBindings.status === 'running' && hostBindings.health !== 'unknown')
					return hostBindings;

				attempts += 1;
				if (attempts >= maxAttempts)
					return hostBindings;

				return new Promise(function (resolve) {
					window.setTimeout(resolve, delayMs);
				}).then(tryLoad);
			});
		};

		return tryLoad();
	},

	getStaticPrototypeBindings: function (data) {
		var hostConfigResponse = data && data[0] && typeof data[0] === 'object' ? data[0] : null;
		var serviceStatus = data && data[1] ? data[1] : {};
		var runtimeResponse = data && data[2] ? data[2] : {};
		var runtime = this.parseRuntimeStatusPayload(runtimeResponse);
		var hostConfig = hostConfigResponse ? this.setHostConfigSnapshot(hostConfigResponse) : this.getHostConfigSnapshot();
		var isRunning = this.parseServiceState(serviceStatus);
		var proxyEnabled = runtime.statusSource ? runtime.proxyEnabled : !!(hostConfig.httpProxy || hostConfig.httpsProxy);
		var health = 'unknown';

		if (!isRunning)
			health = 'stopped';
		else if (runtime.statusSource)
			health = runtime.reachable ? 'healthy' : 'degraded';

		return {
			app: this.getSelectedApp(),
			status: isRunning ? 'running' : 'stopped',
			health: health,
			listenAddr: hostConfig.listenAddr || runtime.listenAddress || '0.0.0.0',
			listenPort: hostConfig.listenPort || runtime.listenPort || '15721',
			serviceLabel: _('Router daemon'),
			httpProxy: hostConfig.httpProxy || '',
			httpsProxy: hostConfig.httpsProxy || '',
			proxyEnabled: proxyEnabled ? '1' : '0',
			logLevel: hostConfig.logLevel || 'info'
		};
	},

	normalizeNativeHostState: function (bindings) {
		var payload = bindings && typeof bindings === 'object' ? bindings : {};

		return {
			app: this.isSupportedApp(payload.app) ? payload.app : this.getSelectedApp(),
			status: payload.status === 'running' ? 'running' : 'stopped',
			health: payload.health || 'unknown',
			listenAddr: payload.listenAddr != null ? String(payload.listenAddr) : '',
			listenPort: payload.listenPort != null ? String(payload.listenPort) : '',
			serviceLabel: payload.serviceLabel != null ? String(payload.serviceLabel) : _('Router daemon'),
			httpProxy: payload.httpProxy != null ? String(payload.httpProxy) : '',
			httpsProxy: payload.httpsProxy != null ? String(payload.httpsProxy) : '',
			proxyEnabled: payload.proxyEnabled === true || payload.proxyEnabled === '1',
			logLevel: payload.logLevel != null ? String(payload.logLevel) : 'info'
		};
	},

	setNativeHostState: function (uiState, bindings) {
		uiState.hostState = this.normalizeNativeHostState(bindings);
		uiState.isRunning = uiState.hostState.status === 'running';

		return Object.assign({}, uiState.hostState);
	},

	normalizeUsageSummary: function (response) {
		var payload = response && typeof response === 'object' ? response : {};

		return {
			totalRequests: typeof payload.totalRequests === 'number' && isFinite(payload.totalRequests) ? payload.totalRequests : 0,
			totalCost: payload.totalCost != null ? String(payload.totalCost) : '0',
			totalInputTokens: typeof payload.totalInputTokens === 'number' && isFinite(payload.totalInputTokens) ? payload.totalInputTokens : 0,
			totalOutputTokens: typeof payload.totalOutputTokens === 'number' && isFinite(payload.totalOutputTokens) ? payload.totalOutputTokens : 0,
			totalCacheCreationTokens: typeof payload.totalCacheCreationTokens === 'number' && isFinite(payload.totalCacheCreationTokens) ? payload.totalCacheCreationTokens : 0,
			totalCacheReadTokens: typeof payload.totalCacheReadTokens === 'number' && isFinite(payload.totalCacheReadTokens) ? payload.totalCacheReadTokens : 0,
			successRate: typeof payload.successRate === 'number' && isFinite(payload.successRate) ? payload.successRate : 0
		};
	},

	normalizeProviderStats: function (response) {
		var payload = response && typeof response === 'object' ? response : {};
		var providers = Array.isArray(payload.providers) ? payload.providers : (Array.isArray(payload.value) ? payload.value : []);

		return providers.map(function (provider) {
			var item = provider && typeof provider === 'object' ? provider : {};

			return {
				providerId: item.providerId != null ? String(item.providerId) : '',
				providerName: item.providerName != null ? String(item.providerName) : '',
				requestCount: typeof item.requestCount === 'number' && isFinite(item.requestCount) ? item.requestCount : 0,
				totalTokens: typeof item.totalTokens === 'number' && isFinite(item.totalTokens) ? item.totalTokens : 0,
				totalCost: item.totalCost != null ? String(item.totalCost) : '0',
				successRate: typeof item.successRate === 'number' && isFinite(item.successRate) ? item.successRate : 0,
				avgLatencyMs: typeof item.avgLatencyMs === 'number' && isFinite(item.avgLatencyMs) ? item.avgLatencyMs : 0
			};
		});
	},

	normalizeRecentActivity: function (response) {
		var payload = response && typeof response === 'object' ? response : {};
		var fallbackPayload = null;
		var entries = Array.isArray(payload.entries) ? payload.entries : (Array.isArray(payload.value) ? payload.value : []);

		if (!entries.length && typeof payload.recentActivityJson === 'string' && payload.recentActivityJson) {
			fallbackPayload = this.parseJsonString(payload.recentActivityJson);

			if (fallbackPayload && typeof fallbackPayload === 'object')
				entries = Array.isArray(fallbackPayload.entries) ? fallbackPayload.entries : [];
		}

		return entries.map(function (entry) {
			var item = entry && typeof entry === 'object' ? entry : {};

			return {
				requestId: item.requestId != null ? String(item.requestId) : '',
				providerId: item.providerId != null ? String(item.providerId) : '',
				providerName: item.providerName != null ? String(item.providerName) : '',
				model: item.model != null ? String(item.model) : '',
				totalTokens: typeof item.totalTokens === 'number' && isFinite(item.totalTokens) ? item.totalTokens : 0,
				totalCost: item.totalCost != null ? String(item.totalCost) : '0',
				statusCode: typeof item.statusCode === 'number' && isFinite(item.statusCode) ? item.statusCode : 0,
				latencyMs: typeof item.latencyMs === 'number' && isFinite(item.latencyMs) ? item.latencyMs : 0,
				createdAt: typeof item.createdAt === 'number' && isFinite(item.createdAt) ? item.createdAt : 0
			};
		});
	},

	loadNativeUsageSummary: function (appId) {
		var selectedApp = this.isSupportedApp(appId) ? appId : this.getSelectedApp();

		return L.resolveDefault(callOpenWrtUsageSummary(selectedApp), { ok: false }).then(L.bind(function (response) {
			if (!this.isRpcSuccess(response))
				throw new Error(this.rpcFailureMessage(response) || _('Failed to load usage summary.'));

			return this.normalizeUsageSummary(response);
		}, this));
	},

	loadNativeProviderStats: function (appId) {
		var selectedApp = this.isSupportedApp(appId) ? appId : this.getSelectedApp();

		return L.resolveDefault(callOpenWrtProviderStats(selectedApp), { ok: false }).then(L.bind(function (response) {
			if (!this.isRpcSuccess(response))
				throw new Error(this.rpcFailureMessage(response) || _('Failed to load provider stats.'));

			return this.normalizeProviderStats(response);
		}, this));
	},

	loadNativeRecentActivity: function (appId) {
		var selectedApp = this.isSupportedApp(appId) ? appId : this.getSelectedApp();

		return L.resolveDefault(callOpenWrtRecentActivity(selectedApp), { ok: false }).then(L.bind(function (response) {
			if (!this.isRpcSuccess(response))
				throw new Error(this.rpcFailureMessage(response) || _('Failed to load recent activity.'));

			return this.normalizeRecentActivity(response);
		}, this));
	},

	refreshNativeHostState: function (uiState) {
		return this.loadStaticPrototypeHostBindings().then(L.bind(function (bindings) {
			var hostState = this.setNativeHostState(uiState, bindings);

			this.notifyShellListeners(uiState);
			return hostState;
		}, this));
	},

	saveNativeHostConfig: function (uiState, payload) {
		this.setMessage(uiState, 'info', _('Saving host settings...'));
		this.notifyShellListeners(uiState);

		return this.saveStaticPrototypeHostConfig(payload).then(L.bind(function () {
			return this.loadStaticPrototypeHostBindings().then(L.bind(function (bindings) {
				var hostState = this.setNativeHostState(uiState, bindings);

				this.setMessage(uiState, 'success', _('Host settings saved.'));
				this.notifyShellListeners(uiState);
				return hostState;
			}, this));
		}, this)).catch(L.bind(function (err) {
			this.setMessage(uiState, 'error', this.rpcFailureMessage(err) || _('Failed to save host settings.'));
			this.notifyShellListeners(uiState);
			throw err;
		}, this));
	},

	restartServiceFromNativeShellBridge: function (uiState) {
		uiState.busy = true;
		uiState.restartInFlight = true;
		this.setMessage(uiState, 'info', _('Restarting service...'));
		this.notifyShellListeners(uiState);

		return this.restartService().then(L.bind(function (result) {
			if (!this.isRpcSuccess(result))
				throw new Error(this.rpcError(result) || _('Failed to restart service.'));

			return this.loadStaticPrototypeHostBindingsAfterRestart().then(L.bind(function (bindings) {
				this.setNativeHostState(uiState, bindings);
				uiState.restartPending = false;
				this.setMessage(uiState, 'success', _('Service restarted.'));
				this.notifyShellListeners(uiState);

				return {
					isRunning: uiState.isRunning
				};
			}, this));
		}, this)).catch(L.bind(function (err) {
			this.setMessage(uiState, 'error', this.rpcFailureMessage(err) || _('Failed to restart service.'));
			this.notifyShellListeners(uiState);
			throw err;
		}, this)).finally(L.bind(function () {
			uiState.busy = false;
			uiState.restartInFlight = false;
			this.notifyShellListeners(uiState);
		}, this));
	},

	buildStaticPrototypeQuery: function (bindings) {
		var params = [];
		var append = function (key, value) {
			params.push(encodeURIComponent(key) + '=' + encodeURIComponent(value == null ? '' : String(value)));
		};

		append('app', bindings.app || 'claude');
		append('status', bindings.status || 'stopped');
		append('health', bindings.health || 'unknown');
		append('listen_addr', bindings.listenAddr || '');
		append('listen_port', bindings.listenPort || '');
		append('service_label', bindings.serviceLabel || '');
		append('http_proxy', bindings.httpProxy || '');
		append('https_proxy', bindings.httpsProxy || '');
		append('proxy_enabled', bindings.proxyEnabled || '0');
		append('log_level', bindings.logLevel || 'info');

		return params.join('&');
	},

	loadAllStaticPrototypeProviderStates: function () {
		var self = this;
		var requests = APP_OPTIONS.map(function (appMeta) {
			return self.loadStaticPrototypeProviderState(appMeta.id);
		});

		return Promise.all(requests).then(function (states) {
			var byApp = {};

			APP_OPTIONS.forEach(function (appMeta, index) {
				byApp[appMeta.id] = states[index];
			});

			return byApp;
		});
	},

	loadStaticPrototypeProviderState: function (appId) {
		return this.loadProviderState(appId).then(L.bind(function (providerState) {
			return this.loadStaticPrototypeFailoverState(appId, providerState).then(L.bind(function (failoverByProviderId) {
				var providers = Array.isArray(providerState.providers) ? providerState.providers : [];
				var enrichedProviders = providers.map(function (provider) {
					var providerId = provider && provider.providerId ? provider.providerId : null;
					var failoverState = providerId && failoverByProviderId[providerId]
						? failoverByProviderId[providerId]
						: null;

					return Object.assign({}, provider, {
						failover: failoverState
					});
				});

				return Object.assign({}, providerState, {
					providers: enrichedProviders
				});
			}, this));
		}, this));
	},

	loadStaticPrototypeFailoverState: function (appId, providerState) {
		var self = this;
		var providers = providerState && Array.isArray(providerState.providers) ? providerState.providers : [];
		var requests = [];

		providers.forEach(function (provider) {
			var providerId = provider && provider.providerId ? provider.providerId : null;

			if (!providerId)
				return;

			requests.push(
				L.resolveDefault(callOpenWrtGetProviderFailover(appId, providerId), null).then(function (response) {
					return {
						providerId: providerId,
						failover: self.parseStaticPrototypeFailoverState(response, providerId)
					};
				})
			);
		});

		if (!requests.length)
			return Promise.resolve({});

		return Promise.all(requests).then(function (entries) {
			var byProviderId = {};

			entries.forEach(function (entry) {
				if (!entry || !entry.providerId)
					return;

				byProviderId[entry.providerId] = entry.failover;
			});

			return byProviderId;
		});
	},

	buildStaticPrototypeWorkspaceData: function (data) {
		var providerStates = data && data[3] && typeof data[3] === 'object' ? data[3] : {};
		var payload = {
			apps: {}
		};

		APP_OPTIONS.forEach(function (appMeta) {
			var state = providerStates[appMeta.id] || { providers: [], activeProviderId: null };
			var providers = Array.isArray(state.providers) ? state.providers : [];

			payload.apps[appMeta.id] = {
				activeProviderId: state.activeProviderId || null,
				providers: providers.map(function (provider) {
					return {
						providerId: provider.providerId || null,
						name: provider.name || '',
						baseUrl: provider.baseUrl || '',
						tokenField: provider.tokenField || '',
						tokenConfigured: !!provider.tokenConfigured,
						tokenMasked: provider.tokenMasked || '',
						model: provider.model || '',
						notes: provider.notes || '',
						active: !!provider.active,
						failover: provider.failover || null
					};
				})
			};
		});

		return payload;
	},

	parseProviderState: function (providerResponse, appId) {
		var parsed = null;

		if (providerResponse && providerResponse.ok === true && providerResponse.provider_json)
			parsed = this.parseJsonString(providerResponse.provider_json);

		if (!parsed && providerResponse && providerResponse.provider)
			parsed = providerResponse.provider;

		if (!parsed && providerResponse && typeof providerResponse === 'object' && (
			providerResponse.providerId != null ||
			providerResponse.provider_id != null ||
			providerResponse.configured != null ||
			providerResponse.baseUrl != null ||
			providerResponse.base_url != null ||
			providerResponse.tokenField != null ||
			providerResponse.token_field != null
		))
			parsed = providerResponse;

		if (!parsed)
			return this.emptyProviderView(appId);

		return this.normalizeProviderView(parsed, null, null, appId);
	},

	parseStaticPrototypeFailoverState: function (response, fallbackProviderId) {
		var parsed = null;
		var queue = [];
		var providerId;

		if (response && response.ok === true && response.result_json)
			parsed = this.parseJsonString(response.result_json);

		if (!parsed && response && response.status_json)
			parsed = this.parseJsonString(response.status_json);

		if (!parsed && response && typeof response === 'object' && response.providerId)
			parsed = response;

		if (!parsed || typeof parsed !== 'object')
			return this.emptyStaticPrototypeFailoverState(fallbackProviderId);

		queue = Array.isArray(parsed.failoverQueue)
			? parsed.failoverQueue.map(L.bind(function (entry) {
				return this.parseStaticPrototypeFailoverQueueEntry(entry);
			}, this)).filter(function (entry) {
				return entry != null;
			})
			: [];
		providerId = this.getStaticPrototypeStringValue(parsed, ['providerId', 'provider_id']) || fallbackProviderId;

		return {
			providerId: providerId,
			proxyEnabled: this.getStaticPrototypeBooleanValue(parsed, ['proxyEnabled', 'proxy_enabled']),
			autoFailoverEnabled: this.getStaticPrototypeBooleanValue(parsed, ['autoFailoverEnabled', 'auto_failover_enabled']),
			maxRetries: this.getStaticPrototypeNumberValue(parsed, ['maxRetries', 'max_retries']),
			activeProviderId: this.getStaticPrototypeOptionalStringValue(parsed, ['activeProviderId', 'active_provider_id']),
			inFailoverQueue: this.getStaticPrototypeBooleanValue(parsed, ['inFailoverQueue', 'in_failover_queue']),
			queuePosition: this.getStaticPrototypeOptionalNumberValue(parsed, ['queuePosition', 'queue_position']),
			sortIndex: this.getStaticPrototypeOptionalNumberValue(parsed, ['sortIndex', 'sort_index']),
			providerHealth: this.parseStaticPrototypeProviderHealth(parsed.providerHealth, providerId),
			failoverQueueDepth: this.getStaticPrototypeNumberValue(parsed, ['failoverQueueDepth', 'failover_queue_depth']) || queue.length,
			failoverQueue: queue
		};
	},

	parseStaticPrototypeFailoverQueueEntry: function (entry) {
		var providerId;

		if (!entry || typeof entry !== 'object')
			return null;

		providerId = this.getStaticPrototypeStringValue(entry, ['providerId', 'provider_id']);
		if (!providerId)
			return null;

		return {
			providerId: providerId,
			providerName: this.getStaticPrototypeStringValue(entry, ['providerName', 'provider_name']),
			sortIndex: this.getStaticPrototypeOptionalNumberValue(entry, ['sortIndex', 'sort_index']),
			active: this.getStaticPrototypeBooleanValue(entry, ['active']),
			health: this.parseStaticPrototypeProviderHealth(entry.health, providerId)
		};
	},

	parseStaticPrototypeProviderHealth: function (health, fallbackProviderId) {
		if (!health || typeof health !== 'object') {
			return {
				providerId: fallbackProviderId,
				observed: false,
				healthy: true,
				consecutiveFailures: 0,
				lastSuccessAt: null,
				lastFailureAt: null,
				lastError: null,
				updatedAt: null
			};
		}

		return {
			providerId: this.getStaticPrototypeStringValue(health, ['providerId', 'provider_id']) || fallbackProviderId,
			observed: this.getStaticPrototypeBooleanValue(health, ['observed']),
			healthy: !health.hasOwnProperty('healthy')
				? true
				: this.getStaticPrototypeBooleanValue(health, ['healthy']),
			consecutiveFailures: this.getStaticPrototypeNumberValue(health, ['consecutiveFailures', 'consecutive_failures']),
			lastSuccessAt: this.getStaticPrototypeOptionalStringValue(health, ['lastSuccessAt', 'last_success_at']),
			lastFailureAt: this.getStaticPrototypeOptionalStringValue(health, ['lastFailureAt', 'last_failure_at']),
			lastError: this.getStaticPrototypeOptionalStringValue(health, ['lastError', 'last_error']),
			updatedAt: this.getStaticPrototypeOptionalStringValue(health, ['updatedAt', 'updated_at'])
		};
	},

	emptyStaticPrototypeFailoverState: function (providerId) {
		return {
			providerId: providerId,
			proxyEnabled: false,
			autoFailoverEnabled: false,
			maxRetries: 0,
			activeProviderId: null,
			inFailoverQueue: false,
			queuePosition: null,
			sortIndex: null,
			providerHealth: this.parseStaticPrototypeProviderHealth(null, providerId),
			failoverQueueDepth: 0,
			failoverQueue: []
		};
	},

	getStaticPrototypeStringValue: function (value, keys) {
		var i;

		if (!value || typeof value !== 'object')
			return '';

		for (i = 0; i < keys.length; i++) {
			if (typeof value[keys[i]] === 'string')
				return value[keys[i]];
		}

		return '';
	},

	getStaticPrototypeOptionalStringValue: function (value, keys) {
		var result = this.getStaticPrototypeStringValue(value, keys);

		return result || null;
	},

	getStaticPrototypeNumberValue: function (value, keys) {
		var i;

		if (!value || typeof value !== 'object')
			return 0;

		for (i = 0; i < keys.length; i++) {
			if (typeof value[keys[i]] === 'number' && isFinite(value[keys[i]]))
				return value[keys[i]];
		}

		return 0;
	},

	getStaticPrototypeOptionalNumberValue: function (value, keys) {
		var i;

		if (!value || typeof value !== 'object')
			return null;

		for (i = 0; i < keys.length; i++) {
			if (typeof value[keys[i]] === 'number' && isFinite(value[keys[i]]))
				return value[keys[i]];
		}

		return null;
	},

	getStaticPrototypeBooleanValue: function (value, keys) {
		var i;

		if (!value || typeof value !== 'object')
			return false;

		for (i = 0; i < keys.length; i++) {
			if (value[keys[i]])
				return true;
		}

		return false;
	},

	extractPhase2ListPayload: function (response) {
		var directKeys = ['providers', 'items', 'savedProviders', 'providerMap'];
		var jsonKeys = ['providers_json', 'state_json', 'list_json'];
		var i;

		if (!response)
			return null;

		for (i = 0; i < jsonKeys.length; i++) {
			if (response[jsonKeys[i]] != null) {
				var parsed = this.parseJsonString(response[jsonKeys[i]]);
				if (parsed)
					return parsed;
			}
		}

		if (Array.isArray(response))
			return response;

		for (i = 0; i < directKeys.length; i++) {
			if (response[directKeys[i]] != null)
				return response;
		}

		return null;
	},

	normalizeProviderView: function (provider, fallbackId, activeProviderId, appId) {
		var appMeta = this.getAppMeta(appId || this.getSelectedApp());
		var normalized = this.emptyProviderView(appId);
		var providerId = null;
		var isActive = false;

		if (!provider || typeof provider !== 'object')
			return normalized;

		providerId = provider.providerId || provider.provider_id || provider.id || fallbackId || null;
		isActive = !!(provider.active || provider.isActive || provider.is_current ||
			(activeProviderId && providerId && activeProviderId === providerId));

		normalized.configured = provider.configured !== false &&
			!!(providerId || provider.name || provider.baseUrl || provider.base_url ||
				provider.tokenConfigured || provider.token_configured || provider.tokenMasked || provider.token_masked);
		normalized.providerId = providerId;
		normalized.name = provider.name || '';
		normalized.baseUrl = provider.baseUrl || provider.base_url || '';
		normalized.tokenField = provider.tokenField || provider.token_field || appMeta.tokenFieldChoices[0];
		normalized.tokenConfigured = !!(provider.tokenConfigured || provider.token_configured);
		normalized.tokenMasked = provider.tokenMasked || provider.token_masked || '';
		normalized.model = provider.model || '';
		normalized.notes = provider.notes || '';
		normalized.active = isActive;

		return normalized;
	},

	normalizeProviderList: function (rawProviders, activeProviderId, appId) {
		var list = [];
		var self = this;

		if (Array.isArray(rawProviders)) {
			rawProviders.forEach(function (provider, index) {
				list.push(self.normalizeProviderView(provider, 'provider-' + index, activeProviderId, appId));
			});
		} else if (rawProviders && typeof rawProviders === 'object') {
			Object.keys(rawProviders).forEach(function (id) {
				list.push(self.normalizeProviderView(rawProviders[id], id, activeProviderId, appId));
			});
		}

		return list.filter(function (provider) {
			return provider.configured;
		});
	},

	extractRawProviders: function (payload) {
		var metaKeys = {
			activeProviderId: true,
			active_provider_id: true,
			currentProviderId: true,
			current_provider_id: true
		};
		var directMap = {};
		var hasProviderLikeEntries = false;

		if (Array.isArray(payload))
			return payload;

		if (!payload || typeof payload !== 'object')
			return {};

		if (payload.providers != null)
			return payload.providers;

		if (payload.items != null)
			return payload.items;

		if (payload.savedProviders != null)
			return payload.savedProviders;

		if (payload.providerMap != null)
			return payload.providerMap;

		Object.keys(payload).forEach(function (key) {
			if (!metaKeys[key] && payload[key] && typeof payload[key] === 'object') {
				directMap[key] = payload[key];
				hasProviderLikeEntries = true;
			}
		});

		return hasProviderLikeEntries ? directMap : {};
	},

	matchProviderHint: function (providers, providerHint) {
		var i;

		if (!providerHint || !providerHint.configured)
			return null;

		for (i = 0; i < providers.length; i++) {
			if (providerHint.providerId && providers[i].providerId === providerHint.providerId)
				return providers[i].providerId;
		}

		for (i = 0; i < providers.length; i++) {
			if (providers[i].name === providerHint.name &&
				providers[i].baseUrl === providerHint.baseUrl)
				return providers[i].providerId;
		}

		return null;
	},

	findActiveProviderId: function (providers) {
		var i;

		for (i = 0; i < providers.length; i++) {
			if (providers[i].active && providers[i].providerId)
				return providers[i].providerId;
		}

		return null;
	},

	buildProviderState: function (providers, activeProviderId, phase2Available, appId) {
		var activeProvider = this.emptyProviderView(appId);
		var i;

		for (i = 0; i < providers.length; i++) {
			providers[i].active = !!(activeProviderId && providers[i].providerId === activeProviderId);
			if (providers[i].active)
				activeProvider = providers[i];
		}

		return {
			phase2Available: !!phase2Available,
			providers: providers,
			activeProviderId: activeProviderId || null,
			activeProvider: activeProvider
		};
	},

	parsePhase2ProviderState: function (listResponse, activeHint, appId) {
		var payload = this.extractPhase2ListPayload(listResponse);
		var activeProviderId;
		var providers;

		if (!payload)
			return null;

		activeProviderId = payload.activeProviderId ||
			payload.active_provider_id ||
			payload.currentProviderId ||
			payload.current_provider_id ||
			(listResponse && (listResponse.activeProviderId || listResponse.active_provider_id)) ||
			null;

		providers = this.normalizeProviderList(this.extractRawProviders(payload), activeProviderId, appId);

		if (!activeProviderId)
			activeProviderId = this.findActiveProviderId(providers);

		if (!activeProviderId)
			activeProviderId = this.matchProviderHint(providers, activeHint);

		return this.buildProviderState(providers, activeProviderId, true, appId);
	},

	buildLegacyProviderState: function (provider, appId) {
		var providers = [];
		var state;

		if (provider && provider.configured) {
			provider.active = true;
			providers.push(provider);
		}

		state = this.buildProviderState(providers, provider.providerId, false, appId);

		if (provider && provider.configured && !state.activeProvider.configured) {
			providers[0].active = true;
			state.activeProvider = providers[0];
			state.activeProviderId = provider.providerId || null;
		}

		return state;
	},

	loadProviderState: function (appId) {
		return Promise.all([
			callOpenWrtListProviders(appId),
			callOpenWrtGetActiveProvider(appId)
		]).then(L.bind(function (results) {
			var activeProvider = this.parseProviderState(results[1], appId);
			var phase2State = this.parsePhase2ProviderState(results[0], activeProvider, appId);

			if (phase2State)
				return phase2State;

			return this.buildLegacyProviderState(activeProvider, appId);
		}, this));
	},

	refreshPageState: function (appId) {
		return Promise.all([
			L.resolveDefault(callServiceList('ccswitch'), {}),
			this.loadProviderState(appId)
		]).then(L.bind(function (results) {
			return {
				isRunning: this.parseServiceState(results[0]),
				providerState: results[1]
			};
		}, this));
	},

	findProviderById: function (providers, providerId) {
		var i;

		if (!providerId)
			return null;

		for (i = 0; i < providers.length; i++) {
			if (providers[i].providerId === providerId)
				return providers[i];
		}

		return null;
	},

	providerToEditorPayload: function (provider, appId) {
		var appMeta = this.getAppMeta(appId || this.getSelectedApp());
		var payload = this.emptyEditorPayload(appId);

		if (!provider)
			return payload;

		payload.name = provider.name || '';
		payload.baseUrl = provider.baseUrl || '';
		payload.tokenField = provider.tokenField || appMeta.tokenFieldChoices[0];
		payload.model = provider.model || '';
		payload.notes = provider.notes || '';

		return payload;
	},

	getEditorProvider: function (uiState) {
		if (!uiState.providerState.phase2Available)
			return uiState.providerState.activeProvider;

		if (uiState.editorMode === 'edit')
			return this.findProviderById(uiState.providerState.providers, uiState.editProviderId) || this.emptyProviderView(uiState.selectedApp);

		return this.emptyProviderView(uiState.selectedApp);
	},

	getBundleAssetPath: function () {
		return SHARED_PROVIDER_UI_BUNDLE_PATH;
	},

	getBundleStylePath: function () {
		return SHARED_PROVIDER_UI_STYLE_PATH;
	},

	createUiState: function (isRunning, providerStateOrSelectedApp, selectedApp) {
		var resolvedSelectedApp = selectedApp;
		var providerState = providerStateOrSelectedApp;
		var activeProvider;

		if (arguments.length < 3 || !providerState || typeof providerState !== 'object' ||
			!Array.isArray(providerState.providers)) {
			resolvedSelectedApp = this.isSupportedApp(providerStateOrSelectedApp) ? providerStateOrSelectedApp : this.getSelectedApp();
			providerState = this.buildLegacyProviderState(this.emptyProviderView(resolvedSelectedApp), resolvedSelectedApp);
		}

		resolvedSelectedApp = this.isSupportedApp(resolvedSelectedApp) ? resolvedSelectedApp : this.getSelectedApp();
		activeProvider = providerState.activeProvider || this.emptyProviderView(resolvedSelectedApp);

		return {
			isRunning: !!isRunning,
			selectedApp: resolvedSelectedApp,
			providerState: providerState,
			editorMode: providerState.phase2Available ? 'new' : (activeProvider.configured ? 'legacy' : 'new'),
			editProviderId: providerState.phase2Available ? null : providerState.activeProviderId,
			busy: false,
			message: null,
			bundleStatus: 'idle',
			bundleError: null,
			fallbackReason: null,
			restartPending: false,
			restartInFlight: false,
			mountHandle: null,
			mountRequestId: 0,
			runtimeMountHandle: null,
			runtimeMountRequestId: 0,
			shellListeners: []
		};
	},

	setMessage: function (uiState, kind, text) {
		uiState.message = text ? { kind: kind, text: text } : null;
	},

	clearMessage: function (uiState) {
		uiState.message = null;
	},

	setEditorModeNew: function (uiState) {
		uiState.editorMode = uiState.providerState.phase2Available ? 'new' : 'legacy';
		uiState.editProviderId = uiState.providerState.phase2Available ? null : uiState.providerState.activeProviderId;
	},

	setEditorModeEdit: function (uiState, providerId) {
		uiState.editorMode = uiState.providerState.phase2Available ? 'edit' : 'legacy';
		uiState.editProviderId = providerId || uiState.providerState.activeProviderId;
	},

	setBundleStatus: function (uiState, status, error, fallbackReason) {
		uiState.bundleStatus = status;
		uiState.bundleError = error || null;
		uiState.fallbackReason = fallbackReason || null;
	},

	notifyShellListeners: function (uiState) {
		var listeners = uiState.shellListeners || [];

		listeners.slice().forEach(function (listener) {
			try {
				listener();
			} catch (e) {
				/* no-op */
			}
		});
	},

	ensureHostPageStyles: function () {
		var style;

		if (typeof document === 'undefined' || document.getElementById(HOST_PAGE_STYLE_ID))
			return;

		style = document.createElement('style');
		style.id = HOST_PAGE_STYLE_ID;
		style.textContent = [
			'#ccswitch-host-page-shell{--ccswitch-host-foreground:hsl(222 47% 11%);--ccswitch-host-muted:hsl(217 19% 42%);--ccswitch-host-subtle:hsl(215 16% 47%);--ccswitch-host-emphasis:hsl(217 91% 60%);--ccswitch-host-emphasis-soft:hsl(217 91% 60% / .12);--ccswitch-host-emphasis-border:hsl(217 91% 60% / .24);--ccswitch-host-surface-top:hsl(0 0% 100% / .96);--ccswitch-host-surface-bottom:hsl(213 30% 97% / .92);--ccswitch-host-surface-muted-top:hsl(210 33% 98% / .95);--ccswitch-host-surface-muted-bottom:hsl(210 36% 95% / .9);--ccswitch-host-surface-soft-top:hsl(210 38% 97% / .94);--ccswitch-host-surface-soft-bottom:hsl(210 32% 95% / .88);--ccswitch-host-input-top:hsl(0 0% 100% / .94);--ccswitch-host-input-bottom:hsl(212 40% 96% / .92);--ccswitch-host-chip-bg:hsl(210 29% 96% / .92);--ccswitch-host-border:hsl(215 28% 84% / .68);--ccswitch-host-border-strong:hsl(214 24% 74% / .82);--ccswitch-host-divider:hsl(215 26% 88% / .86);--ccswitch-host-shadow:0 20px 44px -34px hsl(222 44% 14% / .34),0 1px 0 hsl(0 0% 100% / .84);--ccswitch-host-shadow-soft:0 16px 32px -28px hsl(220 34% 18% / .24),0 1px 0 hsl(0 0% 100% / .8);--ccswitch-host-success-bg:hsl(142 72% 97% / .98);--ccswitch-host-success-border:hsl(142 60% 74% / .72);--ccswitch-host-success-text:hsl(142 71% 24%);--ccswitch-host-warning-bg:hsl(42 100% 96% / .98);--ccswitch-host-warning-border:hsl(34 89% 72% / .76);--ccswitch-host-warning-text:hsl(25 95% 30%);--ccswitch-host-error-bg:hsl(0 86% 97% / .98);--ccswitch-host-error-border:hsl(0 84% 81% / .78);--ccswitch-host-error-text:hsl(0 74% 35%);--ccswitch-host-info-bg:hsl(213 100% 97% / .98);--ccswitch-host-info-border:hsl(214 95% 79% / .78);--ccswitch-host-info-text:hsl(221 83% 40%);display:flex;flex-direction:column;gap:1.1rem;margin-top:.2rem;color:var(--ccswitch-host-foreground)}',
			'#ccswitch-host-page-shell .ccswitch-host-block{display:flex;flex-direction:column;gap:.9rem;min-width:0}',
			'#ccswitch-host-page-shell .ccswitch-host-top-block{padding-bottom:.15rem;border-bottom:1px solid var(--ccswitch-host-divider)}',
			'#ccswitch-host-page-shell .ccswitch-host-bottom-block{padding-top:.2rem}',
			'html.dark #ccswitch-host-page-shell,body.dark #ccswitch-host-page-shell{--ccswitch-host-foreground:hsl(210 40% 96%);--ccswitch-host-muted:hsl(217 17% 71%);--ccswitch-host-subtle:hsl(217 12% 62%);--ccswitch-host-emphasis:hsl(207 100% 72%);--ccswitch-host-emphasis-soft:hsl(207 100% 72% / .16);--ccswitch-host-emphasis-border:hsl(207 100% 72% / .24);--ccswitch-host-surface-top:hsl(224 24% 18% / .96);--ccswitch-host-surface-bottom:hsl(223 28% 16% / .92);--ccswitch-host-surface-muted-top:hsl(223 23% 20% / .94);--ccswitch-host-surface-muted-bottom:hsl(223 21% 17% / .9);--ccswitch-host-surface-soft-top:hsl(223 22% 22% / .9);--ccswitch-host-surface-soft-bottom:hsl(222 24% 18% / .86);--ccswitch-host-input-top:hsl(223 24% 20% / .94);--ccswitch-host-input-bottom:hsl(223 22% 17% / .92);--ccswitch-host-chip-bg:hsl(223 23% 20% / .92);--ccswitch-host-border:hsl(220 19% 31% / .9);--ccswitch-host-border-strong:hsl(217 18% 40% / .96);--ccswitch-host-divider:hsl(220 18% 28% / .86);--ccswitch-host-shadow:0 22px 52px -34px hsl(220 50% 2% / .72),0 1px 0 hsl(0 0% 100% / .05);--ccswitch-host-shadow-soft:0 18px 40px -30px hsl(220 50% 2% / .62),0 1px 0 hsl(0 0% 100% / .04);--ccswitch-host-success-bg:hsl(145 42% 20% / .92);--ccswitch-host-success-border:hsl(145 46% 36% / .9);--ccswitch-host-success-text:hsl(142 72% 83%);--ccswitch-host-warning-bg:hsl(33 44% 20% / .92);--ccswitch-host-warning-border:hsl(33 58% 42% / .9);--ccswitch-host-warning-text:hsl(38 96% 79%);--ccswitch-host-error-bg:hsl(0 44% 21% / .92);--ccswitch-host-error-border:hsl(0 55% 42% / .9);--ccswitch-host-error-text:hsl(0 86% 86%);--ccswitch-host-info-bg:hsl(217 42% 21% / .92);--ccswitch-host-info-border:hsl(217 62% 44% / .9);--ccswitch-host-info-text:hsl(207 100% 84%)}',
			'#ccswitch-host-page-shell .ccswitch-host-surface{position:relative;margin:0;border:1px solid var(--ccswitch-host-border-strong);border-radius:18px;background:linear-gradient(180deg,var(--ccswitch-host-surface-top) 0%,var(--ccswitch-host-surface-bottom) 100%);box-shadow:var(--ccswitch-host-shadow);padding:1.05rem 1.1rem}',
			'#ccswitch-host-page-shell .ccswitch-host-surface-muted{background:linear-gradient(180deg,var(--ccswitch-host-surface-muted-top) 0%,var(--ccswitch-host-surface-muted-bottom) 100%)}',
			'#ccswitch-host-page-shell .ccswitch-host-shell-stack{display:flex;flex-direction:column;gap:.95rem}',
			'#ccswitch-host-page-shell .ccswitch-host-workspace-stack{display:flex;flex-direction:column;gap:.9rem}',
			'#ccswitch-host-page-shell .ccswitch-host-shell-grid{display:grid;gap:.9rem;align-items:start;grid-template-columns:minmax(0,1fr) minmax(0,1.12fr)}',
			'#ccswitch-host-page-shell .ccswitch-host-shell-grid>.ccswitch-host-surface,#ccswitch-host-page-shell .ccswitch-host-settings-grid>.ccswitch-host-surface{min-width:0}',
			'#ccswitch-host-page-shell .ccswitch-host-runtime-shell,#ccswitch-host-page-shell .ccswitch-host-provider-shell{display:flex;flex-direction:column;gap:.8rem}',
			'#ccswitch-host-page-shell .ccswitch-host-eyebrow{margin:0 0 .45rem;font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ccswitch-host-emphasis)}',
			'#ccswitch-host-page-shell .ccswitch-host-section-title{margin:0;font-size:1.28rem;line-height:1.24;font-weight:700;color:var(--ccswitch-host-foreground)}',
			'#ccswitch-host-page-shell .ccswitch-host-section-description{margin:.45rem 0 0;color:var(--ccswitch-host-muted);max-width:58rem;line-height:1.55}',
			'#ccswitch-host-page-shell .ccswitch-host-status-grid{display:grid;gap:.8rem;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:1rem}',
			'#ccswitch-host-page-shell .ccswitch-host-stat{padding:.82rem .9rem;border:1px solid var(--ccswitch-host-border);border-radius:16px;background:linear-gradient(180deg,var(--ccswitch-host-surface-soft-top) 0%,var(--ccswitch-host-surface-soft-bottom) 100%);box-shadow:var(--ccswitch-host-shadow-soft)}',
			'#ccswitch-host-page-shell .ccswitch-host-stat-label{display:block;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ccswitch-host-subtle)}',
			'#ccswitch-host-page-shell .ccswitch-host-stat-value{display:block;margin-top:.25rem;font-size:1rem;font-weight:700;line-height:1.3;color:var(--ccswitch-host-foreground)}',
			'#ccswitch-host-page-shell .ccswitch-host-summary{margin:.9rem 0 0;padding:.88rem .95rem;border:1px solid var(--ccswitch-host-emphasis-border);border-radius:16px;background:linear-gradient(135deg,var(--ccswitch-host-info-bg) 0%,var(--ccswitch-host-surface-soft-bottom) 100%);box-shadow:var(--ccswitch-host-shadow-soft)}',
			'#ccswitch-host-page-shell .ccswitch-host-summary-label{display:block;font-size:.78rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ccswitch-host-emphasis)}',
			'#ccswitch-host-page-shell .ccswitch-host-summary-text{display:block;margin-top:.35rem;color:var(--ccswitch-host-muted);line-height:1.6}',
			'#ccswitch-host-page-shell .ccswitch-host-status-shell{display:flex;flex-direction:column;gap:.85rem}',
			'#ccswitch-host-page-shell .ccswitch-host-status-shell-main{display:flex;flex-direction:column;gap:.85rem}',
			'#ccswitch-host-page-shell .ccswitch-host-service-row{display:grid;gap:.8rem;grid-template-columns:minmax(0,1fr) auto;align-items:start}',
			'#ccswitch-host-page-shell .ccswitch-host-inline-banner{display:block;padding:.78rem .9rem;border:1px solid var(--ccswitch-host-border-strong);border-radius:16px;background:linear-gradient(180deg,var(--ccswitch-host-surface-soft-top) 0%,var(--ccswitch-host-surface-soft-bottom) 100%);box-shadow:var(--ccswitch-host-shadow-soft);color:var(--ccswitch-host-muted)}',
			'#ccswitch-host-page-shell .ccswitch-host-inline-banner[data-kind="success"]{border-color:var(--ccswitch-host-success-border);background:linear-gradient(180deg,var(--ccswitch-host-success-bg) 0%,var(--ccswitch-host-surface-top) 100%);color:var(--ccswitch-host-success-text)}',
			'#ccswitch-host-page-shell .ccswitch-host-inline-banner[data-kind="warning"]{border-color:var(--ccswitch-host-warning-border);background:linear-gradient(180deg,var(--ccswitch-host-warning-bg) 0%,var(--ccswitch-host-surface-top) 100%);color:var(--ccswitch-host-warning-text)}',
			'#ccswitch-host-page-shell .ccswitch-host-inline-banner[data-kind="error"]{border-color:var(--ccswitch-host-error-border);background:linear-gradient(180deg,var(--ccswitch-host-error-bg) 0%,var(--ccswitch-host-surface-top) 100%);color:var(--ccswitch-host-error-text)}',
			'#ccswitch-host-page-shell .ccswitch-host-inline-banner[data-kind="info"]{border-color:var(--ccswitch-host-info-border);background:linear-gradient(180deg,var(--ccswitch-host-info-bg) 0%,var(--ccswitch-host-surface-top) 100%);color:var(--ccswitch-host-info-text)}',
			'#ccswitch-host-page-shell .ccswitch-host-inline-banner[hidden]{display:none!important}',
			'#ccswitch-host-page-shell .ccswitch-host-inline-banner strong{display:block;font-size:.92rem}',
			'#ccswitch-host-page-shell .ccswitch-host-inline-banner div+div{margin-top:.4rem}',
			'#ccswitch-host-page-shell .ccswitch-host-actions{display:flex;flex-wrap:wrap;gap:.65rem;margin-top:.85rem}',
			'#ccswitch-host-page-shell .ccswitch-host-actions .cbi-button,#ccswitch-host-page-shell .ccswitch-host-map .cbi-page-actions .cbi-button{min-height:2.75rem;padding:.7rem 1.1rem;border:1px solid var(--ccswitch-host-border-strong);border-radius:14px;background:linear-gradient(180deg,var(--ccswitch-host-input-top) 0%,var(--ccswitch-host-input-bottom) 100%);box-shadow:var(--ccswitch-host-shadow-soft);color:var(--ccswitch-host-foreground)}',
			'#ccswitch-host-page-shell .ccswitch-host-actions .cbi-button:hover,#ccswitch-host-page-shell .ccswitch-host-map .cbi-page-actions .cbi-button:hover{border-color:var(--ccswitch-host-emphasis-border);background:linear-gradient(180deg,var(--ccswitch-host-surface-top) 0%,var(--ccswitch-host-chip-bg) 100%)}',
			'#ccswitch-host-page-shell .ccswitch-host-nonlive-shell .ccswitch-host-shell-note{opacity:.72}',
			'#ccswitch-host-page-shell .ccswitch-host-nonlive-shell .ccswitch-host-shared-mount{opacity:.9}',
			'#ccswitch-host-page-shell .ccswitch-host-map{margin:0;padding:0;background:transparent;border:0;box-shadow:none}',
			'#ccswitch-host-page-shell .ccswitch-host-map > h2,#ccswitch-host-page-shell .ccswitch-host-map > .cbi-map-descr{display:none!important}',
			'#ccswitch-host-page-shell .ccswitch-host-settings-grid{display:grid;gap:.9rem;align-items:start;grid-template-columns:repeat(2,minmax(0,1fr))}',
			'#ccswitch-host-page-shell .ccswitch-host-map .cbi-section{margin:0;min-width:0}',
			'#ccswitch-host-page-shell .ccswitch-host-form-section h3{margin:0 0 .3rem;font-size:1rem;font-weight:700;color:var(--ccswitch-host-foreground)}',
			'#ccswitch-host-page-shell .ccswitch-host-form-section > .cbi-section-descr,#ccswitch-host-page-shell .ccswitch-host-form-section > p{margin:.38rem 0 0;color:var(--ccswitch-host-muted);line-height:1.55}',
			'#ccswitch-host-page-shell .ccswitch-host-map .cbi-value{display:grid;grid-template-columns:minmax(0,10.5rem) minmax(0,1fr);column-gap:.9rem;row-gap:.35rem;align-items:flex-start;margin:0;padding:.8rem 0;border-top:1px solid var(--ccswitch-host-divider)}',
			'#ccswitch-host-page-shell .ccswitch-host-map .cbi-value:first-of-type{border-top:0;padding-top:.35rem}',
			'#ccswitch-host-page-shell .ccswitch-host-map .cbi-value:last-of-type{padding-bottom:0}',
			'#ccswitch-host-page-shell .ccswitch-host-map .cbi-value-title{margin:0;font-size:.8rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ccswitch-host-subtle)}',
			'#ccswitch-host-page-shell .ccswitch-host-map .cbi-value-field{min-width:0}',
			'#ccswitch-host-page-shell .ccswitch-host-map .cbi-value-description{margin-top:.38rem;color:var(--ccswitch-host-subtle);line-height:1.5}',
			'#ccswitch-host-page-shell .ccswitch-host-map input[type="text"],#ccswitch-host-page-shell .ccswitch-host-map input[type="password"],#ccswitch-host-page-shell .ccswitch-host-map input[type="number"],#ccswitch-host-page-shell .ccswitch-host-map select,#ccswitch-host-page-shell .ccswitch-host-map textarea{width:100%;min-height:2.65rem;padding:.6rem .8rem;border:1px solid var(--ccswitch-host-border-strong);border-radius:14px;background:linear-gradient(180deg,var(--ccswitch-host-input-top) 0%,var(--ccswitch-host-input-bottom) 100%);box-shadow:inset 0 1px 0 hsl(0 0% 100% / .24),0 10px 18px -18px hsl(220 38% 12% / .35);color:var(--ccswitch-host-foreground)}',
			'#ccswitch-host-page-shell .ccswitch-host-map input[type="text"]:focus,#ccswitch-host-page-shell .ccswitch-host-map input[type="password"]:focus,#ccswitch-host-page-shell .ccswitch-host-map input[type="number"]:focus,#ccswitch-host-page-shell .ccswitch-host-map select:focus,#ccswitch-host-page-shell .ccswitch-host-map textarea:focus{border-color:var(--ccswitch-host-emphasis-border);box-shadow:0 0 0 4px var(--ccswitch-host-emphasis-soft);outline:none}',
			'#ccswitch-host-page-shell .ccswitch-host-map .cbi-page-actions{display:flex;flex-wrap:wrap;gap:.65rem;margin:.9rem 0 0;padding:0}',
			'#ccswitch-host-page-shell .ccswitch-host-shell-note{margin:0;color:var(--ccswitch-host-muted);line-height:1.6}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-list{display:flex;flex-direction:column;gap:.8rem;margin-bottom:1.05rem}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-list-title{margin:0;color:var(--ccswitch-host-foreground);font-size:1rem;font-weight:700}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-empty{margin:0;padding:.9rem .95rem;border:1px dashed var(--ccswitch-host-border-strong);border-radius:16px;background:linear-gradient(180deg,var(--ccswitch-host-surface-soft-top) 0%,var(--ccswitch-host-surface-soft-bottom) 100%);box-shadow:var(--ccswitch-host-shadow-soft);color:var(--ccswitch-host-muted);line-height:1.55}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-card{padding:.9rem .95rem;border:1px solid var(--ccswitch-host-border);border-radius:16px;background:linear-gradient(180deg,var(--ccswitch-host-surface-top) 0%,var(--ccswitch-host-surface-bottom) 100%);box-shadow:var(--ccswitch-host-shadow-soft)}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-card[data-active="true"]{border-color:var(--ccswitch-host-success-border);background:linear-gradient(180deg,var(--ccswitch-host-success-bg) 0%,var(--ccswitch-host-surface-top) 100%)}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;flex-wrap:wrap}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-card-title{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;font-weight:700;color:var(--ccswitch-host-foreground)}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-card-actions{display:flex;flex-wrap:wrap;gap:.5rem}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-card-url{margin-top:.45rem;color:var(--ccswitch-host-muted);word-break:break-all;line-height:1.5}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-card-meta{display:flex;flex-direction:column;gap:.4rem;margin-top:.65rem}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-card-meta-row{color:var(--ccswitch-host-muted);line-height:1.55}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-badge{display:inline-flex;align-items:center;padding:.18rem .55rem;border-radius:999px;font-size:.75rem;font-weight:700;border:1px solid transparent}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-badge[data-kind="active"]{background:var(--ccswitch-host-success-bg);border-color:var(--ccswitch-host-success-border);color:var(--ccswitch-host-success-text)}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-badge[data-kind="warning"]{background:var(--ccswitch-host-error-bg);border-color:var(--ccswitch-host-error-border);color:var(--ccswitch-host-error-text)}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-editor{margin-top:.9rem;padding:.9rem .95rem;border:1px solid var(--ccswitch-host-border);border-radius:16px;background:linear-gradient(180deg,var(--ccswitch-host-surface-muted-top) 0%,var(--ccswitch-host-surface-muted-bottom) 100%);box-shadow:var(--ccswitch-host-shadow-soft)}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-editor h4{margin:0;color:var(--ccswitch-host-foreground);font-size:1rem;font-weight:700}',
			'#ccswitch-host-page-shell .ccswitch-host-fallback-editor .ccswitch-host-shell-note{margin-top:.38rem}',
			'#ccswitch-host-page-shell .ccswitch-host-shared-mount,#ccswitch-host-page-shell #ccswitch-shared-provider-ui-root,#ccswitch-host-page-shell #ccswitch-shared-runtime-surface-root{margin-top:.85rem;min-height:1px;min-width:0}',
			'#ccswitch-host-page-shell .ccswitch-host-stat-value[data-tone="success"]{color:var(--ccswitch-host-success-text)}',
			'#ccswitch-host-page-shell .ccswitch-host-stat-value[data-tone="warning"]{color:var(--ccswitch-host-warning-text)}',
			'#ccswitch-host-page-shell .ccswitch-host-stat-value[data-tone="error"]{color:var(--ccswitch-host-error-text)}',
			'#ccswitch-host-page-shell .ccswitch-host-stat-value[data-tone="info"]{color:var(--ccswitch-host-info-text)}',
			'@media (max-width:1120px){#ccswitch-host-page-shell .ccswitch-host-shell-grid,#ccswitch-host-page-shell .ccswitch-host-settings-grid{grid-template-columns:minmax(0,1fr)}#ccswitch-host-page-shell .ccswitch-host-section-title{font-size:1.18rem}}',
			'@media (max-width:820px){#ccswitch-host-page-shell .ccswitch-host-status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#ccswitch-host-page-shell .ccswitch-host-map .cbi-value{grid-template-columns:minmax(0,1fr);row-gap:.4rem}#ccswitch-host-page-shell .ccswitch-host-surface{padding:.95rem}#ccswitch-host-page-shell .ccswitch-host-service-row{grid-template-columns:minmax(0,1fr)}#ccswitch-host-page-shell .ccswitch-host-shared-mount,#ccswitch-host-page-shell #ccswitch-shared-provider-ui-root,#ccswitch-host-page-shell #ccswitch-shared-runtime-surface-root{margin-top:.75rem}}',
			'@media (max-width:640px){#ccswitch-host-page-shell .ccswitch-host-status-grid{grid-template-columns:minmax(0,1fr)}#ccswitch-host-page-shell .ccswitch-host-actions,#ccswitch-host-page-shell .ccswitch-host-map .cbi-page-actions,#ccswitch-host-page-shell .ccswitch-host-fallback-card-header,#ccswitch-host-page-shell .ccswitch-host-fallback-card-actions{flex-direction:column;align-items:stretch}#ccswitch-host-page-shell .ccswitch-host-actions .cbi-button,#ccswitch-host-page-shell .ccswitch-host-map .cbi-page-actions .cbi-button{width:100%}}'
		].join('');
		document.head.appendChild(style);
	},

	appendClass: function (node, className) {
		var existingClasses;

		if (!node || !className)
			return;

		if (node.classList) {
			node.classList.add(className);
			return;
		}

		existingClasses = node.getAttribute('class') || '';
		if (existingClasses.indexOf(className) === -1)
			node.setAttribute('class', (existingClasses + ' ' + className).trim());
	},

	setTone: function (node, tone) {
		if (!node)
			return;

		if (tone)
			node.setAttribute('data-tone', tone);
		else
			node.removeAttribute('data-tone');
	},

	createSectionIntro: function (eyebrow, title, description) {
		var children = [];

		if (eyebrow)
			children.push(E('p', { 'class': 'ccswitch-host-eyebrow' }, [eyebrow]));

		children.push(E('h3', { 'class': 'ccswitch-host-section-title' }, [title]));

		if (description)
			children.push(E('p', { 'class': 'ccswitch-host-section-description' }, [description]));

		return E('div', {}, children);
	},

	createStatusMetric: function (label, valueNode) {
		valueNode.className = 'ccswitch-host-stat-value';

		return E('div', { 'class': 'ccswitch-host-stat' }, [
			E('span', { 'class': 'ccswitch-host-stat-label' }, [label]),
			valueNode
		]);
	},

	createInlineStateNotice: function (kind, title, message, detail) {
		var tone = kind || 'info';
		var children = [];

		if (title)
			children.push(E('strong', {}, [title]));

		if (message)
			children.push(E('div', {}, [message]));

		if (detail)
			children.push(E('div', {}, [detail]));

		return E('div', {
			'class': 'ccswitch-host-inline-banner',
			'data-kind': tone
		}, children);
	},

	createHostPageHero: function () {
		this.ensureHostPageStyles();

		return E('section', { 'class': 'ccswitch-host-surface' }, [
			this.createSectionIntro(
				_('OpenWrt Host Shell'),
				_('Router Host Controls'),
				_('Keep truthful router-backed service settings, service status, and restart actions in LuCI. The provider workspace is isolated below as the main product surface.')
			)
		]);
	},

	decorateMapElement: function (mapEl) {
		var self = this;
		var children;
		var actionsNode = null;
		var grid;

		if (!mapEl)
			return mapEl;

		this.ensureHostPageStyles();
		this.appendClass(mapEl, 'ccswitch-host-map');
		children = Array.prototype.slice.call(mapEl.children || []);
		grid = E('div', { 'class': 'ccswitch-host-settings-grid' });

		children.forEach(function (child) {
			if (!child)
				return;

			if (child.tagName === 'H2' || (child.classList && child.classList.contains('cbi-map-descr'))) {
				child.style.display = 'none';
				return;
			}

			if (child.classList && child.classList.contains('cbi-page-actions')) {
				actionsNode = child;
				return;
			}

			if (child.classList && child.classList.contains('cbi-section')) {
				self.appendClass(child, 'ccswitch-host-surface');
				self.appendClass(child, 'ccswitch-host-form-section');
				grid.appendChild(child);
			}
		});

		if (grid.childNodes.length)
			mapEl.insertBefore(grid, actionsNode || null);
		if (actionsNode)
			self.appendClass(actionsNode, 'ccswitch-host-actions');

		return mapEl;
	},

	renderMessageBanner: function (message) {
		if (!message || !message.text)
			return E('div', { 'class': 'ccswitch-host-inline-banner', 'hidden': 'hidden' });

		return this.createInlineStateNotice(message.kind, null, message.text);
	},

	renderValue: function (title, control, description) {
		var fieldChildren = [control];

		if (typeof description === 'string')
			fieldChildren.push(E('div', { 'class': 'cbi-value-description' }, [description]));
		else if (description)
			fieldChildren.push(description);

		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [title]),
			E('div', { 'class': 'cbi-value-field' }, fieldChildren)
		]);
	},

	isRpcSuccess: function (result) {
		return result === true || (result && result.ok === true);
	},

	rpcError: function (result) {
		return (result && (result.error || result.message)) || null;
	},

	rpcFailureMessage: function (failure) {
		if (failure == null)
			return null;

		if (typeof failure === 'string')
			return failure;

		if (failure && typeof failure === 'object' &&
			failure.ok === false &&
			!failure.message &&
			!failure.error &&
			Object.keys(failure).length === 1)
			return null;

		if (failure.message)
			return failure.message;

		if (failure.error)
			return failure.error;

		try {
			return JSON.stringify(failure);
		} catch (e) {
			return String(failure);
		}
	},

	isCompatibilityRpcFailure: function (failure) {
		var message = this.rpcFailureMessage(failure);

		if (!message)
			return true;

		message = message.toLowerCase();

		return message.indexOf('method not found') >= 0 ||
			message.indexOf('no such method') >= 0 ||
			message.indexOf('unknown method') >= 0 ||
			message.indexOf('invalid argument') >= 0 ||
			message.indexOf('invalid arguments') >= 0 ||
			message.indexOf('invalid params') >= 0 ||
			message.indexOf('invalid parameters') >= 0 ||
			message.indexOf('unknown argument') >= 0 ||
			message.indexOf('unknown parameter') >= 0 ||
			message.indexOf('unexpected argument') >= 0 ||
			message.indexOf('unexpected parameter') >= 0 ||
			message.indexOf('missing argument') >= 0 ||
			message.indexOf('missing parameter') >= 0 ||
			message.indexOf('argument mismatch') >= 0 ||
			message.indexOf('parameter mismatch') >= 0;
	},

	invokeRpcCandidates: async function (candidates, missingMessage) {
		var lastCompatibilityFailure = null;
		var i;

		for (i = 0; i < candidates.length; i++) {
			try {
				var result = await candidates[i].call();

				if (this.isRpcSuccess(result))
					return result;

				if (candidates[i].compatibilityFallback && this.isCompatibilityRpcFailure(result)) {
					lastCompatibilityFailure = result;
					continue;
				}

				throw new Error(this.rpcError(result) || missingMessage);
			} catch (err) {
				if (candidates[i].compatibilityFallback && this.isCompatibilityRpcFailure(err)) {
					lastCompatibilityFailure = err;
					continue;
				}

				throw new Error(this.rpcFailureMessage(err) || missingMessage);
			}
		}

		throw new Error(this.rpcFailureMessage(lastCompatibilityFailure) || missingMessage);
	},

	invokePhase2Upsert: function (appId, providerId, providerPayload) {
		var missingMessage = _('The Phase 2 provider save RPC is not available in this build.');

		if (providerId) {
			return this.invokeRpcCandidates([
				{
					call: function () { return callOpenWrtUpdateProvider(appId, providerId, providerPayload); },
					compatibilityFallback: true
				}
			], missingMessage);
		}

		return this.invokeRpcCandidates([
			{
				call: function () { return callOpenWrtCreateProvider(appId, providerPayload); },
				compatibilityFallback: true
			}
		], missingMessage);
	},

	invokePhase2Delete: function (appId, providerId) {
		return this.invokeRpcCandidates([
			{
				call: function () { return callOpenWrtDeleteProvider(appId, providerId); },
				compatibilityFallback: true
			}
		], _('The Phase 2 provider delete RPC is not available in this build.'));
	},

	invokePhase2Activate: function (appId, providerId) {
		return this.invokeRpcCandidates([
			{
				call: function () { return callOpenWrtActivateProvider(appId, providerId); },
				compatibilityFallback: true
			}
		], _('The Phase 2 provider activate RPC is not available in this build.'));
	},

	restartService: function () {
		return this.invokeRpcCandidates([
			{
				call: function () { return callRestartService(); },
				compatibilityFallback: false
			}
		], _('Failed to restart service.'));
	},

	createProviderTransport: function () {
		return {
			listProviders: function (appId) {
				return callOpenWrtListProviders(appId);
			},
			listSavedProviders: function (appId) {
				return callOpenWrtListProviders(appId);
			},
			getActiveProvider: function (appId) {
				return callOpenWrtGetActiveProvider(appId);
			},
			getProviderFailoverState: function (appId, providerId) {
				return callOpenWrtGetProviderFailover(appId, providerId);
			},
			upsertProvider: function (appId, provider) {
				return callOpenWrtCreateProvider(appId, provider);
			},
			saveProvider: function (appId, provider) {
				return callOpenWrtCreateProvider(appId, provider);
			},
			upsertProviderByProviderId: function (appId, providerId, provider) {
				return callOpenWrtUpdateProvider(appId, providerId, provider);
			},
			upsertProviderById: function (appId, providerId, provider) {
				return callOpenWrtUpdateProvider(appId, providerId, provider);
			},
			upsertActiveProvider: function (appId, provider) {
				return callOpenWrtSaveActiveProvider(appId, provider);
			},
			deleteProviderByProviderId: function (appId, providerId) {
				return callOpenWrtDeleteProvider(appId, providerId);
			},
			deleteProviderById: function (appId, providerId) {
				return callOpenWrtDeleteProvider(appId, providerId);
			},
			activateProviderByProviderId: function (appId, providerId) {
				return callOpenWrtActivateProvider(appId, providerId);
			},
			activateProviderById: function (appId, providerId) {
				return callOpenWrtActivateProvider(appId, providerId);
			},
			addToFailoverQueue: function (appId, providerId) {
				return callOpenWrtAddToFailoverQueue(appId, providerId);
			},
			removeFromFailoverQueue: function (appId, providerId) {
				return callOpenWrtRemoveFromFailoverQueue(appId, providerId);
			},
			setAutoFailoverEnabled: function (appId, enabled) {
				return callOpenWrtSetAutoFailoverEnabled(appId, enabled);
			},
			reorderFailoverQueue: function (appId, providerIds) {
				return callOpenWrtReorderFailoverQueue(appId, providerIds);
			},
			setMaxRetries: function (appId, value) {
				return callOpenWrtSetMaxRetries(appId, value);
			},
			restartService: function () {
				return L.resolveDefault(callRestartService(), { ok: false });
			}
		};
	},

	createNativePageShellBridge: function (uiState) {
		var self = this;

		return {
			getSelectedApp: function () {
				return uiState.selectedApp;
			},
			setSelectedApp: function (appId) {
				if (!self.isSupportedApp(appId))
					return uiState.selectedApp;

				uiState.selectedApp = appId;
				self.saveSelectedApp(appId);
				if (uiState.hostState)
					uiState.hostState.app = appId;
				self.notifyShellListeners(uiState);

				return uiState.selectedApp;
			},
			getServiceStatus: function () {
				return {
					isRunning: uiState.isRunning
				};
			},
			getRestartState: function () {
				return {
					pending: !!uiState.restartPending,
					inFlight: !!uiState.restartInFlight
				};
			},
			setRestartState: function (restartState) {
				if (!restartState)
					return;

				if (typeof restartState.pending === 'boolean')
					uiState.restartPending = restartState.pending;
				if (typeof restartState.inFlight === 'boolean')
					uiState.restartInFlight = restartState.inFlight;

				self.notifyShellListeners(uiState);
			},
			getHostState: function () {
				return Object.assign({}, uiState.hostState || self.normalizeNativeHostState({ app: uiState.selectedApp }));
			},
			getMessage: function () {
				return uiState.message ? {
					kind: uiState.message.kind,
					text: uiState.message.text
				} : null;
			},
			subscribe: function (listener) {
				if (typeof listener !== 'function')
					return function () {};

				uiState.shellListeners.push(listener);
				return function () {
					var nextListeners = [];

					uiState.shellListeners.forEach(function (candidate) {
						if (candidate !== listener)
							nextListeners.push(candidate);
					});
					uiState.shellListeners = nextListeners;
				};
			},
			refreshServiceStatus: async function () {
				var hostState = await self.refreshNativeHostState(uiState);

				return {
					isRunning: hostState.status === 'running'
				};
			},
			refreshHostState: async function () {
				return self.refreshNativeHostState(uiState);
			},
			getUsageSummary: async function (appId) {
				return self.loadNativeUsageSummary(appId || uiState.selectedApp);
			},
			getProviderStats: async function (appId) {
				return self.loadNativeProviderStats(appId || uiState.selectedApp);
			},
			getRecentActivity: async function (appId) {
				return self.loadNativeRecentActivity(appId || uiState.selectedApp);
			},
			saveHostConfig: async function (payload) {
				return self.saveNativeHostConfig(uiState, payload);
			},
			showMessage: function (kind, text) {
				self.setMessage(uiState, kind, text);
				self.notifyShellListeners(uiState);
			},
			clearMessage: function () {
				self.clearMessage(uiState);
				self.notifyShellListeners(uiState);
			},
			restartService: async function () {
				return self.restartServiceFromNativeShellBridge(uiState);
			}
		};
	},

	normalizeMountHandle: function (handle) {
		if (typeof handle === 'function')
			return handle;

		if (handle && typeof handle.unmount === 'function')
			return function () { handle.unmount(); };

		return function () {};
	},

	teardownSharedProviderUi: function (uiState) {
		if (!uiState.mountHandle)
			return;

		try {
			uiState.mountHandle();
		} catch (e) {
			/* no-op */
		}

		uiState.mountHandle = null;
	},

	loadSharedProviderBundle: function () {
		var self = this;
		var existingApi = window[SHARED_PROVIDER_UI_GLOBAL_KEY];
		var existingScript;
		var existingStylesheet;

		if (existingApi && typeof existingApi.mount === 'function')
			return Promise.resolve(existingApi);

		if (this._sharedProviderBundlePromise)
			return this._sharedProviderBundlePromise;

		existingStylesheet = document.getElementById(SHARED_PROVIDER_UI_STYLE_ID);
		if (!existingStylesheet) {
			existingStylesheet = document.createElement('link');
			existingStylesheet.id = SHARED_PROVIDER_UI_STYLE_ID;
			existingStylesheet.rel = 'stylesheet';
			existingStylesheet.href = self.getBundleStylePath();
			document.head.appendChild(existingStylesheet);
		}

		existingScript = document.getElementById(SHARED_PROVIDER_UI_SCRIPT_ID);
		this._sharedProviderBundlePromise = new Promise(function (resolve, reject) {
			var script = existingScript || document.createElement('script');
			var finish = function () {
				var api = window[SHARED_PROVIDER_UI_GLOBAL_KEY];

				if (api && typeof api.mount === 'function')
					resolve(api);
				else
					reject(new Error(_('The shared provider bundle did not register a mount API.')));
			};

			if (!existingScript) {
				script.id = SHARED_PROVIDER_UI_SCRIPT_ID;
				script.src = self.getBundleAssetPath();
				script.async = true;
				document.head.appendChild(script);
			}

			script.addEventListener('load', finish, { once: true });
			script.addEventListener('error', function () {
				reject(new Error(_('The shared provider bundle could not be loaded from ') + self.getBundleAssetPath()));
			}, { once: true });

			if (existingScript && existingScript.getAttribute('data-ccswitch-loaded') === '1')
				finish();
		}).then(function (api) {
			var loadedScript = document.getElementById(SHARED_PROVIDER_UI_SCRIPT_ID);

			if (loadedScript)
				loadedScript.setAttribute('data-ccswitch-loaded', '1');

			return api;
		}).catch(function (err) {
			self._sharedProviderBundlePromise = null;
			throw err;
		});

			return this._sharedProviderBundlePromise;
		},

	renderNativePage: function (data) {
		var self = this;
		var selectedApp = this.getSelectedApp();
		var hostBindings = this.getStaticPrototypeBindings(data || []);
		var uiState = this.createUiState(hostBindings.status === 'running', selectedApp);
		var wrapper = E('div', {
			'id': 'ccswitch-openwrt-native-page-root'
		});

		this.setNativeHostState(uiState, hostBindings);
		this.clearMessage(uiState);

		wrapper.appendChild(this.createInlineStateNotice(
			'info',
			null,
			_('Loading the OpenWrt-native workspace...')
		));

		window.setTimeout(function () {
			self.loadSharedProviderBundle().then(function (api) {
				var handle;

				if (!api || typeof api.mountPage !== 'function') {
					throw new Error(_('The shared provider bundle did not register a page-shell mount API.'));
				}

				while (wrapper.firstChild)
					wrapper.removeChild(wrapper.firstChild);

				return Promise.resolve(api.mountPage({
					target: wrapper,
					transport: self.createProviderTransport(),
					shell: self.createNativePageShellBridge(uiState)
				})).then(function (mountedHandle) {
					handle = mountedHandle;
					uiState.mountHandle = self.normalizeMountHandle(handle);
				});
			}).catch(function (err) {
				while (wrapper.firstChild)
					wrapper.removeChild(wrapper.firstChild);

				wrapper.appendChild(self.createInlineStateNotice(
					'error',
					_('Native page shell unavailable'),
					self.rpcFailureMessage(err) || _('The OpenWrt-native page shell failed to load. Reinstall the package or refresh the page after updating the browser bundle.')
				));
			});
		}, 0);

		return wrapper;
	},

	render: function (data) {
		return Promise.resolve(this.renderNativePage(data));
	}
});
