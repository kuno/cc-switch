'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

var DEFAULT_TOKEN_FIELD = 'ANTHROPIC_AUTH_TOKEN';
var ALT_TOKEN_FIELD = 'ANTHROPIC_API_KEY';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

var callGetActiveProvider = rpc.declare({
	object: 'ccswitch',
	method: 'get_active_provider',
	expect: { '': {} }
});

var callListProviders = rpc.declare({
	object: 'ccswitch',
	method: 'list_providers',
	expect: { '': {} }
});

var callListSavedProviders = rpc.declare({
	object: 'ccswitch',
	method: 'list_saved_providers',
	expect: { '': {} }
});

var callUpsertActiveProvider = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_active_provider',
	params: ['provider'],
	expect: { '': {} }
});

var callUpsertProvider = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_provider',
	params: ['provider'],
	expect: { '': {} }
});

var callSaveProvider = rpc.declare({
	object: 'ccswitch',
	method: 'save_provider',
	params: ['provider'],
	expect: { '': {} }
});

var callUpsertProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_provider',
	params: ['provider_id', 'provider'],
	expect: { '': {} }
});

var callUpsertProviderById = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_provider',
	params: ['id', 'provider'],
	expect: { '': {} }
});

var callDeleteProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'delete_provider',
	params: ['provider_id'],
	expect: { '': {} }
});

var callDeleteProviderById = rpc.declare({
	object: 'ccswitch',
	method: 'delete_provider',
	params: ['id'],
	expect: { '': {} }
});

var callActivateProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'activate_provider',
	params: ['provider_id'],
	expect: { '': {} }
});

var callActivateProviderById = rpc.declare({
	object: 'ccswitch',
	method: 'activate_provider',
	params: ['id'],
	expect: { '': {} }
});

var callSwitchProviderByProviderId = rpc.declare({
	object: 'ccswitch',
	method: 'switch_provider',
	params: ['provider_id'],
	expect: { '': {} }
});

var callSwitchProviderById = rpc.declare({
	object: 'ccswitch',
	method: 'switch_provider',
	params: ['id'],
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
			this.loadProviderState()
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

	emptyProviderView: function () {
		return {
			configured: false,
			providerId: null,
			name: '',
			baseUrl: '',
			tokenField: DEFAULT_TOKEN_FIELD,
			tokenConfigured: false,
			tokenMasked: '',
			model: '',
			notes: '',
			active: false
		};
	},

	emptyEditorPayload: function () {
		return {
			name: '',
			baseUrl: '',
			tokenField: DEFAULT_TOKEN_FIELD,
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

	parseProviderState: function (providerResponse) {
		var parsed = null;

		if (providerResponse && providerResponse.ok === true && providerResponse.provider_json)
			parsed = this.parseJsonString(providerResponse.provider_json);

		if (!parsed && providerResponse && providerResponse.provider)
			parsed = providerResponse.provider;

		if (!parsed)
			return this.emptyProviderView();

		return this.normalizeProviderView(parsed, null, null);
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

	normalizeProviderView: function (provider, fallbackId, activeProviderId) {
		var normalized = this.emptyProviderView();
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
		normalized.tokenField = provider.tokenField || provider.token_field || DEFAULT_TOKEN_FIELD;
		normalized.tokenConfigured = !!(provider.tokenConfigured || provider.token_configured);
		normalized.tokenMasked = provider.tokenMasked || provider.token_masked || '';
		normalized.model = provider.model || '';
		normalized.notes = provider.notes || '';
		normalized.active = isActive;

		return normalized;
	},

	normalizeProviderList: function (rawProviders, activeProviderId) {
		var list = [];
		var self = this;

		if (Array.isArray(rawProviders)) {
			rawProviders.forEach(function (provider, index) {
				list.push(self.normalizeProviderView(provider, 'provider-' + index, activeProviderId));
			});
		} else if (rawProviders && typeof rawProviders === 'object') {
			Object.keys(rawProviders).forEach(function (id) {
				list.push(self.normalizeProviderView(rawProviders[id], id, activeProviderId));
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

	buildProviderState: function (providers, activeProviderId, phase2Available) {
		var activeProvider = this.emptyProviderView();
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

	parsePhase2ProviderState: function (listResponse, activeHint) {
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

		providers = this.normalizeProviderList(this.extractRawProviders(payload), activeProviderId);

		if (!activeProviderId)
			activeProviderId = this.findActiveProviderId(providers);

		if (!activeProviderId)
			activeProviderId = this.matchProviderHint(providers, activeHint);

		return this.buildProviderState(providers, activeProviderId, true);
	},

	buildLegacyProviderState: function (provider) {
		var providers = [];
		var state;

		if (provider && provider.configured) {
			provider.active = true;
			providers.push(provider);
		}

		state = this.buildProviderState(providers, provider.providerId, false);

		if (provider && provider.configured && !state.activeProvider.configured) {
			providers[0].active = true;
			state.activeProvider = providers[0];
			state.activeProviderId = provider.providerId || null;
		}

		return state;
	},

	loadProviderState: function () {
		return Promise.all([
			L.resolveDefault(callListProviders(), null),
			L.resolveDefault(callListSavedProviders(), null),
			L.resolveDefault(callGetActiveProvider(), { ok: false })
		]).then(L.bind(function (results) {
			var activeProvider = this.parseProviderState(results[2]);
			var phase2State = this.parsePhase2ProviderState(results[0], activeProvider) ||
				this.parsePhase2ProviderState(results[1], activeProvider);

			if (phase2State)
				return phase2State;

			return this.buildLegacyProviderState(activeProvider);
		}, this));
	},

	refreshPageState: function () {
		return Promise.all([
			L.resolveDefault(callServiceList('ccswitch'), {}),
			this.loadProviderState()
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

	providerToEditorPayload: function (provider) {
		var payload = this.emptyEditorPayload();

		if (!provider)
			return payload;

		payload.name = provider.name || '';
		payload.baseUrl = provider.baseUrl || '';
		payload.tokenField = provider.tokenField || DEFAULT_TOKEN_FIELD;
		payload.model = provider.model || '';
		payload.notes = provider.notes || '';

		return payload;
	},

	getEditorProvider: function (uiState) {
		if (!uiState.providerState.phase2Available)
			return uiState.providerState.activeProvider;

		if (uiState.editorMode === 'edit')
			return this.findProviderById(uiState.providerState.providers, uiState.editProviderId) || this.emptyProviderView();

		return this.emptyProviderView();
	},

	createUiState: function (isRunning, providerState) {
		var activeProvider = providerState.activeProvider;

		return {
			isRunning: isRunning,
			providerState: providerState,
			editorMode: providerState.phase2Available ? 'new' : (activeProvider.configured ? 'legacy' : 'new'),
			editProviderId: providerState.phase2Available ? null : providerState.activeProviderId,
			busy: false,
			message: null
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

	renderMessageBanner: function (message) {
		var colors = {
			success: '#256f3a',
			error: '#b91c1c',
			info: '#1d4ed8'
		};

		if (!message || !message.text)
			return E('div', { 'style': 'display:none' });

		return E('div', {
			'style': [
				'margin-bottom:1rem',
				'padding:0.75rem 1rem',
				'border-left:4px solid ' + (colors[message.kind] || colors.info),
				'background:#f8fafc',
				'color:' + (colors[message.kind] || colors.info)
			].join(';')
		}, [message.text]);
	},

	createStatusPanel: function (uiState) {
		var serviceValue = E('strong');
		var providerValue = E('strong');
		var savedCountValue = E('strong');
		var summaryValue = E('span', { 'style': 'color:#4b5563' });
		var root = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Status')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Service')),
				E('div', { 'class': 'cbi-value-field' }, [serviceValue])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Active Claude Provider')),
				E('div', { 'class': 'cbi-value-field' }, [providerValue])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Saved Providers')),
				E('div', { 'class': 'cbi-value-field' }, [savedCountValue])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Routing Summary')),
				E('div', { 'class': 'cbi-value-field' }, [summaryValue])
			])
		]);

		this.updateStatusPanel({
			serviceValue: serviceValue,
			providerValue: providerValue,
			savedCountValue: savedCountValue,
			summaryValue: summaryValue
		}, uiState);

		return {
			root: root,
			serviceValue: serviceValue,
			providerValue: providerValue,
			savedCountValue: savedCountValue,
			summaryValue: summaryValue
		};
	},

	updateStatusPanel: function (nodes, uiState) {
		var providerState = uiState.providerState;
		var activeProvider = providerState.activeProvider;
		var summaryText;

		nodes.serviceValue.textContent = uiState.isRunning ? _('Running') : _('Stopped');
		nodes.serviceValue.style.color = uiState.isRunning ? '#256f3a' : '#b91c1c';
		nodes.providerValue.textContent = activeProvider.configured ? activeProvider.name : _('Not configured');
		nodes.savedCountValue.textContent = String(providerState.providers.length);

		if (!providerState.phase2Available) {
			summaryText = activeProvider.configured
				? _('This build is using the Phase 1 active-provider bridge. Multi-provider actions will appear after the backend Phase 2 RPCs land.')
				: _('Save the first Claude provider below, then start or restart the service.');
		} else if (activeProvider.configured) {
			summaryText = _('Claude traffic will use the active saved provider together with the current outbound proxy settings.');
		} else if (providerState.providers.length) {
			summaryText = _('Saved providers are available, but none is active yet. Activate one below when you are ready to switch routing.');
		} else {
			summaryText = _('Add a saved provider below, then activate one when you are ready to route Claude traffic through it.');
		}

		nodes.summaryValue.textContent = summaryText;
	},

	renderValue: function (title, control, description) {
		var fieldChildren = [control];

		if (typeof description === 'string')
			fieldChildren.push(E('div', { 'class': 'cbi-value-description' }, [description]));
		else if (description)
			fieldChildren.push(description);

		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, title),
			E('div', { 'class': 'cbi-value-field' }, fieldChildren)
		]);
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
		var self = this;
		var children = [];

		children.push(E('h4', { 'style': 'margin:0 0 0.75rem 0' }, [_('Saved Claude Providers')]));

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
		var self = this;
		var editingProvider = this.getEditorProvider(uiState);
		var payload = this.providerToEditorPayload(editingProvider);
		var title;
		var description;
		var tokenHint = E('div', { 'class': 'cbi-value-description' }, [
			editingProvider.tokenConfigured
				? _('Stored token: ') + editingProvider.tokenMasked
				: _('No token stored yet.')
		]);
		var nameInput;
		var baseUrlInput;
		var tokenFieldSelect;
		var tokenInput;
		var modelInput;
		var notesInput;
		var actionChildren = [];

		if (!uiState.providerState.phase2Available) {
			title = editingProvider.configured ? _('Active Claude Provider') : _('Configure Claude Provider');
			description = editingProvider.configured
				? _('This compatibility editor updates the active provider only until the multi-provider backend slice lands.')
				: _('Save the first Claude provider here. Once the backend Phase 2 RPCs land, this page will expand into a full saved-provider manager.');
		} else if (uiState.editorMode === 'edit') {
			title = _('Edit Saved Provider');
			description = _('Leave the token blank to keep the stored secret. Saving does not automatically activate a different provider.');
		} else {
			title = _('Add Saved Provider');
			description = _('Add a Claude-compatible provider to the saved list. Activate it later when you want router traffic to use it.');
		}

		nameInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': _('Example: Claude Provider'),
			'value': payload.name
		});

		baseUrlInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'url',
			'placeholder': 'https://api.anthropic.com',
			'value': payload.baseUrl
		});

		tokenFieldSelect = E('select', { 'class': 'cbi-input-select' }, [
			E('option', {
				'value': DEFAULT_TOKEN_FIELD,
				'selected': payload.tokenField !== ALT_TOKEN_FIELD
			}, [DEFAULT_TOKEN_FIELD]),
			E('option', {
				'value': ALT_TOKEN_FIELD,
				'selected': payload.tokenField === ALT_TOKEN_FIELD
			}, [ALT_TOKEN_FIELD])
		]);

		tokenInput = E('input', {
			'class': 'cbi-input-password',
			'type': 'password',
			'autocomplete': 'off',
			'placeholder': editingProvider.tokenConfigured
				? _('Leave blank to keep the stored token')
				: _('Enter token')
		});

		modelInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': _('Optional model override'),
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
			this.renderValue(_('Name'), nameInput, _('Display name for this Claude-compatible provider.')),
			this.renderValue(_('Base URL'), baseUrlInput, _('Claude-compatible API endpoint.')),
			this.renderValue(_('Token Field'), tokenFieldSelect, _('Choose which Anthropic token env key this provider should use.')),
			this.renderValue(_('Token'), tokenInput, tokenHint),
			this.renderValue(_('Model'), modelInput, _('Optional. Leave blank to avoid a forced model override.')),
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
		var children = [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [_('Claude Providers')]),
				E('p', { 'style': 'margin-bottom:1rem;color:#4b5563' }, [
					_('Manage saved Claude-compatible providers for OpenWrt while keeping the existing service and outbound proxy controls above unchanged.')
				]),
				this.renderMessageBanner(uiState.message),
				!uiState.providerState.phase2Available ? this.renderCompatibilityNotice() : E('div', { 'style': 'display:none' }),
				this.renderManagerActions(uiState, root, statusNodes),
				this.renderProviderList(uiState, root, statusNodes),
				this.renderEditorSection(uiState, root, statusNodes)
			])
		];

		return E('div', {}, children);
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

	validateProviderPayload: function (payload, existingProvider) {
		if (!payload.name)
			return _('Provider name is required.');

		if (!payload.baseUrl)
			return _('Base URL is required.');

		if (!payload.token && !(existingProvider && existingProvider.tokenConfigured))
			return _('Token is required for the first save.');

		if (payload.tokenField !== DEFAULT_TOKEN_FIELD && payload.tokenField !== ALT_TOKEN_FIELD)
			return _('Unsupported token field.');

		return null;
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

	invokePhase2Upsert: function (providerId, providerPayload) {
		var missingMessage = _('The Phase 2 provider save RPC is not available in this build.');

		if (providerId) {
			return this.invokeRpcCandidates([
				{
					call: function () { return callUpsertProviderByProviderId(providerId, providerPayload); },
					compatibilityFallback: true
				},
				{
					call: function () { return callUpsertProviderById(providerId, providerPayload); },
					compatibilityFallback: true
				}
			], missingMessage);
		}

		return this.invokeRpcCandidates([
			{
				call: function () { return callUpsertProvider(providerPayload); },
				compatibilityFallback: true
			},
			{
				call: function () { return callSaveProvider(providerPayload); },
				compatibilityFallback: true
			}
		], missingMessage);
	},

	invokePhase2Delete: function (providerId) {
		return this.invokeRpcCandidates([
			{
				call: function () { return callDeleteProviderByProviderId(providerId); },
				compatibilityFallback: true
			},
			{
				call: function () { return callDeleteProviderById(providerId); },
				compatibilityFallback: true
			}
		], _('The Phase 2 provider delete RPC is not available in this build.'));
	},

	invokePhase2Activate: function (providerId) {
		return this.invokeRpcCandidates([
			{
				call: function () { return callActivateProviderByProviderId(providerId); },
				compatibilityFallback: true
			},
			{
				call: function () { return callActivateProviderById(providerId); },
				compatibilityFallback: true
			},
			{
				call: function () { return callSwitchProviderByProviderId(providerId); },
				compatibilityFallback: true
			},
			{
				call: function () { return callSwitchProviderById(providerId); },
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

	handleSaveProvider: async function (root, uiState, statusNodes, refs) {
		var payload = this.collectProviderPayload(refs);
		var existingProvider = this.getEditorProvider(uiState);
		var validationError = this.validateProviderPayload(payload, existingProvider);
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
				await this.invokePhase2Upsert(editingId, payload);
				refreshed = await this.refreshPageState();
				shouldRestart = refreshed.isRunning && (
					previousActiveId !== refreshed.providerState.activeProviderId ||
					(editingId && editingId === previousActiveId) ||
					(!previousActiveId && !!refreshed.providerState.activeProviderId)
				);
			} else {
				var legacyResult = await L.resolveDefault(callUpsertActiveProvider(payload), { ok: false });
				if (!this.isRpcSuccess(legacyResult))
					throw new Error(this.rpcError(legacyResult) || _('Failed to save provider.'));

				refreshed = await this.refreshPageState();
				shouldRestart = refreshed.isRunning;
			}

			if (shouldRestart) {
				await this.restartService();
				refreshed = await this.refreshPageState();
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
			await this.invokePhase2Activate(providerId);
			refreshed = await this.refreshPageState();

			if (refreshed.isRunning && previousActiveId !== refreshed.providerState.activeProviderId) {
				await this.restartService();
				refreshed = await this.refreshPageState();
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
			await this.invokePhase2Delete(provider.providerId);
			refreshed = await this.refreshPageState();

			if (refreshed.isRunning &&
				(provider.providerId === previousActiveId ||
					previousActiveId !== refreshed.providerState.activeProviderId)) {
				await this.restartService();
				refreshed = await this.refreshPageState();
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
			refreshed = await this.refreshPageState();
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

	render: function (data) {
		var isRunning = this.parseServiceState(data[1]);
		var providerState = data[2];
		var uiState = this.createUiState(isRunning, providerState);
		var m = new form.Map('ccswitch', _('Open CC Switch'),
			_('Configure the OpenWrt service, outbound proxy settings, and Claude provider routing for the router proxy.')
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
			var providerManagerRoot = E('div');

			self.rerenderManager(providerManagerRoot, uiState, statusNodes);

			return E('div', {}, [
				statusNodes.root,
				mapEl,
				providerManagerRoot
			]);
		});
	}
});
