/**
 * index.js — Backend entrypoint
 *
 * Express on 0.0.0.0 (Render / local). Scheduling runs on the agent + extension.
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const api = require("./api");

const PORT = Number(process.env.PORT) || 3579;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();

app.use(cors());
app.use(express.json());

app.use(api);

app.listen(PORT, HOST, () => {
  console.log(`\n  Page Monitor Backend`);
  console.log(`  Listening on http://${HOST}:${PORT}\n`);
});
