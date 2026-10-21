import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  amountToAtomic, parsePublicQuote, verifyQuote, checkQuoteText, parseCLI, runCli,
  OFFICIAL_CIRCLE_BASE_USDC, BASE_NETWORK
} from "../src/check.mjs";

const payTo="0x6b01efA0705E91a7aca54271510bf9e594717f34";
const url="https://vm5-openapi-x402.onrender.com/v1/csv-report";
const policy={network:BASE_NETWORK,asset:OFFICIAL_CIRCLE_BASE_USDC,recipient:payTo,price:"0.005",url};
const quote=(overrides={})=>({x402Version:2,resource:{url},accepts:[{
  scheme:"exact",network:BASE_NETWORK,asset:OFFICIAL_CIRCLE_BASE_USDC,payTo,
  amount:"5000",maxTimeoutSeconds:300,...overrides}]});
const code=(fn)=>{try{fn();}catch(e){return e.code;}return "NO_ERROR";};

test("exact decimal scale and disallowed prices",()=>{
 assert.equal(amountToAtomic("0.005"),"5000");
 assert.equal(amountToAtomic("0.000001"),"1");
 assert.equal(amountToAtomic("1.5"),"1500000");
 assert.equal(amountToAtomic("12"),"12000000");
 for(const p of ["0","0.000000","0.0000001","1e2","-1","1.0010001","00.5","1."]) {
   assert.ok(code(()=>amountToAtomic(p)).startsWith("EXPECTED_PRICE_"));
 }
});
test("valid unsigned quote matches exact chain, asset, recipient, amount and URL",()=>{
 const a=verifyQuote(quote(),policy);
 assert.equal(a.ok,true);
 assert.equal(a.signed,false);
 assert.equal(a.paid,false);
 assert.equal(a.delivered,false);
 assert.equal(a.atomicAmount,"5000");
 assert.equal(a.recipient,payTo.toLowerCase());
});
test("rejects wrong token, chain, recipient, quote version, amount and URL",()=>{
 for(const [v,expected] of [
  [{network:"eip155:137"},"NO_OFFICIAL_BASE_USDC_ACCEPT"],
  [{asset:"0x"+"1".repeat(40)},"NO_OFFICIAL_BASE_USDC_ACCEPT"],
  [{payTo:"0x"+"2".repeat(40)},"PAYEE_MISMATCH"],
  [{amount:"6000"},"AMOUNT_MISMATCH"],
  [{amount:"0005000"},"QUOTED_AMOUNT_INVALID"],
  [{maxTimeoutSeconds:-1},"TIMEOUT_INVALID"]
 ])assert.equal(code(()=>verifyQuote(quote(v),policy)),expected);
 assert.equal(code(()=>verifyQuote({...quote(),x402Version:1},policy)),"X402_V2_ACCEPTS_REQUIRED");
 assert.equal(code(()=>verifyQuote({...quote(),resource:{url:"https://attacker.example/"}},policy)),"RESOURCE_URL_MISMATCH");
});
test("duplicate Base USDC offers rejected, unrelated multi-network offer allowed",()=>{
 const two={...quote(),accepts:[quote().accepts[0],{...quote().accepts[0],payTo:"0x"+"2".repeat(40)}]};
 assert.equal(code(()=>verifyQuote(two,policy)),"AMBIGUOUS_BASE_USDC_OFFERS");
 const multi={...quote(),accepts:[quote().accepts[0],{...quote().accepts[0],network:"eip155:137"}]};
 assert.equal(verifyQuote(multi,policy).ok,true);
});
test("JSON and base64 are accepted; private signed payloads fail closed",()=>{
 const raw=JSON.stringify(quote());
 assert.equal(checkQuoteText(raw,policy).ok,true);
 assert.equal(checkQuoteText(Buffer.from(raw).toString("base64"),policy).ok,true);
 assert.equal(code(()=>checkQuoteText("!bad?",policy)),"QUOTE_FORMAT_INVALID");
 assert.equal(code(()=>checkQuoteText(JSON.stringify({...quote(),signature:"secret"}),policy)),"SIGNED_PAYLOAD_FORBIDDEN");
 assert.equal(code(()=>checkQuoteText(JSON.stringify({...quote(),privateKey:"not-real"}),policy)),"SIGNED_PAYLOAD_FORBIDDEN");
 assert.equal(code(()=>parsePublicQuote("x".repeat(70000))),"QUOTE_SIZE_INVALID");
});
test("CLI parses strict arguments with no repeat",()=>{
 assert.deepEqual(parseCLI(["--file","a.json","--recipient",payTo,"--price","0.005"]),{file:"a.json",recipient:payTo,price:"0.005"});
 assert.equal(code(()=>parseCLI(["--file","a.json","--file","other.json","--price","0.005"])),"USAGE_INVALID");
 assert.equal(code(()=>parseCLI(["--file","a.json"])),"USAGE_INVALID");
});
test("real owner unsigned sample and public-only GitHub Actions outputs",()=>{
 const raw=fs.readFileSync("fixtures/valid-vm5-csv-quote.json","utf8");
 assert.equal(checkQuoteText(raw,policy).ok,true);
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),"x402-guard-test-"));
 try{
  const o=path.join(outputDir,"action-output");
  fs.writeFileSync(o,"",{mode:0o600});
  const result=runCli(["--file","fixtures/valid-vm5-csv-quote.json","--recipient",payTo,"--price","0.005","--url",url],{GITHUB_OUTPUT:o});
  assert.equal(result.ok,true);
  assert.match(fs.readFileSync(o,"utf8"),/quote_pass=true/);
  assert.ok(!fs.readFileSync(o,"utf8").includes("PAYMENT-SIGNATURE"));
 }finally{fs.rmSync(outputDir,{recursive:true,force:true});}
});
test("GitHub Action manifest is offline and binds every required input",()=>{
 const yaml=fs.readFileSync("action.yml","utf8");
 const src=fs.readFileSync("src/check.mjs","utf8");
 assert.match(yaml,/using: composite/);
 assert.match(yaml,/GITHUB_ACTION_PATH/);
 assert.match(yaml,/expected_payto/);
 assert.match(yaml,/price_usdc/);
 assert.match(yaml,/steps.verify.outputs.quote_pass/);
 assert.doesNotMatch(src,/\bfetch\s*\(|axios|https\.request|http\.request|private[_-]?key\s*=\s*0x/i);
});
