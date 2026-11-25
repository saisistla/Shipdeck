# Shipdeck — Idea Note

**For:** Customer conversations, partner briefings, and first commercial meetings  
**Product:** Shipdeck  
**Date:** 1 November 2026

---

## 1. The idea

A software change starts as a ticket and is meant to end as a running application. Between those two moments the work is spread across a tracker, a model, a repository, a cloud account, and a release step that nobody wants to take lightly.

**Shipdeck is the control plane for that path.**

A ticket becomes a plan a person can approve. The application is written, reviewed, and tested. A person approves the release. A visual ship path then places it on a server or a cloud target, checks that it answers, and can take the environment down again when the work is finished.

The line on the product home screen is the idea:

> A Jira ticket becomes a live app. You approve each step.

Three beats:

1. **Logins** — connect the tracker, the model, Git, and the cloud.
2. **Ticket** — plan, build, test, and approve.
3. **Ship** — deploy, verify, and close the environment when it is no longer needed.

The customer keeps their own Jira, their own model vendor, their own GitHub, and their own cloud account. Shipdeck is the cockpit in front of those accounts.

---

## 2. The problem

Teams already own capable tools. They do not own a single path through them.

| What the team already has | What the business still feels |
|---|---|
| A ticket | The plan lives in a chat thread. Nobody can point to an approved architecture. |
| A coding model | Files appear quickly. Cost limits, approvers, tests, and the allowed destination do not travel with them. |
| A repository and a pipeline | The pipeline starts after someone has already assembled the scripts. |
| A cloud account | Every demo is a fresh design. Sizing, release, health, and teardown depend on whoever is free. |
| An audit requirement | Approval is reconstructed afterwards from inboxes and consoles. |

The result is slow small applications, cloud left running after the demo, and leadership that will not let a model near a live environment. Shipdeck gives that leadership a path they can allow: a named person on the plan, a named person on the code, and a named person on the release.

---

## 3. What Shipdeck does

Shipdeck is one installed product with two engines, joined by the operator.

**Ticket.** The work starts from a sample ticket, a pasted ticket, or a live Jira issue. Shipdeck writes an architecture the operator can read: intent, components, the API implied by the acceptance criteria, what is in scope, and what is out. Unclear tickets stop for questions. Spend beyond the limits the organisation sets stops for a decision. After approval, the application is written into a project, scanned, and opened in a workbench. The operator reads the running page, edits, and runs the test bar. A passed review can open a GitHub pull request and write the outcome back to Jira.

**Ship.** Seven stages run in a fixed order:

1. Get the code, from a folder or from Git.
2. Prepare the host: use what already exists, or create a new one.
3. Package the application.
4. Attach a database when the application needs one.
5. Go live.
6. Check health.
7. Notify the people who should know.

A new environment can be a virtual machine, a health endpoint, or a full application with a managed database and an HTTPS address, on Amazon Web Services, Microsoft Azure, or Google Cloud. The same stages also release an application the team already has, onto a server they already run.

**Practice and live.** Practice is the default. The team walks the path and sees every stage, with no model spend and no cloud change. Live is an explicit switch. Creating infrastructure waits for a further approval. Release remains a conscious operator action after the ticket has been approved, so a model never spends cloud money on its own.

---

## 4. Who it is for

The first buyer is a team that already works in tickets, already has a cloud account or a server, and wants one operator to carry a small application from the ticket to a URL under rules the company will sign.

| Buyer | What they need | What they get |
|---|---|---|
| Platform or delivery lead | A standard path and an audit trail | Named gates, protected credentials, and one pipeline shape across three clouds |
| Engineering manager | A backlog item a stakeholder can click | A rehearsal with no cloud spend, then a live run when the team is ready |
| Product studio or services firm | The same delivery motion for many client applications | A project cockpit, a clean ending for each demo, and client-owned cloud credentials |
| Founder evaluating a pilot | Proof before a long platform programme | A working product and a first session that does not need a cloud account |

The daily user is the operator who connects logins, runs the ticket, and ships. Leadership buys the permission, the speed, and the end of orphaned environments.

---

## 5. What the customer experiences

**Home.** The three beats, and a project to work in. Tickets and releases stay with that project.

**Logins.** Credentials are entered once and reused. Build logins cover Jira, Git, and the model. Deploy logins cover the server, AWS, Azure, Google Cloud, containers, the registry, Kubernetes, and notifications. Each login can be tested. Secrets are stored encrypted. Access to a secret is a deliberate act and is recorded.

**Ticket.** Sample, paste, or Jira. A new application, or a change to an existing repository. On a change to something already running, the operator names the server or the cloud service that hosts it.

**Plan.** A document, not a chat log. The operator sends it back with a note, rejects it, or approves it. Open questions and spend limits hold the gate.

**Build.** The workbench shows the application. The operator can edit, ask for a change inside the ticket, or record an idea that belongs to a later ticket. A secrets check stands between generation and acceptance.

**Tests.** Lint, unit, and integration stand in front of code approval.

**Release approval.** The decision is recorded, the logins for the pipeline are prepared, and the operator moves to Ship.

**Ship.** The operator attaches the code and the destination, accepts or adjusts the recommended size, and runs. The screen shows the stage, the log, and a plain status, including the URL when the run succeeds. An environment Shipdeck created can be removed from that same run.

**History.** Past releases remain visible, with status, time, and logs.

Jira can start a run from an allowed project, and a live run can comment status back onto the issue. The model slot accepts the customer’s vendor: the major cloud model platforms, the leading model APIs, a private endpoint on their own network, or Cursor for implementation.

---

## 6. Why a buyer chooses it

- **One path.** Tracker, model, repository, and cloud follow the same operator journey every time.
- **Permission.** Leadership can allow a model because a named approver still signs the plan, the code, and the release, and because practice mode exists.
- **A clean ending.** Demo and proof environments are removed from the run that created them.
- **One shape across clouds.** The operator learns seven stages once. The destination can be an existing server or a new machine, health endpoint, or full application on AWS, Azure, or Google Cloud.
- **Bills stay where they are.** Model, Git, Jira, and cloud spend remain on the customer’s own accounts. Shipdeck is the control plane, not a reseller of those accounts.
- **A story a non-engineer can watch.** Home, ticket, plan, workbench, ship, URL.

---

## 7. How a commercial relationship works

The customer buys the right to run Shipdeck in their own environment, and the guided start that puts the first project through it. They continue to pay their cloud provider, their model vendor, Atlassian, and GitHub directly.

| Engagement | What it is for |
|---|---|
| **Briefing** | A working session in practice mode, on the sample ticket or on language from the customer’s own backlog. No cloud credentials required. |
| **Pilot** | One project, one destination, named approvers, a rehearsal, and a bounded live run with a defined end. |
| **Platform** | Annual use of the installation, operator access, and a support window. |
| **Implementation** | Further projects or a further destination, once the first path is in the team’s hands. |

Pricing is issued as a quotation for the engagement. It is not printed in this note. A briefing is the right first step: forty-five minutes, the customer’s latest small-application ticket on the table, and a clear fit decision afterwards.

---

## 8. Words for a first note

**One sentence.** Shipdeck turns a ticket into a live application, and a person approves the plan, the code, and the release.

**Email.** Teams already have Jira, a model, GitHub, and a cloud account. The delay is the handoff between them. Shipdeck is the cockpit for that handoff: connect the logins, approve the ticket, then ship through one visual path — get the code, prepare the host, package, database, go live, health check, and alert. It rehearses by default. Live cloud is a separate step, and an environment it created can be closed cleanly. We would like to show you the sample ticket in practice mode, with no cloud spend.

---

*Shipdeck — a Jira ticket becomes a live app. You approve each step.*
