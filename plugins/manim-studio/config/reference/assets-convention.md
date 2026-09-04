# manim-studio shared-assets convention

Every manim-studio workspace (OSS or SaaS) supports a curated `assets/`
folder that lives ONE LEVEL UP from `renders/`. The animator agent
checks it before every scene and prefers imports over inline
redefinition — so successive renders in the same project stay visually
consistent.

## Layout

```
manim-studio/
├── assets/                        ← shared across all renders
│   ├── colors.py                    brand palette constants
│   ├── fonts.yaml                   font families the animator uses
│   ├── helpers/                     reusable animation utilities
│   │   ├── transitions.py
│   │   └── layouts.py
│   └── templates/                   reusable Scene base classes
│       └── title_scene.py
└── renders/<slug>/                ← per-render bundle
    ├── scene.py                     imports from ../../assets/*
    ├── script.md
    └── manifest.json
```

## File conventions

**`assets/colors.py`** — plain Python module. Uppercase constants for
brand palette. Example:

```python
BRAND_BLUE = "#0EA5E9"
BG_DARK    = "#0F172A"
ACCENT     = "#F59E0B"
GRID       = "#334155"
```

**`assets/fonts.yaml`** — declared font families. The animator may use
these names in `Text(..., font=...)` kwargs and no others:

```yaml
families:
  - AlfaSlabOne     # display / titles
  - Poppins         # body / narration
  - JetBrainsMono   # code / equations
```

**`assets/helpers/*.py`** — small reusable modules. One concept per
file. Examples:

- `transitions.py` — `slide_in`, `fade_between_slides`
- `layouts.py` — `two_column`, `headline_bullet`, `stat_card`

**`assets/templates/*.py`** — reusable Scene base classes. Example
signature:

```python
from manim import Scene
class BrandedTitleScene(Scene):
    """Scene base with brand title, subtitle, and end card."""
    TITLE: str = ""
    SUBTITLE: str = ""
    def construct(self):
        ...
```

## Animator obligations

Before writing `scene.py`, the animator MUST:

1. Enumerate `assets/` (via `ls` on OSS, `list_workspace_files` on SaaS).
2. Read every file it might reuse (`read_file` / `read_workspace_file`).
3. Import concrete symbols where applicable:
   ```python
   from assets.colors import BRAND_BLUE, BG_DARK
   from assets.helpers.transitions import slide_in
   from assets.templates.title_scene import BrandedTitleScene
   ```
4. If it invents a helper that the NEXT scene would also need
   (a palette, a transition, a layout function), write it into
   `assets/helpers/<name>.py` BEFORE calling `render_scene`.

Never redefine anything that already exists in `assets/`. That's the
whole point of the folder.

## Bootstrap behavior

When `assets/` is empty on the first render, the director agent asks
the user whether to seed a foundation (colors + fonts + a title
template) proactively, or start rendering right away. If the user
elects to seed, the director delegates a one-off "foundation" task to
the animator with the explicit brief.

Never auto-create assets silently — assets are curated content that
represents the user's/brand's style.
