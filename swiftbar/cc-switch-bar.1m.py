#!/usr/bin/env python3
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>

import base64
import json
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

DAEMON = "http://istoreos:15721"
TIMEOUT = 5

APP_ORDER = ["claude", "codex", "gemini"]

APP_TITLE_ICONS = {
    "claude": "🅒",
    "codex": "🅞",
    "gemini": "🅖",
}

STATUS_ICON = {}

STATUS_COLOR = {
    "allowed": "#4ade80",
    "allowed_warning": "#facc15",
    "exhausted": "#f87171",
}

APP_ICON_FILES = {
    "claude": [
        Path("/Applications/Claude.app/Contents/Resources/TrayIconTemplate.png"),
        Path.home() / "Applications/Claude.app/Contents/Resources/TrayIconTemplate.png",
    ],
    "codex": [
        Path("/Applications/Codex/Contents/Resources/codexTemplate.png"),
        Path("/Applications/Codex.app/Contents/Resources/codexTemplate.png"),
        Path.home() / "Applications/Codex/Contents/Resources/codexTemplate.png",
        Path.home() / "Applications/Codex.app/Contents/Resources/codexTemplate.png",
    ],
}

APP_ICON_CACHE = {}

def fetch_json(path):
    url = f"{DAEMON}{path}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read())


def get_field(data, *names, default=None):
    for name in names:
        if isinstance(data, dict) and name in data:
            return data.get(name)
    return default


def bar_graph(ratio, width=10):
    filled = round(ratio * width)
    return "\u2588" * filled + "\u2591" * (width - filled)


def format_reset(epoch):
    if epoch is None:
        return ""
    dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
    now = datetime.now(tz=timezone.utc)
    secs = int((dt - now).total_seconds())
    if secs <= 0:
        return "now"
    hours, rem = divmod(secs, 3600)
    mins = rem // 60
    if hours > 0:
        return f"{hours}h{mins}m"
    return f"{mins}m"


def format_ago(captured):
    if not captured:
        return ""
    dt = datetime.fromtimestamp(captured / 1000, tz=timezone.utc)
    now = datetime.now(tz=timezone.utc)
    ago = int((now - dt).total_seconds())
    if ago < 60:
        return f"{ago}s ago"
    if ago < 3600:
        return f"{ago // 60}m ago"
    return f"{ago // 3600}h{(ago % 3600) // 60}m ago"


def format_tokens(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k"
    return str(n)


def quota_hex_color(pct):
    if pct <= 20:
        return "#f87171"
    if pct <= 40:
        return "#facc15"
    return "#4ade80"


def group_by_app(providers):
    groups = OrderedDict()
    for app in APP_ORDER:
        groups[app] = []
    for p in providers:
        app = p.get("app_type", "unknown").lower()
        if app not in groups:
            groups[app] = []
        groups[app].append(p)
    return {k: v for k, v in groups.items() if v}


def provider_headline(p):
    windows = p.get("windows", [])
    status = get_field(p, "status")
    if windows:
        rep = get_field(p, "representative_claim", "representativeClaim", default="")
        w = next(
            (
                w for w in windows
                if rep and rep.replace("_", "") in get_field(w, "name", default="").replace("_", "")
            ),
            None,
        )
        if w is None:
            w = windows[-1]
        util = get_field(w, "utilization")
        if util is not None:
            pct = int((1 - util) * 100)
            icon = STATUS_ICON.get(status or get_field(w, "status", default=""), "")
            return icon, pct
    req_rem = get_field(p, "requests_remaining", "requestsRemaining")
    req_lim = get_field(p, "requests_limit", "requestsLimit")
    if req_rem is not None and req_lim:
        pct = int((req_rem / req_lim) * 100)
        return "", pct
    return "", None


def normalize_window_name(name):
    normalized = (name or "").replace("_", "").replace("-", "").lower()
    if normalized in ("5h", "fivehour"):
        return "5h"
    if normalized in ("7d", "sevenday"):
        return "7d"
    return None


def app_window_headline(providers):
    lowest_remaining = OrderedDict([("5h", None), ("7d", None)])
    for p in providers:
        for w in p.get("windows", []):
            label = normalize_window_name(get_field(w, "name"))
            util = get_field(w, "utilization")
            if not label or util is None:
                continue
            pct = int((1 - util) * 100)
            if lowest_remaining[label] is None or pct < lowest_remaining[label]:
                lowest_remaining[label] = pct
    return lowest_remaining


def sanitize_title_text(text):
    for icon in STATUS_ICON.values():
        text = text.replace(icon, "")
    return " ".join(text.split())


def load_app_icon_base64(app):
    cached = APP_ICON_CACHE.get(app)
    if cached is not None:
        return cached
    for path in APP_ICON_FILES.get(app, []):
        try:
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            APP_ICON_CACHE[app] = encoded
            return encoded
        except FileNotFoundError:
            continue
        except OSError:
            continue
    APP_ICON_CACHE[app] = ""
    return ""


def render_app_header(app, summary, active_name=""):
    label = app.capitalize()
    if active_name:
        label = f"{label} ▸ {active_name}"
    return f"{label} | size=14 color=#e2e8f0"


def app_providers(app_status):
    providers = get_field(app_status, "providers", default={})
    return providers if isinstance(providers, dict) else {}


def active_provider_id(app_status):
    active = get_field(app_status, "activeProvider", "active_provider", default={})
    return get_field(active, "providerId", "provider_id")


def menu_bar_title(apps):
    parts = []
    for app in APP_ORDER:
        app_status = apps.get(app, {})
        if not isinstance(app_status, dict):
            continue
        pid = active_provider_id(app_status)
        if not pid:
            continue
        provider = app_providers(app_status).get(pid, {})
        quota = get_field(provider, "quota") if isinstance(provider, dict) else None
        icon = APP_TITLE_ICONS.get(app, "")
        name = get_field(provider, "name") or ""
        pct = None
        if quota:
            windows = quota.get("windows", [])
            candidates = []
            for w in windows:
                wname = get_field(w, "name", default="")
                if "five" in wname.lower() or "5h" in wname.lower() or "seven" in wname.lower() or "7d" in wname.lower():
                    util = get_field(w, "utilization")
                    if util is not None:
                        candidates.append(int((1 - util) * 100))
            if candidates:
                pct = min(candidates)
            else:
                _, pct = provider_headline(quota)
        parts.append(f"{icon} {pct}%" if pct is not None else f"{icon} {name}")
    # SwiftBar uses ASCII "|" to start item metadata, so use a Unicode vertical bar in title text.
    return sanitize_title_text(" ｜ ".join(parts) if parts else "--")


def render_quota_windows(p, prefix):
    lines = []
    windows = p.get("windows", [])
    if windows:
        for w in windows:
            wname = get_field(w, "name", default="")
            wstatus = get_field(w, "status", default="")
            util = get_field(w, "utilization")
            reset = get_field(w, "reset")
            if util is not None:
                pct = int((1 - util) * 100)
                color = STATUS_COLOR.get(wstatus) or quota_hex_color(pct)
                graph = bar_graph(1 - util)
                reset_str = format_reset(reset)
                reset_label = f"  resets {reset_str}" if reset_str else ""
                lines.append(
                    f"{prefix}{graph} {pct}% remaining ({wname}){reset_label} | font=Menlo size=12 color={color}"
                )
            else:
                color = STATUS_COLOR.get(wstatus, "#a1a1aa")
                lines.append(f"{prefix}{wname}: {wstatus} | size=12 color={color}")
        rep = get_field(p, "representative_claim", "representativeClaim")
        if rep:
            lines.append(f"{prefix}Billing: {rep.replace('_', ' ')} | size=11 color=#a1a1aa")
        overage = get_field(p, "overage_status", "overageStatus")
        if overage:
            lines.append(f"{prefix}Overage: {overage} | size=11 color=#a1a1aa")
        fb = get_field(p, "fallback_percentage", "fallbackPercentage")
        if fb is not None:
            lines.append(f"{prefix}Fallback: {int(fb * 100)}% | size=11 color=#a1a1aa")
    else:
        req_lim = get_field(p, "requests_limit", "requestsLimit")
        req_rem = get_field(p, "requests_remaining", "requestsRemaining")
        tok_lim = get_field(p, "tokens_limit", "tokensLimit")
        tok_rem = get_field(p, "tokens_remaining", "tokensRemaining")
        if req_lim is not None and req_rem is not None:
            ratio = req_rem / req_lim if req_lim > 0 else 1
            graph = bar_graph(ratio)
            lines.append(f"{prefix}Requests: {graph} {req_rem}/{req_lim} | font=Menlo size=12")
        if tok_lim is not None and tok_rem is not None:
            ratio = tok_rem / tok_lim if tok_lim > 0 else 1
            graph = bar_graph(ratio)
            lines.append(f"{prefix}Tokens:   {graph} {tok_rem}/{tok_lim} | font=Menlo size=12")
    ago = format_ago(get_field(p, "captured_at", "capturedAt"))
    if ago:
        lines.append(f"{prefix}Updated {ago} | size=10 color=#71717a")
    return lines


def render_stats_line(stat, prefix):
    reqs = stat.get("requestCount", 0)
    tokens = format_tokens(stat.get("totalTokens", 0))
    rate = stat.get("successRate", 0)
    cost = stat.get("totalCost", "0")
    latency = stat.get("avgLatencyMs", 0)
    rate_color = "#4ade80" if rate >= 95 else "#facc15" if rate >= 80 else "#f87171"
    cost_f = float(cost)
    cost_str = f"${cost_f:.2f}" if cost_f >= 0.01 else ""
    parts = [f"{reqs}r", f"{tokens}tok", f"{rate:.0f}%ok"]
    if cost_str:
        parts.append(cost_str)
    if latency > 0:
        if latency >= 1000:
            parts.append(f"{latency / 1000:.1f}s")
        else:
            parts.append(f"{latency}ms")
    return f"{prefix}{' / '.join(parts)} | font=Menlo size=11 color={rate_color}"


def main():
    try:
        status_data = fetch_json("/api/status")
    except Exception as e:
        print(f"cc-switch: error | color=#f87171")
        print("---")
        print(f"Cannot reach daemon | color=#f87171")
        print(f"{DAEMON} | size=11 color=#a1a1aa")
        print(f"{e} | size=10 color=#71717a")
        print("---")
        print("Refresh | refresh=true")
        return

    apps = get_field(status_data, "apps", default={})
    if not isinstance(apps, dict):
        apps = {}
    all_apps = [
        app for app in APP_ORDER
        if app_providers(apps.get(app, {}))
    ]

    print(menu_bar_title(apps))
    print("---")

    if not all_apps:
        print("No data yet | color=#a1a1aa")
        print("Make a request through the proxy first | size=11 color=#71717a")
    else:
        first_group = True
        for app in APP_ORDER:
            app_status = apps.get(app, {})
            providers = app_providers(app_status)
            if not providers:
                continue

            if not first_group:
                print("---")
            first_group = False

            best_icon, best_pct = "", None
            stats_by_id = {}
            quota_by_id = {}
            for pid, provider in providers.items():
                if not isinstance(provider, dict):
                    continue
                stats = get_field(provider, "stats")
                quota = get_field(provider, "quota")
                if stats:
                    stats_by_id[pid] = stats
                if quota:
                    quota_by_id[pid] = quota
                    icon, pct = provider_headline(quota)
                    if pct is not None and (best_pct is None or pct < best_pct):
                        best_pct = pct
                        best_icon = icon

            total_req = sum(s.get("requestCount", 0) for s in stats_by_id.values())
            total_tok = sum(s.get("totalTokens", 0) for s in stats_by_id.values())
            summary_parts = []
            if best_pct is not None:
                summary_parts.append(f"{best_icon} {best_pct}%".strip())
            if total_req > 0:
                summary_parts.append(f"{total_req}r/{format_tokens(total_tok)}tok")
            summary = f" {' '.join(summary_parts)}" if summary_parts else ""
            active_pid = active_provider_id(app_status)
            active_provider = providers.get(active_pid, {}) if active_pid else {}
            active_name = get_field(active_provider, "name") if isinstance(active_provider, dict) else ""
            print(render_app_header(app, summary, active_name))

            active_pid = active_provider_id(app_status)
            for pid, provider in providers.items():
                if not isinstance(provider, dict):
                    continue
                q = quota_by_id.get(pid)
                s = stats_by_id.get(pid)
                name = get_field(provider, "name") or pid or "Unknown"
                status = get_field(q, "status") if q else None
                status_icon = STATUS_ICON.get(status, "") if status else ""
                is_active = pid == active_pid
                active_marker = "▸ " if is_active else ""
                provider_label = f"--{active_marker}{status_icon} {name}" if status_icon else f"--{active_marker}{name}"
                font_attr = "font=Menlo-Bold" if is_active else ""
                extra = f" | {font_attr}" if font_attr else ""
                print(f"{provider_label} | size=13{extra}")

                if s:
                    print(render_stats_line(s, "--"))

                if q:
                    for line in render_quota_windows(q, "--"):
                        print(line)

    print("---")
    daemon = get_field(status_data, "daemon", default={})
    ts = get_field(daemon, "checkedAt", "checked_at", default="")
    if ts:
        print(f"Daemon: {ts[:19]} | size=10 color=#71717a")
    print("Refresh | refresh=true")


def _self_test():
    p = {
        "windows": [{"name": "5hour", "utilization": 0.3, "status": "allowed"}],
        "status": "allowed",
        "representative_claim": "5hour",
    }
    _, pct = provider_headline(p)
    assert pct == 70, f"expected 70, got {pct}"
    assert quota_hex_color(70) == "#4ade80"
    assert quota_hex_color(35) == "#facc15"
    assert quota_hex_color(15) == "#f87171"
    graph = bar_graph(1 - 0.3)
    assert graph.count("\u2588") == 7, f"expected 7 filled cells, got {graph.count(chr(0x2588))}"
    print("self-test passed")


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        _self_test()
    else:
        main()
