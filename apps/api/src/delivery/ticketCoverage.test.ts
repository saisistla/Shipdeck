import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingTicketItems, requiredTicketItems } from "./ticketCoverage.js";

const kan2 =
  "Please modify application which is running on 34.53.194.83:43123 and source code in . Add following new tabs Cow Milk based products Millets Miscellaneous products Below are detailed products to add Cow Milk based products - a) Milk b) Ghee c) Curd Millets - jonnalu, ragulu, sajjalu, korralu Miscellaneous products - soaps, honey";

describe("ticket coverage", () => {
  it("reads every named product from the ticket", () => {
    const items = requiredTicketItems(kan2).map((item) => item.toLowerCase());
    for (const name of ["milk", "ghee", "curd", "jonnalu", "ragulu", "sajjalu", "korralu", "soaps", "honey"]) {
      assert.ok(items.includes(name), name);
    }
  });

  it("does not accept a button label as the product", () => {
    const missing = missingTicketItems(kan2, [
      { path: "components/shop-home.tsx", contents: 'label: "Cow Milk based products"' },
      { path: "lib/seed.ts", contents: 'id: "bendakaya"' },
    ]);
    assert.ok(missing.map((item) => item.toLowerCase()).includes("milk"));
    assert.ok(missing.map((item) => item.toLowerCase()).includes("honey"));
  });

  it("does not treat an ordinary sentence as a product list", () => {
    const items = requiredTicketItems("Staff should see today’s appointments, book a slot, and cancel a booking.");
    assert.deepEqual(items, []);
  });

  it("accepts the change when the stall list contains the named products", () => {
    const missing = missingTicketItems(kan2, [
      { path: "lib/seed.ts", contents: "milk ghee curd jonnalu ragulu sajjalu korralu soaps honey" },
    ]);
    assert.deepEqual(missing, []);
  });
});
