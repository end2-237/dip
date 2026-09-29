# Architecture decisions (short ADRs)

## ADR-001 — Plain JavaScript, no build step (deviation from spec §4.2 / §14)
The spec recommends a pnpm + Turborepo TypeScript monorepo with WXT. The first priority was a usable
extension as fast as possible, so the extension is plain ES modules loadable with "Load unpacked"
and zero tooling. Shared code lives in `extension/lib/` and is imported as-is by the Node CLIs
(`cli/`). Migrating to TypeScript/WXT later is mechanical (the module boundaries follow the spec's
packages: probes, analyzer, taxonomy, llm, verify-core, schema).

## ADR-002 — Orchestrator runs in the side panel, not the service worker
MV3 service workers are suspended after ~30 s of inactivity; a scan lasts minutes. The side panel is
an extension page that stays alive while open and has access to `chrome.debugger`, `chrome.scripting`
and `chrome.tabs`, so it hosts the scan state machine and the analysis. The offscreen document is not
needed. Trade-off: closing the panel aborts the scan (the UI says so).

## ADR-003 — Deep mode injects probes with `Page.addScriptToEvaluateOnNewDocument`
In Deep mode the probes are installed through CDP, which guarantees execution before any page script
and needs no host permission. Standard mode uses `chrome.scripting.registerContentScripts`
(`world: MAIN`, `document_start`, `persistAcrossSessions: false`) after a per-origin permission request.

## ADR-004 — One CDP driver for the extension and for Playwright
`extension/lib/cdp-driver.js` only needs a `send(method, params)` function: `chrome.debugger.sendCommand`
in the extension, a Playwright `CDPSession` in `dip-capture` and the tests. The dev runner therefore
exercises the exact code path of the extension's Deep mode.

## ADR-005 — Motion recorder triggers
Scanning every element every frame is too expensive. Elements are tracked from the first frame they
change thanks to three triggers: (1) MutationObserver on `style` (JS libs write inline styles),
(2) class changes (CSS transitions/keyframes) put the subtree on a short per-frame watch list,
(3) `Element.animate` calls; plus an incremental background scan as a safety net. Measured overhead on
the fixtures: p95 < 0.5 ms per frame.

## ADR-006 — GSAP re-entrancy
GSAP calls itself internally (staggers create internal timelines, ScrollTrigger creates scrub tweens
and pin resets). The wrappers keep a depth counter and only record depth-0 (user) calls; tweens whose
targets are other GSAP animations and pure transform resets are ignored by the analyzer.

## ADR-007 — Verification contract via data attributes
A clone's DOM never matches the original. `AGENT_RULES.md` asks the agent to put
`data-dip-section` on section roots and `data-dip-effect` on effect targets; `dip-verify` uses them as
anchors for screenshots, layout boxes and motion sampling.

## ADR-008 — LLM through raw fetch with structured outputs
The extension has no bundler, so the Anthropic SDK is not importable; the Messages API is called with
`fetch` (`anthropic-dangerous-direct-browser-access`), BYOK key in `chrome.storage.local`.
Structured outputs (`output_config.format`) replace forced tool use (not supported on the current
Sonnet). A post-check flags any number absent from the measured data as `[estimated]`.
