# Hoàn Lại Design System

Adapted for this cashback product from the Wise-inspired `DESIGN.md` in
[`VoltAgent/awesome-design-md`](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/wise).
The source collection is MIT licensed. This defines our own product identity;
do not copy Wise trademarks, logos, proprietary fonts, or marketing copy.

## Direction

Friendly Vietnamese fintech: calm, direct, trustworthy, and easy to scan on a phone.
Use strong typography and surface contrast instead of decorative gradients,
glass effects, generic illustrations, or excessive shadows.

## Tokens

- Primary: `#9fe870`; hover `#cdffad`; pale `#e2f6d5`.
- Ink: `#0e0f0c`; deep green: `#163300`.
- Body: `#454745`; muted: `#868685`.
- Canvas: `#ffffff`; soft canvas: `#e8ebe6`.
- Positive: `#2ead4b`; warning: `#ffd11a`; negative: `#d03238`.
- Display: Inter/system sans, weight 900, compact line height.
- Body: Inter/system sans; labels and buttons weight 600.
- Spacing: 4, 8, 12, 16, 24, 32, 48px.
- Cards/buttons: 24px radius; inputs: 12px; badges: full pill.

## Components

- Primary buttons are lime with near-black text, at least 48px tall, pill-shaped.
- Secondary buttons use sage; tertiary buttons are white with a 1px ink border.
- Inputs are white with a 1px ink border and visible green focus ring.
- Default cards are white on sage with no shadow; surface contrast is elevation.
- Wallet cards may invert to near-black with lime highlights.
- Auth uses the same tokens and controls as the main product.

## Layout

- Container around 1200px.
- Desktop hero is split; stack below 768px.
- Use generous whitespace and short, concrete Vietnamese copy.
- Touch targets are at least 48px high.

## Guardrails

- One accent color only.
- No glassmorphism, neon glow, stock dashboard, or decorative AI imagery.
- Never hide payout rules in low-contrast fine print.
- Never imply cashback is confirmed before ACCESSTRADE approves and confirms it.
