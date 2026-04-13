'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

var DEFAULT_TOKEN_FIELD = 'ANTHROPIC_AUTH_TOKEN';
var ALT_TOKEN_FIELD = 'ANTHROPIC_API_KEY';
var CODEX_TOKEN_FIELD = 'OPENAI_API_KEY';
var GEMINI_TOKEN_FIELD = 'GEMINI_API_KEY';
var APP_STORAGE_KEY = 'ccswitch-openwrt-selected-app';
var SHARED_PROVIDER_UI_CUTOVER_MODE_STORAGE_KEY = 'ccswitch-openwrt-provider-ui-cutover-mode';
var SHARED_PROVIDER_UI_CUTOVER_MODE_FALLBACK = 'fallback';
var SHARED_PROVIDER_UI_DISABLE_GLOBAL_KEY = '__CCSWITCH_OPENWRT_DISABLE_REAL_PROVIDER_UI__';
var SHARED_PROVIDER_UI_GLOBAL_KEY = '__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__';
var SHARED_PROVIDER_UI_SCRIPT_ID = 'ccswitch-openwrt-shared-provider-ui-bundle';
var SHARED_PROVIDER_UI_BUNDLE_PATH = '/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js';
var SHARED_PROVIDER_UI_FALLBACK_REASON_GATE_DISABLED = 'gate-disabled';
var SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_FAILURE = 'bundle-failure';
var SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_REGRESSION = 'bundle-regression';
var BANNER_COLORS = {
	success: '#256f3a',
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
		manageDescription: _('Manage saved Claude-compatible providers for OpenWrt while keeping the existing service and outbound proxy controls above unchanged.'),
		baseUrlDescription: _('Claude-compatible API endpoint.'),
		baseUrlPlaceholder: 'https://api.anthropic.com',
		tokenDescription: _('Choose which Anthropic token env key this provider should use.'),
		tokenLabel: _('Token'),
		tokenFieldChoices: [DEFAULT_TOKEN_FIELD, ALT_TOKEN_FIELD],
		modelDescription: _('Optional. Leave blank to avoid a forced model override.'),
		modelPlaceholder: _('Optional model override'),
		summaryRunning: _('Claude traffic will use the active saved provider together with the current outbound proxy settings.'),
		summaryInactive: _('Add a Claude-compatible provider below, then activate one when you are ready to route Claude traffic through it.'),
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
		manageDescription: _('Manage saved Codex / OpenAI Responses providers for OpenWrt while keeping the existing service and outbound proxy controls above unchanged.'),
		baseUrlDescription: _('OpenAI-compatible Responses endpoint for Codex traffic.'),
		baseUrlPlaceholder: 'https://api.openai.com/v1',
		tokenDescription: _('Codex providers use OPENAI_API_KEY.'),
		tokenLabel: _('API Key'),
		tokenFieldChoices: [CODEX_TOKEN_FIELD],
		modelDescription: _('Optional. Leave blank to keep the current or default Codex model.'),
		modelPlaceholder: 'gpt-5.4',
		summaryRunning: _('Codex traffic will use the active saved provider together with the current outbound proxy settings.'),
		summaryInactive: _('Add a Codex provider below, then activate one when you are ready to route Codex traffic through it.'),
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
		manageDescription: _('Manage saved Gemini-compatible providers for OpenWrt while keeping the existing service and outbound proxy controls above unchanged.'),
		baseUrlDescription: _('Gemini-compatible API endpoint.'),
		baseUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
		tokenDescription: _('Gemini providers use GEMINI_API_KEY. This can also hold OAuth access-token JSON when needed.'),
		tokenLabel: _('Credential'),
		tokenFieldChoices: [GEMINI_TOKEN_FIELD],
		modelDescription: _('Optional. Leave blank to keep the current or default Gemini model.'),
		modelPlaceholder: 'gemini-3.1-pro',
		summaryRunning: _('Gemini traffic will use the active saved provider together with the current outbound proxy settings.'),
		summaryInactive: _('Add a Gemini provider below, then activate one when you are ready to route Gemini traffic through it.'),
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

var callListProviders = rpc.declare({
	object: 'ccswitch',
	method: 'list_providers',
	params: ['app'],
	expect: { '': {} }
});

var callListSavedProviders = rpc.declare({
	object: 'ccswitch',
	method: 'list_saved_providers',
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

var callSaveProvider = rpc.declare({
	object: 'ccswitch',
	method: 'save_provider',
	params: ['app', 'provider'],
	expect: { '': {} }
});

var callUpsertProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_provider',
	params: ['app', 'provider_id', 'provider'],
	expect: { '': {} }
});

var callUpsertProviderById = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_provider',
	params: ['app', 'id', 'provider'],
	expect: { '': {} }
});

var callDeleteProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'delete_provider',
	params: ['app', 'provider_id'],
	expect: { '': {} }
});

var callDeleteProviderById = rpc.declare({
	object: 'ccswitch',
	method: 'delete_provider',
	params: ['app', 'id'],
	expect: { '': {} }
});

var callActivateProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'activate_provider',
	params: ['app', 'provider_id'],
	expect: { '': {} }
});

var callActivateProviderById = rpc.declare({
	object: 'ccswitch',
	method: 'activate_provider',
	params: ['app', 'id'],
	expect: { '': {} }
});

var callSwitchProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'switch_provider',
	params: ['app', 'provider_id'],
	expect: { '': {} }
});

var callSwitchProviderById = rpc.declare({
	object: 'ccswitch',
	method: 'switch_provider',
	params: ['app', 'id'],
	expect: { '': {} }
});

var callRestartService = rpc.declare({
	object: 'ccswitch',
	method: 'restart_service',
	expect: { '': {} }
});

return view.extend({
	load: function () {
		return Promise.all([
			uci.load('ccswitch'),
			L.resolveDefault(callServiceList('ccswitch'), {}),
			this.loadProviderState(this.getSelectedApp())
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

	getSharedProviderUiCutoverMode: function () {
		var storedMode = localStorage.getItem(SHARED_PROVIDER_UI_CUTOVER_MODE_STORAGE_KEY);

		if (storedMode === SHARED_PROVIDER_UI_CUTOVER_MODE_FALLBACK)
			return SHARED_PROVIDER_UI_CUTOVER_MODE_FALLBACK;

		if (typeof window !== 'undefined' && window[SHARED_PROVIDER_UI_DISABLE_GLOBAL_KEY] === true)
			return SHARED_PROVIDER_UI_CUTOVER_MODE_FALLBACK;

		return 'real';
	},

	isSharedProviderUiDisabledByCutoverGate: function () {
		return this.getSharedProviderUiCutoverMode() === SHARED_PROVIDER_UI_CUTOVER_MODE_FALLBACK;
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
		if (typeof payload !== 'string')
			return null;

		try {
			return JSON.parse(payload);
		} catch (e) {
			return null;
		}
	},

	parseProviderState: function (providerResponse, appId) {
		var parsed = null;

		if (providerResponse && providerResponse.ok === true && providerResponse.provider_json)
			parsed = this.parseJsonString(providerResponse.provider_json);

		if (!parsed && providerResponse && providerResponse.provider)
			parsed = providerResponse.provider;

		if (!parsed)
			return this.emptyProviderView(appId);

		return this.normalizeProviderView(parsed, null, null, appId);
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
			L.resolveDefault(callListProviders(appId), null),
			L.resolveDefault(callListSavedProviders(appId), null),
			L.resolveDefault(callGetActiveProvider(appId), { ok: false })
		]).then(L.bind(function (results) {
			var activeProvider = this.parseProviderState(results[2], appId);
			var phase2State = this.parsePhase2ProviderState(results[0], activeProvider, appId) ||
				this.parsePhase2ProviderState(results[1], activeProvider, appId);

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
			mountHandle: null,
			mountRequestId: 0,
			runtimeMountHandle: null,
			runtimeMountRequestId: 0
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

	renderMessageBanner: function (message) {
		if (!message || !message.text)
			return E('div', { 'style': 'display:none' });

		return E('div', {
			'style': [
				'margin-bottom:1rem',
				'padding:0.75rem 1rem',
				'border-left:4px solid ' + (BANNER_COLORS[message.kind] || BANNER_COLORS.info),
				'background:#f8fafc',
				'color:' + (BANNER_COLORS[message.kind] || BANNER_COLORS.info)
			].join(';')
		}, [message.text]);
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

	createStatusPanel: function (uiState) {
		var appMeta = this.getAppMeta(uiState.selectedApp);
		var serviceValue = E('strong');
		var appValue = E('strong');
		var bundleValue = E('strong');
		var providerTitle = E('label', { 'class': 'cbi-value-title' }, [appMeta.activeProviderLabel]);
		var providerValue = E('strong');
		var savedCountValue = E('strong');
		var summaryValue = E('span', { 'style': 'color:#4b5563' });
		var root = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [_('Status')]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [_('Service')]),
				E('div', { 'class': 'cbi-value-field' }, [serviceValue])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [_('Selected Application')]),
				E('div', { 'class': 'cbi-value-field' }, [appValue])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [_('Shared Provider UI')]),
				E('div', { 'class': 'cbi-value-field' }, [bundleValue])
			]),
			E('div', { 'class': 'cbi-value' }, [
				providerTitle,
				E('div', { 'class': 'cbi-value-field' }, [providerValue])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [_('Saved Providers')]),
				E('div', { 'class': 'cbi-value-field' }, [savedCountValue])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [_('Routing Summary')]),
				E('div', { 'class': 'cbi-value-field' }, [summaryValue])
			])
		]);
		var nodes = {
				root: root,
				serviceValue: serviceValue,
				appValue: appValue,
				bundleValue: bundleValue,
				providerTitle: providerTitle,
				providerValue: providerValue,
				savedCountValue: savedCountValue,
				summaryValue: summaryValue
			};

		this.updateStatusPanel(nodes, uiState);

		return nodes;
	},

	updateStatusPanel: function (nodes, uiState) {
		var appMeta = this.getAppMeta(uiState.selectedApp);
		var providerState = uiState.providerState || this.buildLegacyProviderState(this.emptyProviderView(uiState.selectedApp), uiState.selectedApp);
		var activeProvider = providerState.activeProvider || this.emptyProviderView(uiState.selectedApp);
		var bundleText;
		var summaryText;

		nodes.serviceValue.textContent = uiState.isRunning ? _('Running') : _('Stopped');
		nodes.serviceValue.style.color = uiState.isRunning ? '#256f3a' : '#b91c1c';
		nodes.appValue.textContent = appMeta.label;
		nodes.providerTitle.textContent = appMeta.activeProviderLabel;

		if (uiState.bundleStatus === 'ready') {
			bundleText = _('Ready');
			nodes.bundleValue.style.color = '#256f3a';
		} else if (uiState.bundleStatus === 'fallback') {
			bundleText = _('Fallback');
			nodes.bundleValue.style.color = '#d97706';
		} else if (uiState.bundleStatus === 'loading') {
			bundleText = _('Loading');
			nodes.bundleValue.style.color = '#1d4ed8';
		} else if (uiState.bundleStatus === 'error') {
			bundleText = _('Unavailable');
			nodes.bundleValue.style.color = '#b91c1c';
		} else {
			bundleText = _('Pending');
			nodes.bundleValue.style.color = '#6b7280';
		}

		nodes.bundleValue.textContent = bundleText;
		if (uiState.bundleStatus === 'ready') {
			nodes.providerValue.textContent = _('Managed by shared UI');
			nodes.savedCountValue.textContent = '\u2014';
		} else {
			nodes.providerValue.textContent = activeProvider.configured ? activeProvider.name : _('Not configured');
			nodes.savedCountValue.textContent = String(providerState.providers.length);
		}

		if (uiState.bundleStatus === 'error')
			summaryText = _('The shared provider manager failed to load or mount, so the guarded LuCI fallback provider manager is active below.');
		else if (uiState.bundleStatus === 'fallback' &&
			uiState.fallbackReason === SHARED_PROVIDER_UI_FALLBACK_REASON_GATE_DISABLED)
			summaryText = _('The shared provider manager is explicitly disabled by the Phase 5 cutover gate, so the guarded LuCI fallback provider manager is active below.');
		else if (uiState.bundleStatus === 'fallback' &&
			uiState.fallbackReason === SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_REGRESSION)
			summaryText = _('The shared provider bundle loaded without provider-manager support, so the guarded LuCI fallback provider manager is active below.');
		else if (uiState.bundleStatus === 'fallback')
			summaryText = _('The guarded LuCI fallback provider manager is active below.');
		else if (uiState.bundleStatus === 'ready')
			summaryText = uiState.isRunning
				? _('Provider changes may require a service restart while the router proxy is running.')
				: _('Provider changes will take effect when the router proxy starts.');
		else if (!providerState.phase2Available)
			summaryText = activeProvider.configured
				? _('This build is using the Phase 1 active-provider bridge. Multi-provider actions will appear after the backend Phase 2 RPCs land.')
				: _('Save the first provider below, then start or restart the service.');
		else if (activeProvider.configured)
			summaryText = appMeta.summaryRunning;
		else if (providerState.providers.length)
			summaryText = _('Saved providers are available, but none is active yet. Activate one below when you are ready to switch routing.');
		else
			summaryText = appMeta.summaryInactive;

		nodes.summaryValue.textContent = summaryText;
	},

	createProviderShell: function (uiState, statusNodes) {
		var self = this;
		var messageRoot = E('div', { 'style': 'display:none;margin-bottom:1rem' });
		var messageText = E('div');
		var restartButton = E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'type': 'button',
			'click': ui.createHandlerFn(this, async function (ev) {
				ev.preventDefault();
				await self.restartServiceFromShellBridge(uiState, statusNodes, shellNodes);
			})
		}, [_('Restart Service')]);
		var sharedChromeRoot = E('div');
		var runtimeMountRoot = E('div', {
			'id': 'ccswitch-shared-runtime-surface-root',
			'style': 'margin-top:1rem'
		});
		var mountRoot = E('div', {
			'id': 'ccswitch-shared-provider-ui-root',
			'style': 'margin-top:1rem'
		});
		var shellNodes = {
			sharedChromeRoot: sharedChromeRoot,
			messageRoot: messageRoot,
			messageText: messageText,
			restartButton: restartButton,
			runtimeMountRoot: runtimeMountRoot,
			mountRoot: mountRoot,
			root: null
		};
		var root = E('div', { 'class': 'cbi-section' }, [
			sharedChromeRoot,
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [_('Runtime Status')]),
				E('p', { 'style': 'margin-bottom:1rem;color:#4b5563' }, [
					_('The shared OpenWrt browser bundle mounts a read-only runtime and failover surface here. Service settings, outbound proxy controls, and restart actions remain in the LuCI shell.')
				]),
				runtimeMountRoot
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [_('Provider Manager')]),
				E('p', { 'style': 'margin-bottom:1rem;color:#4b5563' }, [
					_('The shared OpenWrt browser bundle is the primary provider-manager path below. The LuCI fallback provider manager remains available only when the Phase 5 cutover gate disables the real bundle or the bundle fails router verification.')
				]),
				E('div', { 'class': 'cbi-value-description' }, [
					_('Service settings and outbound proxy controls remain above in the LuCI shell. Provider management mounts below after this page renders.')
				]),
				mountRoot
			])
		]);

		shellNodes.root = root;
		sharedChromeRoot.appendChild(messageRoot);
		sharedChromeRoot.appendChild(E('div', { 'class': 'cbi-page-actions', 'style': 'margin-bottom:1rem' }, [
			restartButton
		]));
		messageRoot.appendChild(messageText);
		this.setProviderShellMode(shellNodes, 'shared');
		this.updateProviderShell(shellNodes, uiState);

		return shellNodes;
	},

	setProviderShellMode: function (shellNodes, mode) {
		shellNodes.sharedChromeRoot.style.display = '';
	},

	updateMessageBanner: function (messageRoot, messageText, message) {
		if (!message || !message.text) {
			messageRoot.style.display = 'none';
			messageRoot.style.borderLeft = '';
			messageRoot.style.background = '';
			messageRoot.style.color = '';
			messageText.textContent = '';
			return;
		}

		messageRoot.style.display = '';
		messageRoot.style.padding = '0.75rem 1rem';
		messageRoot.style.borderLeft = '4px solid ' + (BANNER_COLORS[message.kind] || BANNER_COLORS.info);
		messageRoot.style.background = '#f8fafc';
		messageRoot.style.color = BANNER_COLORS[message.kind] || BANNER_COLORS.info;
		messageText.textContent = message.text;
	},

	updateProviderShell: function (shellNodes, uiState) {
		shellNodes.restartButton.disabled = !!uiState.busy;
		this.updateMessageBanner(shellNodes.messageRoot, shellNodes.messageText, uiState.message);
	},

	updateShellChrome: function (uiState, statusNodes, shellNodes) {
		this.updateStatusPanel(statusNodes, uiState);
		this.updateProviderShell(shellNodes, uiState);
	},

	renderAppSelector: function (uiState, root, statusNodes) {
		var self = this;
		var select = E('select', { 'class': 'cbi-input-select' });
		var i;

		for (i = 0; i < APP_OPTIONS.length; i++) {
			select.appendChild(E('option', {
				'value': APP_OPTIONS[i].id,
				'selected': APP_OPTIONS[i].id === uiState.selectedApp ? 'selected' : null
			}, [APP_OPTIONS[i].label]));
		}

		select.addEventListener('change', function () {
			self.handleSwitchApp(root, uiState, statusNodes, select.value);
		});

		return this.renderValue(_('Application'), select, _('Choose which CLI tool provider set to manage on this router.'));
	},

	renderCompatibilityNotice: function () {
		return E('div', {
			'style': 'margin-bottom:1rem;padding:0.75rem 1rem;border-left:4px solid #d97706;background:#fff7ed;color:#9a3412'
		}, [
			_('Phase 2 LuCI UI is ready, but this build only exposes the Phase 1 active-provider RPCs. Add/edit still works for the active provider; saved-provider add/delete/activate depends on the backend and ubus bridge slices landing first.')
		]);
	},

	renderProviderBadge: function (text, style) {
		return E('span', {
			'style': [
				'display:inline-block',
				'margin-left:0.5rem',
				'padding:0.15rem 0.45rem',
				'border-radius:999px',
				'font-size:0.85em',
				'font-weight:600',
				style || ''
			].join(';')
		}, [text]);
	},

	renderProviderMetaRow: function (label, value) {
		return E('div', { 'style': 'margin-top:0.3rem;color:#4b5563' }, [
			E('strong', {}, [label + ': ']),
			E('span', { 'style': 'word-break:break-all' }, [value])
		]);
	},

	renderProviderCard: function (provider, uiState, root, statusNodes) {
		var self = this;
		var headerChildren = [E('strong', {}, [provider.name || _('Unnamed provider')])];
		var actionChildren = [];
		var detailsChildren = [];
		var tokenSummary = provider.tokenConfigured
			? provider.tokenMasked + ' (' + provider.tokenField + ')'
			: _('Not stored');

		if (provider.active)
			headerChildren.push(this.renderProviderBadge(_('Active'), 'background:#dcfce7;color:#166534'));

		if (!provider.tokenConfigured)
			headerChildren.push(this.renderProviderBadge(_('No token'), 'background:#fee2e2;color:#991b1b'));

		if (uiState.providerState.phase2Available) {
			actionChildren.push(E('button', {
				'class': 'btn cbi-button',
				'type': 'button',
				'disabled': uiState.busy ? 'disabled' : null,
				'click': ui.createHandlerFn(this, function (ev) {
					ev.preventDefault();
					self.setEditorModeEdit(uiState, provider.providerId);
					self.clearMessage(uiState);
					self.rerenderManager(root, uiState, statusNodes);
				})
			}, [_('Edit')]));

			if (!provider.active) {
				actionChildren.push(E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'type': 'button',
					'style': 'margin-left:0.5rem',
					'disabled': uiState.busy ? 'disabled' : null,
					'click': ui.createHandlerFn(this, async function (ev) {
						ev.preventDefault();
						await self.handleActivateProvider(root, uiState, statusNodes, provider.providerId);
					})
				}, [_('Activate')]));
			}

			actionChildren.push(E('button', {
				'class': 'btn cbi-button',
				'type': 'button',
				'style': 'margin-left:0.5rem',
				'disabled': uiState.busy ? 'disabled' : null,
				'click': ui.createHandlerFn(this, async function (ev) {
					ev.preventDefault();
					await self.handleDeleteProvider(root, uiState, statusNodes, provider);
				})
			}, [_('Delete')]));
		}

		detailsChildren.push(this.renderProviderMetaRow(_('Token'), tokenSummary));
		detailsChildren.push(this.renderProviderMetaRow(_('Model'), provider.model || _('Not forced')));
		if (provider.notes)
			detailsChildren.push(this.renderProviderMetaRow(_('Notes'), provider.notes));

		return E('div', {
			'style': [
				'margin-bottom:0.75rem',
				'padding:0.85rem 1rem',
				'border:1px solid ' + (provider.active ? '#86efac' : '#dbe1ea'),
				'border-radius:6px',
				'background:' + (provider.active ? '#f0fdf4' : '#ffffff')
			].join(';')
		}, [
			E('div', {
				'style': 'display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap'
			}, [
				E('div', {}, headerChildren),
				E('div', { 'style': 'white-space:nowrap' }, actionChildren)
			]),
			E('div', { 'style': 'margin-top:0.4rem;color:#4b5563;word-break:break-all' }, [
				provider.baseUrl || _('No Base URL set')
			]),
			E('div', { 'style': 'margin-top:0.45rem' }, detailsChildren)
		]);
	},

	renderProviderList: function (uiState, root, statusNodes) {
		var appMeta = this.getAppMeta(uiState.selectedApp);
		var self = this;
		var children = [];

		children.push(E('h4', { 'style': 'margin:0 0 0.75rem 0' }, [appMeta.providerLabel]));

		if (!uiState.providerState.providers.length) {
			children.push(E('p', { 'style': 'margin:0;color:#4b5563' }, [
				uiState.providerState.phase2Available
					? _('No saved providers yet. Add one below, then activate it when ready.')
					: _('No provider is configured yet.')
			]));
			return E('div', { 'style': 'margin-bottom:1.25rem' }, children);
		}

		uiState.providerState.providers.forEach(function (provider) {
			children.push(self.renderProviderCard(provider, uiState, root, statusNodes));
		});

		return E('div', { 'style': 'margin-bottom:1.25rem' }, children);
	},

	renderEditorSection: function (uiState, root, statusNodes) {
		var appMeta = this.getAppMeta(uiState.selectedApp);
		var self = this;
		var editingProvider = this.getEditorProvider(uiState);
		var payload = this.providerToEditorPayload(editingProvider, uiState.selectedApp);
		var presetId = this.inferPresetIdFromPayload(uiState.selectedApp, payload);
		var title;
		var description;
		var presetSelect;
		var presetDescriptionNode = E('div', { 'class': 'cbi-value-description' }, [
			_('Use a preset to prefill the fields below. You can continue editing after selection.')
		]);
		var tokenHint = E('div', { 'class': 'cbi-value-description' }, [
			editingProvider.tokenConfigured
				? _('Stored credential: ') + editingProvider.tokenMasked
				: _('No credential stored yet.')
		]);
		var nameInput;
		var baseUrlInput;
		var tokenFieldSelect;
		var tokenInput;
		var modelInput;
		var notesInput;
		var actionChildren = [];

		if (!uiState.providerState.phase2Available) {
			title = editingProvider.configured ? appMeta.activeProviderLabel : _('Configure Provider');
			description = editingProvider.configured
				? _('This compatibility editor updates the active provider only until the multi-provider backend slice lands.')
				: _('Save the first provider here. Once the backend app-aware RPCs land, this page will expand into a full saved-provider manager.');
		} else if (uiState.editorMode === 'edit') {
			title = _('Edit Saved Provider');
			description = _('Leave the credential blank to keep the stored secret. Saving does not automatically activate a different provider.');
		} else {
			title = _('Add Saved Provider');
			description = appMeta.summaryInactive;
		}

		nameInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': appMeta.newProviderExample,
			'value': payload.name
		});

		baseUrlInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'url',
			'placeholder': appMeta.baseUrlPlaceholder,
			'value': payload.baseUrl
		});

		presetSelect = E('select', {
			'class': 'cbi-input-select'
		});
		presetSelect.appendChild(E('option', {
			'value': 'custom',
			'selected': presetId === 'custom' ? 'selected' : null
		}, [_('Custom')]));
		this.getPresetOptions(uiState.selectedApp).forEach(function (preset) {
			presetSelect.appendChild(E('option', {
				'value': preset.id,
				'selected': preset.id === presetId ? 'selected' : null
			}, [preset.label]));
		});
		this.updatePresetDescription(presetDescriptionNode, uiState.selectedApp, presetId);

		tokenFieldSelect = E('select', {
			'class': 'cbi-input-select',
			'disabled': appMeta.tokenFieldChoices.length === 1 ? 'disabled' : null
		});
		appMeta.tokenFieldChoices.forEach(function (choice) {
			tokenFieldSelect.appendChild(E('option', {
				'value': choice,
				'selected': payload.tokenField === choice || (!payload.tokenField && choice === appMeta.tokenFieldChoices[0]) ? 'selected' : null
			}, [choice]));
		});
		presetSelect.addEventListener('change', function () {
			self.applyPresetToInputs(uiState.selectedApp, presetSelect.value, {
				nameInput: nameInput,
				baseUrlInput: baseUrlInput,
				tokenFieldSelect: tokenFieldSelect,
				modelInput: modelInput,
				presetDescriptionNode: presetDescriptionNode
			});
		});

		tokenInput = E('input', {
			'class': 'cbi-input-password',
			'type': 'password',
			'autocomplete': 'off',
			'placeholder': editingProvider.tokenConfigured
				? _('Leave blank to keep the stored credential')
				: _('Enter credential')
		});

		modelInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': appMeta.modelPlaceholder,
			'value': payload.model
		});

		notesInput = E('textarea', {
			'class': 'cbi-input-textarea',
			'rows': '3',
			'placeholder': _('Optional notes')
		}, [payload.notes]);

		actionChildren.push(E('button', {
			'class': 'btn cbi-button cbi-button-save',
			'type': 'button',
			'disabled': uiState.busy ? 'disabled' : null,
			'click': ui.createHandlerFn(this, async function (ev) {
				ev.preventDefault();
				await self.handleSaveProvider(root, uiState, statusNodes, {
					nameInput: nameInput,
					baseUrlInput: baseUrlInput,
					tokenFieldSelect: tokenFieldSelect,
					tokenInput: tokenInput,
					modelInput: modelInput,
					notesInput: notesInput
				});
			})
		}, [uiState.editorMode === 'edit' ? _('Save Changes') : _('Save Provider')]));

		if (uiState.providerState.phase2Available && uiState.editorMode === 'edit') {
			actionChildren.push(E('button', {
				'class': 'btn cbi-button',
				'type': 'button',
				'style': 'margin-left:0.75rem',
				'disabled': uiState.busy ? 'disabled' : null,
				'click': ui.createHandlerFn(this, function (ev) {
					ev.preventDefault();
					self.setEditorModeNew(uiState);
					self.clearMessage(uiState);
					self.rerenderManager(root, uiState, statusNodes);
				})
			}, [_('Cancel')]));
		}

		return E('div', { 'class': 'cbi-section' }, [
			E('h4', { 'style': 'margin-top:0' }, [title]),
			E('p', { 'style': 'margin-bottom:1rem;color:#4b5563' }, [description]),
			this.renderValue(_('Preset'), presetSelect, presetDescriptionNode),
			this.renderValue(_('Name'), nameInput, appMeta.editorNameDescription),
			this.renderValue(_('Base URL'), baseUrlInput, appMeta.baseUrlDescription),
			this.renderValue(_('Token Field'), tokenFieldSelect, appMeta.tokenDescription),
			this.renderValue(appMeta.tokenLabel, tokenInput, tokenHint),
			this.renderValue(_('Model'), modelInput, appMeta.modelDescription),
			this.renderValue(_('Notes'), notesInput, _('Optional notes stored with this provider.')),
			E('div', { 'class': 'cbi-page-actions' }, actionChildren)
		]);
	},

	renderManagerActions: function (uiState, root, statusNodes) {
		var self = this;
		var actions = [];

		if (uiState.providerState.phase2Available) {
			actions.push(E('button', {
				'class': 'btn cbi-button',
				'type': 'button',
				'disabled': uiState.busy ? 'disabled' : null,
				'click': ui.createHandlerFn(this, function (ev) {
					ev.preventDefault();
					self.setEditorModeNew(uiState);
					self.clearMessage(uiState);
					self.rerenderManager(root, uiState, statusNodes);
				})
			}, [_('Add Provider')]));
		}

		actions.push(E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'type': 'button',
			'style': uiState.providerState.phase2Available ? 'margin-left:0.75rem' : '',
			'disabled': uiState.busy ? 'disabled' : null,
			'click': ui.createHandlerFn(this, async function (ev) {
				ev.preventDefault();
				await self.handleRestartService(root, uiState, statusNodes);
			})
		}, [_('Restart Service')]));

		return E('div', { 'class': 'cbi-page-actions', 'style': 'margin-bottom:1rem' }, actions);
	},

	renderProviderManagerContent: function (root, uiState, statusNodes) {
		var appMeta = this.getAppMeta(uiState.selectedApp);

		return E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [appMeta.providerLabel]),
				E('p', { 'style': 'margin-bottom:1rem;color:#4b5563' }, [
					appMeta.manageDescription
				]),
				this.renderAppSelector(uiState, root, statusNodes),
				this.renderMessageBanner(uiState.message),
				!uiState.providerState.phase2Available ? this.renderCompatibilityNotice() : E('div', { 'style': 'display:none' }),
				this.renderManagerActions(uiState, root, statusNodes),
				this.renderProviderList(uiState, root, statusNodes),
				this.renderEditorSection(uiState, root, statusNodes)
			])
		]);
	},

	rerenderManager: function (root, uiState, statusNodes) {
		while (root.firstChild)
			root.removeChild(root.firstChild);

		this.updateStatusPanel(statusNodes, uiState);
		root.appendChild(this.renderProviderManagerContent(root, uiState, statusNodes));
	},

	collectProviderPayload: function (refs) {
		return {
			name: refs.nameInput.value.trim(),
			baseUrl: refs.baseUrlInput.value.trim(),
			tokenField: refs.tokenFieldSelect.value,
			token: refs.tokenInput.value,
			model: refs.modelInput.value.trim(),
			notes: refs.notesInput.value.trim()
		};
	},

	validateProviderPayload: function (payload, existingProvider, appId) {
		var appMeta = this.getAppMeta(appId || 'claude');

		if (!payload.name)
			return _('Provider name is required.');

		if (!payload.baseUrl)
			return _('Base URL is required.');

		if (!payload.token && !(existingProvider && existingProvider.tokenConfigured))
			return appMeta.tokenRequiredMessage;

		if (appMeta.tokenFieldChoices.indexOf(payload.tokenField) < 0)
			return _('Unsupported token field.');

		return null;
	},

	refreshServiceState: function () {
		return L.resolveDefault(callServiceList('ccswitch'), {}).then(L.bind(function (serviceStatus) {
			return this.parseServiceState(serviceStatus);
		}, this));
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
					call: function () { return callUpsertProviderByProviderId(appId, providerId, providerPayload); },
					compatibilityFallback: true
				},
				{
					call: function () { return callUpsertProviderById(appId, providerId, providerPayload); },
					compatibilityFallback: true
				}
			], missingMessage);
		}

		return this.invokeRpcCandidates([
			{
				call: function () { return callUpsertProvider(appId, providerPayload); },
				compatibilityFallback: true
			},
			{
				call: function () { return callSaveProvider(appId, providerPayload); },
				compatibilityFallback: true
			}
		], missingMessage);
	},

	invokePhase2Delete: function (appId, providerId) {
		return this.invokeRpcCandidates([
			{
				call: function () { return callDeleteProviderByProviderId(appId, providerId); },
				compatibilityFallback: true
			},
			{
				call: function () { return callDeleteProviderById(appId, providerId); },
				compatibilityFallback: true
			}
		], _('The Phase 2 provider delete RPC is not available in this build.'));
	},

	invokePhase2Activate: function (appId, providerId) {
		return this.invokeRpcCandidates([
			{
				call: function () { return callActivateProviderByProviderId(appId, providerId); },
				compatibilityFallback: true
			},
			{
				call: function () { return callActivateProviderById(appId, providerId); },
				compatibilityFallback: true
			},
			{
				call: function () { return callSwitchProviderByProviderId(appId, providerId); },
				compatibilityFallback: true
			},
			{
				call: function () { return callSwitchProviderById(appId, providerId); },
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

	handleSwitchApp: async function (root, uiState, statusNodes, appId) {
		var refreshed;

		uiState.busy = true;
		uiState.selectedApp = appId;
		this.saveSelectedApp(appId);
		this.setEditorModeNew(uiState);
		this.setMessage(uiState, 'info', _('Loading provider set...'));
		this.rerenderManager(root, uiState, statusNodes);

		try {
			refreshed = await this.refreshPageState(appId);
			uiState.isRunning = refreshed.isRunning;
			uiState.providerState = refreshed.providerState;
			this.setEditorModeNew(uiState);
			this.clearMessage(uiState);
		} catch (err) {
			this.setMessage(uiState, 'error', err.message || String(err));
		} finally {
			uiState.busy = false;
			this.rerenderManager(root, uiState, statusNodes);
		}
	},

	handleSaveProvider: async function (root, uiState, statusNodes, refs) {
		var payload = this.collectProviderPayload(refs);
		var existingProvider = this.getEditorProvider(uiState);
		var validationError = this.validateProviderPayload(payload, existingProvider, uiState.selectedApp);
		var previousActiveId = uiState.providerState.activeProviderId;
		var editingId = uiState.editorMode === 'edit' ? uiState.editProviderId : null;
		var refreshed;
		var shouldRestart = false;
		var message = _('Provider saved.');

		if (validationError) {
			this.setMessage(uiState, 'error', validationError);
			this.rerenderManager(root, uiState, statusNodes);
			return;
		}

		uiState.busy = true;
		this.setMessage(uiState, 'info', _('Saving provider...'));
		this.rerenderManager(root, uiState, statusNodes);

		try {
			if (uiState.providerState.phase2Available) {
				await this.invokePhase2Upsert(uiState.selectedApp, editingId, payload);
				refreshed = await this.refreshPageState(uiState.selectedApp);
				shouldRestart = refreshed.isRunning && (
					previousActiveId !== refreshed.providerState.activeProviderId ||
					(editingId && editingId === previousActiveId) ||
					(!previousActiveId && !!refreshed.providerState.activeProviderId)
				);
			} else {
				var legacyResult = await L.resolveDefault(callUpsertActiveProvider(uiState.selectedApp, payload), { ok: false });
				if (!this.isRpcSuccess(legacyResult))
					throw new Error(this.rpcError(legacyResult) || _('Failed to save provider.'));

				refreshed = await this.refreshPageState(uiState.selectedApp);
				shouldRestart = refreshed.isRunning;
			}

			if (shouldRestart) {
				await this.restartService();
				refreshed = await this.refreshPageState(uiState.selectedApp);
				message = _('Provider saved and service restarted.');
			}

			uiState.isRunning = refreshed.isRunning;
			uiState.providerState = refreshed.providerState;

			if (!uiState.providerState.phase2Available)
				this.setEditorModeEdit(uiState, uiState.providerState.activeProviderId);
			else if (!editingId || !this.findProviderById(uiState.providerState.providers, editingId))
				this.setEditorModeNew(uiState);

			this.setMessage(uiState, 'success', message);
		} catch (err) {
			this.setMessage(uiState, 'error', err.message || String(err));
		} finally {
			uiState.busy = false;
			this.rerenderManager(root, uiState, statusNodes);
		}
	},

	handleActivateProvider: async function (root, uiState, statusNodes, providerId) {
		var previousActiveId = uiState.providerState.activeProviderId;
		var refreshed;
		var message = _('Provider activated.');

		uiState.busy = true;
		this.setMessage(uiState, 'info', _('Activating provider...'));
		this.rerenderManager(root, uiState, statusNodes);

		try {
			await this.invokePhase2Activate(uiState.selectedApp, providerId);
			refreshed = await this.refreshPageState(uiState.selectedApp);

			if (refreshed.isRunning && previousActiveId !== refreshed.providerState.activeProviderId) {
				await this.restartService();
				refreshed = await this.refreshPageState(uiState.selectedApp);
				message = _('Provider activated and service restarted.');
			}

			uiState.isRunning = refreshed.isRunning;
			uiState.providerState = refreshed.providerState;
			this.setMessage(uiState, 'success', message);
		} catch (err) {
			this.setMessage(uiState, 'error', err.message || String(err));
		} finally {
			uiState.busy = false;
			this.rerenderManager(root, uiState, statusNodes);
		}
	},

	handleDeleteProvider: async function (root, uiState, statusNodes, provider) {
		var previousActiveId = uiState.providerState.activeProviderId;
		var refreshed;
		var message = _('Provider deleted.');

		if (!confirm(_('Delete provider "') + provider.name + _('" ? This cannot be undone.')))
			return;

		uiState.busy = true;
		this.setMessage(uiState, 'info', _('Deleting provider...'));
		this.rerenderManager(root, uiState, statusNodes);

		try {
			await this.invokePhase2Delete(uiState.selectedApp, provider.providerId);
			refreshed = await this.refreshPageState(uiState.selectedApp);

			if (refreshed.isRunning &&
				(provider.providerId === previousActiveId ||
					previousActiveId !== refreshed.providerState.activeProviderId)) {
				await this.restartService();
				refreshed = await this.refreshPageState(uiState.selectedApp);
				message = _('Provider deleted and service restarted.');
			}

			uiState.isRunning = refreshed.isRunning;
			uiState.providerState = refreshed.providerState;

			if (uiState.editProviderId === provider.providerId)
				this.setEditorModeNew(uiState);

			this.setMessage(uiState, 'success', message);
		} catch (err) {
			this.setMessage(uiState, 'error', err.message || String(err));
		} finally {
			uiState.busy = false;
			this.rerenderManager(root, uiState, statusNodes);
		}
	},

	handleRestartService: async function (root, uiState, statusNodes) {
		var refreshed;

		uiState.busy = true;
		this.setMessage(uiState, 'info', _('Restarting service...'));
		this.rerenderManager(root, uiState, statusNodes);

		try {
			await this.restartService();
			refreshed = await this.refreshPageState(uiState.selectedApp);
			uiState.isRunning = refreshed.isRunning;
			uiState.providerState = refreshed.providerState;
			this.setMessage(uiState, 'success', _('Service restarted.'));
		} catch (err) {
			this.setMessage(uiState, 'error', err.message || String(err));
		} finally {
			uiState.busy = false;
			this.rerenderManager(root, uiState, statusNodes);
		}
	},

	createProviderTransport: function () {
		return {
			listProviders: function (appId) {
				return L.resolveDefault(callListProviders(appId), null);
			},
			listSavedProviders: function (appId) {
				return L.resolveDefault(callListSavedProviders(appId), null);
			},
			getActiveProvider: function (appId) {
				return L.resolveDefault(callGetActiveProvider(appId), { ok: false });
			},
			upsertProvider: function (appId, provider) {
				return L.resolveDefault(callUpsertProvider(appId, provider), { ok: false });
			},
			saveProvider: function (appId, provider) {
				return L.resolveDefault(callSaveProvider(appId, provider), { ok: false });
			},
			upsertProviderByProviderId: function (appId, providerId, provider) {
				return L.resolveDefault(callUpsertProviderByProviderId(appId, providerId, provider), { ok: false });
			},
			upsertProviderById: function (appId, providerId, provider) {
				return L.resolveDefault(callUpsertProviderById(appId, providerId, provider), { ok: false });
			},
			upsertActiveProvider: function (appId, provider) {
				return L.resolveDefault(callUpsertActiveProvider(appId, provider), { ok: false });
			},
			deleteProviderByProviderId: function (appId, providerId) {
				return L.resolveDefault(callDeleteProviderByProviderId(appId, providerId), { ok: false });
			},
			deleteProviderById: function (appId, providerId) {
				return L.resolveDefault(callDeleteProviderById(appId, providerId), { ok: false });
			},
			activateProviderByProviderId: function (appId, providerId) {
				return L.resolveDefault(callActivateProviderByProviderId(appId, providerId), { ok: false });
			},
			activateProviderById: function (appId, providerId) {
				return L.resolveDefault(callActivateProviderById(appId, providerId), { ok: false });
			},
			switchProviderByProviderId: function (appId, providerId) {
				return L.resolveDefault(callSwitchProviderByProviderId(appId, providerId), { ok: false });
			},
			switchProviderById: function (appId, providerId) {
				return L.resolveDefault(callSwitchProviderById(appId, providerId), { ok: false });
			},
			restartService: function () {
				return L.resolveDefault(callRestartService(), { ok: false });
			}
		};
	},

	createRuntimeTransport: function () {
		return {
			failoverControlsAvailable: false,
			getRuntimeStatus: function () {
				return L.resolveDefault(callGetRuntimeStatus(), { ok: false });
			},
			getAppRuntimeStatus: function (appId) {
				return L.resolveDefault(callGetAppRuntimeStatus(appId), { ok: false });
			},
			getAvailableFailoverProviders: function (appId) {
				return L.resolveDefault(callGetAvailableFailoverProviders(appId), { ok: false });
			},
			addToFailoverQueue: function (appId, providerId) {
				return L.resolveDefault(callAddToFailoverQueue(appId, providerId), { ok: false });
			},
			removeFromFailoverQueue: function (appId, providerId) {
				return L.resolveDefault(callRemoveFromFailoverQueue(appId, providerId), { ok: false });
			},
			setAutoFailoverEnabled: function (appId, enabled) {
				return L.resolveDefault(callSetAutoFailoverEnabled(appId, enabled), { ok: false });
			}
		};
	},

	createShellBridge: function (uiState, statusNodes, shellNodes) {
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
				self.updateShellChrome(uiState, statusNodes, shellNodes);

				return uiState.selectedApp;
			},
			getServiceStatus: function () {
				return {
					isRunning: uiState.isRunning
				};
			},
			refreshServiceStatus: async function () {
				uiState.isRunning = await self.refreshServiceState();
				self.updateShellChrome(uiState, statusNodes, shellNodes);

				return {
					isRunning: uiState.isRunning
				};
			},
			showMessage: function (kind, text) {
				self.setMessage(uiState, kind, text);
				self.updateShellChrome(uiState, statusNodes, shellNodes);
			},
				clearMessage: function () {
					self.clearMessage(uiState);
					self.updateShellChrome(uiState, statusNodes, shellNodes);
				},
				restartService: async function () {
					return self.restartServiceFromShellBridge(uiState, statusNodes, shellNodes);
				}
			};
		},

	createSharedRuntimeMountOptions: function (shellNodes) {
		return {
			target: shellNodes.runtimeMountRoot,
			transport: this.createRuntimeTransport()
		};
	},

	createSharedProviderMountOptions: function (uiState, statusNodes, shellNodes) {
		return {
			target: shellNodes.mountRoot,
			appId: uiState.selectedApp,
			serviceStatus: {
				isRunning: uiState.isRunning
			},
			transport: this.createProviderTransport(),
			shell: this.createShellBridge(uiState, statusNodes, shellNodes)
		};
	},

	normalizeMountHandle: function (handle) {
		if (typeof handle === 'function')
			return handle;

		if (handle && typeof handle.unmount === 'function')
			return function () { handle.unmount(); };

		return function () {};
	},

	teardownSharedRuntimeSurface: function (uiState) {
		if (!uiState.runtimeMountHandle)
			return;

		try {
			uiState.runtimeMountHandle();
		} catch (e) {
			/* no-op */
		}

		uiState.runtimeMountHandle = null;
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

	showBundleFallback: function (mountRoot, message) {
		while (mountRoot.firstChild)
			mountRoot.removeChild(mountRoot.firstChild);

		mountRoot.appendChild(E('div', {
			'style': 'padding:1rem;border:1px solid #fecaca;background:#fff7f7;color:#991b1b;border-radius:4px'
		}, [
			E('strong', {}, [_('Shared Provider UI unavailable')]),
			E('div', { 'style': 'margin-top:0.5rem' }, [
				message || _('The shared provider manager bundle is missing or failed to initialize.')
			]),
			E('div', { 'style': 'margin-top:0.5rem;color:#7f1d1d' }, [
				_('The OpenWrt-native service settings, proxy controls, and restart actions above still remain functional.')
			])
		]));
	},

	showBundleLoading: function (mountRoot) {
		while (mountRoot.firstChild)
			mountRoot.removeChild(mountRoot.firstChild);

		mountRoot.appendChild(E('div', {
			'style': 'padding:1rem;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:4px'
		}, [_('Loading the shared provider manager...')]));
	},

	showRuntimeSurfaceFallback: function (mountRoot, message) {
		while (mountRoot.firstChild)
			mountRoot.removeChild(mountRoot.firstChild);

		mountRoot.appendChild(E('div', {
			'style': 'padding:1rem;border:1px solid #fecaca;background:#fff7f7;color:#991b1b;border-radius:4px'
		}, [
			E('strong', {}, [_('Runtime surface unavailable')]),
			E('div', { 'style': 'margin-top:0.5rem' }, [
				message || _('The shared runtime surface could not be loaded from the OpenWrt browser bundle.')
			]),
			E('div', { 'style': 'margin-top:0.5rem;color:#7f1d1d' }, [
				_('The LuCI-owned service settings, outbound proxy controls, restart actions, and provider manager below still remain available.')
			])
		]));
	},

	showRuntimeSurfaceLoading: function (mountRoot) {
		while (mountRoot.firstChild)
			mountRoot.removeChild(mountRoot.firstChild);

		mountRoot.appendChild(E('div', {
			'style': 'padding:1rem;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:4px'
		}, [_('Loading the shared runtime surface...')]));
	},

	loadSharedProviderBundle: function () {
		var self = this;
		var existingApi = window[SHARED_PROVIDER_UI_GLOBAL_KEY];
		var existingScript;

		if (existingApi && typeof existingApi.mount === 'function')
			return Promise.resolve(existingApi);

		if (this._sharedProviderBundlePromise)
			return this._sharedProviderBundlePromise;

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

		restartServiceFromShellBridge: async function (uiState, statusNodes, shellNodes) {
			var result;

			uiState.busy = true;
			this.setMessage(uiState, 'info', _('Restarting service...'));
			this.updateShellChrome(uiState, statusNodes, shellNodes);

		try {
			result = await L.resolveDefault(callRestartService(), { ok: false });
			if (!this.isRpcSuccess(result))
				throw new Error(this.rpcFailureMessage(result) || _('Failed to restart service.'));

			uiState.isRunning = await this.refreshServiceState();
			this.setMessage(uiState, 'success', _('Service restarted.'));
		} catch (err) {
			this.setMessage(uiState, 'error', this.rpcFailureMessage(err) || _('Failed to restart service.'));
		} finally {
			uiState.busy = false;
			this.updateShellChrome(uiState, statusNodes, shellNodes);
		}

			return {
				isRunning: uiState.isRunning
			};
		},

	bundleProvidesProviderManager: function (api) {
		return !(api && api.capabilities && api.capabilities.providerManager === false);
	},

	bundleProvidesRuntimeSurface: function (api) {
		return !!(api &&
			typeof api.mountRuntimeSurface === 'function' &&
			!(api.capabilities && api.capabilities.runtimeSurface === false));
	},

	renderFallbackProviderManager: function (uiState, statusNodes, shellNodes, kind, text, bundleStatus, fallbackReason) {
		this.teardownSharedProviderUi(uiState);
		this.setProviderShellMode(shellNodes, 'fallback');
		this.setBundleStatus(uiState, bundleStatus || 'fallback', text || null, fallbackReason || null);

		if (kind && text)
			this.setMessage(uiState, kind, text);
		else if (!kind)
			this.clearMessage(uiState);

		this.updateShellChrome(uiState, statusNodes, shellNodes);
		this.rerenderManager(shellNodes.mountRoot, uiState, statusNodes);
	},

	mountSharedRuntimeSurface: async function (uiState, shellNodes) {
		var requestId;
		var mountOptions;
		var api;
		var handle;

		uiState.runtimeMountRequestId += 1;
		requestId = uiState.runtimeMountRequestId;
		this.teardownSharedRuntimeSurface(uiState);
		this.showRuntimeSurfaceLoading(shellNodes.runtimeMountRoot);

		try {
			api = await this.loadSharedProviderBundle();
			if (requestId !== uiState.runtimeMountRequestId)
				return;

			if (!this.bundleProvidesRuntimeSurface(api)) {
				this.showRuntimeSurfaceFallback(
					shellNodes.runtimeMountRoot,
					_('The shared provider bundle loaded without runtime-surface support, so the OpenWrt runtime panel cannot mount until the bundle contract is restored.')
				);
				return;
			}

			mountOptions = this.createSharedRuntimeMountOptions(shellNodes);
			handle = await Promise.resolve(api.mountRuntimeSurface(mountOptions));
			uiState.runtimeMountHandle = this.normalizeMountHandle(handle);
		} catch (err) {
			if (requestId !== uiState.runtimeMountRequestId)
				return;

			this.showRuntimeSurfaceFallback(
				shellNodes.runtimeMountRoot,
				this.rpcFailureMessage(err) || _('The shared runtime surface failed to load or mount.')
			);
		}
	},

	mountSharedProviderUi: async function (uiState, statusNodes, shellNodes) {
			var requestId;
			var mountOptions;
			var api;
			var handle;

			uiState.mountRequestId += 1;
			requestId = uiState.mountRequestId;
			this.teardownSharedProviderUi(uiState);

			if (this.isSharedProviderUiDisabledByCutoverGate()) {
				this.renderFallbackProviderManager(
					uiState,
					statusNodes,
					shellNodes,
					'info',
					_('The shared provider manager is explicitly disabled by the Phase 5 cutover gate, so the guarded LuCI fallback provider manager remains active for router verification.'),
					'fallback',
					SHARED_PROVIDER_UI_FALLBACK_REASON_GATE_DISABLED
				);
				return;
			}

			this.setProviderShellMode(shellNodes, 'shared');
			this.clearMessage(uiState);
			this.setBundleStatus(uiState, 'loading', null, null);
			this.updateShellChrome(uiState, statusNodes, shellNodes);
			this.showBundleLoading(shellNodes.mountRoot);

			try {
				api = await this.loadSharedProviderBundle();
				if (requestId !== uiState.mountRequestId)
					return;

				if (!this.bundleProvidesProviderManager(api)) {
					this.renderFallbackProviderManager(
						uiState,
						statusNodes,
						shellNodes,
						'error',
						_('The shared provider bundle loaded without provider-manager support, so the guarded LuCI fallback provider manager remains active until the blocking regression is fixed.'),
						'fallback',
						SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_REGRESSION
					);
					return;
				}

				mountOptions = this.createSharedProviderMountOptions(uiState, statusNodes, shellNodes);
				handle = await Promise.resolve(api.mount(mountOptions));
				uiState.mountHandle = this.normalizeMountHandle(handle);
				this.setBundleStatus(uiState, 'ready', null, null);
				this.updateShellChrome(uiState, statusNodes, shellNodes);
			} catch (err) {
				if (requestId !== uiState.mountRequestId)
					return;

				this.renderFallbackProviderManager(
					uiState,
					statusNodes,
					shellNodes,
					'error',
					this.rpcFailureMessage(err) || _('The shared provider manager failed to load or mount.'),
					'error',
					SHARED_PROVIDER_UI_FALLBACK_REASON_BUNDLE_FAILURE
				);
			}
		},

		render: function (data) {
			var selectedApp = this.getSelectedApp();
			var isRunning = this.parseServiceState(data[1]);
			var providerState = data[2];
			var uiState = this.createUiState(isRunning, providerState, selectedApp);
			var m = new form.Map('ccswitch', _('Open CC Switch'),
				_('Configure the OpenWrt service, outbound proxy settings, and provider routing for the router proxy.')
			);
		var s, o;
		var self = this;

		s = m.section(form.NamedSection, 'main', 'ccswitch', _('Service'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.rmempty = false;

		o = s.option(form.Value, 'listen_addr', _('Listen Address'),
			_('Address to bind the proxy server. Use 0.0.0.0 for all interfaces.'));
		o.datatype = 'ipaddr';
		o.placeholder = '0.0.0.0';
		o.rmempty = false;

		o = s.option(form.Value, 'listen_port', _('Listen Port'),
			_('Port for the proxy server.'));
		o.datatype = 'port';
		o.placeholder = '15721';
		o.rmempty = false;

		s = m.section(form.NamedSection, 'main', 'ccswitch', _('Outbound Proxy'),
			_('Leave these blank for direct internet access, or point them to another OpenWrt app such as Clash.'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'http_proxy', _('HTTP Proxy'));
		o.placeholder = 'http://127.0.0.1:7890';
		o.rmempty = true;

		o = s.option(form.Value, 'https_proxy', _('HTTPS Proxy'));
		o.placeholder = 'http://127.0.0.1:7890';
		o.rmempty = true;

		s = m.section(form.NamedSection, 'main', 'ccswitch', _('Logging'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.ListValue, 'log_level', _('Log Level'));
		o.value('error', _('Error'));
		o.value('warn', _('Warning'));
		o.value('info', _('Info'));
		o.value('debug', _('Debug'));
		o.value('trace', _('Trace'));
		o.default = 'info';

		return m.render().then(function (mapEl) {
			var statusNodes = self.createStatusPanel(uiState);
			var shellNodes = self.createProviderShell(uiState, statusNodes);

			void self.mountSharedRuntimeSurface(uiState, shellNodes);
			void self.mountSharedProviderUi(uiState, statusNodes, shellNodes);

			return E('div', {}, [
				statusNodes.root,
				mapEl,
				shellNodes.root
			]);
		});
	}
});
