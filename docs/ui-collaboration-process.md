# UI Collaboration Process

## Purpose

This document defines how UI work should move between the designer agent, the implementation agent, and verification.

The goal is to stop mixing visual design, backend truth, and implementation details in the same pass. UI changes should start from an explicit visual source of truth, then move into implementation in small, reviewable slices.

## Core Rule

Design first, then bind.

That means:

- the designer agent decides how the screen should look
- the implementation agent decides how to build it within LuCI, shared UI, and backend constraints
- verification checks that the live result matches both the visual contract and the backend truth

## Roles

### Designer agent

Owns:

- mockups
- prototype updates
- layout hierarchy
- spacing
- typography
- theme behavior
- visual cleanup
- placeholder labeling for unsupported controls

Does not own:

- RPC design
- daemon/UCI schema
- LuCI ownership boundaries
- implementation architecture

### Main implementation agent

Owns:

- LuCI host vs workspace split
- backend mapping
- binding matrix
- implementation plan
- code changes
- test plan
- packaging and verification

Does not treat a mockup as backend truth without checking the repo.

### Verification / reviewer agents

Own:

- scope checks
- contract checks
- regression checks
- bundle/package checks

Do not quietly redesign the product while verifying it.

## Standard Workflow

### 1. Define the change

Every UI task starts with a short statement of:

- what screen or region is changing
- whether it is a new surface, layout revision, polish pass, or interaction change
- what must stay fixed

### 2. Send the change to the designer first

Provide the designer agent with:

- current live screenshot
- current prototype or mock
- reference screenshots if any
- real backend and LuCI constraints
- unsupported controls that must remain placeholder-only

Ask the designer for:

- revised mockup or prototype
- short rationale
- explicit note on what is real vs placeholder

### 3. Freeze one design output

Before implementation starts:

- choose one approved mockup or prototype
- do not mix multiple drafts
- treat the approved design as the visual source of truth

### 4. Translate design into implementation

The main implementation agent creates:

- a binding matrix for each visible UI element
- LuCI-owned vs workspace-owned boundary
- backend gaps
- phased implementation order

Each visible element should be classified as one of:

- real now
- adapter-only
- needs backend work
- visible placeholder/no-op

### 5. Implement in small slices

Do not rewrite the whole page at once.

Typical slice order:

1. shell and layout frame
2. list and selection structure
3. first real detail pane
4. remaining panes
5. dialogs and editor flows
6. polish and responsive cleanup

### 6. Review with screenshots

After each meaningful slice:

- capture the live result
- compare it against the approved design
- send only the visual delta back to the designer if needed

Do not ask the designer to review backend code or RPC wiring.

### 7. Final visual signoff

Before calling a UI phase complete:

- get final screenshot-based visual approval
- keep backend correctness and package verification with the implementation/review agents

## Required Handoff Packet

Whenever the designer is involved, the handoff should include:

### Source of truth

- live screenshot
- current prototype or mock file
- reference image if relevant

### Objective

- what must change visually

### Constraints

- what data is real today
- what backend is missing
- what LuCI must continue to own
- what controls are placeholder-only

### Expected output

One of:

- revised mockup
- revised prototype
- annotated screenshot
- region-by-region design delta

## Required Implementation Packet

Before coding starts, the implementation packet should state:

- approved design artifact
- binding matrix
- file ownership split
- backend additions required
- explicit deferrals
- verification plan

## Recommended OpenWrt Split For This Project

For `cc-switch` on OpenWrt:

- LuCI remains the host shell
- top daemon/host controls remain LuCI-owned in behavior
- the bottom workspace can be implemented as a richer custom surface
- unsupported controls may stay visible only when explicitly marked as placeholder/no-op

This means the usual pattern is:

1. designer updates the prototype
2. implementation agent maps it to real LuCI/backend behavior
3. reviewer verifies scope and regressions
4. designer checks the final visual result

## What To Avoid

- coding first and asking for design approval later
- treating a mockup as proof that the backend already supports a control
- mixing multiple mockup revisions into one implementation pass
- letting verification lanes carry production design changes
- silently replacing placeholder controls with invented backend semantics

## Default Decision Rule

If a screen looks wrong but the behavior boundary is still unclear:

- stop implementation
- get a new design artifact or annotated delta first
- then resume implementation from the updated spec

## Current Use On The B2.3 OpenWrt UI

For the B2.3 rebuild:

- the prototype is the visual source of truth
- the top block should stay minimal and truthful
- the bottom workspace should match the approved design before deeper backend expansion
- unsupported controls should remain visible only as placeholders until real backend support exists
