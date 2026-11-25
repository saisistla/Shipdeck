import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractDocumentText, extractPdfText, zipStore } from "./documentText.js";
import { attachmentKind, excerptFromBytes } from "./ticketAttachments.js";

function samplePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 10 20 Td (${text}) Tj ET`;
  return Buffer.from(
    `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>endobj
4 0 obj<< /Length ${stream.length} >>stream
${stream}
endstream
endobj
trailer<< /Root 1 0 R >>
%%EOF
`,
    "utf8"
  );
}

describe("document text extraction", () => {
  it("reads text from a PDF, Word, spreadsheet, and RTF", () => {
    assert.match(extractPdfText(samplePdf("Patient surname column")), /Patient surname column/);
    const docx = zipStore({
      "word/document.xml":
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Add patient surname on the list</w:t></w:r></w:p></w:body></w:document>',
    });
    assert.match(extractDocumentText("notes.docx", docx), /Add patient surname/);
    const xlsx = zipStore({
      "xl/sharedStrings.xml": "<sst><si><t>Harvest plot</t></si></sst>",
    });
    assert.match(extractDocumentText("plots.xlsx", xlsx), /Harvest plot/);
    assert.match(extractDocumentText("brief.rtf", Buffer.from("{\\rtf1 Current front desk list}", "utf8")), /Current front desk list/);
  });

  it("classifies Jira image and office types", () => {
    assert.equal(attachmentKind("shot.tiff", "image/tiff"), "image");
    assert.equal(attachmentKind("spec.pdf"), "document");
    assert.equal(attachmentKind("notes.docx"), "document");
    assert.equal(attachmentKind("grid.xlsx"), "document");
    assert.match(excerptFromBytes("spec.pdf", samplePdf("Patient surname column")), /Patient surname/);
  });
});
