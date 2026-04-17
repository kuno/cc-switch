#!/usr/bin/env python3
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>

import json
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone

DAEMON = "http://istoreos:15721"
TIMEOUT = 5

APP_ORDER = ["claude", "codex", "gemini"]

STATUS_ICON = {}

STATUS_COLOR = {
    "allowed": "#4ade80",
    "allowed_warning": "#facc15",
    "exhausted": "#f87171",
}

def fetch_json(path):
    url = f"{DAEMON}{path}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read())


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
    if pct >= 80:
        return "#f87171"
    if pct >= 60:
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
    status = p.get("status")
    if windows:
        rep = p.get("representative_claim", "")
        w = next(
            (w for w in windows if rep and rep.replace("_", "") in w["name"].replace("_", "")),
            None,
        )
        if w is None:
            w = windows[-1]
        util = w.get("utilization")
        if util is not None:
            pct = int(util * 100)
            icon = STATUS_ICON.get(status or w.get("status", ""), "")
            return icon, pct
    req_rem = p.get("requests_remaining")
    req_lim = p.get("requests_limit")
    if req_rem is not None and req_lim:
        pct = int((1 - req_rem / req_lim) * 100)
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
    best = OrderedDict([("5h", None), ("7d", None)])
    for p in providers:
        for w in p.get("windows", []):
            label = normalize_window_name(w.get("name"))
            util = w.get("utilization")
            if not label or util is None:
                continue
            pct = int(util * 100)
            if best[label] is None or pct > best[label]:
                best[label] = pct
    return best


def sanitize_title_text(text):
    for icon in STATUS_ICON.values():
        text = text.replace(icon, "")
    return " ".join(text.split())


def menu_bar_title(quota_groups, stats_by_app):
    parts = []
    for app in APP_ORDER:
        providers = quota_groups.get(app, [])
        app_stats = stats_by_app.get(app)
        if not providers and not app_stats:
            continue
        label = app.capitalize()[:6]
        window_pcts = app_window_headline(providers)
        if any(pct is not None for pct in window_pcts.values()):
            short_5h = window_pcts.get("5h")
            short_7d = window_pcts.get("7d")
            if short_5h is not None and short_7d is not None:
                parts.append(f"{label} [{short_5h}/{short_7d}]%")
            else:
                fallback_bits = []
                for window_name, pct in window_pcts.items():
                    if pct is not None:
                        fallback_bits.append(f"{window_name} {pct}%")
                parts.append(f"{label} {' / '.join(fallback_bits)}")
        elif app_stats:
            total_req = sum(s.get("requestCount", 0) for s in app_stats)
            parts.append(f"{label} {total_req}r")
        else:
            parts.append(label)
    # SwiftBar uses ASCII "|" to start item metadata, so use a Unicode vertical bar in title text.
    return sanitize_title_text(" ｜ ".join(parts) if parts else "--")


def render_quota_windows(p, prefix):
    lines = []
    windows = p.get("windows", [])
    if windows:
        for w in windows:
            wname = w["name"]
            wstatus = w.get("status", "")
            util = w.get("utilization")
            reset = w.get("reset")
            if util is not None:
                pct = int(util * 100)
                color = STATUS_COLOR.get(wstatus) or quota_hex_color(pct)
                graph = bar_graph(util)
                reset_str = format_reset(reset)
                reset_label = f"  resets {reset_str}" if reset_str else ""
                lines.append(
                    f"{prefix}{graph} {pct}% ({wname}){reset_label} | font=Menlo size=12 color={color}"
                )
            else:
                color = STATUS_COLOR.get(wstatus, "#a1a1aa")
                lines.append(f"{prefix}{wname}: {wstatus} | size=12 color={color}")
        rep = p.get("representative_claim")
        if rep:
            lines.append(f"{prefix}Billing: {rep.replace('_', ' ')} | size=11 color=#a1a1aa")
        overage = p.get("overage_status")
        if overage:
            lines.append(f"{prefix}Overage: {overage} | size=11 color=#a1a1aa")
        fb = p.get("fallback_percentage")
        if fb is not None:
            lines.append(f"{prefix}Fallback: {int(fb * 100)}% | size=11 color=#a1a1aa")
    else:
        req_lim = p.get("requests_limit")
        req_rem = p.get("requests_remaining")
        tok_lim = p.get("tokens_limit")
        tok_rem = p.get("tokens_remaining")
        if req_lim is not None and req_rem is not None:
            ratio = 1 - req_rem / req_lim if req_lim > 0 else 0
            graph = bar_graph(ratio)
            lines.append(f"{prefix}Requests: {graph} {req_rem}/{req_lim} | font=Menlo size=12")
        if tok_lim is not None and tok_rem is not None:
            ratio = 1 - tok_rem / tok_lim if tok_lim > 0 else 0
            graph = bar_graph(ratio)
            lines.append(f"{prefix}Tokens:   {graph} {tok_rem}/{tok_lim} | font=Menlo size=12")
    ago = format_ago(p.get("captured_at"))
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
        quota_data = fetch_json("/api/quota")
    except Exception as e:
        print(f"offline | color=#f87171")
        print("---")
        print(f"Cannot reach daemon | color=#f87171")
        print(f"{DAEMON} | size=11 color=#a1a1aa")
        print(f"{e} | size=10 color=#71717a")
        print("---")
        print("Refresh | refresh=true")
        return

    quota_providers = quota_data.get("providers", [])
    quota_groups = group_by_app(quota_providers)

    stats_by_app = {}
    for app in APP_ORDER:
        try:
            data = fetch_json(f"/openwrt/admin/apps/{app}/provider-stats")
            providers = data.get("providers", [])
            if providers:
                stats_by_app[app] = providers
        except Exception:
            pass

    all_apps = list(OrderedDict.fromkeys(
        list(quota_groups.keys()) + list(stats_by_app.keys())
    ))

    print(menu_bar_title(quota_groups, stats_by_app))
    print("---")

    if not all_apps:
        print("No data yet | color=#a1a1aa")
        print("Make a request through the proxy first | size=11 color=#71717a")
    else:
        first_group = True
        for app in APP_ORDER:
            app_quota = quota_groups.get(app, [])
            app_stats = stats_by_app.get(app, [])
            if not app_quota and not app_stats:
                continue

            if not first_group:
                print("---")
            first_group = False

            best_icon, best_pct = "", None
            for p in app_quota:
                icon, pct = provider_headline(p)
                if pct is not None and (best_pct is None or pct > best_pct):
                    best_pct = pct
                    best_icon = icon

            total_req = sum(s.get("requestCount", 0) for s in app_stats)
            total_tok = sum(s.get("totalTokens", 0) for s in app_stats)
            summary_parts = []
            if best_pct is not None:
                summary_parts.append(f"{best_icon} {best_pct}%".strip())
            if total_req > 0:
                summary_parts.append(f"{total_req}r/{format_tokens(total_tok)}tok")
            summary = f" {' '.join(summary_parts)}" if summary_parts else ""
            print(f"{app.upper()}{summary} | size=14 color=#e2e8f0")

            stats_by_id = {s["providerId"]: s for s in app_stats}
            quota_by_id = {
                p.get("provider_id", ""): p for p in app_quota
            }

            all_provider_ids = list(OrderedDict.fromkeys(
                list(quota_by_id.keys()) + list(stats_by_id.keys())
            ))

            for pid in all_provider_ids:
                q = quota_by_id.get(pid)
                s = stats_by_id.get(pid)
                name = (
                    (q.get("provider_name") if q else None)
                    or (s.get("providerName") if s else None)
                    or pid
                    or "Unknown"
                )
                status = q.get("status") if q else None
                status_icon = STATUS_ICON.get(status, "") if status else ""
                provider_label = f"--{status_icon} {name}" if status_icon else f"--{name}"
                print(f"{provider_label} | size=13")

                if s:
                    print(render_stats_line(s, "--"))

                if q:
                    for line in render_quota_windows(q, "--"):
                        print(line)

    print("---")
    ts = quota_data.get("timestamp", "")
    if ts:
        print(f"Daemon: {ts[:19]} | size=10 color=#71717a")
    print("Refresh | refresh=true")


if __name__ == "__main__":
    main()
