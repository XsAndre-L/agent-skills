# AgentSkills

Reusable agent skills maintained in one repository and packaged separately.

## Custom skills

### project-scaffold

Creates deterministic Angular and full-stack repository structures from
composable internal pieces.

- Source: [skills/project-scaffold](skills/project-scaffold/)
- [Download only project-scaffold.skill](https://raw.githubusercontent.com/XsAndre-L/AgentSkills/main/packages/project-scaffold.skill)

The package contains only `project-scaffold`; downloading it does not require
cloning this repository or downloading the other skills.

On Windows, download it directly with:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/XsAndre-L/AgentSkills/main/packages/project-scaffold.skill -OutFile project-scaffold.skill
```

Import the resulting `.skill` package into a compatible agent, or extract it
to that agent's personal skills directory. The archive contains one top-level
`project-scaffold/` folder.

## Official Anthropic skills

### frontend-design

Anthropic's guidance for distinctive, intentional frontend design and UI/UX
implementation.

- Source: [skills/frontend-design](skills/frontend-design/)
- Official upstream: [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design)
- Imported revision: [`41bbe19`](https://github.com/anthropics/skills/commit/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f)
- [Download only frontend-design.skill](https://raw.githubusercontent.com/XsAndre-L/AgentSkills/main/packages/frontend-design.skill)

### mcp-builder

Anthropic's guide for building high-quality MCP servers that integrate external
APIs and services with Python or Node/TypeScript.

- Source: [skills/mcp-builder](skills/mcp-builder/)
- Official upstream: [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/mcp-builder)
- Imported revision: [`b9e19e6`](https://github.com/anthropics/skills/commit/b9e19e6f44773509fbdd7001d77ff41a49a486c1)
- [Download only mcp-builder.skill](https://raw.githubusercontent.com/XsAndre-L/AgentSkills/main/packages/mcp-builder.skill)

### skill-creator

Anthropic's official workflow for creating, improving, evaluating, and
packaging skills that follow the Agent Skills open standard.

- Source: [skills/skill-creator](skills/skill-creator/)
- Upstream: [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/skill-creator)
- [Download only skill-creator.skill](https://raw.githubusercontent.com/XsAndre-L/AgentSkills/main/packages/skill-creator.skill)

### template-skill

Anthropic's official minimal starting template for creating a new Agent Skill.
Its placeholder description and instruction must be replaced in each derived
skill.

- Source: [skills/template-skill](skills/template-skill/)
- Official upstream: [anthropics/skills template](https://github.com/anthropics/skills/tree/main/template)
- Imported revision: [`ef74077`](https://github.com/anthropics/skills/commit/ef740771ac901e03fbca3ce4e1c453a96010f30a)
- [Download only template-skill.skill](https://raw.githubusercontent.com/XsAndre-L/AgentSkills/main/packages/template-skill.skill)

## Official Vercel Labs skills

### agent-browser

Vercel Labs' browser automation skill for navigating websites, interacting
with elements, extracting data, taking screenshots, and testing web apps.
The skill requires the `agent-browser` CLI and loads version-matched workflow
instructions from the installed CLI.

- Source: [skills/agent-browser](skills/agent-browser/)
- Official upstream: [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser/tree/main/skills/agent-browser)
- Imported revision: [`4a98df7`](https://github.com/vercel-labs/agent-browser/commit/4a98df79bd232fcde5ca3a4a48e1337b8108b160)
- License: [Apache-2.0](skills/agent-browser/LICENSE.txt)
- [Download only agent-browser.skill](https://raw.githubusercontent.com/XsAndre-L/AgentSkills/main/packages/agent-browser.skill)

## Official Archify skill

### archify

Creates beautiful, verifiable architecture, workflow, sequence, data-flow,
and lifecycle diagrams as self-contained HTML artifacts.

- Source: [skills/archify](skills/archify/)
- Official upstream: [tt-a1i/archify](https://github.com/tt-a1i/archify)
- Imported revision: [`5769ace`](https://github.com/tt-a1i/archify/commit/5769acefcc2ebd696a4f9ed3ac9cb6cca1d75c70)
- [Download only archify.skill](https://raw.githubusercontent.com/XsAndre-L/AgentSkills/main/packages/archify.skill)

## Repository layout

```text
AgentSkills/
├── skills/
│   └── <skill-name>/       # Independent editable skill source
└── packages/
    └── <skill-name>.skill  # Independent downloadable package
```

Every skill must remain self-contained beneath its own folder. Add its packaged
`.skill` file under `packages/` and list both paths above.
