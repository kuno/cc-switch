# OpenWrt B2.4 Design Reference

This directory is the designer-facing reference package for the current CC Switch OpenWrt B2.4 mockup.

Use it for:

- reviewing shared UI primitives outside the full product screen
- manually adjusting tokens like color, radius, spacing, and typography
- checking intended component behavior before editing the product mock itself
- handing visual rules to future contributors without forcing them to reverse-engineer `prototype/index.html`

Files:

- `index.html`: standalone UI reference mockup and component gallery
- `DESIGN_GUIDE.md`: design system guidance based on the current B2.4 visual direction

Notes:

- This package is reference-only. It is not wired to backend or LuCI runtime data.
- Interactive examples are mock behavior only unless backed by the real prototype.
- Any future product-screen changes should keep this reference package in sync.
