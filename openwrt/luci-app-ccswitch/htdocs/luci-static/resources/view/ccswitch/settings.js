'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

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

var callUpsertActiveProvider = rpc.declare({
	object: 'ccswitch',
	method: 'upsert_active_provider',
	params: ['provider'],
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
			L.resolveDefault(callGetActiveProvider(), { ok: false })
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

	parseProviderState: function (providerResponse) {
		if (!providerResponse || providerResponse.ok !== true || !providerResponse.provider_json)
			return this.emptyProviderState();

		try {
			var parsed = JSON.parse(providerResponse.provider_json);
			return Object.assign(this.emptyProviderState(), parsed || {});
		} catch (e) {
			return this.emptyProviderState();
		}
	},

	emptyProviderState: function () {
		return {
			configured: false,
			providerId: null,
			name: '',
			baseUrl: '',
			tokenField: 'ANTHROPIC_AUTH_TOKEN',
			tokenConfigured: false,
			tokenMasked: '',
			model: '',
			notes: ''
		};
	},

	showMessage: function (node, kind, text) {
		var colors = {
			success: '#256f3a',
			error: '#b91c1c',
			info: '#1d4ed8'
		};

		node.style.display = text ? 'block' : 'none';
		node.style.marginBottom = text ? '1rem' : '0';
		node.style.padding = text ? '0.75rem 1rem' : '0';
		node.style.borderLeft = text ? '4px solid ' + (colors[kind] || colors.info) : '0';
		node.style.background = text ? '#f8fafc' : 'transparent';
		node.style.color = colors[kind] || colors.info;
		node.textContent = text || '';
	},

	createStatusPanel: function (isRunning, provider) {
		var serviceValue = E('strong');
		var providerValue = E('strong');
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
				E('label', { 'class': 'cbi-value-title' }, _('Routing Summary')),
				E('div', { 'class': 'cbi-value-field' }, [summaryValue])
			])
		]);

		this.updateStatusPanel({
			serviceValue: serviceValue,
			providerValue: providerValue,
			summaryValue: summaryValue
		}, isRunning, provider);

		return {
			root: root,
			serviceValue: serviceValue,
			providerValue: providerValue,
			summaryValue: summaryValue
		};
	},

	updateStatusPanel: function (nodes, isRunning, provider) {
		nodes.serviceValue.textContent = isRunning ? _('Running') : _('Stopped');
		nodes.serviceValue.style.color = isRunning ? '#256f3a' : '#b91c1c';
		nodes.providerValue.textContent = provider.configured ? provider.name : _('Not configured');
		nodes.summaryValue.textContent = provider.configured
			? _('Claude traffic will use the saved Base URL and current outbound proxy settings.')
			: _('Save a Claude provider below, then start or restart the service.');
	},

	buildProviderSection: function (provider, isRunning) {
		var self = this;
		var messageNode = E('div', { 'style': 'display:none' });
		var tokenHint = E('div', { 'class': 'cbi-value-description' });
		var saveButton = E('button', {
			'class': 'btn cbi-button cbi-button-save',
			'type': 'button',
			'click': ui.createHandlerFn(this, async function (ev) {
				ev.preventDefault();
				self.showMessage(messageNode, 'info', _('Saving provider...'));
				saveButton.disabled = true;
				restartButton.disabled = true;

				try {
					var payload = {
						name: nameInput.value.trim(),
						baseUrl: baseUrlInput.value.trim(),
						tokenField: tokenFieldSelect.value,
						token: tokenInput.value,
						model: modelInput.value.trim(),
						notes: notesInput.value.trim()
					};

					var saveResult = await L.resolveDefault(callUpsertActiveProvider(payload), { ok: false });
					if (!saveResult || saveResult.ok !== true)
						throw new Error((saveResult && saveResult.error) || _('Failed to save provider'));

					var serviceState = await L.resolveDefault(callServiceList('ccswitch'), {});
					var running = self.parseServiceState(serviceState);
					var message = _('Provider saved.');

					if (running) {
						var restartResult = await L.resolveDefault(callRestartService(), { ok: false });
						if (!restartResult || restartResult.ok !== true)
							throw new Error((restartResult && restartResult.error) || _('Provider saved, but service restart failed'));

						message = _('Provider saved and service restarted.');
					}

					var refreshed = await self.refreshProviderState();
					self.applyProviderState(formState, refreshed.provider, refreshed.isRunning);
					self.updateStatusPanel(statusNodes, refreshed.isRunning, refreshed.provider);
					tokenInput.value = '';
					self.showMessage(messageNode, 'success', message);
				} catch (err) {
					self.showMessage(messageNode, 'error', err.message || String(err));
				} finally {
					saveButton.disabled = false;
					restartButton.disabled = false;
				}
			})
		}, [_('Save Claude Provider')]);

		var restartButton = E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'type': 'button',
			'style': 'margin-left:0.75rem',
			'click': ui.createHandlerFn(this, async function (ev) {
				ev.preventDefault();
				self.showMessage(messageNode, 'info', _('Restarting service...'));
				saveButton.disabled = true;
				restartButton.disabled = true;

				try {
					var restartResult = await L.resolveDefault(callRestartService(), { ok: false });
					if (!restartResult || restartResult.ok !== true)
						throw new Error((restartResult && restartResult.error) || _('Failed to restart service'));

					var refreshed = await self.refreshProviderState();
					self.applyProviderState(formState, refreshed.provider, refreshed.isRunning);
					self.updateStatusPanel(statusNodes, refreshed.isRunning, refreshed.provider);
					tokenInput.value = '';
					self.showMessage(messageNode, 'success', _('Service restarted.'));
				} catch (err) {
					self.showMessage(messageNode, 'error', err.message || String(err));
				} finally {
					saveButton.disabled = false;
					restartButton.disabled = false;
				}
			})
		}, [_('Restart Service')]);

		var nameInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': _('Example: Claude Provider'),
			'value': provider.name || ''
		});
		var baseUrlInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'url',
			'placeholder': 'https://api.anthropic.com',
			'value': provider.baseUrl || ''
		});
		var tokenFieldSelect = E('select', { 'class': 'cbi-input-select' }, [
			E('option', {
				'value': 'ANTHROPIC_AUTH_TOKEN',
				'selected': provider.tokenField !== 'ANTHROPIC_API_KEY'
			}, 'ANTHROPIC_AUTH_TOKEN'),
			E('option', {
				'value': 'ANTHROPIC_API_KEY',
				'selected': provider.tokenField === 'ANTHROPIC_API_KEY'
			}, 'ANTHROPIC_API_KEY')
		]);
		var tokenInput = E('input', {
			'class': 'cbi-input-password',
			'type': 'password',
			'autocomplete': 'off',
			'placeholder': provider.tokenConfigured
				? _('Leave blank to keep the stored token')
				: _('Enter token')
		});
		var modelInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': _('Optional model override'),
			'value': provider.model || ''
		});
		var notesInput = E('textarea', {
			'class': 'cbi-input-textarea',
			'rows': '3',
			'placeholder': _('Optional notes')
		}, [provider.notes || '']);

		var section = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Claude Provider')),
			E('p', { 'style': 'margin-bottom:1rem;color:#4b5563' },
				_('This phase stores one active Claude-compatible provider in the existing provider database. Saving while the service is running will restart it so the daemon picks up the new target.')
			),
			messageNode,
			this.renderValue(_('Name'), nameInput, _('Display name for the active Claude provider.')),
			this.renderValue(_('Base URL'), baseUrlInput, _('Claude-compatible API endpoint.')),
			this.renderValue(_('Token Field'), tokenFieldSelect, _('Choose which Anthropic token env key the provider should use.')),
			this.renderValue(_('Token'), tokenInput, tokenHint),
			this.renderValue(_('Model'), modelInput, _('Optional. Leave blank to avoid a forced model override.')),
			this.renderValue(_('Notes'), notesInput, _('Optional notes stored with this provider.')),
			E('div', { 'class': 'cbi-page-actions' }, [
				saveButton,
				restartButton
			])
		]);

		var formState = {
			nameInput: nameInput,
			baseUrlInput: baseUrlInput,
			tokenFieldSelect: tokenFieldSelect,
			tokenInput: tokenInput,
			tokenHint: tokenHint,
			modelInput: modelInput,
			notesInput: notesInput,
			restartButton: restartButton
		};

		var statusNodes = null;
		this.applyProviderState(formState, provider, isRunning);

		return {
			root: section,
			messageNode: messageNode,
			formState: formState,
			saveButton: saveButton,
			setStatusNodes: function (nodes) {
				statusNodes = nodes;
			}
		};
	},

	renderValue: function (title, control, description) {
		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, title),
			E('div', { 'class': 'cbi-value-field' }, [
				control,
				typeof description === 'string'
					? E('div', { 'class': 'cbi-value-description' }, description)
					: description
			])
		]);
	},

	applyProviderState: function (formState, provider, isRunning) {
		formState.nameInput.value = provider.name || '';
		formState.baseUrlInput.value = provider.baseUrl || '';
		formState.tokenFieldSelect.value = provider.tokenField || 'ANTHROPIC_AUTH_TOKEN';
		formState.tokenInput.value = '';
		formState.tokenInput.placeholder = provider.tokenConfigured
			? _('Leave blank to keep the stored token')
			: _('Enter token');
		formState.tokenHint.textContent = provider.tokenConfigured
			? _('Stored token: ') + provider.tokenMasked
			: _('No token stored yet.');
		formState.modelInput.value = provider.model || '';
		formState.notesInput.value = provider.notes || '';
		formState.restartButton.disabled = !provider.configured && !isRunning;
	},

	refreshProviderState: function () {
		return Promise.all([
			L.resolveDefault(callServiceList('ccswitch'), {}),
			L.resolveDefault(callGetActiveProvider(), { ok: false })
		]).then(L.bind(function (results) {
			return {
				isRunning: this.parseServiceState(results[0]),
				provider: this.parseProviderState(results[1])
			};
		}, this));
	},

	render: function (data) {
		var self = this;
		var isRunning = this.parseServiceState(data[1]);
		var provider = this.parseProviderState(data[2]);
		var m = new form.Map('ccswitch', _('Open CC Switch'),
			_('Configure the OpenWrt service and one active Claude-compatible provider for the router proxy.')
		);
		var s, o;

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
			var statusPanel = self.createStatusPanel(isRunning, provider);
			var providerSection = self.buildProviderSection(provider, isRunning);
			providerSection.setStatusNodes(statusPanel);

			return E('div', {}, [
				statusPanel.root,
				mapEl,
				providerSection.root
			]);
		});
	}
});
