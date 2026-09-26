# FS-CC — Visual QA / Rendering Notes

## Browser zoom & device pixel ratio

Perform all visual QA of the FS-CC UI at **browser zoom = 100%**.

The screenshot that triggered the UI modernization work was captured at **90% zoom**.
Fractional browser zoom (90%, 110%, 125%) and fractional `devicePixelRatio` cause the
browser to sub-pixel-scale borders, 1px rules and text, which reads as "soft" or
"blurry" even when the CSS is correct. This is a browser rendering artifact, **not** an
application defect — do not change application code to compensate for non-100% zoom.

If practical, also spot-check at **90% / 110% / 125%** to confirm layout does not break,
but treat 100% as the reference.

### Runtime diagnostics to capture when reporting a rendering issue

Run in the browser console and include the output with any blur report:

```js
console.log({
  devicePixelRatio: window.devicePixelRatio,
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
});
```

A `devicePixelRatio` that is not a whole number (e.g. 1.25, 1.5) combined with
non-100% zoom is the most common cause of whole-page softness.

## Sharp-UI rules (enforced from Phase 2 onward)

- No `backdrop-blur` / `backdrop-filter` on persistent chrome (Topbar) or modal overlays.
- No neon/glow shadows (`0 0 Npx` halos) on status dots, logos or buttons.
- No `shadow-2xl` / `shadow-xl`; use `shadow-card` (subtle) or `shadow-card-hover`
  (dialogs) only where elevation is meaningful.
- Status indicators are solid semantic-color dots (crisp), not glowing.
- Colors come from the Phase 1 semantic tokens — no arbitrary hex in components.
