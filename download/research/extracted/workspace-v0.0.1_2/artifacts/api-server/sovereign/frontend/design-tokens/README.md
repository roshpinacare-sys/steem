# @tfa/design-tokens

Machine-readable design-token foundation for the TFA frontend.

## Tokens

- **Primitives:** cyan OKLCH ramp (50–950) + cyan-tinted neutrals.
- **Semantic:** surface, text, accent, verified, danger, approval-pending.
- **Dark mode:** L-inversion of semantic tokens (lightness flipped around 0.5).
- **CSS output:** `toCssCustomProperties()` generates `:root` custom properties.

## Contrast CI Gate

Zero-dependency OKLCH → luminance converter with WCAG 2.1 AA checks.
All text-on-surface pairs are validated at build time.
