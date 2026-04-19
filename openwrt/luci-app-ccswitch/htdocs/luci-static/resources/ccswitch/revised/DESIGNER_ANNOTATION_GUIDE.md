# How to annotate wiring in your mockup

We're migrating your HTML mockups into React components against a backend RPC layer (LuCI `ubus`). Your mockup is the design source of truth; the engineer binds it to real data. The gap between those two jobs is where we lose time — annotations close it.

Please add inline HTML comments to your mockup describing the **observable behavior** of each interactive or data-bound element. You don't need to know the backend's method or field names — describe what the user sees and when, and the engineer will map it to the transport.

## The four comment tags

Use one of these four, not prose paragraphs. Short is better than thorough.

- `<!-- wire: ... -->` — what data fills this element
- `<!-- action: ... -->` — what happens when the user interacts with it
- `<!-- state: ... -->` — when this element appears / hides / changes tone
- `<!-- note: ... -->` — anything non-obvious that isn't one of the above

Place the comment immediately above the element it describes.

## What to write

**Describe behavior, not implementation.** You own the observable contract; the engineer owns the wire format.

Good — describes behavior:

```html
<!-- state: chip is red when the service is down, yellow when it's up but not responding -->
<!-- action: click restarts the daemon; button stays disabled until the request finishes -->
<!-- wire: shows the number of providers this app has -->
```

Not helpful — assumes a specific RPC shape:

```html
<!-- wire: status.service.reachable -->
<!-- action: call restart_service() -->
```

(The engineer will add those field names themselves. If you write them and the backend later renames a field, your mockup is lying.)

## What to annotate

Every interactive or data-bound element: form inputs, buttons, chips with tone/state, lists populated from data, elements that appear conditionally, modals, popovers. Skip pure layout and decorative elements.

If the same rule applies across many elements (e.g. "tone vocabulary", "all destructive buttons need confirmation", "all forms guard close with discard-confirm"), put it in a sibling `WIRING.md` file next to the mockup — don't repeat it on every element.

## Things to call out explicitly

Please mark these explicitly rather than leaving them to inference:

- **Client-only elements** — anything not backed by real data. Example: `<!-- note: client-only; saved to localStorage -->`.
- **Presentation-only fields** — shown but not persisted. Example: `<!-- note: presentation only, not saved -->`.
- **Placeholders** — elements waiting on future backend support. Example: `<!-- state: disabled until backend exposes this -->`.
- **Write-only inputs** — like a secret/API token field where typed value is sent on save but stored value is never read back. Example: `<!-- note: write-only; leave blank to preserve stored value -->`.
- **Cross-element dependencies** — when one element's state depends on another. Example: `<!-- state: hidden until an item is selected in the rail on the left -->`.
- **Dirty-state / confirmation rules** — when a close/cancel should prompt to discard changes, when an action needs a confirm dialog.

## Example — a chip with dynamic tone and a click action

```html
<!--
  wire:   shows the overall health of this app (e.g. "Running", "Degraded", "Error", "Idle")
  state:  tone follows status:
            running and healthy        -> green, "Running"
            running but failing calls  -> yellow, "Degraded"
            not configured             -> grey, "Idle"
            daemon down                -> red, "Error"
  action: click opens the recent-activity popover anchored below this chip
-->
<button class="chip success dot">Running</button>
```

The engineer can bind that to the right RPC field without asking you what "Degraded" means.

## Example — a form footer

```html
<!--
  action: Save persists all three tabs atomically. Cancel discards changes; if the form is
          dirty, confirm-discard modal first. Delete is destructive; hide it for the currently
          active provider (user must activate another provider first).
-->
<footer class="sp-foot">
  <button class="pill danger">Delete</button>
  <button class="pill">Cancel</button>
  <button class="pill primary">Save</button>
</footer>
```

## Example — a placeholder element

```html
<!-- state: placeholder until backend exposes this field; keep muted and non-interactive -->
<div class="field-placeholder">Route mode — coming soon</div>
```

## Style rules

- One annotation per element or per logical group. Don't wrap every `<div>`.
- Keep each comment under ~6 lines. If it's longer, something belongs in `WIRING.md` instead.
- Use the same vocabulary as the UI (e.g. if your status chips have tones "success / warn / fail / muted / info", use those words, and define them once in `WIRING.md`).
- Don't use the annotation to describe what the element looks like — the markup already does that.

## The test

Before sending a mockup: skim your annotations and ask — *could an engineer wire this up without coming back to ask me clarifying questions?* If no, add the missing `state:` or `note:` comment. If yes, you're done.
