# AgentSkills

Reusable agent skills maintained in one repository and packaged separately.

## Available skills

### archify

Creates beautiful, verifiable architecture, workflow, sequence, data-flow,
and lifecycle diagrams as self-contained HTML artifacts.

- Source: [skills/archify](skills/archify/)
- Upstream: [XsAndre-L/archify](https://github.com/XsAndre-L/archify)
- [Download only archify.skill](https://raw.githubusercontent.com/XsAndre-L/AgentSkills/main/packages/archify.skill)

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
