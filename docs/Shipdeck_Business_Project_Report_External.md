# Shipdeck — Business Project Report

**Document type:** Business project report for commercial discussions  
**Audience:** Buyers, evaluation teams, and partners  
**Product:** Shipdeck  
**Date:** 1 November 2026  
**Companion:** Shipdeck Idea Note (the short brief for a first meeting)

This report describes the product, the customer it serves, and the way an engagement is structured. Commercial terms are issued separately as a quotation.

---

## 1. Executive summary

Shipdeck is a visual control plane that carries a software change from a ticket to a running application. A person approves the plan, the code, and the release.

The product combines two engines.

- The **ticket engine** accepts a sample ticket, a pasted ticket, or a Jira issue. It writes an architecture, holds the work when the ticket is unclear or outside the organisation’s spend limits, produces the application after approval, checks it, and opens it in a workbench for review and tests. A passed review can open a GitHub pull request and report status back to Jira.
- The **ship engine** runs seven stages in a fixed order: get the code, prepare the host, package, database, go live, health check, and alert. The destination can be an existing server, or a new virtual machine, health endpoint, or full application on Amazon Web Services, Microsoft Azure, or Google Cloud. Practice mode walks the path with no cloud change. An environment the product created can be closed from the same run.

The customer keeps their tracker, their model vendor, their Git host, and their cloud account. Shipdeck is provided as an installed control plane, with a guided start for the first project. Cloud and model consumption stay on the customer’s own bills.

The natural first engagement is a **pilot**: one project, one destination, named approvers, a rehearsal, then a bounded live run. A briefing in practice mode is the step before that pilot, and it needs no cloud account.

---

## 2. The idea and why it matters

### 2.1 The idea

A ticket should become a live application, and a person should approve each step.

That outcome is still assembled by hand. The ticket sits in Jira. A developer or a model produces files. Someone else opens a pull request. Someone else owns the cloud. Someone else notices, a month later, that the demonstration environment is still billing. Nobody can open one screen and see the approved plan, the approved code, the approved release, the URL that answered, and the environment that was closed.

Shipdeck is that screen.

The stages stay the same from customer to customer. What changes is the login, the ticket, the size of the destination, and whether the run is a rehearsal or a live change.

### 2.2 The business situation

Delivery tooling has accumulated faster than a path through it.

- Trackers hold status. An approved architecture is a separate artefact.
- Coding models produce files. They do not carry the company’s approver, spend limit, test bar, or allowed destination.
- Pipelines run beautifully once someone has already built them.
- Cloud accounts create resources easily and retire them late.
- Audit is assembled afterwards from several products.

The business cost is calendar time on small applications, spend after the proof of concept, and a standing refusal to let a model near a live environment. Shipdeck exists so that a defined class of delivery — a ticket, an application, a known destination, and named human gates — follows one operator path.

### 2.3 This project

This business project is the market introduction of Shipdeck: packaging a working control plane into an engagement a buyer can evaluate, pilot, and continue. The buyer adopts the cockpit. The buyer does not replace Jira, GitHub, or their cloud provider.

---

## 3. Objectives

### 3.1 For the buyer

1. Give one operator a single path from ticket to URL.
2. Keep a named person on the plan, the code, and the release.
3. Rehearse before any cloud or model spend.
4. Use the same seven stages for an existing server and for a new machine, health endpoint, or full application on AWS, Azure, or Google Cloud.
5. Keep an audit of approvals and of access to secrets.
6. Close environments the product created, so a demonstration has an ending.

### 3.2 For a successful pilot

- The buyer’s operators complete a practice run on the sample journey with the product in their hands.
- One agreed piece of work passes the plan gate, the code gate, and the test bar, or the agreed scope is the ship path for an application they already have.
- One release reaches a health check on the agreed destination.
- If Shipdeck created the environment, it is closed from the product, or the buyer confirms in writing that it will be kept.
- The buyer can name the approvers and can find the run in History.

---

## 4. The product

### 4.1 The workplace

Shipdeck opens on **Home**. The rest of the workplace is:

| Screen | Purpose |
|---|---|
| Home | The three-step story, and the project in use |
| Tickets | Plan, build, tests, and approvals |
| Ship | The seven-stage release and the live console |
| History | Releases already started |
| Logins | Saved connections |
| Secrets | The credentials those logins hold |

A switch above the work chooses **Practice** or **Real cloud**. Practice is the rehearsal. Real cloud is live, and the release screen says so. Access is arranged in roles: people who view, people who operate, and people who administer the installation. A customer engagement runs with access control on.

### 4.2 Home

Home explains the path and holds the project. The operator opens an existing project or names a new one. Tickets and releases stay with that project, which is how a studio keeps each client’s work together.

### 4.3 Logins

Credentials are entered once and reused by name.

**For the build**

| Login | Role |
|---|---|
| Jira | Read the issue, comment the outcome, and accept an authorised start from Jira |
| Git | Read the repository and open the pull request |
| Model | Write the architecture, and write or revise the application |

**For the release**

| Login | Role |
|---|---|
| Server (SSH) | A machine the customer already runs |
| AWS, Azure, Google Cloud | Create or update the destination in that account |
| Containers and registry | Build and publish the image |
| Kubernetes | Release onto a cluster the customer already operates |
| Notify | Tell another system that the run has finished |

Each login can be tested before a run. Secrets are encrypted on the Shipdeck installation. The Secrets screen shows that a credential is present. Reading the value is a separate, recorded action.

The model can be one the customer already pays for: a cloud model platform, a model API, a private endpoint on their network, or Cursor for the implementation step. The key remains the customer’s.

### 4.4 The rules around a ticket

A live ticket proceeds when the organisation has named its approvers, set its spend limits, and connected a model and, where needed, Git. The test bar is lint, unit, and integration. Languages, package sources, and licences follow an allow-list the organisation controls. Those limits are the customer’s policy. They are separate from the commercial fee for Shipdeck.

### 4.5 Starting the work

| Choice | Meaning |
|---|---|
| Source | The built-in sample, a pasted ticket, or a Jira issue |
| Mode | Practice or real cloud |
| Kind of change | A new application, or a change to an existing repository |
| Destination | For a change to something already running: the server, or the cloud service that hosts it |

The sample is included, so a first session needs no customer data. It is a small warehouse story: reserve stock for an order, release it if the order is cancelled, and show whether a known item still has quantity. Its key is SHIP-1042.

An authorised Jira automation can start a run for an allowed project. A repeated signal returns the run already in progress.

### 4.6 The plan

The plan is a document the operator can hand to a stakeholder. It holds the intent, the structure, the API implied by the acceptance criteria, what is in scope, what is out, and the assumptions. A health check is part of every plan, because the release path needs something to call.

Practice uses Shipdeck’s rehearsal planner. Real cloud uses the customer’s plan model. Relevant comments and attachments are brought into the plan; material that does not belong to the ticket is left out. On a change to an existing repository, Shipdeck also prepares an impact view: what will change, where it lands, and what stays.

Unclear tickets stop on an open-questions page until the operator answers them. The operator can revise, reject, or stop the ticket.

### 4.7 The application and the workbench

Approving the plan produces the application on a branch named for the ticket, then checks the result before anyone accepts it. The operator opens the workbench, sees the page, and can:

- Edit the work directly.
- Ask for a change that stays inside this ticket, which returns as a revised plan for approval.
- Record an idea that is outside this ticket, so it can go back to Jira while the current application stays as approved.
- Ask the model to revise the files, including from a screenshot.

A dedicated test view limits a tester to test files.

### 4.8 Tests and review

Lint, unit, and integration run against the work. They stand in front of code approval. When review passes, Shipdeck can open or update a GitHub pull request whose description is the approved architecture.

### 4.9 From approval to release

When the operator approves the release, Shipdeck records who approved, prepares the Git login and the destination login, and moves the operator to the ship screen with those connections ready.

The release itself stays a separate act. The ticket can be complete and the cloud still unchanged, until an operator runs the pipeline. That separation is how a model, a webhook, or an enthusiastic approval stays clear of a live account.

### 4.10 The seven stages

**Get the code.** A local folder, or a clone of the repository. Shipdeck reads the stack so later stages can recommend a destination and a size.

**Prepare the host.**

| Choice | Result |
|---|---|
| Skip | No new host. Used for a local rehearsal |
| Existing server | The customer’s machine |
| Create | A new destination in the customer’s cloud account |

A created destination takes one of three shapes.

| Shape | What the business gets |
|---|---|
| Virtual machine | A server with containers ready, on AWS, Azure, or Google Cloud |
| Health endpoint | An address that answers a health check, useful for proving the path |
| Full application | The application on a managed container service, with a managed database and an HTTPS address. AWS, Azure, and Google Cloud each use their current managed container platform |

Shipdeck recommends a size from the detected application. The operator sees that recommendation before anything is created. Creation waits for an explicit apply decision.

**Package.** The application is tested and imaged, and can be pushed to the customer’s registry. On the managed full-application path, packaging is carried out with the cloud’s own build service from the Git repository, so the operator’s machine does not have to build the images.

**Database.** Optional. A database beside the application, or a managed database in the customer’s cloud. Data ports stay on the private side of the network.

**Go live.** Containers, a composed application, a service, or Kubernetes, or an update of the managed application. Public access is limited to the ports the application actually serves.

**Health check.** Shipdeck calls the application and reports the result. The run can roll back when the check fails.

**Alert.** A notification to the endpoint the team named.

The console states, in plain language, whether the run is rehearsing, waiting for approval, preparing a host, succeeded with an address, or stopped on a stage whose log is open.

**Close-out.** When Shipdeck created the environment, the operator can remove it from the run. Closing an environment and stopping a ticket are separate decisions, so a pause in the design work never implies a surprise change in the cloud account.

### 4.11 History and evidence

History lists releases with status and time, and keeps the log. Administration covers who may view, who may operate, and who may administer. The audit record covers policy changes, ticket decisions, file changes, test runs, and access to secrets. The installation can keep its records in PostgreSQL when the customer wants that.

### 4.12 Practice and live

| | Practice | Real cloud |
|---|---|---|
| Plan and build | A full rehearsal | The customer’s model |
| Jira | The path is shown locally | Status returns to the issue |
| Pull request | The review path is shown | A GitHub pull request when the team has asked for one |
| Release | Every stage is logged | Git, the server or the cloud, and the health check |
| Spend | None | The customer’s own cloud and model accounts, for the stages they chose to run |

A first meeting is complete in practice mode. A live cloud account is a later, explicit step.

### 4.13 A customer walk-through

1. Open Home and create a project in the customer’s words.
2. Leave the switch on Practice.
3. Start the sample ticket, SHIP-1042.
4. Read the architecture together. Show that an unclear ticket would have stopped here.
5. Approve the plan and open the workbench.
6. Run the test bar and approve the code.
7. Approve the release and show that Ship is the next screen, with the account still unchanged.
8. Walk the seven stages. In a following session the included sample can be run on the local machine, still without a cloud account.
9. Show History and the credential inventory.
10. Agree the one destination a pilot would use. Cloud creation belongs to that pilot, with the customer’s account and an apply decision still in front of it.

### 4.14 What a first session needs

A browser and the product. No cloud account, no model key, and no customer ticket, unless the customer prefers to paste one. A second session can add a local live run, a test of their Jira login, or a reading of a repository they already have.

---

## 5. How it is delivered

Shipdeck is installed in the customer’s environment and operated as their control plane. The workplace talks to the Shipdeck service. Calls to the model, Jira, Git, and the cloud leave from that installation, under the customer’s credentials.

| Concern | How it is handled |
|---|---|
| Where it runs | A host the customer controls. Container packaging is included, with an optional database for the product’s own records |
| Where applications are created | In the customer’s cloud account and region, or on a server they already run |
| Where model traffic goes | To the endpoint the customer configures, including a private or on-network endpoint |
| How infrastructure is created | Terraform modules supplied with the product, for the virtual machine, health endpoint, full application, and managed database paths |
| How a destination is chosen | Detection reads the application and recommends the shape and the size. The operator confirms before apply |
| How the product is kept current | The product is built and tested as a single application, so the workplace and the release engine stay on the same rules |

Customer data, credentials, and generated work remain on the customer’s installation.

---

## 6. The customer and the market

### 6.1 The job

The buyer is hiring a path: take a well-described application change from a ticket to a URL, under rules the company will sign, without designing that path again for every ticket.

That job appears in three places.

1. Product companies whose platform team is the bottleneck for internal tools and proofs of concept.
2. Studios and services firms who deliver many similar applications and currently restitch the tracker, the model, and the cloud for each client.
3. Teams who want the speed of a coding model and the comfort of a named approver, a spend limit, and a clean close-out.

### 6.2 Who sits in the evaluation

| Person | What they need to see |
|---|---|
| Delivery head, platform director, or studio founder | Practice mode, the three gates, close-out, and a pilot with a defined end |
| Platform engineer or senior developer | The seven stages, a tested login, History, and a local run |
| Security or risk | Encrypted credentials, recorded access, approval before apply, private data ports, and a customer-held cloud account |
| Finance | A Shipdeck fee on one line, and cloud and model invoices remaining with those vendors |

### 6.3 A strong first customer

The shortest path to value is a team that already has a ticket tracker, GitHub, and either one cloud account or one server, plus a backlog of small applications. They keep those tools. Shipdeck sits in front of them.

A team that already has the code, and wants the release cockpit, the rehearsal, and the close-out, is equally in scope. The ticket engine and the ship engine are adopted together or in the combination the pilot names.

### 6.4 Position among tools the buyer already funds

| They already have | Shipdeck’s place beside it |
|---|---|
| Jira | An architecture, gates, and a path to a URL, with status returned to the issue |
| GitHub | A start from the ticket, a rehearsal, and a create, verify, and close-out cockpit |
| Cloud accounts and Terraform | A fixed set of destinations, a recommended size, an approval, a health check, and removal |
| A coding assistant | Spend limits, a secrets check, a test bar, named approvers, and a release that waits for an operator |
| An internal platform programme | A paved path that can be installed and piloted now, for this class of delivery |

Shipdeck is adopted in front of those tools for one job. The tools stay.

---

## 7. Commercial model

### 7.1 What is purchased

1. The right to run Shipdeck on a host the customer controls.
2. The work to make the first path real: policy, logins, one project, operator enablement, and a bounded live run.

### 7.2 What stays on the customer’s own invoices

- Cloud consumption with Amazon, Microsoft, or Google.
- Model usage with the customer’s vendor.
- Jira and GitHub subscriptions.

That split keeps platform cost and consumption cost visible. A rehearsal avoids both consumption bills. A pilot names one destination so the live bill is bounded, and close-out is part of a successful finish.

### 7.3 Engagements

| Engagement | Purpose | What “complete” means |
|---|---|---|
| **Briefing** | Confirm fit | The customer has seen the gates and the seven stages on their own problem, in practice mode |
| **Pilot** | Prove one path | One agreed scope has passed the gates, one release has reached a health check, and the environment is closed or accepted |
| **Platform** | Leave the cockpit in daily use | The installation is theirs, with a named support window |
| **Implementation** | Add a further path | Another project, or another destination shape, after the first is in the operators’ hands |

A standard engagement leaves operations with the customer after handover. Their cloud administrators keep their own accounts. A studio may run one installation across client projects; each client remains a separate project, with that client’s own cloud credentials.

### 7.4 Commercial principles

- A pilot is a fixed piece of work with an end date and a success description.
- Platform use is annual, per installation, with an agreed operator capacity and support window.
- Cloud and model spend are estimated by the customer and sit outside the Shipdeck fee.
- Further destinations and further projects are quoted as implementation.
- The quotation states the fee, the weeks, the destination, and the support window. This report does not.

---

## 8. How an engagement proceeds

1. A conversation on the idea, using a real ticket from the customer’s backlog as the example.
2. A briefing in practice mode. No credentials. The meeting ends in a fit decision.
3. A written pilot: one scope, one destination, named approvers, a rehearsal, a live run, and a close-out.
4. Delivery by a person who runs the product with the customer’s operators.
5. A platform continuation once the pilot’s finish line has been met.
6. A customer reference only with the customer’s permission.

Direct engagement is the primary motion, because the value depends on the customer’s ticket, their approvers, and their destination. A studio partner is a natural second motion: the studio uses Shipdeck as part of how it delivers, for clients of its own.

Shipdeck does not impose a region. The control plane sits where the customer places it. Model calls use the endpoint they configure. Cloud resources are created in the region on their cloud login. Residency follows those choices.

---

## 9. Discovery before a proposal

A proposal is stronger when these are known:

1. The smallest application a stakeholder is waiting to open.
2. Where that work starts today.
3. Who may approve a plan, who may approve code, and who may change a live environment.
4. Whether the application is new or already in a repository.
5. Where the pilot should land: an existing server, or a new machine, health endpoint, or full application, and in which cloud.
6. Which model the organisation is allowed to use, and whether that endpoint is private.
7. What must be true on the last day for the customer to call the pilot a success.
8. Whether the environment should be closed or kept.

The proposal then names the buyer, the operator, the approvers, the scope, the destination, the dates, the finish line, the fee, and the support window.

---

## 10. Implementation of a pilot

| Step | Work | Customer provides |
|---|---|---|
| Install | Shipdeck on a host they control, with access control on and the credential key in their care | The host and the person who can reach it |
| Policy | Approvers, spend limits, and the Jira and GitHub choices | The names and the decisions |
| Logins | Tracker, model, Git, and one destination, each tested | Credentials from their administrators |
| Rehearsal | The sample or their ticket, through every gate | Their operators |
| Local release | The included sample to a health check on the machine | A container host |
| Live destination | One create or one existing server, apply confirmed by the operator, health check, History | Cloud or server access |
| Close and handover | Remove the environment if that was the agreement. The operator repeats the rehearsal | Written acceptance |

Handover is a working session. The customer’s operator runs the path. For a full application, the source is a Git repository the cloud build service can read, and the cloud identity is allowed to build and to create the data services. For a machine that already exists, Shipdeck needs to be able to reach it.

---

## 11. Security and control

Shipdeck is built so a risk reviewer can see the controls in the product.

- **Access.** View, operate, and administer are separate. Customer installations run with authentication on.
- **Credentials.** Encrypted on the installation. Ordinary screens confirm that a secret exists. Reading it is a separate, audited act. Cloud and model secrets stay server-side.
- **Change.** Named approval for the plan, the code, and the release. A further confirmation before infrastructure is applied. Practice as the default.
- **Network.** Data and administration ports are kept off the public internet. The operator can see which ports would be published before they are opened.
- **Evidence.** An audit of policy changes, ticket decisions, edits, tests, and secret access, plus the log of every release.
- **Placement.** One installation is the customer’s control plane. Projects organise work inside it. Customers who want hard separation run separate installations.
- **Continuity.** The customer holds the backup of the installation, including the key that protects stored logins.
- **Their responsibilities.** Their cloud account, their model contract, their Jira and GitHub permissions, the care of the host, and the custody of administration access.

---

## 12. Conclusion

Shipdeck takes a ticket to a plan a person approves, to an application a person reviews and tests, and to a release a person chooses to run. The same product can place that work on a server or a cloud destination and close the environment afterwards. The first meeting is a rehearsal, at no cloud cost and no model cost. Every underlying account remains the customer’s.

The commercial path is a briefing, a pilot with one destination and a written finish line, and then annual use of the installation. Terms are quoted for that engagement.

The promise to evaluate is the one on the home screen: a Jira ticket becomes a live app, and a person approves each step.

---

## Annex — Items to confirm in a quotation

| Item | Confirmed value |
|---|---|
| Customer legal name | |
| Economic buyer | |
| Operator | |
| Approvers for plan, code, and release | |
| Scope (ticket, repository, or both) | |
| Destination for the pilot | |
| Cloud and region, if a new environment is in scope | |
| Model, and whether the endpoint is private | |
| Jira project, or pasted tickets | |
| GitHub organisation, if pull requests are in scope | |
| Start and end | |
| Finish line | |
| Environment closed or kept | |
| Fee, currency, and support window | |
| Consumption the customer pays directly | |

---

*Shipdeck — a Jira ticket becomes a live app. You approve each step.*
