# B2C 選單 Design QA

- Source visual truth: `C:\Users\ACER\Downloads\image.png`
- Local source copy: `C:\Users\ACER\Documents\Codex\2026-07-28\new-chat\work\ecoco-audit-hardening\outputs\design-qa\source-menu-reference.png`
- Implementation screenshot: `C:\Users\ACER\Documents\Codex\2026-07-28\new-chat\work\ecoco-audit-hardening\outputs\design-qa\b2c-menu-mobile-equipment.png`
- Combined comparison: `C:\Users\ACER\Documents\Codex\2026-07-28\new-chat\work\ecoco-audit-hardening\outputs\design-qa\comparison.png`
- Viewport: 430 × 900 CSS px
- Source pixels: 403 × 679
- Implementation pixels: 415 × 868
- Device scale factor: browser reported approximately 1; both images were compared at their native aspect ratios in one stacked comparison page.
- State: B2C mobile chat, main category menu visible, after selecting「設備操作問題」the equipment submenu is visible.

**Full-view comparison evidence**

The source and implementation both present the guided flow inside the chat: greeting, primary categories, equipment follow-up, and a persistent composer. The implementation intentionally keeps the existing ECOCO brand header and official knowledge badge while removing the desktop introduction panel and duplicate top shortcut row on mobile, so the first actionable menu appears immediately.

**Focused region comparison evidence**

The primary and secondary menu regions were reviewed at readable native size. Button hierarchy, grouping, labels, focus treatment, borders, spacing, and official device names were legible, so no additional crop was needed.

**Required fidelity surfaces**

- Fonts and typography: existing Noto Sans TC stack is preserved; headings, category labels, and helper copy have a clear weight hierarchy and no truncation.
- Spacing and layout rhythm: menu cards use consistent 8–12 px rhythm, 42 px minimum target height, and aligned chevrons. Mobile content does not require the user to pass through the desktop hero panel.
- Colors and tokens: existing ECOCO blue, orange, white, and light-blue background tokens are retained. Contrast is sufficient for primary copy and controls.
- Image quality and asset fidelity: existing ECOCO logo and mark assets are reused; no logo, illustration, or icon was recreated with CSS, emoji, or placeholder geometry.
- Copy and content: main categories match the supplied flow, with an added「站點查詢」entry because it is a core live-Hive capability. Device submenu uses「ECOCO 智慧收瓶機」and「ECOCO 智慧電池機」only.

**Comparison history**

1. Initial pass found a P2 flow issue: the desktop introduction card appeared before the menu on mobile. Fixed by hiding the desktop-only introduction and duplicate shortcut bar at the mobile breakpoint.
2. Second pass found a P2 alignment issue: bot avatars were aligned to the bottom of tall menu cards. Fixed by top-aligning bot rows.
3. Final pass confirmed the primary menu, equipment submenu, input controls, and official terms at 430 × 900. No browser console errors were present.

**Primary interactions tested**

- Opened the B2C customer chat at the mobile breakpoint.
- Selected「設備操作問題」.
- Confirmed「ECOCO 智慧收瓶機」and「ECOCO 智慧電池機」appear.
- Confirmed the composer and nearby-station action remain available.
- Checked browser console errors: none.

**Findings**

- No actionable P0, P1, or P2 findings remain.
- P3: the existing ECOCO header is visually denser than the supplied reference, but it is consistent with the production design system and does not delay the menu.

**Open Questions**

- None for this implementation.

**Implementation Checklist**

- Keep the mobile menu as the first actionable chat content.
- Preserve official equipment terminology in future menu and knowledge changes.
- Retest the LINE quick-reply payload after deployment with the production LINE Official Account.

**Follow-up Polish**

- The mobile brand header can be compacted in a later visual-only pass if more vertical space is needed.

final result: passed
