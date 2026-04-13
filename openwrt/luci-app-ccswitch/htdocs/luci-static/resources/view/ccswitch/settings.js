'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

var APP_STORAGE_KEY = 'ccswitch-openwrt-selected-app';
var SHARED_PROVIDER_UI_GLOBAL_KEY = '__CCSWITCH_OPENWRT_SHARED_PROVIDER_UI__';
var SHARED_PROVIDER_UI_SCRIPT_ID = 'ccswitch-openwrt-shared-provider-ui-bundle';
var SHARED_PROVIDER_UI_BUNDLE_PATH = '/luci-static/resources/ccswitch/provider-ui/ccswitch-provider-ui.js';
var BANNER_COLORS = {
	success: '#256f3a',
	error: '#b91c1c',
	info: '#1d4ed8'
};
var APP_OPTIONS = [
	{ id: 'claude', label: 'Claude' },
	{ id: 'codex', label: 'Codex' },
	{ id: 'gemini', label: 'Gemini' }
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
			L.resolveDefault(callServiceList('ccswitch'), {})
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

	getBundleAssetPath: function () {
		return SHARED_PROVIDER_UI_BUNDLE_PATH;
	},

	createUiState: function (isRunning, selectedApp) {
		return {
			isRunning: !!isRunning,
			selectedApp: this.isSupportedApp(selectedApp) ? selectedApp : this.getSelectedApp(),
			busy: false,
			message: null,
			bundleStatus: 'idle',
			bundleError: null,
			mountHandle: null,
			mountRequestId: 0
		};
	},

	setMessage: function (uiState, kind, text) {
		uiState.message = text ? { kind: kind, text: text } : null;
	},

	clearMessage: function (uiState) {
		uiState.message = null;
	},

	setBundleStatus: function (uiState, status, error) {
		uiState.bundleStatus = status;
		uiState.bundleError = error || null;
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
		var serviceValue = E('strong');
		var appValue = E('strong');
		var bundleValue = E('strong');
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
				E('label', { 'class': 'cbi-value-title' }, [_('Routing Summary')]),
				E('div', { 'class': 'cbi-value-field' }, [summaryValue])
			])
		]);
		var nodes = {
			root: root,
			serviceValue: serviceValue,
			appValue: appValue,
			bundleValue: bundleValue,
			summaryValue: summaryValue
		};

		this.updateStatusPanel(nodes, uiState);

		return nodes;
	},

	updateStatusPanel: function (nodes, uiState) {
		var appMeta = this.getAppMeta(uiState.selectedApp);
		var bundleText;
		var summaryText;

		nodes.serviceValue.textContent = uiState.isRunning ? _('Running') : _('Stopped');
		nodes.serviceValue.style.color = uiState.isRunning ? '#256f3a' : '#b91c1c';
		nodes.appValue.textContent = appMeta.label;

		if (uiState.bundleStatus === 'ready') {
			bundleText = _('Ready');
			nodes.bundleValue.style.color = '#256f3a';
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

		if (uiState.bundleStatus === 'error')
			summaryText = _('The shared provider manager could not be loaded. The OpenWrt-native service and proxy controls above remain available.');
		else if (uiState.isRunning)
			summaryText = _('Provider changes may require a service restart while the router proxy is running.');
		else
			summaryText = _('Provider changes will take effect when the router proxy starts.');

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
				await self.handleRestartService(uiState, statusNodes, shellNodes);
			})
		}, [_('Restart Service')]);
		var mountRoot = E('div', {
			'id': 'ccswitch-shared-provider-ui-root',
			'style': 'margin-top:1rem'
		});
		var shellNodes = {
			messageRoot: messageRoot,
			messageText: messageText,
			restartButton: restartButton,
			mountRoot: mountRoot,
			root: null
		};
		var root = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [_('Provider Manager')]),
			E('p', { 'style': 'margin-bottom:1rem;color:#4b5563' }, [
				_('The provider manager below is loaded from the OpenWrt shared browser bundle. Service settings, outbound proxy controls, and restart ownership remain in this LuCI shell.')
			]),
			messageRoot,
			E('div', { 'class': 'cbi-page-actions', 'style': 'margin-bottom:1rem' }, [
				restartButton
			]),
			E('div', { 'class': 'cbi-value-description' }, [
				_('Shared provider management is mounted below after this LuCI page renders. If the bundle is missing, the OpenWrt-native sections above still work.')
			]),
			mountRoot
		]);

		shellNodes.root = root;
		messageRoot.appendChild(messageText);
		this.updateProviderShell(shellNodes, uiState);

		return shellNodes;
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

	refreshServiceState: function () {
		return L.resolveDefault(callServiceList('ccswitch'), {}).then(L.bind(function (serviceStatus) {
			return this.parseServiceState(serviceStatus);
		}, this));
	},

	isRpcSuccess: function (result) {
		return result === true || (result && result.ok === true);
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
				return self.handleRestartService(uiState, statusNodes, shellNodes);
			}
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

	handleRestartService: async function (uiState, statusNodes, shellNodes) {
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

	mountSharedProviderUi: async function (uiState, statusNodes, shellNodes) {
		var requestId;
		var mountOptions;
		var api;
		var handle;

		uiState.mountRequestId += 1;
		requestId = uiState.mountRequestId;
		this.teardownSharedProviderUi(uiState);
		this.setBundleStatus(uiState, 'loading', null);
		this.updateShellChrome(uiState, statusNodes, shellNodes);
		this.showBundleLoading(shellNodes.mountRoot);

		try {
			api = await this.loadSharedProviderBundle();
			if (requestId !== uiState.mountRequestId)
				return;

			mountOptions = this.createSharedProviderMountOptions(uiState, statusNodes, shellNodes);
			handle = await Promise.resolve(api.mount(mountOptions));
			uiState.mountHandle = this.normalizeMountHandle(handle);
			this.setBundleStatus(uiState, 'ready', null);
			this.updateShellChrome(uiState, statusNodes, shellNodes);
		} catch (err) {
			if (requestId !== uiState.mountRequestId)
				return;

			this.setBundleStatus(uiState, 'error', this.rpcFailureMessage(err));
			this.setMessage(uiState, 'error', this.rpcFailureMessage(err) || _('The shared provider manager is unavailable.'));
			this.updateShellChrome(uiState, statusNodes, shellNodes);
			this.showBundleFallback(shellNodes.mountRoot, uiState.bundleError);
		}
	},

	render: function (data) {
		var selectedApp = this.getSelectedApp();
		var isRunning = this.parseServiceState(data[1]);
		var uiState = this.createUiState(isRunning, selectedApp);
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

			void self.mountSharedProviderUi(uiState, statusNodes, shellNodes);

			return E('div', {}, [
				statusNodes.root,
				mapEl,
				shellNodes.root
			]);
		});
	}
});
