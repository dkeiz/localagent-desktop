# Design/Layout Problems To Revisit

Date: 2026-04-23

1. Global overflow lock is too aggressive and can cause clipping/floating side effects.
- `src/renderer/styles/theme.css:546`
- The rule applies `overflow: hidden !important` to many layout containers.

2. Composer alignment is controlled in too many places, causing style conflicts.
- `src/renderer/styles/layout/layout-core.css:164`
- `src/renderer/styles/buttons.css:74`
- `src/renderer/styles/theme.css:579`
- This makes small spacing/alignment changes unpredictable across skins.

3. Some skin selectors use escaped quotes in CSS selectors (odd formatting, easy to miss during maintenance).
- `src/renderer/skins/design-b/skin.css:1`
- `src/renderer/skins/design-c/skin.css:1`
- `src/renderer/skins/design-ab/skin.css:1`

4. `design-d` relies heavily on `!important` overrides, which can diverge behavior from other skins.
- `src/renderer/skins/design-d/skin.css:104`
- This was also related to the recent chat composer vertical gap issue.

