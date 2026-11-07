# CueMesh interface direction

Use the user's final cobalt/lilac palette and selected four-tile mark. Apple’s display-page reference informs large centered typography, whitespace and paced native scrolling on the introduction. CueMesh keeps its own graphics, identity and copy.

| Token / role   | Light   | Dark    |
| -------------- | ------- | ------- |
| Canvas         | #F6F5FA | #101527 |
| Surface        | #FFFFFF | #171F37 |
| Text           | #151C33 | #F6F5FA |
| Primary action | #3659F5 | #3659F5 |
| Accent         | #B5A5EF | #B5A5EF |
| Secondary text | #626A80 | #B6BED8 |

System sans-serif typography, compact monospace metadata, subtle separators and restrained 6–12px radii. White text on cobalt actions; midnight text on lilac selection. Focus remains visible to keyboard users. Legacy CSS variable names lime/moss are compatibility names for lilac/cobalt, not green colors.

## Introduction

A centered headline leads into the context → CueMesh → agents diagram. Show model names directly, with a compact expandable seven-role routing table. Three native-scroll chapters explain the product; the sticky diagram advances at the viewport center. Reduced-motion users get the complete content without decorative movement. No scroll hijacking or animation dependency.

## Workspace

Assume users already understand the tool. Primary hierarchy is **Task → Agents → Result**. No onboarding steps, decorative instructions or setup prompts in the run view.

A compact Run button opens a themed menu with short run identifiers, goals, dates and status. Keyboard arrows, Home/End, Escape and focus return are supported. Project description, plan, timestamps and usage sit in the inspector, not scattered between headings. Full task output appears after selection. Long result paragraphs can expand. Demo model routing is visible only in demo mode.

The team page uses functional headings, project membership, context and conversation. Account forms call server v1. Necessary error, permission, static-preview and sample-data labels stay explicit.

## Responsive and language behavior

Navigation wraps on narrow widths. Side rails become compact navigation or lower-page panels; selecting a task focuses its inspector on mobile. Use logical spacing for RTL, wrapping for long titles, contained scrolling for code/tables and 44px touch targets. Do not reduce input font below 16px on touch screens.

Browser language is the default, with a saved explicit override and 11 lazily loaded catalogs. User-authored data and model identifiers are not translated. Dark/light/system settings persist independently of authentication.
