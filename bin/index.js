#! /usr/bin/env node
require("dotenv").config();
const path = require("node:path");

const cli_path = path.join(__dirname, "..", "cli.js");

const { main } = require(cli_path);

main();
