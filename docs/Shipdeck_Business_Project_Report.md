# Shipdeck — Business Project Report

**Document type:** Business project report for market introduction  
**Audience:** Sales, delivery leadership, and a serious buyer’s evaluation team  
**Product:** Shipdeck  
**Release described:** 0.1.0, as built in the visual-devops-platform repository  
**Date:** 1 November 2026  
**Companion:** `docs/Shipdeck_Idea_Note.md` (the short document for a first conversation)

This report describes the product that exists, the business around it, and the way a sales team should take it to market. Sections marked **illustrative** are planning assumptions for internal discussion. They are not a quotation, not a researched market-size claim, and not a commitment of price.

Legal entity, registered address, promoter names, and the signed price list are not in the product repository. Annex D is the list those owners must complete before a proposal goes out.

---

## 1. Executive summary

Shipdeck is a visual control plane that carries a software change from a ticket to a running application, with a person approving the plan, the code, and the release.

The product is two engines in one installed application.

- The **ticket engine** accepts a sample ticket, a pasted ticket, or a Jira issue. It writes an architecture, refuses to proceed when the ticket is unclear or over a cost and token cap, generates a small application after approval, scans it for secrets, lets the operator read and edit it in a workbench, runs a test bar, and can open a GitHub pull request. Approving the release records the decision and prepares logins. It does not create cloud resources.
- The **ship engine** runs seven stages in a fixed order: get code, prepare host, package, database, go live, health check, and alerts. The host can be skipped, an existing server, or a new virtual machine, health function, or full application on Amazon Web Services, Microsoft Azure, or Google Cloud. Practice mode is the default and changes nothing in the cloud. An environment the product created can be destroyed from the run.

The customer keeps their tracker, their model vendor, their Git host, and their cloud account. Shipdeck is paid for as an installed control plane and as the service of putting the first project through it. Cloud and model consumption stay on the customer’s own bills.

The honest first sale is a **pilot**: one project, one target, named approvers, practice first, then a bounded live run. The product is ready to be shown and to be piloted inside the boundary in Section 6. It is not ready to be described as a general CI platform, an unattended coding agent, a multi-tenant public service, or a certified compliance programme.

The commercial recommendation is four offers — briefing, pilot, annual platform use, and implementation — with prices set by leadership before any quote. An illustrative sketch is in Section 16 so sales can see the shape. It is not a rate card.

---

## 2. Basic idea and why the project exists

### 2.1 The idea

A ticket should become a live application, and a person should approve each step.

Today that sentence is a hope. The ticket sits in Jira. A developer or a model turns it into files in a chat or an editor. Someone else opens a pull request. Someone else owns Terraform. Someone else owns the pipeline. Someone else notices the virtual machine is still running a month after the demo. Nobody can point to a single screen and say: this plan was approved, this code was approved, this release was approved, this URL answered the health check, and this environment was destroyed.

Shipdeck is that screen.

It was built as an operator’s cockpit, not as a marketplace of pipeline plugins. The stages do not change from customer to customer. What changes is the login, the ticket, the size of the machine, and whether the run is a rehearsal or a real change.

### 2.2 The situation the project answers

Software delivery has accumulated tools faster than it has accumulated a path.

- Trackers are good at status and poor at holding an approved architecture.
- Coding models are good at files and poor at company gates. They do not know the approver, the cost cap, the allowed languages, or which ports must stay private.
- CI systems are good at running a pipeline that already exists. They start after the repository and the scripts exist.
- Cloud accounts are good at creating resources and poor at making creation, verification, and teardown one operator action.
- Audit is reconstructed afterwards from five products.

The cost shows up as calendar time on small applications, as cloud waste after proofs of concept, and as leadership refusal to let a model near a real environment. Shipdeck’s project purpose is to remove the seams for a defined class of delivery: a ticket, a small application or an existing folder, a known host or one of three cloud shapes, and named human gates.

### 2.3 What “project” means here

This business project is the market introduction of a product that is already built to version 0.1.0. It is not a request to invent the cockpit. The build, the web application, the API, the Terraform modules, the ticket state machine, and the tests exist. The project from this point is to package that product into an offer a buyer can evaluate, pilot, and renew.

---

## 3. Objectives

### 3.1 For the buyer

1. Give one operator a single path from ticket to URL.
2. Keep a named person on the plan, the code, and the deploy.
3. Rehearse the path before any cloud or model spend.
4. Use the same seven stages for an existing server and for a new VM, function, or full application on AWS, Azure, or Google Cloud.
5. Leave an audit of approvals, key reveals, and run results.
6. Destroy environments the product created, so a demo has an ending.

### 3.2 For the business

1. Make the first revenue a paid pilot with a written boundary, so delivery can succeed.
2. Sell the control plane and the implementation. Leave cloud and model invoices with the customer.
3. Standardise the demonstration on practice mode and the sample ticket, so every salesperson shows the same product.
4. Refuse work that sits outside Section 6, or re-scope it before signature.
5. Turn a successful pilot into an annual platform installation on the same host pattern.

### 3.3 What success looks like in a pilot

All of the following are true:

- The buyer’s operators completed a practice run on the sample ticket without the seller driving every click.
- One agreed ticket passed plan approval, code approval, and the test bar, or the ship-only path was the agreed scope and the ticket engine was not promised.
- One pipeline run reached a health check on the agreed target, or it stopped on a documented product boundary with the buyer’s written acceptance.
- If Shipdeck created cloud resources, the buyer destroyed them from the product, or accepted them in writing as kept.
- The buyer can name the three approvers and can find the run in History.

---

## 4. Product description, inch by inch

This section is the product a salesperson must be able to walk. Screen names match the application.

### 4.1 What the operator sees

The application opens on **Home**. The sidebar is:

| Screen | What it is for |
|---|---|
| Home | The three-step story, and the project the operator is in |
| Tickets | Plan, code, tests, and the approvals |
| Ship | The seven-stage pipeline and the run console |
| History | Pipeline runs that have already been started |
| Logins | Saved connections |
| Secrets | Every secret those logins are expected to hold |

Above the workspace, once the operator has left Home, they see the project name and a switch: **Practice** or **Real cloud**. Practice writes the simulate flag. Real cloud is live. The same switch governs a ticket when it starts. On the Ship screen, live mode shows a warning. Appearance (light or dark) sits in the sidebar and does not change behaviour.

Three roles exist, in this order: viewer, operator, admin. Looking is available to a viewer. Starting runs, changing pipelines, and revealing secrets require an operator. Platform settings and user administration require an admin. Until an administrator token or a user exists, the installation can run open, which is acceptable for a local demonstration and unacceptable for a customer pilot. A pilot turns authentication on.

### 4.2 Home

Home does not run anything. It states the idea and offers two actions: open a project that already exists, or name a new one. Tickets and ship runs belong to the project. This is how a studio keeps one client’s work off another client’s screen, on a single installation.

### 4.3 Logins

A login is a named connection. The operator types credentials once. Later steps refer to the connection by name. The screen is split so the story stays clear.

**Build folder** — used while the ticket is being planned and written:

| Login | What it holds | What it is used for |
|---|---|---|
| Jira | Site, email, deployment (cloud or data centre), token, webhook secret | Read an issue. Comment status back. Accept a webhook that starts a run |
| Git | Repository URL and token | Read an existing repository. Open a GitHub pull request |
| Model | Vendor, endpoint, role (plan, code, or both), and the API key | Write the architecture. Write or edit code |

**Deploy folder** — used when the pipeline runs:

| Login | What it holds | What it is used for |
|---|---|---|
| SSH | Host, user, private key or password | An existing server |
| AWS | Region, access keys, and a deploy key | Create or update AWS targets |
| Azure | Subscription, tenant, client id and secret, deploy key | Create or update Azure targets |
| Google Cloud | Project id and credential JSON, deploy key | Create or update Google Cloud targets |
| Docker | Local Docker context | Build and run containers on the Shipdeck host or a prepared machine |
| Registry | Registry, repository, password | Push an image |
| Kubernetes | Kubeconfig | Deploy onto a cluster |
| Notify | Webhook endpoint and optional token | Tell another system the run finished |

A connection can be probed before a run. The probe returns a short result and a hint. It does not dump a raw stack trace into the screen. Saving a build connection can fill the ticket policy, so the operator does not type the Jira site and the model endpoint in two places.

Secrets live in an encrypted file (AES-256-GCM). The key comes from an environment variable or from a key file created on first use. That key must stay stable; if it changes, stored secrets cannot be read. The Secrets screen lists expected keys, including ones that are still missing, and shows a mask plus a fingerprint. Plaintext is returned only when an operator asks to reveal it, and that action is audited.

### 4.4 Tickets — the policy around the work

Before a live ticket will start, the policy has to be complete enough to be safe:

- A rollback owner, and three approver names (architecture, code, deploy).
- A test bar of lint, unit, and integration. The product forces this bar when the policy is saved. It cannot be edited down to nothing.
- Allow-lists for languages, package sources, and licences. Defaults are Node and Python; npm and PyPI; MIT, Apache-2.0, and BSD-3-Clause.
- A chat model for planning, with an endpoint and a key.
- A code model the product can actually call.
- A Git token when the vendor or the change needs one.

Default safety stops are 200,000 tokens and 25 US dollars on the plan forecast. Either one blocks approval. Leadership can raise them in policy. Sales must describe them as brakes, not as the price of the product.

The plan slot accepts chat vendors only: Azure OpenAI, Amazon Bedrock, Google Vertex AI, Databricks, Snowflake Cortex, IBM watsonx, Cloudflare Workers AI, OpenAI, Anthropic, Google Gemini, Mistral, Cohere, xAI, DeepSeek, and a long list of OpenAI-compatible hosts, plus Ollama and a private endpoint. The code slot accepts those chat vendors, and Cursor as a folder agent. Other folder-agent names can be selected in the screen and are refused when a live run tries to use them. Sales should say “chat models, and Cursor for code,” and stop there.

Git policy defaults to GitHub, base branch `main`, and automatic pull requests off. Automatic pull requests are an explicit choice.

### 4.5 Starting a ticket

The operator starts a run with four choices that matter in a sales conversation.

| Choice | Meaning |
|---|---|
| Source | Sample ticket, pasted ticket, or Jira key |
| Mode | Practice or real cloud, following the switch |
| Change | New application, or a change to an existing repository |
| Target | For a live change to an existing repository: the SSH host, or the AWS, Azure, or Google Cloud service that already runs it |

The sample ticket is part of the product, so a demonstration needs no customer data:

- **Key:** SHIP-1042
- **Summary:** Reserve stock when an order is placed
- **Need:** Warehouse staff reserve stock for an order, release it if the order is cancelled, and see whether a known SKU still has quantity left

If that ticket key already has an active run in the same project, Shipdeck returns the existing run instead of starting a second one.

A Jira webhook can start a run. The caller must present the shared secret. The project key must be on the allow-list. A repeated webhook id returns the original run.

### 4.6 Plan

The plan is a document, `architecture.md`, not a chat transcript. It holds the intent, a context diagram, the components, an API table derived from the acceptance lines, a sequence diagram, the technologies, what is in scope, what is out, the assumptions, and the deploy-target label. A health URL is always part of the plan, because the ship engine needs a probe.

Practice mode uses a built-in planner. It does not call a model. Real cloud calls the plan model. Comments and attachments are judged first; only what is relevant is kept. Images can go to a vision-capable plan model. Office and text files are excerpted, with a size cap. On a live change to an existing repository, Shipdeck tries to read the current architecture from the base branch and writes an impact note: what will change, where it lands, and what stays.

If the ticket is ambiguous, the document becomes an open-questions page and approval is refused. The operator can revise, which appends their note and rewrites the plan, or reject, which sends the ticket back, or kill, which stops it.

### 4.7 Code and the workbench

Approving the plan does four things:

1. The forecast is checked again. Caps and open questions still block.
2. Practice mode writes a Node application from the ticket, repairs it so it is a coherent small server, and adds the health URL and the tests.
3. A live chat model writes the files. A live Cursor run can work in the folder. Other folder agents are refused.
4. A secrets scan looks for cloud key shapes, private keys, and assigned secrets. A finding fails the run. A clean scan moves the ticket to code review.

The branch name is `shipdeck/<ticket>`. The operator is told to open the workbench before any pull request.

The workbench is a separate page. It can show the running page through a preview the API proxies, so the operator stays inside Shipdeck. The operator can:

- Save, create, and delete files by hand. Each change is recorded on the architecture and, in live mode, can be commented to Jira.
- Ask for a fix that stays inside this ticket. That produces a revised plan waiting for approval. The current page stays until the plan is approved.
- Reject that revised plan and keep the code.
- Record a new ask that is out of scope. It is commented onto the ticket. The code stays.
- Ask the code model to edit files, including up to four images. A test-only role may change test files and nothing else. A secret in the model’s output is not saved.

### 4.8 Tests

The test bar is three commands in the workspace, each with a short timeout:

| Check | What runs |
|---|---|
| Lint | A Node syntax check of the application file |
| Unit | The unit test file |
| Integration | The integration test file |

All three must pass before code can be approved. Failure marks the ticket failed and the operator fixes it, including from a test bench that only exposes test files. The single skip in the whole product is on this code-review gate. Skip is a recorded decision. It marks the three checks skipped and moves the ticket to deploy approval. Sales should mention skip only when a buyer asks what happens if they consciously accept the risk. It is not the normal path.

Approving code review, with tests passed, can open or update a GitHub pull request. The pull request body is the architecture. The host must be GitHub. Other hosts leave the branch for the operator.

### 4.9 Approve shipping — and what that does not do

Deploy approval:

1. Logs the approval against the target label (the default label is `dev`).
2. In live mode, creates or reuses a Git connection when a repository URL exists.
3. Creates or reuses an SSH or cloud connection when the ticket named an existing target.
4. Writes a handoff that names those connections and tells the operator to open Ship.
5. Marks the ticket complete.

It does not start the pipeline. It does not run Terraform. It does not spend cloud money. The ticket’s target label and rollback owner are names on the document. They do not select a cloud module. This is the most important sentence in a technical evaluation: **finishing a ticket and shipping an environment are two acts, and the product keeps them two acts.**

### 4.10 Ship — the seven stages

The operator saves the pipeline, then runs it. Stages always run in this order.

**1. Get code.** A local folder, or a clone of a Git remote using the Git connection. The product detects the stack and keeps that detection for later stages. Practice logs the path and the branch.

**2. Prepare host.** Three modes.

| Mode | What happens |
|---|---|
| Skip | No host is prepared. Used for a local Docker demonstration |
| Use existing | An SSH connection. The live path probes the host and can attempt to install Docker |
| Create | Terraform, from modules shipped with the product, using the cloud connection |

Create has two compute choices.

| Choice | What the buyer gets |
|---|---|
| Virtual machine | A VM on AWS, Azure, or Google Cloud, with Docker started on boot. The product can save the deploy key as an SSH connection for the later stages |
| Serverless, health function | A function URL that returns a health payload (Lambda, Azure Functions, or Cloud Functions) |
| Serverless, full application | Containers plus a managed database and cache, and an HTTPS URL. AWS uses ECS Express, Azure uses Container Apps, Google Cloud uses Cloud Run. Images are built by the cloud’s own builder from a remote Git repository (CodeBuild, ACR Tasks, or Cloud Build), so the operator’s laptop does not have to build them |

The product recommends a machine size and a serverless size from the detected stack, and it recommends “full application” when the project looks like a real UI plus an API. The operator can see the recommendation before the run. Terraform plan is the default live behaviour. Apply waits for the apply switch or for an approval. Creating a VM needs a deploy key on the cloud connection.

**3. Package.** On a VM or an existing server: install, test, and build an image, using the project’s Dockerfile or one the product can generate, and the project’s tests or a Shipdeck smoke test. The image can be pushed to a registry. On a serverless create, this stage is skipped, because packaging happens with the cloud path. Sales should say that out loud, or a buyer will look for a green “package” box that the product correctly leaves empty.

**4. Database.** Optional. A database in Docker (Postgres, MySQL, Redis, or Mongo) on the local host or over SSH, or a managed database module (Amazon RDS, Azure Database for PostgreSQL, Google Cloud SQL). The full-application path often creates its database and cache inside the application modules rather than as a separate box. Ports that belong on a private network — including 22, 5432, and 6379 — are never opened to the public internet.

**5. Go live.** Docker, Compose, systemd, or Kubernetes, or an update of the serverless function or application. The product can open the public ports the application needs and can generate a Compose file when the project does not have one.

**6. Health check.** An HTTP check against the URL the operator set or the URL the product inferred. For the full application it probes the UI and the API health path, including the `/shipper` path used by that shape. Optional automatic rollback can tear down on failure.

**7. Alerts.** If enabled, a POST to the notify connection.

While a run is active the screen polls and shows a status sentence: rehearsing, waiting for deploy approval, preparing a host in a named region, succeeded with a URL, or failed with the failed stage opened. Logs can be opened on their own page.

**Tear-down.** After a create succeeds, the run keeps an environment. The operator can destroy it. Destroy is a separate, explicit action. A kill on a ticket does not destroy cloud. A failed destroy is shown as failed, not hidden.

### 4.11 History, people, and evidence

History lists pipeline runs, newest first, with status and relative time. A finished ticket points the operator here for the release, because the ticket and the pipeline run are different records.

Users are created by an admin. The new user’s token is shown once. Authentication is a bearer token, stored as a hash. A single environment token can act as an administrator for an installation that does not want a user directory yet.

The audit log records the acts an evaluator asks about: policy changes, secret updates, ticket start, file edits, workbench actions, test runs, each gate decision, kill, webhook start, and secret reveal. In the default installation the log is a file on the Shipdeck host. With a database URL configured, the platform state and the audit can sit in PostgreSQL.

Rate limiting is on by default.

### 4.12 Practice and real cloud, side by side

| | Practice | Real cloud |
|---|---|---|
| Ticket plan | Built-in planner, no model HTTP call | The customer’s plan model |
| Ticket code | A generated Node application, no model bill | The customer’s code model or Cursor |
| Jira write-back | Logged locally | Comment on the issue |
| Pull request | A simulated link, nothing pushed | A GitHub pull request when that option is on |
| Pipeline | Logs the intent of each stage | Git, SSH, Docker, Terraform, cloud builders |
| Cloud bill | None | The customer’s, and only for the stages they configured |
| Terraform apply | Not applicable | Off until the switch or the approval says otherwise |

A salesperson who cannot get a cloud account in the room still has a complete demonstration. A salesperson who is offered a cloud account still has a second switch, Terraform apply, before anything is created.

### 4.13 A full walk, on the sample

This is the story to tell with a hand on the product.

1. Open Home. Read the line. Create a project named for the buyer’s team.
2. Leave the switch on Practice.
3. Open Tickets. Start SHIP-1042 as a new application.
4. Read the architecture. Show that approval is a button, and that a vague ticket would have stopped here.
5. Approve the plan. Open the workbench. Show the page and the files. Show that an out-of-scope ask does not change the code.
6. Run the test bar. Approve the code.
7. Approve shipping. Show the message that tells the operator to open Ship. Show that no cloud login was required and no server changed.
8. Open Ship. Show the seven stages on the sample application path: local source, host skipped, then package, go live, and health check. In a second session, with Docker installed, turn on real cloud only for that local path and open the health URL on the machine. Still no AWS, Azure, or Google account.
9. Open History and Secrets and say what each is for.
10. Stop. The cloud-create story is a later meeting, with their credentials, Terraform installed, and apply still gated.

### 4.14 What a buyer can run without buying cloud

- The whole ticket path in practice mode.
- A local live pipeline of the included sample application, with Docker, host skipped, health URL on the machine.
- Connection tests against their Jira, Git, or model, when they choose to type those keys.

### 4.15 What needs their cloud

- Create VM, create function, create full application.
- Managed cloud databases.
- Deploy onto a server they already run, which needs SSH, not a new cloud account.
- Tear-down of an environment Shipdeck created.

---

## 5. Technical description

Sales does not implement this. Sales must know it well enough to survive a platform architect in the room.

| Layer | Choice |
|---|---|
| Language | TypeScript |
| API | Node.js, Express |
| Web | React, Vite |
| Shared rules | One package for pipeline types, sizing, connection kinds, and delivery policy, so the screen and the API cannot drift apart |
| Infrastructure as code | Terraform modules shipped in the product for VM, function, full application, and managed databases |
| Runtime | Node 22 |
| Secrets | AES-256-GCM on the Shipdeck host |
| State | JSON files on disk by default, or PostgreSQL when a database URL is set |
| Packaging | Docker image and Compose: API, web served by nginx, optional Postgres |
| Continuous integration | The repository builds and runs its tests on push and pull request |
| Ports | API 4000, development web 5173, Compose web 8088, sample application health 8080 |

The web application talks only to the Shipdeck API. The API holds the orchestrator, the stage adapters, the ticket service, and the secret store. Cloud, Git, SSH, and model calls leave from the API host, which is why a customer installation is a private control plane and not a browser extension.

Workspaces for generated applications and for pipeline checkouts live on that same host, under the installation’s data directory. They are the customer’s files on the customer’s machine.

Detection reads the project and suggests the runtime, the health URL, the machine size, and whether a serverless target should be a function or a full application. Sizing catalogues cover the VM families and the serverless families the modules use. Sales should offer “the product recommends a size” and leave the SKU debate to the pilot, where the recommendation is visible before apply.

---

## 6. Product boundary for this release

This boundary is part of the offer. Put it in the proposal. A pilot that ignores it will be judged a product failure when it is a scope failure.

**In scope**

- One installation of the control plane for the customer’s operators.
- Projects, tickets, and pipeline runs as described in Section 4.
- Practice mode and a gated live mode.
- Jira Cloud or Jira Data Center for intake, comments, and webhook start.
- GitHub for automatic pull requests.
- Chat models on the built-in vendor list, a private OpenAI-compatible endpoint, and Cursor for code.
- Ship targets: local Docker, an existing SSH server, Kubernetes when they bring a kubeconfig, and the VM, health function, and full-application modules on AWS, Azure, and Google Cloud.
- Encrypted secrets, three roles, audit, approval gates, and tear-down of environments this product created.
- A small Node application as the output of the ticket engine.

**Out of scope for a standard pilot**

- Replacing the customer’s CI system for every repository and every language.
- Unattended deploy from a model, or from ticket approval alone.
- Pull-request automation on GitLab or Azure DevOps. Those hosts can be named; the automatic pull request path is GitHub.
- Folder agents other than Cursor.
- Single sign-on, SCIM, or a customer identity provider.
- A public multi-tenant service, usage billing inside the product, or a marketplace.
- A SOC 2, ISO, or equivalent certificate. Controls exist. A certificate does not.
- Applications the ticket engine writes in arbitrary stacks. An existing repository of another shape can still be shipped by the pipeline if its Docker or Compose path matches what the ship engine runs.
- Publishing database and SSH ports to the internet. The product refuses this on purpose.
- Custom Terraform beyond the modules shipped with the product, unless a separate implementation contract says so.

**Known hard points to say before a cloud pilot**

- Full application on AWS is ECS Express, and it needs a current Terraform AWS provider. Do not promise App Runner.
- Full application needs the source to be a remote Git URL so the cloud builder can clone it.
- The secrets key on the Shipdeck host must be backed up with the data directory, or saved logins are unreadable after a rebuild.
- A pipeline run interrupted by a process restart may need an operator to look at tear-down. Say that the pilot includes an operator, not a lights-out service.

---

## 7. Market and customer

### 7.1 The job to be done

The buyer is not shopping for “AI” and not shopping for “another pipeline.” The job is: take a small, well-described application change from a ticket to a URL, under rules the company will sign, without inventing the path each time.

That job shows up in three places:

1. **Product companies** whose platform team is the bottleneck for every internal tool and every proof of concept.
2. **Studios and IT services firms** who deliver many similar small applications and currently restitch Git, a model, and a cloud account per client.
3. **Teams evaluating coding agents** who like the files and will not accept an agent that can change production without a named approver and a tear-down.

### 7.2 The economic buyer and the user

| Person | Care | What they must see |
|---|---|---|
| Economic buyer (delivery head, platform director, studio founder) | Time-to-URL, cloud waste, permission to use a model | Practice mode, the three gates, tear-down, and a pilot with a fixed end |
| Operator (platform engineer, senior developer) | That it will actually run, and that they can see logs | The seven stages, connection test, History, and a local Docker run |
| Security or risk reviewer | Where keys live, who can reveal them, what reaches the internet | Encrypted store, audited reveal, private-port rule, apply gate, customer-held cloud account |
| Finance | What is a Shipdeck fee and what is a pass-through cloud or model bill | Section 9. The $25 cap is not an invoice |

### 7.3 Where the first customers are

The shortest path to a reference is a team that already has all four of: Jira, GitHub, one cloud account or one Linux server, and a backlog of small applications. They do not need to change tools. They need a cockpit in front of the tools.

A team with code and no interest in generated applications is still a customer. Sell them the ship engine, the gates, practice mode, and tear-down. Do not force the ticket engine into the story.

A team with no cloud account and no server is a practice-mode briefing, not a pilot. Do not invent a cloud account inside the price.

### 7.4 Market context, without invented sizes

Public industry commentary has spent several years on the same two facts: companies bought CI, Git, cloud, and tickets separately, and they are now adding coding models beside those tools. Shipdeck does not require a market-size slide to be understood. If a proposal needs a market figure, use a source the buyer already trusts and cite it. Do not invent a total addressable market in this document. The relevant market is the set of teams who will pay for a controlled path on top of tools they already fund.

### 7.5 Adjacent products, and the position

Buyers will name neighbours. The position below is how to answer, without dismissing the tools they already pay for.

| Neighbour | What it is good at | What Shipdeck adds beside it |
|---|---|---|
| Jira | The ticket and the workflow | An architecture, gates, and a path to a URL, with status comments back |
| GitHub and GitHub Actions | Review and a repository-centric pipeline | A start from the ticket, a rehearsal mode, and a cloud create/tear-down cockpit |
| Terraform and the cloud consoles | Exact infrastructure | A fixed set of modules, sizing, an approval, a health check, and destroy, for operators who should not write a module per demo |
| Coding assistants and coding agents | Files in an editor | Company caps, a secrets scan, a test bar, named approvers, and no silent production change |
| General CI platforms | Breadth of pipelines the customer designs | A single opinionated path for this class of delivery. Shipdeck does not ask the buyer to assemble the stages |
| Internal platform portals | A paved road for one company, after a long build | A product that already has the road, installed in their network, scoped to the boundary in Section 6 |

The line to remember: Shipdeck sits in front of those tools for one job. It does not ask the buyer to throw them away.

---

## 8. Business model

### 8.1 What is being sold

Two things.

1. **The right to run Shipdeck** on a host the customer controls (their server, their virtual machine, or a Compose stack in their account).
2. **The work to make the first path real**: policy, logins, one project, operator training, and a bounded live run.

### 8.2 What is not being sold

- Amazon, Microsoft, or Google consumption. The customer’s cloud bill is theirs. Shipdeck does not resell compute.
- Model tokens. The customer’s key is stored on their Shipdeck host and calls the vendor directly.
- Jira or GitHub subscriptions.
- A promise of unlimited applications, languages, or pipelines.

This split is a feature in the sales conversation. A buyer can see platform cost and consumption cost separately, and a pilot cannot hide a cloud overrun inside a software fee.

### 8.3 Offers

| Offer | Purpose | Typical length | Included | Excluded |
|---|---|---|---|---|
| Briefing | Earn the pilot | One session | Practice-mode walk on SHIP-1042. Mapping of their ticket onto the gates. A written note of fit or no-fit | Their credentials, cloud apply, a proposal that ignores Section 6 |
| Pilot | Prove one path | A fixed number of weeks, agreed in the statement of work | Installation, authentication on, one project, policy, connections, practice run, one live target, tear-down, a short operator handover | Further projects, custom modules, SSO, certificate work |
| Platform | Leave the cockpit with them | Annual | The installation they already run, a named support window, and defect fixes inside the boundary | Their cloud operations, their model vendor, new clouds or new module families unless listed |
| Implementation add-on | Extra paved paths | Fixed scope | Additional projects or an extra target shape (for example, adding full application after a VM pilot) | Unbounded “make it do what our old scripts do” |

Renewal is the platform offer. Expansion is another project or another target shape, sold as implementation, not as a silent change of the licence.

### 8.4 Who operates it

In a standard deal the customer operates Shipdeck after handover. The seller installs, trains, and supports the product. The customer’s cloud administrators keep their own accounts. This matches the product: keys and Terraform run from the customer’s host, under the customer’s credentials.

A studio may operate one installation for several client projects. That is a delivery choice. Each client should still be a separate Shipdeck project, and client cloud credentials should be that client’s connections. Do not mix client secrets in one shared cloud login.

### 8.5 Pricing principles

Leadership sets numbers. Until that rate card exists, sales follows these principles:

- Quote a fixed pilot, not an open daily rate with no end.
- Quote the platform as an annual fee per installation, with a stated operator count. Add installations when the customer wants hard separation, not when they add a project.
- State cloud and model spend as customer-paid, estimated by them, outside the Shipdeck fee.
- State the support window in the platform fee (for example, business-hours response on defects). Live cloud incidents inside their account are theirs, with Shipdeck support on the product’s behaviour.
- Put out-of-scope items from Section 6 on the same page as the price, so a discount conversation cannot smuggle them back in.

Section 16 is an illustrative arithmetic example for internal planning only.

---

## 9. Go to market

### 9.1 The motion

1. **A conversation** using the Idea Note. Qualify with Section 11.2.
2. **A briefing** on practice mode. No credentials. End with fit or no-fit.
3. **A written pilot** using Annex D and Section 6. One ticket or one existing folder. One target. Named approvers. A destroy step. A date.
4. **Delivery of the pilot** by someone who can run the product, not by a slide.
5. **A platform proposal** only after the pilot’s success test in Section 3.3 is met or explicitly waived in writing.
6. **A reference** only when the buyer agrees. The sample story can be told without a logo. A customer logo waits for permission.

### 9.2 Who sales should call

- Heads of platform engineering and heads of delivery at product companies with 30 to 500 engineers. Below that, the founder is often the buyer. Above that, insist on the platform owner, not a tool evaluator with no gate authority.
- Founders of software studios and digital-engineering practices who deliver small applications repeatedly.
- Innovation or “AI in delivery” sponsors, only when a platform owner is in the same meeting. A sponsor without an operator produces a demo and no pilot.

### 9.3 Materials

| Moment | Document |
|---|---|
| First email and first call | Idea Note, Section 12 |
| Leave-behind after a serious meeting | This report, with Annex D filled |
| Live session | Section 4.13, on the product, practice mode |
| Proposal | Pilot statement of work built from Section 3.3, Section 6, and Section 8 |
| Technical evaluation | Section 4, Section 5, and Section 6. Offer a reader account on a practice installation |

There is an older client-pitch generator in `docs/generate_client_pitch.py`. This report and the Idea Note are the documents to use. The pitch deck, if regenerated, should not contradict Section 6.

### 9.4 Channel

Direct sales is the right first channel, because the product must be qualified hard and shown live. A studio partner is the second channel: they run Shipdeck as part of how they deliver, and they bring their own clients. A cloud-marketplace listing is not a first step. The product’s value depends on a conversation about gates and scope, which a self-serve listing skips.

### 9.5 Geography and hosting

The product does not choose a region for itself. The customer’s Shipdeck host sits where they need the control plane to sit. Model calls go to the endpoint they configure, including a private or local endpoint. Cloud resources are created in the region on the cloud connection. Data-residency questions are answered with that sentence, not with a claim that Shipdeck operates a regional SaaS.

---

## 10. Sales playbook

### 10.1 Discovery questions

Ask these before offering a pilot. Write the answers into Annex D.

1. What is the smallest application a stakeholder is waiting to click?
2. Where does that work start today — Jira, another tracker, or a document?
3. Who is allowed to approve a plan, who is allowed to approve code, and who is allowed to change a live environment? Name them.
4. Is the code new, or does a repository already exist?
5. Where should it run in the pilot: a server you already have, or a new VM, function, or full application? Which cloud?
6. Which model are you allowed to call, and may the key live on a host you control?
7. What must be true on the last day of a pilot for you to call it a success?
8. What will you do with the environment afterwards — destroy it, or keep it?

If they cannot answer 3 and 7, they are not ready to buy. Offer the briefing.

### 10.2 Qualification

**Proceed** when at least four of these are true: they have a named operator; they have a named economic buyer; they have Jira or they accept pasted tickets; they have GitHub or they accept a local branch; they have one target; they accept human gates; they accept the ticket-engine output described in Section 6 or they are buying ship-only.

**Stop** when any of these are true: they require unattended production deploy; they require a compliance certificate in the pilot; they require every existing pipeline to be imported; they will not name an approver; they want the pilot to invent a new cloud module family.

### 10.3 Demonstration script

Use Section 4.13 in order. Rules for the person showing it:

- Start on Practice. Say the word. Point at the switch.
- Use SHIP-1042 unless the buyer has already agreed to paste a ticket.
- Read the architecture out loud for one minute. The document is the product.
- Approve in front of them. Do not skip the buttons.
- When you approve shipping, read the handoff message. That is the moment buyers misunderstand, and it is the moment to be precise.
- Do not open a cloud account in the first sitting.
- Do not reveal a secret on a shared screen. If you must show the Secrets screen, show the mask and say that reveal is audited.
- If something fails, open the log. The log is part of the product. Do not apologise by leaving the product for a terminal unless the room asks.

A second meeting, only with their agreement, adds one of: a local Docker live run of the sample application, a connection test to their Jira, or a read of an existing repository’s detection. Terraform apply is a third meeting, inside the pilot, not a flourish at the end of the first demo.

### 10.4 Objections

| They say | You answer |
|---|---|
| “We already have GitHub Actions.” | Keep it. Shipdeck starts from the ticket and gives you one create, verify, and tear-down path, including a rehearsal that does not spend cloud money. Actions remains the place for the pipelines you already trust. |
| “Our coding agent already writes the app.” | Good. The gap is what happens after the files exist: a cost cap, a secrets scan, a test bar, a named deploy approval, and a cloud path that does not run until someone runs it. If they only want the agent, Shipdeck is the wrong product. |
| “Can it deploy the moment the ticket is approved?” | No, and that is intentional. Approval prepares the logins and records the decision. A person runs the pipeline. We will not switch that off in a pilot. |
| “We need it in Python / Java / our monorepo.” | The ticket engine writes a small Node application. If the repository already exists, we scope the pilot to the ship engine and check that Docker or Compose path in discovery. We do not promise the ticket engine will reproduce your monorepo. |
| “Is it SOC 2?” | No. Secrets are encrypted, reveals are audited, roles exist, and private ports stay private. A certificate is a separate programme and is not in this release. |
| “Who pays the cloud bill?” | You do. It is your account. Practice mode is how we avoid a bill during the briefing. The pilot names the target so the bill is bounded, and tear-down is part of the success test. |
| “What is the $25?” | A safety stop on one plan inside the product. It is not our fee. Your model vendor bills you for real calls. You can set the cap in policy. |
| “Can we use our own model on our network?” | Yes, if it speaks a supported chat protocol, including a private OpenAI-compatible endpoint or a local Ollama-style host. |
| “Will it work on Azure and AWS?” | The same seven stages. The create modules cover AWS, Azure, and Google Cloud, for a VM, a health function, and a full application. The pilot picks one. |
| “We want App Runner.” | Full application on AWS is ECS Express. We will not sell App Runner. |
| “Can you run it as SaaS for us this month?” | This release is installed in your environment. A hosted service is a different operating model and is not the current offer. |
| “What if the run fails halfway?” | The stage stays red, the log opens, and a created environment can be destroyed. The pilot includes an operator. We do not describe it as unattended. |

### 10.5 Proposal contents

A pilot proposal is complete when it has:

- The buyer, the operator, and the three approver names.
- The project name and the one ticket or the one repository.
- Practice first, then the one live target, in one cloud or on one server.
- The success test from Section 3.3.
- The out-of-scope list from Section 6, copied, not summarised into a vague “standard exclusions.”
- The fee, the weeks, and what happens to cloud and model invoices.
- What is destroyed at the end.
- The support window during the pilot.

---

## 11. Customer implementation

A standard pilot runs in this order. Weeks are a guide for a single target; the statement of work fixes the dates.

| Step | Work | Buyer’s part |
|---|---|---|
| 1. Install | Shipdeck on a host they control, Compose or the development stack, authentication turned on, admin token in their hands, secrets key backed up | A host, a DNS name or a private address, and a person who can open the port |
| 2. Policy | Approvers, caps, language and licence lists, Jira project keys, GitHub choice | Names and the decision on automatic pull requests |
| 3. Logins | Jira, model, Git, and one deploy connection. Each one probed | Keys, created by their administrators |
| 4. Practice | SHIP-1042 or their pasted ticket, all three gates, no cloud | Their operators in the room |
| 5. Ship rehearsal | Sample application, local Docker, host skipped, health URL | Docker on the agreed host |
| 6. Live target | One create or one existing server. Apply gated. Health check. History | Cloud or SSH access, Terraform on the host if creating |
| 7. Tear-down and handover | Destroy if the success test says so. Walk History, Secrets, and kill versus destroy | Written acceptance |

Prerequisites to state in the order:

- For any live cloud create: Terraform on the Shipdeck host, credentials in a deploy login, and the apply decision.
- For a full application: a remote Git HTTPS URL and a cloud identity that may build images and create the data services. Local Docker is optional on that path.
- For a VM create: a deploy key on the cloud connection.
- For an existing server: SSH reachability from the Shipdeck host.
- For Jira live: a token and, if webhooks are in scope, a secret and an allow-listed project key.
- For model live: an endpoint the Shipdeck host can reach.

Handover is a working session, not a document alone. The buyer’s operator runs the practice ticket while the implementer watches.

---

## 12. Security, control, and operations

Use this section with the buyer’s risk reviewer. Say what the product does. Do not add certifications.

**Identity.** Local users with roles, or one installation token. Tokens are stored as hashes. Open mode is for a private demo only and is turned off before a pilot holds real keys.

**Secrets.** Encrypted at rest with AES-256-GCM. Connection screens never return stored secret values in the normal payload. Reveal is a separate act and is audited. Ticket targets store passwords and cloud keys on the server; the ticket the browser reads back shows only that authentication exists. Policy secrets (model, Jira, Git) are a separate encrypted store from pipeline connection secrets.

**Change control.** Three gates on a ticket. Optional approval before the deploy stage of a pipeline. Terraform apply off unless switched on or approved. Practice as the default.

**Network hygiene.** Private service ports are not published. The operator can preview which ports would be public before opening them.

**Evidence.** An append-only audit of the acts listed in Section 4.11. Pipeline logs on the run. Architecture and impact notes kept with the ticket workspace.

**Isolation.** One installation is one control plane. Projects separate work inside it. They are not a security boundary between hostile tenants. Customers who need hard separation buy separate installations.

**Backup.** The data directory (state, encrypted secrets, the secrets key, ticket workspaces) is the system of record in a default installation. The customer backs it up. Losing the secrets key loses the logins.

**Failure.** Failed stages stay visible. Destroy failure stays visible. A killed ticket does not imply a destroyed cloud. Rate limiting reduces accidental hammering of the API.

**Customer responsibilities.** Their cloud account, their model contract, their Jira and GitHub permissions, patching the host, and deciding who holds the admin token.

---

## 13. Risks

| Risk | Why it matters | What we do |
|---|---|---|
| Oversell | A buyer expects a general CI platform or an unattended agent and the pilot “fails” | Section 6 in the proposal. Qualification in Section 10.2. The Idea Note’s “must not promise” list |
| Cloud cost surprise | Create-infrastructure is real money | Practice first. One target. Apply gated. Tear-down in the success test. Cloud bill excluded from our fee |
| Model cost surprise | Live plan and code call their vendor | Caps visible in policy. Their key, their bill. Briefing uses practice and spends nothing |
| Scope creep into their monorepo | The ticket engine will not reproduce an arbitrary estate | Ship-only scope, or a new small application. Written in the statement of work |
| Secrets key loss | Logins become unreadable | Backup step in implementation. Key from their secret store, not only the generated file |
| Agent names in the UI | A buyer selects a folder agent that live mode refuses | Say “chat models and Cursor” in the proposal. Do not demo a refused agent |
| Halfway cloud failure | A run can stop after resources exist | Logs, destroy, and an operator in the pilot. No lights-out claim |
| Certificate demand | Risk review blocks on SOC 2 | Say no early. Offer the control list in Section 12. Do not imply a certificate is in progress unless leadership has started one |
| Open demo mode left on | Anyone on the network can operate the plane | Authentication is a pilot entry criterion, not a follow-up |
| Mixing client secrets | A studio uses one cloud login for many clients | One connection set per client. Separate installations when hard isolation is required |
| Price invented in the room | Section 16 is mistaken for a rate card | No number leaves the building until leadership publishes a rate card. This report says so |

---

## 14. Near-term path

This is not a public roadmap and it is not a commitment. It is the set of gaps a salesperson will be asked about, so the company can decide what the next build actually is. None of these are required to sell a pilot inside Section 6.

| Gap a buyer will notice | Why it is next, if leadership chooses it |
|---|---|
| Ticket approval does not offer a one-click “run the pipeline I just approved” | Some buyers want fewer steps after they have understood the separation. Any shortcut must keep an explicit run, or the safety story breaks |
| Folder agents other than Cursor are listed and refused | Either remove them from the sales screen or implement them. Leaving both is how demos die |
| Automatic pull request is GitHub-only | The next host is a commercial choice, not a default promise |
| Ticket engine output is a small Node application | Widening languages is a new product, not a setting. Sell ship-only until that exists |
| Local users only | Single sign-on matters for a wide platform rollout and does not matter for a first pilot |
| No in-product billing or tenancy | Required only if the offer changes from installed control plane to public service |
| Compliance programme | A company decision. The product’s controls are the input, not the certificate |

Until an item above is shipped, the sentence in the proposal stays the sentence in Section 6.

---

## 15. Organisation of the work

The repository does not name a company chart. For market introduction the work splits into four roles. One person may hold more than one role at the start. The roles still need to be named in Annex D so a buyer knows who answers.

| Role | Accountable for |
|---|---|
| Product owner | The boundary in Section 6, and any change to it |
| Sales lead | Qualification, the briefing, the proposal, and the rule that illustrative numbers are not quotes |
| Pilot lead | Installation, the success test, and the handover. This person can run the product |
| Support owner | Defects inside the boundary during the pilot and the platform term |

A pilot without a named pilot lead is not ready to sign.

---

## 16. Illustrative commercial sketch

**This section is not a price list.** The figures are round planning numbers so leadership can see the shape of a year. Replace every figure before anything is sent to a buyer. Currency is a leadership choice; US dollars are used here only because the product’s own cost cap is denominated that way.

Assume, for planning:

- A briefing is free or nominally paid, and exists to produce a yes or a no.
- A pilot fee covers four to six weeks of one pilot lead, one installation, and one target.
- A platform fee is annual, per installation, and includes a business-hours defect window.
- Implementation beyond the pilot is quoted per extra project or extra target shape.
- The customer’s cloud and model spend is outside all of the above. For a single VM pilot that is destroyed at the end, their cloud spend is often smaller than the pilot fee. For a full application left running, their cloud spend can exceed the platform fee. Say that in the proposal so finance hears it from us first.

Illustrative internal planning range, to be replaced:

| Offer | Illustrative range | Planning note |
|---|---|---|
| Briefing | 0 to a small fixed fee | Free is reasonable while references are scarce |
| Pilot | One fixed fee in the low tens of thousands of US dollars | Price the person’s weeks, not the cloud |
| Platform, annual, one installation | A fee on the order of the pilot, renewed yearly | Includes support. Does not include a resident engineer |
| Extra implementation | Quoted | Another project or another cloud shape |

A year with four paid pilots and two renewals is a coherent first commercial year for a small team. It is a planning picture, not a forecast. Cost of delivery is mostly the pilot lead’s time, a demonstration environment, and ordinary software maintenance. There is no marketplace take-rate and no consumption margin in this model, which keeps the offer explainable and keeps gross margin tied to licence and service rather than to cloud resale.

Do not discount by adding scope. Discount by shortening the pilot or by reducing the installation count.

---

## 17. Conclusion

Shipdeck is ready to take to market as a controlled product: a ticket becomes a plan, a person approves it, code is written and tested, a person approves it, and a separate ship path can place that work on a server or a cloud target and take it down again. Practice mode means the first meeting costs the buyer nothing in cloud or model fees. The customer keeps every underlying account.

The business is an installed control plane plus a paid pilot that proves one path. The sale is won by showing the product in order and by writing the boundary into the proposal. The sale is lost by describing a general CI platform, an unattended agent, or a certified public cloud service.

Sales should walk into the first meeting with the Idea Note, walk out of a serious meeting with this report and Annex D started, and send a proposal only when the success test, the single target, and the out-of-scope list are filled in.

---

## Annex A — Vocabulary for the room

| Say this | Means this |
|---|---|
| Practice | Rehearsal. No model call and no cloud change |
| Real cloud | Live. Models are called. The pipeline changes machines only when it is run |
| Plan | The architecture document, waiting for a person |
| Code | The project folder on branch `shipdeck/<ticket>` |
| Test bar | Lint, unit, and integration |
| Workbench | The page where the operator reads the app and edits |
| Approve shipping | Records the decision and prepares logins. Does not start the cloud |
| Get code, prepare host, package, database, go live, health check, alerts | The seven ship stages, in that order |
| Health function | A serverless URL that returns a health payload |
| Full application | Managed containers plus database and cache, with an HTTPS URL |
| Tear-down | Destroy of an environment a pipeline run created |
| Kill | Stops an active ticket. Does not destroy cloud |
| Cap | The token and dollar brake on a plan. Not an invoice |

## Annex B — Demonstration checklist

- [ ] Practice is on, and you have said so.
- [ ] A project is selected or created in the buyer’s words.
- [ ] SHIP-1042 or an agreed pasted ticket is the only ticket.
- [ ] You read the architecture before approving it.
- [ ] You opened the workbench.
- [ ] You ran or explained the test bar.
- [ ] You read the handoff after deploy approval and showed that Ship is a separate screen.
- [ ] You did not apply Terraform.
- [ ] You did not reveal a secret on the projector.
- [ ] You ended on fit or no-fit, and on the one target a pilot would use.

## Annex C — Fields that must be filled before a proposal

| Field | Value |
|---|---|
| Legal entity selling Shipdeck | |
| Registered address and signatory | |
| Sales lead | |
| Pilot lead | |
| Support owner | |
| Buyer legal name | |
| Economic buyer | |
| Operator | |
| Architecture approver | |
| Code reviewer | |
| Deploy approver | |
| Rollback owner | |
| Project name | |
| Ticket or repository in scope | |
| New application or existing repository or ship-only | |
| Pilot target (local Docker, SSH host, VM, function, or full application) | |
| Cloud, if any, and region | |
| Model vendor and whether a private endpoint is required | |
| Jira project key, or “pasted tickets only” | |
| GitHub organisation, or “no automatic pull request” | |
| Pilot start and end dates | |
| Success test (copy Section 3.3 and strike what does not apply) | |
| Tear-down: destroy or keep, and who decides | |
| Shipdeck fee and currency | |
| What the customer pays vendors directly | |
| Out of scope (attach Section 6) | |
| Rate card version, replacing Section 16 | |

## Annex D — Source of this report

This report was written from the product as it stands in the Shipdeck repository: the operator journey, the ticket state machine, the ship stages, the connection and model catalogues, the Terraform module set, and the security and role behaviour. If those change, this report and the Idea Note change with them. Marketing language that conflicts with Section 6 should be treated as a defect.

---

*End of business project report.*
