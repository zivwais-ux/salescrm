#!/usr/bin/env node
/* שרת סטטי לפיתוח: node tests/serve.js [port] */
const { serve } = require("./lib/harness");
serve().then(({ url }) => console.log(`BENY רץ על ${url}`));
