import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { exportRasterPayloadToSVG } from "./svg-pipeline.js";
import cors from "cors"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

const app = express();
app.use(express.json({ limit: "100mb" }));
app.use(express.static(root));
app.use(cors())

app.get("/api/export-svg", async (req, res) => {
  res.json({});
});

app.post("/api/export-svg", async (req, res) => {
  try {
    const result = await exportRasterPayloadToSVG(req.body);
    res.json(result);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .send(error instanceof Error ? error.message : String(error));
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, "0.0.0.0", () => {
  console.log(`SVG export server listening on http://0.0.0.0:${port}`);
});
