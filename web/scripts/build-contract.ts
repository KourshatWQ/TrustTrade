/**
 * Builds the escrow contract without cargo-near:
 *   1. cargo build --target wasm32-unknown-unknown --release   (run inside contract/ so
 *      contract/.cargo/config.toml applies `--cfg near` and `-C link-arg=-s`)
 *   2. wasm-opt -Oz (binaryen from npm) to cut size, and therefore storage staking cost
 * Output: contract/res/trusttrade_escrow.wasm
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/near/server";

const contractDir = path.join(REPO_ROOT, "contract");
const raw = path.join(contractDir, "target", "wasm32-unknown-unknown", "release", "trusttrade_escrow.wasm");
const out = path.join(contractDir, "res", "trusttrade_escrow.wasm");

execFileSync("cargo", ["build", "--target", "wasm32-unknown-unknown", "--release"], { cwd: contractDir, stdio: "inherit" });

fs.mkdirSync(path.dirname(out), { recursive: true });
// binaryen's wasm-opt is a Node script; run it with node directly (no shell, so
// paths with spaces/non-ASCII characters are safe).
const wasmOpt = path.join(process.cwd(), "node_modules", "binaryen", "bin", "wasm-opt");
execFileSync(
  process.execPath,
  [wasmOpt, "-Oz", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", "--enable-sign-ext", "--enable-mutable-globals", "--strip-debug", "-o", out, raw],
  { stdio: "inherit" },
);
console.log(`raw ${(fs.statSync(raw).size / 1024).toFixed(0)} KiB → optimized ${(fs.statSync(out).size / 1024).toFixed(0)} KiB: ${out}`);
