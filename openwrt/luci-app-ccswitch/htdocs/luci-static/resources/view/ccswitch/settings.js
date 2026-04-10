'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require poll';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

return view.extend({
	load: function () {
		return Promise.all([
			uci.load('ccswitch'),
			callServiceList('ccswitch')
		]);
	},

	render: function (data) {
		var serviceStatus = data[1];
		var isRunning = false;

		try {
			isRunning = serviceStatus.ccswitch &&
				serviceStatus.ccswitch.instances &&
				Object.keys(serviceStatus.ccswitch.instances).length > 0;
		} catch (e) {
			isRunning = false;
		}

		var m, s, o;

		m = new form.Map('ccswitch', _('Open CC Switch'),
			_('AI API proxy daemon with provider failover and request optimization. ') +
			(isRunning
				? '<b style="color:green">' + _('Running') + '</b>'
				: '<b style="color:red">' + _('Not running') + '</b>')
		);

		s = m.section(form.NamedSection, 'main', 'ccswitch', _('General Settings'));
		s.anonymous = true;
		s.addremove = false;

		// Enable/disable
		o = s.option(form.Flag, 'enabled', _('Enable'),
			_('Start proxy-daemon as a background service'));
		o.rmempty = false;

		// Listen address
		o = s.option(form.Value, 'listen_addr', _('Listen Address'),
			_('Address to bind the proxy server. Use 0.0.0.0 for all interfaces.'));
		o.datatype = 'ipaddr';
		o.placeholder = '0.0.0.0';
		o.rmempty = false;

		// Listen port
		o = s.option(form.Value, 'listen_port', _('Listen Port'),
			_('Port for the proxy server'));
		o.datatype = 'port';
		o.placeholder = '15721';
		o.rmempty = false;

		// Outbound proxy section
		s = m.section(form.NamedSection, 'main', 'ccswitch', _('Outbound Proxy'),
			_('Configure outbound proxy for API requests (e.g., route through Clash).'));
		s.anonymous = true;
		s.addremove = false;

		// HTTP proxy
		o = s.option(form.Value, 'http_proxy', _('HTTP Proxy'),
			_('Outbound HTTP proxy URL. Example: http://127.0.0.1:7890'));
		o.placeholder = 'http://127.0.0.1:7890';
		o.rmempty = true;

		// HTTPS proxy
		o = s.option(form.Value, 'https_proxy', _('HTTPS Proxy'),
			_('Outbound HTTPS proxy URL. Example: http://127.0.0.1:7890 or socks5://127.0.0.1:1080'));
		o.placeholder = 'http://127.0.0.1:7890';
		o.rmempty = true;

		// Logging section
		s = m.section(form.NamedSection, 'main', 'ccswitch', _('Logging'),
			_('Log file: /var/log/cc-switch/cc-switch.log (rotated at 1MB, 2 backups kept)'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.ListValue, 'log_level', _('Log Level'));
		o.value('error', _('Error'));
		o.value('warn', _('Warning'));
		o.value('info', _('Info'));
		o.value('debug', _('Debug'));
		o.value('trace', _('Trace'));
		o.default = 'info';

		return m.render();
	}
});
