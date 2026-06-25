# Running A Codespaces Demo

This guide describes how to run a disposable Revelation SRS demo directly from
GitHub Codespaces.

Codespaces demos are intended for short reviews, UAT sessions, and contributor
exploration. A demo Codespace should be kept for **no more than 12 hours**.

## What The Demo Starts

The demo profile starts:

| Component | Port |
|---|---:|
| SRS API | `3000` |
| Admin console | `5173` |
| Student portal | `5174` |
| Keycloak | `8081` |
| Temporal UI | `8233` |
| PostgreSQL, NATS, Temporal | internal / local ports |

The default demo scenario is `assessment-marks`, which is large enough for most
feature walkthroughs without the startup time of the full `institution-year`
dataset.

## Option 1: Start From GitHub

1. Open the repository on GitHub.
2. Select **Code**.
3. Select **Codespaces**.
4. Select **Create codespace on main**.
5. If GitHub asks for a devcontainer, choose **Revelation SRS Demo**.
6. Wait for setup to finish.
7. Open the **Ports** tab.
8. Open the forwarded **Admin console** and **Student portal** URLs.

The setup script will:

1. Install dependencies.
2. Start the required Docker Compose services.
3. Write Codespaces-aware `.env` files.
4. Configure Keycloak redirect URLs for the generated Codespaces URLs.
5. Run database migrations.
6. Load the selected demo scenario.
7. Start the API, admin console, and student portal.

## Option 2: Create From The Command Line

Maintainers can create a demo Codespace with the helper script:

```bash
bash scripts/codespaces/create-demo.sh
```

The script defaults to:

| Setting | Default |
|---|---|
| Repository | `RevelationCore/Revelation-SRS` |
| Branch | `main` |
| Machine | `standardLinux32gb` |
| Idle timeout | `30m` |
| Retention period | `12h` |
| Devcontainer | `.devcontainer/demo/devcontainer.json` |

Override defaults with environment variables:

```bash
REPO=my-org/Revelation-SRS \
BRANCH=my-demo-branch \
MACHINE=standardLinux32gb \
RETENTION_PERIOD=12h \
bash scripts/codespaces/create-demo.sh
```

## Selecting A Scenario

Inside the Codespace, the startup script reads `SRS_DEMO_SCENARIO`.

Default:

```bash
SRS_DEMO_SCENARIO=assessment-marks
```

To use the full institution-year dataset, set:

```bash
SRS_DEMO_SCENARIO=institution-year
```

The full dataset is more representative, but it takes longer to load and needs
more Codespaces capacity.

## Demo Accounts

All demo accounts use:

```text
Demo-2026!
```

Student portal accounts:

| Username | Purpose |
|---|---|
| `alice.demo` | Standard enrolled student |
| `bob.demo` | Student with wellbeing and EC history |
| `carol.demo` | Student with adjustments / graduated history |

Admin accounts:

| Username | Role |
|---|---|
| `registry` | Registry Administrator |
| `chair` | Exam Board Chair |
| `wellbeing` | Wellbeing Advisor |
| `dpo` | Data Protection Officer |
| `examiner` | External Examiner |
| `ops` | Platform Operator |

## Sharing The Demo

Use the **Ports** tab in Codespaces.

For a private UAT session, set the Admin and Portal ports to the least permissive
visibility that works for the audience:

| Visibility | Use when |
|---|---|
| Private | Only you need access |
| Organization | Internal reviewers are in the same GitHub organization |
| Public | External reviewers need the link |

Do not share the Keycloak admin URL publicly.

## Stopping Or Deleting The Demo

The demo is created with a 30-minute idle timeout and a 12-hour retention period.
Stop or delete it earlier when the session is finished.

List Codespaces:

```bash
gh codespace list
```

Stop a Codespace:

```bash
bash scripts/codespaces/stop-demo.sh <codespace-name>
```

Delete a Codespace:

```bash
bash scripts/codespaces/delete-demo.sh <codespace-name>
```

## Troubleshooting

Logs are written inside the Codespace:

```text
.codespaces/logs/
```

Useful checks:

```bash
docker compose -f infra/compose/docker-compose.yml ps
pnpm demo:validate
curl http://localhost:3000/health
```

If authentication redirects fail, restart the Codespace. The startup script
re-writes the frontend `.env` files and re-applies the Codespaces redirect URLs
to the Keycloak clients.

