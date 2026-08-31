# hello-world

The minimal reference plugin for Bahulam. Copy it and start hacking.

## What's inside

```
hello-world/
├── plugin.yaml                  # the manifest
├── tools/
│   ├── hello.mjs                # a synchronous, one-arg tool
│   ├── word-count.mjs           # structured output, input validation
│   └── collatz.mjs              # pure math trick, bounded work, chartable output
├── workspace/
│   └── index.html               # a panel that calls the tools live
├── selftest.mjs                 # `node selftest.mjs` to smoke-test handlers
└── README.md
```

## Install

```bash
# by registry name (once merged into awesome-bahulam-plugins)
bahulam plugin install hello-world

# from this repo
bahulam plugin install https://github.com/BahulamAI/awesome-bahulam-plugins
```

## Try it

```bash
bahulam plugin hello-world .
```

Opens a workspace with the "Hello World" tab in the central panel. Every
button in the tab calls a plugin tool.

Or invoke the sub-agent from any REPL:

```
> /run hello-greeter Ravi
```

## Test the handlers offline

```bash
node plugins/hello-world/selftest.mjs
```

## Learn more

- [Plugin authoring guide](https://docs.bahulam.ai/plugins)
- [Contributing to the registry](../../CONTRIBUTING.md)
