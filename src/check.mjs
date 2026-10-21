#!/usr/bin/env node
/**
 * Deterministic offline x402 v2 PAYMENT-REQUIRED quote policy check.
 * Never connects to a network, signs, settles, handles keys, or pays.
 * Use only a public UNSIGNED x402 quote or synthetic fixture as input.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OFFICIAL_CIRCLE_BASE_USDC = "0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913";
export const BASE_NETWORK = "eip155:8453";
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const MAX_QUOTE_BYTES = 65536;
const MAX_ATOMIC = 999999999999999999n;

function errorCode(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

export function amountToAtomic(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(value)) {
    throw errorCode("EXPECTED_PRICE_INVALID");
  }
  const [whole, fraction = ""] = value.split(".");
  const atomic = BigInt(whole) * 1000000n + BigInt((fraction + "000000").slice(0, 6));
  if (atomic <= 0n || atomic > MAX_ATOMIC) throw errorCode("EXPECTED_PRICE_OUT_OF_RANGE");
  return atomic.toString();
}

export function parsePublicQuote(input) {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_QUOTE_BYTES || input.length === 0) {
    throw errorCode("QUOTE_SIZE_INVALID");
  }
  let text = input.trim();
  // Supports a JSON object, or the standard base64 PAYMENT-REQUIRED HTTP header.
  if (!text.startsWith("{")) {
    if (!/^[A-Za-z0-9+/_=-]+$/.test(text) || text.length > MAX_QUOTE_BYTES) {
      throw errorCode("QUOTE_FORMAT_INVALID");
    }
    if (text.length % 4 === 1) throw errorCode("QUOTE_BASE64_INVALID");
    const decoded = Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (decoded.length > MAX_QUOTE_BYTES) throw errorCode("QUOTE_SIZE_INVALID");
    text = decoded.toString("utf8");
  }
  let quote;
  try { quote = JSON.parse(text); }
  catch { throw errorCode("QUOTE_JSON_INVALID"); }
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) throw errorCode("QUOTE_OBJECT_REQUIRED");
  // Reject signed payment payloads accidentally passed as public quote inputs.
  if (
    "paymentSignature" in quote || "PAYMENT-SIGNATURE" in quote || "authorization" in quote ||
    "signature" in quote || "privateKey" in quote || "seedPhrase" in quote
  ) throw errorCode("SIGNED_PAYLOAD_FORBIDDEN");
  if (quote.x402Version !== 2 || !Array.isArray(quote.accepts) || quote.accepts.length < 1 || quote.accepts.length > 30) {
    throw errorCode("X402_V2_ACCEPTS_REQUIRED");
  }
  return quote;
}

export function verifyQuote(quote, policy) {
  if (!quote || quote.x402Version !== 2 || !Array.isArray(quote.accepts) || quote.accepts.length < 1 || quote.accepts.length > 30) {
    throw errorCode("X402_V2_ACCEPTS_REQUIRED");
  }
  if (!policy || typeof policy !== "object") throw errorCode("POLICY_REQUIRED");
  if (policy.network !== BASE_NETWORK) throw errorCode("BASE_NETWORK_ONLY");
  if (policy.asset?.toLowerCase() !== OFFICIAL_CIRCLE_BASE_USDC.toLowerCase()) {
    throw errorCode("OFFICIAL_BASE_USDC_ONLY");
  }
  if (typeof policy.recipient !== "string" || !EVM_ADDRESS.test(policy.recipient)) {
    throw errorCode("RECIPIENT_ADDRESS_INVALID");
  }
  const expectedAmount = amountToAtomic(policy.price);
  if (policy.url !== undefined && policy.url !== "") {
    let uri;
    try { uri = new URL(policy.url); }
    catch { throw errorCode("EXPECTED_URL_INVALID"); }
    if (uri.protocol !== "https:" || uri.username || uri.password || uri.hash) throw errorCode("EXPECTED_URL_INVALID");
    const actual = typeof quote.resource?.url === "string" ? quote.resource.url : quote.resource;
    if (actual !== policy.url) throw errorCode("RESOURCE_URL_MISMATCH");
  }
  // Ambiguous duplicate quotes for the same Base/USDC rail are unsafe.
  const baseExact = quote.accepts.filter(a =>
    a && typeof a === "object" && a.scheme === "exact" && a.network === BASE_NETWORK &&
    typeof a.asset === "string" && a.asset.toLowerCase() === OFFICIAL_CIRCLE_BASE_USDC.toLowerCase());
  if (!baseExact.length) throw errorCode("NO_OFFICIAL_BASE_USDC_ACCEPT");
  if (baseExact.length > 1) throw errorCode("AMBIGUOUS_BASE_USDC_OFFERS");
  const offer = baseExact[0];
  if (offer.payTo?.toLowerCase() !== policy.recipient.toLowerCase()) throw errorCode("PAYEE_MISMATCH");
  if (typeof offer.amount !== "string" || !/^[1-9][0-9]*$/.test(offer.amount)) {
    throw errorCode("QUOTED_AMOUNT_INVALID");
  }
  if (offer.amount !== expectedAmount) throw errorCode("AMOUNT_MISMATCH");
  if (typeof offer.maxTimeoutSeconds === "number" &&
      (!Number.isInteger(offer.maxTimeoutSeconds) || offer.maxTimeoutSeconds < 1)) {
    throw errorCode("TIMEOUT_INVALID");
  }
  return Object.freeze({
    ok: true, status: "QUOTE_VALID_UNSIGNED_ONLY", network: BASE_NETWORK,
    asset: OFFICIAL_CIRCLE_BASE_USDC, recipient: policy.recipient.toLowerCase(),
    atomicAmount: expectedAmount, priceUSDC: policy.price,
    paid: false, signed: false, settled: false, delivered: false,
    explanation: "An unsigned HTTP 402 quote is not a payment or proof of settlement."
  });
}

export function checkQuoteText(input, policy) {
  return verifyQuote(parsePublicQuote(input), policy);
}

export function parseCLI(argv) {
  const output = {};
  const keys = new Map([
    ["--file", "file"], ["--recipient", "recipient"], ["--price", "price"], ["--url", "url"]
  ]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys.get(argv[i]);
    if (!key || i + 1 >= argv.length || output[key] !== undefined || argv[i + 1].startsWith("--")) {
      throw errorCode("USAGE_INVALID");
    }
    output[key] = argv[i + 1];
  }
  if (!output.file || !output.recipient || !output.price) throw errorCode("USAGE_INVALID");
  return output;
}

export function runCli(argv, env = process.env) {
  const args = parseCLI(argv);
  const absolute = path.resolve(args.file);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 5 || stat.size > MAX_QUOTE_BYTES) {
    throw errorCode("QUOTE_FILE_NOT_SMALL_REGULAR_FILE");
  }
  const raw = fs.readFileSync(absolute, "utf8");
  const result = checkQuoteText(raw, {
    network: BASE_NETWORK, asset: OFFICIAL_CIRCLE_BASE_USDC,
    recipient: args.recipient, price: args.price, url: args.url
  });
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT,
      "quote_pass=true\n" +
      "network=" + BASE_NETWORK + "\n" +
      "price_usdc=" + result.priceUSDC + "\n" +
      "recipient=" + result.recipient + "\n",
      { encoding: "utf8" });
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runCli(process.argv.slice(2));
    // Only public policy facts, never raw quote bytes or authentication material.
    console.log("QUOTE VALID (UNSIGNED; NO PURCHASE): " +
      result.network + " " + result.priceUSDC + " USDC → " + result.recipient);
  } catch (e) {
    console.error("QUOTE NOT ACCEPTED: " + (e.code || "LOCAL_INPUT_ERROR"));
    process.exitCode = 1;
  }
}
