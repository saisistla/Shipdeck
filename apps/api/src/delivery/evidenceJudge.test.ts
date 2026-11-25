import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyHeuristicJudgement } from "./evidenceJudge.js";
import type { DeliveryTicket } from "@shipdeck/shared";

function ticket(partial: Partial<DeliveryTicket>): DeliveryTicket {
  return {
    key: "SCRUM-2",
    summary: "Add patient surname on the front-desk list",
    description:
      "Add the patient surname column on the existing front-desk list. The attached screenshot is the current page.",
    acceptance: ["Show surname on the list"],
    comments: [],
    attachments: [],
    ...partial,
  };
}

describe("attachment judgement", () => {
  it("keeps a screenshot of the current screen and drops old test evidence", () => {
    const judged = applyHeuristicJudgement(
      ticket({
        comments: ["Ada: look at desk.png — this is the current list", "QA: pipeline failed again, see pipeline-fail.png"],
        attachments: [
          { filename: "desk.png", mimeType: "image/png", kind: "image", storedName: "desk.png" },
          { filename: "pipeline-fail.png", mimeType: "image/png", kind: "image", storedName: "pipeline-fail.png" },
        ],
      })
    );
    const desk = judged.attachments.find((item) => item.filename === "desk.png");
    const fail = judged.attachments.find((item) => item.filename === "pipeline-fail.png");
    assert.equal(desk?.relevant, true);
    assert.equal(fail?.relevant, false);
    assert.ok(judged.relevantComments?.some((item) => /desk\.png/.test(item)));
    assert.ok(!(judged.relevantComments ?? []).some((item) => /pipeline failed/.test(item)));
  });

  it("keeps a Word or PDF when its text is about this ticket", () => {
    const judged = applyHeuristicJudgement(
      ticket({
        attachments: [
          {
            filename: "surname-spec.docx",
            kind: "document",
            textExcerpt: "Add the patient surname column on the front-desk list.",
          },
          {
            filename: "old-test-plan.pdf",
            kind: "document",
            textExcerpt: "Regression failed. Pipeline error. Re-test after the green build.",
          },
        ],
      })
    );
    assert.equal(judged.attachments.find((item) => item.filename === "surname-spec.docx")?.relevant, true);
    assert.equal(judged.attachments.find((item) => item.filename === "old-test-plan.pdf")?.relevant, false);
  });

  it("does not keep a generic image just because it is attached", () => {
    const judged = applyHeuristicJudgement(
      ticket({
        summary: "Add patient surname",
        description: "Add surname to the booking form only. No screenshot is required.",
        comments: ["Build passed on staging"],
        attachments: [{ filename: "image-3.png", mimeType: "image/png", kind: "image" }],
      })
    );
    assert.equal(judged.attachments[0]?.relevant, false);
    assert.deepEqual(judged.relevantComments, []);
  });
});
