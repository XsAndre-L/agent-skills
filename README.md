# Agent Skills

Reusable agent skills maintained in one repository and packaged separately.

## Available skills

### project-scaffold

Creates deterministic Angular and full-stack repository structures from
composable internal pieces.

- Source: [skills/project-scaffold](skills/project-scaffold/)
- [Download only project-scaffold.skill](https://raw.githubusercontent.com/XsAndre-L/agent-skills/main/packages/project-scaffold.skill)

The package contains only `project-scaffold`; downloading it does not require
cloning this repository or downloading the other skills.

On Windows, download it directly with:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/XsAndre-L/agent-skills/main/packages/project-scaffold.skill -OutFile project-scaffold.skill
```

Import the resulting `.skill` package into a compatible agent, or extract it
to that agent's personal skills directory. The archive contains one top-level
`project-scaffold/` folder.

## Repository layout

```text
agent-skills/
├── skills/
│   └── <skill-name>/       # Independent editable skill source
└── packages/
    └── <skill-name>.skill  # Independent downloadable package
```

Every skill must remain self-contained beneath its own folder. Add its packaged
`.skill` file under `packages/` and list both paths above.
