# raspberry-pi

Raspberry Pi GPIO and I2C sensor operations runtime for Bahulam plugins.

The goal is not "the agent can shell into a Pi" as a raw capability. The
goal is a visible, approval-gated workflow where users ask Bahulam to read
sensors or drive GPIO pins, see exactly what's declared and what's pending,
and explicitly approve every write before it touches real hardware.

The entry agent connects to a board, discovers its GPIO/I2C state, declares
the pins involved (flagging anything with a real-world physical effect), and
only executes a write after the user has explicitly approved that specific
call. Reads never require approval on any target.

## Three target kinds, one contract

- **`local`** — the plugin runtime is installed and running on the Pi
  itself. Tools shell out to `pinctrl`/`raspi-gpio`, `i2c-tools`, and
  `vcgencmd` directly.
- **`ssh`** — the plugin runs on a separate machine and drives a remote Pi
  over SSH. Same commands, executed remotely via `ssh2`. Credentials are
  never passed as tool arguments: `auth_env` names an environment variable
  holding an SSH private key path or password, resolved only at execution
  time and never echoed back in any report.
- **`virtual`** — a fully simulated board, for testing and demos without
  any hardware or network access. `pi_gpio_write`, `pi_gpio_read`, and
  `pi_sensor_read` read/write a simulated pin/register state instead of
  touching a real process or connection. `pi_board_discover` synthesizes
  the same shaped output from that seeded state. **Virtual boards are
  approval-gated exactly like real ones** — the point of a virtual board is
  to prove out the same agent behavior safely, not to skip the approval
  model.

## What it provides

- A primary Raspberry Pi Operator agent.
- Pin Planner and Pi Safety Reviewer sub-agents.
- Durable state for boards, declared pins, actions, and (for virtual
  boards) simulated pin/register values.
- A workspace panel for boards, the pin map, and the action/approval trail.
- The same tool contract across local hardware, a remote Pi over SSH, and a
  simulated board — hosted implementations can expose it through MCP/
  Context Forge against a managed device fleet or a hosted simulator.

## Example prompts

```text
Connect to my Pi at 192.168.1.42 as user "pi" using the key in
MY_PI_SSH_KEY. Discover the board, then read the temperature sensor at
0x48, register 0x00.
```

```text
Set up a virtual Pi to test blinking a status LED on GPIO17. Seed it, then
turn the LED on — ask me before actually writing the pin.
```

## Tools

| Tool | Purpose |
|---|---|
| `pi_board_connect` | Connect/reuse a board target: `local`, `ssh`, or `virtual`. |
| `pi_board_discover` | Probe (or synthesize, for virtual) board model, GPIO pin state, and I2C devices. |
| `pi_pin_configure` | Declare a pin's mode, role, and whether it's an actuator. |
| `pi_gpio_write` | Set a digital level or PWM duty cycle. Always requires `approved: true` to execute. |
| `pi_gpio_read` | Read a digital pin's level. No approval required. |
| `pi_sensor_read` | Read an I2C register (`i2cget`). No approval required. |
| `pi_sim_seed` | Virtual boards only — preload pin levels, register values, and optional faults. |
| `pi_action_record` | Record an action, approval, error, or freeform note. |
| `pi_board_report` | Build a `PI_HANDOFF` report: board state, pin map, action trail, pending approval gates. |
| `pi_board_diagram` | Render the board's declared pins as a Mermaid flowchart, grouped by mode, actuator pins highlighted. |

## Visualizing the board

`pi_board_diagram` returns Mermaid flowchart source for a board's declared
pins — one subgraph per mode (`in`/`out`/`pwm`/`i2c`/`spi`), each pin
labeled with its role, and actuator-flagged pins styled distinctly so
real-world-effect pins stand out. It returns both the raw `mermaid` source
and a ` ```mermaid ` fenced `markdown` block, so:

- any chat surface that renders Mermaid code fences shows the diagram
  directly in the agent's reply, and
- the workspace panel renders the same diagram live (via Mermaid, loaded
  from a CDN) in its **Board diagram** card, redrawing whenever the board's
  state changes.

## Testing without hardware

`target_kind: virtual` plus `pi_sim_seed` let you script a deterministic
scenario with no Pi at all:

```text
pi_board_connect { name: "ci-bench", target_kind: "virtual" }
pi_sim_seed { board_id: 1, pins: [{ pin: 17, level: false }],
              registers: [{ address: "0x48", register: "0x00", value: "23.5" }] }
pi_board_discover { board_id: 1 }
```

You can also seed a `fault: "write_fails"` or `fault: "read_fails"` on a
pin/register to test how the agent reports a failed action.

## Runtime setup

This plugin has no `package.json` — it runs inside the Bahulam CLI, not as a
standalone Node package. `target_kind=ssh` needs the optional `ssh2` runtime
dependency declared in `plugin.yaml`'s `config.requirements.optional_runtime`;
if it isn't available, `pi_gpio_write`/`pi_gpio_read`/`pi_sensor_read`/
`pi_board_discover` fail with a clear "ssh2 is required for target_kind=ssh"
error instead of a silent no-op.

For `target_kind=local` or `target_kind=ssh`, the target Pi needs
`pinctrl` (or `raspi-gpio`), `i2c-tools`, and `vcgencmd` — all present by
default on Raspberry Pi OS. `target_kind=virtual` needs none of these.

## Test

```bash
node plugins/raspberry-pi/selftest.mjs
```
