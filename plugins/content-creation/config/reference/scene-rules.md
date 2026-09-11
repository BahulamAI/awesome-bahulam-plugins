# Manim CE scene-writing rules

Rules the animator agent (both OSS and SaaS) must follow when producing
a `scene.py`. Substrate-agnostic — the render command differs by
deployment but the source has to satisfy these rules in either case.

## Manim CE only

- `from manim import *`
- Never ManimGL (`from manimlib import *` — different API surface,
  incompatible with the deployed manim community edition)

## Class shape

- Exactly one Scene subclass per file
- Class name MUST match the `scene_class` argument passed to `render_scene`
- Class extends `Scene` (not `ThreeDScene`/`MovingCameraScene` unless the
  storyboard explicitly calls for 3D or camera pans)
- All animation logic inside a single `construct(self)` method
- End with `self.wait(1)` so the last frame isn't cut off

## Length

- Target 15-30 seconds of animation per scene
- Longer stories → propose splitting into multiple scenes + a compose step
- Keep total objects on screen under ~20 for draft renders

## Composition

- Fit text and equations within the 16:9 frame:
  - `VGroup(...).arrange(...)` for stacked elements
  - `.next_to(...)`, `.to_edge(...)`, `.scale_to_fit_width(...)` where needed
- No labels overlapping graphs, axes, dots, or each other
- Opening frame is not blank for more than a moment (fade in fast)

## Preferred animations

- `Text`, `MathTex` for anything typographic
- `Circle`, `Square`, `Line`, `Arrow`, `Dot` for primitives
- `Transform`, `Create`, `FadeIn`, `FadeOut`, `Write`, `Indicate` for motion
- Avoid heavy 3D throughout unless the storyboard demands it

## Forbidden patterns

Any of these will fail the AST validator server-side and cannot render:

- `eval(...)`, `exec(...)`, `__import__(...)`, `compile(...)`, `open(...)`
- Attribute access to `__subclasses__`, `__globals__`, `__builtins__`, `__mro__`
- Imports outside the allowlist: `manim`, `numpy`, `np`, `math`, `random`, `colour`

Dynamic scene generation is fine via regular Python control flow (loops,
comprehensions, numpy arrays) — just not `eval` / `exec`.

## Quality tiers

| Alias | Resolution/FPS | Typical render time | Retail credits (SaaS) |
|---|---|---|---|
| `l` / `720p` | 480p15 (OSS) / 720p (SaaS) | ~10-15s | 50 |
| `m` / `1080p` | 720p30 (OSS) / 1080p (SaaS) | ~20-30s | 100 |
| `h` / `1440p` | 1080p60 (OSS) / 1440p (SaaS) | ~40-60s | 200 |

- Use the lowest tier that works for the draft loop
- Only promote to higher tier after the user has approved the storyboard

## Retry policy

- On `scene_validation` error: read the AST error line, fix, retry ONCE
- On `render_execution` error: read the last ~500 chars of stderr, fix,
  retry ONCE
- On `upload` / `internal` errors: DO NOT retry — surface to the director
  (these are infra bugs, not scene bugs)
- Hard cap: 2 total render attempts per brief. If both fail, return the
  errors verbatim so the director can escalate or abandon

## Example — minimal scene

```python
from manim import *

class Pythagoras(Scene):
    def construct(self):
        eq = MathTex("a^2 + b^2 = c^2").scale(1.5)
        self.play(Write(eq))
        self.wait(1)
        self.play(Indicate(eq[0][0:2]))
        self.wait(1)
```
