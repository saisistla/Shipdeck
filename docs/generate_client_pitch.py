"""Generate Shipdeck client pitch deck (entrepreneurs)."""
from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import nsmap
from pptx.oxml import parse_xml
from pptx.util import Emu, Inches, Pt

# Brand (Shipdeck: teal + copper — not generic purple)
TEAL = RGBColor(0x0F, 0x6B, 0x6B)
TEAL_DARK = RGBColor(0x0A, 0x45, 0x48)
TEAL_SOFT = RGBColor(0xE6, 0xF3, 0xF3)
COPPER = RGBColor(0xC4, 0x6B, 0x3A)
COPPER_SOFT = RGBColor(0xFB, 0xF0, 0xE8)
INK = RGBColor(0x1A, 0x1F, 0x24)
MUTED = RGBColor(0x5A, 0x64, 0x6E)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LINE = RGBColor(0xD5, 0xDC, 0xE0)
OK = RGBColor(0x1F, 0x7A, 0x4C)
WARN = RGBColor(0xB5, 0x7A, 0x1A)
STAGE = [
    RGBColor(0x2B, 0x6C, 0xB0),  # source
    RGBColor(0x0F, 0x6B, 0x6B),  # infra
    RGBColor(0x6B, 0x4C, 0x9A),  # build
    RGBColor(0xC4, 0x6B, 0x3A),  # data
    RGBColor(0x1F, 0x7A, 0x4C),  # deploy
    RGBColor(0xB5, 0x7A, 0x1A),  # verify
    RGBColor(0x4A, 0x55, 0x63),  # notify
]

OUT = Path(__file__).resolve().parent / "Shipdeck_Client_Pitch.pptx"
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)


def set_run(run, size=14, bold=False, color=INK, font="Calibri"):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font


def add_text(shape, text, size=14, bold=False, color=INK, align=PP_ALIGN.LEFT, font="Calibri"):
    tf = shape.text_frame
    tf.clear()
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    set_run(run, size=size, bold=bold, color=color, font=font)
    return tf


def add_para(tf, text, size=13, bold=False, color=INK, space_before=6, align=PP_ALIGN.LEFT):
    p = tf.add_paragraph()
    p.alignment = align
    p.space_before = Pt(space_before)
    run = p.add_run()
    run.text = text
    set_run(run, size=size, bold=bold, color=color)
    return p


def fill(shape, color: RGBColor):
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()


def fill_line(shape, fill_c: RGBColor, line_c: RGBColor = LINE):
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_c
    shape.line.color.rgb = line_c
    shape.line.width = Pt(1)


def rect(slide, l, t, w, h, color):
    s = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RECTANGLE, l, t, w, h)
    fill(s, color)
    return s


def round_rect(slide, l, t, w, h, color, line=None):
    s = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE, l, t, w, h)
    if line:
        fill_line(s, color, line)
    else:
        fill(s, color)
    return s


def pill(slide, l, t, w, h, text, bg, fg=WHITE, size=11):
    s = round_rect(slide, l, t, w, h, bg)
    s.text_frame.word_wrap = True
    tf = add_text(s, text, size=size, bold=True, color=fg, align=PP_ALIGN.CENTER)
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    for p in tf.paragraphs:
        p.alignment = PP_ALIGN.CENTER
    s.text_frame.auto_size = None
    # vertical center approximation
    s.text_frame.paragraphs[0].space_before = Pt(2)
    return s


def footer(slide, n, total=9):
    box = slide.shapes.add_textbox(Inches(0.5), Inches(7.15), Inches(10), Inches(0.25))
    add_text(box, "Shipdeck  ·  Confidential client briefing", size=10, color=MUTED)
    num = slide.shapes.add_textbox(Inches(12.2), Inches(7.15), Inches(0.8), Inches(0.25))
    add_text(num, f"{n}/{total}", size=10, color=MUTED, align=PP_ALIGN.RIGHT)


def section_bar(slide):
    rect(slide, Inches(0), Inches(0), SLIDE_W, Inches(0.08), TEAL)


def blank_slide(prs):
    layout = prs.slide_layouts[6]  # blank
    return prs.slides.add_slide(layout)


def slide_title(prs):
    s = blank_slide(prs)
    rect(s, Inches(0), Inches(0), Inches(0.28), SLIDE_H, TEAL)
    rect(s, Inches(0), Inches(6.9), SLIDE_W, Inches(0.6), TEAL_DARK)

    brand = s.shapes.add_textbox(Inches(0.9), Inches(1.5), Inches(11), Inches(0.5))
    add_text(brand, "SHIPDECK", size=18, bold=True, color=TEAL)

    title = s.shapes.add_textbox(Inches(0.9), Inches(2.1), Inches(11.5), Inches(1.4))
    tf = add_text(title, "Enterprise visual delivery control", size=40, bold=True, color=INK)
    add_para(tf, "From source to production — one opinionated cockpit.", size=20, color=MUTED, space_before=10)

    tag = s.shapes.add_textbox(Inches(0.9), Inches(4.0), Inches(11), Inches(1.2))
    tf = add_text(tag, "Client briefing for founders & operators", size=16, color=INK)
    add_para(tf, "ADF-style path: Source → Infra → Build → Data → Deploy → Verify → Notify", size=14, color=MUTED, space_before=8)

    note = s.shapes.add_textbox(Inches(0.9), Inches(7.0), Inches(11), Inches(0.35))
    add_text(note, "Simulate safely  ·  Run live when ready  ·  Multi-cloud by design", size=12, color=WHITE)


def slide_problem(prs):
    s = blank_slide(prs)
    section_bar(s)
    footer(s, 2)

    h = s.shapes.add_textbox(Inches(0.6), Inches(0.35), Inches(12), Inches(0.6))
    add_text(h, "The real cost is not tools — it is the seams between them", size=26, bold=True, color=INK)

    sub = s.shapes.add_textbox(Inches(0.6), Inches(1.0), Inches(12), Inches(0.4))
    add_text(sub, "Every delivery still requires stitching Git, cloud credentials, Terraform, images, databases, health checks, and approvals by hand.", size=14, color=MUTED)

    pains = [
        ("Fragmented ownership", "Repo in one place, infra in another, deploy scripts elsewhere — no single truth."),
        ("Fear of Live", "Teams avoid real cloud runs because there is no safe Simulate rehearsal."),
        ("Hidden spend", "Orphan VMs, forgotten DBs, and no one-click tear-down after a demo."),
        ("Governance gaps", "Who approved Terraform apply? Who can destroy? Audit is an afterthought."),
    ]
    for i, (t, d) in enumerate(pains):
        col = i % 2
        row = i // 2
        left = Inches(0.6) + Inches(col * 6.2)
        top = Inches(1.7) + Inches(row * 2.15)
        card = round_rect(s, left, top, Inches(5.9), Inches(1.95), WHITE, LINE)
        bar = rect(s, left, top, Inches(0.12), Inches(1.95), COPPER if i % 2 == 0 else TEAL)
        tb = s.shapes.add_textbox(left + Inches(0.4), top + Inches(0.35), Inches(5.2), Inches(1.4))
        tf = add_text(tb, t, size=16, bold=True, color=INK)
        add_para(tf, d, size=13, color=MUTED, space_before=8)


def slide_solution(prs):
    s = blank_slide(prs)
    section_bar(s)
    footer(s, 3)

    h = s.shapes.add_textbox(Inches(0.6), Inches(0.35), Inches(12), Inches(0.55))
    add_text(h, "Shipdeck: one visual control plane for delivery", size=26, bold=True, color=INK)

    sub = s.shapes.add_textbox(Inches(0.6), Inches(0.95), Inches(12), Inches(0.4))
    add_text(
        sub,
        "Not another general CI marketplace. An opinionated delivery cockpit for VM, serverless function, and full-app paths.",
        size=14,
        color=MUTED,
    )

    pillars = [
        ("Visual pipeline", "Seven fixed stages. Configure boxes, attach connections, click Run."),
        ("Simulate → Live", "Default is safe rehearsal. Flip to Live only when credentials and approvals are ready."),
        ("Cloud-native truth", "AWS, Azure, GCP via Terraform. Detect stack. Size compute. Tear down cleanly."),
        ("Operator trust", "RBAC, encrypted secrets, approval gates, audit trail, auto-rollback option."),
    ]
    for i, (t, d) in enumerate(pillars):
        left = Inches(0.55) + Inches(i * 3.15)
        card = round_rect(s, left, Inches(1.65), Inches(3.0), Inches(3.5), TEAL_SOFT if i % 2 == 0 else COPPER_SOFT)
        num = pill(s, left + Inches(0.25), Inches(1.95), Inches(0.55), Inches(0.4), str(i + 1), TEAL if i % 2 == 0 else COPPER)
        tb = s.shapes.add_textbox(left + Inches(0.25), Inches(2.6), Inches(2.5), Inches(2.2))
        tf = add_text(tb, t, size=16, bold=True, color=INK)
        add_para(tf, d, size=12, color=MUTED, space_before=10)

    bottom = s.shapes.add_textbox(Inches(0.6), Inches(5.5), Inches(12), Inches(1.2))
    tf = add_text(bottom, "Business outcome", size=14, bold=True, color=TEAL)
    add_para(
        tf,
        "Shorter path from idea → running URL. Lower cloud waste. Clear accountability for every Live mutation.",
        size=14,
        color=INK,
        space_before=6,
    )


def slide_pipeline(prs):
    s = blank_slide(prs)
    section_bar(s)
    footer(s, 4)

    h = s.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(12), Inches(0.5))
    add_text(h, "The product surface: seven stages, one run", size=26, bold=True, color=INK)

    stages = [
        ("Source", "Local path or remote Git"),
        ("Infra", "Skip · Existing · Create VM/Serverless"),
        ("Build", "Tests · Image · Registry"),
        ("Data", "Docker DB or managed cloud DB"),
        ("Deploy", "Docker · Compose · systemd · K8s"),
        ("Verify", "Health check · optional rollback"),
        ("Notify", "Webhook / ops channel"),
    ]
    box_w = Inches(1.55)
    gap = Inches(0.18)
    start = Inches(0.45)
    top = Inches(1.2)
    for i, (name, desc) in enumerate(stages):
        left = start + i * (box_w + gap)
        box = round_rect(s, left, top, box_w, Inches(1.55), STAGE[i])
        tb = s.shapes.add_textbox(left + Inches(0.08), top + Inches(0.35), box_w - Inches(0.16), Inches(1.1))
        tf = add_text(tb, name, size=13, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        add_para(tf, desc, size=10, color=WHITE, space_before=6, align=PP_ALIGN.CENTER)
        if i < len(stages) - 1:
            arrow = s.shapes.add_shape(
                MSO_AUTO_SHAPE_TYPE.RIGHT_ARROW,
                left + box_w + Inches(0.02),
                top + Inches(0.6),
                Inches(0.14),
                Inches(0.28),
            )
            fill(arrow, MUTED)

    # Flow cards
    flows = [
        ("Operator sets boxes", "Attach Git / SSH / cloud / registry connections. Detect stack & sizing."),
        ("Run pipeline", "Orchestrator executes adapters in order. Logs stream into the run."),
        ("Gates when needed", "Pause for Terraform apply or Approve deploy. Reject stops safely."),
        ("Prove & clean up", "Verify health. Notify. Tear down with DESTROY when the env is done."),
    ]
    for i, (t, d) in enumerate(flows):
        left = Inches(0.5) + Inches(i * 3.15)
        card = round_rect(s, left, Inches(3.2), Inches(3.0), Inches(2.5), WHITE, LINE)
        head = rect(s, left, Inches(3.2), Inches(3.0), Inches(0.12), TEAL if i < 2 else COPPER)
        tb = s.shapes.add_textbox(left + Inches(0.2), Inches(3.5), Inches(2.6), Inches(2.0))
        tf = add_text(tb, f"0{i+1}  {t}", size=13, bold=True, color=INK)
        add_para(tf, d, size=12, color=MUTED, space_before=10)


def slide_architecture(prs):
    s = blank_slide(prs)
    section_bar(s)
    footer(s, 5)

    h = s.shapes.add_textbox(Inches(0.5), Inches(0.28), Inches(12), Inches(0.45))
    add_text(h, "System architecture — built to be operated, not just demoed", size=24, bold=True, color=INK)

    # Client
    c = round_rect(s, Inches(0.5), Inches(1.1), Inches(2.6), Inches(1.4), TEAL)
    tb = s.shapes.add_textbox(Inches(0.7), Inches(1.35), Inches(2.2), Inches(1.0))
    tf = add_text(tb, "Web control plane", size=13, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
    add_para(tf, "React · Pipeline board\nRun console · Connections", size=11, color=WHITE, space_before=6, align=PP_ALIGN.CENTER)

    # Arrow
    a1 = s.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RIGHT_ARROW, Inches(3.2), Inches(1.6), Inches(0.45), Inches(0.35))
    fill(a1, MUTED)

    # API cluster
    api = round_rect(s, Inches(3.8), Inches(0.95), Inches(5.4), Inches(3.55), WHITE, TEAL)
    title = s.shapes.add_textbox(Inches(4.0), Inches(1.05), Inches(5.0), Inches(0.35))
    add_text(title, "API  ·  Express orchestrator", size=13, bold=True, color=TEAL)

    inner = [
        (Inches(4.05), Inches(1.55), "HTTP /api/*", "Auth · RBAC · rate limit"),
        (Inches(6.55), Inches(1.55), "Orchestrator", "Start · approve · destroy"),
        (Inches(4.05), Inches(2.75), "Box adapters", "Source…Notify execute"),
        (Inches(6.55), Inches(2.75), "Detection", "Stack · sizing · suggestions"),
    ]
    for l, t, name, desc in inner:
        box = round_rect(s, l, t, Inches(2.35), Inches(1.0), TEAL_SOFT)
        tb = s.shapes.add_textbox(l + Inches(0.12), t + Inches(0.18), Inches(2.1), Inches(0.75))
        tf = add_text(tb, name, size=12, bold=True, color=INK)
        add_para(tf, desc, size=10, color=MUTED, space_before=2)

    # Shared
    sh = round_rect(s, Inches(9.5), Inches(0.95), Inches(3.3), Inches(1.5), COPPER_SOFT, COPPER)
    tb = s.shapes.add_textbox(Inches(9.7), Inches(1.15), Inches(2.95), Inches(1.15))
    tf = add_text(tb, "Shared domain", size=13, bold=True, color=INK)
    add_para(tf, "Types · catalogs\nVM / serverless sizing", size=11, color=MUTED, space_before=4)

    # Persistence
    store = round_rect(s, Inches(9.5), Inches(2.65), Inches(3.3), Inches(1.85), WHITE, LINE)
    tb = s.shapes.add_textbox(Inches(9.7), Inches(2.85), Inches(2.95), Inches(1.5))
    tf = add_text(tb, "Persistence", size=13, bold=True, color=INK)
    add_para(tf, "JSON store (default)\nor PostgreSQL", size=11, color=MUTED, space_before=4)
    add_para(tf, "AES-256-GCM secrets\nAppend-only audit log", size=11, color=MUTED, space_before=4)

    # External band
    ext = round_rect(s, Inches(0.5), Inches(4.8), Inches(12.3), Inches(1.85), RGBColor(0xF4, 0xF6, 0xF7), LINE)
    et = s.shapes.add_textbox(Inches(0.7), Inches(4.95), Inches(12), Inches(0.3))
    add_text(et, "External execution plane", size=12, bold=True, color=MUTED)

    externals = [
        ("Terraform modules", "VM · Function · Full app\nAWS / Azure / GCP"),
        ("Cloud builders", "CodeBuild · ACR Tasks\nCloud Build"),
        ("Git remotes", "Clone / fetch into\nrun workspaces"),
        ("SSH targets", "Existing VMs &\nauto-created hosts"),
    ]
    for i, (n, d) in enumerate(externals):
        left = Inches(0.75) + Inches(i * 3.1)
        box = round_rect(s, left, Inches(5.35), Inches(2.9), Inches(1.1), WHITE, LINE)
        tb = s.shapes.add_textbox(left + Inches(0.15), Inches(5.45), Inches(2.6), Inches(0.95))
        tf = add_text(tb, n, size=12, bold=True, color=TEAL)
        add_para(tf, d, size=10, color=MUTED, space_before=2)


def slide_modes(prs):
    s = blank_slide(prs)
    section_bar(s)
    footer(s, 6)

    h = s.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(12), Inches(0.5))
    add_text(h, "Delivery modes entrepreneurs actually need", size=26, bold=True, color=INK)

    modes = [
        ("Simulate", TEAL, "Rehearse the full pipeline with intent logs. Zero cloud mutations. Default-on for safety."),
        ("Existing server", RGBColor(0x2B, 0x6C, 0xB0), "SSH to a host you already own. Install Docker, deploy, verify — no new infra bill."),
        ("Create VM", COPPER, "Terraform provisions AWS/Azure/GCP VM + networking. Deploy via SSH. DESTROY when done."),
        ("Serverless function", RGBColor(0x6B, 0x4C, 0x9A), "Health JSON endpoint on Lambda / Azure Functions / Cloud Functions — fast proof of path."),
        ("Full app UI", RGBColor(0x1F, 0x7A, 0x4C), "Containers + managed DB/cache (ECS Express / Container Apps / Cloud Run). Real HTTPS UI."),
    ]
    for i, (name, color, desc) in enumerate(modes):
        top = Inches(1.05) + Inches(i * 1.05)
        bar = rect(s, Inches(0.5), top, Inches(0.18), Inches(0.9), color)
        card = round_rect(s, Inches(0.68), top, Inches(12.1), Inches(0.9), WHITE, LINE)
        tb = s.shapes.add_textbox(Inches(0.95), top + Inches(0.15), Inches(2.6), Inches(0.6))
        add_text(tb, name, size=16, bold=True, color=color)
        db = s.shapes.add_textbox(Inches(3.7), top + Inches(0.2), Inches(8.8), Inches(0.55))
        add_text(db, desc, size=13, color=INK)


def slide_flow(prs):
    s = blank_slide(prs)
    section_bar(s)
    footer(s, 7)

    h = s.shapes.add_textbox(Inches(0.5), Inches(0.28), Inches(12), Inches(0.45))
    add_text(h, "Live run lifecycle — control at every gate", size=24, bold=True, color=INK)

    steps = [
        ("Save pipeline", "Boxes + connections"),
        ("Start run", "Detect · queue 7 steps"),
        ("Execute adapters", "Simulate or Live work"),
        ("Approval gate", "TF apply / Deploy"),
        ("Verify", "Health · rollback?"),
        ("Environment", "Keep or DESTROY"),
    ]
    for i, (n, d) in enumerate(steps):
        left = Inches(0.4) + Inches(i * 2.15)
        oval = s.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.OVAL, left + Inches(0.7), Inches(1.15), Inches(0.55), Inches(0.55))
        fill(oval, TEAL if i < 4 else COPPER)
        add_text(oval, str(i + 1), size=14, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        if i < len(steps) - 1:
            line = s.shapes.add_shape(
                MSO_AUTO_SHAPE_TYPE.RECTANGLE,
                left + Inches(1.35),
                Inches(1.38),
                Inches(1.4),
                Inches(0.06),
            )
            fill(line, LINE)
        card = round_rect(s, left, Inches(1.9), Inches(2.0), Inches(1.35), WHITE, LINE)
        tb = s.shapes.add_textbox(left + Inches(0.12), Inches(2.05), Inches(1.75), Inches(1.1))
        tf = add_text(tb, n, size=12, bold=True, color=INK, align=PP_ALIGN.CENTER)
        add_para(tf, d, size=11, color=MUTED, space_before=6, align=PP_ALIGN.CENTER)

    # Sequence detail
    detail = round_rect(s, Inches(0.5), Inches(3.55), Inches(12.3), Inches(3.1), TEAL_SOFT)
    dt = s.shapes.add_textbox(Inches(0.75), Inches(3.75), Inches(11.8), Inches(2.7))
    tf = add_text(dt, "What happens under the hood", size=14, bold=True, color=TEAL_DARK)
    bullets = [
        "Operator saves boxes → POST /runs → orchestrator creates a PipelineRun with seven steps.",
        "Each adapter runs in product order (Data before Deploy). Live adapters call Terraform, SSH, or cloud builders.",
        "If TF apply or deploy approval is required, status becomes waiting_approval until Approve / Reject.",
        "On infra failure after provision: automatic Terraform destroy rollback. On verify failure: optional auto-rollback.",
        "Succeeded Create-infra runs keep an environment record so operators can tear down later (type DESTROY).",
    ]
    for b in bullets:
        add_para(tf, "▸  " + b, size=12, color=INK, space_before=8)


def slide_trust(prs):
    s = blank_slide(prs)
    section_bar(s)
    footer(s, 8)

    h = s.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(12), Inches(0.5))
    add_text(h, "Trust layer — what serious buyers ask first", size=26, bold=True, color=INK)

    items = [
        ("Simulate by default", "Live cloud mutations are explicit. No accidental Terraform apply."),
        ("Approval gates", "Separate controls for TF apply and pre-deploy. Reject ends the path cleanly."),
        ("Secrets hygiene", "AES-256-GCM encryption at rest. Secrets never returned in connection config."),
        ("RBAC", "admin · operator · viewer. Mutating routes require operator+."),
        ("Audit trail", "Append-only audit events (file or Postgres). Know who ran what."),
        ("Cost discipline", "Sizing from detection. DESTROY tear-down. Private ports never published."),
        ("Rate limiting", "API protected by request windows — safer multi-user operation."),
        ("Self-host ready", "Docker Compose platform. JSON store or Postgres. Your cloud accounts."),
    ]
    for i, (t, d) in enumerate(items):
        col = i % 4
        row = i // 4
        left = Inches(0.45) + Inches(col * 3.2)
        top = Inches(1.15) + Inches(row * 2.7)
        card = round_rect(s, left, top, Inches(3.05), Inches(2.4), WHITE, LINE)
        accent = rect(s, left, top, Inches(3.05), Inches(0.1), TEAL if row == 0 else COPPER)
        tb = s.shapes.add_textbox(left + Inches(0.2), top + Inches(0.35), Inches(2.65), Inches(1.85))
        tf = add_text(tb, t, size=14, bold=True, color=INK)
        add_para(tf, d, size=12, color=MUTED, space_before=10)


def slide_close(prs):
    s = blank_slide(prs)
    rect(s, Inches(0), Inches(0), SLIDE_W, SLIDE_H, TEAL_DARK)
    rect(s, Inches(0), Inches(0), Inches(0.28), SLIDE_H, COPPER)

    h = s.shapes.add_textbox(Inches(0.9), Inches(1.1), Inches(11.5), Inches(0.7))
    add_text(h, "Recommended next step", size=28, bold=True, color=WHITE)

    steps = [
        ("01", "Local proof", "Docker Desktop → Simulate OFF → demo-app → Infra Skip → Run → /health."),
        ("02", "Cloud pilot", "One cloud connection. Create VM or serverless path. Approve gates on. DESTROY after."),
        ("03", "Operating model", "Define who is admin/operator. Persist settings. Optional Postgres + API token."),
    ]
    for i, (n, t, d) in enumerate(steps):
        top = Inches(2.1) + Inches(i * 1.15)
        pill(s, Inches(0.9), top + Inches(0.15), Inches(0.7), Inches(0.45), n, COPPER)
        tb = s.shapes.add_textbox(Inches(1.85), top, Inches(10), Inches(1.0))
        tf = add_text(tb, t, size=18, bold=True, color=WHITE)
        add_para(tf, d, size=14, color=RGBColor(0xB8, 0xD4, 0xD4), space_before=4)

    end = s.shapes.add_textbox(Inches(0.9), Inches(6.0), Inches(11.5), Inches(0.8))
    tf = add_text(end, "Shipdeck", size=16, bold=True, color=COPPER)
    add_para(tf, "Enterprise visual delivery control  ·  Source → Notify in one cockpit", size=13, color=WHITE, space_before=4)


def main():
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H

    slide_title(prs)
    slide_problem(prs)
    slide_solution(prs)
    slide_pipeline(prs)
    slide_architecture(prs)
    slide_modes(prs)
    slide_flow(prs)
    slide_trust(prs)
    slide_close(prs)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
