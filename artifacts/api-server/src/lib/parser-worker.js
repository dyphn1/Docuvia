// Standalone worker for isolated parsing to prevent OOM on main thread
const fs = require("fs");

async function parsePdf(buffer) {
  const pdfParse = require("pdf-parse");
  const result = await pdfParse(buffer);
  return result.text.trim();
}

async function parseDocx(buffer) {
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function parsePptx(buffer) {
  return new Promise((resolve, reject) => {
    const { OfficeParser } = require("officeparser");
    OfficeParser.parseOffice(buffer, (err, data) => {
      if (err) reject(err);
      else resolve(data ?? "");
    });
  });
}

process.on("message", async (message) => {
  try {
    const { docType, filePath } = message;
    const buffer = fs.readFileSync(filePath);
    let text = "";

    switch (docType) {
      case "pdf":
        text = await parsePdf(buffer);
        break;
      case "docx":
        text = await parseDocx(buffer);
        break;
      case "pptx":
        text = await parsePptx(buffer);
        break;
      default:
        text = buffer.toString("utf-8").trim();
    }

    // Clean up temp file
    fs.unlinkSync(filePath);

    process.send({ success: true, text });
  } catch (error) {
    if (message.filePath && fs.existsSync(message.filePath)) {
      fs.unlinkSync(message.filePath);
    }
    process.send({ success: false, error: error.message });
  }
});
