# Shipdeck — Idea Note

**For:** Sales team, first customer conversations, and internal alignment  
**Product:** Shipdeck (repository name: visual-devops-platform)  
**Release described:** 0.1.0, as built  
**Date:** 1 November 2026  
**Status:** Internal. Figures in the companion Business Project Report that are marked illustrative are planning assumptions, not a price list and not a quote.

---

## 1. The idea in one page

A software change still starts as a ticket and is supposed to end as a running application. Between those two moments the work is split across a tracker, a model or a developer, a repository, a cloud account, a pipeline, and a person who is afraid to press the live button.

**Shipdeck is the control plane for that path.**

A Jira ticket, a pasted ticket, or the built-in sample ticket is turned into a written plan. A person approves the plan. The product writes the application into a project folder, the person reads it in a workbench, and a test bar runs. A person approves the code. On a live run, Shipdeck can open a GitHub pull request and write a comment back to Jira. A separate ship pipeline then takes the code to a server or a cloud target: get the code, prepare the host, package it, attach a database, go live, check health, and send an alert. Every live cloud change is deliberate. The default mode rehearses the whole path and changes nothing in the cloud.

The sentence on the product home screen is the idea:

> A Jira ticket becomes a live app. You approve each step.

The operator path is three beats:

1. **Logins** — connect the tracker, the model, Git, and the cloud.
2. **Ticket** — plan, code, test, and approve.
3. **Ship** — deploy, verify, and, when the environment was created by Shipdeck, tear it down.

Shipdeck is sold as that cockpit. The customer keeps their own Jira, their own model vendor, their own GitHub, and their own AWS, Azure, or Google Cloud bill.

---

## 2. The problem this idea starts from

Teams already own the pieces. They do not own the join.

| What the team already has | What still goes wrong |
|---|---|
| A ticket in Jira or in a document | The ticket is read by a person, then re-typed into a chat window. The plan is a thread, not a document the company approved. |
| A coding model or a coding agent | The model can write files. It does not know the company’s approver, cost cap, test bar, or which cloud the app is allowed to land on. |
| GitHub | The pull request appears late, after the interesting decisions are already made. |
| Terraform, Docker, and three clouds | The same delivery is rebuilt by hand for a VM, a function, or a full application with a database. Sizing, ports, and teardown are specialist work. |
| A CI system | CI runs when someone has already produced a repository and a pipeline file. It does not start from the ticket, and it does not rehearse a cloud create without spending money. |
| An audit requirement | “Who approved the plan, who approved the code, who allowed Terraform apply, who revealed a key” is reconstructed from chat and cloud logs. |

The buyer feels this as delay, rework, and risk:

- A small internal app (a desk tool, a reservation screen, a client demo) takes a platform engineer, a developer, and a cloud person, even when the application itself is small.
- Demos leave virtual machines and databases behind because teardown was never part of the run.
- Leaders will not let a model write straight into production, and they have no product that puts a named person on the plan, the code, and the deploy.
- Every new cloud account means a new set of scripts. The delivery shape does not stay the same.

The idea is to make the ticket the unit of work, keep a person on each gate, and use one visual run for the release.

---

## 3. The product idea

Shipdeck has two engines. They stay separate until the operator joins them. That separation is the product, not an accident.

**Ticket engine.** Intake is a sample ticket, a pasted ticket, or a live Jira issue. The plan model (or a built-in rehearsal planner) writes an architecture the operator can read: intent, diagrams, components, an API table taken from the acceptance lines, what is in scope, and what is out. If the ticket is ambiguous, approval is refused until the questions are answered. If the forecast is over the token cap or the cost cap, approval is refused. After approval, a code model writes the project. A secrets scan runs before the code can be accepted. The operator opens a workbench, runs the app, edits by hand or with the model, and runs lint, unit, and integration checks. Approving the code can open a GitHub pull request. Approving “ship” records the decision and prepares the logins for the pipeline. It does not, by itself, create cloud resources.

**Ship engine.** Seven stages run in a fixed order:

1. **Get code** — a local folder or a Git clone.
2. **Prepare host** — skip, use a server the customer already has, or create a new one.
3. **Package** — tests and a container image on the server path. This stage is skipped when the target is serverless, because the image or package is produced with the cloud path.
4. **Database** — a container database, or a managed cloud database.
5. **Go live** — Docker, Compose, systemd, or Kubernetes on a machine; or the serverless release.
6. **Health check** — an HTTP probe, with optional rollback.
7. **Alerts** — a webhook when the run should notify someone.

Create-infrastructure can land in three shapes, on Amazon Web Services, Microsoft Azure, or Google Cloud:

- A virtual machine with Docker.
- A small health function (a URL that returns a health payload).
- A full application: containers, a managed database, a cache, and an HTTPS address. On AWS this uses ECS Express. On Azure it uses Container Apps. On Google Cloud it uses Cloud Run.

The ship engine can also release an application the ticket engine did not write. A team can point it at an existing folder or repository and run the seven stages. The ticket engine is how a change is born. The ship engine is how a folder becomes a URL.

**Practice and real cloud.** Practice is the default. It walks the ticket and the pipeline and writes logs. It does not call the model and it does not change a server. Real cloud is an explicit switch. Terraform apply is a second, separate permission. A run can stop and wait for a person to approve the deploy step.

---

## 4. Who it is for

The first buyer is a team that already lives in tickets and already has a cloud account, and that wants one operator to carry a small application from the ticket to a URL without giving a model a blank cheque.

| Buyer | What they are trying to do | Why Shipdeck fits |
|---|---|---|
| Platform or DevOps lead in a product company | Give delivery a standard path and an audit trail | Named gates, encrypted keys, an audit log, and one pipeline shape across three clouds |
| Engineering manager of a small product team | Turn a backlog item into something a stakeholder can click | Sample ticket and practice mode for the first meeting; real cloud when they are ready |
| IT services or product studio | Repeat the same delivery motion for many client demos and small apps | Project-by-project cockpit, tear-down after a demo, customer-owned cloud credentials |
| Founder or delivery head buying a pilot | See the path before a long platform programme | A working product, not a slide. Practice mode needs no cloud spend |

The daily user is an **operator**: the person who connects logins, starts a ticket, approves or rejects, and runs the pipeline. A **viewer** can look. An **admin** can change platform settings and create users. The economic buyer is the person who owns delivery speed and cloud risk, not the person who wants another chat window.

Shipdeck is a weak first sale for a team that wants an unrestricted coding agent, a replacement for their entire CI catalogue, or a model that deploys itself with no human gate. Those buyers should be declined or narrowed to the ship cockpit only.

---

## 5. How a customer experiences it

This is the product, in the order a person meets it.

**Home.** The product states the three beats and asks the operator to open a project or name a new one. Tickets and ship runs stay with that project. Nothing executes from Home.

**Logins.** Credentials are typed once and reused. They are split into two folders so a sales demo can stay honest about what is for building and what is for releasing:

- Build logins: Jira, Git, and the model (plan, code, or both).
- Deploy logins: SSH, AWS, Azure, Google Cloud, Docker, a container registry, Kubernetes, and a notify webhook.

A connection can be tested before it is trusted. Secrets are stored encrypted. A separate Secrets screen lists every expected key, shows a mask and a fingerprint, and reveals plaintext only on purpose. That reveal is written to the audit log.

**Ticket.** The operator starts from the sample ticket (a warehouse stock-reservation story, key SHIP-1042), from text they paste, or from a Jira key. They choose a new application or a change to an existing repository. For a live change to an existing repository they also name the server or cloud service that already runs it.

**Plan.** The operator reads `architecture.md`. They can send it back with a note, reject it, or approve it. Open questions block approval. A forecast over the cap blocks approval. The default caps are 200,000 tokens and 25 US dollars for that plan. Those caps are safety limits inside the product. They are not the price of Shipdeck.

**Code.** Approval writes a project folder on a branch named `shipdeck/<ticket>`. The operator opens the workbench, sees the page, and can edit files, ask for a change that stays inside the ticket, or record an ask that is out of scope (that ask can be commented back to Jira and does not change the code). A secrets scan failure stops the run.

**Tests.** Lint, unit, and integration must pass before code approval. The only skip in the product is on this gate, and it is an explicit decision, not a silent bypass.

**Approve to ship.** This records who approved, creates or reuses the Git login and the server or cloud login, and tells the operator to open Ship. The cloud is unchanged until someone runs the pipeline.

**Ship.** The operator attaches the code and the host, chooses skip / existing server / create, chooses the size the product recommends, and runs. The screen shows the active stage, the logs, and a plain status sentence (practice, waiting for approval, running, succeeded with a URL, or failed). When Shipdeck created the environment, the operator can destroy it from the run.

**History.** Past pipeline runs stay visible: status, time, and the way back to the logs.

A Jira webhook can start a run when the shared secret matches and the project key is allowed. Live runs can comment the new status back onto the issue.

---

## 6. What is different

Sales should say these things, because they are true of the product as built.

1. **The ticket is the job, and a person signs each gate.** Plan, code, and deploy are separate approvals. Reject and kill exist. Kill stops the ticket. It does not destroy cloud; destroy is a separate act on a pipeline run.
2. **Practice is the default.** A first meeting can show the whole path with the sample ticket and no model bill and no cloud bill.
3. **The model is the customer’s.** Plan and code are two slots. Chat models cover the major vendors and private endpoints, including a local Ollama-style host. Cursor can act as the code agent. The customer’s key is stored encrypted on the Shipdeck host. Shipdeck does not take a cut of the model bill.
4. **The cloud is the customer’s, and the shape is fixed.** AWS, Azure, and Google Cloud. Virtual machine, health function, or full application. Terraform apply is gated. Private ports (SSH, databases, and similar) are not published to the internet.
5. **Tear-down is part of the run.** An environment Shipdeck created can be destroyed later, which is the practical answer to orphaned demo infrastructure.
6. **Two products in one cockpit, joined on purpose.** Teams that already have code can use Ship alone. Teams that start from a ticket use both, and the ticket never silently starts Terraform.

---

## 7. What the customer gets on day one

A working control plane they can run themselves:

- A web application and an API, in a repository that builds and tests in continuous integration.
- Docker Compose packaging (web, API, and optional PostgreSQL).
- Practice mode, a sample ticket, and a sample application for a local live run that needs only Docker.
- Encrypted secret storage, roles (viewer, operator, admin), rate limiting, and an audit log.
- Jira intake and write-back, GitHub pull requests, and the seven-stage ship path described above.

They bring: a machine or a private host for Shipdeck, and, when they leave practice mode, their own model key, GitHub token, Jira token, and cloud credentials. Terraform is required only when they create infrastructure.

---

## 8. What sales must not promise

This release is a control plane with a deliberate scope. Overselling it will fail in a pilot. Say the boundary in the first meeting.

| Topic | What is true now |
|---|---|
| Kind of product | A ticket-to-live-app control plane with a fixed ship path. It is not a general CI catalogue and it does not replace Jira, GitHub, or the cloud console. |
| Applications the ticket engine writes | A small Node application produced from the approved architecture, with fixture-style data, a health URL, and the test bar. Python is on the language allow-list; the runner that executes the sandbox is Node. |
| “Approve ship” | Saves the decision and the logins. The operator runs the pipeline afterwards. |
| Pull requests | GitHub. Other Git hosts keep the branch locally for the operator. |
| Coding agents listed in the policy screen | Cursor runs as a folder agent. Other folder-agent names are shown and refused in a live run. Chat models write files and are supported. |
| Identity | Local users and a bearer token. Single sign-on is not in this release. |
| Compliance certificates | The product encrypts secrets and writes an audit log. That is not a SOC 2 or ISO certificate. Do not claim one. |
| Multi-tenant public SaaS | The product is installed and operated as the customer’s control plane. Billing, tenant isolation, and a public signup are not part of this release. |
| Cost cap of $25 | A per-plan safety stop inside a ticket. It is not the licence fee. |

If a prospect needs a promise from the right-hand column, the honest move is a pilot scoped to what the left-hand column already does, or a decline.

---

## 9. Why a buyer agrees

The purchase is justified in the buyer’s language, not in feature names.

- **Time.** A small application follows one path instead of a fresh design for tracker, model, repository, pipeline, and cloud.
- **Permission.** Leadership can allow a model because a named approver still signs the plan, the code, and the release, and because practice mode exists.
- **Waste.** Demo and proof environments can be destroyed from the run that created them.
- **One shape across clouds.** The operator learns seven stages once. The target can be an existing server or a new VM, function, or full application on any of the three clouds.
- **Their keys stay theirs.** Model, Git, Jira, and cloud credentials are the customer’s. Spend on those vendors stays on those vendors’ bills.
- **A story a non-engineer can watch.** Home, ticket, plan, workbench, ship, URL. That is a demonstration, not a workshop.

---

## 10. How the business works

Shipdeck is an installed product plus a guided start. The customer pays Shipdeck for the control plane and for the work of putting their first project through it. The customer pays Amazon, Microsoft, Google, Atlassian, GitHub, and the model vendor directly.

Recommended offer, to be priced by leadership before anyone quotes:

| Offer | What the customer buys | What “done” means |
|---|---|---|
| **Briefing** | A working session in practice mode on the sample ticket, then a look at their ticket and their cloud | They have seen the gates and the seven stages on their own language |
| **Pilot** | One project, one cloud, practice plus a bounded live path, named approvers, a fixed number of weeks | One ticket has passed the gates, and one pipeline run has reached a health check or a documented stop |
| **Platform** | Annual use of a Shipdeck installation, operator access, and a support window | The cockpit is theirs to run on further projects inside the agreed boundary |
| **Implementation** | Connection setup, policy (caps, approvers, Jira project keys), first pipeline, and a rehearsal with their team | Their operators can repeat the path without the seller in the room |

Do not bundle cloud consumption or model tokens into the Shipdeck price. The product is designed so those bills stay visible to the customer, and the safety caps exist so a plan cannot run away.

A full commercial sketch, a sales motion, a demo script, and the risk register are in the Business Project Report.

---

## 11. The first sale

The first sale is a pilot, not a platform replacement.

**Qualify in.** They use a ticket tracker (Jira is the live integration). They can name one small application. They have one cloud account or one server. They will name three human gates: plan, code, deploy. They accept practice mode as the first session. They accept that the ticket engine writes a small Node application, or they already have code and only need the ship cockpit.

**Qualify out.** They want the model to deploy unattended. They want every language and every CI job in one purchase. They want a compliance certificate this quarter. They will not put a named person on the gates.

**Proof.** Meeting one is practice mode and SHIP-1042, ending on a plan the buyer can read. Meeting two is either the sample application run locally with Docker, or a read-only look at their cloud login. The pilot statement of work names one ticket, one target, and the destroy step.

---

## 12. Words sales can say

**One sentence.** Shipdeck turns a ticket into a live application, and a person approves the plan, the code, and the release.

**Email.** Teams already have Jira, a model, GitHub, and a cloud account. The delay is the handoff between them. Shipdeck is the cockpit for that handoff: connect the logins, approve the ticket, then ship through one visual path — get code, prepare the host, package, database, go live, health check, alert. It rehearses by default. Live cloud is a separate, explicit step, and an environment it created can be torn down. We would like to show you the sample ticket in practice mode, with no cloud spend.

**What we are asking for in a first meeting.** Forty-five minutes, their latest small-app ticket on the table, and a decision afterwards on a bounded pilot. No credentials required for the first session.

---

*End of idea note. The Business Project Report is the document to leave with a serious buyer and to brief a new salesperson. Keep both documents together. If the product gates, the ship stages, or the model and cloud support change, update both.*
