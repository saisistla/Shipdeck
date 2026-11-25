import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseSourceFiles } from "./existingRepo.js";
import { customerTicketLines, READ_THE_WHOLE_TICKET } from "./ticketAttachments.js";

describe("existing repo code instructions", () => {
  it("keeps the data file when the screen files would otherwise fill the list", () => {
    const screens = Array.from({ length: 45 }, (_, index) => ({
      path: `components/part-${String(index).padStart(2, "0")}.tsx`,
      contents: "screen",
    }));
    const chosen = chooseSourceFiles([...screens, { path: "lib/seed.ts", contents: "seed" }]);
    assert.equal(chosen.length, 40);
    assert.equal(chosen[0]?.path, "lib/seed.ts");
  });

  it("gives the model every line of the ticket, not only the title", () => {
    const text = customerTicketLines({
      key: "KAN-2",
      summary: "Modify Surabhee application add new tab",
      description: "Modify existing",
      acceptance: [],
      comments: ["status note that is not the request"],
      relevantComments: ["Add Cow Milk based products: Milk, Ghee, Curd"],
      attachments: [],
    });
    assert.match(text, /Milk, Ghee, Curd/);
    assert.doesNotMatch(text, /status note/);
    assert.match(READ_THE_WHOLE_TICKET, /Do not stop after the title/);
    assert.match(READ_THE_WHOLE_TICKET, /add those items to the data/);
  });
});
