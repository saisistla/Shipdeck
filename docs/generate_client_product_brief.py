"""Generate the 4-page Shipdeck client product brief (Word + PDF)."""
from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor, Twips
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as pdfcanvas

OUT_DIR = Path(__file__).resolve().parent
DOCX_PATH = OUT_DIR / "Shipdeck_Client_Product_Brief.docx"
PDF_PATH = OUT_DIR / "Shipdeck_Client_Product_Brief.pdf"

TEAL = RGBColor(0x0F, 0x6B, 0x6B)
TEAL_DARK = RGBColor(0x0A, 0x45, 0x48)
COPPER = RGBColor(0xC4, 0x6B, 0x3A)
INK = RGBColor(0x1A, 0x1F, 0x24)
MUTED = RGBColor(0x5A, 0x64, 0x6E)
LINE = RGBColor(0xD5, 0xDC, 0xE0)
SOFT = RGBColor(0xE6, 0xF3, 0xF3)
COPPER_SOFT = RGBColor(0xFB, 0xF0, 0xE8)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
P_TEAL = HexColor("#0F6B6B")
P_TEAL_DARK = HexColor("#0A4548")
P_TEAL_SOFT = HexColor("#E6F3F3")
P_COPPER = HexColor("#C46B3A")
P_COPPER_SOFT = HexColor("#FBF0E8")
P_INK = HexColor("#1A1F24")
P_MUTED = HexColor("#5A646E")
P_LINE = HexColor("#D5DCE0")
P_OK = HexColor("#1F7A4C")
P_PAPER = HexColor("#F7F8F6")
P_WHITE = white
STAGE = [
    HexColor("#2B6CB0"),
    HexColor("#0F6B6B"),
    HexColor("#6B4C9A"),
    HexColor("#C46B3A"),
    HexColor("#1F7A4C"),
    HexColor("#B57A1A"),
    HexColor("#4A5563"),
]


def set_run_font(run, name="Calibri", size=10, bold=False, color=INK, italic=False):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color


def shade(cell, hex_color: str):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), hex_color)
    shd.set(qn("w:val"), "clear")
    tcPr.append(shd)


def set_cell_border(cell, color="D5DCE0", sz="4"):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), sz)
        el.set(qn("w:color"), color)
        tcBorders.append(el)
    tcPr.append(tcBorders)


def set_cell_margins(cell, top=40, bottom=40, left=80, right=80):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = OxmlElement("w:tcMar")
    for name, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        node = OxmlElement(f"w:{name}")
        node.set(qn("w:w"), str(val))
        node.set(qn("w:type"), "dxa")
        tcMar.append(node)
    tcPr.append(tcMar)


def no_table_borders(table):
    tbl = table._tbl
    tblPr = tbl.tblPr if tbl.tblPr is not None else OxmlElement("w:tblPr")
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "nil")
        borders.append(el)
    tblPr.append(borders)


def para(cell, text, size=10, bold=False, color=INK, space_after=2, space_before=0, italic=False, align=WD_ALIGN_PARAGRAPH.LEFT):
    p = cell.paragraphs[0] if not cell.paragraphs[0].text else cell.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.08
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color, italic=italic)
    return p


def add_body(doc, text, size=9.5, bold=False, color=INK, space_after=4, space_before=0, italic=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.12
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color, italic=italic)
    return p


def add_heading_line(doc, text, size=12):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(3)
    run = p.add_run(text.upper())
    set_run_font(run, size=size, bold=True, color=TEAL)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "12")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "0F6B6B")
    pBdr.append(bottom)
    pPr.append(pBdr)
    return p


def add_subhead(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(7)
    p.paragraph_format.space_after = Pt(3)
    run = p.add_run(text)
    set_run_font(run, size=11.5, bold=True, color=INK)
    return p


def add_footer(section, text):
    footer = section.footer
    footer.is_linked_to_previous = False
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run(text)
    set_run_font(run, size=8, color=MUTED)
    run2 = p.add_run("\t")
    set_run_font(run2, size=8, color=MUTED)
    # PAGE field
    run3 = p.add_run("Page ")
    set_run_font(run3, size=8, color=MUTED)
    fld1 = OxmlElement("w:fldChar")
    fld1.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld2 = OxmlElement("w:fldChar")
    fld2.set(qn("w:fldCharType"), "end")
    r = p.add_run()
    r._r.append(fld1)
    r2 = p.add_run()
    r2._r.append(instr)
    r3 = p.add_run()
    r3._r.append(fld2)
    for item in (r, r2, r3):
        set_run_font(item, size=8, color=MUTED)
    run4 = p.add_run(" of 4")
    set_run_font(run4, size=8, color=MUTED)
    pPr = p._p.get_or_add_pPr()
    tabs = OxmlElement("w:tabs")
    tab = OxmlElement("w:tab")
    tab.set(qn("w:val"), "right")
    tab.set(qn("w:pos"), "10680")
    tabs.append(tab)
    pPr.append(tabs)


def compact_table(doc, headers, rows, col_widths, header_fill="0F6B6B"):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for i, width in enumerate(col_widths):
        for cell in table.columns[i].cells:
            cell.width = Cm(width)
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        shade(cell, header_fill)
        set_cell_border(cell, "0F6B6B")
        set_cell_margins(cell, 50, 50, 70, 70)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(h)
        set_run_font(run, size=8, bold=True, color=WHITE)
    for r, row in enumerate(rows):
        fill = "F7FBFA" if r % 2 == 0 else "FFFFFF"
        for c, val in enumerate(row):
            cell = table.rows[r + 1].cells[c]
            shade(cell, fill)
            set_cell_border(cell, "D5DCE0")
            set_cell_margins(cell, 45, 45, 70, 70)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.05
            run = p.add_run(val)
            set_run_font(run, size=8, color=INK)
    return table


def card_row(doc, items, fills):
    table = doc.add_table(rows=1, cols=len(items))
    table.autofit = False
    no_table_borders(table)
    width = 17.3 / len(items)
    for i, (title, body) in enumerate(items):
        cell = table.rows[0].cells[i]
        cell.width = Cm(width)
        shade(cell, fills[i])
        set_cell_border(cell, "D5DCE0")
        set_cell_margins(cell, 70, 70, 90, 90)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        run = p.add_run(title)
        set_run_font(run, size=9.5, bold=True, color=TEAL_DARK)
        p2 = cell.add_paragraph()
        p2.paragraph_format.space_after = Pt(0)
        p2.paragraph_format.line_spacing = 1.08
        run2 = p2.add_run(body)
        set_run_font(run2, size=8.5, color=INK)
    return table


def build_docx() -> None:
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = Cm(1.35)
    section.right_margin = Cm(1.35)
    section.top_margin = Cm(1.15)
    section.bottom_margin = Cm(1.35)
    section.header_distance = Cm(0.4)
    section.footer_distance = Cm(0.5)
    add_footer(section, "Shipdeck  ·  Confidential client product brief  ·  November 2026")

    header = section.header
    header.is_linked_to_previous = False
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = hp.add_run("SHIPDECK")
    set_run_font(r, size=9, bold=True, color=TEAL)
    r2 = hp.add_run("   Visual DevOps Platform V3  ·  Client product brief")
    set_run_font(r2, size=9, color=MUTED)

    # Banner
    banner = doc.add_table(rows=1, cols=1)
    banner.autofit = False
    cell = banner.rows[0].cells[0]
    shade(cell, "0A4548")
    set_cell_border(cell, "0A4548")
    set_cell_margins(cell, 140, 140, 140, 140)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run("SHIPDECK")
    set_run_font(run, size=12, bold=True, color=RGBColor(0xC8, 0xE6, 0xE6))
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_before = Pt(2)
    p2.paragraph_format.space_after = Pt(4)
    run = p2.add_run("An idea becomes a live app. You approve each step.")
    set_run_font(run, size=18, bold=True, color=WHITE)
    p3 = cell.add_paragraph()
    p3.paragraph_format.space_after = Pt(0)
    run = p3.add_run(
        "The visual control plane from business idea to running URL — then to the companies who should buy it, and the campaign written for those people. Installed in your environment. Your Jira, GitHub, model, and cloud bills stay yours."
    )
    set_run_font(run, size=10, color=RGBColor(0xD7, 0xE8, 0xE8))

    add_body(
        doc,
        "This note is the product, written so a buyer can decide to sit a demo. It is Visual DevOps Platform V3, commercially named Shipdeck. Practice mode needs no cloud account and no model key. Bring one small-application idea. Forty-five minutes is enough to see the path.",
        size=10.5,
        space_before=8,
        space_after=8,
    )

    add_heading_line(doc, "1. The problem we are solving")
    add_body(
        doc,
        "A change still starts as an idea or a ticket and is supposed to end as a running application that someone can sell. Between those two moments the work is split across a tracker, a chat with a model, a repository, a cloud console, a pipeline nobody wants to press, a leftover virtual machine, and a marketing team that starts from a blank page after the demo. Teams already own capable tools. They do not own one path through them.",
        space_after=5,
    )
    compact_table(
        doc,
        ["What you already have", "What the business still feels"],
        [
            ["A ticket in Jira, or an idea in a meeting", "The plan lives in a chat thread. Nobody can point to an approved architecture."],
            ["A coding model or coding agent", "Files appear quickly. Approvers, spend limits, tests, and the allowed destination do not travel with them."],
            ["GitHub and a CI system", "The pipeline starts after someone has already assembled the scripts. CI does not rehearse a cloud create without spending money."],
            ["AWS, Azure, or Google Cloud, plus Terraform", "Every demo is a fresh design. Sizing, ports, health, and teardown depend on whoever is free."],
            ["A sales and marketing motion", "The product is live, but the account list and the campaign are a separate project, weeks later."],
            ["An audit requirement", "Who approved the plan, the code, Terraform apply, and a revealed key is reconstructed from inboxes and consoles."],
        ],
        [6.2, 11.1],
    )
    add_body(
        doc,
        "The cost is calendar time on small applications, cloud left running after the proof, leadership that will not let a model near a live environment, and a go-to-market that starts too late. Shipdeck exists so a defined class of work — an idea, a ticket, an application, a known destination, named human gates, a contact list, and a campaign — follows one operator path.",
        space_before=6,
        space_after=4,
    )

    add_heading_line(doc, "2. What Shipdeck is")
    add_body(
        doc,
        "Shipdeck is one installed product with five studios, joined by the operator. It is not a general CI catalogue, not a replacement for Jira or GitHub, and not a reseller of cloud or model accounts. It is the cockpit in front of the accounts you already pay for.",
        space_after=5,
    )
    card_row(
        doc,
        [
            ("1  Idea", "Describe the business. Write the report. Read the market. Open a Jira story."),
            ("2  Ticket", "Approve the plan, the code, and the tests. A person signs each gate."),
            ("3  Ship", "Seven visual stages to a URL. Rehearse first. Tear down when done."),
            ("4  Sales", "Find the companies from the report. Person, email, phone, LinkedIn."),
            ("5  Marketing", "Write the campaign for those people: content, picture, video, SEO, leads."),
        ],
        ["E6F3F3", "FBF0E8", "E6F3F3", "FBF0E8", "E6F3F3"],
    )
    add_body(
        doc,
        "Beside those five: Home (the story and the project), Logins (credentials, once), Secrets (inventory and audited reveal), and History (every release). Work is organised by project, so a studio can keep each client’s idea, tickets, and releases together. A switch above the work chooses Practice or Real cloud. Practice is the default. Access is arranged in three roles: viewer, operator, and admin. Light and dark appearance sit in the chrome.",
        space_before=6,
        space_after=4,
    )

    add_heading_line(doc, "3. Idea — start with the business, not a ticket")
    add_body(
        doc,
        "Tickets begin only after the owner has described the application. The operator picks an industry from the catalogue (Agriculture, Construction, Education, Energy, Finance, Food service, Government, Healthcare, Hospitality, Logistics, Manufacturing, Professional services, Property, Retail, Technology), names the application if they already have a name, and starts a brief.",
        space_after=4,
    )
    compact_table(
        doc,
        ["Step", "What the owner sees", "What the product does"],
        [
            ["Application", "Industry plus an optional working name.", "Nothing is assumed. The owner’s words decide the product."],
            ["Describe", "A chat, or an uploaded report (txt, md, pdf, docx, pptx, rtf).", "Practice replies locally. Real cloud uses the plan model. Uploads are excerpted into the brief."],
            ["Business report", "Problem, customer, offer, version-one scope, and what is not this time.", "Written from the chat and the file. No invented revenue numbers. Can be rewritten after more chat."],
            ["Market", "Definition, segments, size method, demand, competitors, position, SWOT, PESTLE, five forces, price, go-to-market, what to validate.", "A first-pass read, labelled as such — not a commissioned study. Refreshable."],
            ["Technical pack", "An editable technical brief, then a Jira user story.", "Creates the Jira project and story on Cloud or Data Center, then opens the ticket. Sales unlocks from this report."],
        ],
        [3.3, 6.8, 7.2],
    )
    add_body(
        doc,
        "The owner can edit the technical brief before the story is created, and can write the same story to a different saved Jira. Technical slides are built later, after architecture.md is approved on the ticket. An idea that already has a report and a Jira story is ready for Sales without waiting for the application to finish shipping.",
        space_before=5,
        space_after=4,
    )

    add_heading_line(doc, "4. Ticket — a person on the plan, the code, and the release")
    add_body(
        doc,
        "A ticket starts from the Idea handoff, from the built-in sample (SHIP-1042, a warehouse stock-reservation story), from pasted text, or from a live Jira issue. The operator chooses a new application or a change to an existing repository. On a live change to something already running, they name the server or the cloud service that hosts it. A repeated Jira webhook for an allowed project returns the run already in progress.",
        space_after=4,
    )
    compact_table(
        doc,
        ["Gate", "What is produced", "What a person must do"],
        [
            ["Plan", "architecture.md: intent, diagrams, components, API table from acceptance lines, in/out of scope, assumptions, a health URL. On an existing repo, also impact-analysis.md.", "Read it. Revise with a note, reject, or approve. Unclear tickets stop on open questions. A forecast over 200,000 tokens or USD 25 stops the gate. Comments and attachments are judged; only relevant material enters the plan."],
            ["Code", "A project folder on branch shipdeck/<TICKET>. Chat models write files one at a time. Cursor can act as the folder agent. A secrets scan runs before anyone accepts the tree.", "Open the workbench. See the running page. Edit by hand, ask for a change inside this ticket, record an out-of-scope idea back to Jira, or send a screenshot to the model. A dedicated test bench limits a tester to test files."],
            ["Tests", "Lint, unit, and integration (node --check, then unit and integration files). Thirty seconds each.", "They must pass before code approval. Skip exists only here, and it is an explicit decision, not a silent bypass."],
            ["Pull request", "GitHub PR whose body is the approved architecture (first 4,000 characters). Other Git hosts keep the local branch.", "Optional, when auto-open is on and a GitHub token is present."],
            ["Release approval", "Who approved, Git and destination logins prepared, status completed.", "This does not start Terraform and does not spend cloud money. The operator then opens Ship and runs the pipeline. Kill stops the ticket. Destroy of cloud is a separate act on the ship run."],
        ],
        [3.1, 7.0, 7.2],
    )
    add_body(
        doc,
        "The model is yours. Plan and code are two slots. Supported chat paths include Azure OpenAI, OpenAI-compatible endpoints (OpenAI, Mistral, Groq, Ollama, Databricks), Anthropic, Gemini, Bedrock, Cohere, and watsonx. Cursor is the live folder agent for implementation. Picture and video jobs are separate slots for Marketing. Keys stay encrypted on the Shipdeck host. Shipdeck does not take a cut of the model bill. Default safety caps (200,000 tokens and USD 25 per plan) are product stops, not the licence fee.",
        space_before=5,
        space_after=3,
    )
    add_body(
        doc,
        "Honest scope of the ticket writer: this release writes a small Node application from the approved architecture, with fixture-style data, a page, and GET /health, so the ship path always has something to call. Python sits on the language allow-list; the sandbox that executes tests is Node. Teams that already have code skip the writer and use Ship alone. Approving ship never silently starts a live environment.",
        size=10,
        space_after=4,
    )

    add_heading_line(doc, "5. Ship — seven stages, one visual run")
    add_body(
        doc,
        "The ship engine is how a finished project folder, or any application you already have, reaches a server or a cloud target. Stages run in a fixed order. Data always runs before Deploy. The operator attaches connections, accepts or adjusts the recommended size, and clicks Run pipeline.",
        space_after=4,
    )
    compact_table(
        doc,
        ["Stage", "Choices", "Live behaviour"],
        [
            ["1. Source", "Local folder or remote Git.", "Clone or use the path. Detect the stack so later stages can recommend runtime, port, VM size, and serverless kind."],
            ["2. Infra", "Skip · existing server (SSH) · create new.", "Create is Terraform, on AWS, Azure, or Google Cloud. Three shapes: virtual machine with Docker; health function (Lambda / Azure Functions / Cloud Functions); full application (containers + managed database + cache + HTTPS). AWS full-app uses ECS Express; Azure uses Container Apps; Google Cloud uses Cloud Run. Cloud image builds use CodeBuild, ACR Tasks, or Cloud Build, so the operator PC does not have to build images. Apply waits for a named approval unless TF apply is already allowed."],
            ["3. Build", "Existing tests or generated smoke tests; existing Dockerfile or Dockerfile.shipdeck; optional registry push.", "Skipped when the target is serverless, because the image or package is produced on the cloud path."],
            ["4. Data", "Off, container database (Postgres, MySQL, Redis, Mongo), or managed cloud database.", "Azure Flexible Server, AWS RDS / Aurora, GCP Cloud SQL. Data ports stay private. Full-app modules often attach Postgres and Redis as part of the application stack."],
            ["5. Deploy", "Docker, Compose, systemd, or Kubernetes; or the serverless release.", "Public access is limited to the ports the application actually serves. SSH, databases, and similar private ports are never published to the internet. The operator can preview which ports would open before they are opened."],
            ["6. Verify", "Health URL, timeout, optional auto-rollback.", "HTTP probe of /health, /shipper, or the inferred address. Failure can roll back to the previous container or destroy the environment just created."],
            ["7. Notify", "Optional webhook.", "POST to the endpoint the team named when the run should tell someone."],
        ],
        [2.6, 5.6, 9.1],
    )
    add_body(
        doc,
        "The console states, in plain language, whether the run is rehearsing, waiting for approval, preparing a host, succeeded with an address, or stopped on a stage whose log is open. When Shipdeck created the environment, the operator types DESTROY on that same run to tear it down (Terraform destroy, thirty-minute window). Closing an environment and stopping a ticket are separate decisions, so a pause in design never implies a surprise change in the cloud account. If a live create fails after infrastructure was provisioned, the orchestrator rolls the environment back.",
        space_before=5,
        space_after=4,
    )
    add_subhead(doc, "Destinations you can show in a pilot")
    compact_table(
        doc,
        ["Destination", "What the business gets", "When to use it"],
        [
            ["Practice (default)", "Every stage logged. No model call. No cloud change.", "First meeting, operator rehearsal, stakeholder walk-through."],
            ["Local live", "The included demo app answers at a health URL on the machine (Docker).", "Proof that Live is real, still without a cloud account."],
            ["Existing server", "SSH to a machine you already run. Docker / Compose / systemd / Kubernetes.", "You have a host. You do not want a new bill."],
            ["Create VM", "A sized virtual machine with containers ready, in your region.", "A dedicated box for a demo or an internal tool, with DESTROY at the end."],
            ["Health function", "An HTTPS address that returns health JSON.", "Prove the cloud path in minutes."],
            ["Full application", "Real UI on a managed container service, managed database, cache, HTTPS.", "The client needs to click a product, not a health payload."],
        ],
        [3.4, 7.4, 6.5],
    )

    add_heading_line(doc, "6. Sales — who to contact, from the same report")
    add_body(
        doc,
        "An idea appears in Sales after its business report is written and its Jira story exists. The operator names a country (required), and optionally a city, the kind of organisation, the person to reach, and a note. Who to look for and the person to reach are filled from the report and can be changed. Real cloud reads public websites with the sales-ticked model. Practice shows the report summary only, so a first meeting still needs no internet scrape. One search lists up to 25 accounts.",
        space_after=4,
    )
    add_body(
        doc,
        "Each row holds the company, website, fit (strong / possible / skip), the named person and role where the site published them, email, phone, LinkedIn, why they fit, what they do, a suggested opener, a working stage (New, Contacted, Replied, Not a fit), and a rep note. Filters: ready to contact, needs a person, all, not a fit. The book downloads as a spreadsheet. When the list exists, Marketing opens from that idea.",
        space_after=4,
    )

    add_heading_line(doc, "7. Marketing — the campaign for those people")
    add_body(
        doc,
        "Marketing starts after Sales has a list. Topic and audience start from the business report; the people come from Sales. The operator can change both if this campaign is for someone else. Six tools sit on one screen:",
        space_after=3,
    )
    compact_table(
        doc,
        ["Tool", "What you get"],
        [
            ["Chat", "A sales assistant on the idea. If name and email are both filled, the person is saved as a lead."],
            ["Content", "Caption, ad copy, email, and blog outline for Instagram, LinkedIn, Blog, or Email."],
            ["Picture", "A generated still from a prompt, using the picture model slot."],
            ["Video", "Four scenes. The line is on the picture and read aloud. Click a scene to jump there."],
            ["SEO", "Search phrases, page title, page outline, and what to publish."],
            ["Leads", "The Sales list plus people saved here (name, email, phone, interest)."],
        ],
        [3.4, 13.9],
    )
    add_body(
        doc,
        "Practice drafts the copy locally so a briefing can show the shape. Real cloud uses the plan model for words, and the picture / video slots for stills and film. Pieces can be downloaded as text. No extra data broker sits between you and the public web — Sales and Marketing use the model you already connected under Logins.",
        space_before=5,
        space_after=4,
    )

    add_heading_line(doc, "8. How it is installed, secured, and operated")
    compact_table(
        doc,
        ["Concern", "How Shipdeck handles it"],
        [
            ["Where it runs", "A host you control. Web (React) + API (Node 22 / Express) + optional PostgreSQL. Docker Compose and nginx packaging are included. UI in compose: port 8088."],
            ["Where applications land", "Your cloud account and region, or a server you already run. Terraform modules ship with the product for VM, health function, full application, and managed database."],
            ["Where model traffic goes", "The endpoint you configure, including a private or on-network endpoint (for example Ollama)."],
            ["Logins", "Typed once, reused by name, each testable. Build folder: Jira, Git, model. Deploy folder: SSH, AWS, Azure, GCP, Docker, registry, Kubernetes, notify. Secrets never returned in ordinary screens."],
            ["Secrets", "AES-256-GCM on the installation. The Secrets screen shows a mask and fingerprint. Reading plaintext is a separate, audited act."],
            ["Access", "Viewer < operator < admin. Customer installations run with authentication on. Rate limiting (default 180 requests / minute). Optional SHIPDECK_API_TOKEN."],
            ["Evidence", "Append-only audit of policy changes, ticket decisions, file changes, tests, secret access, and every release log. JSON files by default, or PostgreSQL when DATABASE_URL is set."],
            ["Detection", "Reads the application and recommends runtime, ports, VM size, serverless memory/timeout, and function vs full-app. The operator confirms before apply."],
            ["Network", "Private ports (SSH, databases, caches) stay off the public internet. Public ports are the ones the app actually serves."],
            ["What you keep paying", "Amazon, Microsoft, or Google; your model vendor; Atlassian; GitHub. Shipdeck is the control plane, not a reseller."],
            ["Continuity", "You hold the backup of the installation, including the key that protects stored logins. Orphan runs are reclaimed if the API restarts mid-flight."],
        ],
        [3.6, 13.7],
    )

    add_heading_line(doc, "9. Who it is for")
    compact_table(
        doc,
        ["Buyer", "What they need", "What they get"],
        [
            ["Platform or delivery lead", "A standard path and an audit trail.", "Named gates, protected credentials, one pipeline shape across three clouds, DESTROY at the end."],
            ["Engineering manager", "A backlog item a stakeholder can click.", "A rehearsal with no cloud spend, then a live run when the team is ready."],
            ["Product studio or services firm", "The same motion for many client applications.", "A project cockpit, a clean ending for each demo, client-owned cloud credentials, Sales and Marketing from the same brief."],
            ["Founder evaluating a pilot", "Proof before a long platform programme.", "A working product. The first session does not need a cloud account."],
        ],
        [4.4, 5.6, 7.3],
    )
    add_body(
        doc,
        "The daily user is the operator who connects logins, runs the idea, approves or rejects, and ships. Leadership buys the permission, the speed, the end of orphaned environments, and a go-to-market that starts from the same report. Shipdeck is the wrong first purchase for a team that wants an unrestricted coding agent, a replacement for their entire CI catalogue, or a model that deploys itself with no human gate. Those buyers should be narrowed to the ship cockpit only, or declined.",
        space_before=5,
        space_after=4,
    )

    add_heading_line(doc, "10. Why you need to buy this product")
    add_body(
        doc,
        "You are not being asked to buy another dashboard. You are being asked to buy the missing path — the thing your tools cannot do even though you already pay for all of them.",
        space_after=4,
        italic=True,
    )
    reasons = [
        (
            "Because the delay is the handoff, not the talent.",
            "A small internal app or a client demo currently needs a platform engineer, a developer, and a cloud person, even when the application itself is small. Shipdeck gives one operator a single journey: describe, approve, ship. The calendar time you buy back is the commercial case.",
        ),
        (
            "Because leadership will not allow a model near production without a named person on each gate.",
            "Plan, code, and release are separate approvals. Practice is the default. Terraform apply is a further confirmation. Approving a ticket never starts the cloud. That is how a risk reviewer says yes.",
        ),
        (
            "Because demo environments currently have no ending.",
            "What Shipdeck created can be destroyed from the run that created it. Proof-of-concept spend stops when the meeting stops. That is real money, not a slogan.",
        ),
        (
            "Because you should learn the delivery shape once.",
            "Seven stages. Three clouds. Existing server or new VM, health function, or full application. Detection recommends the size. The operator confirms. The destination changes; the cockpit does not.",
        ),
        (
            "Because go-to-market should not be a second project.",
            "The same business report that opened the Jira story fills Sales. The same account list fills Marketing. The product, the book of names, and the campaign are one artefact, not three agencies.",
        ),
        (
            "Because the bills should stay visible.",
            "Cloud, model, Jira, and GitHub remain on your invoices. Shipdeck does not bury consumption inside a platform fee. A rehearsal avoids both consumption bills. A pilot names one destination so the live bill is bounded.",
        ),
        (
            "Because audit should be a screen, not a reconstruction.",
            "Who approved the plan, who approved the code, who allowed apply, who revealed a key, what the health check returned, and whether the environment was closed — one product, one history.",
        ),
        (
            "Because the first meeting can be free of cloud risk.",
            "Practice mode walks the whole path on the sample ticket or on language from your backlog. No credentials. If the story does not fit, you have lost forty-five minutes, not a programme.",
        ),
    ]
    table = doc.add_table(rows=len(reasons), cols=1)
    table.autofit = False
    no_table_borders(table)
    for i, (title, body) in enumerate(reasons):
        cell = table.rows[i].cells[0]
        shade(cell, "FBF0E8" if i % 2 else "E6F3F3")
        set_cell_border(cell, "D5DCE0")
        set_cell_margins(cell, 60, 60, 90, 90)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(1)
        run = p.add_run(title)
        set_run_font(run, size=10, bold=True, color=TEAL_DARK if i % 2 == 0 else COPPER)
        p2 = cell.add_paragraph()
        p2.paragraph_format.space_after = Pt(0)
        p2.paragraph_format.line_spacing = 1.08
        run2 = p2.add_run(body)
        set_run_font(run2, size=9.5, color=INK)

    add_heading_line(doc, "11. How a commercial relationship works")
    add_body(
        doc,
        "You buy the right to run Shipdeck on a host you control, and the guided start that puts the first project through it. Pricing is issued as a quotation. It is not printed here.",
        space_after=4,
    )
    compact_table(
        doc,
        ["Engagement", "Purpose", "Done means"],
        [
            ["Briefing", "Confirm fit in Practice mode.", "You have seen the gates, the seven stages, Sales, and Marketing on your own problem. No cloud credentials."],
            ["Pilot", "Prove one path.", "One agreed scope has passed the gates, one release has reached a health check, and the environment is closed or accepted in writing."],
            ["Platform", "Leave the cockpit in daily use.", "The installation is yours, with a named operator capacity and support window."],
            ["Implementation", "Add a further path.", "Another project, or another destination shape, after the first is in the operators’ hands."],
        ],
        [3.3, 5.2, 8.8],
    )
    add_body(
        doc,
        "A studio may run one installation across client projects; each client remains a separate project, with that client’s own cloud credentials. Residency follows your choices: the control plane sits where you place it, model calls use the endpoint you configure, cloud resources are created in the region on your cloud login.",
        space_before=5,
        space_after=4,
    )

    add_heading_line(doc, "12. What we are asking you to do next")
    cta = doc.add_table(rows=1, cols=1)
    cell = cta.rows[0].cells[0]
    shade(cell, "0A4548")
    set_cell_border(cell, "0A4548")
    set_cell_margins(cell, 140, 140, 140, 140)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run("Sit the demo. Forty-five minutes. Practice mode. No cloud spend.")
    set_run_font(run, size=14, bold=True, color=WHITE)
    for line in (
        "Bring the smallest application a stakeholder is waiting to open — or we will walk SHIP-1042, the sample warehouse story.",
        "You will see: an idea become a report and a Jira story; a plan a person can approve; a workbench and a test bar; a seven-stage ship that does not touch your cloud until you say so; a sales list and a campaign that start from the same report.",
        "If it fits, the next document is a written pilot: one scope, one destination, named approvers, a rehearsal, a live run, and a close-out.",
        "If it does not fit, you will know in one sitting — which is the honest use of a briefing.",
    ):
        p = cell.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        run = p.add_run(line)
        set_run_font(run, size=10, color=RGBColor(0xD7, 0xE8, 0xE8))

    add_body(
        doc,
        "Shipdeck — an idea becomes a live app. You approve each step.",
        size=10,
        italic=True,
        color=TEAL,
        space_before=8,
        space_after=0,
    )

    doc.save(DOCX_PATH)


# ---------- PDF (designed 4-page A4) ----------

W, H = A4
ML, MR, MT, MB = 32, 32, 38, 34


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    words = text.replace("\n", " \n ").split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        if word == "\n":
            lines.append(current)
            current = ""
            continue
        trial = word if not current else f"{current} {word}"
        if stringWidth(trial, font, size) <= width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def draw_wrapped(c, text, x, y, width, font="Times-Roman", size=9, leading=11.2, color=P_INK, align="left") -> float:
    c.setFillColor(color)
    c.setFont(font, size)
    lines = wrap(text, font, size, width)
    for i, line in enumerate(lines):
        yy = y - i * leading
        if align == "center":
            c.drawCentredString(x + width / 2, yy, line)
        else:
            c.drawString(x, yy, line)
    return y - len(lines) * leading


def footer_pdf(c, page: int):
    c.setFillColor(P_MUTED)
    c.setFont("Times-Roman", 8)
    c.drawString(ML, 16, "Shipdeck  ·  Confidential client product brief  ·  November 2026")
    c.drawRightString(W - MR, 16, f"{page} / 4")
    c.setStrokeColor(P_LINE)
    c.setLineWidth(0.4)
    c.line(ML, 26, W - MR, 26)


def header_bar(c, kicker: str):
    c.setFillColor(P_TEAL)
    c.rect(0, H - 22, W, 22, fill=1, stroke=0)
    c.setFillColor(P_WHITE)
    c.setFont("Times-Bold", 9)
    c.drawString(ML, H - 15, "SHIPDECK")
    c.setFont("Times-Roman", 9)
    c.drawString(ML + 62, H - 15, "Visual DevOps Platform V3")
    c.drawRightString(W - MR, H - 15, kicker)


def hrule(c, y, color=P_TEAL):
    c.setStrokeColor(color)
    c.setLineWidth(1.1)
    c.line(ML, y, W - MR, y)


def section_title(c, text, y) -> float:
    c.setFillColor(P_TEAL)
    c.setFont("Times-Bold", 11)
    c.drawString(ML, y, text.upper())
    hrule(c, y - 4)
    return y - 16


def pill(c, x, y, w, h, fill, title, body, title_size=8.5, body_size=7.6):
    c.setFillColor(fill)
    c.roundRect(x, y - h, w, h, 3, fill=1, stroke=0)
    c.setFillColor(P_TEAL_DARK)
    c.setFont("Times-Bold", title_size)
    c.drawString(x + 7, y - 13, title)
    draw_wrapped(c, body, x + 7, y - 25, w - 14, "Times-Roman", body_size, 9.4, P_INK)


def table_block(c, x, y, widths, headers, rows, header_fill=P_TEAL, row_h=None, font_size=7.4, header_size=7.6) -> float:
    col_x = [x]
    for w in widths:
        col_x.append(col_x[-1] + w)
    total_w = sum(widths)

    def row_height(cells, size, leading):
        tallest = 0
        for i, cell in enumerate(cells):
            n = len(wrap(cell, "Times-Roman", size, widths[i] - 12))
            tallest = max(tallest, max(n, 1) * leading + 11)
        return tallest

    hh = row_height(headers, header_size, 9.2) if row_h is None else row_h
    c.setFillColor(header_fill)
    c.rect(x, y - hh, total_w, hh, fill=1, stroke=0)
    c.setFillColor(P_WHITE)
    c.setFont("Times-Bold", header_size)
    for i, h in enumerate(headers):
        lines = wrap(h, "Times-Bold", header_size, widths[i] - 10)
        yy = y - 10
        for line in lines:
            c.drawString(col_x[i] + 5, yy, line)
            yy -= 9.2
    y -= hh
    for r, row in enumerate(rows):
        rh = row_height(row, font_size, 9.1) if row_h is None else row_h
        c.setFillColor(HexColor("#F7FBFA") if r % 2 == 0 else P_WHITE)
        c.rect(x, y - rh, total_w, rh, fill=1, stroke=0)
        c.setStrokeColor(P_LINE)
        c.setLineWidth(0.3)
        c.rect(x, y - rh, total_w, rh, fill=0, stroke=1)
        for i, cell in enumerate(row):
            c.setFillColor(P_INK)
            lines = wrap(cell, "Times-Roman", font_size, widths[i] - 10)
            yy = y - 10
            for line in lines:
                c.setFont("Times-Roman", font_size)
                c.drawString(col_x[i] + 5, yy, line)
                yy -= 9.1
        y -= rh
    return y - 6


def build_pdf() -> None:
    c = pdfcanvas.Canvas(str(PDF_PATH), pagesize=A4)

    # ===== PAGE 1 =====
    header_bar(c, "Client product brief")
    footer_pdf(c, 1)
    c.setFillColor(P_TEAL_DARK)
    c.rect(0, H - 148, W, 126, fill=1, stroke=0)
    c.setFillColor(HexColor("#C8E6E6"))
    c.setFont("Times-Bold", 10)
    c.drawString(ML, H - 48, "SHIPDECK  ·  VISUAL DEVOPS PLATFORM V3")
    c.setFillColor(P_WHITE)
    y = draw_wrapped(
        c,
        "An idea becomes a live app. You approve each step.",
        ML,
        H - 72,
        W - ML - MR,
        "Times-Bold",
        20,
        24,
        P_WHITE,
    )
    draw_wrapped(
        c,
        "The installed visual control plane from a business idea to a running URL — then to the companies who should buy it, and the campaign written for those people. Your Jira, GitHub, model vendor, and cloud account stay yours. Shipdeck is the cockpit in front of them.",
        ML,
        y - 8,
        W - ML - MR,
        "Times-Roman",
        10,
        13,
        HexColor("#D7E8E8"),
    )

    y = H - 168
    y = draw_wrapped(
        c,
        "This document is the product, written so a buyer can decide to sit a demonstration. Practice mode needs no cloud account and no model key. Bring one small-application idea. Forty-five minutes is enough to see the path. Commercial terms are quoted separately.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        9.3,
        12,
        P_INK,
    )

    y = section_title(c, "1.  The problem we are solving", y - 14)
    y = draw_wrapped(
        c,
        "A change still starts as an idea or a ticket and is supposed to end as a running application that someone can sell. Between those two moments the work is split across a tracker, a chat with a model, a repository, a cloud console, a pipeline nobody wants to press, a leftover virtual machine, and a marketing team that starts from a blank page after the demo. Teams already own capable tools. They do not own one path through them.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        9.2,
        11.6,
        P_INK,
    )
    y = table_block(
        c,
        ML,
        y - 8,
        [158, 373],
        ["What you already have", "What the business still feels"],
        [
            ["A ticket in Jira, or an idea in a meeting", "The plan lives in a chat thread. Nobody can point to an approved architecture."],
            ["A coding model or coding agent", "Files appear quickly. Approvers, spend limits, tests, and the allowed destination do not travel with them."],
            ["GitHub and a CI system", "The pipeline starts after someone has already assembled the scripts. CI does not rehearse a cloud create without spending money."],
            ["AWS, Azure or Google Cloud, plus Terraform", "Every demo is a fresh design. Sizing, ports, health and teardown depend on whoever is free."],
            ["A sales and marketing motion", "The product is live, but the account list and the campaign are a separate project, weeks later."],
            ["An audit requirement", "Who approved the plan, the code, Terraform apply, and a revealed key is reconstructed from inboxes."],
        ],
    )
    y = draw_wrapped(
        c,
        "The cost is calendar time on small applications, cloud left running after the proof, leadership that will not let a model near a live environment, and a go-to-market that starts too late. Shipdeck exists so a defined class of work — idea, ticket, application, known destination, named human gates, contact list, campaign — follows one operator path.",
        ML,
        y - 8,
        W - ML - MR,
        "Times-Roman",
        9.1,
        11.5,
        P_INK,
    )

    y = section_title(c, "2.  What Shipdeck is", y - 12)
    y = draw_wrapped(
        c,
        "One installed product. Five studios, joined by the operator. Not a general CI catalogue. Not a replacement for Jira or GitHub. Not a reseller of cloud or model accounts. The cockpit in front of the accounts you already pay for.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        9.2,
        11.6,
        P_INK,
    )
    beats = [
        ("1  Idea", "Describe the business. Write the report. Read the market. Open a Jira story."),
        ("2  Ticket", "Approve the plan, the code and the tests. A person signs each gate."),
        ("3  Ship", "Seven visual stages to a URL. Rehearse first. Tear down when done."),
        ("4  Sales", "Find the companies from the report. Person, email, phone, LinkedIn."),
        ("5  Marketing", "Write the campaign for those people: content, picture, video, SEO, leads."),
    ]
    bw = (W - ML - MR - 16) / 5
    for i, (t, b) in enumerate(beats):
        pill(c, ML + i * (bw + 4), y - 6, bw, 78, P_TEAL_SOFT if i % 2 == 0 else P_COPPER_SOFT, t, b)
    y = y - 92
    y = draw_wrapped(
        c,
        "Beside those five: Home (the story and the project), Logins (credentials, once), Secrets (inventory and audited reveal), and History (every release). Work is organised by project, so a studio keeps each client together. A switch above the work chooses Practice or Real cloud. Practice is the default. Roles: viewer, operator, admin. Light and dark appearance in the chrome.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        9.0,
        11.4,
        P_INK,
    )

    c.showPage()

    # ===== PAGE 2 =====
    header_bar(c, "Idea  ·  Ticket")
    footer_pdf(c, 2)
    y = H - 40
    y = section_title(c, "3.  Idea — start with the business, not a ticket", y)
    y = draw_wrapped(
        c,
        "Tickets begin only after the owner has described the application. Pick an industry from the catalogue — Agriculture, Construction, Education, Energy, Finance, Food service, Government, Healthcare, Hospitality, Logistics, Manufacturing, Professional services, Property, Retail, Technology — name the application if you already have a name, and start a brief.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        9.1,
        11.5,
        P_INK,
    )
    y = table_block(
        c,
        ML,
        y - 7,
        [78, 210, 243],
        ["Step", "What the owner sees", "What the product does"],
        [
            ["Application", "Industry plus an optional working name.", "Nothing is assumed. The owner’s words decide the product."],
            ["Describe", "A chat, or an uploaded report (txt, md, pdf, docx, pptx, rtf).", "Practice replies locally. Real cloud uses the plan model. Uploads are excerpted into the brief."],
            ["Business report", "Problem, customer, offer, version-one scope, and what is not this time.", "Written from the chat and the file. No invented revenue numbers. Can be rewritten after more chat."],
            ["Market", "Definition, segments, size method, demand, competitors, position, SWOT, PESTLE, five forces, price, go-to-market, what to validate.", "A first-pass read, labelled as such — not a commissioned study. Refreshable."],
            ["Technical pack", "An editable technical brief, then a Jira user story.", "Creates the Jira project and story on Cloud or Data Center, then opens the ticket. Sales unlocks from this report."],
        ],
    )
    y = draw_wrapped(
        c,
        "The owner can edit the technical brief before the story is created, and can write the same story to a different saved Jira. Technical slides are built later, after architecture.md is approved on the ticket. An idea that already has a report and a Jira story is ready for Sales without waiting for the application to finish shipping.",
        ML,
        y - 7,
        W - ML - MR,
        "Times-Roman",
        9.0,
        11.4,
        P_INK,
    )

    y = section_title(c, "4.  Ticket — a person on the plan, the code, and the release", y - 12)
    y = draw_wrapped(
        c,
        "A ticket starts from the Idea handoff, from the built-in sample (SHIP-1042, a warehouse stock-reservation story), from pasted text, or from a live Jira issue. Choose a new application or a change to an existing repository. On a live change to something already running, name the server or cloud service that hosts it. A repeated Jira webhook for an allowed project returns the run already in progress.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        9.0,
        11.4,
        P_INK,
    )
    y = table_block(
        c,
        ML,
        y - 7,
        [72, 230, 229],
        ["Gate", "What is produced", "What a person must do"],
        [
            ["Plan", "architecture.md: intent, diagrams, components, API table from acceptance lines, in/out of scope, assumptions, a health URL. On an existing repo, also impact-analysis.md.", "Read it. Revise with a note, reject, or approve. Unclear tickets stop on open questions. A forecast over 200,000 tokens or USD 25 stops the gate. Comments and attachments are judged; only relevant material enters the plan (images to a vision-capable model; office and text files excerpted, cap 8 MB / 12 files)."],
            ["Code", "A project folder on branch shipdeck/<TICKET>. Chat models write files one at a time. Cursor can act as the folder agent. A secrets scan (key shapes, PEM, assigned api_key / secret / password / token) runs before anyone accepts the tree.", "Open the workbench. See the running page (preview proxied so the iframe stays on the product). Edit by hand, ask for a change inside this ticket, record an out-of-scope idea back to Jira, or send a screenshot to the model. A dedicated test bench limits a tester to test files."],
            ["Tests", "Lint, unit and integration (node --check, then unit and integration files). Thirty seconds each.", "They must pass before code approval. Skip exists only here, and it is an explicit decision, not a silent bypass."],
            ["Pull request", "GitHub PR whose body is the approved architecture (first 4,000 characters). Other Git hosts keep the local branch.", "Optional, when auto-open is on and a GitHub token is present."],
            ["Release approval", "Who approved, Git and destination logins prepared, status completed.", "This does not start Terraform and does not spend cloud money. The operator then opens Ship and runs the pipeline. Kill stops the ticket. Destroy of cloud is a separate act on the ship run."],
        ],
        font_size=7.15,
    )
    y = draw_wrapped(
        c,
        "The model is yours. Plan and code are two slots. Chat paths: Azure OpenAI, OpenAI-compatible endpoints (OpenAI, Mistral, Groq, Ollama, Databricks), Anthropic, Gemini, Bedrock, Cohere, watsonx. Cursor is the live folder agent for implementation. Picture and video are separate slots for Marketing. Keys stay encrypted on the Shipdeck host. Shipdeck does not take a cut of the model bill. Caps of 200,000 tokens and USD 25 per plan are product safety stops, not the licence fee.",
        ML,
        y - 7,
        W - ML - MR,
        "Times-Roman",
        8.8,
        11.2,
        P_INK,
    )
    y = draw_wrapped(
        c,
        "Honest scope of the ticket writer. This release writes a small Node application from the approved architecture, with fixture-style data, a page, and GET /health, so the ship path always has something to call. Python sits on the language allow-list; the sandbox that executes tests is Node. Teams that already have code skip the writer and use Ship alone. Live Jira runs can comment status, file saves, and out-of-scope asks back onto the issue.",
        ML,
        y - 6,
        W - ML - MR,
        "Times-Roman",
        8.8,
        11.2,
        P_INK,
    )

    y = section_title(c, "Control, security, and where it runs", y - 11)
    y = table_block(
        c,
        ML,
        y,
        [92, 439],
        ["Concern", "How Shipdeck handles it"],
        [
            ["Installation", "A host you control. Web (React) + API (Node 22 / Express) + optional PostgreSQL. Docker Compose and nginx included. Compose UI on port 8088. Terraform modules ship for VM, health function, full application, and managed database."],
            ["Logins & secrets", "Typed once, reused, each testable. Build: Jira, Git, model. Deploy: SSH, AWS, Azure, GCP, Docker, registry, Kubernetes, notify. AES-256-GCM. Secrets screen shows a mask and fingerprint. Reading plaintext is a separate, audited act."],
            ["Access, network & bills", "Viewer < operator < admin. Authentication on. Rate limit 180 / minute. Append-only audit of policy, tickets, files, tests, secret access and releases. Private ports stay off the public internet. Cloud, model, Jira and GitHub stay on your invoices. You hold the backup and the secrets key."],
        ],
        font_size=7.2,
    )

    c.showPage()

    # ===== PAGE 3 =====
    header_bar(c, "Ship  ·  destinations  ·  control plane")
    footer_pdf(c, 3)
    y = H - 40
    y = section_title(c, "5.  Ship — seven stages, one visual run", y)
    y = draw_wrapped(
        c,
        "The ship engine is how a finished project folder, or any application you already have, reaches a server or a cloud target. Stages run in a fixed order. Data always runs before Deploy. Attach connections, accept or adjust the recommended size, click Run pipeline. Logs stream into the run. Active runs refresh about every 700 ms.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        9.0,
        11.4,
        P_INK,
    )

    stages = [
        ("SOURCE", "Local folder or remote Git. Detect the stack."),
        ("INFRA", "Skip · existing SSH · create VM / function / full app."),
        ("BUILD", "Tests · image · registry. Skipped on serverless."),
        ("DATA", "Off, container DB, or managed cloud DB."),
        ("DEPLOY", "Docker · Compose · systemd · Kubernetes."),
        ("VERIFY", "Health check. Optional auto-rollback."),
        ("NOTIFY", "Webhook when the run should tell someone."),
    ]
    sw = (W - ML - MR - 18) / 7
    for i, (name, desc) in enumerate(stages):
        x = ML + i * (sw + 3)
        c.setFillColor(STAGE[i])
        c.roundRect(x, y - 58, sw, 52, 3, fill=1, stroke=0)
        c.setFillColor(P_WHITE)
        c.setFont("Times-Bold", 7.4)
        c.drawCentredString(x + sw / 2, y - 20, name)
        draw_wrapped(c, desc, x + 4, y - 32, sw - 8, "Times-Roman", 6.6, 8.2, P_WHITE, "left")
    y -= 68

    y = table_block(
        c,
        ML,
        y,
        [70, 160, 301],
        ["Stage", "Choices", "Live behaviour — the detail that matters"],
        [
            ["1. Source", "Local folder or remote Git.", "Clone or use the path. Detection recommends runtime, port, VM size, serverless memory/timeout, and function vs full-app. The operator confirms."],
            ["2. Infra", "Skip · existing server (SSH) · create new.", "Create is Terraform, on AWS, Azure or Google Cloud. Three shapes: VM with Docker; health function (Lambda / Azure Functions / Cloud Functions); full application (containers + managed database + cache + HTTPS). AWS full-app uses ECS Express; Azure uses Container Apps; Google Cloud uses Cloud Run. Images can be built by CodeBuild, ACR Tasks or Cloud Build from remote Git, so the operator PC does not have to build them. Apply waits for a named approval unless TF apply is already allowed. A new VM can auto-save an SSH login with the Deploy PEM."],
            ["3. Build", "Existing or generated tests; existing Dockerfile or Dockerfile.shipdeck; optional registry push.", "Skipped when the target is serverless, because the image or package is produced on the cloud path."],
            ["4. Data", "Off; container Postgres / MySQL / Redis / Mongo; or managed cloud DB.", "Azure Flexible Server, AWS RDS / Aurora, GCP Cloud SQL. Data ports stay private. Full-app modules often attach Postgres and Redis with the application."],
            ["5. Deploy", "Docker, Compose, systemd or Kubernetes; or the serverless release.", "Public access is limited to the ports the application actually serves. SSH, databases and similar private ports are never published. The operator can preview which ports would open before they are opened."],
            ["6. Verify", "Health URL, timeout, optional auto-rollback.", "HTTP probe of /health, /shipper or the inferred address. Failure can roll back to the previous container or destroy the environment just created."],
            ["7. Notify", "Optional webhook.", "POST to the endpoint the team named when the run should tell someone."],
        ],
        font_size=7.05,
    )
    y = draw_wrapped(
        c,
        "The console states in plain language whether the run is rehearsing, waiting for approval, preparing a host, succeeded with an address, or stopped on a stage whose log is open. When Shipdeck created the environment, the operator types DESTROY on that same run (Terraform destroy, thirty-minute window). Closing an environment and stopping a ticket are separate decisions. If a live create fails after infrastructure was provisioned, the orchestrator rolls the environment back. Orphan runs left running after an API restart are reclaimed.",
        ML,
        y - 6,
        W - ML - MR,
        "Times-Roman",
        8.7,
        11.1,
        P_INK,
    )

    y = section_title(c, "Destinations you can show in a pilot", y - 11)
    y = table_block(
        c,
        ML,
        y,
        [95, 220, 216],
        ["Destination", "What the business gets", "When to use it"],
        [
            ["Practice (default)", "Every stage logged. No model call. No cloud change.", "First meeting, operator rehearsal, stakeholder walk-through."],
            ["Local live", "The included demo app answers at a health URL on the machine (Docker).", "Proof that Live is real, still without a cloud account."],
            ["Existing server", "SSH to a machine you already run. Docker / Compose / systemd / Kubernetes.", "You have a host. You do not want a new bill."],
            ["Create VM", "A sized virtual machine with containers ready, in your region.", "A dedicated box for a demo or an internal tool, with DESTROY at the end."],
            ["Health function", "An HTTPS address that returns health JSON.", "Prove the cloud path in minutes."],
            ["Full application", "Real UI on a managed container service, managed database, cache, HTTPS.", "The client needs to click a product, not a health payload."],
        ],
        font_size=7.3,
    )

    y = section_title(c, "What a first session looks like", y - 11)
    steps = [
        ("1", "Open Home, name a project in your words. Leave the switch on Practice."),
        ("2", "Start an idea, or the sample ticket SHIP-1042. Read the architecture together."),
        ("3", "Show that an unclear ticket would stop. Approve the plan. Open the workbench."),
        ("4", "Run the test bar. Approve the code. Approve the release — cloud still unchanged."),
        ("5", "Walk the seven stages. Show History, Logins and Secrets. Agree one pilot destination."),
    ]
    sw = (W - ML - MR - 16) / 5
    for i, (n, text) in enumerate(steps):
        x = ML + i * (sw + 4)
        c.setFillColor(P_TEAL_SOFT if i % 2 == 0 else P_COPPER_SOFT)
        c.roundRect(x, y - 78, sw, 72, 3, fill=1, stroke=0)
        c.setFillColor(P_TEAL if i % 2 == 0 else P_COPPER)
        c.setFont("Times-Bold", 11)
        c.drawString(x + 7, y - 16, n)
        draw_wrapped(c, text, x + 7, y - 30, sw - 14, "Times-Roman", 7.3, 9.3, P_INK)
    y = y - 88
    y = draw_wrapped(
        c,
        "A first meeting is complete in Practice mode. A second session can add a local live run with Docker, a test of your Jira login, or a read of a repository you already have. Cloud creation belongs to the pilot, with your account and an apply decision still in front of it.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        8.8,
        11.2,
        P_INK,
    )

    c.showPage()

    # ===== PAGE 4 =====
    header_bar(c, "Sales  ·  Marketing  ·  why buy  ·  next step")
    footer_pdf(c, 4)
    y = H - 40
    y = section_title(c, "7.  Sales — who to contact, from the same report", y)
    y = draw_wrapped(
        c,
        "An idea appears in Sales after its business report is written and its Jira story exists. Name a country (required), optionally a city, the kind of organisation, the person to reach, and a note. Who to look for is filled from the report and can be changed. Real cloud reads public websites with the sales-ticked model. Practice shows the report summary only. One search lists up to 25 accounts. No extra data broker.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        8.6,
        10.9,
        P_INK,
    )
    y = draw_wrapped(
        c,
        "Each row: company, website, fit (strong / possible / skip), named person and role, email, phone, LinkedIn, why they fit, what they do, a suggested opener, stage (New, Contacted, Replied, Not a fit), and a rep note. Filters: ready to contact, needs a person, all, not a fit. Download as a spreadsheet. When the list exists, Marketing opens from that idea.",
        ML,
        y - 4,
        W - ML - MR,
        "Times-Roman",
        8.6,
        10.9,
        P_INK,
    )

    y = section_title(c, "8.  Marketing — the campaign for those people", y - 9)
    y = table_block(
        c,
        ML,
        y,
        [70, 461],
        ["Tool", "What you get"],
        [
            ["Chat", "A sales assistant on the idea. If name and email are both filled, the person is saved as a lead."],
            ["Content", "Caption, ad copy, email and blog outline for Instagram, LinkedIn, Blog or Email."],
            ["Picture", "A generated still from a prompt, using the picture model slot."],
            ["Video", "Four scenes. The line is on the picture and read aloud. Click a scene to jump there."],
            ["SEO", "Search phrases, page title, page outline, and what to publish."],
            ["Leads", "The Sales list plus people saved here (name, email, phone, interest). Practice drafts copy locally; Real cloud uses the plan, picture and video slots."],
        ],
        font_size=7.3,
    )

    y = section_title(c, "9.  Who it is for", y - 8)
    y = table_block(
        c,
        ML,
        y,
        [118, 175, 238],
        ["Buyer", "What they need", "What they get"],
        [
            ["Platform or delivery lead", "A standard path and an audit trail.", "Named gates, protected credentials, one pipeline shape across three clouds, DESTROY at the end."],
            ["Engineering manager", "A backlog item a stakeholder can click.", "A rehearsal with no cloud spend, then a live run when the team is ready."],
            ["Studio or services firm", "The same motion for many client apps.", "Project cockpit, clean ending for each demo, client-owned credentials, Sales and Marketing from the same brief."],
            ["Founder evaluating a pilot", "Proof before a long platform programme.", "A working product. The first session does not need a cloud account."],
        ],
        font_size=7.15,
    )
    y = draw_wrapped(
        c,
        "The daily user is the operator. Leadership buys the permission, the speed, the end of orphaned environments, and a go-to-market from the same report. Wrong first purchase: an unrestricted coding agent, a replacement for an entire CI catalogue, or a model that deploys with no human gate.",
        ML,
        y - 4,
        W - ML - MR,
        "Times-Roman",
        8.3,
        10.6,
        P_INK,
    )

    y = section_title(c, "10.  Why you need to buy this product", y - 9)
    y = draw_wrapped(
        c,
        "You are not being asked to buy another dashboard. You are being asked to buy the missing path — the thing your tools cannot do even though you already pay for all of them.",
        ML,
        y,
        W - ML - MR,
        "Times-Italic",
        8.8,
        11.2,
        P_TEAL_DARK,
    )
    reasons = [
        ("The delay is the handoff, not the talent.", "A small app currently needs a platform engineer, a developer and a cloud person. One operator: describe, approve, ship. Calendar time is the commercial case."),
        ("Leadership needs named gates.", "Plan, code and release are separate approvals. Practice is the default. Terraform apply is a further confirmation. Approving a ticket never starts the cloud."),
        ("Demo environments have no ending.", "What Shipdeck created can be destroyed from the run that created it. Proof-of-concept spend stops when the meeting stops."),
        ("Learn the delivery shape once.", "Seven stages. Three clouds. Existing server or new VM, health function or full application. Detection recommends size. The cockpit does not change."),
        ("Go-to-market is not a second project.", "The same business report that opened the Jira story fills Sales. The same account list fills Marketing. One artefact, not three agencies."),
        ("Bills stay visible. Audit is a screen.", "Cloud, model, Jira and GitHub remain on your invoices. Who approved, who revealed a key, whether the environment closed — one history."),
    ]
    col_w = (W - ML - MR - 8) / 2
    card_h = 38
    y -= 5
    for i, (title, body) in enumerate(reasons):
        col = i % 2
        row = i // 2
        x = ML + col * (col_w + 8)
        yy = y - row * (card_h + 5)
        c.setFillColor(P_TEAL_SOFT if i % 2 == 0 else P_COPPER_SOFT)
        c.roundRect(x, yy - card_h, col_w, card_h, 3, fill=1, stroke=0)
        c.setFillColor(P_TEAL_DARK if i % 2 == 0 else P_COPPER)
        c.setFont("Times-Bold", 7.4)
        c.drawString(x + 7, yy - 10, title)
        draw_wrapped(c, body, x + 7, yy - 20, col_w - 14, "Times-Roman", 6.8, 8.4, P_INK)
    y = y - 3 * (card_h + 5) - 4

    y = section_title(c, "11.  How a commercial relationship works", y - 4)
    offers = [
        ("Briefing", "Practice mode on your problem. No cloud credentials. Fit decision in one sitting."),
        ("Pilot", "One scope, one destination, named approvers, health check, close-out or written keep."),
        ("Platform", "Annual use of the installation, operator capacity, named support window."),
        ("Implementation", "The next project or destination, once the first path is in your operators’ hands."),
    ]
    ow = (W - ML - MR - 12) / 4
    for i, (title, body) in enumerate(offers):
        x = ML + i * (ow + 4)
        c.setFillColor(P_TEAL_SOFT if i % 2 == 0 else P_COPPER_SOFT)
        c.roundRect(x, y - 62, ow, 56, 3, fill=1, stroke=0)
        c.setFillColor(P_TEAL_DARK if i % 2 == 0 else P_COPPER)
        c.setFont("Times-Bold", 8)
        c.drawString(x + 6, y - 14, title)
        draw_wrapped(c, body, x + 6, y - 26, ow - 12, "Times-Roman", 6.8, 8.6, P_INK)
    y = y - 68
    y = draw_wrapped(
        c,
        "You buy the right to run Shipdeck on a host you control, plus the guided start for the first project. Pricing is quoted separately. Cloud, model, Jira and GitHub stay on your invoices. One installation can serve many client projects, each with that client’s own credentials.",
        ML,
        y,
        W - ML - MR,
        "Times-Roman",
        8.0,
        10.2,
        P_INK,
    )

    box_h = 80
    gap = 10
    box_top = y - gap
    min_bottom = 34
    box_bottom = box_top - box_h
    if box_bottom < min_bottom:
        box_bottom = min_bottom
        box_h = max(70, box_top - box_bottom)
        box_top = box_bottom + box_h
    c.setFillColor(P_TEAL_DARK)
    c.roundRect(ML, box_bottom, W - ML - MR, box_h, 4, fill=1, stroke=0)
    c.setFillColor(P_WHITE)
    c.setFont("Times-Bold", 11)
    c.drawString(ML + 12, box_top - 16, "12.  Sit the demo.  Forty-five minutes.  Practice mode.  No cloud spend.")
    draw_wrapped(
        c,
        "Bring the smallest application a stakeholder is waiting to open — or we walk SHIP-1042. You will see an idea become a report and a Jira story; a plan a person can approve; a workbench and a test bar; a seven-stage ship that does not touch your cloud until you say so; a sales list and a campaign from the same report. If it fits, the next document is a written pilot: one scope, one destination, named approvers, a rehearsal, a live run, and a close-out. If it does not fit, you will know in one sitting.",
        ML + 12,
        box_top - 30,
        W - ML - MR - 24,
        "Times-Roman",
        8.0,
        10.4,
        HexColor("#D7E8E8"),
    )

    c.save()


if __name__ == "__main__":
    build_docx()
    build_pdf()
    print(f"Wrote {DOCX_PATH}")
    print(f"Wrote {PDF_PATH}")
