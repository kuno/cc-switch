'use strict';

import { open, popen, readfile, unlink } from 'fs';
import { cursor } from 'uci';
import { urldecode_params } from 'luci.http';

const CURL = '/usr/bin/curl';
const DEFAULT_ADMIN_PORT = '15721';
const MAX_RESTORE_BYTES = 192 * 1024 * 1024;

function shellquote(value) {
	let string = value;

	if (string == null)
		string = '';

	return `'${replace(string, "'", "'\\''")}'`;
}

function runReadCommand(command) {
	let proc = popen(command, 'r');

	if (!proc)
		return { ok: false, error: 'failed to start command' };

	let output = proc.read('all');
	if (output == null)
		output = '';

	let code = proc.close();
	if (code !== 0)
		return { ok: false, code, error: output || 'command failed' };

	return { ok: true, code, output };
}

function makeTempFile(prefix) {
	let result = runReadCommand(`${shellquote('/bin/mktemp')} ${shellquote('/tmp/' + prefix + '.XXXXXX')} 2>&1`);
	let path;

	if (!result.ok)
		return null;

	path = trim(result.output || '');
	return path || null;
}

function removeTempFile(path) {
	if (path)
		unlink(path);
}

function getAdminListenPort() {
	let ctx = cursor();
	let port;

	if (!ctx)
		return DEFAULT_ADMIN_PORT;

	ctx.load('ccswitch');
	port = ctx.get('ccswitch', 'main', 'listen_port');
	if (port == null)
		return DEFAULT_ADMIN_PORT;

	port = trim('' + port);
	return port || DEFAULT_ADMIN_PORT;
}

function resolveDaemonHost() {
	let ctx = cursor();
	let host;

	if (!ctx)
		return '127.0.0.1';

	ctx.load('ccswitch');
	host = ctx.get('ccswitch', 'main', 'listen_addr');
	if (host == null)
		return '127.0.0.1';

	host = trim('' + host);
	if (!host || host == '0.0.0.0' || host == '::' || host == '::0')
		return '127.0.0.1';

	return host;
}

function formatDaemonHttpHost(host) {
	if (index(host, ':') >= 0 && substr(host, 0, 1) != '[')
		return `[${host}]`;

	return host;
}

function buildAdminUrl(path) {
	return `http://${formatDaemonHttpHost(resolveDaemonHost())}:${getAdminListenPort()}${path}`;
}

function httpStatusMessage(code) {
	switch (+code) {
	case 200:
		return 'OK';
	case 202:
		return 'Accepted';
	case 400:
		return 'Bad Request';
	case 401:
		return 'Unauthorized';
	case 403:
		return 'Forbidden';
	case 404:
		return 'Not Found';
	case 413:
		return 'Payload Too Large';
	case 502:
		return 'Bad Gateway';
	case 504:
		return 'Gateway Timeout';
	default:
		return (+code >= 200 && +code < 300) ? 'OK' : 'Error';
	}
}

function writeJsonStatus(code, payload) {
	http.status(code, httpStatusMessage(code));
	http.prepare_content('application/json; charset=UTF-8');
	http.write_json(payload);
}

function getCookie(name) {
	let cookie = http.getenv('HTTP_COOKIE') || '';
	let marker = name + '=';
	let parts = split(cookie, ';');
	let part;

	for (part in parts) {
		part = trim(part);
		if (index(part, marker) == 0)
			return substr(part, length(marker));
	}

	return null;
}

function sessionId() {
	return ctx.authsession || getCookie('sysauth_https') || getCookie('sysauth_http');
}

function hasUbusAccess(method) {
	let sid = sessionId();
	let result;

	if (!sid)
		return false;

	result = ubus.call('session', 'access', {
		ubus_rpc_session: sid,
		scope: 'ubus',
		object: 'ccswitch',
		function: method
	});

	return result?.access == true;
}

function queryParams() {
	return urldecode_params(http.getenv('QUERY_STRING') || '');
}

function requireWriteToken(params) {
	return params?.token && ctx.authtoken && params.token == ctx.authtoken;
}

function headerValue(headers, name) {
	let lines = split(headers || '', "\n");
	let lowerName = lc(name) + ':';
	let line, value;

	for (line in lines) {
		line = trim(line);
		if (index(lc(line), lowerName) == 0) {
			value = trim(substr(line, length(lowerName)));
			return value || null;
		}
	}

	return null;
}

function writeFile(path, contentType, statusCode) {
	let file = open(path, 'r');
	let chunk;

	if (!file)
		return writeJsonStatus(502, { ok: false, error: 'failed to read daemon response' });

	http.status(statusCode, httpStatusMessage(statusCode));
	http.prepare_content(contentType || 'application/octet-stream');

	while (true) {
		chunk = file.read(65536);
		if (chunk == null || length(chunk) == 0)
			break;

		http.write(chunk);
	}

	file.close();
}

function curlToFiles(method, url, headers, bodyPath, timeout) {
	let body = makeTempFile('ccswitch-proxy-body');
	let hdrs = makeTempFile('ccswitch-proxy-headers');
	let err = makeTempFile('ccswitch-proxy-error');
	let command, result, code;

	if (!body || !hdrs || !err) {
		removeTempFile(body);
		removeTempFile(hdrs);
		removeTempFile(err);
		return { ok: false, error: 'failed to create proxy temporary files' };
	}

	command = `${shellquote(CURL)} -sS --max-time ${+(timeout || 120)} -X ${shellquote(method)} -D ${shellquote(hdrs)} -o ${shellquote(body)}`;

	for (let name, value in headers || {})
		command += ` -H ${shellquote(name + ': ' + value)}`;

	if (bodyPath)
		command += ` --data-binary @${shellquote(bodyPath)}`;

	command += ` -w '%{http_code}' ${shellquote(url)} 2>${shellquote(err)}`;
	result = runReadCommand(command);
	code = +(trim(result.output || '0') || '0');

	if (!result.ok || code == 0) {
		let error = readfile(err) || result.error || 'daemon proxy request failed';
		removeTempFile(body);
		removeTempFile(hdrs);
		removeTempFile(err);
		return { ok: false, error: trim(error) || 'daemon proxy request failed' };
	}

	removeTempFile(err);
	return { ok: true, code, body, headers: hdrs };
}

function spoolRequestBody(path) {
	let file = open(path, 'w');
	let total = 0;
	let chunk;

	if (!file)
		return { ok: false, error: 'failed to create restore upload spool' };

	while (true) {
		chunk = http.input();
		if (chunk == null)
			break;

		total += length(chunk);
		if (total > MAX_RESTORE_BYTES) {
			file.close();
			return { ok: false, error: 'restore archive exceeds size limit', status: 413 };
		}

		file.write(chunk);
	}

	file.close();
	return { ok: true, bytes: total };
}

function action_backup() {
	let result, contentType, disposition;

	if (!hasUbusAccess('download_config_backup'))
		return writeJsonStatus(403, { ok: false, error: 'access denied' });

	if (http.getenv('REQUEST_METHOD') != 'GET')
		return writeJsonStatus(405, { ok: false, error: 'method not allowed' });

	result = curlToFiles('GET', buildAdminUrl('/openwrt/admin/backup'), {}, null, 180);
	if (!result.ok)
		return writeJsonStatus(502, { ok: false, error: result.error });

	contentType = headerValue(readfile(result.headers), 'content-type') || 'application/gzip';
	disposition = headerValue(readfile(result.headers), 'content-disposition');
	if (disposition)
		http.header('Content-Disposition', disposition);

	writeFile(result.body, contentType, result.code);
	removeTempFile(result.body);
	removeTempFile(result.headers);
}

function action_restore() {
	let params = queryParams();
	let bodyPath = makeTempFile('ccswitch-proxy-upload');
	let contentType = http.getenv('CONTENT_TYPE');
	let target = '/openwrt/admin/restore';
	let spool, result, responseType;
	let dryRun = params.dryRun == '1' || params.dryRun == 'true' || params.dryRun == 'yes';

	if (!hasUbusAccess(dryRun ? 'dry_run_config_restore' : 'start_config_restore'))
		return writeJsonStatus(403, { ok: false, error: 'access denied' });

	if (!requireWriteToken(params))
		return writeJsonStatus(403, { ok: false, error: 'invalid CSRF token' });

	if (http.getenv('REQUEST_METHOD') != 'POST')
		return writeJsonStatus(405, { ok: false, error: 'method not allowed' });

	if (!contentType || index(contentType, 'multipart/form-data') < 0)
		return writeJsonStatus(400, { ok: false, error: 'multipart/form-data upload required' });

	if (!bodyPath)
		return writeJsonStatus(500, { ok: false, error: 'failed to create restore upload spool' });

	spool = spoolRequestBody(bodyPath);
	if (!spool.ok) {
		removeTempFile(bodyPath);
		return writeJsonStatus(spool.status || 500, { ok: false, error: spool.error });
	}

	if (dryRun)
		target += '?dryRun=1';

	result = curlToFiles(
		'POST',
		buildAdminUrl(target),
		{ 'Content-Type': contentType },
		bodyPath,
		180
	);
	removeTempFile(bodyPath);

	if (!result.ok)
		return writeJsonStatus(502, { ok: false, error: result.error });

	responseType = headerValue(readfile(result.headers), 'content-type') || 'application/json; charset=UTF-8';
	writeFile(result.body, responseType, result.code);
	removeTempFile(result.body);
	removeTempFile(result.headers);
}

function action_restore_job(jobId) {
	let result, responseType;

	if (!jobId)
		return writeJsonStatus(400, { ok: false, error: 'job id is required' });

	if (!hasUbusAccess('get_config_restore_job'))
		return writeJsonStatus(403, { ok: false, error: 'access denied' });

	if (http.getenv('REQUEST_METHOD') != 'GET')
		return writeJsonStatus(405, { ok: false, error: 'method not allowed' });

	result = curlToFiles(
		'GET',
		buildAdminUrl('/openwrt/admin/restore/jobs/' + jobId),
		{},
		null,
		30
	);
	if (!result.ok)
		return writeJsonStatus(502, { ok: false, error: result.error });

	responseType = headerValue(readfile(result.headers), 'content-type') || 'application/json; charset=UTF-8';
	writeFile(result.body, responseType, result.code);
	removeTempFile(result.body);
	removeTempFile(result.headers);
}

return {
	action_backup,
	action_restore,
	action_restore_job
};
