#!/usr/bin/env python3
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>

import json
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone

DAEMON_URL = "http://istoreos:15721/api/quota"
TIMEOUT = 5

APP_ORDER = ["claude", "codex", "gemini"]

STATUS_ICON = {
    "allowed": "\u2705",
    "allowed_warning": "\u26a0\ufe0f",
    "exhausted": "\u274c",
    "rejected": "\u274c",
}

STATUS_COLOR = {
    "allowed": "#4ade80",
    "allowed_warning": "#facc15",
    "exhausted": "#f87171",
}


def bar_graph(ratio, width=10):
    filled = round(ratio * width)
    return "\u2588" * filled + "\u2591" * (width - filled)


def format_reset(epoch):
    if epoch is None:
        return ""
    dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
    now = datetime.now(tz=timezone.utc)
    delta = dt - now
    secs = int(delta.total_seconds())
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


def menu_bar_title(groups):
    if not groups:
        return "--"
    parts = []
    for app, providers in groups.items():
        label = app.capitalize()[:6]
        best_icon = ""
        best_pct = None
        for p in providers:
            icon, pct = provider_headline(p)
            if pct is not None and (best_pct is None or pct > best_pct):
                best_pct = pct
                best_icon = icon
        if best_pct is not None:
            parts.append(f"{best_icon}{label} {best_pct}%")
        else:
            parts.append(label)
    return " ".join(parts)


def render_provider(p, indent=False):
    name = p.get("provider_name", p.get("provider_id", "Unknown"))
    status = p.get("status")
    status_icon = STATUS_ICON.get(status, "")
    prefix = "--" if indent else ""
    lines = []
    lines.append(f"{prefix}{status_icon} {name} | size=13")

    windows = p.get("windows", [])
    if windows:
        for w in windows:
            wname = w["name"]
            wstatus = w.get("status", "")
            util = w.get("utilization")
            reset = w.get("reset")
            color = STATUS_COLOR.get(wstatus, "#a1a1aa")
            if util is not None:
                pct = int(util * 100)
                graph = bar_graph(util)
                reset_str = format_reset(reset)
                reset_label = f"  resets {reset_str}" if reset_str else ""
                lines.append(
                    f"{prefix}{graph} {pct}% ({wname}){reset_label} | font=Menlo size=12 color={color}"
                )
            else:
                lines.append(f"{prefix}{wname}: {wstatus} | size=12 color={color}")

        rep = p.get("representative_claim")
        if rep:
            lines.append(
                f"{prefix}Billing window: {rep.replace('_', ' ')} | size=11 color=#a1a1aa"
            )
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
            lines.append(
                f"{prefix}Requests: {graph} {req_rem}/{req_lim} | font=Menlo size=12"
            )
        if tok_lim is not None and tok_rem is not None:
            ratio = 1 - tok_rem / tok_lim if tok_lim > 0 else 0
            graph = bar_graph(ratio)
            lines.append(
                f"{prefix}Tokens:   {graph} {tok_rem}/{tok_lim} | font=Menlo size=12"
            )

    ago = format_ago(p.get("captured_at"))
    if ago:
        lines.append(f"{prefix}Updated {ago} | size=10 color=#71717a")

    return lines


def main():
    try:
        req = urllib.request.Request(DAEMON_URL)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"offline | color=#f87171")
        print("---")
        print(f"Cannot reach daemon | color=#f87171")
        print(f"{DAEMON_URL} | size=11 color=#a1a1aa")
        print(f"{e} | size=10 color=#71717a")
        print("---")
        print("Refresh | refresh=true")
        return

    providers = data.get("providers", [])
    groups = group_by_app(providers)

    print(menu_bar_title(groups))
    print("---")

    if not groups:
        print("No quota data yet | color=#a1a1aa")
        print("Make a request through the proxy first | size=11 color=#71717a")
    else:
        first_group = True
        for app, app_providers in groups.items():
            if not first_group:
                print("---")
            first_group = False

            best_icon, best_pct = "", None
            for p in app_providers:
                icon, pct = provider_headline(p)
                if pct is not None and (best_pct is None or pct > best_pct):
                    best_pct = pct
                    best_icon = icon
            summary = f" {best_icon}{best_pct}%" if best_pct is not None else ""
            print(f"{app.upper()}{summary} | size=14 color=#e2e8f0")
            for p in app_providers:
                for line in render_provider(p, indent=True):
                    print(line)
                if len(app_providers) > 1:
                    print("-----")

    print("---")
    ts = data.get("timestamp", "")
    if ts:
        print(f"Daemon: {ts[:19]} | size=10 color=#71717a")
    print("Refresh | refresh=true")


if __name__ == "__main__":
    main()
