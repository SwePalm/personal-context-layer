#!/usr/bin/env node
import { ContextStore } from "../src/context-store.mjs";

const report = new ContextStore().lint();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
